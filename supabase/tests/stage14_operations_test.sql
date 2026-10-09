-- Tests for Stage 14 part 2: stock transfers, maximum levels and reorder suggestions, purchase requests.
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
grant execute on all functions in schema tests to authenticated, anon;



insert into auth.users (email) values ('m15@o.test'), ('w15@o.test'), ('s15@o.test'), ('p15@o.test'), ('d15@o.test'), ('x15@x.test');
insert into auth.users (is_anonymous) values (true) returning id as g15 \gset
select id as m15 from auth.users where email = 'm15@o.test' \gset
select id as w15 from auth.users where email = 'w15@o.test' \gset
select id as s15 from auth.users where email = 's15@o.test' \gset
select id as p15 from auth.users where email = 'p15@o.test' \gset

select tests.login('m15@o.test'); set role authenticated;
select public.create_company('Ops Co') as cid \gset
select public.invite_member(:'cid', 'w15@o.test', 'warehouse');
select public.invite_member(:'cid', 's15@o.test', 'sales');
select public.invite_member(:'cid', 'p15@o.test', 'procurement');
select public.invite_member(:'cid', 'd15@o.test', 'driver');
select id as main from public.warehouses where company_id = :'cid' and code = 'MAIN' \gset
insert into public.warehouses (company_id, code, name) values (:'cid', 'MWZ', 'Mwanza branch') returning id as mwz \gset
insert into public.suppliers (company_id, name) values (:'cid', 'Lube Importers') returning id as sup \gset
insert into public.products (company_id, sku, name, unit, selling_price, reorder_level) values (:'cid', 'OIL', 'Engine oil', 'drum', 500000, 10) returning id as oil \gset
insert into public.products (company_id, sku, name, unit, selling_price, reorder_level) values (:'cid', 'GLV', 'Gloves', 'pair', 5000, 50) returning id as glv \gset
insert into public.product_costs (company_id, product_id, last_cost) values (:'cid', :'oil', 400000);
select public.adjust_stock(:'cid', :'oil', :'main', 6, 'B-OLD', current_date + 30, 'Opening stock');
select public.adjust_stock(:'cid', :'oil', :'main', 10, 'B-NEW', current_date + 300, 'Opening stock');
reset role;
select tests.login('w15@o.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('s15@o.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('p15@o.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('d15@o.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('x15@x.test'); set role authenticated; select public.create_company('Other Ops Co') as other \gset
reset role;

-- ---- Stock transfers ---------------------------------------------------------------------
select tests.login('s15@o.test'); set role authenticated;
select tests.blocked(format('insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id) values (%L, %L, %L)', :'cid', :'main', :'mwz'),
                     'sales cannot start a transfer');
reset role;
select tests.login('w15@o.test'); set role authenticated;
select tests.blocked(format('insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id) values (%L, %L, %L)', :'cid', :'main', :'main'),
                     'a transfer needs two different stores');
insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id, reason) values (:'cid', :'main', :'mwz', 'Branch top-up')
returning id as t1 \gset
select tests.check((select number like 'TRF-____-0001' and status = 'draft' from public.stock_transfers where id = :'t1'), 'transfer numbered, starts as a draft');
select tests.blocked(format('select public.send_stock_transfer(%L)', :'t1'), 'cannot send an empty transfer');
insert into public.stock_transfer_lines (company_id, transfer_id, product_id, quantity) values (:'cid', :'t1', :'oil', 20);
select tests.blocked(format('select public.send_stock_transfer(%L)', :'t1'), 'cannot send more than is in the store');
update public.stock_transfer_lines set quantity = 8 where transfer_id = :'t1';
select tests.blocked(format('update public.stock_transfers set status = %L where id = %L', 'received', :'t1'), 'status cannot be typed in');
select public.send_stock_transfer(:'t1');
select tests.check((select status = 'in_transit' and sent_by = :'w15' from public.stock_transfers where id = :'t1'), 'transfer sent');
select tests.check((select coalesce(sum(quantity), 0) from public.stock_movements where product_id = :'oil' and warehouse_id = :'main') = 8,
                   'the goods left the main store');
select tests.check((select quantity from public.stock_on_hand where product_id = :'oil' and warehouse_id = :'main' and batch_no = 'B-OLD') is null
                   and (select quantity from public.stock_on_hand where product_id = :'oil' and warehouse_id = :'main' and batch_no = 'B-NEW') = 8,
                   'oldest expiry leaves first');
select tests.check(not exists (select 1 from public.stock_movements where product_id = :'oil' and warehouse_id = :'mwz'), 'nothing in the branch while on the way');
select tests.blocked(format('update public.stock_transfer_lines set quantity = 1 where transfer_id = %L', :'t1'), 'items frozen once sent');
select tests.blocked(format('update public.stock_transfers set to_warehouse_id = %L where id = %L', :'main', :'t1'), 'stores frozen once sent');
select public.receive_stock_transfer(:'t1', 'All fine');
select tests.check((select status = 'received' and received_by = :'w15' from public.stock_transfers where id = :'t1'), 'transfer received');
select tests.check((select quantity from public.stock_on_hand where product_id = :'oil' and warehouse_id = :'mwz' and batch_no = 'B-OLD') = 6
                   and (select quantity from public.stock_on_hand where product_id = :'oil' and warehouse_id = :'mwz' and batch_no = 'B-NEW') = 2
                   and (select expiry_date from public.stock_on_hand where product_id = :'oil' and warehouse_id = :'mwz' and batch_no = 'B-OLD') = current_date + 30,
                   'the same batches and expiry dates arrive in the branch');
select tests.blocked(format('select public.cancel_stock_transfer(%L)', :'t1'), 'a received transfer cannot be cancelled');
select tests.blocked(format('select public.receive_stock_transfer(%L, null)', :'t1'), 'cannot receive twice');
-- Cancel on the way: stock goes back.
insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id) values (:'cid', :'mwz', :'main') returning id as t2 \gset
insert into public.stock_transfer_lines (company_id, transfer_id, product_id, quantity) values (:'cid', :'t2', :'oil', 7);
select public.send_stock_transfer(:'t2');
select public.cancel_stock_transfer(:'t2');
select tests.check((select status from public.stock_transfers where id = :'t2') = 'cancelled'
                   and (select sum(quantity) from public.stock_movements where product_id = :'oil' and warehouse_id = :'mwz') = 8,
                   'cancelling on the way puts the stock back');
reset role;
select tests.check((select sum(quantity) from public.stock_movements where product_id = :'oil') = 16, 'transfers never create or lose stock');
select tests.login('s15@o.test'); set role authenticated;
select tests.check((select count(*) from public.stock_transfers where company_id = :'cid') = 2, 'sales can see transfers');
select tests.blocked(format('select public.receive_stock_transfer(%L, null)', :'t2'), 'sales cannot receive');
reset role;
select tests.login('x15@x.test'); set role authenticated;
select tests.check((select count(*) from public.stock_transfers where company_id = :'cid') = 0, 'another company sees no transfers');
select tests.blocked(format('select public.cancel_stock_transfer(%L)', :'t2'), 'outsider cannot touch a transfer');
reset role;

-- ---- Maximum levels and reorder suggestions -------------------------------------------------------
select tests.login('m15@o.test'); set role authenticated;
select tests.blocked(format('update public.products set max_level = 5 where id = %L', :'oil'), 'maximum cannot be below the reorder level');
update public.products set max_level = 40 where id = :'oil';
select public.create_purchase_order(:'cid', :'sup', null) as po0 \gset
insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values (:'cid', :'po0', :'oil', 'Engine oil', 5, 'drum', 400000);
reset role;
select tests.login('p15@o.test'); set role authenticated;
select tests.check((select on_hand = 16 and on_order = 5 and suggest = 19 from public.reorder_suggestions(:'cid') where product_id = :'oil') is null,
                   'oil above its reorder level is not suggested');
reset role;
select tests.login('w15@o.test'); set role authenticated;
select public.adjust_stock(:'cid', :'oil', :'main', -8, 'B-NEW', null, 'Used for the test');
reset role;
select tests.login('p15@o.test'); set role authenticated;
select tests.check((select on_hand = 8 and on_order = 5 and suggest = 27 from public.reorder_suggestions(:'cid') where product_id = :'oil'),
                   'suggest = maximum - on hand - on order');
select tests.check((select suggest = 100 and on_hand = 0 from public.reorder_suggestions(:'cid') where product_id = :'glv'),
                   'no maximum: twice the reorder level');
reset role;
select tests.login('w15@o.test'); set role authenticated;
select tests.check((select last_cost is null from public.reorder_suggestions(:'cid') where product_id = :'oil'), 'warehouse sees suggestions without costs');
reset role;
select tests.login('s15@o.test'); set role authenticated;
select tests.check((select count(*) from public.reorder_suggestions(:'cid')) = 0, 'sales gets no reorder suggestions');
reset role;

-- ---- Purchase requests -------------------------------------------------------------------------
select tests.login('d15@o.test'); set role authenticated;
select tests.blocked(format('insert into public.requisitions (company_id, reason) values (%L, %L)', :'cid', 'x'), 'drivers cannot make purchase requests');
reset role;
select tests.login('s15@o.test'); set role authenticated;
insert into public.requisitions (company_id, needed_by, warehouse_id, reason) values (:'cid', current_date + 7, :'main', 'Client order next week')
returning id as r1 \gset
select tests.check((select number like 'REQ-____-0001' and status = 'draft' and created_by = :'s15' from public.requisitions where id = :'r1'), 'request numbered, draft');
insert into public.requisition_lines (company_id, requisition_id, product_id, description, quantity) values (:'cid', :'r1', :'glv', '', 200);
insert into public.requisition_lines (company_id, requisition_id, description, quantity, unit) values (:'cid', :'r1', 'Safety signs', 4, 'pcs');
select tests.check((select description = 'Gloves' and unit = 'pair' from public.requisition_lines where requisition_id = :'r1' and product_id = :'glv'),
                   'product name and unit filled in');
select tests.blocked(format('update public.requisitions set status = %L where id = %L', 'approved', :'r1'), 'status cannot be typed in');
select tests.check(public.submit_requisition(:'r1') = 'submitted', 'request sent for approval');
select tests.blocked(format('insert into public.requisition_lines (company_id, requisition_id, description, quantity) values (%L, %L, %L, 1)',
                            :'cid', :'r1', 'More'), 'items frozen once sent');
select tests.blocked(format('select public.decide_requisition(%L, true, null)', :'r1'), 'sales cannot approve');
reset role;
select tests.check((select count(*) from public.notifications where user_id = :'m15' and kind = 'requisition' and link = '/requisitions/' || :'r1') = 1,
                   'management told there is a request to approve');
select tests.login('w15@o.test'); set role authenticated;
select tests.check((select count(*) from public.requisitions where company_id = :'cid') = 0, 'others do not see someone else''s request');
reset role;
select tests.login('m15@o.test'); set role authenticated;
select tests.blocked(format('select public.decide_requisition(%L, false, %L)', :'r1', ''), 'rejecting needs a reason');
select public.decide_requisition(:'r1', true, 'OK, order from the usual supplier');
select tests.check((select status = 'approved' and decided_by = :'m15' from public.requisitions where id = :'r1'), 'request approved');
reset role;
select tests.check((select read_at is not null from public.notifications where user_id = :'m15' and dedupe_key = 'req-sub-' || :'r1'), 'approval reminder cleared');
select tests.check((select count(*) from public.notifications where user_id = :'p15' and dedupe_key = 'req-ok-' || :'r1') = 1, 'procurement told to order');
select tests.check((select count(*) from public.notifications where user_id = :'s15' and dedupe_key = 'req-dec-' || :'r1') = 1, 'the requester is told');
select tests.login('s15@o.test'); set role authenticated;
select tests.blocked(format('select public.requisition_to_po(%L, %L)', :'r1', :'sup'), 'sales cannot order');
reset role;
select tests.login('p15@o.test'); set role authenticated;
select public.requisition_to_po(:'r1', :'sup') as po1 \gset
select tests.check((select status = 'ordered' and po_id = :'po1' from public.requisitions where id = :'r1'), 'request ordered');
select tests.check((select count(*) from public.po_lines where po_id = :'po1') = 2
                   and (select status = 'draft' and supplier_id = :'sup' and expected_date = current_date + 7 from public.purchase_orders where id = :'po1'),
                   'a draft purchase order with the items and the needed-by date');
select tests.blocked(format('select public.requisition_to_po(%L, %L)', :'r1', :'sup'), 'cannot order twice');
select tests.blocked(format('select public.cancel_requisition(%L)', :'r1'), 'an ordered request cannot be cancelled');
reset role;
-- Rejected, and the requester's own cancel.
select tests.login('s15@o.test'); set role authenticated;
insert into public.requisitions (company_id, reason) values (:'cid', 'Second') returning id as r2 \gset
insert into public.requisition_lines (company_id, requisition_id, description, quantity) values (:'cid', :'r2', 'Marker pens', 10);
select public.submit_requisition(:'r2');
reset role;
select tests.login('m15@o.test'); set role authenticated;
select public.decide_requisition(:'r2', false, 'Use the stock in Mwanza');
select tests.check((select status = 'rejected' and decision_note = 'Use the stock in Mwanza' from public.requisitions where id = :'r2'), 'request rejected with a note');
-- Management's own requests are approved at once.
insert into public.requisitions (company_id, reason) values (:'cid', 'Boss') returning id as r3 \gset
insert into public.requisition_lines (company_id, requisition_id, description, quantity) values (:'cid', :'r3', 'Toner', 2);
select tests.check(public.submit_requisition(:'r3') = 'approved', 'management''s own request is approved at once');
reset role;
select tests.login('s15@o.test'); set role authenticated;
insert into public.requisitions (company_id, reason) values (:'cid', 'Third') returning id as r4 \gset
select public.cancel_requisition(:'r4');
select tests.check((select status from public.requisitions where id = :'r4') = 'cancelled', 'the requester cancels their own request');
reset role;
select tests.login('x15@x.test'); set role authenticated;
select tests.check((select count(*) from public.requisitions where company_id = :'cid') = 0
                   and (select count(*) from public.requisition_lines where company_id = :'cid') = 0, 'another company sees no requests');
reset role;

-- ---- Feature catalogue -------------------------------------------------------------------------
select tests.login('m15@o.test'); set role authenticated;
select tests.check((select bool_and(enabled) from public.company_feature_map(:'cid')
                     where key in ('stock_transfers', 'requisitions', 'bi_insights')) = true, 'part 2 features are live and on at medium');
reset role;

-- ---- Reset before go-live ----------------------------------------------------------------------
select public.reset_company_transactions(:'cid', 'Ops Co');
select tests.check(not exists (select 1 from public.stock_transfers where company_id = :'cid')
                   and not exists (select 1 from public.requisitions where company_id = :'cid')
                   and not exists (select 1 from public.stock_movements where company_id = :'cid'), 'reset clears transfers and requests');
select tests.check((select max_level from public.products where id = :'oil') = 40, 'reset keeps the maximum levels');

-- ---- Demo --------------------------------------------------------------------------------------
select tests.login_guest(:'g15'); set role authenticated;
select public.create_demo_company('medium') as demo \gset
select tests.check((select count(*) from public.stock_transfers where company_id = :'demo' and status = 'in_transit') = 1, 'medium demo has stock on the way');
select tests.check((select count(*) from public.requisitions where company_id = :'demo' and status = 'submitted') = 1, 'demo has a request to approve');
select tests.check((select count(*) from public.products where company_id = :'demo' and max_level is not null) > 0, 'demo has maximum levels');
select tests.check(auth.uid() = :'g15', 'the visitor is still the one signed in');
select public.create_demo_company('small') as demo_s \gset
select tests.check((select count(*) from public.requisitions where company_id = :'demo_s') = 1, 'small demo works too');
reset role;

\echo ALL STAGE 14 OPERATIONS TESTS PASSED
