-- Tests for automatic payment reminders: settings, which invoices are due a reminder on a day, opt-outs,
-- "don't remind", promised payments, the log and retries. Nothing is sent: the server is played by
-- "set role service_role" and the moment is fixed (10 November 2026).
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon, service_role;
create or replace function tests.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'email', p_email, 'role', 'authenticated')::text, false);
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
grant execute on all functions in schema tests to authenticated, anon, service_role;

insert into auth.users (email) values ('boss.rm@g.test'), ('fin.rm@g.test'), ('sales.rm@g.test'), ('store.rm@g.test'), ('other.rm@g.test');

select tests.login('boss.rm@g.test'); set role authenticated;
select public.create_company('Reminder Supply Co') as co \gset
reset role;
select tests.login('other.rm@g.test'); set role authenticated;
select public.create_company('Other Reminder Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
select :'co', id, r::public.app_role from (values ('fin.rm@g.test', 'finance'), ('sales.rm@g.test', 'sales'), ('store.rm@g.test', 'warehouse')) v(e, r)
  join auth.users u on u.email = v.e;

insert into public.clients (company_id, name) values (:'co', 'Shinyanga Mine') returning id as c1 \gset
insert into public.clients (company_id, name) values (:'co', 'No Contact Ltd') returning id as c2 \gset
insert into public.clients (company_id, name) values (:'co', 'Quiet Client Ltd') returning id as c3 \gset
insert into public.client_contacts (company_id, client_id, kind, name, email, phone)
values (:'co', :'c1', 'purchasing', 'Peter', 'peter@mine.test', null),
       (:'co', :'c1', 'finance', 'Neema', 'Neema <neema@mine.test>', '0765 000 111'),
       (:'co', :'c3', 'finance', 'Ally', 'ally@quiet.test', '0711 222 333');

-- An issued invoice of 100,000 (no VAT) with the given dates.
create or replace function tests.inv(p_company uuid, p_client uuid, p_issue date, p_due date) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.invoices (company_id, client_id, vat_rate, issue_date, due_date) values (p_company, p_client, 0, p_issue, p_due) returning id into v;
  insert into public.invoice_lines (company_id, invoice_id, description, quantity, unit_price) values (p_company, v, 'Safety boots', 4, 25000);
  perform public.issue_invoice(v);
  return v;
end $$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

select tests.check((select default_level = 'small' and status = 'live' and module = 'Finance' and route = '/getting-paid/reminders'
                     from public.features where key = 'auto_reminders'), 'auto_reminders feature: small level, live, Finance');

select tests.login('fin.rm@g.test'); set role authenticated;
-- 3 days before
select tests.inv(:'co', :'c1', '2026-10-20', '2026-11-13') as before3 \gset
-- due today
select tests.inv(:'co', :'c1', '2026-10-20', '2026-11-10') as dueday \gset
-- 8 days late: the 7-day step, one day late
select tests.inv(:'co', :'c1', '2026-10-01', '2026-11-02') as late8 \gset
-- 20 days late: no step within 2 days
select tests.inv(:'co', :'c1', '2026-09-01', '2026-10-21') as late20 \gset
-- issued after its 3-days-before date
select tests.inv(:'co', :'c1', '2026-11-10', '2026-11-12') as fresh \gset
select tests.inv(:'co', :'c2', '2026-10-20', '2026-11-10') as nocontact \gset
select tests.inv(:'co', :'c3', '2026-10-20', '2026-11-10') as optout \gset
select tests.inv(:'co', :'c1', '2026-10-20', '2026-11-10') as switched \gset
select tests.inv(:'co', :'c1', '2026-10-20', '2026-11-10') as promised \gset
select public.log_followup(null, :'promised', 'call', 'Will pay on the 15th', '2026-11-15');
reset role;

-- ---- 1. Settings and switches ----------------------------------------------------------------------------
select tests.login('fin.rm@g.test'); set role authenticated;
select tests.blocked(format('select public.reminder_save_settings(%L, %L)', :'co', '{"enabled": true}'), 'finance cannot change the reminder settings');
select tests.blocked(format('select public.reminder_set_invoice(%L, true)', gen_random_uuid()), 'unknown invoice');
select public.reminder_set_invoice(:'switched', true);
select tests.check((select no_reminders from public.invoices where id = :'switched'), 'finance marks one invoice "do not remind"');
select tests.blocked(format('update public.invoices set no_reminders = false where id = %L', :'switched'), 'the switch is only changed through the app''s function');
reset role;
select tests.login('sales.rm@g.test'); set role authenticated;
select tests.blocked(format('select public.reminder_set_invoice(%L, false)', :'switched'), 'sales cannot switch an invoice off');
select public.reminder_set_client(:'c3', true, 'sw');
select tests.check((select reminders_opt_out and reminder_language = 'sw' from public.clients where id = :'c3'), 'sales record that a client asked not to be reminded');
reset role;
select tests.login('store.rm@g.test'); set role authenticated;
select tests.blocked(format('select public.reminder_set_client(%L, false, null)', :'c3'), 'the warehouse cannot change a client''s choice');
reset role;
select tests.login('other.rm@g.test'); set role authenticated;
select tests.blocked(format('select public.reminder_set_client(%L, false, null)', :'c1'), 'another company cannot either');
reset role;

set role service_role;
select tests.check(jsonb_array_length(public.reminder_claim(50, '2026-11-10 09:30+03')) = 0, 'nothing is sent before management switches reminders on');
reset role;

select tests.login('boss.rm@g.test'); set role authenticated;
select tests.blocked(format('select public.reminder_save_settings(%L, %L)', :'co', '{"enabled": true, "channels": ["fax"]}'), 'unknown channels are refused');
select tests.blocked(format('select public.reminder_save_settings(%L, %L)', :'co', '{"enabled": true, "schedule": [200]}'), 'days are within -30 and 120');
select tests.blocked(format('select public.reminder_save_settings(%L, %L)', :'co', '{"enabled": true, "send_hour": 3}'), 'not at night');
select public.reminder_save_settings(:'co', '{"enabled": true, "schedule": [14, 0, -3, 7, 7], "channels": ["sms", "email"], "send_hour": 9, "language": "en"}');
select tests.check((select schedule = '{-3,0,7,14}' and channels = '{email,sms}' from public.reminder_settings where company_id = :'co'),
  'the schedule is sorted without repeats');
reset role;

-- ---- 2. What is due on 10 November --------------------------------------------------------------------------
select tests.login('fin.rm@g.test'); set role authenticated;
select tests.blocked('select public.reminder_claim(10, now())', 'only the server claims reminders');
select tests.blocked(format('select public.reminder_mark(%L, true, null, null, null)', gen_random_uuid()), 'only the server marks them sent');
reset role;
set role service_role;
select tests.check(jsonb_array_length(public.reminder_claim(50, '2026-11-10 07:30+03')) = 0, 'nothing before the company''s hour (09:00)');
select tests.check(jsonb_array_length(public.reminder_claim(50, '2026-11-10 20:30+03')) = 0, 'nothing in the evening');
select public.reminder_claim(50, '2026-11-10 09:30+03') as jobs \gset
reset role;
select tests.check(jsonb_array_length(:'jobs'::jsonb) = 6, '6 reminders: 3 invoices by email and SMS');
select tests.check((select array_agg(distinct (j -> 'invoice' ->> 'id')::uuid order by (j -> 'invoice' ->> 'id')::uuid)
                      from jsonb_array_elements(:'jobs'::jsonb) j)
                   = (select array_agg(x order by x) from unnest(array[:'before3', :'dueday', :'late8']::uuid[]) x),
  'the invoices: 3 days before, due today, and 7 days late (sent a day late)');
select tests.check((select (j ->> 'step')::int from jsonb_array_elements(:'jobs'::jsonb) j where (j -> 'invoice' ->> 'id')::uuid = :'late8'::uuid limit 1) = 7
                   and (select (j ->> 'step')::int from jsonb_array_elements(:'jobs'::jsonb) j where (j -> 'invoice' ->> 'id')::uuid = :'before3'::uuid limit 1) = -3,
  'each with its step');
select tests.check((select j ->> 'to' from jsonb_array_elements(:'jobs'::jsonb) j where j ->> 'channel' = 'email' limit 1) = 'neema@mine.test'
                   and (select j ->> 'to' from jsonb_array_elements(:'jobs'::jsonb) j where j ->> 'channel' = 'sms' limit 1) = '255765000111',
  'to the finance contact: clean email address and phone with the country code');
select tests.check((select bool_and(j ->> 'pay_code' ~ '^[a-f0-9]{32}$') from jsonb_array_elements(:'jobs'::jsonb) j)
                   and (select count(*) from public.pay_links where company_id = :'co') = 3,
  'each reminder carries the invoice''s pay link (made when needed)');
select tests.check((select (j -> 'invoice' ->> 'balance')::numeric = 100000 and j -> 'company' ->> 'name' = 'Reminder Supply Co'
                      from jsonb_array_elements(:'jobs'::jsonb) j limit 1), 'with the balance and the company name for the text');
select tests.check((select count(*) from public.reminder_log where invoice_id = :'nocontact' and status = 'skipped') = 2
                   and (select error from public.reminder_log where invoice_id = :'nocontact' and channel = 'email') = 'No email address for the client',
  'a client without email or phone: logged as skipped with the reason');
select tests.check(not exists (select 1 from public.reminder_log where invoice_id in (:'optout', :'switched', :'promised', :'late20', :'fresh')),
  'not reminded: opted-out client, "do not remind", promised payment, no step today, issued after the step');

set role service_role;
select tests.check(jsonb_array_length(public.reminder_claim(50, '2026-11-10 10:00+03')) = 0, 'nobody is reminded twice for the same step');
select (j ->> 'id')::uuid as ok_id from jsonb_array_elements(:'jobs'::jsonb) j where j ->> 'channel' = 'email' limit 1 \gset
select (j ->> 'id')::uuid as bad_id from jsonb_array_elements(:'jobs'::jsonb) j where j ->> 'channel' = 'sms' limit 1 \gset
select public.reminder_mark(:'ok_id', true, 're_123', null, 'Dear Neema, ...');
select public.reminder_mark(:'bad_id', false, null, 'Beem: insufficient balance', 'Habari ...');
select tests.check((select status = 'sent' and sent_at is not null and provider_id = 're_123' and body = 'Dear Neema, ...' from public.reminder_log where id = :'ok_id')
                   and (select status = 'failed' and error like 'Beem%' from public.reminder_log where id = :'bad_id'),
  'the log keeps what was sent, and why one failed');
select tests.check(jsonb_array_length(public.reminder_claim(50, '2026-11-10 09:50+03')) = 0, 'unanswered and failed ones wait 30 minutes...');
select public.reminder_claim(50, '2026-11-10 10:15+03') as again \gset
select tests.check(jsonb_array_length(:'again'::jsonb) = 5
                   and exists (select 1 from jsonb_array_elements(:'again'::jsonb) j where (j ->> 'id')::uuid = :'bad_id'::uuid)
                   and (select attempts from public.reminder_log where id = :'bad_id') = 2
                   and not exists (select 1 from jsonb_array_elements(:'again'::jsonb) j where (j ->> 'id')::uuid = :'ok_id'::uuid),
  '...then the 4 never answered and the failed one are offered again (second attempt), never the sent one');
select public.reminder_mark(:'bad_id', false, null, 'still failing', null);
update public.reminder_log set attempts = 3 where id = :'bad_id';
select tests.check(not exists (select 1 from jsonb_array_elements(public.reminder_claim(50, '2026-11-10 12:00+03')) j where (j ->> 'id')::uuid = :'bad_id'::uuid),
  'three tries at most');
reset role;

-- A payment stops the next reminders.
select tests.login('fin.rm@g.test'); set role authenticated;
select public.record_payment(:'before3', '2026-11-11', 100000, 'bank_transfer', 'CRDB 77', null, null);
reset role;
set role service_role;
select tests.check(not exists (select 1 from jsonb_array_elements(public.reminder_claim(50, '2026-11-13 09:30+03')) j
                                where (j -> 'invoice' ->> 'id')::uuid = :'before3'::uuid),
  'a paid invoice is not reminded on its due day');
reset role;

-- ---- 3. What is coming and who sees the log ---------------------------------------------------------------------
select tests.login('fin.rm@g.test'); set role authenticated;
select tests.check((select count(*) from public.reminder_upcoming(:'co', 30) where invoice_id = :'switched' and blocked = 'Do not remind (this invoice)') >= 1
                   and (select count(*) from public.reminder_upcoming(:'co', 30) where invoice_id = :'optout' and blocked = 'The client asked not to be reminded') >= 1
                   and (select count(*) from public.reminder_upcoming(:'co', 30) where invoice_id = :'nocontact' and blocked = 'No email or phone for the client') >= 1,
  'coming up: each reminder that will not go says why');
reset role;
select tests.login('sales.rm@g.test'); set role authenticated;
select tests.check((select count(*) from public.reminder_log where company_id = :'co') >= 8, 'sales see the reminder log');
reset role;
select tests.login('store.rm@g.test'); set role authenticated;
select tests.check((select count(*) from public.reminder_log) = 0 and (select count(*) from public.reminder_settings) = 0,
  'the warehouse sees neither the log nor the settings');
reset role;
select tests.login('other.rm@g.test'); set role authenticated;
select tests.check((select count(*) from public.reminder_log where company_id = :'co') = 0, 'another company sees nothing');
select tests.blocked(format('select * from public.reminder_upcoming(%L, 7)', :'co'), 'nor what is coming');
reset role;

-- ---- 4. Feature off, demo companies -------------------------------------------------------------------------------
select tests.login('boss.rm@g.test'); set role authenticated;
select public.set_company_feature(:'co', 'auto_reminders', false);
reset role;
select tests.login('fin.rm@g.test'); set role authenticated;
select tests.inv(:'co', :'c1', '2026-11-01', '2026-11-20') as later \gset
reset role;
set role service_role;
select tests.check(jsonb_array_length(public.reminder_claim(50, '2026-11-17 09:30+03')) = 0, 'feature off: nothing is sent');
reset role;
select tests.login('boss.rm@g.test'); set role authenticated;
select public.set_company_feature(:'co', 'auto_reminders', null);
reset role;
update public.companies set is_demo = true, demo_expires_at = now() + interval '1 day' where id = :'co';
set role service_role;
select tests.check(jsonb_array_length(public.reminder_claim(50, '2026-11-17 09:30+03')) = 0, 'demo companies never send reminders');
reset role;
update public.companies set is_demo = false, demo_expires_at = null where id = :'co';
set role service_role;
select public.reminder_claim(50, '2026-11-17 09:30+03') as back \gset
select tests.check((select count(*) from jsonb_array_elements(:'back'::jsonb) j where (j -> 'invoice' ->> 'id')::uuid = :'later'::uuid) = 2,
  'back on: the 3-days-before reminder of the new invoice goes');
select tests.check(exists (select 1 from jsonb_array_elements(:'back'::jsonb) j where (j -> 'invoice' ->> 'id')::uuid = :'promised'::uuid and (j ->> 'step')::int = 7),
  'once the promised date has passed, reminders start again');
reset role;

select tests.check(not has_function_privilege('anon', 'public.reminder_claim(integer, timestamptz)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.reminder_claim(integer, timestamptz)', 'EXECUTE')
                   and has_function_privilege('service_role', 'public.reminder_claim(integer, timestamptz)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.pay_link_ensure(uuid)', 'EXECUTE')
                   and not has_table_privilege('anon', 'public.reminder_log', 'SELECT'),
  'grants: the job functions are for the server only');

drop function tests.inv(uuid, uuid, date, date);
