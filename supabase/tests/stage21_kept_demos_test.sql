-- Tests for kept demo companies (LeMo Demonstrator): several members, never purged or ended from the app.
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
create or replace function tests.blocked_with(p_sql text, p_message text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAILED (was allowed): %', p_label;
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  if sqlerrm not like p_message then raise exception 'FAILED: % (wrong message: %)', p_label, sqlerrm; end if;
  raise notice 'pass: % (blocked: %)', p_label, sqlerrm;
end $$;
grant execute on all functions in schema tests to authenticated, anon;

-- The six demo logins (on the live project demonstrator-accounts.sql makes them) and two other people.
insert into auth.users (email) values ('demo.manager@lemo-demo.test'), ('demo.sales@lemo-demo.test'),
  ('demo.procurement@lemo-demo.test'), ('demo.warehouse@lemo-demo.test'), ('demo.driver@lemo-demo.test'),
  ('demo.finance@lemo-demo.test'), ('client21@d.test'), ('solo21@d.test');
insert into auth.users (is_anonymous) values (true) returning id as g21 \gset

\ir ../../scripts/demo/demonstrator-company.sql
select c.id as kd from public.companies c join public.memberships m on m.company_id = c.id
  join auth.users u on u.id = m.user_id where u.email = 'demo.manager@lemo-demo.test' and c.is_demo \gset

select tests.check((select is_demo and demo_expires_at is null and name = 'Mwanga Supplies Ltd (DEMO)' and business_level = 'medium'
                      from public.companies where id = :'kd'), 'kept demo: a Medium demo, renamed, with no expiry');
select tests.check((select array_agg(m.role::text || ':' || split_part(u.email, '@', 1) order by m.role)
                      from public.memberships m join auth.users u on u.id = m.user_id where m.company_id = :'kd')
                   = array['management:demo.manager', 'sales:demo.sales', 'procurement:demo.procurement',
                           'warehouse:demo.warehouse', 'driver:demo.driver', 'finance:demo.finance'],
                   'kept demo: six members, one per role');
select tests.check((select count(*) from public.quotations where company_id = :'kd') > 0
                   and (select count(*) from public.invoices where company_id = :'kd') > 0, 'kept demo: has the sample data');

-- Running it again changes nothing.
\ir ../../scripts/demo/demonstrator-company.sql
select tests.check((select count(*) from public.companies where is_demo and demo_expires_at is null) = 1, 'running again makes no second company');

-- The scheduled purge leaves it, and nobody can end it from the app.
select public.purge_demo_companies();
select tests.check(exists (select 1 from public.companies where id = :'kd'), 'purge leaves a kept demo');
select tests.login('demo.sales@lemo-demo.test'); set role authenticated;
select tests.blocked_with('select public.end_demo()', 'This demo company is kept for the LeMo Demonstrator%', 'Exit demo cannot end a kept demo');
reset role;
select tests.check(not public.delete_demo_company(:'kd') and exists (select 1 from public.companies where id = :'kd'),
                   'delete_demo_company leaves a kept demo');

-- A client can be given access; a guest never.
insert into public.memberships (company_id, user_id, role) select :'kd', id, 'sales' from auth.users where email = 'client21@d.test';
select tests.check(exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
                            where m.company_id = :'kd' and u.email = 'client21@d.test'), 'a client can join a kept demo');
select tests.blocked_with(format('insert into public.memberships (company_id, user_id, role) values (%L, %L, ''sales'')', :'kd', :'g21'),
                          'Guest users cannot join this demo company%', 'a guest cannot join a kept demo');

-- An ordinary demo keeps its single user.
select tests.login('solo21@d.test'); set role authenticated;
select public.create_demo_company('small') as od \gset
reset role;
select tests.blocked_with(format('insert into public.memberships (company_id, user_id, role) select %L, id, ''sales'' from auth.users where email = ''client21@d.test''', :'od'),
                          'A demo company has a single user%', 'an ordinary demo still has a single user');
select tests.login('solo21@d.test'); set role authenticated;
select public.end_demo();
reset role;
select tests.check(not exists (select 1 from public.companies where id = :'od'), 'Exit demo still ends an ordinary demo');

-- LeMo Tech removes a kept demo by giving it an expiry.
update public.companies set demo_expires_at = now() - interval '1 minute' where id = :'kd';
select public.purge_demo_companies();
select tests.check(not exists (select 1 from public.companies where id = :'kd'), 'with an expiry the purge removes it');

\echo 'ALL KEPT DEMO TESTS PASSED'
