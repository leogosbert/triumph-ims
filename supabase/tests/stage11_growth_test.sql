-- Tests for Stage 11: business levels, features, growth recommendations,
-- the Suggestion Box and platform administration.
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
create or replace function tests.login_guest(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'is_anonymous', true)::text, false);
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

insert into auth.users (email) values ('boss12@g.test'), ('sales12@g.test'), ('ware12@g.test'), ('fin12@g.test'),
  ('extra12a@g.test'), ('extra12b@g.test'), ('other12@g.test'), ('admin12@g.test');
insert into auth.users (is_anonymous) values (true) returning id as guest \gset
select id as boss from auth.users where email = 'boss12@g.test' \gset
select id as sales from auth.users where email = 'sales12@g.test' \gset
select id as ware from auth.users where email = 'ware12@g.test' \gset
select id as fin from auth.users where email = 'fin12@g.test' \gset
select id as other_boss from auth.users where email = 'other12@g.test' \gset
select id as admin from auth.users where email = 'admin12@g.test' \gset

select tests.login('boss12@g.test'); set role authenticated;
select public.create_company('Growth Co') as co \gset
reset role;
insert into public.memberships (company_id, user_id, role) values
  (:'co', :'sales', 'sales'), (:'co', :'ware', 'warehouse'), (:'co', :'fin', 'finance');
select tests.login('other12@g.test'); set role authenticated;
select public.create_company('Other Co 12') as other \gset
reset role;

-- ---- 1. New companies and the catalogue ---------------------------------------
select tests.login('boss12@g.test'); set role authenticated;
select tests.check((select business_level = 'medium' and not onboarding_done and level_changed_at is null
                     from public.companies where id = :'co') and public.company_profile(:'co') = '{}'::jsonb,
  'a new company starts at medium, not yet onboarded, with no profile');
select tests.check((select string_agg(key, ',' order by key) from public.features where core)
                   = 'activity,dashboard,data_export,notifications,security_policy,suggestions,team', 'seven core features');
select tests.check((select bool_and(default_level = 'small') from public.features where core or key = 'goods_received'),
  'core features and goods received belong to the small level');
select tests.check((select count(*) from public.features) = 54, 'catalogue has 54 features (Stage 13 added reminders)');
select tests.check((select count(*) from public.features where status = 'live') = 52
                   and (select count(*) from public.features where status = 'planned') = 2, '52 live and 2 planned features (Stage 15 made eight more live)');
select tests.check((select bool_and(jsonb_array_length(tutorial) between 2 and 4 and description is not null
                                    and audience is not null and benefits is not null) from public.features),
  'every feature has a description, audience, benefits and a 2-4 step tutorial');
select tests.check((select count(*) from public.recommendation_rules) = 15, '15 recommendation rules');
select tests.check((select count(*) from public.company_feature_map(:'co')) = 54, 'feature map lists the whole catalogue');
select tests.check((select count(*) from public.company_feature_map(:'co') where enabled) = 44, 'medium: all live features on');
select tests.check((select bool_and(not enabled) from public.company_feature_map(:'co') where status = 'planned'),
  'planned features are never on');
select tests.check((select bool_and(source = 'level') from public.company_feature_map(:'co')), 'without choices everything follows the level');
select tests.check(public.feature_enabled(:'co', 'supplier_rfqs'), 'feature_enabled: supplier comparison on at medium');
select tests.check(not public.feature_enabled(:'co', 'ai_assistant'), 'feature_enabled: planned feature off');
select tests.check(not public.is_platform_admin(), 'a manager is not a platform admin');

-- ---- 2. Business level and feature switches ------------------------------------
select public.set_business_level(:'co', 'small', '{"employees": 4, "imports": false, "activities": ["general_supplier"]}');
select tests.check((select business_level = 'small' and onboarding_done and level_changed_at is not null
                     from public.companies where id = :'co') and public.company_profile(:'co') ->> 'employees' = '4',
  'set_business_level: small, onboarded, profile saved');
select tests.check((select count(*) from public.company_feature_map(:'co') where enabled) = 24, 'small: 24 features on (19 + the five Stage 13 features)');
select tests.check((select enabled from public.company_feature_map(:'co') where key = 'goods_received'), 'small: goods received on');
select tests.check((select enabled from public.company_feature_map(:'co') where key = 'customers'), 'small: customers on');
select tests.check(not (select enabled from public.company_feature_map(:'co') where key = 'supplier_rfqs'), 'small: supplier comparison off');
select public.set_company_feature(:'co', 'supplier_rfqs', true);
select tests.check((select enabled and source = 'manual' from public.company_feature_map(:'co') where key = 'supplier_rfqs'),
  'switching on a medium feature in small mode');
select tests.check(public.feature_enabled(:'co', 'supplier_rfqs'), 'feature_enabled follows the switch');
select public.set_company_feature(:'co', 'deliveries', false);
select tests.check(not (select enabled from public.company_feature_map(:'co') where key = 'deliveries'), 'switching off a small feature');
select tests.blocked(format('select public.set_company_feature(%L, %L, false)', :'co', 'activity'), 'core features cannot be switched off');
select tests.blocked(format('select public.set_company_feature(%L, %L, false)', :'co', 'security_policy'), 'two-step settings are always available');
select public.set_company_feature(:'co', 'dashboard', true);
select tests.check((select enabled from public.company_feature_map(:'co') where key = 'dashboard'), 'switching a core feature on is harmless');
select tests.blocked(format('select public.set_company_feature(%L, %L, true)', :'co', 'ai_assistant'), 'planned features cannot be switched on');
select tests.blocked(format('select public.set_company_feature(%L, %L, true)', :'co', 'nonsense'), 'unknown features are refused');
select tests.blocked(format('select public.set_business_level(%L, null)', :'co'), 'a level is required');
select tests.blocked(format('select public.set_business_level(%L, %L, %L)', :'co', 'small', '[1,2]'), 'the profile must be an object');

select public.set_business_level(:'co', 'enterprise');
select tests.check((select count(*) from public.company_feature_map(:'co') where enabled) = 51,
  'enterprise: all live features except the one switched off');
select tests.check((select bool_and(not enabled) from public.company_feature_map(:'co') where status = 'planned'),
  'enterprise planned features stay off');
select public.set_business_level(:'co', 'small', '{"customers": 40}');
select tests.check(public.company_profile(:'co') ->> 'employees' = '4' and public.company_profile(:'co') ->> 'customers' = '40',
  'profile answers are merged');
select tests.check((select enabled from public.company_feature_map(:'co') where key = 'supplier_rfqs')
                   and not (select enabled from public.company_feature_map(:'co') where key = 'deliveries'),
  'changing level keeps the company''s own choices');
select public.set_company_feature(:'co', 'deliveries', null);
select tests.check((select enabled and source = 'level' from public.company_feature_map(:'co') where key = 'deliveries'),
  'null puts a feature back to the level default');
select tests.check((select count(*) from public.audit_log where company_id = :'co' and entity = 'companies'
                     and details ? 'business_level') >= 3, 'level changes are in the activity history');
select tests.check((select count(*) from public.audit_log where company_id = :'co' and entity = 'company_features') = 4,
  'feature switches are in the activity history');

-- Direct writes are not possible
select tests.blocked(format('update public.companies set business_level = %L where id = %L', 'enterprise', :'co'),
  'business level cannot be changed directly');
select tests.blocked(format('update public.companies set onboarding_done = false where id = %L', :'co'),
  'onboarding flag cannot be changed directly');
select tests.blocked(format('insert into public.company_features (company_id, feature_key, enabled) values (%L, %L, true)', :'co', 'landed_cost'),
  'company features cannot be written directly');
select tests.blocked(format('insert into public.company_profiles (company_id, profile) values (%L, %L)', :'other', '{}'),
  'profiles cannot be written directly');
select tests.blocked(format('update public.company_profiles set profile = %L where company_id = %L', '{}', :'co'),
  'profiles cannot be edited directly');
select tests.blocked('select count(*) from public.company_growth_state', 'growth check housekeeping is private');
select tests.blocked(format('insert into public.features (key, name) values (%L, %L)', 'hack_feature', 'Hack'),
  'normal users cannot add catalogue features');
update public.features set name = 'Hacked' where key = 'dashboard';
select tests.check((select name from public.features where key = 'dashboard') = 'Dashboard', 'normal users cannot edit catalogue features');
update public.recommendation_rules set threshold = 1 where key = 'stores';
select tests.check((select threshold from public.recommendation_rules where key = 'stores') = 2, 'normal users cannot edit rules');
select tests.blocked(format('insert into public.recommendation_rules (key, title, metric, threshold, target_level, applies_to) values (%L, %L, %L, 1, %L, %L)',
  'hack_rule', 'Hack', 'members', 'medium', '{small}'), 'normal users cannot add rules');
reset role;

-- Other members and other companies
select tests.login('sales12@g.test'); set role authenticated;
select tests.check((select count(*) from public.company_feature_map(:'co')) = 54, 'members can read the feature map');
select tests.check((select count(*) from public.company_features where company_id = :'co') = 2, 'members can read the company''s switches');
select tests.check((select count(*) from public.company_profiles) = 0, 'sales cannot read the business profile');
select tests.blocked(format('select public.company_profile(%L)', :'co'), 'sales cannot ask for the business profile');
select tests.blocked(format('select public.set_company_feature(%L, %L, true)', :'co', 'landed_cost'), 'sales cannot switch features');
select tests.blocked(format('select public.set_business_level(%L, %L)', :'co', 'medium'), 'sales cannot change the level');
select tests.blocked(format('select public.company_metrics(%L)', :'co'), 'sales cannot see company figures');
select tests.blocked(format('select public.run_growth_check(%L)', :'co'), 'sales cannot run the growth check');
reset role;
select tests.login('other12@g.test'); set role authenticated;
select tests.blocked(format('select * from public.company_feature_map(%L)', :'co'), 'another company cannot read the feature map');
select tests.check(not public.feature_enabled(:'co', 'customers'), 'feature_enabled is false for outsiders');
select tests.check((select count(*) from public.company_features where company_id = :'co') = 0, 'outsiders see no switches');
select tests.blocked(format('select public.set_company_feature(%L, %L, true)', :'co', 'landed_cost'), 'another company cannot switch features');
select tests.blocked(format('select public.set_business_level(%L, %L)', :'co', 'medium'), 'another company cannot change the level');
reset role;

-- ---- 3. Company figures ---------------------------------------------------------
insert into public.memberships (company_id, user_id, role)
select :'co', id, 'sales' from auth.users where email = 'extra12a@g.test';
select tests.login('boss12@g.test'); set role authenticated;
insert into public.clients (company_id, name, credit_limit) values
  (:'co', 'Credit One', 100000000), (:'co', 'Credit Two', 5000000), (:'co', 'Credit Three', 1000000), (:'co', 'Cash Client', 0);
select id as cl1 from public.clients where company_id = :'co' and name = 'Credit One' \gset
insert into public.suppliers (company_id, name) values (:'co', 'Supplier A'), (:'co', 'Supplier B');
insert into public.products (company_id, sku, name) select :'co', 'G' || g, 'Growth product ' || g from generate_series(1, 155) g;
insert into public.warehouses (company_id, code, name) values (:'co', 'W2', 'Second store');
insert into public.exchange_rates (company_id, currency, rate) values (:'co', 'USD', 2500);
insert into public.invoices (company_id, client_id, vat_rate) values (:'co', :'cl1', 0) returning id as inv1 \gset
insert into public.invoice_lines (company_id, invoice_id, description, quantity, unit_price) values (:'co', :'inv1', 'Big order', 1, 20000000);
select public.issue_invoice(:'inv1');
insert into public.invoices (company_id, client_id, currency, vat_rate) values (:'co', :'cl1', 'USD', 0) returning id as inv2 \gset
insert into public.invoice_lines (company_id, invoice_id, description, quantity, unit_price) values (:'co', :'inv2', 'Dollar order', 1, 5000);
select public.issue_invoice(:'inv2');
select public.company_metrics(:'co') as m \gset
select tests.check((:'m'::jsonb ->> 'members')::int = 5, 'metrics: 5 active members');
select tests.check((:'m'::jsonb ->> 'clients')::int = 4, 'metrics: 4 clients');
select tests.check((:'m'::jsonb ->> 'credit_clients')::int = 3, 'metrics: 3 clients on credit');
select tests.check((:'m'::jsonb ->> 'suppliers')::int = 2, 'metrics: 2 suppliers');
select tests.check((:'m'::jsonb ->> 'products')::int = 155, 'metrics: 155 products');
select tests.check((:'m'::jsonb ->> 'warehouses')::int = 2, 'metrics: 2 stores');
select tests.check((:'m'::jsonb ->> 'invoices_30d')::int = 2, 'metrics: 2 invoices issued');
select tests.check((:'m'::jsonb ->> 'revenue_30d')::numeric = 32500000, 'metrics: revenue in base currency (20M + 5,000 USD x 2,500)');
select tests.check((:'m'::jsonb ->> 'receivables_open')::numeric = 32500000, 'metrics: open receivables in base currency');
select tests.check((:'m'::jsonb ->> 'foreign_docs_90d')::int = 1, 'metrics: one foreign-currency document');
select tests.check((:'m'::jsonb ->> 'quotations_30d')::int = 0 and (:'m'::jsonb ->> 'purchase_orders_30d')::int = 0
                   and (:'m'::jsonb ->> 'deliveries_30d')::int = 0 and (:'m'::jsonb ->> 'suggestions_30d')::int = 0,
  'metrics: no quotations, orders, deliveries or suggestions yet');

-- ---- 4. Growth recommendations ---------------------------------------------------
select public.set_company_feature(:'co', 'multi_currency', true);
select tests.check(public.run_growth_check(:'co') = 5, 'growth check creates 5 recommendations');
select tests.check((select count(*) from public.company_recommendations where company_id = :'co') = 5, 'five recommendations stored');
select tests.check((select reason from public.company_recommendations where company_id = :'co' and rule_key = 'products_inventory')
                   = 'Your catalogue has grown to 155 products. Reorder levels and low-stock alerts help you buy in time and avoid running out.',
  'reason is filled with the real number');
select tests.check((select reason from public.company_recommendations where company_id = :'co' and rule_key = 'small_to_medium_sales')
                   = 'Sales in the last 30 days reached TZS 32,500,000.', 'large numbers get thousands separators');
select tests.check((select metric_value = 3 and threshold = 3 and feature_key = 'credit_management' and status = 'new'
                     from public.company_recommendations where company_id = :'co' and rule_key = 'credit_customers'),
  'recommendation keeps value, threshold and feature');
select tests.check((select bool_and(reason not like '%{%') from public.company_recommendations where company_id = :'co'),
  'no placeholders left in reasons');
select tests.check((select count(*) from public.company_recommendations where company_id = :'co' and rule_key = 'foreign_currency') = 0,
  'features already on are not recommended');
select tests.check((select count(*) from public.company_recommendations where company_id = :'co' and rule_key = 'supplier_compare') = 0,
  'rules whose condition is not met are skipped');
select tests.check((select count(*) from public.notifications where kind = 'growth' and link = '/growth') = 5,
  'the manager is notified of each new recommendation');
reset role;
select tests.check((select count(*) from public.notifications where kind = 'growth' and company_id = :'co' and user_id <> :'boss') = 0,
  'other roles are not notified');
select tests.login('sales12@g.test'); set role authenticated;
select tests.check((select count(*) from public.company_recommendations) = 0, 'sales cannot see recommendations');
reset role;

-- Rate limit and forcing
insert into public.memberships (company_id, user_id, role)
select :'co', id, 'sales' from auth.users where email = 'extra12b@g.test';
select tests.login('boss12@g.test'); set role authenticated;
select tests.check(public.run_growth_check(:'co') = 0, 'a second check within 10 minutes does nothing');
select tests.check((select count(*) from public.company_recommendations where rule_key = 'small_to_medium_team') = 0,
  'nothing new while rate limited');
select count(*) as audit_before from public.audit_log where company_id = :'co' \gset
select tests.check(public.run_growth_check(:'co', true) = 1, 'forcing the check finds the 6-person team');
select tests.check((select count(*) from public.audit_log where company_id = :'co') = :audit_before,
  'growth checks leave no trace in the activity history');
select tests.check((select reason from public.company_recommendations where rule_key = 'small_to_medium_team')
                   = 'Your team has grown to 6 people.', 'level recommendation reason');

-- Answers
select id as r_products from public.company_recommendations where rule_key = 'products_inventory' \gset
select id as r_credit from public.company_recommendations where rule_key = 'credit_customers' \gset
select id as r_stores from public.company_recommendations where rule_key = 'stores' \gset
select id as r_team from public.company_recommendations where rule_key = 'team_approvals' \gset
select id as r_sales from public.company_recommendations where rule_key = 'small_to_medium_sales' \gset
select id as r_size from public.company_recommendations where rule_key = 'small_to_medium_team' \gset
select public.respond_recommendation(:'r_products', 'seen');
select tests.check((select status from public.company_recommendations where id = :'r_products') = 'seen', 'mark as seen');
select public.respond_recommendation(:'r_credit', 'postpone', 7);
select tests.check((select status = 'postponed' and postponed_until > now() + interval '6 days'
                     from public.company_recommendations where id = :'r_credit'), 'postpone for 7 days');
select public.respond_recommendation(:'r_stores', 'dismiss');
select tests.check((select status from public.company_recommendations where id = :'r_stores') = 'dismissed', 'dismiss');
select public.respond_recommendation(:'r_team', 'accept');
select tests.check((select status from public.company_recommendations where id = :'r_team') = 'accepted', 'accept');
select tests.check((select enabled and source = 'recommendation' from public.company_feature_map(:'co') where key = 'approvals'),
  'accepting switches the feature on');
select tests.blocked(format('select public.respond_recommendation(%L, %L)', :'r_products', 'maybe'), 'unknown answers are refused');
select tests.blocked(format('select public.respond_recommendation(%L, %L, 0)', :'r_products', 'postpone'), 'postponing needs 1-365 days');
select tests.blocked(format('select public.respond_recommendation(%L, %L)', :'r_team', 'dismiss'), 'an accepted recommendation is final');
select tests.check((select count(*) from public.audit_log where company_id = :'co' and entity = 'company_recommendations') = 4,
  'answers are in the activity history');
reset role;
select tests.login('sales12@g.test'); set role authenticated;
select tests.blocked(format('select public.respond_recommendation(%L, %L)', :'r_products', 'dismiss'), 'sales cannot answer recommendations');
reset role;

-- Re-checking: values refresh, dismissed/postponed/accepted stay put
select tests.login('boss12@g.test'); set role authenticated;
insert into public.products (company_id, sku, name) select :'co', 'H' || g, 'More product ' || g from generate_series(1, 5) g;
select tests.check(public.run_growth_check(:'co', true) = 0, 'nothing new on a forced re-check');
select tests.check((select status = 'seen' and reason like 'Your catalogue has grown to 160 products.%'
                     from public.company_recommendations where id = :'r_products'), 'open recommendations get fresh figures');
select tests.check((select status from public.company_recommendations where id = :'r_stores') = 'dismissed', 'dismissed stays dismissed');
select tests.check((select status from public.company_recommendations where id = :'r_credit') = 'postponed', 'postponed stays postponed until its date');
reset role;
update public.company_recommendations set postponed_until = now() - interval '1 minute' where id = :'r_credit';
select count(*) as growth_before from public.notifications where kind = 'growth' and user_id = :'boss' \gset
select tests.login('boss12@g.test'); set role authenticated;
select tests.check(public.run_growth_check(:'co', true) = 0, 'a returning recommendation is not counted as new');
select tests.check((select status = 'new' and postponed_until is null from public.company_recommendations where id = :'r_credit'),
  'a postponed recommendation comes back after its date');
select tests.check((select count(*) from public.notifications where kind = 'growth') = :growth_before + 1,
  'the manager is reminded when it comes back');
select tests.check((select status from public.company_recommendations where id = :'r_stores') = 'dismissed', 'dismissed never comes back');

-- Accepting a level change
select public.respond_recommendation(:'r_sales', 'accept');
select tests.check((select business_level from public.companies where id = :'co') = 'medium', 'accepting a level recommendation changes the level');
select tests.check((select status from public.company_recommendations where id = :'r_size') = 'accepted',
  'other recommendations for the same level are done too');
select tests.check((select count(*) from public.products where company_id = :'co') = 160
                   and (select count(*) from public.invoices where company_id = :'co') = 2, 'no data lost when the level changes');
reset role;

-- Rules at or below the current level, and planned features, are skipped
insert into public.recommendation_rules (key, title, metric, threshold, target_level, applies_to, message)
values ('test_same_level', 'Same level', 'members', 1, 'medium', '{medium}', 'x');
insert into public.recommendation_rules (key, title, metric, threshold, feature_key, applies_to, message)
values ('test_planned', 'Planned', 'members', 1, 'ai_assistant', '{medium}', 'x');
select tests.login('boss12@g.test'); set role authenticated;
select tests.check(public.run_growth_check(:'co', true) = 0, 'no recommendation for the current level or planned features');
select tests.check((select count(*) from public.company_recommendations where rule_key in ('test_same_level', 'test_planned')) = 0,
  'same-level and planned-feature rules are skipped');
reset role;
delete from public.recommendation_rules where key in ('test_same_level', 'test_planned');

-- ---- 5. Demo companies ---------------------------------------------------------
select tests.login_guest(:'guest'); set role authenticated;
select public.create_demo_company() as demo \gset
select tests.check((select onboarding_done from public.companies where id = :'demo'), 'demo companies skip onboarding');
select public.set_business_level(:'demo', 'small');
select public.set_company_feature(:'demo', 'multi_warehouse', false);
select tests.check((select business_level = 'small' from public.companies where id = :'demo')
                   and not public.feature_enabled(:'demo', 'multi_warehouse'), 'the demo user can try levels and features');
select tests.check(public.run_growth_check(:'demo', true) = 0, 'demo companies get no recommendations');
select tests.blocked(format('select public.set_business_level(%L, %L)', :'co', 'small'), 'a guest cannot change a real company');
select tests.blocked(format('select public.set_company_feature(%L, %L, true)', :'co', 'landed_cost'), 'a guest cannot switch a real company''s features');
select tests.check(not public.is_platform_admin(), 'a guest is never a platform admin');
select public.submit_suggestion(:'demo', 'technology', 'Demo idea about the app', 'Nice demo', true) as demo_sug \gset
reset role;

-- ---- 6. Scheduled growth checks ---------------------------------------------------
select public.set_outbox_secret('stage11-outbox-secret-0123456789');
select tests.login('other12@g.test'); set role authenticated;
select public.set_business_level(:'other', 'small');
insert into public.warehouses (company_id, code, name) values (:'other', 'W2', 'Other second store');
reset role;
-- A third company whose check fails must not stop the others.
insert into public.companies (name) values ('Broken Co 12') returning id as broken \gset
update public.companies set business_level = 'small' where id = :'broken';
insert into public.warehouses (company_id, code, name) values (:'broken', 'W2', 'Broken store 2');
create or replace function tests.boom() returns trigger language plpgsql as $$
begin
  if new.company_id = current_setting('tests.broken')::uuid then raise exception 'boom'; end if;
  return new;
end $$;
select set_config('tests.broken', :'broken', false);
create trigger zz_boom before insert on public.company_recommendations for each row execute function tests.boom();
delete from public.company_growth_state where company_id in (:'other', :'demo');
select public.run_all_alerts('stage11-outbox-secret-0123456789');
select tests.check((select count(*) from public.company_recommendations where company_id = :'other' and rule_key = 'stores') = 1,
  'the scheduled job creates recommendations for real companies');
select tests.check((select count(*) from public.company_recommendations where company_id = :'demo') = 0, 'the scheduled job skips demos');
select tests.check(not exists (select 1 from public.company_growth_state where company_id = :'demo'), 'demo companies are not even checked');
select tests.check((select count(*) from public.company_recommendations where company_id = :'broken') = 0
                   and not exists (select 1 from public.company_growth_state where company_id = :'broken'),
  'a failing company is skipped without stopping the job');
select checked_at as other_checked from public.company_growth_state where company_id = :'other' \gset
select public.run_all_alerts('stage11-outbox-secret-0123456789');
select tests.check((select checked_at from public.company_growth_state where company_id = :'other') = :'other_checked'::timestamptz,
  'each company is checked at most once a day');
drop trigger zz_boom on public.company_recommendations;
select tests.check((select count(*) from public.notifications where company_id = :'other' and kind = 'growth' and user_id = :'other_boss') = 1,
  'the other company''s manager is notified');
select tests.blocked('select public.run_all_alerts(''wrong-secret-wrong-secret-xx'')', 'the scheduled job still needs the secret');

-- ---- 7. Suggestion Box -------------------------------------------------------------
select tests.login('sales12@g.test'); set role authenticated;
select public.submit_suggestion(:'co', 'inventory', 'Label the shelves', 'Put bin labels on every shelf.') as s1 \gset
select tests.check((select number = 'SUG-0001' and status = 'submitted' and created_by = :'sales' and not is_internal and not about_app
                     from public.suggestions where id = :'s1'), 'a member submits a numbered suggestion');
select tests.blocked(format('select public.submit_suggestion(%L, %L, %L, %L)', :'co', 'gossip', 'Bad topic', 'x'), 'unknown topics are refused');
select tests.blocked(format('select public.submit_suggestion(%L, %L, %L, %L)', :'co', 'sales', 'No', 'x'), 'titles need 3+ characters');
select tests.blocked(format('select public.submit_suggestion(%L, %L, %L, %L)', :'co', 'sales', 'Too long', repeat('x', 4001)), 'bodies are limited to 4,000 characters');
select tests.blocked(format('insert into public.suggestions (company_id, category, title) values (%L, %L, %L)', :'co', 'sales', 'Direct'),
  'suggestions cannot be inserted directly');
reset role;
select tests.login('ware12@g.test'); set role authenticated;
select public.submit_suggestion(:'co', 'technology', 'Barcode scanning', 'Let us scan barcodes with the phone camera.', true) as s2 \gset
select tests.check((select number from public.suggestions where id = :'s2') = 'SUG-0002', 'numbers continue');
select tests.check((select count(*) from public.suggestions) = 1, 'a member sees only their own suggestions');
reset role;
select tests.login('sales12@g.test'); set role authenticated;
select tests.check((select count(*) from public.suggestions) = 1, 'sales does not see the warehouse''s suggestion');
reset role;
select tests.login('fin12@g.test'); set role authenticated;
select tests.check((select count(*) from public.suggestions) = 0, 'other members see nothing');
reset role;
select tests.login('boss12@g.test'); set role authenticated;
select tests.check((select count(*) from public.suggestions where company_id = :'co') = 2, 'management sees all suggestions');
select tests.check((select count(*) from public.notifications where kind = 'suggestion' and link = '/suggestions/' || :'s1') = 1,
  'management is notified of new suggestions');
select tests.blocked(format('update public.suggestions set status = %L where id = %L', 'approved', :'s1'), 'status cannot be changed directly');

-- Review workflow
select public.review_suggestion(:'s1', 'needs_clarification', 'Which store?');
select tests.check((select status = 'needs_clarification' and manager_note = 'Which store?' and decided_by = :'boss'
                     from public.suggestions where id = :'s1'), 'management asks for clarification');
select tests.blocked(format('select public.review_suggestion(%L, %L)', :'s1', 'submitted'), 'management cannot set it back to submitted');
select tests.blocked(format('select public.review_suggestion(%L, %L)', :'s1', 'bogus'), 'invalid statuses are refused');
reset role;
select tests.login('sales12@g.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where kind = 'suggestion' and link = '/suggestions/' || :'s1'
                     and title = 'More information needed: Label the shelves') = 1, 'the author is told more information is needed');
select tests.blocked(format('select public.review_suggestion(%L, %L)', :'s1', 'approved'), 'sales cannot review suggestions');
select public.resubmit_suggestion(:'s1', 'Put bin labels on every shelf in the main store.');
select tests.check((select status = 'submitted' and body like '%main store.' from public.suggestions where id = :'s1'),
  'the author answers and the suggestion is back with management');
select tests.blocked(format('select public.resubmit_suggestion(%L, %L)', :'s1', 'again'), 'resubmitting only when clarification is asked');
reset role;
select tests.login('ware12@g.test'); set role authenticated;
select tests.blocked(format('select public.resubmit_suggestion(%L, %L)', :'s2', 'x'), 'resubmit needs a clarification request');
reset role;
select tests.login('boss12@g.test'); set role authenticated;
select tests.blocked(format('select public.review_suggestion(%L, %L)', :'s1', 'assigned'), 'assigning needs a person');
select tests.blocked(format('select public.review_suggestion(%L, %L, null, %L)', :'s1', 'assigned', :'other_boss'),
  'only team members can be assigned');
select public.review_suggestion(:'s1', 'assigned', 'Please do this week', :'ware');
select tests.check((select status = 'assigned' and assigned_to = :'ware' from public.suggestions where id = :'s1'), 'assigned to the warehouse');
reset role;
select tests.login('ware12@g.test'); set role authenticated;
select tests.check((select count(*) from public.suggestions) = 2, 'the assignee now sees the suggestion assigned to them');
select tests.check((select count(*) from public.notifications where title like 'Improvement assigned to you%') = 1, 'the assignee is notified');
select public.comment_suggestion(:'s1', 'Starting tomorrow.');
reset role;
select tests.login('sales12@g.test'); set role authenticated;
select public.comment_suggestion(:'s1', 'Thank you!');
select public.comment_suggestion(:'s1', 'And the Geita store too, please.');
select tests.check((select count(*) from public.suggestion_comments where suggestion_id = :'s1') = 3, 'the author sees the comments');
select tests.check((select count(*) from public.notifications where title like 'New comment on SUG-0001%') = 1, 'the author is notified of comments');
select tests.blocked(format('select public.update_my_assignment(%L, %L)', :'s1', 'implemented'), 'only the assignee reports progress');
reset role;
select tests.login('fin12@g.test'); set role authenticated;
select tests.check((select count(*) from public.suggestion_comments) = 0, 'other members cannot read the comments');
select tests.blocked(format('select public.comment_suggestion(%L, %L)', :'s1', 'Me too'), 'other members cannot comment');
reset role;
select tests.login('ware12@g.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where title like 'New comment on SUG-0001%') = 1,
  'several comments within the hour give the assignee one notification');
select tests.blocked(format('select public.update_my_assignment(%L, %L)', :'s1', 'approved'), 'the assignee cannot approve');
select public.update_my_assignment(:'s1', 'implemented', 'Labels are up.');
select tests.check((select status from public.suggestions where id = :'s1') = 'implemented', 'the assignee marks it implemented');
select tests.check((select count(*) from public.suggestion_comments where suggestion_id = :'s1') = 4, 'the progress note is kept as a comment');
select tests.blocked(format('select public.comment_suggestion(%L, %L)', :'s1', 'One more thing'), 'no comments on implemented suggestions');
reset role;
select tests.check((select count(*) from public.notifications where user_id = :'boss' and title = 'Improvement implemented: Label the shelves') = 1,
  'management is told it is implemented');
select tests.check((select count(*) from public.notifications where user_id = :'sales' and title = 'Your suggestion is implemented: Label the shelves') = 1,
  'the author is told it is implemented');

-- Management improvements
select tests.login('sales12@g.test'); set role authenticated;
select tests.blocked(format('select public.create_improvement(%L, %L, %L, %L)', :'co', 'finance', 'Faster invoicing', 'x'),
  'sales cannot create improvements');
reset role;
select tests.login('boss12@g.test'); set role authenticated;
select public.create_improvement(:'co', 'finance', 'Invoice within a day', 'Issue invoices the day after delivery.', :'fin', 'Finance') as s3 \gset
select tests.check((select number = 'SUG-0003' and status = 'assigned' and is_internal and department = 'Finance' and assigned_to = :'fin'
                     from public.suggestions where id = :'s3'), 'management records an assigned improvement');
select public.create_improvement(:'co', 'hse', 'Fire drill', 'Hold a fire drill every quarter.') as s4 \gset
select tests.check((select status from public.suggestions where id = :'s4') = 'approved', 'an unassigned improvement is approved');
select tests.blocked(format('select public.create_improvement(%L, %L, %L, %L, %L)', :'co', 'hse', 'Outsider', 'x', :'other_boss'),
  'improvements can only be assigned to team members');
select tests.check((select count(*) from public.suggestion_comments where suggestion_id = :'s1') = 4, 'management sees all comments');
select public.review_suggestion(:'s4', 'archived');
select tests.blocked(format('select public.comment_suggestion(%L, %L)', :'s4', 'Late note'), 'no comments on archived suggestions');
select public.review_suggestion(:'s2', 'rejected', 'Not now');
select tests.blocked(format('select public.comment_suggestion(%L, %L)', :'s2', 'Why?'), 'no comments on rejected suggestions');
select tests.check((public.company_metrics(:'co') ->> 'suggestions_30d')::int = 4, 'metrics count suggestions');
reset role;
select tests.login('fin12@g.test'); set role authenticated;
select tests.check((select count(*) from public.suggestions) = 1, 'the finance assignee sees only their improvement');
select tests.check((select count(*) from public.notifications where title = 'Improvement assigned to you: Invoice within a day') = 1,
  'the finance assignee is notified');
reset role;
-- Rate limits on comments and progress updates
insert into public.suggestion_comments (suggestion_id, company_id, author_id, body)
select :'s3', :'co', :'fin', 'Flood ' || g from generate_series(1, 20) g;
insert into public.audit_log (company_id, actor_id, action, entity, entity_id)
select :'co', :'fin', 'update', 'suggestions', :'s3' from generate_series(1, 20);
select tests.login('fin12@g.test'); set role authenticated;
select tests.blocked(format('select public.comment_suggestion(%L, %L)', :'s3', 'One too many'), 'at most 20 comments per 10 minutes');
select tests.blocked(format('select public.update_my_assignment(%L, %L)', :'s3', 'under_review'), 'at most 20 progress updates per 10 minutes');
reset role;
delete from public.suggestion_comments where suggestion_id = :'s3' and body like 'Flood %';
delete from public.audit_log where actor_id = :'fin' and entity = 'suggestions' and details = '{}'::jsonb;
select tests.login('fin12@g.test'); set role authenticated;
select public.comment_suggestion(:'s3', 'On it.');
select public.update_my_assignment(:'s3', 'under_review');
select tests.check((select status from public.suggestions where id = :'s3') = 'under_review', 'after the pause the assignee can continue');
reset role;

-- Other companies
select tests.login('other12@g.test'); set role authenticated;
select tests.check((select count(*) from public.suggestions where company_id = :'co') = 0, 'another company sees no suggestions');
select tests.check((select count(*) from public.suggestion_comments where company_id = :'co') = 0, 'another company sees no comments');
select tests.blocked(format('select public.submit_suggestion(%L, %L, %L, %L)', :'co', 'sales', 'Sneaky idea', 'x'), 'cannot suggest to another company');
select tests.blocked(format('select public.review_suggestion(%L, %L)', :'s2', 'approved'), 'cannot review another company''s suggestion');
select tests.blocked(format('select public.comment_suggestion(%L, %L)', :'s2', 'Hi'), 'cannot comment on another company''s suggestion');
select public.submit_suggestion(:'other', 'sales', 'Other company idea', 'Their own idea') as s_other \gset
select tests.check((select number from public.suggestions where id = :'s_other') = 'SUG-0001', 'each company has its own numbering');
reset role;

-- ---- 8. Platform administration ----------------------------------------------------
select tests.login('boss12@g.test'); set role authenticated;
select tests.blocked('select public.platform_overview()', 'normal users cannot see the platform overview');
select tests.blocked('select * from public.platform_companies()', 'normal users cannot list companies');
select tests.blocked('select * from public.platform_feedback_stats()', 'normal users cannot see feedback statistics');
select tests.blocked('select * from public.platform_app_feedback()', 'normal users cannot read app feedback');
select tests.blocked('select * from public.platform_feature_adoption()', 'normal users cannot see adoption');
select tests.blocked(format('select public.admin_set_company_level(%L, %L)', :'other', 'enterprise'), 'normal users cannot use admin level changes');
select tests.blocked(format('select public.admin_set_company_feature(%L, %L, true)', :'other', 'landed_cost'), 'normal users cannot use admin feature switches');
select tests.blocked('select count(*) from public.platform_admins', 'the admin list is private');
reset role;

insert into public.platform_admins (user_id) values (:'admin'), (:'guest');
select set_config('request.jwt.claims', json_build_object('sub', :'guest', 'role', 'authenticated', 'is_anonymous', true, 'aal', 'aal2')::text, false);
set role authenticated;
select tests.check(not public.is_platform_admin(), 'a guest listed as admin is still not an admin');
reset role;
delete from public.platform_admins where user_id = :'guest';

select count(*) as real_total from public.companies where not is_demo \gset
select count(*) as real_sugs from public.suggestions s join public.companies c on c.id = s.company_id where not c.is_demo \gset
select tests.login_aal('admin12@g.test', 'aal1'); set role authenticated;
select tests.check(not public.is_platform_admin(), 'a platform admin without two-step is not recognised');
select tests.blocked('select public.platform_overview()', 'platform tools need a two-step session');
update public.features set benefits = 'Password only' where key = 'ai_assistant';
select tests.check((select benefits from public.features where key = 'ai_assistant') <> 'Password only', 'catalogue edits need a two-step session');
reset role;
select tests.login_aal('admin12@g.test', 'aal2'); set role authenticated;
select tests.check(public.is_platform_admin(), 'platform admin recognised');
select public.platform_overview() as ov \gset
select tests.check((:'ov'::jsonb ->> 'companies_total')::int = :real_total, 'overview: real companies only');
select tests.check((:'ov'::jsonb -> 'by_level' ->> 'small')::int + (:'ov'::jsonb -> 'by_level' ->> 'medium')::int
                   + (:'ov'::jsonb -> 'by_level' ->> 'enterprise')::int = :real_total, 'overview: companies by level add up');
select tests.check((:'ov'::jsonb ->> 'demo_companies')::int >= 1, 'overview: demo companies counted separately');
select tests.check((:'ov'::jsonb ->> 'users_total')::int >= 8 and (:'ov'::jsonb ->> 'active_companies_30d')::int >= 2
                   and (:'ov'::jsonb ->> 'suggestions_30d')::int = :real_sugs and (:'ov'::jsonb ->> 'open_recommendations')::int >= 2,
  'overview: users, activity, suggestions and open recommendations');
select tests.check((select count(*) from public.platform_companies()) = :real_total
                   and (select count(*) from public.platform_companies() where is_demo) = 0, 'company list excludes demos');
select tests.check((select count(*) from public.platform_companies(true) where is_demo) >= 1, 'demos can be included on request');
select tests.check((select members = 6 and business_level = 'medium' and onboarding_done and features_on > 0 and last_activity is not null
                     from public.platform_companies() where id = :'co'), 'company list shows members, level and activity');
select tests.check((select sum(n) from public.platform_feedback_stats()) = :real_sugs, 'feedback statistics cover real companies only');
select tests.check((select count(*) from public.platform_app_feedback()) = 1
                   and (select title from public.platform_app_feedback()) = 'Barcode scanning', 'app feedback: real companies, about the app only');
select tests.check((select count(*) from public.platform_feature_adoption()) = 54
                   and (select bool_and(total_companies = :real_total) from public.platform_feature_adoption())
                   and (select enabled_companies from public.platform_feature_adoption() where key = 'ai_assistant') = 0,
  'feature adoption per feature');
select tests.blocked(format('select * from public.company_feature_map(%L)', :'co'), 'admins get no company feature details');
select tests.blocked(format('select public.company_metrics(%L)', :'co'), 'admins get no company figures');
select tests.check(not public.feature_enabled(:'co', 'customers'), 'feature_enabled is false for admins outside the company');
select tests.blocked(format('select public.company_profile(%L)', :'co'), 'admins cannot read business profiles');
select tests.blocked(format('select public.set_company_feature(%L, %L, false)', :'other', 'landed_cost'),
  'admins use admin_set_company_feature, not the management function');
select public.admin_set_company_feature(:'co', 'batch_expiry', false);
select public.admin_set_company_feature(:'other', 'landed_cost', false);
select tests.blocked(format('select public.admin_set_company_feature(%L, %L, false)', :'co', 'dashboard'), 'admins cannot switch off core features');
select public.admin_set_company_level(:'other', 'enterprise');
select tests.check((select business_level from public.platform_companies() where id = :'other') = 'enterprise', 'admin changes a company level');
select tests.check((select count(*) from public.audit_log) = 0, 'admins do not read company activity history');
select tests.blocked(format('select public.admin_set_company_feature(%L, %L, true)', :'co', 'ai_assistant'), 'admins cannot switch on planned features either');

-- Catalogue editing
update public.features set benefits = 'Updated benefit' where key = 'ai_assistant';
select tests.check((select benefits from public.features where key = 'ai_assistant') = 'Updated benefit', 'admins edit catalogue texts');
insert into public.features (key, name, module, default_level, status) values ('test_feature', 'Test feature', 'Other', 'small', 'live');
delete from public.features where key = 'test_feature';
update public.recommendation_rules set threshold = 3 where key = 'stores';
select tests.check((select threshold from public.recommendation_rules where key = 'stores') = 3, 'admins tune rule thresholds');
select tests.blocked(format('insert into public.features (key, name, route) values (%L, %L, %L)', 'bad_route', 'Bad route', '//evil.example'),
  'routes cannot point to another site');
select tests.blocked(format('insert into public.features (key, name, route) values (%L, %L, %L)', 'bad_route', 'Bad route', 'javascript:alert(1)'),
  'routes must be app paths');
select tests.blocked(format('insert into public.features (key, name, route) values (%L, %L, %L)', 'bad_route', 'Bad route', '/a b?x=1'),
  'routes allow only simple characters');
insert into public.features (key, name, route) values ('ok_route', 'Good route', '/settings/team#roles');
delete from public.features where key = 'ok_route';
select tests.blocked(format('insert into public.features (key, name, default_level, core) values (%L, %L, %L, true)', 'bad_core', 'Bad core', 'medium'),
  'core features must belong to the small level');
select tests.blocked(format('insert into public.recommendation_rules (key, title, metric, threshold, feature_key, target_level, applies_to) values (%L, %L, %L, 1, %L, %L, %L)',
  'bad_rule', 'Bad', 'members', 'approvals', 'medium', '{small}'), 'a rule targets a feature or a level, not both');
select tests.blocked(format('insert into public.recommendation_rules (key, title, metric, threshold, target_level, applies_to) values (%L, %L, %L, 1, %L, %L)',
  'bad_metric', 'Bad', 'shoe_size', 'medium', '{small}'), 'rules use known metrics only');
update public.recommendation_rules set threshold = 2 where key = 'stores';
reset role;
select tests.check((select enabled = false and source = 'admin' from public.company_features where company_id = :'co' and feature_key = 'batch_expiry')
                   and (select source = 'admin' from public.company_features where company_id = :'other' and feature_key = 'landed_cost'),
  'admin switches are recorded with source admin');
select tests.check((select count(*) from public.audit_log where actor_id = :'admin' and company_id in (:'co', :'other')) >= 3,
  'admin changes are recorded in the companies'' history');

-- App feedback is anonymous by design
select tests.check(not exists (select 1 from pg_proc p, unnest(p.proargnames) a
                                where p.proname = 'platform_app_feedback' and (a like '%company%' or a in ('created_by', 'author', 'author_id', 'name'))),
  'app feedback returns no company or author columns');

delete from public.platform_admins where user_id = :'admin';
select tests.login_aal('admin12@g.test', 'aal2'); set role authenticated;
select tests.blocked('select public.platform_overview()', 'a removed admin loses access');
reset role;

-- ---- 9. Grants -------------------------------------------------------------------------
select tests.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('level_rank', 'demo_skip_onboarding', 'is_platform_admin', 'require_platform_admin', 'feature_map_internal',
                       'feature_on', 'company_feature_map', 'feature_enabled', 'apply_company_feature', 'set_company_feature',
                       'apply_business_level', 'set_business_level', 'company_profile', 'company_metrics_raw', 'company_metrics', 'fmt_count',
                       'growth_check', 'run_growth_check', 'run_all_growth_checks', 'respond_recommendation', 'suggestion_visible',
                       'suggestion_check_input', 'suggestion_status_label', 'suggestion_key', 'submit_suggestion', 'create_improvement',
                       'review_suggestion', 'update_my_assignment', 'resubmit_suggestion', 'comment_suggestion',
                       'platform_overview', 'platform_companies', 'platform_feedback_stats', 'platform_app_feedback',
                       'platform_feature_adoption', 'admin_set_company_level', 'admin_set_company_feature')
     and has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon cannot execute any Stage 11 function');
select tests.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('demo_skip_onboarding', 'require_platform_admin', 'feature_map_internal', 'feature_on',
                       'apply_company_feature', 'apply_business_level', 'company_metrics_raw', 'fmt_count', 'growth_check',
                       'run_all_growth_checks', 'suggestion_check_input', 'suggestion_status_label', 'suggestion_key')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')), 'internal Stage 11 functions are not callable by users');
select tests.check(has_function_privilege('anon', 'public.run_all_alerts(text)', 'EXECUTE'), 'the scheduled job is still callable with the secret');
set role anon;
select tests.blocked(format('select * from public.company_feature_map(%L)', :'co'), 'anon cannot read the feature map');
select tests.blocked(format('select public.submit_suggestion(%L, %L, %L, %L)', :'co', 'sales', 'Anon idea', 'x'), 'anon cannot submit suggestions');
select tests.blocked('select public.run_all_growth_checks()', 'anon cannot run all growth checks');
select tests.blocked('select count(*) from public.features', 'anon cannot read the catalogue');
select tests.blocked('select count(*) from public.suggestions', 'anon cannot read suggestions');
select tests.blocked(format('select public.company_profile(%L)', :'co'), 'anon cannot read business profiles');
select tests.blocked('select count(*) from public.company_profiles', 'anon cannot read the profiles table');
reset role;
select tests.login('boss12@g.test'); set role authenticated;
select tests.blocked('select public.run_all_growth_checks()', 'users cannot run all growth checks');
select tests.blocked(format('select public.growth_check(%L)', :'co'), 'users cannot bypass the growth check rules');
select tests.blocked(format('select public.apply_company_feature(%L, %L, true, %L)', :'other', 'landed_cost', 'admin'), 'users cannot call the internal feature switch');
reset role;

-- Clean up the demo
select tests.login_guest(:'guest'); set role authenticated;
select public.end_demo();
reset role;
