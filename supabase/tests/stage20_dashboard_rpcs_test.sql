-- Tests for the faster home-dashboard aggregates (20261028000800_dashboard_rpcs.sql).
-- The data is seeded directly as the owner (replica mode: no triggers/FK, like the real seed path),
-- then the numbers are checked as a signed-in member, as an outsider, and across companies.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = warning;

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
grant execute on all functions in schema tests to authenticated;

insert into auth.users (email) values ('dash.mgr@d.test'), ('dash.fin@d.test'), ('dash.out@d.test');

-- Two companies, built through the normal functions.
select tests.login('dash.mgr@d.test'); set role authenticated;
select public.create_company('Dash Co') as co \gset
select public.invite_member(:'co', 'dash.fin@d.test', 'finance') as inv \gset
select public.create_company('Other Co') as co2 \gset
reset role;
-- dash.fin accepts the invitation so they are a real member of company A.
select tests.login('dash.fin@d.test'); set role authenticated;
select public.accept_invitation(:'inv');
reset role;
-- 'dash.out@d.test' is a member of neither company.

-- Pin a date the seed is built around, so the month and expiry buckets are deterministic.
select (now() at time zone 'Africa/Dar_es_Salaam')::date as today \gset

-- ---- Seed company A directly (no triggers / no row rules), the way the bulk seed does ----
set session_replication_role = replica;

select id as wh from public.warehouses where company_id = :'co' and code = 'MAIN' \gset
insert into public.clients (company_id, code, name, industry) values (:'co', 'GOLD', 'Gold Mine', 'Mining') returning id as c1 \gset
insert into public.clients (company_id, code, name, industry) values (:'co', 'SILV', 'Silver Co', null)     returning id as c2 \gset
insert into public.products (company_id, sku, name, unit, active, reorder_level, selling_price)
  values (:'co', 'P1', 'Oil drum', 'drum', true, 10, 1000) returning id as p1 \gset
insert into public.products (company_id, sku, name, unit, active, reorder_level, selling_price)
  values (:'co', 'P2', 'Bearing', 'pcs', true, 5, 100) returning id as p2 \gset
insert into public.product_costs (product_id, company_id, last_cost) values (:'p1', :'co', 1000);

-- Stock: p1 on hand 3 (below its reorder level of 10, batch expiring in 3 days -> critical),
--        p2 on hand 20 (above reorder 5, batch expiring in 30 days -> soon). Value = 3*1000 + 20*0 = 3000.
insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, expiry_date)
  values (:'co', :'p1', :'wh', 3, 'receipt', 'B1', (:'today'::date + 3)),
         (:'co', :'p2', :'wh', 20, 'receipt', 'B2', (:'today'::date + 30));

-- A quotation so the order cost can hang off it.
insert into public.quotations (company_id, client_id, status, issue_date, subtotal, total)
  values (:'co', :'c1', 'accepted', :'today'::date, 100000, 118000) returning id as q1 \gset
insert into public.order_costs (company_id, quotation_id, kind, amount, currency, exchange_rate, incurred_on)
  values (:'co', :'q1', 'freight', 10000, 'TZS', 1, :'today'::date);

-- Two issued invoices this month: revenue 100000 (cost 20000) and 50000 (cost 5000).
insert into public.invoices (company_id, client_id, status, issue_date, exchange_rate, subtotal, total)
  values (:'co', :'c1', 'issued', :'today'::date, 1, 100000, 118000) returning id as inv1 \gset
insert into public.invoices (company_id, client_id, status, issue_date, exchange_rate, subtotal, total)
  values (:'co', :'c2', 'issued', :'today'::date, 1, 50000, 59000) returning id as inv2 \gset
insert into public.invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, line_total)
  values (:'co', :'inv1', 1, 'Oil', 2, 50000, 100000) returning id as l1 \gset
insert into public.invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, line_total)
  values (:'co', :'inv2', 1, 'Bearing', 1, 50000, 50000) returning id as l2 \gset
insert into public.invoice_costs (invoice_line_id, company_id, invoice_id, unit_cost) values (:'l1', :'co', :'inv1', 10000);
insert into public.invoice_costs (invoice_line_id, company_id, invoice_id, unit_cost) values (:'l2', :'co', :'inv2', 5000);

-- Company B: data that must never show up in company A's totals.
insert into public.products (company_id, sku, name, unit, active, reorder_level, selling_price)
  values (:'co2', 'Z', 'Other', 'pcs', true, 1, 10) returning id as zp \gset
select id as zw from public.warehouses where company_id = :'co2' and code = 'MAIN' \gset
insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, expiry_date)
  values (:'co2', :'zp', :'zw', 1, 'receipt', 'ZB', (:'today'::date + 1));

reset session_replication_role;

-- ---- Check as a member of company A ----
select tests.login('dash.fin@d.test'); set role authenticated;

select * from public.dashboard_stock_metrics(:'co', :'today'::date) \gset
select tests.check(:batch_critical = 1, 'stock: one batch critical (expires within 7 days)');
select tests.check(:batch_soon = 1, 'stock: one batch due soon');
select tests.check(:low_stock = 1, 'stock: one product at or below reorder level');
select tests.check(:stock_value = 3000, 'stock: value is quantity x last cost (3000)');

select public.dashboard_profit_metrics(:'co', (:'today'::date - 180), (date_trunc('year', :'today'::date))::date) as pm \gset
select tests.check(
  (select (sum((m->>'sales')::numeric)) from jsonb_array_elements(:'pm'::jsonb->'months') m) = 150000,
  'profit: sales this period total 150000');
select tests.check(
  (select (sum((m->>'profit')::numeric)) from jsonb_array_elements(:'pm'::jsonb->'months') m) = 125000,
  'profit: gross profit before order costs is 125000 (80000 + 45000)');
select tests.check(
  (select (c->>'cost')::numeric from jsonb_array_elements(:'pm'::jsonb->'orderCosts') c limit 1) = 10000,
  'profit: order costs for the month total 10000');
select tests.check(
  (select (i->>'label') from jsonb_array_elements(:'pm'::jsonb->'industries') i
    order by (i->>'value')::numeric desc limit 1) = 'Mining',
  'profit: top industry is Mining');
select tests.check(
  (select count(*) from jsonb_array_elements(:'pm'::jsonb->'clients') c) = 2,
  'profit: both clients appear');
select tests.check(
  (select (c->>'label') from jsonb_array_elements(:'pm'::jsonb->'clients') c
    order by (c->>'value')::numeric desc limit 1) = 'Gold Mine',
  'profit: top client by revenue is Gold Mine');

-- ---- An outsider (member of neither company) gets nothing ----
reset role;
select tests.login('dash.out@d.test'); set role authenticated;
select tests.check((select count(*) from public.dashboard_stock_metrics(:'co', :'today'::date)) = 0,
  'outsider: stock metrics return no row');
select tests.check(public.dashboard_profit_metrics(:'co', (:'today'::date - 180), (date_trunc('year', :'today'::date))::date) is null,
  'outsider: profit metrics return null');

-- ---- A member of company B cannot read company A's totals ----
reset role;
select tests.login('dash.mgr@d.test'); set role authenticated;
select tests.check((select count(*) from public.dashboard_stock_metrics(:'co2', :'today'::date)) = 1,
  'a manager of company B does get company B back');
select public.dashboard_stock_metrics(:'co2', :'today'::date) as _ \gset
reset role;
select tests.login('dash.fin@d.test'); set role authenticated;
select tests.check((select count(*) from public.dashboard_stock_metrics(:'co2', :'today'::date)) = 0,
  'company A member cannot read company B stock totals');
reset role;
