-- Polish fixes (stage 20, 20261028000500_polish_fixes.sql):
--  * "Run the check and send now" checks and sends only the pressing company's alerts;
--  * the scheduled job's forms (no company) still cover every company;
--  * all of them are for the server only, and still check the secret.
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

insert into auth.users (email) values ('boss.s20p@x.test'), ('other.s20p@x.test');
select id as boss from auth.users where email = 'boss.s20p@x.test' \gset
select id as otherboss from auth.users where email = 'other.s20p@x.test' \gset
select tests.login('boss.s20p@x.test'); set role authenticated;
select public.create_company('Polish Co') as co \gset
reset role;
select tests.login('other.s20p@x.test'); set role authenticated;
select public.create_company('Polish Other Co') as other \gset
reset role;

-- One waiting alert in each company.
insert into public.notifications (company_id, user_id, kind, severity, title)
values (:'co', :'boss', 'test', 'attention', 'Polish Co alert'),
       (:'other', :'otherboss', 'test', 'attention', 'Polish Other Co alert');

select public.set_outbox_secret('stage20-polish-secret-0123456789') as msg \gset

-- ---- Server only, with the secret -------------------------------------------------------------------
set role anon;
select tests.blocked(format('select public.run_company_alerts_now(%L, %L)', 'stage20-polish-secret-0123456789', :'co'),
  'the browser key cannot run one company''s alert check');
select tests.blocked(format('select * from public.claim_outbox(%L, 10, %L)', 'stage20-polish-secret-0123456789', :'co'),
  'the browser key cannot collect one company''s alerts');
reset role;
select tests.login('boss.s20p@x.test'); set role authenticated;
select tests.blocked(format('select public.run_company_alerts_now(%L, %L)', 'stage20-polish-secret-0123456789', :'co'),
  'a manager cannot call the check directly, even with the secret');
select tests.blocked(format('select * from public.claim_outbox(%L, 10, %L)', 'stage20-polish-secret-0123456789', :'co'),
  'a manager cannot collect alerts directly, even with the secret');
select tests.blocked('select * from public.claim_outbox(''stage20-polish-secret-0123456789'', 10)',
  'a manager cannot run the platform job either');
reset role;
set role service_role;
select tests.blocked(format('select public.run_company_alerts_now(%L, %L)', 'wrong-secret-wrong-secret-wrong', :'co'),
  'the company check still needs the secret');
select tests.blocked(format('select * from public.claim_outbox(%L, 10, %L)', 'wrong-secret-wrong-secret-wrong', :'co'),
  'the company queue still needs the secret');
select tests.blocked(format('select public.run_company_alerts_now(%L, %L)', 'stage20-polish-secret-0123456789', gen_random_uuid()),
  'an unknown company is refused');

-- ---- Only the pressing company ----------------------------------------------------------------------
select tests.check(public.run_company_alerts_now('stage20-polish-secret-0123456789', :'co') >= 0, 'the company''s own check runs');
create temp table polish_claimed as select * from public.claim_outbox('stage20-polish-secret-0123456789', 1000, :'co');
reset role;
select tests.check((select count(*) from polish_claimed where title = 'Polish Co alert') = 1, 'the pressing company''s alert is sent');
select tests.check(not exists (select 1 from polish_claimed c join public.notifications n on n.id = c.notification_id
                                where n.company_id <> :'co'),
  'nothing from another company is sent');
select tests.check((select dispatched_at is null from public.notifications where title = 'Polish Other Co alert'),
  'the other company''s alert still waits for the scheduled job');

-- ---- The scheduled job still covers every company ---------------------------------------------------
set role service_role;
create temp table polish_all as select * from public.claim_outbox('stage20-polish-secret-0123456789', 1000);
reset role;
select tests.check((select count(*) from polish_all where title = 'Polish Other Co alert') = 1, 'the scheduled job sends every company''s alerts');
select tests.check((select count(*) from polish_all where title = 'Polish Co alert') = 0, 'each alert is sent once');
select tests.check(position('p_company' in pg_get_functiondef('public.claim_outbox(text,integer)'::regprocedure)) = 0
                   and position('null::uuid' in pg_get_functiondef('public.claim_outbox(text,integer)'::regprocedure)) > 0,
  'the two-argument form hands over with no company');
select tests.check(not has_function_privilege('authenticated', 'public.run_company_alerts_now(text,uuid)', 'execute')
                   and not has_function_privilege('anon', 'public.claim_outbox(text,integer,uuid)', 'execute')
                   and has_function_privilege('service_role', 'public.claim_outbox(text,integer,uuid)', 'execute'),
  'grants: server role only');

\echo 'ALL STAGE 20 POLISH FIX TESTS PASSED'
