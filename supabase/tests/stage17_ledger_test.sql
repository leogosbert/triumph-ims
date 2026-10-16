-- Tests for the general ledger: automatic posting, corrections, closing, fixed assets and reports.
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
-- Balance of an account by its system key (debit positive).
create or replace function tests.bal(p_company uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.gl_lines l join public.gl_accounts a on a.id = l.account_id
   where a.company_id = p_company and a.system_key = p_key;
$$;
grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (email) values ('boss.gl@g.test'), ('fin.gl@g.test'), ('sales.gl@g.test'), ('other.gl@g.test');
select id as boss from auth.users where email = 'boss.gl@g.test' \gset
select id as fin from auth.users where email = 'fin.gl@g.test' \gset

select tests.login('boss.gl@g.test'); set role authenticated;
select public.create_company('Ledger Co') as co \gset
reset role;
select tests.login('other.gl@g.test'); set role authenticated;
select public.create_company('Other Ledger Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
select :'co', id, r::public.app_role from (values ('fin.gl@g.test', 'finance'), ('sales.gl@g.test', 'sales')) v(e, r)
  join auth.users u on u.email = v.e;

select tests.check((select count(*) from public.gl_accounts where company_id = :'co') >= 36, 'a new company gets the standard chart of accounts');

insert into public.clients (company_id, name) values (:'co', 'Geita Mine') returning id as client \gset
insert into public.suppliers (company_id, name, currency) values (:'co', 'Lube Imports', 'USD') returning id as sup \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'co', 'OIL', 'Hydraulic oil', 'drum', 1000000) returning id as oil \gset
insert into public.products (company_id, sku, name, unit, item_type) values (:'co', 'INST', 'Installation', 'job', 'service') returning id as inst \gset
insert into public.product_costs (product_id, company_id, last_cost) values (:'oil', :'co', 700000);
insert into public.exchange_rates (company_id, currency, rate) values (:'co', 'USD', 2600);

-- ---- 1. Invoice: sales, VAT, cost of goods -------------------------------------------------------
select tests.login('fin.gl@g.test'); set role authenticated;
insert into public.invoices (company_id, client_id) values (:'co', :'client') returning id as inv \gset
insert into public.invoice_lines (company_id, invoice_id, product_id, description, quantity, unit_price)
values (:'co', :'inv', :'oil', 'Hydraulic oil', 2, 1000000), (:'co', :'inv', :'inst', 'Installation', 1, 500000);
select tests.check(tests.bal(:'co', 'receivable') = 0, 'a draft invoice is not in the books');
select public.issue_invoice(:'inv');
reset role;
select tests.check(tests.bal(:'co', 'receivable') = 2950000, 'issued: clients owe 2,950,000 (2,500,000 + 18% VAT)');
select tests.check(tests.bal(:'co', 'sales_goods') = -2000000 and tests.bal(:'co', 'sales_services') = -500000,
  'sales split into goods 2,000,000 and services 500,000');
select tests.check(tests.bal(:'co', 'vat_output') = -450000, 'VAT output 450,000');
select tests.check(tests.bal(:'co', 'cost_of_sales') = 1400000 and tests.bal(:'co', 'inventory') = -1400000,
  'cost of the 2 drums (700,000 each) moves from stock to cost of sales');
select tests.check((select count(*) from public.gl_journals where source = 'invoices' and source_id = :'inv') = 1, 'one journal for the invoice');

-- ---- 2. Payments, including withholding tax and a void --------------------------------------------
select tests.login('fin.gl@g.test'); set role authenticated;
select public.record_payment(:'inv', current_date, 2000000, 'bank_transfer', 'CRDB 1', null, null) as pay1 \gset
select public.record_payment(:'inv', current_date, 50000, 'withholding_tax', 'WHT cert 9', null, null) as pay2 \gset
reset role;
select tests.check(tests.bal(:'co', 'bank') = 2000000 and tests.bal(:'co', 'wht_receivable') = 50000
                   and tests.bal(:'co', 'receivable') = 900000,
  'payments: bank 2,000,000, withholding tax 50,000, clients still owe 900,000');
select tests.login('boss.gl@g.test'); set role authenticated;
select public.void_payment(:'pay1', 'Bounced');
reset role;
select tests.check(tests.bal(:'co', 'bank') = 0 and tests.bal(:'co', 'receivable') = 2900000, 'a voided payment is reversed');
select tests.check((select count(*) from public.gl_journals where source = 'payments' and source_id = :'pay1') = 2
                   and (select count(*) from public.gl_journals where source = 'payments' and source_id = :'pay1' and reversed_by is not null) = 1,
  'the original entry stays, with its reversal');

-- ---- 3. Supplier bill in dollars, paid at another rate ---------------------------------------------
select tests.login('fin.gl@g.test'); set role authenticated;
insert into public.supplier_bills (company_id, supplier_id, supplier_invoice_no, currency, exchange_rate, subtotal, vat_amount)
values (:'co', :'sup', 'LI-1', 'USD', 2600, 1000, 180) returning id as bill \gset
reset role;
select tests.check(tests.bal(:'co', 'payable') = -3068000 and tests.bal(:'co', 'other_purchases') = 2600000
                   and tests.bal(:'co', 'vat_input') = 468000,
  'bill: suppliers 3,068,000, purchases 2,600,000, VAT input 468,000');
select tests.login('fin.gl@g.test'); set role authenticated;
select public.pay_supplier_bill(:'bill', current_date, 1180, 'bank_transfer', 'TT 1', 2650, null) as spay \gset
reset role;
select tests.check(tests.bal(:'co', 'payable') = 0, 'paid in full: nothing owed to the supplier');
select tests.check(tests.bal(:'co', 'bank') = -3127000 and tests.bal(:'co', 'fx_gain_loss') = 59000,
  'paid at 2,650: bank 3,127,000 out and an exchange loss of 59,000');

-- ---- 4. Expense goes to its category's own account --------------------------------------------------
select id as fuel from public.expense_categories where company_id = :'co' order by sort limit 1 \gset
select tests.login('fin.gl@g.test'); set role authenticated;
insert into public.expenses (company_id, category_id, description, amount, vat_amount, method)
values (:'co', :'fuel', 'Diesel for truck', 118000, 18000, 'cash') returning id as exp \gset
reset role;
select tests.check((select a.name = c.name and a.code ~ '^61' from public.expense_categories c join public.gl_accounts a on a.id = c.gl_account_id
                     where c.id = :'fuel'), 'the category gets its own 61xx account');
select tests.check(tests.bal(:'co', 'cash') = -118000 and tests.bal(:'co', 'vat_input') = 486000, 'expense: cash out, VAT input added');
select tests.login('boss.gl@g.test'); set role authenticated;
select public.void_expense(:'exp', 'Duplicate');
reset role;
select tests.check(tests.bal(:'co', 'cash') = 0, 'voided expense reversed');

-- ---- 5. Changes and cancellations -------------------------------------------------------------------
select tests.login('boss.gl@g.test'); set role authenticated;
insert into public.invoices (company_id, client_id) values (:'co', :'client') returning id as inv2 \gset
insert into public.invoice_lines (company_id, invoice_id, description, quantity, unit_price) values (:'co', :'inv2', 'Consulting', 1, 100000);
select public.issue_invoice(:'inv2');
select tests.check(tests.bal(:'co', 'receivable') = 3018000, 'second invoice posted');
select public.cancel_invoice(:'inv2', 'Wrong client');
reset role;
select tests.check(tests.bal(:'co', 'receivable') = 2900000, 'cancelled invoice reversed');
select tests.check((select count(*) from public.gl_journals where source = 'invoices' and source_id = :'inv2') = 2, 'posting and reversal kept');
select tests.check(not public.gl_sync('invoices', :'inv'), 'syncing again changes nothing');

-- ---- 6. Everything balances and matches the documents ------------------------------------------------
select tests.login('fin.gl@g.test'); set role authenticated;
select public.gl_check(:'co') as chk \gset
select tests.check((:'chk'::jsonb ->> 'balanced')::boolean and (:'chk'::jsonb ->> 'issues')::int = 0, 'debits equal credits, no posting problems');
select tests.check((:'chk'::jsonb ->> 'receivable_books')::numeric = (:'chk'::jsonb ->> 'receivable_documents')::numeric
                   and (:'chk'::jsonb ->> 'payable_books')::numeric = (:'chk'::jsonb ->> 'payable_documents')::numeric,
  'clients and suppliers in the books match the open invoices and bills');
select tests.check((select sum(closing) from public.gl_trial_balance(:'co', null, current_date)) = 0, 'trial balance adds up to zero');
select tests.check(public.gl_resync(:'co') = 0, 'posting everything again changes nothing');
reset role;

-- ---- 7. Manual journals and closing the books ---------------------------------------------------------
select tests.login('fin.gl@g.test'); set role authenticated;
select id as cap from public.gl_accounts where company_id = :'co' and system_key = 'capital' \gset
select id as bank from public.gl_accounts where company_id = :'co' and system_key = 'bank' \gset
select public.gl_manual_journal(:'co', current_date - 40, 'Opening bank balance',
  jsonb_build_array(jsonb_build_object('a', :'bank', 'd', 10000000), jsonb_build_object('a', :'cap', 'c', 10000000)), true) as open_j \gset
select tests.blocked(format('select public.gl_manual_journal(%L, current_date, %L, %L::jsonb, false)', :'co', 'Wrong',
  jsonb_build_array(jsonb_build_object('a', :'bank', 'd', 100), jsonb_build_object('a', :'cap', 'c', 90))), 'an unbalanced journal is refused');
select tests.blocked(format('select public.gl_manual_journal(%L, current_date, %L, %L::jsonb, false)', :'co', 'Other company',
  jsonb_build_array(jsonb_build_object('a', (select id from public.gl_accounts where company_id = :'other' limit 1), 'd', 100),
                    jsonb_build_object('a', :'cap', 'c', 100))), 'another company''s account is refused');
select tests.blocked(format('select public.gl_reverse_journal((select id from public.gl_journals where source = %L and source_id = %L limit 1))', 'invoices', :'inv'),
  'entries from documents cannot be reversed by hand');
select tests.blocked(format('select public.gl_close_books(%L, current_date - 1)', :'co'), 'finance cannot close the books');
insert into public.gl_accounts (company_id, code, name, type) values (:'co', '2310', 'Bank loan CRDB', 'liability');
select tests.blocked(format('update public.gl_accounts set active = false where id = %L', :'bank'), 'system accounts stay on');
select tests.blocked(format('insert into public.gl_lines (company_id, journal_id, account_id, debit) values (%L, %L, %L, 1)', :'co', :'open_j', :'bank'),
  'nobody writes lines directly');
reset role;

select tests.login('boss.gl@g.test'); set role authenticated;
select public.gl_close_books(:'co', current_date - 1);
reset role;
select tests.login('fin.gl@g.test'); set role authenticated;
select tests.blocked(format('select public.gl_manual_journal(%L, current_date - 5, %L, %L::jsonb, false)', :'co', 'Late',
  jsonb_build_array(jsonb_build_object('a', :'bank', 'd', 100), jsonb_build_object('a', :'cap', 'c', 100))), 'no journals in a closed period');
-- A payment dated in the closed period is still accepted; its entry lands on the first open day.
select public.record_payment(:'inv', current_date - 3, 100000, 'cash', null, null, null) as pay3 \gset
select tests.check((select entry_date from public.gl_journals where source = 'payments' and source_id = :'pay3') = current_date
                   and (select doc_date from public.gl_journals where source = 'payments' and source_id = :'pay3') = current_date - 3,
  'documents dated in a closed period post on the first open day');
reset role;

-- ---- 8. Fixed assets ---------------------------------------------------------------------------------------
select tests.login('fin.gl@g.test'); set role authenticated;
select public.add_fixed_asset(:'co', 'Toyota Hilux', 'vehicles', current_date, 72000000, 12000000, 60, 'bank', 'T123ABC', 'Geita', null, null) as fa \gset
select tests.check(tests.bal(:'co', 'fixed_assets') = 72000000, 'asset at cost in the books');
select public.post_depreciation(:'co', current_date) as dep \gset
select tests.check((:'dep'::jsonb ->> 'amount')::numeric = 1000000, 'one month: (72m - 12m) / 60 = 1,000,000');
select tests.check((public.post_depreciation(:'co', current_date) ->> 'assets')::int = 0, 'a month is depreciated only once');
select tests.blocked(format('update public.fixed_assets set cost = 1 where id = %L', :'fa'), 'cost is fixed once posted');
select public.dispose_fixed_asset(:'fa', current_date, 75000000, 'bank');
reset role;
select tests.check(tests.bal(:'co', 'fixed_assets') = 0 and tests.bal(:'co', 'accum_depreciation') = 0
                   and tests.bal(:'co', 'disposal_gain_loss') = -4000000,
  'sold for 75m with 71m left in the books: gain of 4,000,000');

-- ---- 9. Who sees the books ---------------------------------------------------------------------------------
select tests.login('sales.gl@g.test'); set role authenticated;
select tests.check((select count(*) from public.gl_journals) = 0 and (select count(*) from public.gl_accounts) = 0, 'sales does not see the books');
select tests.blocked(format('select * from public.gl_trial_balance(%L, null, current_date)', :'co'), 'sales cannot run the trial balance');
reset role;
select tests.login('other.gl@g.test'); set role authenticated;
select tests.check((select count(*) from public.gl_journals where company_id = :'co') = 0, 'another company does not see the books');
select tests.blocked(format('select public.gl_check(%L)', :'co'), 'another company cannot check the books');
reset role;
set role anon;
select tests.blocked('select count(*) from public.gl_lines', 'anon: no ledger');
reset role;

-- The trial balance still adds up after everything above.
select tests.login('boss.gl@g.test'); set role authenticated;
select tests.check((select sum(closing) from public.gl_trial_balance(:'co', null, current_date)) = 0
                   and (public.gl_check(:'co') ->> 'balanced')::boolean, 'books balance at the end');
select public.gl_close_books(:'co', null);
reset role;
