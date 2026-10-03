-- Tests for Stage 6: invoices, payments, supplier bills, costs and profit.
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

insert into auth.users (email) values ('m6@f.test'), ('f6@f.test'), ('s6@f.test'), ('p6@f.test'), ('x6@o.test');

select tests.login('m6@f.test'); set role authenticated;
select public.create_company('Fin Co') as cid \gset
select public.invite_member(:'cid', 'f6@f.test', 'finance');
select public.invite_member(:'cid', 's6@f.test', 'sales');
select public.invite_member(:'cid', 'p6@f.test', 'procurement');
insert into public.clients (company_id, name, credit_limit) values (:'cid', 'Gold Mine Ltd', 5000000) returning id as client \gset
insert into public.suppliers (company_id, name, currency) values (:'cid', 'Lube Imports', 'USD') returning id as sup \gset
insert into public.suppliers (company_id, name) values (:'cid', 'Local Hardware') returning id as sup2 \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'OIL', 'Hydraulic oil', 'drum', 1000000) returning id as oil \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'BRG', 'Bearing', 'pcs', 100000) returning id as brg \gset
insert into public.product_costs (product_id, company_id, last_cost) values (:'oil', :'cid', 700000);
select public.create_quotation(:'cid', :'client', null) as q \gset
insert into public.quotation_lines (company_id, quotation_id, product_id, description, quantity, unit, unit_price)
values (:'cid', :'q', :'oil', 'Hydraulic oil', 4, 'drum', 1000000), (:'cid', :'q', :'brg', 'Bearing', 10, 'pcs', 100000);
select public.submit_quotation(:'q');
select public.record_quotation_outcome(:'q', true, 'Client PO 4411');
reset role;
select tests.login('f6@f.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('s6@f.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('p6@f.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('x6@o.test'); set role authenticated; select public.create_company('Other Co'); reset role;

-- ---- Invoices ----------------------------------------------------------
select tests.login('s6@f.test'); set role authenticated;
select tests.blocked(format('select public.create_invoice(%L, null, %L, null)', :'cid', :'q'), 'sales cannot create invoices');
reset role;

select tests.login('f6@f.test'); set role authenticated;
select public.create_invoice(:'cid', null, :'q', null) as inv1 \gset
select tests.check((select status || ':' || number from public.invoices where id = :'inv1') = 'draft:', 'draft invoice has no number yet');
select tests.check((select count(*) from public.invoice_lines where invoice_id = :'inv1') = 2, 'items copied from the accepted quotation');
update public.invoice_lines set quantity = 2 where invoice_id = :'inv1' and product_id = :'oil';
select tests.check((select total from public.invoices where id = :'inv1') = 3540000, 'invoice total with 18% VAT (2 drums + 10 bearings)');
select tests.blocked(format('update public.invoices set amount_paid = 100 where id = %L', :'inv1'), 'amount paid cannot be typed in');
select tests.blocked(format('insert into public.invoices (company_id, client_id, status) values (%L, %L, %L)', :'cid', :'client', 'paid'), 'new invoices cannot skip draft');

-- Second draft picks up only what is not yet invoiced.
select public.create_invoice(:'cid', null, :'q', null) as inv_tmp \gset
select tests.check((select string_agg(trim_scale(quantity)::text, ',') from public.invoice_lines where invoice_id = :'inv_tmp') = '2', 'next invoice takes the remaining 2 drums only');
select public.cancel_invoice(:'inv_tmp', null);

select public.issue_invoice(:'inv1') as n1 \gset
select tests.check(:'n1' like 'INV-____-0001', 'issued invoice gets a number');
select tests.check((select due_date - issue_date from public.invoices where id = :'inv1') = 30, 'due date from company payment days');
select tests.blocked(format('update public.invoice_lines set quantity = 1 where invoice_id = %L', :'inv1'), 'lines locked after issue');
select tests.blocked(format('update public.invoices set notes = %L where id = %L', 'x', :'inv1'), 'header locked after issue');
select tests.blocked(format('select public.issue_invoice(%L)', :'inv1'), 'cannot issue twice');
select tests.check((select unit_cost from public.invoice_costs c join public.invoice_lines l on l.id = c.invoice_line_id
                     where l.invoice_id = :'inv1' and l.product_id = :'oil') = 700000, 'cost snapshot taken at issue');
select tests.check((select revenue_base || '/' || cost_base || '/' || lines_without_cost from public.invoice_profit where invoice_id = :'inv1')
                   = '3000000.00/1400000.00/1', 'profit: revenue before VAT, cost of goods, lines without cost');

-- Credit limit 5,000,000: owes 3,540,000; another 2,360,000 is too much for finance.
select public.create_invoice(:'cid', null, :'q', null) as inv2 \gset
select tests.check((select total from public.invoices where id = :'inv2') = 2360000, 'second invoice for the remaining drums');
select tests.blocked(format('select public.issue_invoice(%L)', :'inv2'), 'credit limit stops finance');
reset role;

select tests.login('s6@f.test'); set role authenticated;
select tests.check((select count(*) from public.invoices where status <> 'cancelled') = 2, 'sales can see invoices');
select tests.check((select count(*) from public.invoice_costs) = 0, 'sales cannot see invoice costs');
select tests.check((select cost_base from public.invoice_profit where invoice_id = :'inv1') = 0, 'sales gets no costs from the profit view');
select tests.blocked(format('select public.record_payment(%L, null, 1000, null, null, null, null)', :'inv1'), 'sales cannot record payments');
reset role;

select tests.login('m6@f.test'); set role authenticated;
select public.issue_invoice(:'inv2') as n2 \gset
select tests.check(:'n2' like 'INV-____-0002', 'numbers have no gaps');
select tests.check((select credit_override_by is not null from public.invoices where id = :'inv2'), 'manager override above the credit limit is recorded');
reset role;

-- ---- Payments ----------------------------------------------------------
select tests.login('f6@f.test'); set role authenticated;
select public.record_payment(:'inv1', '2026-10-10', 1000000, 'bank_transfer', 'CRDB 5521', null, null) as pay1 \gset
select tests.check((select number from public.payments where id = :'pay1') like 'RCT-____-0001', 'receipt gets a number');
select tests.check((select status || ':' || amount_paid from public.invoices where id = :'inv1') = 'partly_paid:1000000.00', 'part payment');
select tests.blocked(format('select public.record_payment(%L, null, 2540001, null, null, null, null)', :'inv1'), 'cannot receive more than owed');
select public.record_payment(:'inv1', '2026-10-20', 2540000, 'mobile_money', 'M-Pesa', null, null) as pay2 \gset
select tests.check((select status from public.invoices where id = :'inv1') = 'paid', 'fully paid');
select tests.blocked(format('select public.record_payment(%L, null, 1, null, null, null, null)', :'inv1'), 'no payments on a paid invoice');
select tests.blocked(format('select public.void_payment(%L, %L)', :'pay2', 'mistake'), 'finance cannot void payments');
select tests.blocked(format('select public.cancel_invoice(%L, %L)', :'inv2', 'wrong'), 'finance cannot cancel an issued invoice');
reset role;

select tests.login('s6@f.test'); set role authenticated;
select tests.check((select count(*) from public.payments) = 2, 'sales can see payments');
reset role;

select tests.login('m6@f.test'); set role authenticated;
select tests.blocked(format('select public.void_payment(%L, %L)', :'pay2', ''), 'voiding needs a reason');
select public.void_payment(:'pay2', 'Bounced');
select tests.check((select status || ':' || amount_paid from public.invoices where id = :'inv1') = 'partly_paid:1000000.00', 'voided payment reopens the invoice');
select tests.blocked(format('select public.cancel_invoice(%L, %L)', :'inv1', 'wrong'), 'cannot cancel an invoice with payments');
select public.cancel_invoice(:'inv2', 'Client returned the drums');
select tests.check((select status from public.invoices where id = :'inv2') = 'cancelled', 'manager cancels an unpaid issued invoice');

-- ---- Invoice from a delivery ---------------------------------------------
select public.adjust_stock(:'cid', :'oil', (select id from public.warehouses where company_id = :'cid' and code = 'MAIN'), 10, '', null, 'Opening stock');
select public.create_delivery(:'cid', null, :'q', null) as dn \gset
select tests.blocked(format('select public.create_invoice(%L, null, null, %L)', :'cid', :'dn'), 'cannot invoice an undelivered delivery note');
delete from public.delivery_lines where delivery_id = :'dn' and product_id = :'brg';
select public.dispatch_delivery(:'dn');
select public.confirm_delivery(:'dn', 'J. Store', :'cid' || '/' || :'dn' || '/sig.png', null, null, null, null, null);
reset role;
select tests.login('f6@f.test'); set role authenticated;
select public.create_invoice(:'cid', null, null, :'dn') as inv3 \gset
select tests.check((select string_agg(trim_scale(quantity)::text || '@' || trim_scale(unit_price)::text, ',') from public.invoice_lines where invoice_id = :'inv3')
                   = '4@1000000', 'invoice bills exactly what was delivered, at the quoted price');
select tests.check((select quotation_id from public.invoices where id = :'inv3') = :'q', 'delivery invoice is linked to the order');
select tests.blocked(format('select public.create_invoice(%L, null, null, %L)', :'cid', :'dn'), 'a delivery is invoiced only once');
reset role;

-- ---- Supplier bills ----------------------------------------------------
select tests.login('m6@f.test'); set role authenticated;
select public.create_purchase_order(:'cid', :'sup', null) as po \gset
update public.purchase_orders set exchange_rate = 2600, freight = 50 where id = :'po';
insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price)
values (:'cid', :'po', :'oil', 'Hydraulic oil', 10, 'drum', 300);
reset role;

select tests.login('p6@f.test'); set role authenticated;
select tests.blocked(format('insert into public.supplier_bills (company_id, supplier_id, subtotal) values (%L, %L, 100)', :'cid', :'sup'), 'procurement cannot enter bills');
reset role;

select tests.login('f6@f.test'); set role authenticated;
select tests.blocked(format('insert into public.supplier_bills (company_id, supplier_id, po_id, subtotal) values (%L, %L, %L, 100)', :'cid', :'sup2', :'po'), 'bill PO must belong to the same supplier');
select tests.blocked(format('insert into public.supplier_bills (company_id, supplier_id, subtotal) values (%L, %L, 0)', :'cid', :'sup'), 'bill needs an amount');
insert into public.supplier_bills (company_id, supplier_id, po_id, supplier_invoice_no, currency, exchange_rate, subtotal, vat_amount, due_date)
values (:'cid', :'sup', :'po', 'LI-9921', 'USD', 2600, 3050, 0, '2026-11-15') returning id as bill \gset
select tests.check((select number || ':' || total from public.supplier_bills where id = :'bill') like 'BILL-____-0001:3050.00', 'bill gets a number and total');
select public.pay_supplier_bill(:'bill', '2026-10-12', 1000, 'bank_transfer', 'TT 001', 2610, null) as spay \gset
select tests.check((select status || ':' || amount_paid from public.supplier_bills where id = :'bill') = 'partly_paid:1000.00', 'part paid to supplier');
select tests.check((select exchange_rate from public.supplier_payments where id = :'spay') = 2610, 'payment keeps its own exchange rate');
select tests.blocked(format('update public.supplier_bills set subtotal = 10 where id = %L', :'bill'), 'bill locked once paid');
select tests.blocked(format('update public.supplier_bills set status = %L where id = %L', 'paid', :'bill'), 'bill status only via payments');
select tests.blocked(format('select public.pay_supplier_bill(%L, null, 2051, null, null, null, null)', :'bill'), 'cannot pay more than owed');
select tests.blocked(format('select public.cancel_supplier_bill(%L)', :'bill'), 'cannot cancel a bill with payments');
reset role;

select tests.login('p6@f.test'); set role authenticated;
select tests.check((select count(*) from public.supplier_bills) = 1, 'procurement can see supplier bills');
reset role;
select tests.login('s6@f.test'); set role authenticated;
select tests.check((select count(*) from public.supplier_bills) = 0, 'sales cannot see supplier bills');
reset role;

select tests.login('m6@f.test'); set role authenticated;
select public.void_supplier_payment(:'spay', 'Wrong supplier');
select tests.check((select status || ':' || amount_paid from public.supplier_bills where id = :'bill') = 'open:0.00', 'voided supplier payment reopens the bill');
reset role;

-- ---- Extra costs and landed cost -----------------------------------------
select tests.login('p6@f.test'); set role authenticated;
select tests.blocked(format('select public.apply_landed_cost(%L)', :'po'), 'landed cost needs a confirmed PO');
insert into public.order_costs (company_id, po_id, kind, amount, currency, exchange_rate) values (:'cid', :'po', 'freight', 100, 'USD', 2600);
insert into public.order_costs (company_id, po_id, kind, amount) values (:'cid', :'po', 'duty', 300000);
insert into public.order_costs (company_id, quotation_id, kind, amount, description) values (:'cid', :'q', 'transport', 150000, 'Truck to Geita');
select tests.blocked(format('insert into public.order_costs (company_id, quotation_id, po_id, amount) values (%L, %L, %L, 1)', :'cid', :'q', :'po'), 'a cost belongs to an order or a PO, not both');
reset role;

select tests.login('s6@f.test'); set role authenticated;
select tests.check((select count(*) from public.order_costs) = 0, 'sales cannot see costs');
select tests.blocked(format('insert into public.order_costs (company_id, quotation_id, amount) values (%L, %L, 1)', :'cid', :'q'), 'sales cannot add costs');
select tests.blocked(format('select public.apply_landed_cost(%L)', :'po'), 'sales cannot apply landed cost');
reset role;

select tests.login('m6@f.test'); set role authenticated;
select public.submit_purchase_order(:'po');
select public.confirm_purchase_order(:'po', 'SO-1', null);
reset role;
select tests.login('p6@f.test'); set role authenticated;
-- goods 3000×2600 = 7,800,000; freight 50×2600 = 130,000; extras 260,000 + 300,000
select tests.check(public.apply_landed_cost(:'po') = 8490000, 'landed cost = goods + freight + duty + other costs');
select tests.check((select last_cost from public.product_costs where product_id = :'oil') = 849000, 'landed unit cost written into the product cost');
select tests.check((select landed_cost_base from public.purchase_orders where id = :'po') = 8490000, 'landed cost recorded on the PO');
reset role;

-- ---- Isolation and audit -------------------------------------------------
select tests.login('x6@o.test'); set role authenticated;
select tests.check((select count(*) from public.invoices) = 0, 'other companies cannot see invoices');
select tests.check((select count(*) from public.payments) = 0, 'other companies cannot see payments');
select tests.blocked(format('select public.record_payment(%L, null, 1, null, null, null, null)', :'inv1'), 'other companies cannot record payments');
reset role;

select tests.check((select count(*) from public.audit_log where entity = 'invoices') >= 5, 'invoice changes are logged');
select tests.check((select count(*) from public.audit_log where entity = 'payments') >= 2, 'payments are logged');

\echo 'ALL STAGE 6 TESTS PASSED'
