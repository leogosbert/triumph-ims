-- Tests for the price book, service and playbook requests, and LeMo Tech billing.
-- Everything runs in one transaction that is rolled back.
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
create or replace function tests.login_aal(p_email text, p_aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'email', p_email, 'role', 'authenticated', 'aal', p_aal)::text, false);
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
grant execute on all functions in schema tests to authenticated, anon;

begin;

insert into auth.users (email) values ('boss.sb@s.test'), ('sales.sb@s.test'), ('fin.sb@s.test'), ('admin.sb@s.test'), ('other.sb@s.test');
select id as admin from auth.users where email = 'admin.sb@s.test' \gset
select id as sales from auth.users where email = 'sales.sb@s.test' \gset
insert into public.platform_admins (user_id) values (:'admin');

select tests.login('boss.sb@s.test'); set role authenticated;
select public.create_company('Pipes & Services Ltd') as co \gset
select public.set_business_level(:'co', 'small');
select public.invite_member(:'co', 'sales.sb@s.test', 'sales');
select public.invite_member(:'co', 'fin.sb@s.test', 'finance');
reset role;
select tests.login('sales.sb@s.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('fin.sb@s.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('other.sb@s.test'); set role authenticated; select public.create_company('Other Ltd') as other \gset
reset role;

-- ---- 1. Price book -----------------------------------------------------------------------------
select tests.check((select count(*) from public.price_items where category = 'plan') = 3, 'three plans in the price book');
select tests.check((select count(*) from public.price_items where playbook_id is not null) = 13, 'thirteen playbooks in the price book');
select tests.check(not exists (select 1 from public.price_items i, unnest(i.feature_keys) k
                                where not exists (select 1 from public.features f where f.key = k)),
                   'every add-on names real features');
set role anon;
select tests.check((select count(*) from public.public_price_list() where category = 'plan') = 3, 'visitors see the public price list');
select tests.blocked('select * from public.price_items', 'visitors cannot read the price table');
reset role;
select tests.login('sales.sb@s.test'); set role authenticated;
select tests.check((select count(*) from public.price_items) > 50, 'signed-in people read the price book');
select tests.blocked($$update public.price_items set price_tzs = 1 where key = 'plan_small'$$, 'prices cannot be changed directly');
select tests.blocked($$select public.admin_save_price_item('{"key":"x_free","category":"service","name":"Free"}'::jsonb)$$, 'only LeMo Tech changes prices');
select tests.check((select legal_name from public.platform_billing_settings) = 'LeMo Tech Solutions', 'LeMo Tech details are readable for invoices');
select tests.blocked('select next_invoice_no from public.platform_billing_settings', 'the invoice counter is not readable');
reset role;

-- ---- 2. Playbooks on request -------------------------------------------------------------------
select tests.login('sales.sb@s.test'); set role authenticated;
select tests.check(not public.has_playbook(:'co', 'stock'), 'a playbook is closed until it is given');
select tests.check((select state from public.company_playbooks(:'co') where playbook_id = 'stock') is null, 'no request yet');
select public.request_service(:'co', 'playbook_stock', 1, 'For the store team') as req_pb \gset
select tests.check((select state from public.company_playbooks(:'co') where playbook_id = 'stock') = 'requested', 'requested');
select tests.blocked(format('select public.request_service(%L, %L)', :'co', 'playbook_stock'), 'no second waiting request');
select tests.blocked(format('select public.request_service(%L, %L)', :'co', 'training_remote'), 'sales cannot order paid services');
select tests.blocked(format('select public.request_service(%L, %L)', :'other', 'playbook_stock'), 'not for another company');
select tests.blocked(format('select public.admin_decide_request(%L, %L)', :'req_pb', 'approve'), 'a company cannot approve itself');
reset role;
select tests.check((select count(*) from public.platform_notifications where kind = 'service_request') = 1, 'LeMo Tech is told about the request');

select tests.login_aal('admin.sb@s.test', 'aal2'); set role authenticated;
select tests.check((select count(*) from public.platform_service_requests('requested')) = 1, 'admin sees the waiting request');
select tests.check((select requested_by_role from public.platform_service_requests('requested')) = 'sales', 'with who asked');
select public.admin_decide_request(:'req_pb', 'approve', 'Enjoy');
reset role;
select tests.login('sales.sb@s.test'); set role authenticated;
select tests.check(public.has_playbook(:'co', 'stock'), 'the playbook opens once approved');
select tests.check(not public.has_playbook(:'co', 'security'), 'other playbooks stay closed');
select tests.check((select count(*) from public.notifications where kind = 'playbook') = 1, 'the person who asked is told');
select tests.blocked(format('select public.request_service(%L, %L)', :'co', 'playbook_stock'), 'cannot request a playbook already given');
reset role;
select tests.login('other.sb@s.test'); set role authenticated;
select tests.check(not public.has_playbook(:'co', 'stock'), 'other companies cannot open it');
select tests.check(not public.has_playbook(:'other', 'stock'), 'and do not have it themselves');
select tests.check((select count(*) from public.service_requests) = 0, 'other companies do not see the requests');
reset role;
-- Demo companies have every playbook.
update public.companies set is_demo = true, demo_expires_at = now() + interval '1 day' where id = :'other';
select tests.login('other.sb@s.test'); set role authenticated;
select tests.check(public.has_playbook(:'other', 'security'), 'a demo company has every playbook');
reset role;
update public.companies set is_demo = false, demo_expires_at = null where id = :'other';

-- Cancel and decline.
select tests.login('sales.sb@s.test'); set role authenticated;
select public.request_service(:'co', 'playbook_security') as req_sec \gset
select public.cancel_service_request(:'req_sec');
select tests.check((select status from public.service_requests where id = :'req_sec') = 'cancelled', 'own request cancelled');
select public.request_service(:'co', 'playbook_security') as req_sec2 \gset
reset role;
select tests.login_aal('admin.sb@s.test', 'aal2'); set role authenticated;
select public.admin_decide_request(:'req_sec2', 'decline', 'Not yet');
select tests.blocked(format('select public.admin_decide_request(%L, %L)', :'req_sec2', 'approve'), 'a declined request cannot be approved');
reset role;
select tests.login('sales.sb@s.test'); set role authenticated;
select tests.check((select state from public.company_playbooks(:'co') where playbook_id = 'security') = 'declined', 'declined is shown');
select public.request_service(:'co', 'playbook_security', 1, 'Please, we need it');
select tests.check((select state from public.company_playbooks(:'co') where playbook_id = 'security') = 'requested', 'can ask again after a decline');
reset role;

-- ---- 3. Paid services and add-ons ---------------------------------------------------------------
select tests.check(not public.feature_on(:'co', 'multi_currency'), 'small company: no multi-currency yet');
select tests.login('boss.sb@s.test'); set role authenticated;
select public.request_service(:'co', 'addon_importer') as req_addon \gset
select public.request_service(:'co', 'training_remote', 2, 'Two sessions') as req_train \gset
select tests.check((select count(*) from public.service_requests) >= 4, 'management sees all requests');
reset role;
select tests.login('sales.sb@s.test'); set role authenticated;
select tests.check(not exists (select 1 from public.service_requests where id = :'req_addon'), 'sales does not see others'' requests');
reset role;
select tests.login_aal('admin.sb@s.test', 'aal2'); set role authenticated;
select public.admin_decide_request(:'req_addon', 'approve');
reset role;
select tests.check(public.feature_on(:'co', 'multi_currency') and public.feature_on(:'co', 'landed_cost'), 'approving an add-on switches its features on');
select tests.login_aal('admin.sb@s.test', 'aal2'); set role authenticated;
select public.admin_decide_request(:'req_addon', 'end', 'Stopped');
reset role;
select tests.check(not public.feature_on(:'co', 'multi_currency'), 'ending an add-on puts the features back to the level default');
select tests.login_aal('admin.sb@s.test', 'aal2'); set role authenticated;
select public.admin_decide_request(:'req_train', 'deliver', 'Done on Monday');
select public.admin_grant_item(:'co', 'playbook_enterprise', 1, 'A gift') as gift \gset
reset role;
select tests.login('boss.sb@s.test'); set role authenticated;
select tests.check(public.has_playbook(:'co', 'enterprise'), 'a playbook can be given without a request');
reset role;

-- ---- 4. Billing --------------------------------------------------------------------------------
select tests.login('boss.sb@s.test'); set role authenticated;
select public.set_billing_details(:'co', 'Pipes & Services Ltd', 'accounts@pipes.test', '123-456-789');
select tests.blocked(format('select public.set_billing_details(%L, %L, %L, %L)', :'co', 'X', 'not an email', ''), 'email is checked');
select tests.blocked(format('select public.admin_set_company_billing(%L, %L, %L, 0, false, %L, null, null)', :'co', 'TZS', 'monthly', 'free'),
                     'a company cannot change its own plan terms');
reset role;
select tests.login('sales.sb@s.test'); set role authenticated;
select tests.blocked(format('select public.set_billing_details(%L, %L, %L, %L)', :'co', 'X', '', ''), 'sales cannot change billing details');
select tests.check((select count(*) from public.company_billing) = 0, 'sales does not see billing');
reset role;

select tests.login_aal('admin.sb@s.test', 'aal2'); set role authenticated;
select public.admin_save_billing_settings('{"vat_rate": "18"}'::jsonb);
select public.admin_set_company_billing(:'co', 'TZS', 'monthly', 10, true, 'active', null, null);
select public.admin_create_invoice(:'co', 'TZS',
  jsonb_build_array(jsonb_build_object('item_key', 'plan_small', 'quantity', 1),
                    jsonb_build_object('item_key', 'training_remote', 'quantity', 2),
                    jsonb_build_object('description', 'Site visit, Kibaha', 'quantity', 1, 'unit_price', 75000)),
  null, null, 'October', array[:'req_train']::uuid[], false) as inv \gset
select tests.check((select subtotal = 325000 and discount = 32500 and vat = 52650 and total = 345150 and status = 'draft'
                      from public.platform_invoices where id = :'inv'), 'totals: 325,000 less 10% plus 18% VAT');
select tests.check((select invoice_id from public.service_requests where id = :'req_train') = :'inv', 'the request is marked billed');
reset role;
select tests.login('fin.sb@s.test'); set role authenticated;
select tests.check((select count(*) from public.platform_invoices) = 0, 'drafts are not shown to the company');
reset role;
select tests.login_aal('admin.sb@s.test', 'aal2'); set role authenticated;
select public.admin_issue_invoice(:'inv') as invno \gset
select tests.check(:'invno' ~ '^LMS-\d{4}-0001$', 'issued with a number');
select tests.blocked(format('select public.admin_record_invoice_payment(%L, 999999999, %L, %L)', :'inv', 'M-Pesa', 'X'), 'cannot record more than due');
select public.admin_record_invoice_payment(:'inv', 145150, 'M-Pesa', 'QW12');
select tests.check((select status = 'issued' and paid_amount = 145150 from public.platform_invoices where id = :'inv'), 'part payment keeps it open');
select tests.check((select balance from public.platform_billing_overview() where company_id = :'co') = 200000, 'overview shows the balance');
reset role;
select tests.login('fin.sb@s.test'); set role authenticated;
select tests.check((select count(*) from public.platform_invoices) = 1, 'finance sees the issued invoice');
select tests.check((select count(*) from public.platform_invoice_lines) = 3, 'with its lines');
select tests.check((select count(*) from public.notifications where kind = 'billing') >= 1, 'finance is told about the invoice');
select tests.blocked(format('select public.admin_record_invoice_payment(%L, 1, %L, %L)', :'inv', 'Cash', 'X'), 'a company cannot mark itself paid');
select tests.blocked(format('update public.platform_invoices set status = %L', 'paid'), 'invoices cannot be changed directly');
reset role;
select tests.login('sales.sb@s.test'); set role authenticated;
select tests.check((select count(*) from public.platform_invoices) = 0, 'sales does not see invoices');
reset role;
select tests.login('other.sb@s.test'); set role authenticated;
select tests.check((select count(*) from public.platform_invoices) = 0, 'other companies do not see invoices');
reset role;
select tests.login_aal('admin.sb@s.test', 'aal2'); set role authenticated;
select public.admin_record_invoice_payment(:'inv', 200000, 'Bank', 'TT55');
select tests.check((select status from public.platform_invoices where id = :'inv') = 'paid', 'paid in full');
select tests.blocked(format('select public.admin_void_invoice(%L, %L)', :'inv', 'Mistake'), 'a paid invoice cannot be cancelled');
select public.admin_create_invoice(:'co', 'USD', '[{"item_key": "plan_small"}]'::jsonb, null, null, null, '{}', true, 0) as inv2 \gset
select tests.check((select total from public.platform_invoices where id = :'inv2') = 23.60, 'USD invoice uses the USD price (20 + 18% VAT)');
select public.admin_void_invoice(:'inv2', 'Wrong currency');
select tests.check((select status from public.platform_invoices where id = :'inv2') = 'void', 'unpaid invoice cancelled');
select tests.blocked(format('select public.admin_create_invoice(%L, %L, %L::jsonb)', :'co', 'TZS', '[{"item_key": "migration"}]'),
                     'an item priced on request needs a price');
reset role;
select tests.login_aal('admin.sb@s.test', 'aal1'); set role authenticated;
select tests.blocked('select * from public.platform_billing_overview()', 'admin tools need two-step verification');
reset role;

rollback;

select 'ALL SERVICES & BILLING TESTS PASSED';
