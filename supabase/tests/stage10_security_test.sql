-- Tests for Stage 10b: two-step verification policy and automatic sign-out setting.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;
create or replace function tests.login_aal(p_email text, p_aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'email', p_email, 'role', 'authenticated', 'aal', p_aal)::text, false);
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

insert into auth.users (email) values ('boss11@s.test'), ('clerk11@s.test'), ('other11@s.test');
select id as clerk from auth.users where email = 'clerk11@s.test' \gset

-- A company with a manager, a sales member and a client.
select tests.login_aal('boss11@s.test', 'aal1'); set role authenticated;
select public.create_company('Secure Co') as co \gset
insert into public.clients (company_id, name) values (:'co', 'Secure Client');
reset role;
insert into public.memberships (company_id, user_id, role) values (:'co', :'clerk', 'sales');

-- Defaults
select tests.check((select not require_mfa and idle_timeout_minutes = 0 from public.companies where id = :'co'),
  'new companies do not require two-step and have no automatic sign-out');

-- Only management, only via the function
select tests.login_aal('clerk11@s.test', 'aal2'); set role authenticated;
select tests.blocked(format('select public.set_company_security(%L, false, 30)', :'co'), 'sales cannot change sign-in security');
select tests.blocked(format('update public.companies set require_mfa = true where id = %L', :'co'), 'members cannot set require_mfa directly');
reset role;
select tests.login_aal('boss11@s.test', 'aal1'); set role authenticated;
select tests.blocked(format('update public.companies set idle_timeout_minutes = 15 where id = %L', :'co'), 'even management cannot set the timeout directly');
select tests.blocked(format('select public.set_company_security(%L, false, 7)', :'co'), 'odd timeout values are refused');
select public.set_company_security(:'co', false, 30);
select tests.check((select idle_timeout_minutes = 30 from public.companies where id = :'co'), 'management sets automatic sign-out to 30 minutes');
select tests.blocked(format('select public.set_company_security(%L, true, 30)', :'co'),
  'management cannot require two-step before using it themselves');
reset role;

select tests.login_aal('boss11@s.test', 'aal2'); set role authenticated;
select public.set_company_security(:'co', true, 30);
select tests.check((select require_mfa from public.companies where id = :'co'), 'management with two-step can require it for everyone');
select tests.check((select count(*) = 1 from public.clients where company_id = :'co'), 'a two-step session still sees the data');
reset role;

-- Password-only sessions are locked out of the data
select tests.login_aal('clerk11@s.test', 'aal1'); set role authenticated;
select tests.check((select count(*) = 0 from public.clients where company_id = :'co'), 'password-only session sees no clients');
select tests.check((select count(*) = 0 from public.companies where id = :'co'), 'password-only session cannot read the company');
select tests.check(not public.is_member(:'co'), 'password-only session is not treated as a member');
select tests.blocked(format('insert into public.clients (company_id, name) values (%L, %L)', :'co', 'Sneaky'), 'password-only session cannot add clients');
select tests.check((select require_mfa from public.my_security_requirements() where company_id = :'co'),
  'the app can still learn that two-step is required');
select tests.check((select count(*) = 1 from public.memberships where company_id = :'co' and user_id = auth.uid()),
  'the person can still see their own membership');
reset role;
select tests.login_aal('clerk11@s.test', 'aal2'); set role authenticated;
select tests.check((select count(*) = 1 from public.clients where company_id = :'co'), 'after two-step the clerk sees the data again');
reset role;

-- Missing aal claim counts as password-only
select set_config('request.jwt.claims', json_build_object('sub', :'clerk', 'role', 'authenticated')::text, false);
set role authenticated;
select tests.check((select count(*) = 0 from public.clients where company_id = :'co'), 'a token without aal is treated as password-only');
reset role;

-- Other companies are unaffected
select tests.login_aal('other11@s.test', 'aal1'); set role authenticated;
select public.create_company('Relaxed Co') as relaxed \gset
insert into public.clients (company_id, name) values (:'relaxed', 'Relaxed Client');
select tests.check((select count(*) = 1 from public.clients where company_id = :'relaxed'), 'companies without the policy work with a password only');
select tests.check((select count(*) = 0 from public.clients where company_id = :'co'), 'and still cannot see other companies');
reset role;

-- Turning it off again
select tests.login_aal('boss11@s.test', 'aal2'); set role authenticated;
select public.set_company_security(:'co', false, 0);
reset role;
select tests.login_aal('clerk11@s.test', 'aal1'); set role authenticated;
select tests.check((select count(*) = 1 from public.clients where company_id = :'co'), 'after switching the policy off, a password is enough again');
reset role;

-- Demo companies cannot require two-step
insert into auth.users (is_anonymous) values (true) returning id as guest \gset
select set_config('request.jwt.claims', json_build_object('sub', :'guest', 'role', 'authenticated', 'is_anonymous', true, 'aal', 'aal2')::text, false);
set role authenticated;
select public.create_demo_company() as demo \gset
select tests.blocked(format('select public.set_company_security(%L, true, 0)', :'demo'), 'the demo cannot require two-step');
select public.set_company_security(:'demo', false, 15);
select tests.check((select idle_timeout_minutes = 15 from public.companies where id = :'demo'), 'the demo can still try automatic sign-out');
select public.end_demo();
reset role;

-- Visitors who are not signed in cannot call any of it
set role anon;
select tests.blocked(format('select public.set_company_security(%L, false, 0)', :'co'), 'anon cannot change security');
select tests.blocked('select * from public.my_security_requirements()', 'anon cannot read security requirements');
reset role;

-- ---- Review fixes -----------------------------------------------------------
-- Turn the policy back on for these checks
select tests.login_aal('boss11@s.test', 'aal2'); set role authenticated;
select public.set_company_security(:'co', true, 0);
reset role;

-- Own settings & phone notifications need two-step when a company requires it
select tests.login_aal('clerk11@s.test', 'aal1'); set role authenticated;
select tests.blocked(format('insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (%L, %L, %L, %L)',
  :'clerk', 'https://fcm.googleapis.com/fcm/send/x', 'k', 'a'), 'password-only session cannot register a phone for alerts');
select tests.check((select count(*) = 0 from public.profiles where id <> auth.uid()), 'password-only session cannot read colleagues'' contact details');
reset role;
select tests.login_aal('clerk11@s.test', 'aal2'); set role authenticated;
select tests.check((select count(*) >= 1 from public.profiles where id <> auth.uid()), 'with two-step, colleagues are visible again');
reset role;

-- Logo files: management only, through the two-step policy
select id as boss from auth.users where email = 'boss11@s.test' \gset
select tests.login_aal('boss11@s.test', 'aal1'); set role authenticated;
select tests.blocked(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'branding', :'co' || '/logo.png', :'boss'),
  'a stolen manager password cannot replace the logo');
reset role;
select tests.login_aal('boss11@s.test', 'aal2'); set role authenticated;
insert into storage.objects (bucket_id, name, owner) values ('branding', :'co' || '/logo.png', :'boss');
select tests.check(true, 'management with two-step can upload the logo');
reset role;

-- Demo companies cannot upload files
select set_config('request.jwt.claims', json_build_object('sub', :'guest', 'role', 'authenticated', 'is_anonymous', true)::text, false);
set role authenticated;
select public.create_demo_company() as demo2 \gset
select tests.blocked(format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', 'branding', :'demo2' || '/logo.png', :'guest'),
  'demo guests cannot upload logo files');
select public.end_demo();
reset role;

-- Who has two-step, and resetting a lost phone
insert into auth.mfa_factors (user_id) select id from auth.users where email in ('boss11@s.test', 'clerk11@s.test');
select tests.login_aal('clerk11@s.test', 'aal2'); set role authenticated;
select tests.blocked(format('select * from public.team_mfa_status(%L)', :'co'), 'sales cannot see the team''s two-step status');
reset role;
select tests.login_aal('boss11@s.test', 'aal1'); set role authenticated;
select tests.blocked(format('select * from public.team_mfa_status(%L)', :'co'), 'a password-only manager session cannot see it either');
reset role;
select tests.login_aal('boss11@s.test', 'aal2'); set role authenticated;
select tests.check((select count(*) = 2 and bool_and(has_mfa) from public.team_mfa_status(:'co')), 'management sees who has two-step on');
select id as clerk_m from public.memberships where company_id = :'co' and user_id = :'clerk' \gset
select id as boss_m from public.memberships where company_id = :'co' and user_id = :'boss' \gset
select tests.blocked(format('select public.reset_member_mfa(%L)', :'boss_m'), 'managers cannot reset their own two-step');
select public.reset_member_mfa(:'clerk_m');
select tests.check((select not has_mfa from public.team_mfa_status(:'co') where user_id = :'clerk'), 'management resets a member''s lost authenticator');
reset role;
select tests.check((select count(*) = 0 from auth.mfa_factors where user_id = :'clerk'), 'the member''s authenticator is removed');
select tests.check((select count(*) = 1 from auth.mfa_factors where user_id = :'boss'), 'nobody else is affected');

-- Cannot reset someone who also works for another company
insert into auth.mfa_factors (user_id) values (:'clerk');
reset role;
insert into public.memberships (company_id, user_id, role) values (:'relaxed', :'clerk', 'sales');
select tests.login_aal('boss11@s.test', 'aal2'); set role authenticated;
select tests.blocked(format('select public.reset_member_mfa(%L)', :'clerk_m'), 'cannot reset a person who also works for a company you don''t manage');
reset role;
set role anon;
select tests.blocked(format('select public.reset_member_mfa(%L)', :'clerk_m'), 'anon cannot reset two-step');
reset role;
