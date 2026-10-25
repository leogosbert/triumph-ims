-- Tests for the AI features: the daily allowance for reading receipts.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;
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

insert into auth.users (email) values ('m19@e.test'), ('d19@e.test'), ('x19@x.test');
select id as m19 from auth.users where email = 'm19@e.test' \gset
select id as d19 from auth.users where email = 'd19@e.test' \gset

select tests.login('m19@e.test'); set role authenticated;
select public.create_company('Receipt Co') as cid \gset
select public.invite_member(:'cid', 'd19@e.test', 'driver');
reset role;
select tests.login('d19@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('x19@x.test'); set role authenticated;
select public.create_company('Other Receipt Co') as other \gset
reset role;

-- ---- Allowance -------------------------------------------------------------------------------------
select tests.login('d19@e.test'); set role authenticated;
select tests.check(public.use_ai_receipt(:'cid', 2), 'first receipt allowed (any member, also without the assistant feature)');
select tests.check(public.use_ai_receipt(:'cid', 2), 'second receipt allowed');
select tests.check(not public.use_ai_receipt(:'cid', 2), 'third receipt over the allowance');
select tests.check((select receipts from public.assistant_usage where user_id = :'d19') = 3, 'own receipt count visible');
select tests.check((select questions from public.assistant_usage where user_id = :'d19') = 0, 'receipts do not count as questions');
select tests.blocked(format('select public.use_ai_receipt(%L)', :'other'), 'not for another company');
select tests.blocked(format('update public.assistant_usage set receipts = 0 where user_id = %L', :'d19'), 'count cannot be reset by hand');
reset role;
select tests.login('m19@e.test'); set role authenticated;
select tests.check(public.use_ai_receipt(:'cid'), 'manager has a separate allowance');
select tests.check((select count(*) from public.assistant_usage) = 1, 'others'' usage is private');
reset role;

set role anon;
select tests.blocked(format('select public.use_ai_receipt(%L)', :'cid'), 'not without signing in');
reset role;
