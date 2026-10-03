-- Tests for Stage 3: RFQs, quotations and approvals.
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

insert into auth.users (email) values
  ('m3@q.test'), ('m3b@q.test'), ('s3@q.test'), ('p3@q.test'), ('w3@q.test');

select tests.login('m3@q.test'); set role authenticated;
select public.create_company('Quote Co') as cid \gset
select public.invite_member(:'cid', 'm3b@q.test', 'management');
select public.invite_member(:'cid', 's3@q.test', 'sales');
select public.invite_member(:'cid', 'p3@q.test', 'procurement');
select public.invite_member(:'cid', 'w3@q.test', 'warehouse');
insert into public.clients (company_id, name, currency) values (:'cid', 'Geita Gold', 'TZS') returning id as client \gset
insert into public.clients (company_id, name, tax_status) values (:'cid', 'Exempt Org', 'Exempt') returning id as exempt \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'OIL68', 'Hydraulic oil', 'drum', 1000000) returning id as oil \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'BRG', 'Bearing', 'pcs', 100000) returning id as brg \gset
insert into public.product_costs (product_id, company_id, last_cost) values (:'oil', :'cid', 800000);
insert into public.product_costs (product_id, company_id, last_cost) values (:'brg', :'cid', 95000);
reset role;
select tests.login('m3b@q.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('s3@q.test');  set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('p3@q.test');  set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('w3@q.test');  set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;

-- ---- RFQ by sales --------------------------------------------------
select tests.login('s3@q.test'); set role authenticated;
insert into public.rfqs (company_id, client_id, title, received_via) values (:'cid', :'client', '20 drums hydraulic oil', 'whatsapp') returning id as rfq \gset
select tests.check((select number from public.rfqs where id = :'rfq') like 'RFQ-____-0001', 'RFQ gets a yearly number');
insert into public.rfq_lines (company_id, rfq_id, product_id, description, quantity, unit) values (:'cid', :'rfq', :'oil', 'Hydraulic oil VG68', 20, 'drum');
insert into public.rfq_lines (company_id, rfq_id, description, quantity) values (:'cid', :'rfq', 'Special seal kit', 2);
select tests.check((select max(line_no) from public.rfq_lines where rfq_id = :'rfq') = 2, 'RFQ lines are numbered');
select tests.blocked(format('update public.rfqs set status = %L where id = %L', 'won', :'rfq'), 'RFQ status cannot be set by hand (except cancel)');

-- ---- Quotation from RFQ -------------------------------------------
select public.create_quotation(:'cid', :'client', :'rfq') as q1 \gset
select tests.check((select status from public.rfqs where id = :'rfq') = 'quoting', 'creating a quotation moves the RFQ to quoting');
select tests.check((select count(*) from public.quotation_lines where quotation_id = :'q1') = 2, 'RFQ lines are copied to the quotation');
select tests.check((select unit_price from public.quotation_lines where quotation_id = :'q1' and product_id = :'oil') = 1000000, 'catalogue price is used');
update public.quotation_lines set unit_price = 50000 where quotation_id = :'q1' and product_id is null;
select tests.check((select subtotal from public.quotations where id = :'q1') = 20100000, 'subtotal is calculated from lines');
select tests.check((select vat_amount from public.quotations where id = :'q1') = 3618000, 'VAT 18% is calculated');
select tests.check((select total from public.quotations where id = :'q1') = 23718000, 'total includes VAT');
update public.quotation_lines set discount_pct = 10 where quotation_id = :'q1' and product_id = :'oil';
select tests.check((select subtotal from public.quotations where id = :'q1') = 18100000, 'line discount reduces the subtotal');
select tests.check((select discount_total from public.quotations where id = :'q1') = 2000000, 'discount total is tracked');
select tests.blocked(format('update public.quotations set total = 1 where id = %L', :'q1'), 'totals cannot be typed in');
select tests.blocked(format('update public.quotations set status = %L where id = %L', 'approved', :'q1'), 'sales cannot approve by changing status');

-- Margin: oil 18,000,000 revenue vs 16,000,000 cost = 11.1% (< 12%), plus a line with no cost.
select tests.check(public.submit_quotation(:'q1') = 'pending_approval', 'low margin from sales needs approval');
select tests.check((select approval_reason from public.quotations where id = :'q1') like '%margin below 12%' , 'reason mentions the margin');
select tests.check((select approval_reason from public.quotations where id = :'q1') like '%without a known cost%', 'reason mentions missing costs');
select tests.check((select count(*) from public.quotation_margins) = 0, 'sales cannot see the margin');
select tests.blocked(format('update public.quotation_lines set quantity = 30 where quotation_id = %L', :'q1'), 'lines are locked after submitting');
select tests.blocked(format('update public.quotations set notes = %L where id = %L', 'x', :'q1'), 'header is locked after submitting');
select tests.blocked(format('select public.review_quotation(%L, true, null)', :'q1'), 'sales cannot approve');
reset role;

select tests.login('p3@q.test'); set role authenticated;
select tests.check((select margin_pct from public.quotation_margins where quotation_id = :'q1') = 11.11, 'procurement sees the margin');
select tests.blocked(format('select public.review_quotation(%L, true, null)', :'q1'), 'procurement cannot approve');
select tests.check((select count(*) from public.quotations) = 1, 'procurement can read quotations');
reset role;

select tests.login('w3@q.test'); set role authenticated;
select tests.check((select count(*) from public.quotations) = 0, 'warehouse cannot see quotations');
select tests.check((select count(*) from public.rfqs) = 0, 'warehouse cannot see RFQs');
reset role;

-- Management sends it back, then approves the corrected version.
select tests.login('m3@q.test'); set role authenticated;
select tests.blocked(format('select public.review_quotation(%L, false, %L)', :'q1', ''), 'sending back needs a note');
select public.review_quotation(:'q1', false, 'Discount too high, max 5%');
select tests.check((select status from public.quotations where id = :'q1') = 'draft', 'sent back to draft');
reset role;

select tests.login('s3@q.test'); set role authenticated;
update public.quotation_lines set discount_pct = 0, unit_price = 1000000 where quotation_id = :'q1' and product_id = :'oil';
update public.quotation_lines set product_id = :'brg', unit_price = 120000 where quotation_id = :'q1' and product_id is null;
select tests.check(public.submit_quotation(:'q1') = 'approved', 'healthy margin under the limit is approved automatically');
select public.mark_quotation_sent(:'q1');
select tests.check((select status from public.rfqs where id = :'rfq') = 'quoted', 'sending moves the RFQ to quoted');

-- Revision
select public.revise_quotation(:'q1') as q1r1 \gset
select tests.check((select revision from public.quotations where id = :'q1r1') = 1, 'revision gets R1');
select tests.check((select number from public.quotations where id = :'q1r1') = (select number from public.quotations where id = :'q1'), 'revision keeps the number');
select tests.check((select status from public.quotations where id = :'q1') = 'superseded', 'old version is superseded');
select tests.check((select count(*) from public.quotation_lines where quotation_id = :'q1r1') = 2, 'revision copies the lines');
select tests.check((select total from public.quotations where id = :'q1r1') = (select total from public.quotations where id = :'q1'), 'revision has the same total');

-- Big quotation needs approval even with good margin.
update public.quotation_lines set quantity = 40 where quotation_id = :'q1r1' and product_id = :'oil';
select tests.check(public.submit_quotation(:'q1r1') = 'pending_approval', 'value above the limit needs approval');
reset role;

select tests.login('m3b@q.test'); set role authenticated;
select public.review_quotation(:'q1r1', true, 'OK for this client');
select tests.check((select status from public.quotations where id = :'q1r1') = 'approved', 'another manager approves');
reset role;

select tests.login('s3@q.test'); set role authenticated;
select public.record_quotation_outcome(:'q1r1', true, 'PO received');
select tests.check((select status from public.quotations where id = :'q1r1') = 'accepted', 'quotation accepted');
select tests.check((select status from public.rfqs where id = :'rfq') = 'won', 'RFQ won');
select tests.blocked(format('select public.cancel_quotation(%L)', :'q1r1'), 'accepted quotation cannot be cancelled');

-- Exempt client gets 0% VAT; direct quotation without RFQ.
select public.create_quotation(:'cid', :'exempt', null) as q2 \gset
select tests.check((select vat_rate from public.quotations where id = :'q2') = 0, 'exempt client gets 0% VAT');
select tests.check((select number from public.quotations where id = :'q2') like 'QT-____-0002', 'second quotation number');
select tests.blocked(format('select public.submit_quotation(%L)', :'q2'), 'empty quotation cannot be submitted');
reset role;

-- A manager's own low-margin quotation is approved directly; they can't self-review a pending one.
select tests.login('m3@q.test'); set role authenticated;
select public.create_quotation(:'cid', :'client', null) as q3 \gset
insert into public.quotation_lines (company_id, quotation_id, product_id, description, quantity, unit_price)
values (:'cid', :'q3', :'brg', 'Bearing', 1, 96000);
select tests.check(public.submit_quotation(:'q3') = 'approved', 'management quotation is approved on submit');
select tests.check((select approved_by is not null from public.quotations where id = :'q3'), 'manager recorded as approver when rules were overridden');
reset role;

select tests.login('s3@q.test'); set role authenticated;
select public.create_quotation(:'cid', :'client', null) as q4 \gset
insert into public.quotation_lines (company_id, quotation_id, description, quantity, unit_price) values (:'cid', :'q4', 'Misc', 1, 1000);
select public.submit_quotation(:'q4');
reset role;
-- Make the sales user a manager temporarily to prove self-approval is blocked.
update public.memberships set role = 'management' where user_id = (select id from auth.users where email = 's3@q.test');
select tests.login('s3@q.test'); set role authenticated;
select tests.blocked(format('select public.review_quotation(%L, true, null)', :'q4'), 'nobody approves their own quotation');
reset role;
update public.memberships set role = 'sales' where user_id = (select id from auth.users where email = 's3@q.test');

select tests.check((select count(*) from public.audit_log where entity = 'quotations') > 5, 'quotation changes are logged');

\echo 'ALL STAGE 3 TESTS PASSED'
