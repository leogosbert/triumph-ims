-- Tests for Stage 7: notifications, alerts and the server outbox.
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

insert into auth.users (email) values ('m7@n.test'), ('s7@n.test'), ('p7@n.test'), ('w7@n.test'), ('d7@n.test'), ('f7@n.test'), ('x7@o.test');

select tests.login('m7@n.test'); set role authenticated;
select public.create_company('Alert Co') as cid \gset
select public.invite_member(:'cid', 's7@n.test', 'sales');
select public.invite_member(:'cid', 'p7@n.test', 'procurement');
select public.invite_member(:'cid', 'w7@n.test', 'warehouse');
select public.invite_member(:'cid', 'd7@n.test', 'driver');
select public.invite_member(:'cid', 'f7@n.test', 'finance');
insert into public.clients (company_id, name) values (:'cid', 'Cement Ltd') returning id as client \gset
insert into public.suppliers (company_id, name) values (:'cid', 'Parts Ltd') returning id as sup \gset
insert into public.products (company_id, sku, name, unit, selling_price, reorder_level) values (:'cid', 'GRS', 'Grease', 'pail', 200000, 10) returning id as grease \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'CHM', 'Flocculant', 'bag', 90000) returning id as chem \gset
reset role;
select tests.login('s7@n.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('p7@n.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('w7@n.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('d7@n.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('f7@n.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('x7@o.test'); set role authenticated; select public.create_company('Other Co'); reset role;
select id as sales_id from auth.users where email = 's7@n.test' \gset
select id as driver_id from auth.users where email = 'd7@n.test' \gset
select id as mgr_id from auth.users where email = 'm7@n.test' \gset
select id as proc_id from auth.users where email = 'p7@n.test' \gset

-- ---- Event notifications -------------------------------------------------
select tests.login('m7@n.test'); set role authenticated;
insert into public.rfqs (company_id, client_id, title, assigned_to, due_on) values (:'cid', :'client', '50 pails grease', :'sales_id', current_date + 3) returning id as rfq \gset
insert into public.rfqs (company_id, client_id, title, assigned_to) values (:'cid', :'client', 'Self', :'mgr_id');
reset role;

select tests.login('s7@n.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where kind = 'rfq_assigned') = 1, 'assignee is told about a new RFQ');
select tests.check((select severity from public.notifications where kind = 'rfq_assigned') = 'attention', 'RFQ alert is sent to the phone (attention)');
select public.create_quotation(:'cid', :'client', null) as q \gset
insert into public.quotation_lines (company_id, quotation_id, product_id, description, quantity, unit, unit_price)
values (:'cid', :'q', :'grease', 'Grease', 150, 'pail', 200000);
select public.submit_quotation(:'q');
reset role;

select tests.login('m7@n.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where kind = 'quote_approval') = 1, 'manager is asked to approve a big quotation');
select tests.check((select count(*) from public.notifications where kind = 'rfq_assigned') = 0, 'nobody is told about their own assignment');
select public.review_quotation(:'q', false, 'Price too high, use 190,000');
reset role;

select tests.login('s7@n.test'); set role authenticated;
select tests.check((select body from public.notifications where kind = 'quote_returned') = 'Price too high, use 190,000', 'salesperson sees why it came back');
select tests.check((select count(*) from public.notifications) = 2, 'salesperson only sees their own notifications');
select tests.blocked(format('insert into public.notifications (company_id, user_id, kind, title) values (%L, %L, %L, %L)', :'cid', :'sales_id', 'x', 'fake'), 'notifications cannot be typed in');
update public.notifications set read_at = now() where kind = 'quote_returned';
select tests.check((select count(*) from public.notifications where read_at is null) = 1, 'mark as read');
select tests.blocked(format('update public.notifications set title = %L', 'changed'), 'only the read flag can be changed');
update public.quotation_lines set unit_price = 190000 where quotation_id = :'q';
select public.submit_quotation(:'q');
reset role;

select tests.login('m7@n.test'); set role authenticated;
select public.review_quotation(:'q', true, null);
select public.record_quotation_outcome(:'q', true, 'PO 77');
reset role;

select tests.login('p7@n.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where kind = 'order_won') = 1, 'procurement is told an order was won');
select tests.check((select count(*) from public.notifications where user_id <> :'proc_id') = 0, 'procurement sees only its own');
select public.create_purchase_order(:'cid', :'sup', :'q') as po \gset
update public.po_lines set unit_price = 100000 where po_id = :'po';
select public.submit_purchase_order(:'po');
reset role;

select tests.login('m7@n.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where kind = 'po_approval') = 1, 'manager is asked to approve the PO');
select public.review_purchase_order(:'po', true, null);
select public.mark_po_sent(:'po');
select public.confirm_purchase_order(:'po', 'SO-9', current_date - 5);
reset role;

select tests.login('w7@n.test'); set role authenticated;
select public.receive_goods(:'po', (select id from public.warehouses where company_id = :'cid' and code = 'MAIN'), null, null, null,
  (select jsonb_agg(jsonb_build_object('po_line_id', id, 'quantity', 150, 'batch_no', 'G1', 'expiry_date', (current_date + 5)::text)) from public.po_lines where po_id = :'po'));
reset role;

select tests.login('s7@n.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where kind = 'goods_received' and title like 'Goods arrived%') = 1, 'salesperson is told the goods arrived');
reset role;

select tests.login('m7@n.test'); set role authenticated;
select public.create_delivery(:'cid', null, :'q', null) as dn \gset
update public.deliveries set driver_id = :'driver_id', vehicle = 'T 777 AAA' where id = :'dn';
select public.dispatch_delivery(:'dn');
reset role;

select tests.login('d7@n.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where kind = 'delivery_assigned') = 1, 'driver is told about the delivery');
select tests.check((select link from public.notifications where kind = 'delivery_assigned') = '/driver', 'driver alert opens the driver screen');
select public.confirm_delivery(:'dn', 'Gate', :'cid' || '/' || :'dn' || '/s.png', null, null, null, null, null);
reset role;

select tests.login('f7@n.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where kind = 'ready_to_invoice') = 1, 'finance is told it is ready to invoice');
select public.create_invoice(:'cid', null, null, :'dn') as inv \gset
update public.invoices set issue_date = current_date - 40, due_date = current_date - 10 where id = :'inv';
select public.issue_invoice(:'inv');
select public.record_payment(:'inv', null, 1000000, 'cash', null, null, null);
reset role;

select tests.login('s7@n.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where kind = 'payment_received') = 1, 'salesperson is told the client paid');
reset role;

-- ---- Time-based alerts ---------------------------------------------------
select tests.login('w7@n.test'); set role authenticated;
select tests.blocked(format('select public.run_company_alerts(%L)', :'cid'), 'the full alert check is not open to users');
select public.adjust_stock(:'cid', :'chem', (select id from public.warehouses where company_id = :'cid' and code = 'MAIN'), 5, 'C7', current_date + 20, 'Opening');
select public.adjust_stock(:'cid', :'grease', (select id from public.warehouses where company_id = :'cid' and code = 'MAIN'), 200, 'G1', current_date + 5, 'Found in count');
select public.refresh_alerts(:'cid') as n1 \gset
select tests.check(:n1 > 0, 'alert check creates alerts');
select tests.check((select severity from public.notifications where kind = 'batch_expiry' and body like 'G1%') = 'critical', 'batch expiring within 7 days is critical');
select tests.check((select severity from public.notifications where kind = 'batch_expiry' and body like 'C7%') = 'attention', 'batch expiring within 30 days needs attention');
select tests.check((select count(*) from public.notifications where kind = 'low_stock') = 0, 'stock above the reorder level: no alert');
select tests.check(public.refresh_alerts(:'cid') = 0, 'check runs at most every 30 minutes');
reset role;

select tests.login('f7@n.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where kind = 'invoice_overdue') = 1, 'finance is told the invoice is overdue');
reset role;
select tests.login('p7@n.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where kind = 'po_late') = 0, 'received POs are not late');
reset role;

-- Run again later: nothing new is duplicated; new problems are picked up.
update public.companies set alerts_checked_at = now() - interval '1 hour' where id = :'cid';
select tests.login('m7@n.test'); set role authenticated;
select public.adjust_stock(:'cid', :'grease', (select id from public.warehouses where company_id = :'cid' and code = 'MAIN'), -195, 'G1', null, 'Sold off');
select public.refresh_alerts(:'cid') as n2 \gset
reset role;
select tests.login('w7@n.test'); set role authenticated;
select tests.check((select count(*) from public.notifications where kind = 'low_stock') = 1, 'low stock alert');
select tests.check((select count(*) from public.notifications where kind = 'batch_expiry') = 2, 'no duplicate expiry alerts');
reset role;

-- ---- Outbox --------------------------------------------------------------
select public.set_outbox_secret('correct horse battery staple 42');
select tests.blocked('select public.set_outbox_secret(''short'')', 'secret must be long');
set role anon;
select tests.blocked('select * from public.claim_outbox(''wrong secret wrong secret!!'', 10)', 'wrong secret is refused');
select tests.blocked('select public.set_outbox_secret(''anon tries to set the secret 123'')', 'app users cannot set the secret');
select tests.blocked('select * from public.app_secrets', 'secrets are not readable');
reset role;

select tests.login('d7@n.test'); set role authenticated;
insert into public.push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/abc', 'key', 'auth');
reset role;
select tests.login('s7@n.test'); set role authenticated;
select tests.check((select count(*) from public.push_subscriptions) = 0, 'push addresses are private');
insert into public.notification_settings (email_alerts) values (false);
select public.send_test_notification(:'cid');
select public.send_test_notification(:'cid');
select tests.check((select count(*) from public.notifications where kind = 'test') = 1, 'test notification (once a minute)');
select tests.blocked(format('select public.send_test_notification(%L)', (select id from public.companies where name = 'Other Co')), 'no test notifications into other companies');
reset role;

set role anon;
create temp table claimed as select * from public.claim_outbox('correct horse battery staple 42', 1000);
reset role;
select tests.check((select count(*) from claimed) > 0, 'server collects pending alerts');
select tests.check((select bool_and(severity <> 'info') from claimed), 'info notifications stay in the app');
select tests.check((select jsonb_array_length(subscriptions) from claimed where user_id = :'driver_id' and title like 'Delivery for you%') = 1, 'push address included for the driver');
select tests.check((select bool_and(not want_email) from claimed where user_id = :'sales_id'), 'email preference respected');
set role anon;
select tests.check((select count(*) from public.claim_outbox('correct horse battery staple 42', 1000)) = 0, 'each alert is sent only once');
select tests.check(public.drop_push_endpoints('correct horse battery staple 42', array['https://push.example/abc']) = 1, 'dead push addresses are removed');
select tests.check(public.run_all_alerts('correct horse battery staple 42') >= 0, 'scheduled job runs all companies');
reset role;

select tests.login('x7@o.test'); set role authenticated;
select tests.check((select count(*) from public.notifications) = 0, 'other companies see nothing');
select tests.blocked(format('select public.refresh_alerts(%L)', :'cid'), 'cannot run alerts for another company');
reset role;

\echo 'ALL STAGE 7 TESTS PASSED'
