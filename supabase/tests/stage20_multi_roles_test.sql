-- Tests for multiple roles per person (memberships.extra_roles, set_member_roles).
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

insert into auth.users (email) values ('boss20@m.test'), ('sam20@m.test'), ('wendy20@m.test'), ('newbie20@m.test');
select id as sam from auth.users where email = 'sam20@m.test' \gset
select id as wendy from auth.users where email = 'wendy20@m.test' \gset

select tests.login('boss20@m.test'); set role authenticated;
select public.create_company('Multi Role Co') as co \gset
reset role;
insert into public.memberships (company_id, user_id, role) values (:'co', :'sam', 'sales');
insert into public.memberships (company_id, user_id, role) values (:'co', :'wendy', 'warehouse');
select id as m_boss from public.memberships where company_id = :'co' and role = 'management' \gset
select id as m_sam from public.memberships where company_id = :'co' and user_id = :'sam' \gset
select id as m_wendy from public.memberships where company_id = :'co' and user_id = :'wendy' \gset
insert into public.suppliers (company_id, name) values (:'co', 'Bill Supplier') returning id as sup \gset
insert into public.supplier_bills (company_id, supplier_id, supplier_invoice_no, subtotal) values (:'co', :'sup', 'SB-20', 50000);

select tests.check((select extra_roles = '{}' from public.memberships where id = :'m_sam'), 'everyone starts with no extra roles');

-- Sales alone cannot see supplier bills (management, finance, procurement).
select tests.login('sam20@m.test'); set role authenticated;
select tests.check((select count(*) = 0 from public.supplier_bills where company_id = :'co'), 'sales alone does not see supplier bills');
select tests.check(not public.has_role(:'co', array['finance']::public.app_role[]), 'sales is not finance');
-- Only management sets roles; nobody gives themselves more.
select tests.blocked(format('select public.set_member_roles(%L, %L, %L)', :'m_sam', 'sales', '{finance}'), 'sales cannot give themselves an extra role');
select tests.blocked(format('select public.set_member_roles(%L, %L, %L)', :'m_wendy', 'warehouse', '{management}'), 'sales cannot change a colleague''s roles');
select tests.blocked(format('update public.memberships set extra_roles = %L where id = %L', '{finance}', :'m_sam'), 'nobody writes extra_roles directly');
reset role;

-- Management adds finance as an extra role: access follows.
select tests.login('boss20@m.test'); set role authenticated;
select public.set_member_roles(:'m_sam', 'sales', '{finance,sales,finance}');
reset role;
select tests.check((select role = 'sales' and extra_roles = '{finance}' from public.memberships where id = :'m_sam'),
  'main role kept, duplicates and the main role are dropped from the extras');
select tests.login('sam20@m.test'); set role authenticated;
select tests.check(public.has_role(:'co', array['finance']::public.app_role[]), 'an extra role counts in has_role');
select tests.check(public.has_role(:'co', array['sales']::public.app_role[]), 'the main role still counts');
select tests.check((select count(*) = 1 from public.supplier_bills where company_id = :'co'), 'extra finance role: sales now sees supplier bills');
select tests.check(not public.is_manager(:'co'), 'finance extra does not make someone management');
reset role;

-- Notifications reach people through an extra role.
select public.notify_roles(:'co', array['finance']::public.app_role[], null, 'test', 'info', 'For finance', 'x', '/', 'multi-role-test');
select tests.check((select count(*) = 1 from public.notifications where user_id = :'sam' and dedupe_key = 'multi-role-test'),
  'notify_roles reaches someone whose extra role matches');

-- Removing the extra role takes the access away again.
select tests.login('boss20@m.test'); set role authenticated;
select public.set_member_roles(:'m_sam', 'sales', '{}');
reset role;
select tests.login('sam20@m.test'); set role authenticated;
select tests.check((select count(*) = 0 from public.supplier_bills where company_id = :'co'), 'extra role removed: supplier bills hidden again');
select tests.check(not public.has_role(:'co', array['finance']::public.app_role[]), 'extra role removed: has_role is false');
reset role;

-- An extra management role makes someone a manager, who can then manage roles.
select tests.login('boss20@m.test'); set role authenticated;
select public.set_member_roles(:'m_wendy', 'warehouse', '{management}');
reset role;
select tests.login('wendy20@m.test'); set role authenticated;
select tests.check(public.is_manager(:'co'), 'extra management role: is_manager is true');
select public.set_member_roles(:'m_sam', 'sales', '{procurement}');
select tests.check((select extra_roles = '{procurement}' from public.memberships where id = :'m_sam'), 'a manager by extra role can set roles');
reset role;

-- The last manager is protected, whether management is the main role or an extra one.
select tests.login('boss20@m.test'); set role authenticated;
select public.set_member_roles(:'m_boss', 'finance', '{}');
select tests.check((select role = 'finance' from public.memberships where id = :'m_boss'), 'a manager can step down while another manager (by extra role) remains');
reset role;
select tests.login('wendy20@m.test'); set role authenticated;
select tests.blocked(format('select public.set_member_roles(%L, %L, %L)', :'m_wendy', 'warehouse', '{}'),
  'the last manager (by extra role) cannot remove their management');
select tests.blocked(format('select public.update_membership(%L, %L, false)', :'m_wendy', 'warehouse'),
  'the last manager (by extra role) cannot be switched off');
select public.update_membership(:'m_wendy', 'management', true);
select tests.check((select role = 'management' and extra_roles = '{}' from public.memberships where id = :'m_wendy'),
  'making an extra role the main role removes it from the extras');
select tests.blocked(format('select public.update_membership(%L, %L, true)', :'m_wendy', 'warehouse'),
  'the last manager cannot be demoted with update_membership either');
select public.set_member_roles(:'m_boss', 'finance', '{management}');
select public.update_membership(:'m_wendy', 'warehouse', true);
select tests.check((select role = 'warehouse' from public.memberships where id = :'m_wendy'),
  'demoting is fine while another manager (by extra role) remains');
reset role;

-- Invitations can carry extra roles; they are copied on joining.
select tests.login('boss20@m.test'); set role authenticated;
select public.invite_member(:'co', 'newbie20@m.test', 'warehouse', '{driver,warehouse}') as inv \gset
select tests.check((select extra_roles = '{driver}' from public.invitations where id = :'inv'), 'invitation keeps the extra roles (without the main role)');
select public.invite_member(:'co', 'other20@m.test', 'sales');
reset role;
select tests.login('sam20@m.test'); set role authenticated;
select tests.blocked(format('select public.invite_member(%L, %L, %L, %L)', :'co', 'x20@m.test', 'sales', '{management}'), 'only management invites with extra roles');
reset role;
select tests.login('newbie20@m.test'); set role authenticated;
select public.accept_invitation(:'inv');
reset role;
select tests.check((select role = 'warehouse' and extra_roles = '{driver}' from public.memberships m join auth.users u on u.id = m.user_id
                     where m.company_id = :'co' and u.email = 'newbie20@m.test'), 'joining copies the extra roles');
