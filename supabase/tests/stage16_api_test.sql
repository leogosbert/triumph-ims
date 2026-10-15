-- Tests for Stage 16: API keys, the data API, the assistant allowance.
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
-- Signed in with a password p_age seconds ago ("confirm it is you" passes for 10 minutes).
create or replace function tests.login_recent(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', (select id from auth.users where email = p_email), 'email', p_email, 'role', 'authenticated',
                       'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 5)))::text,
    false);
end $$;
create or replace function tests.login_guest(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'is_anonymous', true)::text, false);
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
-- The statement changes nothing (row-level security hides the row).
create or replace function tests.no_rows(p_sql text, p_label text) returns void language plpgsql as $$
declare
  v_n bigint;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAILED (% rows changed): %', v_n, p_label; end if;
  raise notice 'pass: % (no rows)', p_label;
end $$;

insert into auth.users (email) values ('m18@e.test'), ('f18@e.test'), ('x18@x.test');
select id as m18 from auth.users where email = 'm18@e.test' \gset
select id as f18 from auth.users where email = 'f18@e.test' \gset

select tests.login('m18@e.test'); set role authenticated;
select public.create_company('Api Co') as cid \gset
select public.set_business_level(:'cid', 'enterprise');
select public.invite_member(:'cid', 'f18@e.test', 'finance');
insert into public.clients (company_id, name, tin) values (:'cid', 'Hotel Ltd', '123-456-789') returning id as client \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'PAP', 'A4 paper', 'box', 50000);
reset role;
select tests.login('f18@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('x18@x.test'); set role authenticated; select public.create_company('Other Api Co') as other \gset
insert into public.clients (company_id, name) values (:'other', 'Not yours Ltd');
reset role;

-- ---- Features are live ----------------------------------------------------------------------------
select tests.check((select count(*) from public.features where key in ('mobile_money', 'ai_assistant', 'integrations') and status = 'live') = 3,
                   'mobile money, assistant and integrations are live');

-- ---- API keys -------------------------------------------------------------------------------------
select tests.login('m18@e.test'); set role authenticated;
select tests.blocked(format('select public.create_api_key(%L, %L)', :'cid', 'Accounting'), 'creating a key needs a recent sign-in');
reset role;
select tests.login_recent('m18@e.test'); set role authenticated;
select public.set_company_feature(:'cid', 'integrations', false);
select tests.blocked(format('select public.create_api_key(%L, %L)', :'cid', 'Accounting'), 'no keys while integrations is off');
select public.set_company_feature(:'cid', 'integrations', true);
select tests.blocked(format('select public.create_api_key(%L, %L)', :'cid', 'x'), 'key name too short');
select public.create_api_key(:'cid', 'Accounting software') as key \gset
select tests.check(:'key' ~ '^lmsp_[a-f0-9]{64}$', 'key has the expected shape');
select tests.check((select prefix from public.api_keys where company_id = :'cid') = left(:'key', 13), 'management sees the key prefix');
select tests.blocked('select key_hash from public.api_keys', 'the hash cannot be read');
select tests.blocked(format('insert into public.api_keys (company_id, name, prefix, key_hash) values (%L, %L, %L, %L)', :'cid', 'Mine', 'lmsp_00000000', repeat('a', 64)),
                     'keys only through the function');
select tests.check((select count(*) from public.audit_log where company_id = :'cid' and entity = 'api_keys') = 1, 'key creation is in the activity log');
reset role;
select tests.login_recent('f18@e.test'); set role authenticated;
select tests.check((select count(*) from public.api_keys) = 0, 'finance does not see keys');
select tests.blocked(format('select public.create_api_key(%L, %L)', :'cid', 'Mine'), 'finance cannot create keys');
select tests.blocked(format('select public.revoke_api_key(%L)', (select id from public.api_keys limit 1)), 'finance cannot switch keys off');
reset role;

-- ---- The data API ----------------------------------------------------------------------------------
set role anon;
select tests.check((public.api_read(:'key', 'clients') -> 'data' -> 0 ->> 'name') = 'Hotel Ltd', 'the key reads its company''s clients');
select tests.check((public.api_read(:'key', 'clients') ->> 'count')::int = 1, 'and only its company''s clients');
select tests.check((public.api_read(:'key', 'products') -> 'data' -> 0 ->> 'sku') = 'PAP', 'products can be read');
select tests.check((public.api_read(:'key', 'invoices') ->> 'count')::int = 0, 'draft invoices are not shared');
select tests.check((public.api_read(:'key', 'clients', now() + interval '1 day') ->> 'count')::int = 0, 'since filters out older records');
select tests.check((public.api_read(:'key', 'clients', null, 1) ->> 'next_offset')::int = 1, 'a full page gives the next offset');
select tests.blocked(format('select public.api_read(%L, %L)', :'key', 'memberships'), 'unknown resources are refused');
select tests.blocked(format('select public.api_read(%L, %L)', 'lmsp_' || repeat('0', 64), 'clients'), 'a wrong key is refused');
select tests.blocked('select * from public.api_keys', 'anon cannot read keys');
select tests.blocked('select * from public.clients', 'anon still cannot read tables');
reset role;
select tests.check((select use_count from public.api_keys where company_id = :'cid') >= 6, 'use is counted');

select tests.login('m18@e.test'); set role authenticated;
select public.set_company_feature(:'cid', 'integrations', false);
reset role;
set role anon;
select tests.blocked(format('select public.api_read(%L, %L)', :'key', 'clients'), 'API stops when integrations is switched off');
reset role;
select tests.login('m18@e.test'); set role authenticated;
select public.set_company_feature(:'cid', 'integrations', true);
select public.revoke_api_key((select id from public.api_keys where company_id = :'cid'));
reset role;
set role anon;
select tests.blocked(format('select public.api_read(%L, %L)', :'key', 'clients'), 'a switched-off key stops working');
reset role;

-- ---- Assistant allowance ---------------------------------------------------------------------------
select tests.login('f18@e.test'); set role authenticated;
select tests.check(public.use_assistant(:'cid', 2), 'first question allowed');
select tests.check(public.use_assistant(:'cid', 2), 'second question allowed');
select tests.check(not public.use_assistant(:'cid', 2), 'third question over the allowance');
select tests.check((select questions from public.assistant_usage where user_id = :'f18') = 3, 'own usage visible');
select tests.blocked(format('select public.use_assistant(%L)', :'other'), 'not for another company');
select tests.blocked(format('insert into public.assistant_usage (company_id, user_id) values (%L, %L)', :'cid', :'m18'), 'usage only through the function');
reset role;
select tests.login('m18@e.test'); set role authenticated;
select tests.check((select count(*) from public.assistant_usage) = 0, 'others'' usage is private');
reset role;
