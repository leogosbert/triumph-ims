-- Security hardening (stage 20, 20261028000400_security_hardening.sql): the fixes that the other
-- stage20_sec_* tests do not cover.
--  * AI minutes: counted runs (5 per meeting a day), single-use brief, only for people who manage the meeting;
--  * job sign-off files: only people who work on the job, only under the job's own company, never demos;
--  * the "send now" queue functions take a company and are for the server only;
--  * the job functions are for the server only, and still check the secret;
--  * daily AI allowances use the Dar es Salaam date; policies read auth.uid() once per query.
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

insert into auth.users (email) values ('boss.s20h@x.test'), ('sales.s20h@x.test'), ('driver.s20h@x.test'),
                                      ('tech.s20h@x.test'), ('other.s20h@x.test');
select id as driver from auth.users where email = 'driver.s20h@x.test' \gset
select id as tech from auth.users where email = 'tech.s20h@x.test' \gset
select tests.login('boss.s20h@x.test'); set role authenticated;
select public.create_company('Hardening Co') as co \gset
reset role;
select tests.login('other.s20h@x.test'); set role authenticated;
select public.create_company('Hardening Other Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
values (:'co', (select id from auth.users where email = 'sales.s20h@x.test'), 'sales'),
       (:'co', :'driver', 'driver'), (:'co', :'tech', 'driver');
insert into public.clients (company_id, name) values (:'co', 'Hardening Client') returning id as client \gset

-- ---- 1. AI minutes: counted and single use ----------------------------------------------------------
select tests.login('boss.s20h@x.test'); set role authenticated;
select public.meeting_create(:'co', jsonb_build_object('title', 'Weekly review', 'starts_at', now() + interval '1 hour')) as mt \gset
select tests.blocked(format('select public.meeting_ai_run_start(%L, null)', :'mt'), 'no AI run before the meeting has ended');
select public.meeting_end(:'mt');
select public.meeting_ai_run_start(:'mt', jsonb_build_object('meeting', jsonb_build_object('id', :'mt'), 'notes', 'x')) as run1 \gset
reset role;
select tests.check((select user_id = (select id from auth.users where email = 'boss.s20h@x.test') and day = (now() at time zone 'Africa/Dar_es_Salaam')::date
                      from public.meeting_ai_runs where id = :'run1'), 'the run is counted for the person, on the Dar es Salaam day');

select tests.login('driver.s20h@x.test'); set role authenticated;
select tests.blocked(format('select public.meeting_ai_run_start(%L, null)', :'mt'), 'someone who does not manage the meeting cannot start an AI run');
select tests.check(public.meeting_ai_run_take(:'run1') is null, 'another person cannot take the brief');
select tests.blocked('select count(*) from public.meeting_ai_runs', 'the runs table is not readable directly');
reset role;
set role anon;
select tests.blocked(format('select public.meeting_ai_run_take(%L)', :'run1'), 'the browser key cannot take a brief');
reset role;

select tests.login('boss.s20h@x.test'); set role authenticated;
select tests.check((public.meeting_ai_run_take(:'run1') -> 'brief' ->> 'notes') = 'x', 'the person who started the run reads its brief');
select tests.check(public.meeting_ai_run_take(:'run1') is null, 'only once');
select public.meeting_ai_run_start(:'mt', null) as r2 \gset
select public.meeting_ai_run_start(:'mt', null) as r3 \gset
select public.meeting_ai_run_start(:'mt', null) as r4 \gset
select public.meeting_ai_run_start(:'mt', null) as r5 \gset
select tests.blocked(format('select public.meeting_ai_run_start(%L, null)', :'mt'), 'a sixth AI run on one meeting in one day is refused');
select tests.blocked(format('select public.meeting_ai_run_start(%L, %L)', :'mt', jsonb_build_object('t', repeat('x', 1000001))),
  'a brief above 1 MB is refused');
reset role;
-- Runs older than 20 minutes cannot be taken.
select tests.login('boss.s20h@x.test'); set role authenticated;
select public.meeting_create(:'co', jsonb_build_object('title', 'Second review', 'starts_at', now() + interval '1 hour')) as mt2 \gset
select public.meeting_end(:'mt2');
select public.meeting_ai_run_start(:'mt2', '{"a": 1}'::jsonb) as old_run \gset
reset role;
update public.meeting_ai_runs set created_at = now() - interval '21 minutes' where id = :'old_run';
select tests.login('boss.s20h@x.test'); set role authenticated;
select tests.check(public.meeting_ai_run_take(:'old_run') is null, 'a run older than 20 minutes is not handed out');
reset role;
-- The company's daily cap (30).
insert into public.meeting_ai_runs (company_id, meeting_id, user_id)
select :'co', :'mt2', (select id from auth.users where email = 'boss.s20h@x.test') from generate_series(1, 30);
select tests.login('boss.s20h@x.test'); set role authenticated;
select public.meeting_create(:'co', jsonb_build_object('title', 'Third review', 'starts_at', now() + interval '1 hour')) as mt3 \gset
select public.meeting_end(:'mt3');
select tests.blocked(format('select public.meeting_ai_run_start(%L, null)', :'mt3'), 'the company''s daily AI allowance for minutes is kept (30)');
reset role;
delete from public.meeting_ai_runs where company_id = :'co';

-- ---- 2. Job sign-off files ------------------------------------------------------------------------
select tests.login('boss.s20h@x.test'); set role authenticated;
insert into public.service_jobs (company_id, client_id, title, kind, assigned_to, scheduled_for)
values (:'co', :'client', 'Pump repair', 'repair', array[:'tech']::uuid[], now()) returning id as job \gset
reset role;
select tests.login('tech.s20h@x.test'); set role authenticated;
insert into storage.objects (bucket_id, name) values ('pod', :'co' || '/jobs/' || :'job' || '/signature-1.png');
select tests.check(true, 'the technician on the job can upload its sign-off');
reset role;
select tests.login('driver.s20h@x.test'); set role authenticated;
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'pod', :'co' || '/jobs/' || :'job' || '/x.png'),
  'a driver who is not on the job cannot upload under it');
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'pod', :'co' || '/jobs/anything/x.png'),
  'not under a made-up job folder');
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'pod', 'not-a-company/jobs/x/x.png'),
  'a folder that is not a company is refused (not a cast error)');
reset role;
select tests.login('other.s20h@x.test'); set role authenticated;
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'pod', :'other' || '/jobs/' || :'job' || '/x.png'),
  'another company cannot file under its own folder with this company''s job');
reset role;
select tests.login('boss.s20h@x.test'); set role authenticated;
insert into storage.objects (bucket_id, name) values ('pod', :'co' || '/jobs/' || :'job' || '/signature-2.png');
select tests.check((select count(*) from storage.objects where bucket_id = 'pod' and name like :'co' || '/jobs/%') = 2,
  'management can upload, and members see the job files');
reset role;

-- ---- 3. Queues of one company (the "send now" buttons) ----------------------------------------------
select tests.check(not has_function_privilege('authenticated', 'public.fiscal_claim(integer, uuid)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.fiscal_claim(integer, uuid)', 'EXECUTE')
                   and has_function_privilege('service_role', 'public.fiscal_claim(integer, uuid)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.reminder_claim(integer, timestamptz, uuid)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.reminder_claim(integer, timestamptz, uuid)', 'EXECUTE')
                   and has_function_privilege('service_role', 'public.reminder_claim(integer, timestamptz, uuid)', 'EXECUTE'),
  'the per-company queues are for the server only');
set role service_role;
select tests.check(public.fiscal_claim(10, gen_random_uuid()) = '[]'::jsonb, 'a company with nothing queued gets nothing');
select tests.check(public.reminder_claim(10, now(), gen_random_uuid()) = '[]'::jsonb, 'no reminders of other companies');
reset role;
select tests.check(position('p_company' in pg_get_functiondef('public.fiscal_claim(integer,uuid)'::regprocedure)) > 0
                   and position('p_company' in pg_get_functiondef('public.reminder_claim(integer,timestamptz,uuid)'::regprocedure)) > 0,
  'both queues filter on the company');

-- ---- 4. Job functions: server only, still with the secret --------------------------------------------
select public.set_outbox_secret('stage20-hardening-secret-0123456789') as msg \gset
set role anon;
select tests.blocked('select * from public.claim_outbox(''stage20-hardening-secret-0123456789'', 1)', 'the browser key cannot run a job, even with the secret');
reset role;
select tests.login('boss.s20h@x.test'); set role authenticated;
select tests.blocked('select public.claim_due_deletion(''stage20-hardening-secret-0123456789'')', 'a signed-in user cannot run a job, even with the secret');
reset role;
set role service_role;
select tests.blocked('select * from public.claim_outbox(''wrong-secret-wrong-secret-wrong'', 1)', 'the server still needs the secret');
select tests.check((select count(*) from public.claim_outbox('stage20-hardening-secret-0123456789', 1)) >= 0, 'the server runs the job with the secret');
reset role;

-- ---- 5. Dates and policies --------------------------------------------------------------------------
select tests.check((select column_default from information_schema.columns
                     where table_schema = 'public' and table_name = 'assistant_usage' and column_name = 'day') ~ 'Africa/Dar_es_Salaam',
  'the AI allowance day is the Dar es Salaam date');
select tests.check(not exists (
    select 1 from pg_policies where schemaname = 'public'
       and replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', '') ~ 'auth\.uid\(\)'),
  'every policy reads auth.uid() once per query');
select tests.check(not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
       and not exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                        where i.indrelid = c.oid and a.attname = 'company_id')),
  'every company table has an index that starts with company_id');

-- Clean up so later test files see a normal database.
delete from storage.objects where bucket_id = 'pod' and name like :'co' || '/jobs/%';
