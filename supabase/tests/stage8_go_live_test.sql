-- Tests for Stage 8: security fixes from the pre-launch review, security
-- invariants for the whole database, and the go-live tools.
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

insert into auth.users (email) values ('m8@g.test'), ('s8@g.test'), ('w8@g.test'), ('d8@g.test'), ('f8@g.test'), ('p8@g.test'),
                                      ('b8@o.test'), ('new8@x.test'), ('late8@g.test');

select tests.login('m8@g.test'); set role authenticated;
select public.create_company('Live Co') as cid \gset
select public.invite_member(:'cid', 's8@g.test', 'sales');
select public.invite_member(:'cid', 'w8@g.test', 'warehouse');
select public.invite_member(:'cid', 'd8@g.test', 'driver');
select public.invite_member(:'cid', 'f8@g.test', 'finance');
select public.invite_member(:'cid', 'p8@g.test', 'procurement');
insert into public.clients (company_id, name, credit_limit) values (:'cid', 'Sugar Ltd', 1000000) returning id as client \gset
insert into public.suppliers (company_id, name) values (:'cid', 'Local Co') returning id as sup \gset
insert into public.suppliers (company_id, name, currency) values (:'cid', 'Global Inc', 'USD') returning id as sup_usd \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'PUMP', 'Pump', 'pcs', 1000000) returning id as pump \gset
insert into public.products (company_id, sku, name, unit) values (:'cid', 'ACID', 'Sulphuric acid', 'drum') returning id as acid \gset
insert into public.product_costs (product_id, company_id, last_cost) values (:'pump', :'cid', 1000);
select id as main from public.warehouses where company_id = :'cid' and code = 'MAIN' \gset
reset role;
select tests.login('s8@g.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('w8@g.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('d8@g.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('f8@g.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('p8@g.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('b8@o.test'); set role authenticated; select public.create_company('Rival Co'); reset role;
select id as driver_id from auth.users where email = 'd8@g.test' \gset
select id as sales_id from auth.users where email = 's8@g.test' \gset
select id as rival_id from auth.users where email = 'b8@o.test' \gset

-- ---- 1. Deliveries --------------------------------------------------------
select tests.login('w8@g.test'); set role authenticated;
select public.adjust_stock(:'cid', :'pump', :'main', 10, '', null, 'Opening');
select public.create_delivery(:'cid', :'client', null, null) as dn \gset
insert into public.delivery_lines (company_id, delivery_id, product_id, description, quantity, unit) values (:'cid', :'dn', :'pump', 'Pump', 2, 'pcs');
select tests.blocked(format('update public.deliveries set driver_id = %L where id = %L', :'rival_id', :'dn'), 'driver must be a team member');
select public.dispatch_delivery(:'dn');
reset role;

select tests.login('b8@o.test'); set role authenticated;
select tests.blocked(format('select public.fail_delivery(%L, %L)', :'dn', 'x'), 'another company cannot fail a delivery without a driver');
select tests.blocked(format('select public.confirm_delivery(%L, %L, %L, null, null, null, null, null)', :'dn', 'M', :'cid' || '/' || :'dn' || '/x.png'), 'another company cannot confirm it');
reset role;

select tests.login('s8@g.test'); set role authenticated;
select tests.blocked(format('select public.fail_delivery(%L, %L)', :'dn', 'x'), 'sales cannot fail a delivery');
select tests.blocked(format('update public.deliveries set driver_id = %L where id = %L', :'sales_id', :'dn'), 'sales cannot make themselves the driver after dispatch');
reset role;

select tests.login('w8@g.test'); set role authenticated;
update public.deliveries set driver_id = :'driver_id' where id = :'dn';
reset role;

select tests.login('d8@g.test'); set role authenticated;
select tests.blocked(format('select public.confirm_delivery(%L, %L, %L, null, null, null, null, null)', :'dn', 'Gate', :'cid' || '/' || :'dn' || '/missing.png'), 'signature file must really be uploaded');
reset role;
update public.memberships set active = false where user_id = :'driver_id';
select tests.login('d8@g.test'); set role authenticated;
select tests.check((select count(*) from public.notifications) = 0, 'former members no longer see their notifications');
select tests.blocked(format('select public.fail_delivery(%L, %L)', :'dn', 'x'), 'a removed driver cannot touch the delivery');
reset role;
update public.memberships set active = true where user_id = :'driver_id';
insert into storage.objects (bucket_id, name) values ('pod', :'cid' || '/' || :'dn' || '/sig.png');
select tests.login('d8@g.test'); set role authenticated;
select public.confirm_delivery(:'dn', 'Gate', :'cid' || '/' || :'dn' || '/sig.png', null, null, null, null, null);
select tests.check((select status from public.deliveries where id = :'dn') = 'delivered', 'the assigned driver confirms with an uploaded signature');
reset role;

-- ---- 2. Exchange rates ------------------------------------------------------
select tests.login('s8@g.test'); set role authenticated;
select tests.blocked(format('insert into public.exchange_rates (company_id, currency, rate) values (%L, %L, 1)', :'cid', 'USD'), 'sales cannot set exchange rates');
select public.create_quotation(:'cid', :'client', null) as q \gset
update public.quotations set exchange_rate = 3 where id = :'q';
select tests.check((select exchange_rate from public.quotations where id = :'q') = 1, 'a TZS quotation always has rate 1');
reset role;

select tests.login('p8@g.test'); set role authenticated;
select tests.blocked(format('select public.create_purchase_order(%L, %L, null)', :'cid', :'sup_usd'), 'a USD order needs a company USD rate first');
select public.create_purchase_order(:'cid', :'sup', null) as po \gset
insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values (:'cid', :'po', :'pump', 'Pump', 1000, 'pcs', 1000000);
update public.purchase_orders set exchange_rate = 0.000001 where id = :'po';
select tests.check((select exchange_rate from public.purchase_orders where id = :'po') = 1, 'rate trick on a TZS PO is undone');
select tests.check(public.submit_purchase_order(:'po') = 'pending_approval', 'a big PO still needs approval');
reset role;

select tests.login('f8@g.test'); set role authenticated;
select tests.blocked(format('insert into public.exchange_rates (company_id, currency, rate) values (%L, %L, 1)', :'cid', 'TZS'), 'the main currency cannot get a rate');
insert into public.exchange_rates (company_id, currency, rate) values (:'cid', 'USD', 2600);
select public.create_invoice(:'cid', :'client', null, null) as inv \gset
insert into public.invoice_lines (company_id, invoice_id, description, quantity, unit_price) values (:'cid', :'inv', 'Pumps', 500, 1000000);
update public.invoices set exchange_rate = 0.000001 where id = :'inv';
select tests.blocked(format('select public.issue_invoice(%L)', :'inv'), 'credit limit can no longer be dodged with a fake rate');
update public.invoices set currency = 'USD' where id = :'inv';
select tests.check((select exchange_rate from public.invoices where id = :'inv') = 2600, 'company rate filled in automatically');
select tests.blocked(format('update public.invoices set exchange_rate = 1000 where id = %L', :'inv'), 'rate far from the company rate is refused');
update public.invoices set exchange_rate = 2650 where id = :'inv';
select tests.check((select exchange_rate from public.invoices where id = :'inv') = 2650, 'a rate within 10% is accepted');
select tests.blocked(format('insert into public.invoices (company_id, client_id, quotation_id) values (%L, %L, %L)', :'cid', :'client', :'q'), 'invoice links to orders only via create_invoice');
reset role;

-- ---- 3. Status rules -------------------------------------------------------
select tests.login('s8@g.test'); set role authenticated;
select tests.blocked(format('insert into public.rfqs (company_id, client_id, status) values (%L, %L, %L)', :'cid', :'client', 'won'), 'RFQs cannot be created as won');
insert into public.rfqs (company_id, client_id, title) values (:'cid', :'client', 'Normal RFQ');
reset role;
select tests.login('p8@g.test'); set role authenticated;
select public.create_supplier_rfq(:'cid', null, null) as srfq \gset
select tests.blocked(format('update public.supplier_rfqs set status = %L where id = %L', 'awarded', :'srfq'), 'supplier RFQ status cannot be typed in');
update public.supplier_rfqs set status = 'cancelled' where id = :'srfq';
select tests.check((select status from public.supplier_rfqs where id = :'srfq') = 'cancelled', 'cancelling by hand still works');
reset role;

-- ---- 4. Hardening ------------------------------------------------------------
set role anon;
select tests.blocked('select count(*) from public.clients', 'anonymous visitors cannot read tables');
select tests.blocked('select count(*) from public.companies', 'anonymous visitors cannot read companies');
select tests.blocked(format('select public.is_member(%L)', :'cid'), 'anonymous visitors cannot call app functions');
reset role;
select tests.login('m8@g.test'); set role authenticated;
select tests.blocked(format('update public.companies set logo_path = %L where id = %L', 'elsewhere/logo.png', :'cid'), 'logo must be in the company folder');
update public.companies set logo_path = :'cid' || '/logo.png' where id = :'cid';
select tests.blocked('insert into public.push_subscriptions (endpoint, p256dh, auth) values (''https://evil.example/x'', ''k'', ''a'')', 'push only to real push services');
insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://web.push.apple.com/abc', 'k', 'a');
select tests.blocked('truncate public.clients', 'no truncate');
reset role;

-- ---- 5. Database-wide security invariants ------------------------------------
select tests.check((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) = 0,
                   'every table has row-level security switched on');
select tests.check((select count(*) from pg_policies where schemaname = 'public' and roles <> array['authenticated']::name[]) = 0,
                   'every policy is for signed-in users only');
select tests.check((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and prosecdef
                      and not exists (select 1 from unnest(coalesce(proconfig, '{}')) c where c like 'search_path=%')) = 0,
                   'every privileged function pins its search path');
select tests.check((select count(*) from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public') = 0,
                   'anonymous role has no table privileges');
select tests.check((select string_agg(proname, ',' order by proname) from pg_proc
                     where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute'))
                   = 'check_overdue_backups,claim_company_backup,claim_outbox,drop_push_endpoints,run_all_alerts,take_claimed_backup',
                   'anonymous role can only call the secret-protected scheduled-job functions');

-- ---- 6. Opening stock import -----------------------------------------------------
select tests.login('w8@g.test'); set role authenticated;
select tests.blocked(format('select public.import_opening_stock(%L, %L)', :'cid',
  '[{"sku":"ACID","store":"MAIN","quantity":5},{"sku":"NOPE","quantity":1},{"sku":"PUMP","store":"XX","quantity":1}]'),
  'import with bad rows loads nothing');
select tests.check((select count(*) from public.stock_movements where product_id = :'acid') = 0, 'nothing loaded after a failed import');
select tests.check(public.import_opening_stock(:'cid', '[{"sku":"acid","store":"main","quantity":5,"batch_no":"A1","expiry_date":"2027-06-30"},{"sku":"PUMP","quantity":3}]') = 2, 'opening stock loaded');
select tests.check((select sum(quantity) from public.stock_on_hand where product_id = :'acid' and batch_no = 'A1') = 5, 'batch and expiry kept');
reset role;
select tests.login('s8@g.test'); set role authenticated;
select tests.blocked(format('select public.import_opening_stock(%L, %L)', :'cid', '[{"sku":"PUMP","quantity":1}]'), 'sales cannot load stock');
reset role;

-- ---- 7. Reset test transactions -------------------------------------------------
select tests.login('m8@g.test'); set role authenticated;
select tests.blocked(format('select public.reset_company_transactions(%L, %L)', :'cid', 'Live Co'), 'reset is not available in the app');
reset role;
select tests.blocked(format('select public.reset_company_transactions(%L, %L)', :'cid', 'live co'), 'reset needs the exact company name');
select public.reset_company_transactions(:'cid', 'Live Co');
select tests.check((select count(*) from public.quotations where company_id = :'cid') + (select count(*) from public.deliveries where company_id = :'cid')
                   + (select count(*) from public.invoices where company_id = :'cid') + (select count(*) from public.stock_movements where company_id = :'cid')
                   + (select count(*) from public.purchase_orders where company_id = :'cid') + (select count(*) from public.rfqs where company_id = :'cid')
                   + (select count(*) from public.notifications where company_id = :'cid') = 0, 'test transactions cleared');
select tests.check((select count(*) from public.clients where company_id = :'cid') = 1 and (select count(*) from public.products where company_id = :'cid') = 2
                   and (select count(*) from public.memberships where company_id = :'cid') = 6, 'clients, products and team kept');
select tests.check((select count(*) from public.quotations where company_id <> :'cid') > 0, 'other companies untouched');
select tests.login('m8@g.test'); set role authenticated;
select public.create_quotation(:'cid', :'client', null) as q2 \gset
select tests.check((select number from public.quotations where id = :'q2') like 'QT-____-0001', 'numbering restarts at 0001');
reset role;

-- ---- 8. Switch off new companies --------------------------------------------------
update public.platform_settings set allow_new_companies = false;
select tests.login('new8@x.test'); set role authenticated;
select tests.blocked('select public.create_company(''Spam Co'')', 'strangers cannot create companies once switched off');
reset role;
select tests.login('m8@g.test'); set role authenticated;
select public.invite_member(:'cid', 'late8@g.test', 'sales');
reset role;
select tests.login('late8@g.test'); set role authenticated;
select public.accept_invitation((select id from public.my_invitations()));
select tests.check((select count(*) from public.clients) = 1, 'invited staff can still join');
reset role;
update public.platform_settings set allow_new_companies = true;

\echo 'ALL STAGE 8 TESTS PASSED'
