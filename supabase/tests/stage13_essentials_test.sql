-- Tests for Stage 13: expenses, receipt photos, mobile money, checking against statements,
-- follow-ups and reminders, demos.
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

insert into auth.users (email) values ('m13@e.test'), ('f13@e.test'), ('s13@e.test'), ('d13@e.test'), ('p13@e.test'), ('x13@o.test');
insert into auth.users (is_anonymous) values (true) returning id as g13 \gset
select id as m13 from auth.users where email = 'm13@e.test' \gset
select id as s13 from auth.users where email = 's13@e.test' \gset
select id as d13 from auth.users where email = 'd13@e.test' \gset

select tests.login('m13@e.test'); set role authenticated;
select public.create_company('Exp Co') as cid \gset
select public.invite_member(:'cid', 'f13@e.test', 'finance');
select public.invite_member(:'cid', 's13@e.test', 'sales');
select public.invite_member(:'cid', 'd13@e.test', 'driver');
select public.invite_member(:'cid', 'p13@e.test', 'procurement');
insert into public.clients (company_id, name) values (:'cid', 'Sugar Mill Ltd') returning id as client \gset
insert into public.suppliers (company_id, name) values (:'cid', 'Lube Traders') returning id as sup \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'GRS', 'Grease', 'pail', 200000) returning id as grs \gset
reset role;
select tests.login('f13@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('s13@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('d13@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('p13@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('x13@o.test'); set role authenticated; select public.create_company('Other Exp Co') as other \gset
reset role;

-- ---- Categories -----------------------------------------------------------
select tests.check((select count(*) from public.expense_categories where company_id = :'cid') = 13, 'new company starts with 13 expense categories');
select tests.check(not exists (select 1 from public.audit_log where company_id = :'cid' and entity = 'expense_categories'),
                   'starting categories are not written to the Activity log');
select id as fuel from public.expense_categories where company_id = :'cid' and name = 'Transport & fuel' \gset
select id as rent from public.expense_categories where company_id = :'cid' and name = 'Rent' \gset
select id as other_cat from public.expense_categories where company_id = :'other' and name = 'Rent' \gset

select tests.login('s13@e.test'); set role authenticated;
select tests.blocked(format('insert into public.expense_categories (company_id, name) values (%L, %L)', :'cid', 'Gifts'), 'sales cannot add categories');
reset role;
select tests.login('f13@e.test'); set role authenticated;
insert into public.expense_categories (company_id, name) values (:'cid', 'Generator diesel');
select tests.blocked(format('insert into public.expense_categories (company_id, name) values (%L, %L)', :'cid', ' rent '), 'category names are unique (ignoring case and spaces)');
reset role;

-- ---- Expenses ---------------------------------------------------------------
select tests.login('f13@e.test'); set role authenticated;
insert into public.expenses (company_id, category_id, spent_on, payee, description, amount, vat_amount, method, provider, reference)
values (:'cid', :'rent', current_date - 3, 'Landlord', 'Office rent', 500000, 0, 'bank_transfer', 'mpesa', 'TRF889911')
returning id as e1 \gset
select tests.check((select number like 'EXP-____-0001' and currency = 'TZS' and exchange_rate = 1 and provider is null
                      from public.expenses where id = :'e1'), 'expense numbered, base currency, no service unless mobile money');
select tests.blocked(format('insert into public.expenses (company_id, category_id, description, amount, vat_amount) values (%L, %L, %L, 100, 200)',
                            :'cid', :'rent', 'Bad VAT'), 'VAT part cannot exceed the amount');
select tests.blocked(format('insert into public.expenses (company_id, category_id, description, amount, method, provider) values (%L, %L, %L, 100, %L, %L)',
                            :'cid', :'rent', 'Bad service', 'mobile_money', 'paypal'), 'unknown mobile-money service refused');
select tests.blocked(format('insert into public.expenses (company_id, category_id, description, amount) values (%L, %L, %L, 100)',
                            :'cid', :'other_cat', 'Wrong company category'), 'category of another company refused');
select tests.blocked(format('insert into public.expenses (company_id, category_id, description, amount, voided_at) values (%L, %L, %L, 100, now())',
                            :'cid', :'rent', 'Sneaky'), 'cannot insert a voided expense');
reset role;

select tests.login('d13@e.test'); set role authenticated;
insert into public.expenses (company_id, category_id, description, amount, method, provider, reference)
values (:'cid', :'fuel', 'Fuel for delivery', 80000, 'mobile_money', 'tigopesa', 'MP230925.1130.F12345')
returning id as e2 \gset
select tests.check((select created_by from public.expenses where id = :'e2') = :'d13',
                   'driver can record their own expense');
select tests.check((select count(*) from public.expenses where company_id = :'cid') = 1, 'driver sees only their own expenses');
update public.expenses set amount = 85000 where id = :'e2';
select tests.check((select amount from public.expenses where id = :'e2') = 85000, 'driver can correct their own expense');
reset role;

select tests.login('s13@e.test'); set role authenticated;
select tests.check((select count(*) from public.expenses where company_id = :'cid') = 0, 'sales sees none of the others'' expenses');
select tests.no_rows(format('update public.expenses set amount = 1 where id = %L', :'e1'), 'sales cannot change someone else''s expense');
select tests.blocked(format('select public.void_expense(%L, %L)', :'e2', 'x'), 'sales cannot void expenses');
reset role;

select tests.login('x13@o.test'); set role authenticated;
select tests.check((select count(*) from public.expenses where company_id = :'cid') = 0, 'another company sees no expenses');
select tests.blocked(format('insert into public.expenses (company_id, category_id, description, amount) values (%L, %L, %L, 100)',
                            :'cid', :'rent', 'Intruder'), 'outsider cannot add expenses');
reset role;

select tests.login('f13@e.test'); set role authenticated;
select tests.check((select count(*) from public.expenses where company_id = :'cid') = 2, 'finance sees every expense');
select tests.blocked(format('update public.expenses set reconciled_at = now() where id = %L', :'e1'), 'checked cannot be typed in');
reset role;

-- ---- Receipt photos -----------------------------------------------------------
select tests.login('d13@e.test'); set role authenticated;
insert into storage.objects (bucket_id, name) values ('receipts', :'cid' || '/' || :'e2' || '/receipt-1.jpg');
update public.expenses set receipt_path = :'cid' || '/' || :'e2' || '/receipt-1.jpg' where id = :'e2';
select tests.check((select receipt_path is not null from public.expenses where id = :'e2'), 'creator attaches a receipt photo');
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'receipts', :'cid' || '/' || :'e1' || '/x.jpg'),
                     'cannot upload to an expense you cannot see');
select tests.blocked(format('update public.expenses set receipt_path = %L where id = %L', :'cid' || '/' || :'e2' || '/missing.jpg', :'e2'),
                     'receipt must exist in storage');
select tests.blocked(format('update public.expenses set receipt_path = %L where id = %L', :'cid' || '/' || :'e1' || '/receipt-1.jpg', :'e2'),
                     'receipt must be in this expense''s own folder');
reset role;
select tests.login('s13@e.test'); set role authenticated;
select tests.check((select count(*) from storage.objects where bucket_id = 'receipts') = 0, 'others cannot see the receipt file');
reset role;
select tests.login('m13@e.test'); set role authenticated;
select tests.check((select count(*) from storage.objects where bucket_id = 'receipts') = 1, 'management can see the receipt file');
reset role;

-- ---- Void -----------------------------------------------------------------------
select tests.login('f13@e.test'); set role authenticated;
select tests.blocked(format('select public.void_expense(%L, %L)', :'e2', ''), 'voiding needs a reason');
select public.void_expense(:'e2', 'Entered twice');
select tests.check((select voided_at is not null and void_reason = 'Entered twice' from public.expenses where id = :'e2'), 'finance voids an expense');
select tests.blocked(format('update public.expenses set amount = 1 where id = %L', :'e2'), 'voided expense is frozen');
reset role;
select tests.login('d13@e.test'); set role authenticated;
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'receipts', :'cid' || '/' || :'e2' || '/r2.jpg'),
                     'no new receipts on a voided expense');
reset role;

-- ---- Mobile money and checking ---------------------------------------------------
select tests.login('m13@e.test'); set role authenticated;
select public.create_quotation(:'cid', :'client', null) as q \gset
insert into public.quotation_lines (company_id, quotation_id, product_id, description, quantity, unit, unit_price)
values (:'cid', :'q', :'grs', 'Grease', 5, 'pail', 200000);
select public.submit_quotation(:'q');
select public.record_quotation_outcome(:'q', true, 'PO 77');
reset role;
select tests.login('f13@e.test'); set role authenticated;
select public.create_invoice(:'cid', null, :'q', null) as inv \gset
select public.issue_invoice(:'inv');
select public.record_payment(:'inv', current_date, 300000, 'mobile_money', 'QK7 1ABC2D', null, null, 'mpesa') as pay1 \gset
select public.record_payment(:'inv', current_date, 100000, 'cash', 'R-1', null, null, 'mpesa') as pay2 \gset
select tests.check((select provider from public.payments where id = :'pay1') = 'mpesa', 'payment keeps the mobile-money service');
select tests.check((select provider from public.payments where id = :'pay2') is null, 'service ignored for cash');
select public.record_payment(:'inv', current_date, 50000, 'bank_transfer', null, null, null) as pay3 \gset
select tests.check(:'pay3' is not null, 'old seven-value call still works');
select tests.blocked(format('select public.record_payment(%L, current_date, 1, %L, null, null, null, %L)', :'inv', 'mobile_money', 'venmo'),
                     'unknown service refused on payments');
reset role;

select tests.login('s13@e.test'); set role authenticated;
select tests.blocked(format('select public.set_reconciled(%L, %L, array[%L]::uuid[], true)', :'cid', 'payment', :'pay1'), 'sales cannot tick payments');
select tests.blocked(format('select public.match_statement(%L, null, null, null, %L)', :'cid', 'QK71ABC2D'), 'sales cannot match statements');
reset role;

select tests.login('f13@e.test'); set role authenticated;
select (public.match_statement(:'cid', 'mobile_money', current_date - 30, current_date,
        E'Receipt No.,Completion Time,Details,Paid In\nqk71abc2d,2026-10-01 10:12,Payment from SUGAR MILL,300000\nZZ99XX11,2026-10-01,Other,5')) as m1 \gset
select tests.check((:'m1'::jsonb ->> 'matched')::int = 1, 'statement match finds the M-Pesa code (spaces and case ignored)');
select tests.check((select reconciled_at is not null and reconciled_by is not null from public.payments where id = :'pay1'), 'matched payment is ticked');
select tests.check((public.match_statement(:'cid', 'mobile_money', null, null, 'QK71ABC2D') ->> 'matched')::int = 0, 'already ticked is not matched again');
select tests.check(public.set_reconciled(:'cid', 'expense', array[:'e1']::uuid[], true) = 1, 'finance ticks an expense');
select tests.blocked(format('update public.expenses set amount = 1 where id = %L', :'e1'), 'checked expense amount is frozen');
update public.expenses set description = 'Office rent October' where id = :'e1';
select tests.check((select description from public.expenses where id = :'e1') = 'Office rent October', 'description can still be corrected');
select tests.check(public.set_reconciled(:'cid', 'expense', array[:'e1']::uuid[], false) = 1, 'untick');
update public.expenses set amount = 510000 where id = :'e1';
select tests.check((select amount from public.expenses where id = :'e1') = 510000, 'unticked expense can be changed');
select tests.check(public.set_reconciled(:'cid', 'expense', array[:'e2']::uuid[], true) = 0, 'voided expenses are never ticked');
reset role;
select tests.login('x13@o.test'); set role authenticated;
select tests.blocked(format('select public.set_reconciled(%L, %L, array[%L]::uuid[], true)', :'cid', 'payment', :'pay1'), 'outsider cannot tick');
reset role;

-- ---- Mobile-money pay numbers need a recent sign-in ---------------------------------
select tests.login('m13@e.test'); set role authenticated;
select tests.blocked(format('update public.companies set mobile_money_details = %L where id = %L', 'M-Pesa 999', :'cid'),
                     'changing pay numbers needs "confirm it is you"');
reset role;
select tests.login_recent('m13@e.test'); set role authenticated;
update public.companies set mobile_money_details = 'M-Pesa Lipa namba 123456', quote_followup_days = 2,
                            invoice_remind_before_days = 5, invoice_overdue_every_days = 10 where id = :'cid';
select tests.check((select mobile_money_details from public.companies where id = :'cid') = 'M-Pesa Lipa namba 123456', 'pay numbers saved after confirming');
select tests.blocked(format('update public.companies set invoice_overdue_every_days = 0 where id = %L', :'cid'), 'reminder interval at least 1 day');
reset role;

-- ---- Follow-ups --------------------------------------------------------------------------
select tests.login('s13@e.test'); set role authenticated;
select public.create_quotation(:'cid', :'client', null) as q2 \gset
insert into public.quotation_lines (company_id, quotation_id, product_id, description, quantity, unit, unit_price)
values (:'cid', :'q2', :'grs', 'Grease', 2, 'pail', 200000);
select public.submit_quotation(:'q2');
reset role;
select tests.login('m13@e.test'); set role authenticated;
select public.review_quotation(:'q2', true, 'OK');
reset role;
select tests.login('s13@e.test'); set role authenticated;
select public.mark_quotation_sent(:'q2');
reset role;
-- Sent 3 days ago, follow up every 2 days: due.
update public.quotations set sent_at = now() - interval '3 days' where id = :'q2';
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where user_id = :'s13' and kind = 'quote_followup') = 1,
                   'salesperson reminded to follow up the quotation');
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where user_id = :'s13' and kind = 'quote_followup') = 1, 'reminded once');

select tests.login('p13@e.test'); set role authenticated;
select tests.blocked(format('select public.log_followup(%L, null, %L, %L, null)', :'q2', 'call', 'x'), 'procurement cannot log quotation follow-ups');
reset role;
select tests.login('s13@e.test'); set role authenticated;
select tests.blocked(format('select public.log_followup(%L, null, %L, %L, current_date - 1)', :'q2', 'call', 'x'), 'next date cannot be in the past');
select tests.blocked(format('select public.log_followup(%L, null, %L, %L, null)', :'q2', 'pigeon', 'x'), 'unknown channel refused');
select public.log_followup(:'q2', null, 'whatsapp', 'Buyer will confirm on Friday', current_date + 4);
select tests.check((select count(*) from public.followups where quotation_id = :'q2') = 1, 'follow-up logged');
select tests.check((select read_at is not null from public.notifications where user_id = :'s13' and kind = 'quote_followup'), 'reminder marked read');
select tests.blocked('insert into public.followups (company_id, quotation_id, channel) values ('''
                     || :'cid' || ''', ''' || :'q2' || ''', ''call'')', 'follow-ups only through the app');
reset role;
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where user_id = :'s13' and kind = 'quote_followup') = 1,
                   'no new reminder before the next follow-up date');

-- Invoices: due soon, overdue, promised payment.
select tests.login('f13@e.test'); set role authenticated;
select public.create_invoice(:'cid', :'client', null, null) as inv2 \gset
insert into public.invoice_lines (company_id, invoice_id, description, quantity, unit_price) values (:'cid', :'inv2', 'Service', 1, 100000);
select public.issue_invoice(:'inv2');
reset role;
set ims.status_change = 'on';
update public.invoices set due_date = current_date + 4 where id = :'inv2';
reset ims.status_change;
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where kind = 'invoice_due' and link like '/invoices/' || :'inv2' || '%') = 2,
                   'finance and management told the invoice is due soon');
set ims.status_change = 'on';
update public.invoices set due_date = current_date - 12 where id = :'inv2';
reset ims.status_change;
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where kind = 'invoice_overdue' and dedupe_key = 'inv-od-' || :'inv2' || '-11') = 2,
                   'overdue reminder uses the company interval (every 10 days: step at day 11)');
select tests.login('s13@e.test'); set role authenticated;
select public.log_followup(null, :'inv2', 'call', 'Will pay on Monday', current_date + 2);
reset role;
set ims.status_change = 'on';
update public.invoices set due_date = current_date - 21 where id = :'inv2';
reset ims.status_change;
select public.run_company_alerts(:'cid');
select tests.check(not exists (select 1 from public.notifications where dedupe_key = 'inv-od-' || :'inv2' || '-21'),
                   'reminders pause until the promised payment date');
update public.followups set next_on = current_date - 1 where invoice_id = :'inv2';
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where dedupe_key like 'inv-promise-' || :'inv2' || '%') = 2,
                   'broken promise is reported');
select tests.check((select count(*) from public.notifications where dedupe_key = 'inv-od-' || :'inv2' || '-21') = 2,
                   'reminders resume after the promised date');
select tests.login('f13@e.test'); set role authenticated;
select public.record_payment(:'inv2', current_date, 118000, 'cash', null, null, null);
select tests.blocked(format('select public.log_followup(null, %L, %L, null, null)', :'inv2', 'call'), 'no follow-ups on a paid invoice');
reset role;

-- ---- Feature catalogue -----------------------------------------------------------------
select tests.login('m13@e.test'); set role authenticated;
select tests.check((select bool_and(enabled) from public.company_feature_map(:'cid')
                     where key in ('expenses', 'simple_pl', 'statements', 'mobile_money', 'reminders')) = true,
                   'Stage 13 features are live and on');
reset role;

-- ---- Reset before go-live ----------------------------------------------------------------
select public.reset_company_transactions(:'cid', 'Exp Co');
select tests.check(not exists (select 1 from public.expenses where company_id = :'cid')
                   and not exists (select 1 from public.followups where company_id = :'cid'), 'reset clears expenses and follow-ups');
select tests.check((select count(*) from public.expense_categories where company_id = :'cid') = 14, 'reset keeps the categories');

-- ---- Demo ------------------------------------------------------------------------------------
select tests.login_guest(:'g13'); set role authenticated;
select public.create_demo_company('small') as demo \gset
select tests.check((select count(*) from public.expenses where company_id = :'demo') >= 10, 'small demo has expenses');
select tests.check(not exists (select 1 from public.expenses where company_id = :'demo' and spent_on > current_date), 'no expenses in the future');
select tests.check((select mobile_money_details is not null from public.companies where id = :'demo'), 'demo prints mobile-money pay numbers');
select tests.check(not exists (select 1 from public.payments where company_id = :'demo' and method = 'mobile_money' and provider is null),
                   'demo mobile-money payments have a service');
select sum(amount) as small_spend from public.expenses where company_id = :'demo' \gset
select public.switch_demo_level('enterprise') as demo2 \gset
select tests.check((select sum(amount) from public.expenses where company_id = :'demo2') > 10 * :small_spend, 'bigger demo spends more');
reset role;

\echo ALL STAGE 13 TESTS PASSED
