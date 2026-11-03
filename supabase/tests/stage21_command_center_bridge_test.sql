-- Tests for the LeMo Command Center bridge (lemo_control.handle).
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
grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (email, last_sign_in_at) values ('boss21@g.test', now()), ('sales21@g.test', now() - interval '60 days');
select id as boss from auth.users where email = 'boss21@g.test' \gset
select id as sales from auth.users where email = 'sales21@g.test' \gset
select tests.login('boss21@g.test'); set role authenticated;
select public.create_company('Bridge Supplies 21') as co \gset
reset role;
insert into public.memberships (company_id, user_id, role) values (:'co', :'sales', 'sales');
select set_config('request.jwt.claims', '', false);

-- ---- Nobody but the database owner can reach it ---------------------------------
select tests.login('boss21@g.test'); set role authenticated;
select tests.blocked($$select lemo_control.handle('{"action":"tenants"}')$$, 'signed-in users cannot call the bridge');
reset role;
set role anon;
select tests.blocked($$select lemo_control.handle('{"action":"info"}')$$, 'visitors cannot call the bridge');
reset role;
set role service_role;
select tests.blocked($$select lemo_control.handle('{"action":"info"}')$$, 'the service key cannot call the bridge');
reset role;

-- ---- Reading ----------------------------------------------------------------------
select tests.check(lemo_control.handle('{"action":"info"}') ->> 'contract' = '1', 'info names contract 1');
select tests.check(jsonb_array_length(lemo_control.handle('{"action":"info"}') -> 'plans') = 3, 'three levels offered');

select lemo_control.handle(jsonb_build_object('action', 'tenants', 'search', 'Bridge')) as t \gset
select tests.check(jsonb_array_length((:'t'::jsonb) -> 'rows') = 1, 'search finds the business');
select tests.check(((:'t'::jsonb) -> 'rows' -> 0 ->> 'users')::int = 2
                   and ((:'t'::jsonb) -> 'rows' -> 0 ->> 'active_users')::int = 1, 'users and active users counted');
select tests.check((:'t'::jsonb) -> 'rows' -> 0 ->> 'plan' = 'medium', 'a new business shows its level');
select tests.check(not ((:'t'::jsonb) -> 'rows' -> 0 ? 'email') and not ((:'t'::jsonb) -> 'rows' -> 0 ? 'tin'),
  'no contact or tax details leave the app');

select tests.check(jsonb_array_length(lemo_control.handle(jsonb_build_object('action', 'tenant', 'id', :'co')) -> 'features')
                   = (select count(*) from public.features), 'one business shows every feature');
select tests.check(jsonb_array_length(lemo_control.handle('{"action":"features"}') -> 'rows') = (select count(*) from public.features),
  'catalogue lists every feature');
select tests.blocked($$select lemo_control.handle('{"action":"tenant","id":"not-a-uuid"}')$$, 'a bad id is refused');
select tests.blocked($$select lemo_control.handle('{"action":"drop_everything"}')$$, 'unknown actions are refused');

-- ---- Level -----------------------------------------------------------------------
select tests.blocked(format($$select lemo_control.handle('{"action":"set_plan","id":"%s","plan":"enterprise"}')$$, :'co'),
  'a level change needs a reason');
select tests.blocked(format($$select lemo_control.handle('{"action":"set_plan","id":"%s","plan":"huge","reason":"Growing fast"}')$$, :'co'),
  'unknown levels refused');
select lemo_control.handle(jsonb_build_object('action', 'set_plan', 'id', :'co', 'plan', 'enterprise', 'reason', 'Signed the enterprise plan', 'by', 'Leo'));
select tests.check((select business_level = 'enterprise' from public.companies where id = :'co'), 'level changed');
select tests.check(exists (select 1 from public.audit_log where company_id = :'co' and details ->> 'by' = 'Leo (LeMo Command Center)'
                                and details ->> 'reason' = 'Signed the enterprise plan'), 'level change is in the activity history with who and why');

-- ---- Feature switches ------------------------------------------------------------------
select key as fkey from public.features where status = 'live' and active and not core order by key limit 1 \gset
select lemo_control.handle(jsonb_build_object('action', 'set_feature', 'id', :'co', 'key', :'fkey', 'enabled', false, 'reason', 'Client asked to hide it'));
select tests.check(not public.feature_on(:'co', :'fkey'), 'feature switched off for the business');
select tests.check((select source = 'admin' from public.company_features where company_id = :'co' and feature_key = :'fkey'), 'recorded as an admin switch');
select lemo_control.handle(jsonb_build_object('action', 'set_feature', 'id', :'co', 'key', :'fkey', 'enabled', null, 'reason', 'Back to the level default'));
select tests.check(public.feature_on(:'co', :'fkey') and not exists (select 1 from public.company_features where company_id = :'co' and feature_key = :'fkey'),
  'back to the level default');
select key as core_key from public.features where core order by key limit 1 \gset
select tests.blocked(format($$select lemo_control.handle('{"action":"set_feature","id":"%s","key":"%s","enabled":false,"reason":"Try it"}')$$, :'co', :'core_key'),
  'core features cannot be switched off');

-- ---- Catalogue ----------------------------------------------------------------------
select tests.blocked($$select lemo_control.handle('{"action":"save_feature","key":"drone_deliveries","name":"Drone deliveries","status":"live"}')$$,
  'a new feature cannot start live');
select lemo_control.handle('{"action":"save_feature","key":"drone_deliveries","name":"Drone deliveries","description":"Plan deliveries by drone.","category":"Deliveries","default_plan":"enterprise"}');
select tests.check((select status = 'planned' and default_level = 'enterprise' and module = 'Deliveries' from public.features where key = 'drone_deliveries'),
  'new feature added as planned');
select tests.check(not public.feature_on(:'co', 'drone_deliveries'), 'a planned feature is not on for anyone');
select tests.blocked(format($$select lemo_control.handle('{"action":"set_feature","id":"%s","key":"drone_deliveries","enabled":true,"reason":"Try it early"}')$$, :'co'),
  'a planned feature cannot be switched on');
select lemo_control.handle('{"action":"save_feature","key":"drone_deliveries","name":"Drone deliveries","default_plan":"enterprise","status":"live"}');
select tests.check(public.feature_on(:'co', 'drone_deliveries'), 'once live, enterprise businesses have it');
select tests.blocked($$select lemo_control.handle('{"action":"save_feature","key":"Bad Key!","name":"Bad"}')$$, 'bad feature keys refused');

-- Leave the catalogue as it was for the other tests.
delete from public.features where key = 'drone_deliveries';
delete from public.feature_categories where name = 'Deliveries';
