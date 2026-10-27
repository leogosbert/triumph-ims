-- Security audit (stage 20): money cannot be changed behind the app's back.
-- Proves that an issued invoice's amounts are frozen against a direct table update
-- (the REST API lets management/finance UPDATE public.invoices under the invoices_update policy),
-- and that receiving goods can never take a purchase-order line past its ordered quantity.
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

-- ---- Setup: a full company (the enterprise demo data, made a real company) and a finance clerk ------
insert into auth.users (email) values ('boss.s20m@x.test'), ('finance.s20m@x.test');
select tests.login('boss.s20m@x.test');
select public.demo_seed_enterprise() as co \gset
update public.companies set is_demo = false, demo_expires_at = null where id = :'co';
insert into public.memberships (company_id, user_id, role, active)
values (:'co', (select id from auth.users where email = 'finance.s20m@x.test'), 'finance', true);

select id as inv, total as inv_total, subtotal as inv_sub, vat_amount as inv_vat from public.invoices
 where company_id = :'co' and status in ('issued', 'partly_paid') order by issue_date limit 1 \gset

-- ---- 1. An issued invoice's amounts are frozen ------------------------------------------------------
select tests.login('finance.s20m@x.test');
set role authenticated;
select tests.check((select count(*) from public.invoices where id = :'inv') = 1, 'the finance clerk can see the issued invoice');
-- What the REST API does for: PATCH /rest/v1/invoices?id=eq.<id>  {"total": 1}
select tests.blocked(format('update public.invoices set total = 1 where id = %L', :'inv'),
  'finance cannot overwrite the total of an issued invoice');
select tests.blocked(format('update public.invoices set subtotal = 1, vat_amount = 0, total = 1, discount_total = 0 where id = %L', :'inv'),
  'finance cannot overwrite subtotal / VAT of an issued invoice');
reset role;
select tests.check((select total from public.invoices where id = :'inv') = :'inv_total'::numeric,
  'the issued invoice total is unchanged');

select tests.login('boss.s20m@x.test');
set role authenticated;
select tests.blocked(format('update public.invoices set vat_amount = 0 where id = %L', :'inv'),
  'management cannot zero the VAT of an issued invoice either (use a credit note)');
reset role;

-- ---- 2. Receiving goods never goes past what was ordered --------------------------------------------
-- (receive_goods checks the open quantity without locking the line; two receipts at the same time
--  can both pass the check. The database must refuse the result.)
select tests.check(exists (
    select 1 from pg_constraint where conrelid = 'public.po_lines'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ~ 'received_qty <= quantity'),
  'po_lines has a check that received_qty never exceeds quantity');
select l.id as pl, l.quantity as pl_qty from public.po_lines l join public.purchase_orders p on p.id = l.po_id
 where p.company_id = :'co' order by p.created_at limit 1 \gset
select tests.blocked(format($q$
  do $b$ begin
    perform set_config('ims.status_change', 'on', true);
    update public.po_lines set received_qty = quantity + 1 where id = %L;
  end $b$ $q$, :'pl'),
  'a purchase-order line cannot be received past its ordered quantity, even by a function');

-- ---- 3. Paying an invoice twice at the same time cannot overpay it ---------------------------------
select tests.check(exists (
    select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ~ 'amount_paid <= total'),
  'invoices has a check that amount_paid never exceeds total');

-- ---- 4. Payments: no negative or zero amounts, no overpaying, no double post of one transfer -------
select total - amount_paid as open_amt from public.invoices where id = :'inv' \gset
select tests.login('finance.s20m@x.test');
set role authenticated;
select tests.blocked(format('select public.record_payment(%L, null, -100, ''cash'', ''NEG-1'', null, null, null)', :'inv'),
  'a negative payment is refused');
select tests.blocked(format('select public.record_payment(%L, null, 0, ''cash'', ''ZERO-1'', null, null, null)', :'inv'),
  'a zero payment is refused');
select tests.blocked(format('select public.record_payment(%L, null, %s, ''cash'', ''OVER-1'', null, null, null)', :'inv', :'open_amt'::numeric + 1),
  'a payment above what is owed is refused');
-- A made-up exchange rate on a payment in the base currency is replaced by 1 (check_exchange_rate).
select public.record_payment(:'inv', null, 1, 'cash', 'RATE-S20-1', -5, null, null) as rate_pay \gset
select tests.check((select exchange_rate from public.payments where id = :'rate_pay') = 1,
  'a payment in shillings is always at rate 1, whatever the caller sends');
-- The same bank transfer typed twice (double tap, or two clerks): the second must be refused.
select public.record_payment(:'inv', null, 1000, 'bank_transfer', 'TT-S20-0001', null, null, null) as first_pay \gset
select tests.blocked(format('select public.record_payment(%L, null, 1000, ''bank_transfer'', ''tt-s20-0001'', null, null, null)', :'inv'),
  'the same transfer reference cannot be posted twice on one invoice');
reset role;

-- ---- 5. Roles: sales cannot take money or approve purchases; procurement cannot approve its own PO ----
insert into auth.users (email) values ('sales.s20m@x.test'), ('buyer.s20m@x.test');
insert into public.memberships (company_id, user_id, role, active)
values (:'co', (select id from auth.users where email = 'sales.s20m@x.test'), 'sales', true),
       (:'co', (select id from auth.users where email = 'buyer.s20m@x.test'), 'procurement', true);
select id as po_any from public.purchase_orders where company_id = :'co' order by created_at limit 1 \gset
select tests.login('sales.s20m@x.test');
set role authenticated;
select tests.blocked(format('select public.record_payment(%L, null, 1, ''cash'', ''S-1'', null, null, null)', :'inv'),
  'sales cannot record a payment');
select tests.blocked(format('select public.issue_credit_note(%L, 1, ''discount'', null)', :'inv'),
  'sales cannot issue a credit note');
select tests.blocked(format('select public.review_purchase_order(%L, true, null)', :'po_any'),
  'sales cannot approve a purchase order');
select tests.blocked(format('select public.cancel_invoice(%L, ''x'')', :'inv'),
  'sales cannot cancel an invoice');
reset role;
-- A buyer's PO above the approval limit waits for management; the buyer cannot approve it.
update public.companies set po_approval_above = 0 where id = :'co';
select tests.login('buyer.s20m@x.test');
set role authenticated;
select public.create_purchase_order(:'co', (select id from public.suppliers where company_id = :'co' and active limit 1), null) as po_draft \gset
insert into public.po_lines (company_id, po_id, description, quantity, unit_price) values (:'co', :'po_draft', 'Gloves', 10, 5000);
select public.submit_purchase_order(:'po_draft') as po_state \gset
select tests.check(:'po_state' = 'pending_approval', 'a buyer''s purchase order above the limit waits for approval');
select tests.blocked(format('select public.review_purchase_order(%L, true, null)', :'po_draft'),
  'the buyer cannot approve their own purchase order');
reset role;
