-- Tests for Stage 12: demos for the Small, Medium and Enterprise levels.
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
create or replace function tests.blocked_with(p_sql text, p_message text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAILED (was allowed): %', p_label;
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  if sqlerrm not like p_message then raise exception 'FAILED: % (wrong message: %)', p_label, sqlerrm; end if;
  raise notice 'pass: % (blocked: %)', p_label, sqlerrm;
end $$;
-- Is a feature on for a company, as the signed-in user sees it in the feature map?
create or replace function tests.feature(p_company uuid, p_key text) returns boolean language sql as $$
  select enabled from public.company_feature_map(p_company) where key = p_key;
$$;
grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (email) values ('u12@d.test'), ('v12@d.test'), ('w12@d.test');
insert into auth.users (is_anonymous) values (true) returning id as g12 \gset
insert into auth.users (is_anonymous) values (true) returning id as h12 \gset
select id as u12 from auth.users where email = 'u12@d.test' \gset

-- A real company that must never be affected.
select tests.login('u12@d.test'); set role authenticated;
select public.create_company('Real Co 12') as real \gset
insert into public.clients (company_id, name) values (:'real', 'Real Client 12') returning id as real_client \gset
insert into public.products (company_id, sku, name) values (:'real', 'R12', 'Real product 12') returning id as real_product \gset
reset role;

-- =====================================================================
-- 1. Small demo (guest)
-- =====================================================================
select tests.login_guest(:'g12'); set role authenticated;
select tests.check(public.my_demo_level() is null, 'my_demo_level is empty before a demo');
select tests.blocked_with('select public.switch_demo_level(''small'')', 'You have no demo company%',
                          'switch_demo_level needs a demo first');
select public.create_demo_company('small') as sm \gset
select tests.check((select name from public.companies where id = :'sm') = 'Neema General Supplies (demo)', 'small: company name');
select tests.check((select business_level = 'small' and is_demo and onboarding_done
                           and demo_expires_at between now() + interval '47 hours' and now() + interval '49 hours'
                      from public.companies where id = :'sm'), 'small: level, demo flag, onboarding done, 48 hours');
select tests.check(public.my_demo_level() = 'small', 'my_demo_level says small');
select tests.check((select role from public.memberships where company_id = :'sm') = 'management', 'small: guest is the manager');
select tests.check((select count(*) from public.products where company_id = :'sm') between 6 and 8, 'small: 6–8 products');
select tests.check((select count(*) from public.warehouses where company_id = :'sm') = 1, 'small: one store');
select tests.check((select count(*) from public.clients where company_id = :'sm') = 4, 'small: four customers');
select tests.check((select count(*) from public.suppliers where company_id = :'sm') = 2
                   and not exists (select 1 from public.suppliers where company_id = :'sm' and currency <> 'TZS'),
                   'small: two local TZS suppliers');
select tests.check(not exists (select 1 from public.exchange_rates where company_id = :'sm')
                   and not exists (select 1 from public.quotations where company_id = :'sm' and currency <> 'TZS')
                   and not exists (select 1 from public.invoices where company_id = :'sm' and currency <> 'TZS')
                   and not exists (select 1 from public.purchase_orders where company_id = :'sm' and currency <> 'TZS'),
                   'small: no foreign currency');
select tests.check(not exists (select 1 from public.supplier_rfqs where company_id = :'sm'), 'small: no supplier RFQs');
select tests.check((select array_agg(distinct status order by status) from public.quotations where company_id = :'sm')
                   @> array['accepted', 'draft', 'rejected', 'sent'], 'small: draft, sent, accepted and rejected quotations');
select tests.check(not exists (select 1 from public.quotations where company_id = :'sm' and status = 'pending_approval')
                   and not exists (select 1 from public.purchase_orders where company_id = :'sm' and status = 'pending_approval')
                   and (select quote_approval_above >= 1000000000 and po_approval_above >= 1000000000
                          from public.companies where id = :'sm'), 'small: no approvals needed');
select tests.check((select count(*) from public.purchase_orders where company_id = :'sm' and status = 'received') between 2 and 3
                   and (select count(*) from public.purchase_orders where company_id = :'sm') between 2 and 3,
                   'small: 2–3 simple purchase orders, all received');
select tests.check((select count(*) from public.invoices where company_id = :'sm' and status <> 'cancelled') between 4 and 6,
                   'small: 4–6 invoices');
select tests.check((select count(distinct to_char(issue_date, 'YYYY-MM')) from public.invoices where company_id = :'sm') >= 3
                   and (select max(issue_date) - min(issue_date) from public.invoices where company_id = :'sm') between 60 and 100,
                   'small: invoices over about three months');
select tests.check((select count(*) from public.invoices where company_id = :'sm' and status in ('issued', 'partly_paid')
                      and due_date < current_date) = 1, 'small: exactly one overdue invoice');
select tests.check((select array_agg(distinct method order by method) from public.payments where company_id = :'sm')
                   = array['bank_transfer', 'cash', 'mobile_money'], 'small: paid by mobile money, cash and bank');
select tests.check((select count(*) from public.deliveries where company_id = :'sm' and status = 'delivered') = 2,
                   'small: two deliveries made');
select tests.check((select count(*) from public.products p
                     where p.company_id = :'sm' and p.reorder_level >= (select coalesce(sum(quantity), 0) from public.stock_movements m
                                                                          where m.product_id = p.id)) between 1 and 2,
                   'small: one or two items low on stock');
select tests.check((select vat_rate from public.companies where id = :'sm') = 0
                   and not exists (select 1 from public.invoices where company_id = :'sm' and vat_amount <> 0),
                   'small: not VAT registered, no VAT on invoices');
select tests.check(not tests.feature(:'sm', 'supplier_rfqs') and not tests.feature(:'sm', 'multi_warehouse')
                   and not tests.feature(:'sm', 'multi_currency') and not tests.feature(:'sm', 'approvals')
                   and tests.feature(:'sm', 'quotations') and tests.feature(:'sm', 'invoices') and tests.feature(:'sm', 'inventory'),
                   'small: Small-level features only (supplier RFQs, stores, currencies and approvals off)');
select tests.check((select count(*) from public.company_recommendations where company_id = :'sm' and status = 'new') = 2
                   and not exists (select 1 from public.company_recommendations r
                                    where r.company_id = :'sm' and tests.feature(:'sm', r.feature_key)),
                   'small: growth page has two suggestions for features not yet on');
select tests.check((select count(*) from public.suggestions where company_id = :'sm') = 1, 'small: one Suggestion Box entry');
select tests.check((select count(*) from public.notifications where company_id = :'sm') >= 4
                   and (select count(*) from public.notifications where company_id = :'sm' and kind = 'demo_welcome') = 1
                   and exists (select 1 from public.notifications where company_id = :'sm' and kind = 'invoice_overdue')
                   and exists (select 1 from public.notifications where company_id = :'sm' and kind = 'low_stock'),
                   'small: welcome, overdue and low-stock notifications');
select tests.check((select count(*) from public.invoice_profit where cost_base > 0) >= 4, 'small: profit known for the invoices');
-- "View as" works in the small demo.
select public.set_demo_role('sales');
select tests.check((select count(*) from public.suppliers) = 0 and (select count(*) from public.quotations) > 0, 'small: view as sales');
select public.set_demo_role('management');
-- Guests still cannot touch real companies.
select tests.blocked(format('select public.create_quotation(%L, %L, null)', :'real', :'real_client'), 'small guest cannot quote for a real company');
select tests.blocked(format('select public.set_business_level(%L, %L)', :'real', 'enterprise'), 'small guest cannot change a real company''s level');
select tests.blocked('select public.create_company(''Guest Co 12'')', 'small guest cannot create a real company');
reset role;

-- =====================================================================
-- 2. Switch the guest to Enterprise
-- =====================================================================
select tests.login_guest(:'g12'); set role authenticated;
select tests.blocked_with('select public.switch_demo_level(null)', 'Choose a business level%', 'a level must be chosen');
select clock_timestamp() as t0 \gset
select public.switch_demo_level('enterprise') as ent \gset
select tests.check(clock_timestamp() - :'t0'::timestamptz < interval '2 seconds', 'enterprise demo is created in under 2 seconds');
select tests.check(:'ent' <> :'sm', 'switching gives a new company');
select tests.check((select count(*) from public.companies) = 1, 'switching keeps one demo per person');
select tests.check(public.my_demo_level() = 'enterprise', 'my_demo_level says enterprise');
select tests.check((select name from public.companies where id = :'ent') = 'Demo Industrial Group Ltd', 'enterprise: company name');
select tests.check((select business_level = 'enterprise' and is_demo and onboarding_done from public.companies where id = :'ent'),
                   'enterprise: level, demo flag, onboarding done');
select tests.check((select count(*) from public.products where company_id = :'ent') between 18 and 24, 'enterprise: 18–24 products');
select tests.check((select count(*) from public.warehouses where company_id = :'ent') between 3 and 4, 'enterprise: 3–4 stores');
select tests.check((select count(distinct warehouse_id) from public.stock_on_hand where company_id = :'ent' and quantity > 0)
                   = (select count(*) from public.warehouses where company_id = :'ent'), 'enterprise: stock in every store');
select tests.check((select count(*) from public.stock_on_hand where company_id = :'ent' and quantity > 0 and expiry_date is not null
                      and batch_no <> '') >= 5, 'enterprise: batches with expiry dates');
select tests.check(exists (select 1 from public.stock_on_hand s join public.products p on p.id = s.product_id
                            where s.company_id = :'ent' and s.quantity > 0 and p.category = 'Chemicals' and s.expiry_date < current_date + 60),
                   'enterprise: a chemical batch expiring soon');
select tests.check((select count(*) from public.clients where company_id = :'ent') between 8 and 10, 'enterprise: 8–10 customers');
select tests.check((select count(distinct industry) from public.clients where company_id = :'ent') >= 6, 'enterprise: customers in many industries');
select tests.check((select count(*) from public.suppliers where company_id = :'ent') between 5 and 6
                   and exists (select 1 from public.suppliers where company_id = :'ent' and currency = 'USD')
                   and exists (select 1 from public.suppliers where company_id = :'ent' and currency = 'EUR'),
                   'enterprise: 5–6 suppliers incl. USD and EUR');
select tests.check((select count(*) from public.exchange_rates where company_id = :'ent' and currency in ('USD', 'EUR')) = 2,
                   'enterprise: USD and EUR rates');
select tests.check((select count(*) from public.invoices where company_id = :'ent' and status <> 'cancelled') >= 20,
                   'enterprise: many invoices');
select tests.check((select count(distinct to_char(issue_date, 'YYYY-MM')) from public.invoices where company_id = :'ent') >= 10,
                   'enterprise: invoices over 10–12 months');
select tests.check((select coalesce(sum(total * exchange_rate), 0) from public.invoices
                     where company_id = :'ent' and issue_date > current_date - 120)
                   > 2 * (select coalesce(sum(total * exchange_rate), 0) from public.invoices
                           where company_id = :'ent' and issue_date <= current_date - 240),
                   'enterprise: sales grow over the year');
select tests.check((select count(*) from public.invoices where company_id = :'ent' and status = 'paid') >= 10
                   and (select count(*) from public.invoices where company_id = :'ent' and status = 'partly_paid') >= 1
                   and (select count(*) from public.invoices where company_id = :'ent' and status in ('issued', 'partly_paid')
                          and due_date < current_date) >= 2, 'enterprise: paid, part-paid and overdue invoices');
select tests.check((select array_agg(distinct status order by status) from public.quotations where company_id = :'ent')
                   @> array['accepted', 'draft', 'pending_approval', 'rejected', 'sent'], 'enterprise: quotations in every stage');
select tests.check((select count(*) from public.purchase_orders where company_id = :'ent' and status = 'pending_approval') >= 2
                   and (select count(distinct status) from public.purchase_orders where company_id = :'ent') >= 4,
                   'enterprise: purchase orders in several states incl. approvals waiting');
select tests.check(exists (select 1 from public.purchase_orders where company_id = :'ent' and currency = 'USD'
                             and status = 'received' and landed_applied_at is not null and landed_cost_base > total * exchange_rate),
                   'enterprise: import received with landed cost');
select tests.check(exists (select 1 from public.purchase_orders where company_id = :'ent' and currency = 'EUR' and status = 'confirmed'),
                   'enterprise: EUR order on the way');
select tests.check((select count(*) from public.order_costs where company_id = :'ent') >= 5, 'enterprise: freight, duty and clearing recorded');
select tests.check((select count(*) from public.supplier_rfq_suppliers s join public.supplier_rfqs r on r.id = s.srfq_id
                     where r.company_id = :'ent' and r.status = 'open' and s.status = 'quoted') >= 2
                   and (select count(distinct s.currency) from public.supplier_rfq_suppliers s
                         where s.company_id = :'ent' and s.status = 'quoted') >= 2
                   and exists (select 1 from public.supplier_quote_lines q where q.company_id = :'ent' and q.unit_price > 0),
                   'enterprise: supplier quotation comparison ready');
select tests.check((select count(*) from public.deliveries where company_id = :'ent') >= 3
                   and (select count(distinct warehouse_id) from public.deliveries where company_id = :'ent') >= 3
                   and (select array_agg(distinct status order by status) from public.deliveries where company_id = :'ent')
                       @> array['delivered', 'dispatched', 'draft'], 'enterprise: deliveries from several stores in several states');
select tests.check(exists (select 1 from public.invoices i join public.deliveries d on d.id = i.delivery_id
                            where i.company_id = :'ent' and d.status = 'delivered'), 'enterprise: invoice raised from a delivery');
select tests.check((select bool_or(o.owed between c.credit_limit * 0.85 and c.credit_limit)
                      from public.clients c
                      cross join lateral (select coalesce(sum((i.total - i.amount_paid) * i.exchange_rate), 0) as owed
                                            from public.invoices i where i.client_id = c.id and i.status in ('issued', 'partly_paid')) o
                     where c.company_id = :'ent' and c.credit_limit > 0), 'enterprise: one customer close to its credit limit');
select tests.check(not exists (
                     select 1 from public.clients c
                      where c.company_id = :'ent' and c.credit_limit > 0
                        and c.credit_limit < (select coalesce(sum((i.total - i.amount_paid) * i.exchange_rate), 0)
                                                from public.invoices i where i.client_id = c.id and i.status in ('issued', 'partly_paid'))),
                   'enterprise: no customer is over its limit');
-- Foreign-currency documents carry the company rate.
select tests.check(exists (select 1 from public.invoices where company_id = :'ent' and currency = 'USD')
                   and exists (select 1 from public.supplier_bills where company_id = :'ent' and currency = 'EUR')
                   and exists (select 1 from public.supplier_payments where company_id = :'ent' and currency = 'EUR')
                   and exists (select 1 from public.payments where company_id = :'ent' and currency = 'USD'),
                   'enterprise: USD and EUR documents exist');
select tests.check(not exists (
  select 1 from (
    select currency, exchange_rate from public.quotations where company_id = :'ent'
    union all select currency, exchange_rate from public.invoices where company_id = :'ent'
    union all select currency, exchange_rate from public.purchase_orders where company_id = :'ent'
    union all select currency, exchange_rate from public.supplier_bills where company_id = :'ent'
    union all select currency, exchange_rate from public.payments where company_id = :'ent'
    union all select currency, exchange_rate from public.supplier_payments where company_id = :'ent'
    union all select currency, exchange_rate from public.order_costs where company_id = :'ent'
    union all select currency, exchange_rate from public.supplier_rfq_suppliers where company_id = :'ent'
  ) d
  left join public.exchange_rates r on r.company_id = :'ent' and r.currency = d.currency
  where (d.currency = 'TZS' and d.exchange_rate <> 1) or (d.currency <> 'TZS' and d.exchange_rate is distinct from r.rate)),
  'enterprise: every USD/EUR document uses the company exchange rate');
select tests.check(not exists (select 1 from public.invoices
                                where company_id = :'ent' and status = 'paid' and amount_paid <> total),
                   'enterprise: paid invoices are settled exactly');
select tests.blocked_with(format('insert into public.supplier_bills (company_id, supplier_id, currency, exchange_rate, subtotal) '
                                 || 'select %L, id, ''EUR'', 1500, 100 from public.suppliers where company_id = %L and currency = ''EUR''',
                                 :'ent', :'ent'),
                          'Exchange rate%more than 10%', 'enterprise: the exchange-rate check still applies');
-- Features follow the level; two left off on purpose for the growth suggestions.
select tests.check(tests.feature(:'ent', 'multi_warehouse') and tests.feature(:'ent', 'supplier_rfqs')
                   and tests.feature(:'ent', 'multi_currency') and tests.feature(:'ent', 'approvals')
                   and tests.feature(:'ent', 'landed_cost') and tests.feature(:'ent', 'batch_expiry'),
                   'enterprise: stores, supplier RFQs, currencies, approvals, landed cost and batches on');
select tests.check((select count(*) from public.company_recommendations where company_id = :'ent' and status = 'new') between 2 and 3
                   and not exists (select 1 from public.company_recommendations r
                                    where r.company_id = :'ent' and tests.feature(:'ent', r.feature_key)),
                   'enterprise: growth page has suggestions for features not yet on');
select tests.check((select reason from public.company_recommendations where company_id = :'ent' and feature_key = 'credit_management')
                   like 'Kilima Gold Mines Ltd has used %', 'enterprise: the credit suggestion explains why');
select public.respond_recommendation((select id from public.company_recommendations
                                       where company_id = :'ent' and feature_key = 'credit_management'), 'accept');
select tests.check(tests.feature(:'ent', 'credit_management'), 'enterprise: accepting a suggestion switches the feature on');
select tests.check((select count(*) from public.suggestions where company_id = :'ent') >= 3
                   and (select count(distinct status) from public.suggestions where company_id = :'ent') >= 3
                   and (select count(distinct category) from public.suggestions where company_id = :'ent') >= 3,
                   'enterprise: Suggestion Box entries in several categories and statuses');
select tests.check((select count(*) from public.notifications where company_id = :'ent') >= 8
                   and exists (select 1 from public.notifications where company_id = :'ent' and kind = 'growth')
                   and exists (select 1 from public.notifications where company_id = :'ent' and kind = 'invoice_overdue')
                   and exists (select 1 from public.notifications where company_id = :'ent' and kind = 'batch_expiry')
                   and (select count(*) from public.notifications where company_id = :'ent' and kind = 'demo_welcome') = 1,
                   'enterprise: notifications fit the level');
select tests.check((select count(*) from public.invoice_profit where cost_base > 0) >= 20, 'enterprise: profit known for the invoices');
-- "View as" works in the enterprise demo.
select public.set_demo_role('driver');
select tests.check((select count(*) from public.deliveries where status = 'dispatched') = 1
                   and (select count(*) from public.invoices) = 0, 'enterprise: view as driver');
select public.set_demo_role('management');
-- Guests still cannot touch real companies.
select tests.check((select count(*) from public.clients where company_id = :'real') = 0, 'enterprise guest cannot read a real company');
select tests.blocked(format('select public.adjust_stock(%L, %L, (select id from public.warehouses where company_id = %L limit 1), 5, '''', null, ''x'')',
                            :'real', :'real_product', :'real'), 'enterprise guest cannot move a real company''s stock');
select tests.blocked(format('select public.set_company_feature(%L, %L, true)', :'real', 'landed_cost'),
                     'enterprise guest cannot switch a real company''s features');
reset role;
select tests.check(not exists (select 1 from public.companies where id = :'sm'), 'the small demo was deleted on switching');
select tests.check((select count(*) from public.products where company_id = :'sm') + (select count(*) from public.invoices where company_id = :'sm')
                   + (select count(*) from public.company_recommendations where company_id = :'sm')
                   + (select count(*) from public.suggestions where company_id = :'sm') = 0, 'the small demo data is gone');
select tests.check((select count(*) from public.memberships where company_id = :'ent') = 1, 'enterprise demo has a single member');
select tests.check(public.growth_check(:'ent') = 0, 'the growth engine still skips demos');

-- =====================================================================
-- 3. Medium: no argument keeps working
-- =====================================================================
select tests.login('v12@d.test'); set role authenticated;
select public.create_demo_company() as md \gset
select tests.check((select name from public.companies where id = :'md') = 'Demo Supplies Ltd', 'no argument: the medium demo');
select tests.check((select business_level from public.companies where id = :'md') = 'medium', 'no argument: level medium');
select tests.check(public.my_demo_level() = 'medium', 'my_demo_level says medium');
select tests.check((select count(*) from public.clients where company_id = :'md') = 5
                   and (select count(*) from public.suppliers where company_id = :'md') = 4
                   and (select count(*) from public.warehouses where company_id = :'md') = 2,
                   'medium: same sample data as before');
select tests.check(tests.feature(:'md', 'multi_warehouse') and tests.feature(:'md', 'supplier_rfqs')
                   and tests.feature(:'md', 'credit_management') and tests.feature(:'md', 'reorder_levels'),
                   'medium: Medium-level features on');
select tests.check(not exists (select 1 from public.company_recommendations where company_id = :'md'), 'medium: no growth suggestions');
select public.create_demo_company(null) as md2 \gset
select tests.check((select business_level from public.companies where id = :'md2') = 'medium'
                   and (select count(*) from public.companies where is_demo) = 1, 'a null level also gives medium, replacing the demo');
select public.switch_demo_level('small') as vs \gset
select tests.check((select count(*) from public.companies where is_demo) = 1 and public.my_demo_level() = 'small',
                   'a signed-in user can switch level too');

-- ---- Limits still apply -------------------------------------------------------
reset role;
insert into public.demo_starts (user_id) select :'u12'::uuid from generate_series(1, 10);
select tests.login('u12@d.test'); set role authenticated;
select tests.blocked_with('select public.create_demo_company(''enterprise'')',
                          'You have restarted the demo many times in the last hour%', 'per-person limit for create');
select tests.blocked_with('select public.switch_demo_level(''small'')', 'You have no demo company%',
                          'switching without a demo is refused');
reset role;
select tests.login('v12@d.test'); set role authenticated;
select public.my_demo_level() as before_level \gset
reset role;
insert into public.demo_starts (user_id) select null from generate_series(1, 150);
select tests.login('v12@d.test'); set role authenticated;
select tests.blocked_with('select public.switch_demo_level(''enterprise'')', 'Too many demos have been started in the last hour%',
                          'global limit for switching');
select tests.check(public.my_demo_level() = :'before_level' and (select count(*) from public.companies where id = :'vs') = 1,
                   'a refused switch keeps the current demo');
reset role;
delete from public.demo_starts where user_id is null or user_id = :'u12';

-- ---- Demos start even when new companies are switched off --------------------------
update public.platform_settings set allow_new_companies = false;
select tests.login('w12@d.test'); set role authenticated;
select tests.blocked('select public.create_company(''Spam Co 12'')', 'real companies blocked when switched off');
select public.create_demo_company('enterprise') as wd \gset
select tests.check((select is_demo and business_level = 'enterprise' from public.companies where id = :'wd'),
                   'enterprise demo starts when new companies are switched off');
select public.switch_demo_level('small') as wd2 \gset
select tests.check((select is_demo and business_level = 'small' from public.companies where id = :'wd2'),
                   'switching works when new companies are switched off');
reset role;
update public.platform_settings set allow_new_companies = true;

-- =====================================================================
-- 4. End and purge
-- =====================================================================
select tests.login_guest(:'g12'); set role authenticated;
select public.end_demo();
select tests.check(public.my_demo_level() is null and (select count(*) from public.companies) = 0, 'end_demo removes the enterprise demo');
reset role;
select tests.check((select count(*) from public.stock_movements where company_id = :'ent') + (select count(*) from public.invoices where company_id = :'ent')
                   + (select count(*) from public.supplier_rfqs where company_id = :'ent') + (select count(*) from public.exchange_rates where company_id = :'ent')
                   + (select count(*) from public.company_features where company_id = :'ent')
                   + (select count(*) from public.company_recommendations where company_id = :'ent')
                   + (select count(*) from public.suggestions where company_id = :'ent') + (select count(*) from public.notifications where company_id = :'ent')
                   + (select count(*) from public.audit_log where company_id = :'ent') = 0, 'end_demo deletes all enterprise data');

select tests.login_guest(:'h12'); set role authenticated;
select public.create_demo_company('small') as hd \gset
reset role;
update public.companies set demo_expires_at = now() - interval '1 minute' where id in (:'hd', :'wd2');
select public.purge_demo_companies() >= 2 as purged \gset
select tests.check(:'purged'::boolean and not exists (select 1 from public.companies where id in (:'hd', :'wd2')),
                   'expired small demos are purged');
select tests.check(exists (select 1 from public.companies where id = :'vs'), 'a live demo is kept by the purge');
select tests.check((select name from public.clients where id = :'real_client') = 'Real Client 12'
                   and exists (select 1 from public.companies where id = :'real' and not is_demo), 'the real company is untouched');

-- =====================================================================
-- 5. Who may call what
-- =====================================================================
select tests.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('create_demo_company', 'switch_demo_level', 'my_demo_level', 'demo_seed_small', 'demo_seed_medium',
                       'demo_seed_enterprise', 'demo_quote', 'demo_invoice', 'demo_deliver', 'demo_recommend', 'demo_fix_times')
     and has_function_privilege('anon', p.oid, 'EXECUTE')), 'anon cannot execute any Stage 12 function');
select tests.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('demo_seed_small', 'demo_seed_medium', 'demo_seed_enterprise', 'demo_quote', 'demo_invoice',
                       'demo_deliver', 'demo_recommend', 'demo_fix_times')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')), 'the seed helpers are not callable by users');
select tests.check(has_function_privilege('authenticated', 'public.create_demo_company(public.business_level)', 'EXECUTE')
                   and has_function_privilege('authenticated', 'public.switch_demo_level(public.business_level)', 'EXECUTE')
                   and has_function_privilege('authenticated', 'public.my_demo_level()', 'EXECUTE'),
                   'signed-in users can start, switch and ask for the level');
select tests.check((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = 'create_demo_company') = 1,
                   'only one create_demo_company (the old zero-argument version is gone)');
select tests.check(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                                where n.nspname = 'public'
                                  and p.proname in ('create_demo_company', 'switch_demo_level', 'my_demo_level', 'demo_seed_small',
                                                    'demo_seed_medium', 'demo_seed_enterprise', 'demo_deliver', 'demo_recommend',
                                                    'demo_fix_times')
                                  and (not p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false))),
                   'Stage 12 functions are security definer with an empty search path');
set role anon;
select tests.blocked('select public.create_demo_company(''small'')', 'anon cannot start a demo');
select tests.blocked('select public.switch_demo_level(''enterprise'')', 'anon cannot switch a demo');
select tests.blocked('select public.my_demo_level()', 'anon cannot ask for the demo level');
reset role;
select tests.login('v12@d.test'); set role authenticated;
select tests.blocked('select public.demo_seed_enterprise()', 'users cannot run a seed directly (no limits)');
select tests.blocked(format('select public.demo_recommend(%L, %L, 1, %L)', :'vs', 'credit_customers', 'x'),
                     'users cannot add recommendations');
select public.end_demo();
reset role;

\echo 'ALL STAGE 12 TESTS PASSED'
