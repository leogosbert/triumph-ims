-- Tests for Stage 5: stock, receiving and deliveries.
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

insert into auth.users (email) values ('m5@s.test'), ('w5@s.test'), ('s5@s.test'), ('d5@s.test'), ('d5b@s.test'), ('x5@o.test');

select tests.login('m5@s.test'); set role authenticated;
select public.create_company('Stock Co') as cid \gset
select tests.check((select count(*) from public.warehouses where company_id = :'cid' and code = 'MAIN') = 1, 'new company gets a main store');
select id as main from public.warehouses where company_id = :'cid' and code = 'MAIN' \gset
insert into public.warehouses (company_id, code, name) values (:'cid', 'GTA', 'Geita store') returning id as geita \gset
select public.invite_member(:'cid', 'w5@s.test', 'warehouse');
select public.invite_member(:'cid', 's5@s.test', 'sales');
select public.invite_member(:'cid', 'd5@s.test', 'driver');
select public.invite_member(:'cid', 'd5b@s.test', 'driver');
insert into public.clients (company_id, name, delivery_sites) values (:'cid', 'Geita Mine', 'Main stores, Geita') returning id as client \gset
insert into public.suppliers (company_id, name) values (:'cid', 'Lubes Ltd') returning id as sup \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'OIL', 'Hydraulic oil', 'drum', 1000000) returning id as oil \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'FLT', 'Filter', 'pcs', 50000) returning id as flt \gset
select public.create_purchase_order(:'cid', :'sup', null) as po \gset
insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price)
values (:'cid', :'po', :'oil', 'Hydraulic oil', 10, 'drum', 800000) returning id as pl_oil \gset
insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price)
values (:'cid', :'po', :'flt', 'Filter', 20, 'pcs', 30000) returning id as pl_flt \gset
select public.submit_purchase_order(:'po');
reset role;
select tests.login('w5@s.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('s5@s.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('d5@s.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('d5b@s.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('x5@o.test'); set role authenticated; select public.create_company('Other Co'); reset role;

-- ---- Receiving ---------------------------------------------------------
select tests.login('w5@s.test'); set role authenticated;
select tests.blocked(format('select public.receive_goods(%L, %L, null, null, null, %L)', :'po', :'main',
  json_build_array(json_build_object('po_line_id', :'pl_oil', 'quantity', 11))::text), 'cannot receive more than ordered');
select public.receive_goods(:'po', :'main', null, 'DN-778', 'First lot', jsonb_build_array(
  jsonb_build_object('po_line_id', :'pl_oil', 'quantity', 4, 'batch_no', 'B1', 'expiry_date', '2027-01-31'),
  jsonb_build_object('po_line_id', :'pl_oil', 'quantity', 3, 'batch_no', 'B2', 'expiry_date', '2026-12-31'),
  jsonb_build_object('po_line_id', :'pl_flt', 'quantity', 20, 'condition', 'good'))) as grn1 \gset
select tests.check((select number from public.goods_receipts where id = :'grn1') like 'GRN-____-0001', 'GRN gets a number');
select tests.check((select status from public.purchase_orders where id = :'po') = 'partially_received', 'PO partly received');
select tests.check((select received_qty from public.po_lines where id = :'pl_oil') = 7, 'received quantity tracked on the PO line');
select tests.check((select sum(quantity) from public.stock_on_hand where product_id = :'oil') = 7, 'stock on hand increases');
select tests.check((select count(*) from public.stock_on_hand where product_id = :'oil') = 2, 'stock kept per batch');
select public.receive_goods(:'po', :'main', null, null, null, jsonb_build_array(
  jsonb_build_object('po_line_id', :'pl_oil', 'quantity', 3, 'batch_no', 'B3', 'condition', 'damaged')));
select tests.check((select status from public.purchase_orders where id = :'po') = 'received', 'PO fully received');
select tests.check((select sum(quantity) from public.stock_on_hand where product_id = :'oil') = 7, 'damaged goods do not go into stock');
select tests.blocked('insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind) values ('''
  || :'cid' || ''', ''' || :'oil' || ''', ''' || :'main' || ''', 100, ''adjustment'')', 'stock cannot be typed in directly');
reset role;

select tests.login('s5@s.test'); set role authenticated;
select tests.check((select sum(quantity) from public.stock_on_hand where product_id = :'oil') = 7, 'sales can see stock levels');
select tests.blocked(format('select public.adjust_stock(%L, %L, %L, 5, %L, null, %L)', :'cid', :'oil', :'main', 'B1', 'count'), 'sales cannot adjust stock');
reset role;

select tests.login('w5@s.test'); set role authenticated;
select tests.blocked(format('select public.adjust_stock(%L, %L, %L, -50, %L, null, %L)', :'cid', :'oil', :'main', 'B1', 'count'), 'cannot remove more than is in the batch');
select tests.blocked(format('select public.adjust_stock(%L, %L, %L, 2, %L, null, %L)', :'cid', :'oil', :'main', 'B9', ''), 'adjustment needs a reason');
select public.adjust_stock(:'cid', :'oil', :'geita', 2, 'B0', '2026-11-30', 'Opening balance');
select tests.check((select quantity from public.stock_on_hand where product_id = :'oil' and warehouse_id = :'geita') = 2, 'opening balance in the second store');
reset role;

-- ---- Deliveries --------------------------------------------------------
select id as driver1 from auth.users where email = 'd5@s.test' \gset
select tests.login('s5@s.test'); set role authenticated;
select public.create_quotation(:'cid', :'client', null) as q \gset
insert into public.quotation_lines (company_id, quotation_id, product_id, description, quantity, unit, unit_price)
values (:'cid', :'q', :'oil', 'Hydraulic oil', 6, 'drum', 1000000), (:'cid', :'q', :'flt', 'Filter', 5, 'pcs', 50000);
reset role;
select tests.login('m5@s.test'); set role authenticated;
select public.submit_quotation(:'q');
select public.record_quotation_outcome(:'q', true, 'PO');
reset role;

select tests.login('s5@s.test'); set role authenticated;
select public.create_delivery(:'cid', null, :'q', null) as dn \gset
select tests.check((select number from public.deliveries where id = :'dn') like 'DN-____-0001', 'delivery note gets a number');
select tests.check((select warehouse_id from public.deliveries where id = :'dn') = :'main', 'main store chosen by default');
select tests.check((select delivery_site from public.deliveries where id = :'dn') = 'Main stores, Geita', 'site copied from the client');
select tests.check((select count(*) from public.delivery_lines where delivery_id = :'dn') = 2, 'quotation items copied');
update public.delivery_lines set quantity = 5 where delivery_id = :'dn' and product_id = :'oil';
update public.deliveries set driver_id = :'driver1', vehicle = 'T 123 ABC' where id = :'dn';
select tests.blocked(format('select public.dispatch_delivery(%L)', :'dn'), 'sales cannot dispatch');
reset role;

select tests.login('d5@s.test'); set role authenticated;
select tests.check((select count(*) from public.deliveries) = 1, 'driver sees the delivery assigned to them');
select tests.check((select count(*) from public.delivery_lines) = 2, 'driver sees its items');
select tests.check((select count(*) from public.stock_on_hand) = 0, 'driver cannot see stock levels');
select tests.blocked(format('select public.confirm_delivery(%L, %L, %L, null, null, null, null, null)', :'dn', 'Asha', :'cid' || '/' || :'dn' || '/sig.png'), 'cannot confirm before dispatch');
reset role;

select tests.login('d5b@s.test'); set role authenticated;
select tests.check((select count(*) from public.deliveries) = 0, 'another driver cannot see it');
reset role;

select tests.login('w5@s.test'); set role authenticated;
select public.dispatch_delivery(:'dn');
select tests.check((select status from public.deliveries where id = :'dn') = 'dispatched', 'dispatched');
select tests.check((select -sum(quantity) from public.stock_movements where delivery_id = :'dn' and product_id = :'oil' and batch_no = 'B2') = 3,
                   'oldest expiry batch (B2) used first');
select tests.check((select -sum(quantity) from public.stock_movements where delivery_id = :'dn' and product_id = :'oil' and batch_no = 'B1') = 2,
                   'then the next batch (B1)');
select tests.check((select sum(quantity) from public.stock_on_hand where product_id = :'oil' and warehouse_id = :'main') = 2, 'stock reduced');
select tests.blocked(format('update public.delivery_lines set quantity = 1 where delivery_id = %L', :'dn'), 'items locked after dispatch');
select tests.blocked(format('update public.deliveries set delivery_site = %L where id = %L', 'Elsewhere', :'dn'), 'site locked after dispatch');
reset role;

select tests.login('d5@s.test'); set role authenticated;
insert into storage.objects (bucket_id, name) values ('pod', :'cid' || '/' || :'dn' || '/signature.png');
select tests.check(true, 'driver can upload the signature for their delivery');
select tests.blocked(format('select public.confirm_delivery(%L, %L, null, null, null, null, null, null)', :'dn', 'Asha'), 'signature required');
select tests.blocked(format('select public.confirm_delivery(%L, %L, %L, null, null, null, null, null)', :'dn', '', :'cid' || '/' || :'dn' || '/signature.png'), 'receiver name required');
select tests.blocked(format('select public.confirm_delivery(%L, %L, %L, null, null, null, null, null)', :'dn', 'Asha', 'other/place/sig.png'), 'signature must belong to this delivery');
reset role; insert into storage.objects (bucket_id, name) values ('pod', :'cid' || '/' || :'dn' || '/signature.png'); set role authenticated;
select public.confirm_delivery(:'dn', 'Asha Mwakyusa', :'cid' || '/' || :'dn' || '/signature.png', null, -2.87, 32.23, 'All good', now() - interval '2 hours');
select tests.check((select status from public.deliveries where id = :'dn') = 'delivered', 'driver confirms delivery');
select tests.check((select delivered_at < now() - interval '1 hour' from public.deliveries where id = :'dn'), 'offline time of delivery kept');
select public.confirm_delivery(:'dn', 'Asha Mwakyusa', :'cid' || '/' || :'dn' || '/signature.png', null, null, null, null, null);
select tests.check(true, 'syncing the same confirmation twice is harmless');
reset role;

select tests.login('d5b@s.test'); set role authenticated;
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'pod', :'cid' || '/' || :'dn' || '/x.png'), 'other driver cannot upload to it');
reset role;

-- Second delivery: only what is left; then it fails and stock comes back.
select tests.login('w5@s.test'); set role authenticated;
select public.create_delivery(:'cid', null, :'q', null) as dn2 \gset
select tests.check((select quantity from public.delivery_lines where delivery_id = :'dn2' and product_id = :'oil') = 1, 'next delivery has only the remaining quantity');
select tests.check((select count(*) from public.delivery_lines where delivery_id = :'dn2') = 1, 'fully delivered items are left out');
select tests.blocked(format('select public.dispatch_delivery(%L)', (select public.create_delivery(:'cid', :'client', null, :'geita'))), 'cannot dispatch an empty note');
update public.delivery_lines set quantity = 3 where delivery_id = :'dn2';
select tests.blocked(format('select public.dispatch_delivery(%L)', :'dn2'), 'cannot dispatch more than in stock');
update public.delivery_lines set quantity = 1 where delivery_id = :'dn2';
select public.dispatch_delivery(:'dn2');
select public.fail_delivery(:'dn2', 'Site closed');
select tests.check((select sum(quantity) from public.stock_on_hand where product_id = :'oil' and warehouse_id = :'main') = 2, 'failed delivery returns the stock');
reset role;

select tests.login('x5@o.test'); set role authenticated;
select tests.check((select count(*) from public.deliveries) = 0, 'outsider sees no deliveries');
select tests.check((select count(*) from public.stock_on_hand) = 0, 'outsider sees no stock');
reset role;

\echo 'ALL STAGE 5 TESTS PASSED'
