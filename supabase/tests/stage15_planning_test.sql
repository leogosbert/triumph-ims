-- Tests for Stage 15 part 1: budgets, cash-flow forecast, purchase planning, fleet.
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

insert into auth.users (email) values ('m16@e.test'), ('f16@e.test'), ('w16@e.test'), ('s16@e.test'), ('p16@e.test'), ('d16@e.test'), ('x16@x.test');
insert into auth.users (is_anonymous) values (true) returning id as g16 \gset
select id as m16 from auth.users where email = 'm16@e.test' \gset
select id as d16 from auth.users where email = 'd16@e.test' \gset
select id as x16 from auth.users where email = 'x16@x.test' \gset

select tests.login('m16@e.test'); set role authenticated;
select public.create_company('Plan Co') as cid \gset
select public.set_business_level(:'cid', 'enterprise');
select public.invite_member(:'cid', 'f16@e.test', 'finance');
select public.invite_member(:'cid', 'w16@e.test', 'warehouse');
select public.invite_member(:'cid', 's16@e.test', 'sales');
select public.invite_member(:'cid', 'p16@e.test', 'procurement');
select public.invite_member(:'cid', 'd16@e.test', 'driver');
select id as main from public.warehouses where company_id = :'cid' and code = 'MAIN' \gset
select id as cat from public.expense_categories where company_id = :'cid' order by sort limit 1 \gset
insert into public.clients (company_id, name) values (:'cid', 'Mine Ltd') returning id as client \gset
insert into public.suppliers (company_id, name, lead_time_days) values (:'cid', 'Lube Importers', 20) returning id as sup \gset
insert into public.products (company_id, sku, name, unit, selling_price, reorder_level) values (:'cid', 'OIL', 'Engine oil', 'drum', 500000, 5) returning id as oil \gset
select public.adjust_stock(:'cid', :'oil', :'main', 100, 'B1', null, 'Opening stock');
reset role;
select tests.login('f16@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('w16@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('s16@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('p16@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('d16@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('x16@x.test'); set role authenticated; select public.create_company('Other Plan Co') as other \gset
reset role;

-- ---- Budgets -----------------------------------------------------------------------------------
select tests.login('f16@e.test'); set role authenticated;
select public.set_budget(:'cid', 2027, 'sales', null, array[100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 120]::numeric[]);
select tests.check((select count(*) from public.budgets where company_id = :'cid' and measure = 'sales') = 12, 'finance sets twelve months of sales budget');
select public.set_budget(:'cid', 2027, 'sales', null, array[200, null, null, null, null, null, null, null, null, null, null, null]::numeric[]);
select tests.check((select count(*) from public.budgets where company_id = :'cid' and measure = 'sales') = 1
                   and (select amount from public.budgets where company_id = :'cid' and measure = 'sales') = 200, 'setting again replaces the year');
select public.set_budget(:'cid', 2027, 'expense_category', :'cat', array_fill(50::numeric, array[12]));
select tests.check((select count(*) from public.budgets where company_id = :'cid' and category_id = :'cat') = 12, 'budget per expense category');
select tests.blocked(format('select public.set_budget(%L, 2027, %L, null, array_fill(1::numeric, array[12]))', :'cid', 'expense_category'), 'category budget needs a category');
select tests.blocked(format('select public.set_budget(%L, 2027, %L, null, array_fill(-1::numeric, array[12]))', :'cid', 'expenses'), 'no negative budgets');
select tests.blocked(format('select public.set_budget(%L, 2027, %L, null, array[1,2,3]::numeric[])', :'cid', 'expenses'), 'twelve months needed');
select tests.blocked(format('insert into public.budgets (company_id, year, month, measure, amount) values (%L, 2027, 1, %L, 5)', :'cid', 'expenses'), 'budgets only through the app');
reset role;
select tests.login('s16@e.test'); set role authenticated;
select tests.blocked(format('select public.set_budget(%L, 2027, %L, null, array_fill(1::numeric, array[12]))', :'cid', 'sales'), 'sales cannot set budgets');
select tests.check((select count(*) from public.budgets where company_id = :'cid') = 0, 'sales cannot see budgets');
reset role;
select tests.login('x16@x.test'); set role authenticated;
select tests.blocked(format('select public.set_budget(%L, 2027, %L, null, array_fill(1::numeric, array[12]))', :'cid', 'sales'), 'another company cannot set budgets');
select tests.check((select count(*) from public.budgets where company_id = :'cid') = 0, 'another company sees no budgets');
reset role;

-- ---- Cash-flow forecast ------------------------------------------------------------------------
select tests.login('f16@e.test'); set role authenticated;
insert into public.cash_positions (company_id, amount, note) values (:'cid', 1000000, 'Bank');
select public.create_invoice(:'cid', :'client', null, null) as inv \gset
insert into public.invoice_lines (company_id, invoice_id, description, quantity, unit_price) values (:'cid', :'inv', 'Service', 1, 100000);
select public.issue_invoice(:'inv');
reset role;
set ims.status_change = 'on';
update public.invoices set due_date = current_date - 3 where id = :'inv';
reset ims.status_change;
select tests.login('f16@e.test'); set role authenticated;
insert into public.supplier_bills (company_id, supplier_id, subtotal, due_date) values (:'cid', :'sup', 50000, current_date + 8) returning id as bill \gset
select tests.check((select count(*) from public.cashflow_forecast(:'cid', 13)) = 13, 'forecast has 13 weeks');
select tests.check((select cash_in from public.cashflow_forecast(:'cid', 13) order by week_start limit 1)
                   = (select total from public.invoices where id = :'inv'), 'overdue invoice is expected this week');
select tests.check((select sum(bills_out) from public.cashflow_forecast(:'cid', 13)) = (select total from public.supplier_bills where id = :'bill'),
                   'the bill is counted once');
select tests.check((select bills_out from public.cashflow_forecast(:'cid', 13) order by week_start limit 1) = 0
                   or extract(isodow from current_date) >= 6, 'the bill falls in a later week');
reset role;
select tests.login('s16@e.test'); set role authenticated;
select tests.blocked(format('select * from public.cashflow_forecast(%L, 13)', :'cid'), 'sales cannot see the forecast');
select tests.check((select count(*) from public.cash_positions where company_id = :'cid') = 0, 'sales cannot see cash positions');
select tests.blocked(format('insert into public.cash_positions (company_id, amount) values (%L, 5)', :'cid'), 'sales cannot record cash');
reset role;
select tests.login('x16@x.test'); set role authenticated;
select tests.blocked(format('select * from public.cashflow_forecast(%L, 13)', :'cid'), 'another company cannot see the forecast');
reset role;

-- ---- Purchase planning -------------------------------------------------------------------------
select tests.login('m16@e.test'); set role authenticated;
select public.create_purchase_order(:'cid', :'sup', null) as po \gset
insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price)
values (:'cid', :'po', :'oil', 'Engine oil', 10, 'drum', 400000);
reset role;
-- 90 drums dispatched over the last 90 days: one a day.
insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, created_at)
values (:'cid', :'oil', :'main', -90, 'dispatch', 'B1', now() - interval '10 days');
select tests.login('p16@e.test'); set role authenticated;
select tests.check((select per_day from public.demand_plan(:'cid', 90) where product_id = :'oil') = 1, 'one drum a day');
select tests.check((select on_hand from public.demand_plan(:'cid', 90) where product_id = :'oil') = 10, 'on hand counted');
select tests.check((select on_order from public.demand_plan(:'cid', 90) where product_id = :'oil') = 10, 'draft PO counted as on order');
select tests.check((select lead_days from public.demand_plan(:'cid', 90) where product_id = :'oil') = 14, 'no supplier yet: two weeks lead time');
select tests.check((select reorder_point from public.demand_plan(:'cid', 90) where product_id = :'oil') = 21, 'reorder point = lead time + a week');
select tests.check((select order_qty from public.demand_plan(:'cid', 90) where product_id = :'oil') = 31, 'order to cover a month after arrival');
reset role;
select tests.login('s16@e.test'); set role authenticated;
select tests.blocked(format('select * from public.demand_plan(%L, 90)', :'cid'), 'sales cannot see purchase planning');
reset role;

-- ---- Fleet -------------------------------------------------------------------------------------
select tests.login('w16@e.test'); set role authenticated;
insert into public.vehicles (company_id, plate, name, driver_id, insurance_expires, service_due_on, odometer_km)
values (:'cid', ' t 482  dkl ', 'Isuzu', :'d16', current_date + 5, current_date - 1, 1000) returning id as veh \gset
select tests.check((select plate from public.vehicles where id = :'veh') = 'T 482 DKL', 'plate tidied');
select tests.blocked(format('insert into public.vehicles (company_id, plate) values (%L, %L)', :'cid', 'T482DKL'), 'the same plate twice');
select tests.blocked(format('insert into public.vehicles (company_id, plate, driver_id) values (%L, %L, %L)', :'cid', 'T 1 AAA', :'x16'), 'driver must be in the team');
reset role;
select tests.login('d16@e.test'); set role authenticated;
insert into public.vehicle_logs (company_id, vehicle_id, kind, odometer_km, litres, amount) values (:'cid', :'veh', 'fuel', 1500, 100, 320000) returning id as log1 \gset
select tests.check((select odometer_km from public.vehicles where id = :'veh') = 1500, 'log moves the odometer on');
insert into public.vehicle_logs (company_id, vehicle_id, kind, odometer_km) values (:'cid', :'veh', 'odometer', 1200);
select tests.check((select odometer_km from public.vehicles where id = :'veh') = 1500, 'a lower reading does not wind it back');
select tests.blocked(format('insert into public.vehicle_logs (company_id, vehicle_id, kind) values (%L, %L, %L)', :'cid', :'veh', 'fuel'), 'fuel needs litres or amount');
select tests.blocked(format('insert into public.vehicle_logs (company_id, vehicle_id, kind, happened_on, litres) values (%L, %L, %L, current_date + 1, 5)', :'cid', :'veh', 'fuel'), 'no future dates');
select tests.no_rows(format('update public.vehicles set odometer_km = 1 where id = %L', :'veh'), 'driver cannot edit the vehicle');
delete from public.vehicle_logs where id = :'log1';
select tests.check(not exists (select 1 from public.vehicle_logs where id = :'log1'), 'driver removes their own log line');
reset role;
select tests.login('s16@e.test'); set role authenticated;
select tests.check((select count(*) from public.vehicles where company_id = :'cid') = 0, 'sales does not see the fleet');
reset role;
select tests.login('x16@x.test'); set role authenticated;
select tests.check((select count(*) from public.vehicles where company_id = :'cid') = 0, 'another company sees no vehicles');
select tests.blocked(format('insert into public.vehicle_logs (company_id, vehicle_id, kind, litres) values (%L, %L, %L, 5)', :'other', :'veh', 'fuel'), 'cannot log on another company''s vehicle');
reset role;
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where company_id = :'cid' and kind = 'vehicle_due' and link = '/fleet/' || :'veh') >= 2,
                   'insurance and service reminders');
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where company_id = :'cid' and kind = 'vehicle_due' and user_id = :'m16') = 2,
                   'reminders are not repeated');

-- ---- Feature catalogue -------------------------------------------------------------------------
select tests.login('m16@e.test'); set role authenticated;
select tests.check((select bool_and(enabled) from public.company_feature_map(:'cid')
                     where key in ('budgets', 'cashflow_forecast', 'demand_forecast', 'fleet_tracking')) = true, 'part 1 features are live and on at enterprise');
reset role;

-- ---- Reset before go-live ----------------------------------------------------------------------
select public.reset_company_transactions(:'cid', 'Plan Co');
select tests.check(not exists (select 1 from public.vehicle_logs where company_id = :'cid')
                   and not exists (select 1 from public.cash_positions where company_id = :'cid'), 'reset clears the vehicle log and cash');
select tests.check(exists (select 1 from public.vehicles where company_id = :'cid')
                   and exists (select 1 from public.budgets where company_id = :'cid'), 'reset keeps vehicles and budgets');

-- ---- Demo --------------------------------------------------------------------------------------
select tests.login_guest(:'g16'); set role authenticated;
select public.create_demo_company('enterprise') as demo \gset
select tests.check((select count(*) from public.vehicles where company_id = :'demo') = 2, 'enterprise demo has two vehicles');
select tests.check((select count(*) from public.budgets where company_id = :'demo') = 48, 'demo has budgets');
select tests.check((select count(*) from public.cashflow_forecast(:'demo', 13)) = 13, 'demo forecast works for the visitor');
reset role;

\echo ALL STAGE 15 PLANNING TESTS PASSED
