-- Tests for the supplier portal: answering supplier RFQs online, confirming purchase orders,
-- delivery notes and invoices (checked by finance, invoices become supplier bills), company
-- details, and bank details that only management can approve.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon, service_role;
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
grant execute on all functions in schema tests to authenticated, anon, service_role;

insert into auth.users (email) values ('boss.ps@p.test'), ('proc.ps@p.test'), ('fin.ps@p.test'), ('store.ps@p.test'), ('sales.ps@p.test'), ('other.ps@p.test');
select id as boss from auth.users where email = 'boss.ps@p.test' \gset
select id as proc from auth.users where email = 'proc.ps@p.test' \gset
select id as fin from auth.users where email = 'fin.ps@p.test' \gset
select id as store from auth.users where email = 'store.ps@p.test' \gset
select id as sales from auth.users where email = 'sales.ps@p.test' \gset

select tests.login('boss.ps@p.test'); set role authenticated;
select public.create_company('Portal Buyer Co') as co \gset
reset role;
select tests.login('other.ps@p.test'); set role authenticated;
select public.create_company('Other Buyer Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
values (:'co', :'proc', 'procurement'), (:'co', :'fin', 'finance'), (:'co', :'store', 'warehouse'), (:'co', :'sales', 'sales');
insert into public.suppliers (company_id, name, tax_no) values (:'co', 'Valves Ltd', '100-200-300') returning id as valves \gset
insert into public.suppliers (company_id, name) values (:'co', 'Pumps Ltd') returning id as pumps \gset
insert into public.suppliers (company_id, name) values (:'other', 'Foreign Ltd') returning id as foreign_sup \gset
insert into public.products (company_id, sku, name, unit) values (:'co', 'VLV', 'Gate valve', 'pcs') returning id as vlv \gset

select tests.login('boss.ps@p.test'); set role authenticated;
select public.portal_invite(:'co', 'supplier', :'valves', 'vera@valves.test', 'Vera Valves', 'Sales manager', null, null) as vera \gset
select public.portal_invite(:'co', 'supplier', :'pumps', 'paul@pumps.test', 'Paul Pumps', 'Sales', null, null) as paul \gset
select tests.blocked(format('select public.portal_invite(%L, %L, %L, %L, %L, null, null, null)', :'co', 'supplier', :'foreign_sup', 'f@f.test', 'F'),
  'a supplier of another company cannot be invited');
reset role;

set role service_role;
select public.portal_request_login('vera@valves.test', '10.1.0.1') as r \gset
select public.portal_verify_login('vera@valves.test', :'r'::jsonb ->> 'code', null, '10.1.0.1', 'x') ->> 'session' as s_vera \gset
select public.portal_request_login('paul@pumps.test', '10.1.0.2') as r \gset
select public.portal_verify_login(null, null, :'r'::jsonb ->> 'token', '10.1.0.2', 'x') ->> 'session' as s_paul \gset
select tests.check(:'s_vera' ~ '^[0-9a-f]{64}$' and :'s_paul' ~ '^[0-9a-f]{64}$', 'both supplier contacts signed in');
select tests.blocked(format('select public.portal_quotations(%L, %L)', :'s_vera', :'vera'), 'suppliers cannot use the client portal');
reset role;

-- ---- 1. Supplier RFQs ----------------------------------------------------------------------------
insert into public.supplier_rfqs (company_id, title, due_on, notes) values (:'co', 'Valves for Geita', current_date + 7, 'Deliver to Geita') returning id as rfq \gset
insert into public.supplier_rfq_lines (company_id, srfq_id, product_id, description, quantity, unit) values (:'co', :'rfq', :'vlv', 'Gate valve 4"', 10, 'pcs') returning id as line1 \gset
insert into public.supplier_rfq_lines (company_id, srfq_id, description, quantity, unit) values (:'co', :'rfq', 'Flange gasket', 20, 'pcs') returning id as line2 \gset
insert into public.supplier_rfq_suppliers (company_id, srfq_id, supplier_id) values (:'co', :'rfq', :'valves') returning id as rs_vera \gset
insert into public.supplier_rfq_suppliers (company_id, srfq_id, supplier_id) values (:'co', :'rfq', :'pumps') returning id as rs_paul \gset
insert into public.supplier_rfqs (company_id, title) values (:'co', 'Other request') returning id as rfq2 \gset
insert into public.supplier_rfq_lines (company_id, srfq_id, description, quantity) values (:'co', :'rfq2', 'Not yours', 1) returning id as line_other \gset

select tests.login('sales.ps@p.test'); set role authenticated;
select tests.blocked(format('select public.portal_rfq_send_list(%L)', :'rfq'), 'sales cannot send RFQs through the portal');
reset role;
select tests.login('proc.ps@p.test'); set role authenticated;
select public.portal_rfq_send_list(:'rfq') as sl \gset
reset role;
select tests.check(jsonb_array_length(:'sl'::jsonb) = 2
                   and (select (e #>> '{recipients,0,email}') = 'vera@valves.test' from jsonb_array_elements(:'sl'::jsonb) e where e ->> 'supplier' = 'Valves Ltd'),
  'send via portal: each invited supplier with its portal contacts');
select tests.check(exists (select 1 from public.audit_log where company_id = :'co' and action = 'portal_rfq_sent' and actor_id = :'proc'),
  'sending through the portal is in the Activity log');

set role service_role;
select public.portal_rfqs(:'s_vera', :'vera') as rl \gset
select tests.check(jsonb_array_length(:'rl'::jsonb) = 1 and (:'rl'::jsonb #>> '{0,id}') = :'rs_vera' and (:'rl'::jsonb #>> '{0,status}') = 'invited',
  'Vera sees the one request she was asked for');
select tests.check(jsonb_array_length(public.portal_rfq(:'s_vera', :'vera', :'rs_vera') -> 'lines') = 2, 'with its two lines');
select tests.blocked(format('select public.portal_rfq(%L, %L, %L)', :'s_vera', :'vera', :'rs_paul'), 'Vera cannot open Pumps'' answer');
select tests.blocked(format('select public.portal_answer_rfq(%L, %L, %L, %L)', :'s_vera', :'vera', :'rs_paul',
                            '{"lines":[{"line_id":"' || :'line1' || '","unit_price":"1"}]}'),
  'Vera cannot answer for Pumps');
select tests.blocked(format('select public.portal_answer_rfq(%L, %L, %L, %L)', :'s_vera', :'vera', :'rs_vera',
                            '{"lines":[{"line_id":"' || :'line_other' || '","unit_price":"1"}]}'),
  'a line of another request is refused');
select tests.blocked(format('select public.portal_answer_rfq(%L, %L, %L, %L)', :'s_vera', :'vera', :'rs_vera', '{"lines":[]}'),
  'at least one price is needed');
select tests.blocked(format('select public.portal_answer_rfq(%L, %L, %L, %L)', :'s_vera', :'vera', :'rs_vera',
                            '{"valid_until":"2001-01-01","lines":[{"line_id":"' || :'line1' || '","unit_price":"5"}]}'),
  'prices valid until a past date are refused');
select tests.blocked(format('select public.portal_answer_rfq(%L, %L, %L, %L)', :'s_vera', :'vera', :'rs_vera',
                            '{"lines":[{"line_id":"' || :'line1' || '","unit_price":"-5"}]}'),
  'a negative price is refused');
select public.portal_answer_rfq(:'s_vera', :'vera', :'rs_vera', jsonb_build_object(
  'currency', 'TZS', 'lead_time_days', '14', 'valid_until', (current_date + 30)::text, 'payment_terms', '30 days', 'freight', '50000',
  'supplier_ref', 'VQ-881', 'notes', 'Ex stock Dar',
  'lines', jsonb_build_array(jsonb_build_object('line_id', :'line1', 'unit_price', '125000', 'notes', 'Brand X'),
                             jsonb_build_object('line_id', :'line2', 'unit_price', ''))));
select public.portal_answer_rfq(:'s_paul', :'paul', :'rs_paul', '{"decline":true,"notes":"Out of stock"}');
reset role;
select tests.check((select status = 'quoted' and lead_time_days = 14 and freight = 50000 and supplier_ref = 'VQ-881' and received_on is not null
                      from public.supplier_rfq_suppliers where id = :'rs_vera'),
  'Vera''s answer is in the supplier quote, where the comparison reads it');
select tests.check((select unit_price from public.supplier_quote_lines where srfq_supplier_id = :'rs_vera' and srfq_line_id = :'line1') = 125000
                   and (select unit_price from public.supplier_quote_lines where srfq_supplier_id = :'rs_vera' and srfq_line_id = :'line2') is null,
  'prices per line (a line left empty stays unpriced)');
select tests.check((select status from public.supplier_rfq_suppliers where id = :'rs_paul') = 'declined', 'Pumps declined online');
select tests.check(exists (select 1 from public.notifications where user_id = :'proc' and title like 'Valves Ltd quoted%'), 'procurement is told');
select tests.check(exists (select 1 from public.audit_log where company_id = :'co' and action = 'portal_rfq_quoted'), 'the answer is in the Activity log');
set role service_role;
-- A second answer replaces the first while the request is open.
select public.portal_answer_rfq(:'s_vera', :'vera', :'rs_vera', jsonb_build_object('currency', 'TZS',
  'lines', jsonb_build_array(jsonb_build_object('line_id', :'line1', 'unit_price', '120000'))));
reset role;
select tests.check((select unit_price from public.supplier_quote_lines where srfq_supplier_id = :'rs_vera' and srfq_line_id = :'line1') = 120000,
  'an updated answer replaces the price');
update public.supplier_rfqs set status = 'awarded', awarded_supplier_id = :'valves' where id = :'rfq';
set role service_role;
select tests.blocked(format('select public.portal_answer_rfq(%L, %L, %L, %L)', :'s_vera', :'vera', :'rs_vera',
                            '{"lines":[{"line_id":"' || :'line1' || '","unit_price":"1"}]}'),
  'a closed request cannot be answered');
select tests.check((public.portal_rfqs(:'s_vera', :'vera') #>> '{0,awarded_to_you}')::boolean, 'Vera sees that she won');
select tests.check(not (public.portal_rfqs(:'s_paul', :'paul') #>> '{0,awarded_to_you}')::boolean, 'Paul sees only that he did not (not who won)');
reset role;

-- ---- 2. Purchase orders ---------------------------------------------------------------------
insert into public.purchase_orders (company_id, supplier_id, created_by) values (:'co', :'valves', :'proc') returning id as po1 \gset
insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values (:'co', :'po1', :'vlv', 'Gate valve 4"', 10, 'pcs', 120000);
insert into public.purchase_orders (company_id, supplier_id, created_by) values (:'co', :'valves', :'proc') returning id as po_draft \gset
insert into public.purchase_orders (company_id, supplier_id, created_by) values (:'co', :'pumps', :'proc') returning id as po_paul \gset
select set_config('ims.status_change', 'on', false) as x \gset
update public.purchase_orders set status = 'sent', sent_at = now() where id in (:'po1', :'po_paul');
select set_config('ims.status_change', '', false) as x \gset
set role service_role;
select tests.check(jsonb_array_length(public.portal_purchase_orders(:'s_vera', :'vera')) = 1
                   and (public.portal_purchase_orders(:'s_vera', :'vera') #>> '{0,id}') = :'po1',
  'Vera sees the purchase order sent to her (not drafts, not Pumps'')');
select tests.blocked(format('select public.portal_purchase_order(%L, %L, %L)', :'s_vera', :'vera', :'po_draft'), 'a draft order cannot be opened');
select tests.blocked(format('select public.portal_purchase_order(%L, %L, %L)', :'s_vera', :'vera', :'po_paul'), 'Pumps'' order cannot be opened');
select tests.blocked(format('select public.portal_confirm_po(%L, %L, %L, null, null)', :'s_vera', :'vera', :'po_paul'), 'Vera cannot confirm Pumps'' order');
select tests.blocked(format('select public.portal_confirm_po(%L, %L, %L, null, %L)', :'s_vera', :'vera', :'po1', '2001-01-01'), 'a delivery date before the order is refused');
select public.portal_confirm_po(:'s_vera', :'vera', :'po1', 'SO-5521', current_date + 14);
reset role;
select tests.check((select status = 'confirmed' and supplier_ref = 'SO-5521' and expected_date = current_date + 14 and confirmed_at is not null
                      from public.purchase_orders where id = :'po1'),
  'confirming online moves the order to confirmed with their reference and date');
select tests.check((select last_cost from public.product_costs where product_id = :'vlv') = 120000, 'the confirmed price becomes the product''s last cost (same code as the app)');
select tests.check(exists (select 1 from public.notifications where user_id = :'proc' and title like '%confirmed by Valves Ltd'), 'procurement is told');
set role service_role;
select tests.blocked(format('select public.portal_confirm_po(%L, %L, %L, null, null)', :'s_vera', :'vera', :'po1'), 'an order is confirmed once');
select tests.check((public.portal_open(:'s_vera', :'vera', 'po', :'po1', null) ->> 'id') = :'po1', 'the order PDF can be opened');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_vera', :'vera', 'po', :'po_paul'), 'not Pumps'' order PDF');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_vera', :'vera', 'invoice', gen_random_uuid()), 'suppliers cannot open client invoices');
reset role;
-- The app's own Confirm button still works for procurement only.
select tests.login('sales.ps@p.test'); set role authenticated;
select tests.blocked(format('select public.confirm_purchase_order(%L, null, null)', :'po_paul'), 'sales still cannot confirm orders in the app');
select tests.blocked(format('select public.apply_po_confirmation(%L, null, null)', :'po_paul'), 'nobody calls the internal confirmation directly');
reset role;
select tests.login('proc.ps@p.test'); set role authenticated;
select public.confirm_purchase_order(:'po_paul', 'by phone', null);
reset role;
select tests.check((select status from public.purchase_orders where id = :'po_paul') = 'confirmed', 'procurement still confirms in the app');

-- ---- 3. Delivery notes and invoices -----------------------------------------------------------
set role service_role;
select tests.blocked(format('select public.portal_submit_document(%L, %L, %L)', :'s_vera', :'vera',
                            '{"kind":"invoice","po_id":"' || :'po_paul' || '","supplier_invoice_no":"X1","subtotal":"100"}'),
  'Vera cannot send an invoice against Pumps'' order');
select tests.blocked(format('select public.portal_submit_document(%L, %L, %L)', :'s_vera', :'vera', '{"kind":"invoice","subtotal":"100"}'),
  'an invoice needs its number');
select tests.blocked(format('select public.portal_submit_document(%L, %L, %L)', :'s_vera', :'vera', '{"kind":"invoice","supplier_invoice_no":"X1","subtotal":"abc"}'),
  'amounts must be numbers');
select public.portal_submit_document(:'s_vera', :'vera', jsonb_build_object('kind', 'invoice', 'po_id', :'po1', 'supplier_invoice_no', 'VI-1001',
  'doc_date', current_date::text, 'due_date', (current_date + 30)::text, 'subtotal', '1200000', 'vat_amount', '216000', 'notes', 'Thank you')) as sub1 \gset
select tests.blocked(format('select public.portal_submit_document(%L, %L, %L)', :'s_vera', :'vera',
                            '{"kind":"invoice","supplier_invoice_no":"vi-1001","subtotal":"5"}'),
  'the same invoice number cannot be sent twice');
select public.portal_submit_document(:'s_vera', :'vera', jsonb_build_object('kind', 'delivery_note', 'po_id', :'po1', 'reference', 'DN-778')) as sub2 \gset
-- Files: the server asks for a place, uploads, then confirms.
select tests.blocked(format('select public.portal_file_begin(%L, %L, %L)', :'s_vera', :'vera',
                            '{"purpose":"invoice","submission_id":"' || :'sub1' || '","file_name":"inv.exe","content_type":"application/x-msdownload","size":"100"}'),
  'only documents and photos can be sent');
select tests.blocked(format('select public.portal_file_begin(%L, %L, %L)', :'s_vera', :'vera',
                            '{"purpose":"invoice","submission_id":"' || :'sub1' || '","file_name":"big.pdf","content_type":"application/pdf","size":"99999999"}'),
  'files over 15 MB are refused');
select tests.blocked(format('select public.portal_file_begin(%L, %L, %L)', :'s_paul', :'paul',
                            '{"purpose":"invoice","submission_id":"' || :'sub1' || '","file_name":"x.pdf","content_type":"application/pdf","size":"100"}'),
  'Paul cannot attach a file to Vera''s invoice');
select public.portal_file_begin(:'s_vera', :'vera', jsonb_build_object('purpose', 'invoice', 'submission_id', :'sub1',
  'file_name', '../../VI 1001.pdf', 'content_type', 'application/pdf', 'size', '2048')) as fb \gset
select tests.check((:'fb'::jsonb ->> 'path') like :'co' || '/' || :'valves' || '/%' and (:'fb'::jsonb ->> 'path') not like '%..%',
  'the file goes into this company''s and supplier''s folder (no tricks with the name)');
select tests.blocked(format('select public.portal_file_done(%L, %L, %L)', :'s_vera', :'vera', :'fb'::jsonb ->> 'id'), 'a file that never arrived is not shown');
reset role;
insert into storage.objects (bucket_id, name) values ('portal', :'fb'::jsonb ->> 'path');
set role service_role;
select public.portal_file_done(:'s_vera', :'vera', (:'fb'::jsonb ->> 'id')::uuid);
select tests.check(jsonb_array_length(public.portal_submissions_list(:'s_vera', :'vera')) = 2
                   and jsonb_array_length(public.portal_submissions_list(:'s_paul', :'paul')) = 0,
  'Vera sees her two documents; Paul sees none');
select tests.check((public.portal_open(:'s_vera', :'vera', 'file', (:'fb'::jsonb ->> 'id')::uuid, null) ->> 'bucket') = 'portal', 'Vera can open her own file');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_paul', :'paul', 'file', :'fb'::jsonb ->> 'id'), 'Paul cannot open Vera''s file');
reset role;
select tests.check(exists (select 1 from public.notifications where user_id = :'fin' and link = '/portal-admin/submissions/' || :'sub1'), 'finance is told about the invoice');
select tests.check(exists (select 1 from public.notifications where user_id = :'store' and link = '/portal-admin/submissions/' || :'sub2'), 'the store is told about the delivery note');
select tests.check(not exists (select 1 from public.supplier_bills where supplier_id = :'valves'), 'nothing reaches the payables before finance checks it');

select tests.login('proc.ps@p.test'); set role authenticated;
select tests.check((select count(*) from storage.objects where bucket_id = 'portal') = 1, 'procurement can open the supplier''s file');
select tests.blocked(format('select public.portal_review_submission(%L, %L, null, null)', :'sub1', 'bill'), 'procurement cannot turn an invoice into a bill');
select public.portal_review_submission(:'sub2', 'accept', 'Goods counted', null);
reset role;
select tests.login('store.ps@p.test'); set role authenticated;
select tests.check((select count(*) from public.portal_submissions where company_id = :'co') = 2, 'the store sees the delivery notes and invoices');
select tests.blocked(format('select public.portal_review_submission(%L, %L, null, null)', :'sub1', 'accept'), 'the store cannot check invoices');
reset role;
select tests.login('fin.ps@p.test'); set role authenticated;
select tests.blocked(format('select public.portal_review_submission(%L, %L, null, null)', :'sub2', 'bill'), 'a checked delivery note cannot become a bill');
select public.portal_review_submission(:'sub1', 'bill', 'Matches the order', null) as bill \gset
select tests.blocked(format('select public.portal_review_submission(%L, %L, null, null)', :'sub1', 'bill'), 'an invoice becomes a bill once');
reset role;
select tests.check((select status = 'open' and supplier_invoice_no = 'VI-1001' and total = 1416000 and po_id = :'po1' and created_by = :'fin'
                      from public.supplier_bills where id = :'bill'),
  'the checked invoice is now a supplier bill for the order, made by finance');
select tests.check((select status = 'billed' and bill_id = :'bill' from public.portal_submissions where id = :'sub1'), 'and the supplier sees it was accepted');
select tests.check(exists (select 1 from public.audit_log where company_id = :'co' and entity = 'portal_submissions' and action = 'update' and actor_id = :'fin'),
  'who checked it is in the Activity log');
set role service_role;
select public.portal_submit_document(:'s_vera', :'vera', jsonb_build_object('kind', 'invoice', 'supplier_invoice_no', 'VI-1002', 'subtotal', '10')) as sub3 \gset
reset role;
select tests.login('fin.ps@p.test'); set role authenticated;
select tests.blocked(format('select public.portal_review_submission(%L, %L, null, null)', :'sub3', 'reject'), 'sending back needs a reason');
select public.portal_review_submission(:'sub3', 'reject', 'No purchase order for this', null);
reset role;
set role service_role;
select tests.check((select e ->> 'review_note' from jsonb_array_elements(public.portal_submissions_list(:'s_vera', :'vera')) e where e ->> 'id' = :'sub3')
                   = 'No purchase order for this', 'the supplier sees why it was sent back');
reset role;

-- ---- 4. Company details and bank details ----------------------------------------------------------
set role service_role;
select public.portal_update_supplier(:'s_vera', :'vera', '{"tax_no":"100-200-999","phone":"+255 700 111 222"}');
reset role;
select tests.check((select tax_no = '100-200-999' and phone = '+255 700 111 222' from public.suppliers where id = :'valves'), 'TIN and phone updated');
select tests.check(exists (select 1 from public.audit_log where company_id = :'co' and action = 'portal_supplier_details'
                             and details #>> '{tax_no,from}' = '100-200-300'),
  'the old and new TIN are in the Activity log');
set role service_role;
select tests.blocked(format('select public.portal_request_bank_change(%L, %L, %L)', :'s_vera', :'vera', '{"bank_name":"CRDB","account_name":"Valves Ltd","account_number":"x"}'),
  'a wrong account number is refused');
select tests.blocked(format('select public.portal_request_bank_change(%L, %L, %L)', :'s_vera', :'vera', '{"bank_name":"CRDB","account_name":"Valves Ltd","account_number":"0150123456700","swift_code":"BAD"}'),
  'a wrong SWIFT code is refused');
select public.portal_request_bank_change(:'s_vera', :'vera', '{"bank_name":"CRDB Bank","account_name":"Valves Ltd","account_number":"0150123456700","branch":"Azikiwe","swift_code":"corutztz","currency":"TZS"}') as bank1 \gset
reset role;
select tests.check((select status = 'pending' and swift_code = 'CORUTZTZ' from public.supplier_bank_details where id = :'bank1')
                   and not (select bank_details_received from public.suppliers where id = :'valves'),
  'new bank details wait for approval and are not applied');
select tests.check(exists (select 1 from public.notifications where user_id = :'boss' and severity = 'critical' and title like 'New bank details%'),
  'management is told at once');
set role service_role;
select tests.check((public.portal_supplier_profile(:'s_vera', :'vera') #>> '{pending,account_number}') = '••••6700'
                   and (public.portal_supplier_profile(:'s_vera', :'vera') -> 'bank') = 'null'::jsonb,
  'the portal shows the request (number masked) and no approved account yet');
reset role;
select tests.login('proc.ps@p.test'); set role authenticated;
select tests.check((select count(*) from public.supplier_bank_details) = 0, 'procurement cannot read bank details');
reset role;
select tests.login('fin.ps@p.test'); set role authenticated;
select tests.check((select count(*) from public.supplier_bank_details where supplier_id = :'valves') = 1, 'finance can read them');
select tests.blocked(format('select public.portal_decide_bank_change(%L, true, null)', :'bank1'), 'finance cannot approve bank details');
reset role;
select tests.login('boss.ps@p.test'); set role authenticated;
select tests.blocked(format('update public.supplier_bank_details set status = %L where id = %L', 'approved', :'bank1'), 'bank details cannot be approved by editing the table');
select public.portal_decide_bank_change(:'bank1', true, 'Confirmed by phone with Vera') as dec \gset
reset role;
select tests.check((:'dec'::jsonb ->> 'status') = 'approved' and (:'dec'::jsonb -> 'emails') = '["vera@valves.test"]'::jsonb,
  'approved; the server is given the supplier''s portal emails to tell them');
select tests.check((select bank_details_received from public.suppliers where id = :'valves'), 'the supplier now has bank details on file');
select tests.check(exists (select 1 from public.notifications where user_id = :'fin' and title like 'New bank details approved%'), 'finance is told to use the new account');
set role service_role;
select public.portal_request_bank_change(:'s_vera', :'vera', '{"bank_name":"NMB Bank","account_name":"Valves Ltd","account_number":"2020 3030 4040","currency":"USD"}') as bank2 \gset
reset role;
select tests.login('boss.ps@p.test'); set role authenticated;
select tests.blocked(format('select public.portal_decide_bank_change(%L, false, null)', :'bank2'), 'rejecting needs a reason');
select public.portal_decide_bank_change(:'bank2', false, 'Could not confirm by phone');
reset role;
select tests.check((select status from public.supplier_bank_details where id = :'bank1') = 'approved'
                   and (select status from public.supplier_bank_details where id = :'bank2') = 'rejected',
  'a rejected change leaves the approved account as it was');
set role service_role;
select tests.check((public.portal_supplier_profile(:'s_vera', :'vera') #>> '{last_decision,status}') = 'rejected'
                   and (public.portal_supplier_profile(:'s_vera', :'vera') #>> '{bank,bank_name}') = 'CRDB Bank',
  'the supplier sees the decision and the account in use');
select public.portal_request_bank_change(:'s_vera', :'vera', '{"bank_name":"NBC","account_name":"Valves Ltd","account_number":"999988887777"}') as bank3 \gset
select public.portal_file_begin(:'s_vera', :'vera', jsonb_build_object('purpose', 'bank_letter', 'bank_detail_id', :'bank3',
  'file_name', 'letter.pdf', 'content_type', 'application/pdf', 'size', '1000')) as fl \gset
reset role;
insert into storage.objects (bucket_id, name) values ('portal', :'fl'::jsonb ->> 'path');
set role service_role;
select public.portal_file_done(:'s_vera', :'vera', (:'fl'::jsonb ->> 'id')::uuid);
reset role;
select tests.login('boss.ps@p.test'); set role authenticated;
select public.portal_decide_bank_change(:'bank3', true, null);
reset role;
select tests.check((select status from public.supplier_bank_details where id = :'bank1') = 'superseded'
                   and (select status from public.supplier_bank_details where id = :'bank3') = 'approved',
  'newly approved details replace the old ones (kept as superseded)');
select tests.login('proc.ps@p.test'); set role authenticated;
select tests.check((select count(*) from storage.objects where bucket_id = 'portal' and name = :'fl'::jsonb ->> 'path') = 0,
  'procurement cannot open the bank letter');
reset role;
select tests.login('fin.ps@p.test'); set role authenticated;
select tests.check((select count(*) from storage.objects where bucket_id = 'portal' and name = :'fl'::jsonb ->> 'path') = 1,
  'finance can');
reset role;
select tests.login('other.ps@p.test'); set role authenticated;
select tests.check((select count(*) from storage.objects where bucket_id = 'portal') = 0
                   and (select count(*) from public.portal_submissions) = 0 and (select count(*) from public.portal_files) = 0,
  'another company sees none of these files or documents');
reset role;
