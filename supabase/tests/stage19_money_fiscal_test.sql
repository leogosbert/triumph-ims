-- Tests for TRA fiscal receipts (manual EFD entry and the VFD queue), credit notes and daily totals.
-- Nothing is sent to TRA: the server side is played by "set role service_role".
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

insert into auth.users (email) values ('boss.fx@g.test'), ('fin.fx@g.test'), ('sales.fx@g.test'), ('store.fx@g.test'), ('other.fx@g.test');
select id as boss from auth.users where email = 'boss.fx@g.test' \gset
select id as fin from auth.users where email = 'fin.fx@g.test' \gset

select tests.login('boss.fx@g.test'); set role authenticated;
select public.create_company('Fiscal Supply Co') as co \gset
reset role;
select tests.login('other.fx@g.test'); set role authenticated;
select public.create_company('Other Fiscal Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
select :'co', id, r::public.app_role from (values ('fin.fx@g.test', 'finance'), ('sales.fx@g.test', 'sales'), ('store.fx@g.test', 'warehouse')) v(e, r)
  join auth.users u on u.email = v.e;

insert into public.clients (company_id, name, tin) values (:'co', 'Geita Gold Mine', '100-200-300') returning id as client \gset
insert into public.client_contacts (company_id, client_id, kind, name, phone) values (:'co', :'client', 'finance', 'Asha', '0754 111 222');

-- An issued invoice of 1,000,000 + 18% VAT (as finance).
create or replace function tests.new_invoice(p_company uuid, p_client uuid, p_price numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.invoices (company_id, client_id) values (p_company, p_client) returning id into v;
  insert into public.invoice_lines (company_id, invoice_id, description, quantity, unit_price) values (p_company, v, 'Hydraulic oil 20L', 2, p_price / 2);
  perform public.issue_invoice(v);
  return v;
end $$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

-- ---- 1. Feature -------------------------------------------------------------------------------------
select tests.check((select default_level = 'small' and status = 'live' and module = 'Finance' and route = '/getting-paid/tra'
                     from public.features where key = 'tra_fiscal'), 'tra_fiscal feature: small level, live, Finance');

-- ---- 2. Before the settings are saved, invoices get no receipt ----------------------------------------
select tests.login('fin.fx@g.test'); set role authenticated;
select tests.new_invoice(:'co', :'client', 1000000) as inv0 \gset
reset role;
select tests.check(not exists (select 1 from public.fiscal_receipts where invoice_id = :'inv0'), 'no settings yet: no fiscal receipt is opened');

-- ---- 3. Settings ---------------------------------------------------------------------------------------
select tests.login('fin.fx@g.test'); set role authenticated;
select tests.blocked(format('select public.fiscal_save_settings(%L, %L)', :'co', '{"mode": "manual"}'), 'finance cannot change the TRA settings');
select tests.check(public.fiscal_summary(:'co') ->> 'set_up' = 'false', 'summary: not set up yet');
reset role;
select tests.login('boss.fx@g.test'); set role authenticated;
select tests.blocked(format('select public.fiscal_save_settings(%L, %L)', :'co', '{"mode": "vfd"}'), 'VFD needs the TIN and the certificate serial');
select tests.blocked(format('select public.fiscal_save_settings(%L, %L)', :'co', '{"mode": "manual", "tin": "12345"}'), 'a TIN has 9 digits');
select public.fiscal_save_settings(:'co', '{"mode": "manual", "tin": "111-222-333", "vrn": "40-012345-A"}');
select tests.check((select mode = 'manual' and tin = '111222333' and environment = 'test' from public.fiscal_settings where company_id = :'co'),
  'manual mode saved, TIN kept as 9 digits');
reset role;

-- ---- 4. Manual mode: the receipt waits for the EFD details ------------------------------------------------
select tests.login('fin.fx@g.test'); set role authenticated;
select tests.new_invoice(:'co', :'client', 1000000) as inv1 \gset
select tests.check((select status = 'pending' and mode = 'manual' and total_incl = 1180000 and vat_amount = 180000 and total_excl = 1000000
                     from public.fiscal_receipts where invoice_id = :'inv1'), 'issuing opens a pending receipt with the TZS totals');
select tests.check((public.fiscal_summary(:'co') ->> 'to_type')::int = 1, 'summary: one receipt to type');
select tests.blocked(format('select public.fiscal_record_manual(%L, null, %L, %L, now(), null)', :'inv1', '123', 'ab'),
  'a verification code is letters and numbers, at least 4');
select tests.blocked(format('select public.fiscal_record_manual(%L, null, %L, %L, now(), null)', :'inv1', '123', 'https://evil.example.com/ABCD1234'),
  'a scanned link must be a tra.go.tz link');
select tests.blocked(format('select public.fiscal_record_manual(%L, null, %L, %L, now(), null)', :'inv1', '', 'ABCD1234'),
  'the receipt number is needed');
select public.fiscal_record_manual(:'inv1', null, '1543', 'c7c4c1225', '2026-10-25 10:49:31+03', '20261025');
select tests.check((select status = 'recorded' and verification_code = 'C7C4C1225' and receipt_no = '1543' and z_number = '20261025'
                           and verify_url = 'https://verify.tra.go.tz/C7C4C1225_104931' and entered_by = :'fin'
                      from public.fiscal_receipts where invoice_id = :'inv1'),
  'typed receipt: code in capitals, TRA link = code_HHMMSS of the receipt time');
select public.fiscal_record_manual(:'inv1', null, '1543', 'https://verify.tra.go.tz/9B8A7F6E5D_101500', '2026-10-25 10:15:00+03', null);
select tests.check((select verification_code = '9B8A7F6E5D' and verify_url = 'https://verify.tra.go.tz/9B8A7F6E5D_101500'
                      from public.fiscal_receipts where invoice_id = :'inv1'), 'a scanned TRA link is kept and its code taken from it');
select tests.check((select count(*) from public.fiscal_receipts where invoice_id = :'inv1') = 1, 'typing again corrects the same receipt');
-- An invoice issued before the settings: started by hand.
select public.fiscal_start(:'inv0') is not null as started \gset
select tests.check(:'started'::boolean and (select status from public.fiscal_receipts where invoice_id = :'inv0') = 'pending',
  'an older invoice gets its receipt when asked for');
reset role;

-- Who sees and who changes
select tests.login('sales.fx@g.test'); set role authenticated;
select tests.check((select count(*) from public.fiscal_receipts where company_id = :'co') = 2, 'sales see the receipts (they see invoices)');
select tests.blocked(format('select public.fiscal_record_manual(%L, null, %L, %L, now(), null)', :'inv1', '1', 'ABCD1234'), 'sales cannot type receipts');
select tests.check((select count(*) from public.fiscal_settings) = 0, 'sales do not see the TRA settings');
reset role;
select tests.login('store.fx@g.test'); set role authenticated;
select tests.check((select count(*) from public.fiscal_receipts) = 0, 'the warehouse sees no receipts');
reset role;
select tests.login('other.fx@g.test'); set role authenticated;
select tests.check((select count(*) from public.fiscal_receipts where company_id = :'co') = 0, 'another company sees nothing');
select tests.blocked(format('select public.fiscal_start(%L)', :'inv1'), 'another company cannot start a receipt');
reset role;
select tests.login('fin.fx@g.test'); set role authenticated;
select tests.blocked(format('update public.fiscal_receipts set verification_code = %L where invoice_id = %L', 'HACK1234', :'inv1'),
  'receipts are never changed directly');
select tests.blocked(format('insert into public.fiscal_receipts (company_id, invoice_id, mode) values (%L, %L, %L)', :'co', :'inv1', 'manual'),
  'receipts are never added directly');
select tests.blocked('select * from public.fiscal_secrets', 'nobody in the app reads the TRA secrets');
select tests.blocked('select public.fiscal_claim(5)', 'only the server claims the queue');
select tests.blocked(format('select public.fiscal_vfd_config(%L)', :'co'), 'only the server reads the VFD set-up');
select tests.blocked(format('select public.fiscal_result(%L, %L, true, %L, null, null)', 'receipt', gen_random_uuid(), '0'), 'only the server reports TRA answers');
reset role;

-- ---- 5. VFD mode: registration, queue, counters, retries ---------------------------------------------------
select tests.login('boss.fx@g.test'); set role authenticated;
select public.fiscal_save_settings(:'co', '{"mode": "vfd", "tin": "111222333", "cert_serial": "3d5e7f", "vfd_serial": "10TZ101807", "environment": "test"}');
reset role;
select tests.login('fin.fx@g.test'); set role authenticated;
select tests.new_invoice(:'co', :'client', 500000) as inv2 \gset
reset role;
select tests.check((select status = 'pending' and mode = 'vfd' from public.fiscal_receipts where invoice_id = :'inv2'),
  'VFD before registration: the receipt waits');

set role service_role;
select public.fiscal_save_registration(:'co', '{"reg_id": "TZ0100553", "uin": "09VFDWEBAPI-1", "receipt_code": "8F2B1A", "tax_office": "Ilala",
                                               "routing_key": "vfdrct", "username": "babaabc", "password": "secret-pw", "gc": 100}');
select tests.check((select status = 'queued' from public.fiscal_receipts where invoice_id = :'inv2'), 'registration sends waiting receipts to the queue');
select tests.check((public.fiscal_vfd_config(:'co') -> 'secrets' ->> 'vfd_password') = 'secret-pw', 'the server reads the secrets');
select public.fiscal_claim(10) as jobs \gset
select tests.check(jsonb_array_length(:'jobs'::jsonb) = 1, 'one job in the queue');
select tests.check((:'jobs'::jsonb -> 0 -> 'receipt' ->> 'gc')::int = 101 and (:'jobs'::jsonb -> 0 -> 'receipt' ->> 'dc')::int = 1
                   and :'jobs'::jsonb -> 0 -> 'receipt' ->> 'verification_code' = '8F2B1A101'
                   and :'jobs'::jsonb -> 0 -> 'receipt' ->> 'z_number' = to_char(public.fiscal_today(), 'YYYYMMDD'),
  'counters: global 101 after TRA''s 100, day counter 1, code = receipt code + counter, Z number = today');
select tests.check(:'jobs'::jsonb -> 0 -> 'client' ->> 'tin' = '100200300' and :'jobs'::jsonb -> 0 -> 'client' ->> 'phone' = '255754111222'
                   and (:'jobs'::jsonb -> 0 -> 'lines' -> 0 ->> 'amount')::numeric = 590000
                   and (:'jobs'::jsonb -> 0 -> 'invoice' ->> 'total')::numeric = 590000,
  'the job has the client TIN, phone and the VAT-inclusive line amounts');
select tests.check(jsonb_array_length(public.fiscal_claim(10)) = 0, 'a receipt being posted is not handed out twice');
select (:'jobs'::jsonb -> 0 -> 'receipt' ->> 'id') as r2 \gset
select public.fiscal_result('receipt', :'r2', false, '7', 'Invalid signature', 'TRA said: Invalid signature');
select tests.check((select status = 'failed' and attempts = 1 and next_attempt_at > now() and last_error like '%Invalid signature%'
                      from public.fiscal_receipts where id = :'r2'), 'a failed post is kept with the error and retried later');
select tests.check(jsonb_array_length(public.fiscal_claim(10)) = 0, 'not before its retry time');
reset role;
select tests.login('fin.fx@g.test'); set role authenticated;
select public.fiscal_retry(:'r2');
reset role;
set role service_role;
select public.fiscal_claim(10) as jobs \gset
select tests.check((:'jobs'::jsonb -> 0 -> 'receipt' ->> 'gc')::int = 101, 'a retry keeps the same receipt number');
select public.fiscal_result('receipt', :'r2', true, '0', 'Success', null);
select tests.check((select status = 'posted' and posted_at is not null and verify_url ~ '^https://verify\.tra\.go\.tz/8F2B1A101_[0-9]{6}$'
                      from public.fiscal_receipts where id = :'r2'), 'accepted: posted with its TRA link');
reset role;
select tests.login('fin.fx@g.test'); set role authenticated;
select tests.blocked(format('select public.fiscal_record_manual(%L, null, %L, %L, now(), null)', :'inv2', '1', 'ABCD1234'),
  'a receipt TRA accepted cannot be typed over');
select tests.new_invoice(:'co', :'client', 200000) as inv3 \gset
select tests.check((select status from public.fiscal_receipts where invoice_id = :'inv3') = 'queued', 'once registered, new invoices go straight to the queue');
reset role;
set role service_role;
select tests.check((public.fiscal_claim(10) -> 0 -> 'receipt' ->> 'gc')::int = 102, 'the next receipt gets 102');
reset role;
-- A queued receipt of a cancelled invoice is dropped.
select tests.login('fin.fx@g.test'); set role authenticated;
insert into public.invoices (company_id, client_id) values (:'co', :'client') returning id as inv4 \gset
insert into public.invoice_lines (company_id, invoice_id, description, quantity, unit_price) values (:'co', :'inv4', 'Gloves', 1, 1000);
select public.issue_invoice(:'inv4');
reset role;
select tests.login('boss.fx@g.test'); set role authenticated;
select public.cancel_invoice(:'inv4', 'Wrong client');
reset role;
select tests.check((select status = 'void' from public.fiscal_receipts where invoice_id = :'inv4'), 'cancelling an invoice voids its unsent receipt');
-- After 10 failures management is told.
update public.fiscal_receipts set attempts = 9, status = 'posting' where invoice_id = :'inv3';
set role service_role;
select public.fiscal_result('receipt', (select id from public.fiscal_receipts where invoice_id = :'inv3'), false, null, null, 'timeout');
reset role;
select tests.check((select count(*) from public.notifications where company_id = :'co' and kind = 'fiscal_failed') >= 2,
  'after 10 failed tries management and finance are told');
-- Z report for yesterday's posted receipts.
update public.fiscal_receipts set receipt_at = now() - interval '1 day' where id = :'r2';
set role service_role;
select public.fiscal_claim(10) as jobs \gset
reset role;
select tests.check(exists (select 1 from jsonb_array_elements(:'jobs'::jsonb) j where j ->> 'job' = 'zreport'
                             and (j -> 'zreport' ->> 'total_incl')::numeric = 590000),
  'yesterday''s posted receipts make a Z report job');
select id as z1 from public.fiscal_zreports where company_id = :'co' \gset
set role service_role;
select public.fiscal_result('zreport', :'z1', true, '0', 'Success', null);
reset role;
select tests.check((select status from public.fiscal_zreports where id = :'z1') = 'posted', 'Z report posted');
-- Changing the certificate clears the registration.
select tests.login('boss.fx@g.test'); set role authenticated;
select public.fiscal_save_settings(:'co', '{"mode": "vfd", "tin": "111222333", "cert_serial": "99aa", "vfd_serial": "10TZ101807", "environment": "test"}');
reset role;
select tests.check((select reg_id is null from public.fiscal_settings where company_id = :'co')
                   and not exists (select 1 from public.fiscal_secrets where company_id = :'co'),
  'a new certificate clears the registration and the secrets');
select tests.login('boss.fx@g.test'); set role authenticated;
select public.fiscal_save_settings(:'co', '{"mode": "manual", "tin": "111222333"}');
reset role;

-- ---- 6. Credit notes ---------------------------------------------------------------------------------------
select tests.login('sales.fx@g.test'); set role authenticated;
select tests.blocked(format('select public.issue_credit_note(%L, 1000, %L, null)', :'inv1', 'Damaged'), 'sales cannot issue credit notes');
reset role;
select tests.login('fin.fx@g.test'); set role authenticated;
select tests.check(tests.bal(:'co', 'receivable') >= 0, 'books are readable');
select tests.bal(:'co', 'receivable') as ar0 \gset
select tests.bal(:'co', 'sales_goods') as sg0 \gset
select tests.bal(:'co', 'vat_output') as vat0 \gset
select tests.blocked(format('select public.issue_credit_note(%L, 2000000, %L, null)', :'inv1', 'Too much'), 'never more than is owed');
select tests.blocked(format('select public.issue_credit_note(%L, 1000, %L, null)', :'inv1', ''), 'a reason is needed');
select public.issue_credit_note(:'inv1', 118000, 'One drum damaged', null) as cn1 \gset
select tests.check((select number ~ '^CN-[0-9]{4}-0001$' and amount = 118000 and vat_amount = 18000 from public.credit_notes where id = :'cn1'),
  'credit note CN-YYYY-0001 of 118,000 with 18,000 VAT');
select tests.check((select amount_paid = 118000 and status = 'partly_paid' from public.invoices where id = :'inv1'), 'the invoice now owes 1,062,000');
select tests.check((select method = 'credit_note' and reference = (select number from public.credit_notes where id = :'cn1')
                      from public.payments where id = (select payment_id from public.credit_notes where id = :'cn1')),
  'kept as a credit-note settlement with the CN number');
reset role;
select tests.check(tests.bal(:'co', 'receivable') = :ar0 - 118000 and tests.bal(:'co', 'sales_goods') = :sg0 + 100000
                   and tests.bal(:'co', 'vat_output') = :vat0 + 18000 and tests.bal(:'co', 'bank') = 0 and tests.bal(:'co', 'cash') = 0,
  'books: sales down 100,000, VAT down 18,000, clients owe 118,000 less, no money moved');
select tests.check(not exists (select 1 from public.notifications where company_id = :'co' and kind = 'payment_received'
                                 and body like '%118,000%'), 'no "payment received" alert for a credit note');
select tests.check((select status = 'pending' and kind = 'credit_note' and total_incl = -118000 and vat_amount = -18000
                      from public.fiscal_receipts where credit_note_id = :'cn1'), 'the credit note waits for its fiscal receipt (negative totals)');
select tests.login('fin.fx@g.test'); set role authenticated;
select public.fiscal_record_manual(:'inv1', :'cn1', '1544', 'CN77AB12', '2026-10-25 11:00:00+03', null);  -- same day as the invoice's receipt (the daily totals below)
select tests.check((select status from public.fiscal_receipts where credit_note_id = :'cn1') = 'recorded', 'credit note receipt typed');
select public.issue_credit_note(:'inv1', 59000, 'Price corrected', null) as cn2 \gset
select tests.blocked(format('select public.cancel_credit_note(%L, %L)', :'cn2', 'Mistake'), 'finance cannot cancel a credit note');
reset role;
select tests.login('boss.fx@g.test'); set role authenticated;
select tests.blocked(format('select public.cancel_credit_note(%L, %L)', :'cn1', 'Mistake'), 'a credit note TRA has cannot be cancelled');
select public.cancel_credit_note(:'cn2', 'Entered twice');
select tests.check((select amount_paid = 118000 from public.invoices where id = :'inv1')
                   and (select status = 'cancelled' from public.credit_notes where id = :'cn2')
                   and (select voided_at is not null from public.payments where id = (select payment_id from public.credit_notes where id = :'cn2'))
                   and (select status = 'void' from public.fiscal_receipts where credit_note_id = :'cn2'),
  'cancelled: the invoice owes it again, the settlement is voided and its receipt dropped');
select public.gl_check(:'co') as chk \gset
select tests.check((:'chk'::jsonb ->> 'balanced')::boolean and (:'chk'::jsonb ->> 'issues')::int = 0
                   and (:'chk'::jsonb ->> 'receivable_books')::numeric = (:'chk'::jsonb ->> 'receivable_documents')::numeric,
  'the books balance and clients match the open invoices after credit notes');
reset role;

-- ---- 7. Daily totals ----------------------------------------------------------------------------------------
select tests.login('fin.fx@g.test'); set role authenticated;
-- The receipt is dated 2026-10-25 and the credit note today (Dar date), so sum the days in between.
select tests.check((select sum(receipts) = 1 and sum(credit_notes) = 1 and sum(total_incl) = 1180000 - 118000 and sum(typed) = 2
                      from public.fiscal_daily_totals(:'co', '2026-10-25', greatest(date '2026-10-25', (now() at time zone 'Africa/Dar_es_Salaam')::date))),
  'daily totals from the receipt day: 1 receipt, 1 credit note, net 1,062,000');
reset role;
select tests.login('sales.fx@g.test'); set role authenticated;
select tests.blocked(format('select * from public.fiscal_daily_totals(%L, null, null)', :'co'), 'sales do not see the daily totals');
reset role;

-- ---- 8. Feature off: no receipts --------------------------------------------------------------------------------
select tests.login('boss.fx@g.test'); set role authenticated;
select public.set_company_feature(:'co', 'tra_fiscal', false);
reset role;
select tests.login('fin.fx@g.test'); set role authenticated;
select tests.new_invoice(:'co', :'client', 1000) as inv5 \gset
reset role;
select tests.check(not exists (select 1 from public.fiscal_receipts where invoice_id = :'inv5'), 'feature off: no receipt is opened');
select tests.login('boss.fx@g.test'); set role authenticated;
select public.set_company_feature(:'co', 'tra_fiscal', null);
reset role;

-- ---- 9. Grants -----------------------------------------------------------------------------------------------------
select tests.check(not has_function_privilege('anon', 'public.fiscal_claim(integer)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.fiscal_claim(integer)', 'EXECUTE')
                   and has_function_privilege('service_role', 'public.fiscal_claim(integer)', 'EXECUTE')
                   and has_function_privilege('service_role', 'public.fiscal_result(text, uuid, boolean, text, text, text)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.issue_credit_note(uuid, numeric, text, date)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.fiscal_open_for_invoice(uuid)', 'EXECUTE')
                   and not has_table_privilege('authenticated', 'public.fiscal_secrets', 'SELECT')
                   and not has_table_privilege('anon', 'public.fiscal_receipts', 'SELECT'),
  'grants: the queue and secrets are for the server only; nothing for anonymous visitors');

drop function tests.new_invoice(uuid, uuid, numeric);
