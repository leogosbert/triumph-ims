-- Tests for the Stage 1 security rules. Run on a scratch database after
-- supabase_stub.sql and the migrations (see supabase/tests/run.sh).
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated;

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
grant execute on all functions in schema tests to authenticated;

insert into auth.users (email, raw_user_meta_data) values
  ('leo@triumph.test',     '{"full_name":"Leo Manager"}'),
  ('sara@triumph.test',    '{"full_name":"Sara Sales"}'),
  ('outsider@other.test',  '{"full_name":"Olivia Outsider"}');

-- ---- Leo creates the company ---------------------------------------
select tests.login('leo@triumph.test');
set role authenticated;

select public.create_company('TRIUMPH General Suppliers Ltd') as cid \gset
select tests.check((select count(*) from public.companies) = 1, 'creator sees the new company');
select tests.check((select role from public.memberships where user_id = auth.uid()) = 'management', 'creator becomes management');
select tests.check((select full_name from public.profiles where id = auth.uid()) = 'Leo Manager', 'profile created from sign-up name');

update public.companies set tin = '123-456-789', primary_color = '#0F7C83' where id = :'cid';
select tests.check((select tin from public.companies where id = :'cid') = '123-456-789', 'management can edit company details');
select tests.blocked(format('update public.companies set created_by = null where id = %L', :'cid'), 'nobody can change who created the company');
select tests.blocked(format('update public.companies set primary_color = %L where id = %L', 'blue', :'cid'), 'colours must be #RRGGBB');
select tests.blocked(format('insert into public.memberships (company_id, user_id, role) values (%L, auth.uid(), %L)', :'cid', 'sales'), 'memberships cannot be written directly');
select tests.blocked('insert into public.audit_log (company_id, action, entity) values (gen_random_uuid(), ''x'', ''y'')', 'activity log cannot be written directly');

select public.invite_member(:'cid', '  Sara@Triumph.TEST ', 'sales') as inv \gset
select tests.check((select email from public.invitations where id = :'inv') = 'sara@triumph.test', 'invitation email is normalised');
select tests.blocked(format('select public.invite_member(%L, %L, %L)', :'cid', 'sara@triumph.test', 'finance'), 'no duplicate open invitation');
select tests.blocked(format('select public.invite_member(%L, %L, %L)', :'cid', 'not-an-email', 'finance'), 'invalid email refused');
select tests.blocked('select public.update_membership((select id from public.memberships where user_id = auth.uid()), ''sales'', true)', 'last manager cannot demote themselves');
select public.invite_member(:'cid', 'someone@else.test', 'finance') as inv2 \gset
reset role;

-- ---- An outsider sees nothing --------------------------------------
select tests.login('outsider@other.test');
set role authenticated;
select tests.check((select count(*) from public.companies) = 0, 'outsider cannot see the company');
select tests.check((select count(*) from public.memberships) = 0, 'outsider cannot see memberships');
select tests.check((select count(*) from public.profiles) = 1, 'outsider sees only own profile');
select tests.check((select count(*) from public.invitations) = 0, 'outsider cannot see invitations');
select tests.check((select count(*) from public.my_invitations()) = 0, 'outsider has no invitations');
select tests.blocked(format('select public.accept_invitation(%L)', :'inv'), 'outsider cannot accept someone else''s invitation');
select tests.blocked(format('select public.invite_member(%L, %L, %L)', :'cid', 'x@y.test', 'sales'), 'outsider cannot invite');
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'branding', :'cid' || '/logo.png'), 'outsider cannot upload a logo');
update public.companies set name = 'Hacked' where id = :'cid';
reset role;
select tests.check((select name from public.companies where id = :'cid') = 'TRIUMPH General Suppliers Ltd', 'outsider update has no effect');

-- ---- Sara accepts and works as Sales -------------------------------
select tests.login('sara@triumph.test');
set role authenticated;
select tests.check((select count(*) from public.companies) = 0, 'before accepting, Sara sees nothing');
select tests.check((select company_name from public.my_invitations()) = 'TRIUMPH General Suppliers Ltd', 'Sara sees her invitation with company name');
select public.accept_invitation(:'inv');
select tests.check((select count(*) from public.companies) = 1, 'after accepting, Sara sees the company');
select tests.check((select count(*) from public.profiles) = 2, 'Sara sees colleague profiles');
select tests.check((select count(*) from public.audit_log) = 0, 'Sales cannot read the activity log');
select tests.check((select count(*) from public.invitations) = 0, 'Sales cannot see invitations');
select tests.blocked(format('select public.invite_member(%L, %L, %L)', :'cid', 'x@y.test', 'sales'), 'Sales cannot invite');
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'branding', :'cid' || '/logo.png'), 'Sales cannot upload a logo');
update public.companies set name = 'Sara Co' where id = :'cid';
select tests.check((select name from public.companies where id = :'cid') = 'TRIUMPH General Suppliers Ltd', 'Sales cannot rename the company');
update public.profiles set full_name = 'Sara S.' where id = auth.uid();
select tests.check((select full_name from public.profiles where id = auth.uid()) = 'Sara S.', 'user can edit own name');
reset role;

-- ---- Leo manages the team ------------------------------------------
select tests.login('leo@triumph.test');
set role authenticated;
insert into storage.objects (bucket_id, name) values ('branding', :'cid' || '/logo.png');
select tests.check(true, 'management can upload the logo');
select public.update_membership((select id from public.memberships where user_id <> auth.uid()), 'procurement', true);
select tests.check((select role from public.memberships where user_id <> auth.uid()) = 'procurement', 'management can change a role');
select public.revoke_invitation(:'inv2');
select tests.check((select revoked_at is not null from public.invitations where id = :'inv2'), 'management can revoke an invitation');
select tests.check((select count(*) from public.audit_log where entity = 'companies' and action = 'update' and details ? 'tin') = 1, 'company edit logged with changed field');
select tests.check((select details -> 'role' ->> 'to' from public.audit_log where entity = 'memberships' and action = 'update' order by id desc limit 1) = 'procurement', 'role change logged');
select tests.check((select count(*) from public.audit_log where actor_id is null) = 0, 'every log row has an actor');
select public.update_membership((select id from public.memberships where user_id <> auth.uid()), 'procurement', false);
reset role;

select tests.login('sara@triumph.test');
set role authenticated;
select tests.check((select count(*) from public.companies) = 0, 'switched-off user loses access');
reset role;

\echo 'ALL STAGE 1 TESTS PASSED'
