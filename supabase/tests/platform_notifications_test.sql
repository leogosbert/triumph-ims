-- Tests for notifications in the LeMoSp ADMIN app (platform_notifications).
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;
create or replace function tests.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'email', p_email, 'role', 'authenticated',
                      'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text, false);
end $$;
create or replace function tests.login_aal(p_email text, p_aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'email', p_email, 'role', 'authenticated', 'aal', p_aal,
                      'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text, false);
end $$;
create or replace function tests.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAILED: %', p_label; end if;
  raise notice 'pass: %', p_label;
end $$;
create or replace function tests.blocked(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAILED (was allowed): %', p_label;
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'pass: % (blocked: %)', p_label, sqlerrm;
end $$;
grant execute on all functions in schema tests to authenticated, anon;

-- Earlier test files may have left notices behind: start from an empty list.
delete from public.platform_notifications;

insert into auth.users (email) values ('padmin@pn.test'), ('pboss@pn.test'), ('pother@pn.test');
select id as admin from auth.users where email = 'padmin@pn.test' \gset
select id as boss from auth.users where email = 'pboss@pn.test' \gset
select id as other from auth.users where email = 'pother@pn.test' \gset
insert into public.platform_admins (user_id) values (:'admin');

-- ---- 1. Events -----------------------------------------------------------
select tests.login('pboss@pn.test'); set role authenticated;
select public.create_company('Notify Co') as co \gset
reset role;
select tests.check((select severity = 'attention' and kind = 'company_signup' and ref_company = :'co'
                           and title = 'New company: Notify Co' and link = '/admin/companies/' || :'co'
                      from public.platform_notifications where dedupe_key = 'signup:' || :'co'),
  'a new company creates one admin notice (attention, links to the company)');

set ims.demo_create = 'on';
insert into public.companies (name, is_demo, demo_expires_at) values ('Demo PN', true, now() + interval '1 day')
returning id as demo \gset
reset ims.demo_create;
select tests.check(not exists (select 1 from public.platform_notifications where ref_company = :'demo'),
  'demo companies create no admin notice');

select tests.login('pboss@pn.test'); set role authenticated;
select public.set_business_level(:'co', 'small', '{"employees": 3}'::jsonb);
reset role;
select tests.check((select kind = 'company_onboarded' and body = 'Chose the Small level.'
                      from public.platform_notifications where dedupe_key = 'onboarded:' || :'co'),
  'finishing setup is reported with the chosen level');
select tests.check(not exists (select 1 from public.platform_notifications where kind = 'company_level' and ref_company = :'co'),
  'the first level choice is not also reported as a level change');

select tests.login('pboss@pn.test'); set role authenticated;
select public.set_business_level(:'co', 'enterprise');
select public.set_business_level(:'co', 'small');
select public.set_business_level(:'co', 'enterprise');
reset role;
select tests.check((select count(*) from public.platform_notifications where kind = 'company_level' and ref_company = :'co') = 2,
  'level changes are reported, the same level only once a day');
select tests.check(exists (select 1 from public.platform_notifications
                            where kind = 'company_level' and ref_company = :'co' and title = 'Notify Co moved to Enterprise'
                              and body = 'Business level changed from Small to Enterprise.' and severity = 'info'),
  'a level change names the old and new level');

select tests.login('pboss@pn.test'); set role authenticated;
select public.submit_suggestion(:'co', 'technology', 'Dark mode for invoices', 'Secret client Acme pays 5,000,000', true) as fb \gset
select public.submit_suggestion(:'co', 'sales', 'Internal idea only', 'Not for the platform', false) as internal \gset
reset role;
select tests.check((select kind = 'app_feedback' and title = 'New app feedback: Dark mode for invoices'
                           and body = 'Technology · Enterprise level' and ref_company is null and link = '/admin/feedback'
                      from public.platform_notifications where dedupe_key = 'feedback:' || :'fb'),
  'app feedback is reported without the company, the author or the text');
select tests.check(not exists (select 1 from public.platform_notifications where dedupe_key = 'feedback:' || :'internal')
                   and not exists (select 1 from public.platform_notifications where body like '%Acme%' or title like '%Acme%'),
  'company-internal suggestions are never reported');

insert into public.account_deletions (user_id, name_hint, delete_after) values (:'other', 'P', now() + interval '7 days')
returning id as del \gset
select tests.check((select kind = 'account_deletion' and title = 'An account is scheduled for deletion'
                           and body not like '%@%' and body not like '%pother%' and ref_company is null
                      from public.platform_notifications where dedupe_key = 'acct-del:' || :'del'),
  'a scheduled account deletion is reported without name or email');

select tests.login('pboss@pn.test'); set role authenticated;
select public.request_company_closure(:'co') is not null as closing \gset
reset role;
select id as closure from public.company_closures where company_id = :'co' and status = 'scheduled' \gset
select tests.check((select kind = 'company_closure' and title = 'Notify Co asked to close' and severity = 'attention'
                      from public.platform_notifications where dedupe_key = 'closure:' || :'closure'),
  'a company closure request is reported');
select tests.login('pboss@pn.test'); set role authenticated;
select public.cancel_company_closure(:'co');
reset role;
select tests.check(exists (select 1 from public.platform_notifications
                            where dedupe_key = 'closure-cancel:' || :'closure' and title = 'Closure cancelled: Notify Co'),
  'a cancelled closure is reported');

select public.check_overdue_backups_at(now() + interval '3 days') > 0 as overdue \gset
select public.check_overdue_backups_at(now() + interval '3 days 1 minute') as again \gset
select tests.check((select count(*) from public.platform_notifications
                     where kind = 'backup_overdue' and ref_company = :'co' and severity = 'urgent') = 1,
  'overdue automatic backups: one urgent notice per company per day');
select public.check_overdue_backups_at(now() + interval '4 days') as next_day \gset
select tests.check((select count(*) from public.platform_notifications where kind = 'backup_overdue' and ref_company = :'co') = 2,
  'and again the next day if still overdue');
select tests.check(not exists (select 1 from public.platform_notifications where kind = 'backup_overdue' and ref_company = :'demo'),
  'never for demo companies');

insert into public.security_events (user_id, kind) select :'boss', 'sign_in_new_device' from generate_series(1, 19);
select tests.check(not exists (select 1 from public.platform_notifications where kind = 'security_burst'),
  'a few new-device sign-ins are normal: no notice');
insert into public.security_events (user_id, kind) select :'boss', 'sign_in_new_device' from generate_series(1, 5);
select tests.check((select count(*) from public.platform_notifications where kind = 'security_burst' and severity = 'urgent') = 1,
  'many new-device sign-ins in an hour: one urgent notice for that hour');

-- A broken notification never stops the original action.
alter table public.platform_notifications add constraint pn_test_broken check (false) not valid;
select tests.login('pboss@pn.test'); set role authenticated;
select public.create_company('Still Works Co') as co2 \gset
reset role;
alter table public.platform_notifications drop constraint pn_test_broken;
select tests.check(exists (select 1 from public.companies where id = :'co2')
                   and not exists (select 1 from public.platform_notifications where ref_company = :'co2'),
  'a failing admin notice does not stop a company sign-up');

-- ---- 2. Daily summary -----------------------------------------------------
-- "Tomorrow" in Tanzania, so "yesterday" is today (the companies made above).
select ((now() at time zone 'Africa/Dar_es_Salaam')::date + 1) as tomorrow \gset
select tests.check(public.platform_daily_summary_at((:'tomorrow'::date + time '07:30') at time zone 'Africa/Dar_es_Salaam') is null,
  'daily summary: nothing before 08:00 Tanzania time');
select public.platform_daily_summary_at((:'tomorrow'::date + time '08:05') at time zone 'Africa/Dar_es_Salaam') as daily \gset
select tests.check((select kind = 'daily_summary' and body like 'Yesterday: _% new compan%, _% active, 1 feedback item.'
                      from public.platform_notifications where id = :'daily'),
  'daily summary: counts yesterday''s new companies, active companies and feedback');
select tests.check(public.platform_daily_summary_at((:'tomorrow'::date + time '09:00') at time zone 'Africa/Dar_es_Salaam') is null,
  'daily summary: once a day');
insert into public.platform_notifications (kind, title, created_at) values ('old', 'Very old', now() - interval '200 days');
select public.platform_daily_summary_at(now()) as ignored \gset
select tests.check(not exists (select 1 from public.platform_notifications where title = 'Very old'),
  'notices older than 180 days are removed');
select tests.blocked($$select public.run_platform_daily_summary('wrong secret')$$, 'the daily summary needs the outbox secret');

-- ---- 3. Who can see and change them ---------------------------------------
select tests.login('pboss@pn.test'); set role authenticated;
select tests.check((select count(*) from public.platform_notifications) = 0, 'company users see no admin notices');
select tests.check(public.platform_unread_count() = 0, 'company users: the admin bell count is always 0');
select tests.blocked($$select * from public.platform_notification_feed(10)$$, 'company users cannot list admin notices');
select tests.blocked($$select public.platform_notify('x', 'x', null, null, 'info', null, null)$$, 'users cannot create admin notices');
select tests.blocked($$insert into public.platform_notifications (kind, title) values ('x', 'x')$$, 'no direct inserts');
select tests.blocked($$select public.read_all_platform_notifications()$$, 'company users cannot mark admin notices read');
reset role;

select tests.login_aal('padmin@pn.test', 'aal1'); set role authenticated;
select tests.check((select count(*) from public.platform_notifications) = 0, 'admins without two-step see nothing');
select tests.blocked($$select * from public.platform_notification_feed(10)$$, 'admins without two-step cannot list');
reset role;

select tests.login_aal('padmin@pn.test', 'aal2'); set role authenticated;
select tests.check((select count(*) from public.platform_notifications) > 5, 'verified admins see the notices');
select count(*) as total from public.platform_notifications \gset
select tests.check(public.platform_unread_count() = :total, 'all unread at first');
select tests.check((select count(*) from public.platform_notification_feed(300) where read_at is null) = :total, 'the feed shows them unread');
select tests.check(public.open_platform_notification((select id from public.platform_notifications where dedupe_key = 'signup:' || :'co'))
                     = '/admin/companies/' || :'co',
  'opening a notice returns its link');
select tests.check(public.platform_unread_count() = :total - 1, 'and marks it read');
select tests.check(public.open_platform_notification(gen_random_uuid()) is null, 'an unknown notice opens nothing');
select tests.blocked($$update public.platform_notifications set title = 'x'$$, 'admins cannot change notices directly');
select tests.blocked($$insert into public.platform_notification_reads (user_id, notification_id)
                       select auth.uid(), id from public.platform_notifications limit 1$$, 'no direct read marks');
select tests.check(public.read_all_platform_notifications() = :total - 1, 'mark all read');
select tests.check(public.platform_unread_count() = 0, 'nothing unread after mark all read');
select tests.check(public.my_platform_notify_email() = false, 'email is off by default');
select public.set_platform_notify_email(true);
select tests.check(public.my_platform_notify_email() = true, 'an admin can switch "email me too" on');
insert into public.push_subscriptions (endpoint, p256dh, auth, app)
values ('https://fcm.googleapis.com/fcm/send/pn-admin', 'k1', 'a1', 'admin'),
       ('https://fcm.googleapis.com/fcm/send/pn-admin-company', 'k2', 'a2', 'company');
select tests.blocked($$insert into public.push_subscriptions (endpoint, p256dh, auth, app)
                       values ('https://fcm.googleapis.com/fcm/send/pn-x', 'k', 'a', 'other')$$, 'unknown app name refused');
reset role;
select tests.login('pboss@pn.test'); set role authenticated;
select tests.check((select count(*) from public.platform_notification_reads) = 0, 'company users see no read marks');
insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://fcm.googleapis.com/fcm/send/pn-boss', 'k3', 'a3');
reset role;
select tests.check((select app from public.push_subscriptions where endpoint like '%pn-boss') = 'company',
  'phones subscribe for the company app by default');

-- ---- 4. Push and email ----------------------------------------------------
select public.set_outbox_secret('platform-notifications-test-secret') as msg \gset
select tests.blocked($$select * from public.claim_platform_outbox('nope', 10)$$, 'the admin outbox needs the secret');
select public.platform_notify('test', 'Ping', 'Hello admins', '/admin', 'urgent', null, 'pn-test-ping') as ping \gset
create temp table claimed as select * from public.claim_platform_outbox('platform-notifications-test-secret', 500);
select tests.check((select count(*) from claimed where notification_id = :'ping') = 1
                   and (select user_id = :'admin' and want_email and email = 'padmin@pn.test' and severity = 'urgent'
                          from claimed where notification_id = :'ping'),
  'admin notices go to each platform admin, with their email choice');
select tests.check((select subscriptions = '[{"endpoint": "https://fcm.googleapis.com/fcm/send/pn-admin", "p256dh": "k1", "auth": "a1"}]'::jsonb
                      from claimed where notification_id = :'ping'),
  'only to phones subscribed in the admin app');
select tests.check(not exists (select 1 from claimed where user_id <> :'admin'), 'never to company users');
select tests.check(not exists (select 1 from public.claim_platform_outbox('platform-notifications-test-secret', 500)),
  'each notice is sent once');
insert into public.platform_notifications (kind, title, created_at) values ('late', 'Too late', now() - interval '3 days');
select tests.check(not exists (select 1 from public.claim_platform_outbox('platform-notifications-test-secret', 500)),
  'notices older than 2 days are not pushed any more');
select tests.check((select dispatched_at is not null from public.platform_notifications where title = 'Too late'),
  'they are marked as handled');

-- Company alerts never go to the admin app's phone subscription.
insert into public.memberships (company_id, user_id, role) values (:'co', :'admin', 'sales');
select public.notify(:'co', :'admin', 'test', 'attention', 'Company alert', null, '/', 'pn-company-alert');
create temp table claimed_co as select * from public.claim_outbox('platform-notifications-test-secret', 1000);
select tests.check((select subscriptions = '[{"endpoint": "https://fcm.googleapis.com/fcm/send/pn-admin-company", "p256dh": "k2", "auth": "a2"}]'::jsonb
                      from claimed_co where user_id = :'admin' and title = 'Company alert'),
  'company alerts go only to phones subscribed in the company app');
update public.push_subscriptions set app = 'both' where endpoint like '%pn-admin-company';
select public.platform_notify('test', 'Ping 2', null, '/admin', 'info', null, 'pn-test-ping-2') as ping2 \gset
select tests.check((select jsonb_array_length(subscriptions) = 2
                      from public.claim_platform_outbox('platform-notifications-test-secret', 500) where notification_id = :'ping2'),
  'a phone that shares one address for both apps gets both');
update public.platform_admins set notify_email = false where user_id = :'admin';
delete from public.push_subscriptions where user_id = :'admin';
select public.platform_notify('test', 'Ping 3', null, '/admin', 'info', null, 'pn-test-ping-3') as ping3 \gset
select tests.check(not exists (select 1 from public.claim_platform_outbox('platform-notifications-test-secret', 500)),
  'admins with no phone and no email get nothing (the notice stays in the app)');

-- ---- 5. Rules -------------------------------------------------------------
select tests.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('platform_notify', 'pn_company_insert', 'pn_company_level', 'pn_app_feedback', 'pn_account_deletion',
                       'pn_company_closure', 'pn_backup_overdue', 'pn_newdevice_burst', 'platform_daily_summary_at',
                       'run_platform_daily_summary', 'claim_platform_outbox', 'platform_notification_feed',
                       'platform_unread_count', 'open_platform_notification', 'read_all_platform_notifications',
                       'my_platform_notify_email', 'set_platform_notify_email')
     and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false))),
  'all new functions are security definer with an empty search path');
select tests.check(not has_function_privilege('authenticated', 'public.platform_notify(text, text, text, text, text, uuid, text)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.platform_notify(text, text, text, text, text, uuid, text)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.platform_daily_summary_at(timestamptz)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.platform_notification_feed(integer)', 'EXECUTE')
                   and has_function_privilege('authenticated', 'public.platform_notification_feed(integer)', 'EXECUTE')
                   and has_function_privilege('anon', 'public.claim_platform_outbox(text, integer)', 'EXECUTE')
                   and has_function_privilege('anon', 'public.run_platform_daily_summary(text)', 'EXECUTE'),
  'grants: only the database creates notices, admins read, the job needs the secret');
select tests.check((select relrowsecurity from pg_class where oid = 'public.platform_notifications'::regclass)
                   and (select relrowsecurity from pg_class where oid = 'public.platform_notification_reads'::regclass),
  'row-level security is on');
select tests.check((select skipped is null from public.backup_table_plan() where table_name = 'platform_notifications') is null,
  'admin notices are never part of a company backup');

-- ---------------------------------------------------------------------
-- Clean up so later test files see a normal database.
-- ---------------------------------------------------------------------
select count(public.delete_company_step(c, interval '1 hour')) from unnest(array[:'co', :'co2']::uuid[]) c \gset x_
delete from public.companies where id = :'demo';
delete from public.platform_notifications;
delete from public.security_events where user_id in (:'admin', :'boss', :'other');
delete from public.account_deletions where user_id = :'other';
delete from public.company_closures where company_id in (:'co', :'co2');
delete from public.platform_admins where user_id = :'admin';
delete from auth.users where email like '%@pn.test';
delete from public.app_secrets where name = 'outbox';
