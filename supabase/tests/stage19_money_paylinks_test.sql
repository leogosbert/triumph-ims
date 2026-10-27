-- Tests for pay links: the link, the public page data, gateway orders and webhooks (played by the service
-- role; nothing reaches a real gateway), payments posted like typed ones, and matching pasted references.
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
create or replace function tests.bal(p_company uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.gl_lines l join public.gl_accounts a on a.id = l.account_id
   where a.company_id = p_company and a.system_key = p_key;
$$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

insert into auth.users (email) values ('boss.pl@g.test'), ('fin.pl@g.test'), ('sales.pl@g.test'), ('store.pl@g.test'), ('other.pl@g.test');

select tests.login('boss.pl@g.test'); set role authenticated;
select public.create_company('Paylink Supply Co') as co \gset
reset role;
select tests.login('other.pl@g.test'); set role authenticated;
select public.create_company('Other Paylink Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
select :'co', id, r::public.app_role from (values ('fin.pl@g.test', 'finance'), ('sales.pl@g.test', 'sales'), ('store.pl@g.test', 'warehouse')) v(e, r)
  join auth.users u on u.email = v.e;
select set_config('request.jwt.claims', '', false);
update public.companies set mobile_money_details = 'M-Pesa Lipa 123456', bank_details = 'CRDB 0150-123' where id = :'co';

insert into public.clients (company_id, name) values (:'co', 'Mwanza Hardware') returning id as client \gset
insert into public.clients (company_id, name) values (:'co', 'Arusha Builders Ltd') returning id as client2 \gset
insert into public.client_contacts (company_id, client_id, kind, name, email, phone)
values (:'co', :'client', 'finance', 'Juma', 'juma@mwanza.test', '0712 345 678');

create or replace function tests.new_invoice(p_company uuid, p_client uuid, p_price numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.invoices (company_id, client_id, vat_rate) values (p_company, p_client, 0) returning id into v;
  insert into public.invoice_lines (company_id, invoice_id, description, quantity, unit_price) values (p_company, v, 'Cement 50kg', 1, p_price);
  perform public.issue_invoice(v);
  return v;
end $$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

select tests.check((select default_level = 'small' and status = 'live' and module = 'Finance' and route = '/getting-paid/links'
                     from public.features where key = 'pay_links'), 'pay_links feature: small level, live, Finance');

-- ---- 1. The link ------------------------------------------------------------------------------------------
select tests.login('fin.pl@g.test'); set role authenticated;
insert into public.invoices (company_id, client_id) values (:'co', :'client') returning id as draft \gset
select tests.new_invoice(:'co', :'client', 300000) as inv \gset
select tests.new_invoice(:'co', :'client2', 450000) as inv2 \gset
select tests.blocked(format('select public.pay_link_get(%L)', :'draft'), 'no link for a draft');
reset role;
select tests.login('sales.pl@g.test'); set role authenticated;
select public.pay_link_get(:'inv') as code \gset
select tests.check(:'code' ~ '^[a-f0-9]{32}$', 'sales get the invoice''s pay link (32 random characters)');
select tests.check(public.pay_link_get(:'inv') = :'code', 'asking again gives the same link');
select tests.blocked(format('select public.pay_link_cancel(%L)', :'inv'), 'sales cannot stop a link');
reset role;
select tests.login('store.pl@g.test'); set role authenticated;
select tests.blocked(format('select public.pay_link_get(%L)', :'inv'), 'the warehouse cannot get pay links');
reset role;
select tests.login('other.pl@g.test'); set role authenticated;
select tests.blocked(format('select public.pay_link_get(%L)', :'inv'), 'another company cannot get the link');
select tests.check((select count(*) from public.pay_links) = 0, 'another company sees no links');
reset role;
select tests.login('fin.pl@g.test'); set role authenticated;
select public.pay_link_get(:'inv2') as code2 \gset
select public.pay_link_cancel(:'inv2');
select public.pay_link_get(:'inv2') as code2b \gset
select tests.check(:'code2' <> :'code2b', 'a stopped link is replaced by a new one');
select tests.blocked(format('select public.pay_save_settings(%L, %L)', :'co', '{"provider": "selcom"}'), 'finance cannot choose the gateway');
reset role;

-- ---- 2. The public page data ---------------------------------------------------------------------------------
set role service_role;
select public.pay_link_public(:'code') as pub \gset
select tests.check(:'pub'::jsonb ->> 'status' = 'open' and (:'pub'::jsonb -> 'invoice' ->> 'balance')::numeric = 300000
                   and :'pub'::jsonb -> 'invoice' ->> 'client' = 'Mwanza Hardware'
                   and :'pub'::jsonb -> 'company' ->> 'mobile_money_details' = 'M-Pesa Lipa 123456'
                   and :'pub'::jsonb ->> 'provider' is null,
  'public page: what is owed, to whom, and the company''s pay details (no gateway yet)');
select tests.check((select public.pay_link_public(:'code2')) ->> 'status' = 'cancelled', 'a stopped link shows as no longer valid');
select tests.check(public.pay_link_public('0000') is null and public.pay_link_public('00000000000000000000000000000000') is null,
  'unknown codes show nothing');
select tests.blocked(format('select public.pay_order_start(%L, null)', :'code'), 'no Pay button until a gateway is chosen');
reset role;
select tests.login('boss.pl@g.test'); set role authenticated;
select tests.blocked(format('select public.pay_save_settings(%L, %L)', :'co', '{"provider": "paypal"}'), 'unknown gateways are refused');
select public.pay_save_settings(:'co', '{"provider": "selcom", "on_documents": true}');
reset role;
select tests.login('fin.pl@g.test'); set role authenticated;
select tests.blocked(format('select public.pay_link_public(%L)', :'code'), 'the app cannot call the public-page function');
select tests.blocked(format('select public.pay_gateway_result(%L, %L, %L, 1, null, null, null, %L, null, null, null)', 'selcom', 'X-1', 'success', 'mobile_money'),
  'nobody in the app can record a gateway payment');
select tests.blocked(format('insert into public.pay_links (company_id, invoice_id, code) values (%L, %L, %L)', :'co', :'inv', repeat('a', 32)),
  'links are never added directly');
reset role;
select tests.check(not has_function_privilege('anon', 'public.pay_link_public(text)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.pay_gateway_result(text, text, text, numeric, text, text, text, text, text, text, jsonb)', 'EXECUTE')
                   and has_function_privilege('service_role', 'public.pay_gateway_result(text, text, text, numeric, text, text, text, text, text, text, jsonb)', 'EXECUTE'),
  'grants: only the server records gateway results');

-- ---- 3. An order and its webhook --------------------------------------------------------------------------------
set role service_role;
select public.pay_order_start(:'code', 1000) as ord \gset
select :'ord'::jsonb ->> 'order_id' as oid \gset
select tests.check((:'ord'::jsonb ->> 'amount')::numeric = 300000 and :'oid' ~ '^INV-[0-9]{4}-[0-9]{4}-[A-F0-9]{8}$'
                   and :'ord'::jsonb -> 'buyer' ->> 'email' = 'juma@mwanza.test' and :'ord'::jsonb -> 'buyer' ->> 'phone' = '255712345678',
  'order for the whole balance (part payments are off), with the client''s email and phone');
select public.pay_order_checkout(:'oid', 'https://checkout.selcom.test/pay/abc', 'SELREF1', null);
select tests.check((select status = 'pending' and checkout_url = 'https://checkout.selcom.test/pay/abc' from public.pay_orders where order_id = :'oid'),
  'the checkout address is kept');
select public.pay_gateway_result('selcom', :'oid', 'pending', 300000, null, 'SELREF1', 'MPESA-TZ', 'mobile_money', 'mpesa', '255712345678', '{}') ->> 'outcome' as o1 \gset
select tests.check(:'o1' = 'pending' and (select amount_paid from public.invoices where id = :'inv') = 0, 'pending: nothing recorded yet');
select public.pay_gateway_result('selcom', :'oid', 'success', 300000, 'QJK7TX9', 'SELREF1', 'MPESA-TZ', 'mobile_money', 'mpesa', '255712345678',
                                 '{"payment_status": "COMPLETED"}') as res \gset
reset role;
select tests.check(:'res'::jsonb ->> 'outcome' = 'recorded', 'success: the payment is recorded');
select tests.check((select status = 'paid' and amount_paid = 300000 from public.invoices where id = :'inv'), 'the invoice is paid');
select tests.check((select method = 'mobile_money' and provider = 'mpesa' and reference = 'QJK7TX9' and reconciled_at is not null and amount = 300000
                      from public.payments where id = (:'res'::jsonb ->> 'payment_id')::uuid),
  'recorded as M-Pesa with the transaction code, already ticked as checked');
select tests.check(tests.bal(:'co', 'mobile_money') = 300000 and tests.bal(:'co', 'receivable') = 450000,
  'posted to the books like a typed payment (mobile money in, clients owe less)');
select tests.check((select status from public.pay_links where code = :'code') = 'paid', 'the link is closed as paid');
select tests.check(exists (select 1 from public.notifications where company_id = :'co' and kind = 'payment_received'), 'management gets the usual "payment received" alert');
set role service_role;
select tests.check(public.pay_gateway_result('selcom', :'oid', 'success', 300000, 'QJK7TX9', 'SELREF1', 'MPESA-TZ', 'mobile_money', 'mpesa', null, '{}') ->> 'outcome' = 'duplicate',
  'the same webhook twice is recorded once');
select tests.check(public.pay_gateway_result('selcom', 'NOPE-123456', 'success', 5, null, null, null, 'mobile_money', null, null, '{}') ->> 'outcome' = 'unknown_order',
  'an unknown order is only logged');
select public.pay_event_rejected('selcom', :'oid', 'bad_signature', '{"ip": "1.2.3.4"}');
select tests.check((select count(*) from public.pay_events where order_id = :'oid') = 4
                   and (select count(*) from public.pay_events where order_id = :'oid' and not verified) = 1,
  'every webhook is kept, the rejected one marked not verified');
select tests.blocked(format('select public.pay_order_start(%L, null)', :'code'), 'a paid invoice takes no new order');
reset role;

-- ---- 4. Staff typed the code first: matched, not counted twice; part payments; overpayment -----------------------------
select tests.login('boss.pl@g.test'); set role authenticated;
select public.pay_save_settings(:'co', '{"provider": "selcom", "allow_partial": true}');
reset role;
select tests.login('fin.pl@g.test'); set role authenticated;
select public.record_payment(:'inv2', current_date, 100000, 'mobile_money', 'RX55AB', null, null, 'airtel_money') as typed \gset
reset role;
set role service_role;
select public.pay_order_start(:'code2b', 100000) ->> 'order_id' as oid2 \gset
select tests.check((select amount from public.pay_orders where order_id = :'oid2') = 100000, 'part payments allowed: the client chose 100,000');
select public.pay_gateway_result('selcom', :'oid2', 'success', 100000, 'rx55ab', null, 'AIRTELMONEY', 'mobile_money', 'airtel_money', null, '{}') as res2 \gset
reset role;
select tests.check(:'res2'::jsonb ->> 'outcome' = 'matched' and (:'res2'::jsonb ->> 'payment_id')::uuid = :'typed'::uuid
                   and (select amount_paid from public.invoices where id = :'inv2') = 100000
                   and (select reconciled_at is not null from public.payments where id = :'typed'),
  'the code staff typed is matched to the gateway payment (counted once, ticked as checked)');
set role service_role;
select public.pay_order_start(:'code2b', null) ->> 'order_id' as oid3 \gset
select public.pay_gateway_result('selcom', :'oid3', 'success', 400000, 'TT0099', null, 'VISA', 'bank_transfer', null, null, '{}') as res3 \gset
reset role;
select tests.check(:'res3'::jsonb ->> 'outcome' = 'recorded_overpaid'
                   and (select amount = 350000 and method = 'bank_transfer' and provider is null from public.payments
                         where id = (:'res3'::jsonb ->> 'payment_id')::uuid)
                   and (select status from public.invoices where id = :'inv2') = 'paid',
  'a card payment above the balance: the balance is recorded, the invoice paid');
select tests.check(exists (select 1 from public.notifications where company_id = :'co' and kind = 'pay_overpaid'),
  'management and finance are told the client paid 50,000 too much');
set role service_role;
select public.pay_gateway_result('selcom', :'oid3', 'failed', 0, null, null, null, 'mobile_money', null, null, '{}') ->> 'outcome' as o4 \gset
reset role;
select tests.check(:'o4' = 'duplicate', 'a late "failed" after success changes nothing');
select public.gl_check(:'co') as chk \gset
select tests.check((:'chk'::jsonb ->> 'balanced')::boolean and (:'chk'::jsonb ->> 'receivable_books')::numeric = (:'chk'::jsonb ->> 'receivable_documents')::numeric,
  'books balanced and matching the invoices');

-- ---- 5. Matching pasted references -----------------------------------------------------------------------------------------
select tests.login('fin.pl@g.test'); set role authenticated;
select tests.new_invoice(:'co', :'client', 125000) as inv3 \gset
select tests.new_invoice(:'co', :'client2', 77000) as inv4 \gset
select number as inv3_no from public.invoices where id = :'inv3' \gset
select public.pay_link_get(:'inv3') as code3 \gset
select public.pay_match_suggest(:'co', jsonb_build_array(
  jsonb_build_object('ref', 'qjk7tx9', 'amount', 300000, 'text', 'QJK7TX9 Confirmed. Tsh300,000 received'),
  jsonb_build_object('ref', 'AB12CD34', 'amount', 125000, 'text', 'AB12CD34 Confirmed. Tsh125,000 from JUMA ref ' || replace(:'inv3_no', '-', ' ')),
  jsonb_build_object('ref', 'ZZ99', 'amount', 77000, 'text', 'ZZ99 Tsh77,000 received'),
  jsonb_build_object('ref', 'YY88', 'amount', 5, 'text', 'YY88 from ARUSHA BUILDERS LTD'),
  jsonb_build_object('ref', 'XX77', 'amount', 1, 'text', 'XX77 nothing'))) as m \gset
select tests.check(:'m'::jsonb -> 0 -> 'recorded' ->> 'payment_id' is not null, 'a code already recorded is recognised (any case)');
select tests.check(:'m'::jsonb -> 1 ->> 'why' = 'number' and (:'m'::jsonb -> 1 -> 'invoice' ->> 'id')::uuid = :'inv3'::uuid,
  'the invoice number in the text finds the invoice (spaces instead of dashes are fine)');
select tests.check(:'m'::jsonb -> 2 ->> 'why' = 'amount' and (:'m'::jsonb -> 2 -> 'invoice' ->> 'id')::uuid = :'inv4'::uuid,
  'the only invoice owing that amount is suggested');
select tests.check(:'m'::jsonb -> 3 ->> 'why' = 'client' and (:'m'::jsonb -> 3 -> 'invoice' ->> 'id')::uuid = :'inv4'::uuid,
  'the client''s name finds their only open invoice');
select tests.check(:'m'::jsonb -> 4 -> 'invoice' = 'null'::jsonb and :'m'::jsonb -> 4 -> 'recorded' = 'null'::jsonb, 'no guess when nothing fits');
reset role;
select tests.login('sales.pl@g.test'); set role authenticated;
select tests.blocked(format('select public.pay_match_suggest(%L, %L)', :'co', '[]'), 'sales do not match payments');
select tests.check((select count(*) from public.pay_orders) = 0 and (select count(*) from public.pay_events) = 0, 'sales do not see orders or webhooks');
reset role;
select tests.login('fin.pl@g.test'); set role authenticated;
select tests.check((select count(*) from public.pay_orders where company_id = :'co') = 3, 'finance sees the orders');
reset role;

-- ---- 6. Feature off: links stop -----------------------------------------------------------------------------------------------
select tests.login('boss.pl@g.test'); set role authenticated;
select public.set_company_feature(:'co', 'pay_links', false);
select tests.blocked(format('select public.pay_link_get(%L)', :'inv4'), 'feature off: no new links');
reset role;
set role service_role;
select tests.check(public.pay_link_public(:'code3') ->> 'status' = 'cancelled', 'feature off: shared links show as no longer valid');
reset role;
select tests.login('boss.pl@g.test'); set role authenticated;
select public.set_company_feature(:'co', 'pay_links', null);
reset role;
drop function tests.new_invoice(uuid, uuid, numeric);
