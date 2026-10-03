-- Tests for Stage 4: supplier RFQs, comparison and purchase orders.
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

insert into auth.users (email) values ('m4@p.test'), ('m4b@p.test'), ('p4@p.test'), ('s4@p.test'), ('w4@p.test'), ('f4@p.test');

select tests.login('m4@p.test'); set role authenticated;
select public.create_company('Buy Co') as cid \gset
select public.invite_member(:'cid', 'm4b@p.test', 'management');
select public.invite_member(:'cid', 'p4@p.test', 'procurement');
select public.invite_member(:'cid', 's4@p.test', 'sales');
select public.invite_member(:'cid', 'w4@p.test', 'warehouse');
select public.invite_member(:'cid', 'f4@p.test', 'finance');
insert into public.clients (company_id, name) values (:'cid', 'Mine Ltd') returning id as client \gset
insert into public.suppliers (company_id, name, country, currency) values (:'cid', 'Local Lubes', 'Tanzania', 'TZS') returning id as sup_a \gset
insert into public.suppliers (company_id, name, country, currency) values (:'cid', 'SA Bearings', 'South Africa', 'USD') returning id as sup_b \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'OIL', 'Hydraulic oil', 'drum', 1000000) returning id as oil \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'BRG', 'Bearing', 'pcs', 100000) returning id as brg \gset
reset role;
select tests.login('m4b@p.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('p4@p.test');  set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('s4@p.test');  set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('w4@p.test');  set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('f4@p.test');  set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;

-- Sales wins a quotation.
select tests.login('s4@p.test'); set role authenticated;
select public.create_quotation(:'cid', :'client', null) as q \gset
insert into public.quotation_lines (company_id, quotation_id, product_id, description, quantity, unit, unit_price)
values (:'cid', :'q', :'oil', 'Hydraulic oil', 10, 'drum', 1000000), (:'cid', :'q', :'brg', 'Bearing', 4, 'pcs', 100000);
reset role;
select tests.login('m4@p.test'); set role authenticated;
select public.submit_quotation(:'q');
select public.record_quotation_outcome(:'q', true, 'PO 123');
reset role;

-- ---- Supplier RFQ ---------------------------------------------------
select tests.login('s4@p.test'); set role authenticated;
select tests.blocked(format('select public.create_supplier_rfq(%L, null, %L)', :'cid', :'q'), 'sales cannot request supplier quotes');
select tests.check((select count(*) from public.supplier_rfqs) = 0, 'sales cannot see supplier RFQs');
reset role;

select tests.login('p4@p.test'); set role authenticated;
select public.create_supplier_rfq(:'cid', null, :'q') as srfq \gset
select tests.check((select number from public.supplier_rfqs where id = :'srfq') like 'SRFQ-____-0001', 'supplier RFQ gets a number');
select tests.check((select count(*) from public.supplier_rfq_lines where srfq_id = :'srfq') = 2, 'items copied from the accepted quotation');
select tests.check((select title from public.supplier_rfqs where id = :'srfq') = 'For Mine Ltd', 'title names the client');
insert into public.supplier_rfq_suppliers (company_id, srfq_id, supplier_id, currency) values (:'cid', :'srfq', :'sup_a', 'TZS') returning id as inv_a \gset
insert into public.supplier_rfq_suppliers (company_id, srfq_id, supplier_id, currency, exchange_rate, freight, lead_time_days)
  values (:'cid', :'srfq', :'sup_b', 'USD', 2600, 150, 21) returning id as inv_b \gset
select tests.blocked(format('insert into public.supplier_rfq_suppliers (company_id, srfq_id, supplier_id) values (%L, %L, %L)', :'cid', :'srfq', :'sup_a'), 'a supplier is invited only once');
insert into public.supplier_quote_lines (company_id, srfq_supplier_id, srfq_line_id, unit_price)
select :'cid', :'inv_a', id, case when product_id = :'oil' then 800000 else null end from public.supplier_rfq_lines where srfq_id = :'srfq';
insert into public.supplier_quote_lines (company_id, srfq_supplier_id, srfq_line_id, unit_price)
select :'cid', :'inv_b', id, case when product_id = :'oil' then 300 else 30 end from public.supplier_rfq_lines where srfq_id = :'srfq';
select tests.blocked(format('select public.award_supplier_rfq(%L)', (select id from public.supplier_rfq_suppliers where srfq_id = :'srfq' and supplier_id = :'sup_a')::text || 'x'), 'bad award id is rejected');

-- Award supplier B (USD): PO in USD with B's prices and freight, no VAT (foreign).
select public.award_supplier_rfq(:'inv_b') as po \gset
select tests.check((select status from public.supplier_rfqs where id = :'srfq') = 'awarded', 'supplier RFQ marked awarded');
select tests.check((select currency || ':' || exchange_rate::int from public.purchase_orders where id = :'po') = 'USD:2600', 'PO uses the supplier''s currency and rate');
select tests.check((select count(*) from public.po_lines where po_id = :'po') = 2, 'PO lines copied from the supplier''s prices');
select tests.check((select subtotal from public.purchase_orders where id = :'po') = 3120, 'PO subtotal 10x300 + 4x30');
select tests.check((select total from public.purchase_orders where id = :'po') = 3270, 'freight added, no VAT for a foreign supplier');
select tests.check((select number from public.purchase_orders where id = :'po') like 'PO-____-0001', 'PO gets a number');
select tests.blocked(format('select public.award_supplier_rfq(%L)', :'inv_a'), 'cannot award twice');

-- 3270 USD × 2600 = 8.5M TZS > 2.5M → needs approval when procurement submits.
select tests.check(public.submit_purchase_order(:'po') = 'pending_approval', 'big PO from procurement needs approval');
select tests.blocked(format('update public.po_lines set quantity = 1 where po_id = %L', :'po'), 'PO lines locked after submit');
select tests.blocked(format('update public.purchase_orders set freight = 0 where id = %L', :'po'), 'PO header locked after submit');
select tests.blocked(format('select public.review_purchase_order(%L, true, null)', :'po'), 'procurement cannot approve');
reset role;

select tests.login('w4@p.test'); set role authenticated;
select tests.check((select count(*) from public.purchase_orders) = 1, 'warehouse can see POs (for receiving)');
select tests.check((select count(*) from public.supplier_rfqs) = 0, 'warehouse cannot see supplier RFQs');
select tests.blocked(format('select public.create_purchase_order(%L, %L, null)', :'cid', :'sup_a'), 'warehouse cannot create POs');
reset role;

select tests.login('s4@p.test'); set role authenticated;
select tests.check((select count(*) from public.purchase_orders) = 0, 'sales cannot see POs');
reset role;

select tests.login('m4@p.test'); set role authenticated;
select public.review_purchase_order(:'po', true, 'Approved, urgent for client');
select tests.check((select status from public.purchase_orders where id = :'po') = 'approved', 'manager approves the PO');
reset role;

select tests.login('p4@p.test'); set role authenticated;
select public.mark_po_sent(:'po');
select public.confirm_purchase_order(:'po', 'SO-55821', '2026-11-20');
select tests.check((select status || ':' || supplier_ref from public.purchase_orders where id = :'po') = 'confirmed:SO-55821', 'supplier confirmation recorded');
select tests.check((select last_cost from public.product_costs where product_id = :'oil') = 780000, 'confirmed price updates last cost in TZS (300 × 2600)');
select tests.check((select main_supplier_id from public.product_costs where product_id = :'oil') = :'sup_b', 'supplier becomes main supplier if none was set');

-- Small direct PO from a local supplier: approved straight away, with VAT.
select public.create_purchase_order(:'cid', :'sup_a', null) as po2 \gset
insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price)
values (:'cid', :'po2', :'brg', 'Bearing', 10, 'pcs', 60000);
select tests.check((select vat_rate from public.purchase_orders where id = :'po2') = 18, 'local supplier PO includes VAT');
select tests.check((select total from public.purchase_orders where id = :'po2') = 708000, 'PO total with VAT');
select tests.check(public.submit_purchase_order(:'po2') = 'approved', 'small PO is approved automatically');
select public.cancel_purchase_order(:'po2');
select tests.check((select status from public.purchase_orders where id = :'po2') = 'cancelled', 'PO can be cancelled before receiving');

-- PO straight from the accepted quotation uses last costs.
select public.create_purchase_order(:'cid', :'sup_a', :'q') as po3 \gset
select tests.check((select unit_price from public.po_lines where po_id = :'po3' and product_id = :'oil') = 780000, 'PO from quotation uses last known cost');
reset role;

-- No self-approval for POs.
update public.memberships set role = 'management' where user_id = (select id from auth.users where email = 'p4@p.test');
select tests.login('m4b@p.test'); set role authenticated;
reset role;
update public.memberships set role = 'procurement' where user_id = (select id from auth.users where email = 'p4@p.test');
select tests.login('p4@p.test'); set role authenticated;
insert into public.po_lines (company_id, po_id, description, quantity, unit_price) values (:'cid', :'po3', 'Extra', 1, 5000000);
select tests.check(public.submit_purchase_order(:'po3') = 'pending_approval', 'procurement PO above limit waits');
reset role;
update public.memberships set role = 'management' where user_id = (select id from auth.users where email = 'p4@p.test');
select tests.login('p4@p.test'); set role authenticated;
select tests.blocked(format('select public.review_purchase_order(%L, true, null)', :'po3'), 'nobody approves their own PO');
reset role;
update public.memberships set role = 'procurement' where user_id = (select id from auth.users where email = 'p4@p.test');

select tests.login('f4@p.test'); set role authenticated;
select tests.check((select count(*) from public.purchase_orders) = 3, 'finance can see POs');
select tests.blocked(format('select public.submit_purchase_order(%L)', :'po3'), 'finance cannot submit POs');
reset role;

select tests.check((select count(*) from public.audit_log where entity = 'purchase_orders') >= 5, 'PO changes are logged');

\echo 'ALL STAGE 4 TESTS PASSED'
