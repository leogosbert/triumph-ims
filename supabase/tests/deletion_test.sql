-- Tests for deleting accounts and closing companies (account_deletions, company_closures).
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
-- Signed in 20 minutes ago (no fresh "confirm it is you").
create or replace function tests.login_stale(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'email', p_email, 'role', 'authenticated',
                      'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 1200)))::text, false);
end $$;
create or replace function tests.login_aal(p_email text, p_aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'email', p_email, 'role', 'authenticated', 'aal', p_aal,
                      'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text, false);
end $$;
create or replace function tests.login_guest(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'is_anonymous', true,
                      'amr', json_build_array(json_build_object('method', 'anonymous', 'timestamp', extract(epoch from now())::bigint)))::text, false);
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
create or replace function tests.blocked_with(p_sql text, p_message text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAILED (was allowed): %', p_label;
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  if sqlerrm not like p_message then
    raise exception 'FAILED (wrong error "%"): %', sqlerrm, p_label;
  end if;
  raise notice 'pass: % (blocked: %)', p_label, sqlerrm;
end $$;
create or replace function tests.needs_confirm(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAILED (was allowed): %', p_label;
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  if sqlstate <> '28000' then
    raise exception 'FAILED (wrong error % %): %', sqlstate, sqlerrm, p_label;
  end if;
  raise notice 'pass: % (asks to confirm)', p_label;
end $$;
-- Rows per table for one company: every table the backups know (company_id, or a parent's company).
create or replace function tests.company_counts(p_company uuid) returns jsonb language plpgsql as $$
declare
  p record;
  v_n bigint;
  v jsonb := '{}'::jsonb;
begin
  for p in select * from public.backup_table_plan() loop
    if p.parent_table is null then
      execute format('select count(*) from public.%I where company_id::text = $1', p.table_name) into v_n using p_company::text;
    elsif p.parent_table = 'companies' then
      execute format('select count(*) from public.%I where %I = $1', p.table_name, p.fk_column) into v_n using p_company;
    else
      execute format('select count(*) from public.%I x where x.%I in (select y.%I from public.%I y where y.company_id = $1)',
                     p.table_name, p.fk_column, p.parent_column, p.parent_table) into v_n using p_company;
    end if;
    v := v || jsonb_build_object(p.table_name, v_n);
  end loop;
  v := v || jsonb_build_object('companies', (select count(*) from public.companies where id = p_company));
  return v;
end $$;
grant execute on all functions in schema tests to authenticated, anon;

-- ---------------------------------------------------------------------
-- People and companies
-- ---------------------------------------------------------------------
insert into auth.users (email, raw_user_meta_data) values
  ('boss.del@d.test', '{"full_name": "Bora Boss"}'), ('mgr2.del@d.test', '{}'), ('sales.del@d.test', '{"full_name": "Sara Sales"}'),
  ('solo.del@d.test', '{}'), ('lone.del@d.test', '{}'), ('member.del@d.test', '{}'), ('admin.del@d.test', '{}'),
  ('owner.del@d.test', '{"full_name": "Owen Owner"}'), ('co2.del@d.test', '{}'), ('keeper.del@d.test', '{}'),
  ('stranger.del@d.test', '{}'), ('stuck.del@d.test', '{"full_name": "Stella Stuck"}');
select id as boss from auth.users where email = 'boss.del@d.test' \gset
select id as mgr2 from auth.users where email = 'mgr2.del@d.test' \gset
select id as sales from auth.users where email = 'sales.del@d.test' \gset
select id as solo from auth.users where email = 'solo.del@d.test' \gset
select id as lone from auth.users where email = 'lone.del@d.test' \gset
select id as member from auth.users where email = 'member.del@d.test' \gset
select id as admin from auth.users where email = 'admin.del@d.test' \gset
select id as owner from auth.users where email = 'owner.del@d.test' \gset
select id as co2 from auth.users where email = 'co2.del@d.test' \gset
select id as keeper from auth.users where email = 'keeper.del@d.test' \gset
select id as stuck from auth.users where email = 'stuck.del@d.test' \gset
select id as stranger from auth.users where email = 'stranger.del@d.test' \gset
insert into auth.users (is_anonymous) values (true) returning id as guest \gset
insert into public.platform_admins (user_id) values (:'admin');

select tests.login('boss.del@d.test'); set role authenticated;
select public.create_company('Del Co A') as co_a \gset
reset role;
insert into public.memberships (company_id, user_id, role) values (:'co_a', :'mgr2', 'management'), (:'co_a', :'sales', 'sales');
select id as m_sales from public.memberships where company_id = :'co_a' and user_id = :'sales' \gset
select id as m_mgr2 from public.memberships where company_id = :'co_a' and user_id = :'mgr2' \gset
select tests.login('solo.del@d.test'); set role authenticated;
select public.create_company('Del Solo Co') as co_solo \gset
reset role;
select tests.login('lone.del@d.test'); set role authenticated;
select public.create_company('Del Co B') as co_b \gset
reset role;
insert into public.memberships (company_id, user_id, role) values (:'co_b', :'member', 'sales'), (:'co_b', :'stuck', 'management');
select id as m_member from public.memberships where company_id = :'co_b' and user_id = :'member' \gset
insert into public.clients (company_id, name) values (:'co_a', 'Alpha Client');

-- =====================================================================
-- 1. Who may delete an account, and what blocks it
-- =====================================================================
select tests.check((select count(*) = 1 from pg_proc where proname = 'request_account_deletion'
                     and pg_get_function_identity_arguments(oid) = 'p_reason text, p_close_companies boolean'),
  'request_account_deletion takes no user: nobody can schedule another person''s deletion');
select tests.check(not has_column_privilege('authenticated', 'public.companies', 'closing_after', 'UPDATE')
                   and not has_column_privilege('authenticated', 'public.memberships', 'suspended_for_deletion_at', 'UPDATE')
                   and not has_column_privilege('authenticated', 'public.memberships', 'suspended_for_closure_at', 'UPDATE'),
  'users cannot change the closing date or the suspension marks');
set role anon;
select tests.blocked('select public.request_account_deletion()', 'anon: cannot request a deletion');
select tests.blocked('select public.cancel_account_deletion()', 'anon: cannot cancel a deletion');
select tests.blocked(format('select public.request_company_closure(%L)', :'co_a'), 'anon: cannot close a company');
select tests.blocked('select * from public.account_deletions', 'anon: cannot read deletions');
reset role;

select tests.login('sales.del@d.test'); set role authenticated;
select tests.blocked('select * from public.account_deletions', 'deletions table is not readable by users');
select tests.blocked('select * from public.company_closures', 'closures table is not readable by users');
select tests.blocked(format('insert into public.account_deletions (user_id, delete_after) values (%L, now())', :'boss'),
  'nobody can insert a deletion for someone else directly');
select tests.blocked(format('insert into public.company_closures (company_id, delete_after) values (%L, now())', :'co_a'),
  'nobody can insert a closure directly');
select tests.blocked('select public.delete_account_now(auth.uid())', 'the final step cannot be called by users');
select tests.blocked(format('select public.delete_company_step(%L)', :'co_a'), 'the company delete cannot be called by users');
select tests.blocked(format('select public.schedule_company_closure(%L, auth.uid(), null)', :'co_a'),
  'the internal closure helper cannot be called by users');
select tests.blocked('select public.run_due_deletions_at(now() + interval ''1 year'')', 'the internal run cannot be called by users');
select tests.check(public.my_account_deletion() is null, 'my_account_deletion: nothing scheduled yet');
reset role;

select tests.login_stale('sales.del@d.test'); set role authenticated;
select tests.needs_confirm('select public.request_account_deletion()', 'account deletion needs a recent sign-in');
reset role;
select tests.login_guest(:'guest'); set role authenticated;
select tests.blocked_with('select public.request_account_deletion()', 'Demo guests%', 'demo guests cannot delete an account');
reset role;
select tests.login('admin.del@d.test'); set role authenticated;
select tests.blocked_with('select public.request_account_deletion()', 'Platform admins%', 'platform admins are refused');
reset role;

select tests.login('lone.del@d.test'); set role authenticated;
-- Co B has a second manager (stuck) for now: lone is not blocked. Make stuck inactive first.
reset role;
update public.memberships set active = false where company_id = :'co_b' and user_id = :'stuck';
select tests.login('lone.del@d.test'); set role authenticated;
select tests.check((public.account_deletion_check() -> 'blockers') @> jsonb_build_array(jsonb_build_object('company_id', :'co_b', 'kind', 'sole_manager')),
  'check: the only manager of a company with other members is told');
select tests.blocked_with('select public.request_account_deletion()', 'You are the only manager of Del Co B.%',
  'only active manager with other active members: refused with the company name');
select tests.blocked_with('select public.request_account_deletion(null, true)', 'You are the only manager of Del Co B.%',
  'choosing to close companies does not get round the only-manager rule');
select tests.check(not exists (select 1 from public.memberships where user_id = auth.uid() and not active),
  'a refused request changes nothing');
reset role;
select tests.login('solo.del@d.test'); set role authenticated;
select tests.check((public.account_deletion_check() -> 'blockers') @> jsonb_build_array(jsonb_build_object('company_id', :'co_solo', 'kind', 'only_member')),
  'check: the only member of a company is told');
select tests.blocked_with('select public.request_account_deletion()', 'You are the only person in Del Solo Co.%',
  'only member: refused unless they choose to close the company');
reset role;

-- =====================================================================
-- 2. Schedule, grace period, keep my account (a sales person in Co A)
-- =====================================================================
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (:'sales', 'https://fcm.googleapis.com/del-sales', 'k', 'a');
insert into public.notification_settings (user_id) values (:'sales');
select tests.login('sales.del@d.test'); set role authenticated;
select tests.check(public.is_member(:'co_a'), 'before: sales is a member of Co A');
select public.request_account_deletion('Testing the flow') as sales_after \gset
select tests.check(:'sales_after'::timestamptz between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute',
  'request: deleted after 7 days');
select tests.check(not public.is_member(:'co_a') and not public.has_role(:'co_a', array['sales']::public.app_role[]),
  'request: is_member and has_role are false straight away');
select tests.check((public.my_account_deletion() ->> 'delete_after')::timestamptz = :'sales_after'::timestamptz,
  'my_account_deletion: shows the date (for the "scheduled for deletion" screen)');
select tests.check((select count(*) from public.clients) = 0 and (select count(*) from public.companies) = 0,
  'request: company data is no longer readable');
select tests.blocked_with('select public.request_account_deletion()', 'Your account is already scheduled%', 'a second request is refused');
select tests.blocked_with('select public.create_company(''Sneaky Co'')', 'This account is scheduled for deletion%',
  'during the grace period no new company can be created');
reset role;
select tests.check((select not active and suspended_for_deletion_at is not null from public.memberships where id = :'m_sales'),
  'request: the membership is suspended (marked, can be undone)');
select tests.check(not exists (select 1 from public.push_subscriptions where user_id = :'sales'), 'request: phone push subscriptions removed');
select tests.check((select status = 'scheduled' and name_hint = 'S' and reason = 'Testing the flow' from public.account_deletions where user_id = :'sales'),
  'request: row scheduled with only the first letter of the name');
select tests.check((select email = 'sales.del@d.test' and subject = 'Your LeMoSp account will be deleted' and sent_at is null
                           and body like 'Your LeMoSp account will be deleted on % Changed your mind? Sign in before then and choose Keep my account.'
                      from public.account_emails where user_id = :'sales'),
  'request: the warning email is queued (no company needed)');
-- A manager cannot switch them back on, and an invitation cannot either.
select tests.login('boss.del@d.test'); set role authenticated;
select public.update_membership(:'m_sales', 'sales', true);
reset role;
select tests.check((select not active from public.memberships where id = :'m_sales'), 'a manager cannot switch a suspended member back on');
select tests.login('lone.del@d.test'); set role authenticated;
select public.invite_member(:'co_b', 'sales.del@d.test', 'finance') as inv_sales \gset
reset role;
select tests.login('sales.del@d.test'); set role authenticated;
select tests.blocked_with(format('select public.accept_invitation(%L)', :'inv_sales'), 'This account is scheduled for deletion%',
  'during the grace period an invitation cannot be accepted');
select public.cancel_account_deletion();
select tests.check(public.is_member(:'co_a') and public.my_account_deletion() is null, 'keep my account: access is back');
select tests.blocked_with('select public.cancel_account_deletion()', 'Your account is not scheduled%', 'nothing left to cancel');
reset role;
select tests.check((select active and suspended_for_deletion_at is null from public.memberships where id = :'m_sales'),
  'keep my account: membership restored');
select tests.check((select status = 'cancelled' and cancelled_at is not null and reason is null from public.account_deletions where user_id = :'sales'),
  'keep my account: row marked cancelled, reason removed');

-- A member the manager switches off during the waiting time stays off after "Keep my account".
select tests.login('sales.del@d.test'); set role authenticated;
select public.request_account_deletion() as x \gset
reset role;
select tests.login('boss.del@d.test'); set role authenticated;
select public.update_membership(:'m_sales', 'sales', false);
reset role;
select tests.check((select not active and suspended_for_deletion_at is null from public.memberships where id = :'m_sales'),
  'switching a suspended member off removes the mark');
select tests.login('sales.del@d.test'); set role authenticated;
select public.cancel_account_deletion();
reset role;
select tests.check((select not active from public.memberships where id = :'m_sales'),
  'keep my account: a member the manager switched off meanwhile stays off');
update public.memberships set active = true where id = :'m_sales';
delete from public.account_deletions where user_id = :'sales';

-- People who use two-step verification must have passed it in this session.
insert into auth.mfa_factors (user_id) values (:'sales');
select tests.login_aal('sales.del@d.test', 'aal1'); set role authenticated;
select tests.check((public.account_deletion_check() ->> 'two_step_needed')::boolean, 'check: says a two-step code is needed');
select tests.blocked_with('select public.request_account_deletion()', 'Please sign in with your two-step verification code first.',
  'two-step users: refused without a two-step session');
reset role;
select tests.check(not exists (select 1 from public.account_deletions where user_id = :'sales'), 'two-step refusal changes nothing');
delete from auth.mfa_factors where user_id = :'sales';
-- Email outbox for these emails: secret only, marks them sent.
select tests.blocked('select * from public.claim_account_emails(''wrong'')', 'account emails: wrong secret refused');
select tests.login('sales.del@d.test'); set role authenticated;
select tests.blocked('select * from public.account_emails', 'account emails: the table is not readable');
reset role;

-- Rate limit: 5 requests a day.
select tests.login('sales.del@d.test'); set role authenticated;
select public.request_account_deletion() as x \gset
select public.cancel_account_deletion();
select public.request_account_deletion() as x \gset
select public.cancel_account_deletion();
select public.request_account_deletion() as x \gset
select public.cancel_account_deletion();
select public.request_account_deletion() as x \gset
select public.cancel_account_deletion();
select public.request_account_deletion() as x \gset
select public.cancel_account_deletion();
select tests.blocked_with('select public.request_account_deletion()', 'You have done this many times today%', 'at most 5 requests a day');
reset role;
select tests.check((select active from public.memberships where id = :'m_sales'), 'after the cycles: still a member');

-- A membership a manager had switched off stays off after "Keep my account".
select tests.login('lone.del@d.test'); set role authenticated;
select public.update_membership(:'m_member', 'sales', false);
reset role;
select tests.login('member.del@d.test'); set role authenticated;
select tests.check(jsonb_array_length(public.account_deletion_check() -> 'blockers') = 0, 'an inactive member has no blockers');
select public.request_account_deletion() as x \gset
select public.cancel_account_deletion();
reset role;
select tests.check((select not active and suspended_for_deletion_at is null from public.memberships where id = :'m_member'),
  'keep my account does not switch on a membership a manager had switched off');
update public.memberships set active = true where id = :'m_member';
update public.memberships set active = true where company_id = :'co_b' and user_id = :'stuck';

-- =====================================================================
-- 3. The only member: close the company in the same step
-- =====================================================================
-- If that company requires two-step and this session has not passed it, the company cannot be closed.
update public.companies set require_mfa = true where id = :'co_solo';
select tests.login_aal('solo.del@d.test', 'aal1'); set role authenticated;
select tests.blocked_with('select public.request_account_deletion(null, true)', 'To close Del Solo Co, sign in with two-step verification first.',
  'closing a company in the same step follows its two-step policy');
reset role;
update public.companies set require_mfa = false where id = :'co_solo';
select tests.login('solo.del@d.test'); set role authenticated;
select public.request_account_deletion(null, true) as solo_after \gset
reset role;
select tests.check((select status = 'scheduled' and requested_by = :'solo'
                           and account_deletion_id = (select id from public.account_deletions where user_id = :'solo' and status = 'scheduled')
                           and delete_after between now() + interval '30 days' - interval '1 minute' and now() + interval '30 days' + interval '1 minute'
                      from public.company_closures where company_id = :'co_solo'),
  'close in the same step: the company is scheduled to close after 30 days, linked to the account deletion');
select tests.check((select closing_after is not null from public.companies where id = :'co_solo'), 'the company shows its closing date');
select tests.login('solo.del@d.test'); set role authenticated;
select public.cancel_account_deletion();
reset role;
select tests.check((select closing_after is null from public.companies where id = :'co_solo')
                   and (select status = 'cancelled' from public.company_closures where company_id = :'co_solo')
                   and (select active from public.memberships where company_id = :'co_solo' and user_id = :'solo'),
  'keep my account also cancels the closure made in the same step');

-- =====================================================================
-- 4. Closing a company
-- =====================================================================
select tests.login('sales.del@d.test'); set role authenticated;
select tests.blocked_with(format('select public.request_company_closure(%L)', :'co_a'), 'Only management can close%', 'non-managers cannot close a company');
reset role;
select tests.login('stranger.del@d.test'); set role authenticated;
select tests.blocked_with(format('select public.request_company_closure(%L)', :'co_a'), 'Only management can close%', 'outsiders cannot close a company');
select tests.blocked(format('select public.cancel_company_closure(%L)', :'co_a'), 'outsiders cannot cancel a closure');
reset role;
select tests.login('lone.del@d.test'); set role authenticated;
select tests.blocked_with(format('select public.request_company_closure(%L)', :'co_a'), 'Only management can close%',
  'a manager of another company cannot close this one');
reset role;
select tests.login_stale('boss.del@d.test'); set role authenticated;
select tests.needs_confirm(format('select public.request_company_closure(%L)', :'co_a'), 'closing needs a recent sign-in');
reset role;
select tests.login_guest(:'guest'); set role authenticated;
select public.create_demo_company('small') as demo \gset
select tests.blocked_with(format('select public.request_company_closure(%L)', :'demo'), 'Demo companies delete themselves%',
  'demo companies cannot be closed this way');
select public.end_demo();
reset role;

select tests.login('boss.del@d.test'); set role authenticated;
select public.request_company_closure(:'co_a') as a_after \gset
select tests.check(:'a_after'::timestamptz between now() + interval '30 days' - interval '1 minute' and now() + interval '30 days' + interval '1 minute',
  'closure: data is deleted after 30 days');
select tests.check(public.is_manager(:'co_a') and (select count(*) from public.clients where company_id = :'co_a') = 1,
  'closure: managers keep access (for the final backup)');
select tests.blocked_with(format('select public.request_company_closure(%L)', :'co_a'), 'This company is already scheduled%', 'cannot close twice');
reset role;
select tests.login('sales.del@d.test'); set role authenticated;
select tests.check(not public.is_member(:'co_a') and (select count(*) from public.clients where company_id = :'co_a') = 0,
  'closure: members who are not management lose access straight away');
reset role;
select tests.check((select not active and suspended_for_closure_at is not null from public.memberships where id = :'m_sales')
                   and (select active from public.memberships where id = :'m_mgr2'),
  'closure: non-managers suspended (marked), managers stay');
select tests.check((select count(distinct user_id) = 3 from public.notifications where company_id = :'co_a' and kind = 'company_closure' and severity = 'critical'),
  'closure: every member is told (managers and staff)');
select tests.check(exists (select 1 from public.audit_log where company_id = :'co_a' and action = 'close_requested'),
  'closure: written to the Activity log');
-- Nothing can switch a suspended member back on during the closure.
select tests.login('boss.del@d.test'); set role authenticated;
select public.update_membership(:'m_sales', 'sales', true);
select public.invite_member(:'co_a', 'stranger.del@d.test', 'sales') as inv_str \gset
reset role;
select tests.check((select not active from public.memberships where id = :'m_sales'), 'closure: suspended members cannot be switched back on');
select tests.login('stranger.del@d.test'); set role authenticated;
select public.accept_invitation(:'inv_str') as x \gset
select tests.check(not public.is_member(:'co_a'), 'closure: someone joining now gets no access');
reset role;
-- Sales also asks for their account to be deleted while the company is closing.
-- (reset today's request count for this step)
delete from public.account_deletions where user_id = :'sales';
select tests.login('sales.del@d.test'); set role authenticated;
select public.request_account_deletion() as x \gset
reset role;
select tests.login('boss.del@d.test'); set role authenticated;
select public.cancel_company_closure(:'co_a');
select tests.check(public.is_manager(:'co_a'), 'cancel closure: the manager carries on');
reset role;
select tests.check((select closing_after is null from public.companies where id = :'co_a')
                   and (select status = 'cancelled' from public.company_closures where company_id = :'co_a'),
  'cancel closure: closing date removed, row cancelled');
select tests.check((select active from public.memberships where company_id = :'co_a' and user_id = :'stranger'),
  'cancel closure: suspended members are back');
select tests.check((select not active and suspended_for_closure_at is null and suspended_for_deletion_at is not null
                      from public.memberships where id = :'m_sales'),
  'cancel closure: a member whose own account is being deleted stays suspended');
select tests.login('sales.del@d.test'); set role authenticated;
select public.cancel_account_deletion();
select tests.check(public.is_member(:'co_a'), 'then keep my account: back in');
reset role;
select tests.check(exists (select 1 from public.audit_log where company_id = :'co_a' and action = 'close_cancelled')
                   and exists (select 1 from public.notifications where company_id = :'co_a' and title like 'Closure cancelled%'),
  'cancel closure: logged and members told');
-- A member the manager switches off during a closure stays off after the closure is cancelled.
select tests.login('boss.del@d.test'); set role authenticated;
select public.request_company_closure(:'co_a') as x \gset
select public.update_membership((select id from public.memberships where company_id = :'co_a' and user_id = :'stranger'), 'sales', false);
select public.cancel_company_closure(:'co_a');
reset role;
select tests.check((select not active and suspended_for_closure_at is null from public.memberships where company_id = :'co_a' and user_id = :'stranger'),
  'cancel closure: a member the manager switched off meanwhile stays off');
update public.memberships set active = true where company_id = :'co_a' and user_id = :'stranger';
-- Too late: once the date has come, the closure (and a deletion) can no longer be cancelled.
select tests.login('boss.del@d.test'); set role authenticated;
select public.request_company_closure(:'co_a') as x \gset
reset role;
update public.company_closures set delete_after = now() - interval '1 minute' where company_id = :'co_a' and status = 'scheduled';
select tests.login('boss.del@d.test'); set role authenticated;
select tests.blocked_with(format('select public.cancel_company_closure(%L)', :'co_a'), 'It is too late to cancel%',
  'a closure cannot be cancelled once its date has come');
reset role;
update public.company_closures set delete_after = now() + interval '30 days' where company_id = :'co_a' and status = 'scheduled';
select tests.login('boss.del@d.test'); set role authenticated;
select public.cancel_company_closure(:'co_a');
reset role;
delete from public.company_closures where company_id = :'co_a';
select tests.login('mgr2.del@d.test'); set role authenticated;
select tests.blocked_with(format('select public.cancel_company_closure(%L)', :'co_a'), 'This company is not scheduled%', 'nothing to cancel');
-- Rate limit: 5 a day per company (the earlier rows were cleared above).
select public.request_company_closure(:'co_a') as x \gset
select public.cancel_company_closure(:'co_a');
select public.request_company_closure(:'co_a') as x \gset
select public.cancel_company_closure(:'co_a');
select public.request_company_closure(:'co_a') as x \gset
select public.cancel_company_closure(:'co_a');
select public.request_company_closure(:'co_a') as x \gset
select public.cancel_company_closure(:'co_a');
select public.request_company_closure(:'co_a') as x \gset
select public.cancel_company_closure(:'co_a');
select tests.blocked_with(format('select public.request_company_closure(%L)', :'co_a'), 'You have done this many times today%',
  'at most 5 closure requests a day');
reset role;
select tests.check((select bool_and(active) from public.memberships where company_id = :'co_a'), 'after the cycles: everyone active again');

-- =====================================================================
-- 5. The final step for an account (a busy person in a real company)
-- =====================================================================
-- Two full companies: the enterprise demo data turned into real companies.
select tests.login('owner.del@d.test'); set role authenticated;
select public.create_demo_company('enterprise') as rich \gset
reset role;
select tests.login('keeper.del@d.test'); set role authenticated;
select public.create_demo_company('enterprise') as keep \gset
reset role;
update public.companies set is_demo = false, demo_expires_at = null, name = 'Rich Real Co' where id = :'rich';
update public.companies set is_demo = false, demo_expires_at = null, name = 'Keep Real Co' where id = :'keep';
insert into public.memberships (company_id, user_id, role) values (:'rich', :'co2', 'management');
insert into public.invitations (company_id, email, role, invited_by, accepted_by, accepted_at)
values (:'rich', 'owner.del@d.test', 'management', :'co2', :'owner', now());
insert into public.invitations (company_id, email, role, invited_by) values (:'co_a', 'owner.del@d.test', 'sales', :'boss');
insert into public.known_devices (user_id, device_key, device) values (:'owner', repeat('a', 64), 'Chrome on Android');
insert into public.security_events (user_id, company_id, kind) values (:'owner', :'rich', 'sign_in');
insert into public.notification_settings (user_id) values (:'owner');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (:'owner', 'https://fcm.googleapis.com/del-owner', 'k', 'a');
insert into auth.mfa_factors (user_id) values (:'owner');
select tests.check((select count(*) from public.invoices where company_id = :'rich' and created_by = :'owner') > 0
                   and (select count(*) from public.quotations where company_id = :'rich' and created_by = :'owner') > 0
                   and (select count(*) from public.payments where company_id = :'rich') > 0,
  'setup: a real company full of records made by the person');
select tests.company_counts(:'rich') as rich_before \gset
select tests.company_counts(:'keep') as keep_before \gset
select (select count(*) from public.notifications where user_id = :'owner') as owner_notes \gset

select tests.login_aal('owner.del@d.test', 'aal2'); set role authenticated;
select tests.check(jsonb_array_length(public.account_deletion_check() -> 'blockers') = 0, 'with a second manager there is nothing in the way');
select public.request_account_deletion('Moving on') as owner_after \gset
reset role;
select tests.check(public.run_due_deletions_at(now()) = 0, 'final step: nothing happens before the date');

-- The scheduled job's calls need the secret.
select tests.blocked('select public.claim_due_deletion(''wrong'')', 'job: wrong secret refused (claim)');
select tests.blocked('select public.claim_due_deletion(null)', 'job: no secret refused (claim)');
select tests.blocked(format('select public.finish_deletion(%L, %L, %L)', 'wrong', 'account', gen_random_uuid()), 'job: wrong secret refused (finish)');
select public.set_outbox_secret('a-test-secret-that-is-long-enough') as msg \gset
set role anon;
select tests.check(public.claim_due_deletion('a-test-secret-that-is-long-enough') is null, 'job: with the secret, nothing is due yet');
select count(*) as sent_n from public.claim_account_emails('a-test-secret-that-is-long-enough') e where e.email = 'owner.del@d.test' \gset
reset role;
select tests.check(:sent_n = 1 and (select sent_at is not null from public.account_emails where user_id = :'owner'),
  'account emails: the job collects the email with the secret and marks it sent');

-- A failure is recorded and retried later (nothing half-done).
create or replace function tests.boom() returns trigger language plpgsql as $$
begin
  raise exception 'boom for the test';
end $$;
create trigger zz_del_boom before update on public.profiles for each row execute function tests.boom();
select public.claim_due_deletion_at(now() + interval '8 days') as job \gset
select tests.check((:'job'::jsonb ->> 'kind') = 'account', 'job: the due account is claimed');
select tests.check(public.finish_deletion_at(:'job'::jsonb ->> 'kind', (:'job'::jsonb ->> 'id')::uuid, now() + interval '8 days') = false,
  'job: a failing deletion returns false');
select tests.check((select status = 'scheduled' and last_error like '%boom for the test%' from public.account_deletions where user_id = :'owner')
                   and exists (select 1 from auth.users where id = :'owner')
                   and exists (select 1 from public.known_devices where user_id = :'owner'),
  'job: the error is kept and nothing was half deleted');
select tests.check(public.claim_due_deletion_at(now() + interval '8 days') is null, 'job: not retried within the hour');
drop trigger zz_del_boom on public.profiles;

-- Supabase's auth.users has banned_until (the test stub does not): added here for this check.
alter table auth.users add column if not exists banned_until timestamptz;
select tests.check(public.run_due_deletions_at(now() + interval '8 days' + interval '2 hours') = 1, 'final step: the account is deleted when due');
select tests.check((select banned_until between now() + interval '99 years' and now() + interval '101 years' from auth.users where id = :'owner'),
  'final step: the sign-in account is blocked for 100 years (a date the sign-in service understands)');
alter table auth.users drop column banned_until;
select tests.check((select email = 'deleted-' || id::text || '@deleted.invalid' and raw_user_meta_data = '{}'::jsonb
                      from auth.users where id = :'owner')
                   and not exists (select 1 from public.account_emails where user_id = :'owner')
                   and not exists (select 1 from auth.users where email = 'owner.del@d.test')
                   and not exists (select 1 from auth.mfa_factors where user_id = :'owner')
                   and (select full_name = 'Deleted user' and email is null and phone is null from public.profiles where id = :'owner'),
  'final step: the sign-in account is anonymised, the authenticator removed, the profile is "Deleted user"');
select tests.check(not exists (select 1 from public.memberships where user_id = :'owner')
                   and not exists (select 1 from public.known_devices where user_id = :'owner')
                   and not exists (select 1 from public.security_events where user_id = :'owner')
                   and not exists (select 1 from public.notifications where user_id = :'owner')
                   and not exists (select 1 from public.notification_settings where user_id = :'owner')
                   and not exists (select 1 from public.push_subscriptions where user_id = :'owner'),
  'final step: memberships, devices, sign-in history, notifications and settings are gone');
select tests.check((select status = 'done' and done_at is not null and reason is null and last_error is null
                      from public.account_deletions where user_id = :'owner'),
  'final step: row marked done, reason removed');
select tests.company_counts(:'rich') as rich_after \gset
select tests.check((select bool_and(case k when 'memberships' then (:'rich_after'::jsonb ->> k)::int = (:'rich_before'::jsonb ->> k)::int - 1
                                           when 'audit_log' then (:'rich_after'::jsonb ->> k)::int = (:'rich_before'::jsonb ->> k)::int + 2
                                           when 'notifications' then (:'rich_after'::jsonb ->> k)::int = (:'rich_before'::jsonb ->> k)::int - :owner_notes
                                           when 'security_events' then (:'rich_after'::jsonb ->> k)::int = (:'rich_before'::jsonb ->> k)::int - 1
                                           else (:'rich_after'::jsonb ->> k) = (:'rich_before'::jsonb ->> k) end)
                      from jsonb_object_keys(:'rich_before'::jsonb) k),
  'final step: every business record of the company survives (only their membership, alerts and sign-ins go)');
select tests.check((select count(*) from public.invoices where company_id = :'rich' and created_by = :'owner') > 0
                   and (select count(*) from public.deliveries where company_id = :'rich' and driver_id = :'owner') > 0,
  'final step: their records are unchanged and now point at "Deleted user"');
select tests.check((select count(*) = 1 from public.audit_log where company_id = :'rich' and action = 'account_deleted' and actor_id is null
                       and details::text not like '%owner%' and details::text not like '%Owen%'),
  'final step: one "account deleted" line in the Activity log, without personal details');
select tests.check(not exists (select 1 from public.audit_log where details::text like '%owner.del@d.test%')
                   and not exists (select 1 from public.invitations where email = 'owner.del@d.test')
                   and (select revoked_at is not null from public.invitations where company_id = :'co_a' and email like 'deleted-%'),
  'final step: their email is removed from invitations and the Activity log; open invitations revoked');
select tests.check(not exists (select 1 from public.audit_log where company_id = :'rich' and action = 'update' and details ? 'created_by'),
  'final step: no flood of "created by" changes in the Activity log');
select tests.check(tests.company_counts(:'keep') = :'keep_before'::jsonb, 'final step: another company is untouched');
select tests.login('co2.del@d.test'); set role authenticated;
select tests.check(public.is_manager(:'rich') and (select count(*) from public.invoices where company_id = :'rich') > 0,
  'final step: the other manager keeps working with all the records');
reset role;
select tests.check(public.finish_deletion_at('account', (select id from public.account_deletions where user_id = :'owner'), now() + interval '9 days') = false,
  'final step: a finished deletion is not run again');

-- Supabase's other sign-in tables (not in the test stub): cleaned when they exist.
create table auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid);
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid);
create table auth.refresh_tokens (id bigserial primary key, user_id varchar(255));
create table auth.audit_log_entries (id uuid primary key default gen_random_uuid(), payload json);
insert into auth.identities (user_id) values (:'stuck'), (:'boss');
insert into auth.sessions (user_id) values (:'stuck'), (:'boss');
insert into auth.refresh_tokens (user_id) values (:'stuck'), (:'boss');
insert into auth.audit_log_entries (payload) values (json_build_object('actor_id', :'stuck', 'actor_username', 'stuck.del@d.test')),
                                                    (json_build_object('actor_id', :'boss', 'actor_username', 'boss.del@d.test'));
insert into auth.mfa_factors (user_id) values (:'stuck');
select tests.login_aal('stuck.del@d.test', 'aal2'); set role authenticated;
select public.request_account_deletion() as x \gset
reset role;
select tests.check(public.run_due_deletions_at(now() + interval '8 days') = 1, 'sign-in tables: the deletion completes');
select tests.check(not exists (select 1 from auth.identities where user_id = :'stuck')
                   and not exists (select 1 from auth.sessions where user_id = :'stuck')
                   and not exists (select 1 from auth.refresh_tokens where user_id = :'stuck')
                   and not exists (select 1 from auth.audit_log_entries where payload::text like '%stuck%')
                   and not exists (select 1 from auth.mfa_factors where user_id = :'stuck'),
  'sign-in tables: their sign-in methods, sessions, codes and sign-in log are removed');
select tests.check((select count(*) from auth.identities) = 1 and (select count(*) from auth.sessions) = 1
                   and (select count(*) from auth.refresh_tokens) = 1 and (select count(*) from auth.audit_log_entries) = 1,
  'sign-in tables: other people''s rows stay');
drop table auth.identities, auth.sessions, auth.refresh_tokens, auth.audit_log_entries;

-- =====================================================================
-- 6. The final step for a company (irreversible): only that company goes
-- =====================================================================
insert into storage.objects (bucket_id, name) values ('branding', :'rich' || '/logo.png'), ('pod', :'rich' || '/x/sig.png'),
                                                     ('branding', :'keep' || '/logo.png');
select public.take_company_backup(:'rich', 'manual', :'co2') as rich_backup \gset
select public.take_company_backup(:'keep', 'manual', :'keeper') as keep_backup \gset
-- A table that points at clients without cascading: the deletion must wait for it, then carry on.
create table public.zz_del_ref (id serial primary key, company_id uuid, client_id uuid references public.clients (id));
insert into public.zz_del_ref (company_id, client_id)
select company_id, id from public.clients where company_id in (:'rich', :'keep');
insert into public.security_events (user_id, company_id, kind) values (:'co2', :'rich', 'sign_in');
select tests.company_counts(:'keep') as keep_before \gset
select (select count(*) from auth.users) as users_before, (select count(*) from public.profiles) as profiles_before \gset
select tests.login('co2.del@d.test'); set role authenticated;
select tests.check((public.account_deletion_check() -> 'blockers') @> jsonb_build_array(jsonb_build_object('kind', 'only_member')),
  'now co2 is the only member of Rich Real Co');
select public.request_company_closure(:'rich') as x \gset
reset role;
select tests.check(public.run_due_deletions_at(now() + interval '29 days') = 0, 'company: nothing happens before 30 days');
select tests.company_counts(:'rich') as rich_pre \gset
select public.claim_due_deletion_at(now() + interval '31 days') as job \gset
select tests.check(:'job'::jsonb ->> 'kind' = 'company', 'company: the due closure is claimed');
select public.finish_deletion_at('company', (:'job'::jsonb ->> 'id')::uuid, now() + interval '31 days', interval '0 seconds') as step1 \gset
select tests.check(not :'step1'::boolean
                   and not exists (select 1 from public.memberships where company_id = :'rich' and active)
                   and exists (select 1 from public.companies where id = :'rich')
                   and (select sum(v::int) from jsonb_each_text(tests.company_counts(:'rich')) t(k, v))
                       < (select sum(v::int) from jsonb_each_text(:'rich_pre'::jsonb) t(k, v)),
  'company: a big company is deleted a slice at a time (each call keeps its progress); from the first step nobody, management included, has access');
select tests.check((select status = 'scheduled' and last_attempt_at is null and last_error is null from public.company_closures where company_id = :'rich'),
  'company: it can be picked up again straight away by the next call');
select tests.check(public.run_due_deletions_at(now() + interval '31 days') = 1, 'company: deleted when due');
select tests.check(not exists (select 1 from public.companies where id = :'rich'), 'company: the company row is gone');
select tests.check((select bool_and((v)::int = 0) from jsonb_each_text(tests.company_counts(:'rich')) t(k, v) where k <> 'company_closures'),
  'company: no rows left in any table for that company');
select tests.check(not exists (select 1 from public.company_backups where id = :'rich_backup')
                   and not exists (select 1 from public.company_backup_data where backup_id = :'rich_backup'),
  'company: its backups are deleted');
select tests.check(not exists (select 1 from storage.objects where name like :'rich' || '/%')
                   and exists (select 1 from storage.objects where name = :'keep' || '/logo.png')
                   and (select count(*) = 3 and bool_and(done_at is not null) from public.storage_cleanup where company_ref = :'rich'),  -- logo, delivery photos, receipts
  'company: its files are deleted (here directly), other companies'' files stay; the folders are marked done');
select tests.check((select status = 'done' and company_name is null and requested_by is null and company_id = :'rich'
                      from public.company_closures where company_id = :'rich'),
  'company: only an anonymous closure row is kept (no name)');
select tests.check(tests.company_counts(:'keep') = :'keep_before'::jsonb
                   and exists (select 1 from public.company_backup_data where backup_id = :'keep_backup'),
  'company: every table of another company is untouched (row by row count)');
select tests.check((select count(*) from auth.users) = :users_before and (select count(*) from public.profiles) = :profiles_before
                   and exists (select 1 from auth.users where id = :'co2')
                   and exists (select 1 from public.security_events where user_id = :'co2' and company_id is null),
  'company: people keep their accounts and their own sign-in history');
drop table public.zz_del_ref;
select tests.check(not exists (select 1 from public.memberships where user_id = :'co2'),
  'company: a person whose only company closed has no company (sees "create or join")');

-- ---------------------------------------------------------------------
-- Newer Supabase refuses deleting files from SQL: a platform admin removes them.
-- ---------------------------------------------------------------------
insert into auth.users (email) values ('files.del@d.test');
select id as files_user from auth.users where email = 'files.del@d.test' \gset
select tests.login('files.del@d.test'); set role authenticated;
select public.create_company('Del Files Co') as files_co \gset
reset role;
insert into storage.objects (bucket_id, name) values ('branding', :'files_co' || '/logo.png'),
  ('pod', :'files_co' || '/d1/sig.png'), ('pod', :'files_co' || '/d1/photo.jpg'), ('receipts', :'files_co' || '/e1/receipt.jpg');
-- Like Supabase's own protection: only the storage service (requests as a signed-in user) may delete.
create or replace function tests.protect_storage() returns trigger language plpgsql as $$
begin
  if current_user <> 'authenticated' then raise exception 'Direct deletion from storage tables is not allowed'; end if;
  return old;
end $$;
create trigger zz_protect before delete on storage.objects for each row execute function tests.protect_storage();
select tests.login('files.del@d.test'); set role authenticated;
select public.request_company_closure(:'files_co') as x \gset
reset role;
select public.run_due_deletions_at(now() + interval '31 days') as files_run \gset
select tests.check(:files_run = 1 and not exists (select 1 from public.companies where id = :'files_co'),
  'files: the company is deleted even when storage refuses');
select tests.check((select count(*) = 3 and bool_and(done_at is null) from public.storage_cleanup where company_ref = :'files_co')
                   and (select count(*) from storage.objects where name like :'files_co' || '/%') = 4,
  'files: the folders are listed as still to remove (not claimed done)');
select id as sc_pod from public.storage_cleanup where company_ref = :'files_co' and bucket = 'pod' \gset
select tests.login('boss.del@d.test'); set role authenticated;
select tests.check((select count(*) from storage.objects where name like :'files_co' || '/%') = 0, 'files: other users cannot see them');
select tests.blocked('select * from public.platform_storage_cleanup()', 'files: other users cannot list the folders');
select tests.blocked(format('select public.mark_storage_cleanup_done(%L)', :'sc_pod'),
  'files: other users cannot mark a folder done');
reset role;
select tests.login_aal('admin.del@d.test', 'aal1'); set role authenticated;
select tests.check((select count(*) from storage.objects where name like :'files_co' || '/%') = 0,
  'files: a platform admin without two-step cannot see them');
reset role;
select tests.login_aal('admin.del@d.test', 'aal2'); set role authenticated;
select tests.check((select count(*) from public.platform_storage_cleanup()) = 3
                   and (public.platform_deletions() #>> '{counts,file_folders_left}')::int = 3,
  'files: the admin sees "Files to remove: 3 folders"');
select tests.check((select count(*) from storage.objects where name like :'files_co' || '/%') = 4
                   and (select count(*) from storage.objects where name like :'keep' || '/%') = 0,
  'files: the admin can list only the files of folders waiting to be removed');
delete from storage.objects where name = :'keep' || '/logo.png';
select tests.blocked_with(format('select public.mark_storage_cleanup_done(%L)', :'sc_pod'),
  'Some files are still there%', 'files: a folder is only marked done when it is empty');
delete from storage.objects where name like :'files_co' || '/%';
select tests.check(public.mark_storage_cleanup_done(s.id), 'files: folder marked done after removing its files') from public.platform_storage_cleanup() s;
reset role;
select tests.check(exists (select 1 from storage.objects where name = :'keep' || '/logo.png')
                   and not exists (select 1 from storage.objects where name like :'files_co' || '/%')
                   and not exists (select 1 from public.storage_cleanup where done_at is null),
  'files: the admin removed only that company''s files; another company''s logo stays');
insert into storage.objects (bucket_id, name) values ('pod', :'files_co' || '/late.png');
select tests.login_aal('admin.del@d.test', 'aal2'); set role authenticated;
select tests.check((select count(*) from storage.objects where name like :'files_co' || '/%') = 0,
  'files: once a folder is done the admin has no access to it any more');
reset role;
drop trigger zz_protect on storage.objects;
delete from storage.objects where name like :'files_co' || '/%';
drop function tests.protect_storage();

-- An email address with a quote in it is still removed from the Activity log.
insert into auth.users (email) values ('o"dd.del@d.test');
select id as odd from auth.users where email = 'o"dd.del@d.test' \gset
insert into public.invitations (company_id, email, role, invited_by) values (:'co_a', 'o"dd.del@d.test', 'sales', :'boss');
select tests.check(exists (select 1 from public.audit_log where details::text like '%o\\"dd.del@d.test%'), 'odd email: written (escaped) in the log');
select tests.login('o"dd.del@d.test'); set role authenticated;
select public.request_account_deletion() as x \gset
reset role;
select public.run_due_deletions_at(now() + interval '8 days') as odd_run \gset
select tests.check(:odd_run = 1
                   and not exists (select 1 from public.audit_log where details::text like '%dd.del@d.test%'),
  'odd email: removed from the Activity log too, and the deletion finishes');

-- Housekeeping: cancelled requests are forgotten after 90 days.
insert into public.account_deletions (user_id, delete_after, status, requested_at, cancelled_at)
values (gen_random_uuid(), now() - interval '93 days', 'cancelled', now() - interval '100 days', now() - interval '99 days');
insert into public.company_closures (company_id, company_name, delete_after, status, requested_at, cancelled_at)
values (gen_random_uuid(), 'Old Cancelled Co', now() - interval '70 days', 'cancelled', now() - interval '100 days', now() - interval '99 days');
select public.claim_due_deletion_at(now()) as x \gset
select tests.check(not exists (select 1 from public.account_deletions where cancelled_at < now() - interval '90 days')
                   and (select company_name is null from public.company_closures where requested_at < now() - interval '99 days'),
  'housekeeping: cancelled deletions removed and closed company names forgotten after 90 days');

-- Two managers asking at the same moment: the companies are locked while managers are counted.
select tests.check(pg_get_functiondef('public.request_account_deletion(text, boolean)'::regprocedure) ~ 'from public\.companies c\s+where c\.id in .*for update'
                   and pg_get_functiondef('public.update_membership(uuid, public.app_role, boolean)'::regprocedure) ~ 'from public\.companies where id = v_m\.company_id for update',
  'locks: deletion requests and team changes lock the company while counting managers');

-- =====================================================================
-- 7. Platform admin: read-only, minimal
-- =====================================================================
select tests.login('solo.del@d.test'); set role authenticated;
select public.request_account_deletion(null, true) as x \gset
reset role;
select tests.login_aal('admin.del@d.test', 'aal2'); set role authenticated;
select public.platform_deletions() as pd \gset
select tests.check((:'pd'::jsonb #>> '{counts,accounts_done}')::int >= 2 and (:'pd'::jsonb #>> '{counts,companies_done}')::int >= 1
                   and (:'pd'::jsonb #>> '{counts,accounts_scheduled}')::int >= 1,
  'admin: counts of scheduled and finished deletions');
select tests.check(:'pd'::jsonb::text not like '%@%' and :'pd'::jsonb::text not like '%Owen%' and :'pd'::jsonb::text not like '%Stella%',
  'admin: no emails or names in the list');
select tests.check((:'pd'::jsonb -> 'accounts') @> '[{"label": "O…", "status": "done"}]'::jsonb
                   and (:'pd'::jsonb -> 'companies') @> '[{"label": "Del Solo Co", "status": "scheduled"}]'::jsonb,
  'admin: first letter only for people, company name while scheduled');
select tests.blocked('update public.account_deletions set status = ''cancelled''', 'admin: cannot change deletions (read-only)');
reset role;
select tests.login_aal('admin.del@d.test', 'aal1'); set role authenticated;
select tests.blocked('select public.platform_deletions()', 'admin: needs two-step verification');
reset role;
select tests.login('boss.del@d.test'); set role authenticated;
select tests.blocked('select public.platform_deletions()', 'admin list: other users refused');
reset role;
select tests.login('solo.del@d.test'); set role authenticated;
select public.cancel_account_deletion();
reset role;

-- =====================================================================
-- 8. Rules every new function follows
-- =====================================================================
select tests.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('guard_suspended_membership', 'account_deletion_blockers', 'schedule_company_closure', 'unschedule_company_closure',
                       'my_account_deletion', 'account_deletion_check', 'request_account_deletion', 'cancel_account_deletion',
                       'request_company_closure', 'cancel_company_closure', 'delete_account_now', 'delete_company_step',
                       'claim_due_deletion_at', 'finish_deletion_at', 'run_due_deletions_at', 'claim_due_deletion', 'finish_deletion',
                       'platform_deletions', 'claim_account_emails', 'storage_cleanup_allowed', 'platform_storage_cleanup',
                       'mark_storage_cleanup_done', 'update_membership')
     and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false))),
  'all new functions are security definer with an empty search path');
select tests.check(not has_function_privilege('authenticated', 'public.delete_account_now(uuid)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.delete_company_step(uuid, interval)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.request_account_deletion(text, boolean)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.platform_deletions(integer)', 'EXECUTE')
                   and has_function_privilege('authenticated', 'public.request_account_deletion(text, boolean)', 'EXECUTE')
                   and has_function_privilege('anon', 'public.claim_due_deletion(text)', 'EXECUTE'),
  'grants: users can ask, only the database runs the deletions, the job needs the secret');
select tests.check((select skipped = 'excluded' from public.backup_table_plan() where table_name = 'company_closures'),
  'backups never include the closure bookkeeping');

-- ---------------------------------------------------------------------
-- Clean up so later test files see a normal database.
-- ---------------------------------------------------------------------
select count(public.delete_company_step(c, interval '1 hour')) from unnest(array[:'co_a', :'co_solo', :'co_b', :'keep']::uuid[]) c \gset x_
delete from public.demo_starts where user_id in (:'owner', :'keeper', :'guest');
delete from auth.users where email like '%.del@d.test' or id in (:'guest', :'owner', :'stuck', :'files_user', :'odd');
delete from public.storage_cleanup;
delete from public.account_emails;
delete from public.account_deletions;
delete from public.company_closures;
delete from storage.objects where name like :'keep' || '/%';
delete from public.app_secrets where name = 'outbox';
drop function tests.boom();
