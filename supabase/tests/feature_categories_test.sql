-- Tests for feature categories and per-company feature switches in LeMoSp ADMIN.
-- Everything runs in one transaction that is rolled back, so later test files see the seed unchanged.
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

begin;

insert into auth.users (email) values ('bossfc@g.test'), ('adminfc@g.test');
select id as admin from auth.users where email = 'adminfc@g.test' \gset
select tests.login('bossfc@g.test'); set role authenticated;
select public.create_company('Categories Co') as co \gset
reset role;
insert into public.platform_admins (user_id) values (:'admin');

-- ---- 1. Seed -------------------------------------------------------------------------
select tests.check((select count(*) from public.feature_categories where name in ('Sales', 'Finance', 'Inventory')) = 3,
  'standard categories are seeded');
select tests.check(not exists (select 1 from public.features f
                                where not exists (select 1 from public.feature_categories c where c.name = f.module)),
  'every feature belongs to a category');

-- ---- 2. Normal users -----------------------------------------------------------------
select tests.login('bossfc@g.test'); set role authenticated;
select tests.check((select count(*) from public.feature_categories) > 0, 'everyone signed in can read the categories');
select tests.blocked($$insert into public.feature_categories (name) values ('Hacked')$$, 'normal users cannot add categories directly');
select tests.blocked($$select public.admin_save_feature_category(null, 'Hacked', null, 1)$$, 'normal users cannot add categories');
select tests.blocked($$select public.admin_delete_feature_category('Sales', 'Finance')$$, 'normal users cannot remove categories');
select tests.blocked($$select public.admin_set_feature_category('quotations', 'Finance')$$, 'normal users cannot move features');
select tests.blocked(format('select * from public.admin_company_features(%L)', :'co'), 'normal users cannot use the admin feature list');
select tests.blocked(format('select public.admin_set_company_category(%L, %L, false)', :'co', 'Sales'), 'normal users cannot switch a category');
reset role;

-- Two-step is required for admins too.
select tests.login_aal('adminfc@g.test', 'aal1'); set role authenticated;
select tests.blocked($$select public.admin_save_feature_category(null, 'Password only', null, 1)$$, 'admin tools need a two-step session');
reset role;

-- ---- 3. Managing categories ----------------------------------------------------------
select tests.login_aal('adminfc@g.test', 'aal2'); set role authenticated;
select public.admin_save_feature_category(null, '  Field work ', 'Work done at customer sites.', 55);
select tests.check((select sort = 55 and description = 'Work done at customer sites.' from public.feature_categories where name = 'Field work'),
  'admin adds a category (name trimmed)');
select tests.blocked($$select public.admin_save_feature_category(null, 'field WORK', null, 1)$$, 'category names are unique');
select tests.blocked($$select public.admin_save_feature_category(null, 'X', null, 1)$$, 'category names need 2 letters');
select public.admin_set_feature_category('deliveries', 'Field work');
select tests.check((select module from public.features where key = 'deliveries') = 'Field work', 'admin moves a feature into a category');
select tests.blocked($$select public.admin_set_feature_category('deliveries', 'Nowhere')$$, 'features only move to existing categories');
select tests.blocked($$select public.admin_set_feature_category('no_such_feature', 'Sales')$$, 'unknown features are refused');

select public.admin_save_feature_category('Field work', 'On site', null, 56);
select tests.check(not exists (select 1 from public.feature_categories where name = 'Field work')
                   and (select module from public.features where key = 'deliveries') = 'On site',
  'renaming a category keeps its features');
select tests.blocked($$select public.admin_save_feature_category('On site', 'Sales', null, 1)$$, 'cannot rename onto another category');

select tests.blocked($$select public.admin_delete_feature_category('On site', null)$$, 'a category with features needs a new home for them');
select tests.check(public.admin_delete_feature_category('On site', 'Logistics') = 1, 'removing a category reports the features moved');
select tests.check((select module from public.features where key = 'deliveries') = 'Logistics'
                   and not exists (select 1 from public.feature_categories where name = 'On site'),
  'removing a category moves its features');

insert into public.features (key, name, module, default_level, status) values ('fc_test', 'Test feature', 'Brand new group', 'small', 'live');
select tests.check(exists (select 1 from public.feature_categories where name = 'Brand new group'),
  'a new module name creates its category');

-- ---- 4. One company's features -------------------------------------------------------
select tests.check((select enabled and source = 'level' from public.admin_company_features(:'co') where key = 'quotations'),
  'admin sees which features a company has');
select tests.check(public.admin_set_company_category(:'co', 'Sales', false) > 0, 'admin switches a whole category off');
select tests.check((select bool_and(not enabled) from public.admin_company_features(:'co') m
                     join public.features f using (key) where f.module = 'Sales' and f.status = 'live' and f.active),
  'every live feature in the category is off');
select tests.check((select enabled from public.admin_company_features(:'co') where key = 'dashboard'), 'core features stay on');
select public.admin_set_company_category(:'co', 'Sales', null);
select tests.check((select enabled and source = 'level' from public.admin_company_features(:'co') where key = 'quotations'),
  'a category goes back to the level default');
select public.admin_set_company_feature(:'co', 'quotations', false);
select public.admin_set_company_feature(:'co', 'quotations', null);
select tests.check((select source from public.admin_company_features(:'co') where key = 'quotations') = 'level',
  'a single feature goes back to the level default');
select tests.blocked($$select * from public.admin_company_features('00000000-0000-0000-0000-000000000000')$$, 'unknown companies are refused');
reset role;

rollback;

select 'ALL FEATURE CATEGORY TESTS PASSED';
