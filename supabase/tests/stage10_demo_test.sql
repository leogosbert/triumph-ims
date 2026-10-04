-- Tests for Stage 10: demo mode (guest demo companies with sample data).
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
-- Supabase anonymous sign-in: no email, is_anonymous claim.
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
grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (email) values ('m10@d.test'), ('x10@d.test'), ('n10@d.test'), ('lonely10@d.test');
insert into auth.users (is_anonymous) values (true) returning id as g1 \gset
insert into auth.users (is_anonymous) values (true) returning id as g2 \gset
insert into auth.users (is_anonymous) values (true) returning id as g3 \gset
select id as m10 from auth.users where email = 'm10@d.test' \gset

-- A real company that must never be affected.
select tests.login('m10@d.test'); set role authenticated;
select public.create_company('Real Co 10') as real \gset
insert into public.clients (company_id, name) values (:'real', 'Real Client') returning id as real_client \gset
insert into public.products (company_id, sku, name) values (:'real', 'R1', 'Real product') returning id as real_product \gset
select id as real_main from public.warehouses where company_id = :'real' and code = 'MAIN' \gset
reset role;

-- ---- 1. A guest starts a demo ------------------------------------------------
select tests.login_guest(:'g1'); set role authenticated;
select clock_timestamp() as t0 \gset
select public.create_demo_company() as demo \gset
select tests.check(clock_timestamp() - :'t0'::timestamptz < interval '3 seconds', 'demo company is created quickly');
select tests.check((select name from public.companies where id = :'demo') = 'Demo Supplies Ltd', 'guest sees the demo company');
select tests.check((select is_demo and demo_expires_at between now() + interval '47 hours' and now() + interval '49 hours'
                      from public.companies where id = :'demo'), 'company is marked demo and expires in 48 hours');
select tests.check((select role from public.memberships where company_id = :'demo') = 'management', 'guest is the demo manager');
select tests.check((select count(*) from public.products) >= 8, 'sample products seeded');
select tests.check((select count(*) from public.product_costs) >= 8, 'sample product costs seeded');
select tests.check((select count(*) from public.clients) = 5, 'five sample clients');
select tests.check((select count(*) from public.client_contacts) >= 5, 'client contacts seeded');
select tests.check((select count(*) from public.suppliers) = 4, 'four sample suppliers');
select tests.check((select count(*) from public.suppliers where currency = 'USD') = 1, 'one foreign USD supplier');
select tests.check((select rate from public.exchange_rates where currency = 'USD') = 2650, 'USD exchange rate set');
select tests.check((select count(*) from public.rfqs where status = 'new') >= 1, 'an unanswered client RFQ');
select tests.check((select count(distinct status) from public.quotations) >= 3, 'quotations in several stages');
select tests.check((select array_agg(distinct status order by status) from public.quotations)
                   @> array['accepted', 'draft', 'pending_approval', 'sent'], 'draft, pending, sent and accepted quotations');
select tests.check((select count(*) from public.purchase_orders where status = 'received') = 1
                   and (select count(*) from public.purchase_orders where status = 'pending_approval') = 1
                   and (select count(*) from public.purchase_orders where status = 'confirmed') = 1,
                   'purchase orders received, awaiting approval and confirmed');
select tests.check((select count(*) from public.goods_receipts) = 1, 'goods received note');
select tests.check((select count(*) from public.stock_on_hand where quantity > 0) >= 10, 'stock on hand in the stores');
select tests.check((select count(*) from public.products p
                     where p.reorder_level > (select coalesce(sum(quantity), 0) from public.stock_movements m where m.product_id = p.id)) >= 2,
                   'some products are below their reorder level');
select tests.check((select count(*) from public.deliveries where status = 'dispatched') = 1
                   and (select count(*) from public.deliveries where status = 'draft') = 1, 'one dispatched and one draft delivery');
select tests.check((select count(*) from public.invoices where status in ('issued', 'partly_paid', 'paid')) >= 5, 'issued invoices');
select tests.check((select count(distinct to_char(issue_date, 'YYYY-MM')) from public.invoices) >= 5, 'invoices spread over the months');
select tests.check((select count(*) from public.invoices where status = 'paid') >= 2
                   and (select count(*) from public.invoices where status = 'partly_paid') >= 1
                   and (select count(*) from public.invoices where status in ('issued', 'partly_paid') and due_date < current_date) >= 2,
                   'paid, part-paid and overdue invoices');
select tests.check((select count(*) from public.payments) >= 4, 'client payments recorded');
select tests.check((select count(*) from public.invoice_profit where cost_base > 0) >= 5, 'profit is known for the invoices');
select tests.check((select count(*) from public.supplier_bills where status in ('open', 'partly_paid') and due_date < current_date) = 1,
                   'one overdue supplier bill');
select tests.check((select count(*) from public.supplier_payments) >= 2, 'supplier payments recorded');
select tests.check((select count(*) from public.notifications) >= 3, 'the demo user has notifications');
select tests.check((select count(*) from public.notifications where kind = 'demo_welcome') = 1, 'welcome notification');

select tests.check(public.is_anonymous_user(), 'guest is recognised as anonymous');

-- Guests cannot leave the demo.
select tests.blocked('select public.create_company(''Guest Co'')', 'a guest cannot create a real company');
select tests.blocked(format('select public.accept_invitation(%L)', gen_random_uuid()), 'a guest cannot accept invitations');
select tests.blocked_with(format('select public.invite_member(%L, %L, %L)', :'demo', 'friend@x.test', 'sales'),
                          'Inviting people is not available in the demo%', 'no invitations in a demo company');
select tests.blocked(format('update public.companies set is_demo = false where id = %L', :'demo'), 'users cannot unset is_demo');
select tests.blocked(format('update public.companies set demo_expires_at = now() + interval ''1 year'' where id = %L', :'demo'),
                     'users cannot extend the demo');
update public.companies set name = 'My Demo Co' where id = :'demo';
select tests.check((select name from public.companies where id = :'demo') = 'My Demo Co', 'demo manager can still edit normal company fields');

-- Nothing outside the demo can be touched.
select tests.check((select count(*) from public.companies) = 1, 'demo user sees only the demo company');
select tests.check((select count(*) from public.clients where company_id = :'real') = 0, 'demo user cannot read other companies');
update public.clients set name = 'hacked' where company_id = :'real';
select tests.blocked(format('select public.create_quotation(%L, %L, null)', :'real', :'real_client'), 'demo user cannot quote for another company');
select tests.blocked(format('select public.adjust_stock(%L, %L, %L, 5, '''', null, ''x'')', :'real', :'real_product', :'real_main'),
                     'demo user cannot move another company''s stock');
select tests.blocked(format('insert into public.clients (company_id, name) values (%L, %L)', :'real', 'Spam'), 'demo user cannot add to another company');

-- "View as" another role.
select public.set_demo_role('sales');
select tests.check((select role from public.memberships where company_id = :'demo') = 'sales', 'guest switched to sales');
select tests.check((select count(*) from public.suppliers) = 0 and (select count(*) from public.quotations) > 0, 'sales view: quotations but no suppliers');
select tests.blocked('select public.set_demo_role(null)', 'a role must be chosen');
select public.set_demo_role('driver');
select tests.check((select count(*) from public.deliveries) = 1, 'driver view: only the delivery assigned to them');
select tests.check((select count(*) from public.invoices) = 0, 'driver view: no invoices');
select public.set_demo_role('management');
select tests.check((select role from public.memberships where company_id = :'demo') = 'management', 'back to management');
reset role;
select tests.check((select name from public.clients where id = :'real_client') = 'Real Client', 'other company data untouched');
select tests.check((select count(*) from public.memberships where company_id = :'demo') = 1, 'demo company has a single member');
select tests.blocked(format('insert into public.memberships (company_id, user_id, role) values (%L, %L, %L)', :'demo', :'m10', 'sales'),
                     'nobody else can be added to a demo company');
select tests.blocked(format('insert into public.memberships (company_id, user_id, role) values (%L, %L, %L)', :'real', :'g1', 'sales'),
                     'a guest can never be added to a real company');
select tests.blocked('insert into public.companies (name, is_demo, demo_expires_at) values (''Sneaky'', true, now())',
                     'demo companies only come from create_demo_company');

-- ---- 2. Normal users, replacement and the role switch in real companies ------
select tests.login('x10@d.test'); set role authenticated;
select tests.check(not public.is_anonymous_user(), 'a normal user is not anonymous');
select public.create_company('X Co 10');
select tests.blocked_with('select public.set_demo_role(''sales'')', 'Switching roles is only available in the demo%',
                          'set_demo_role is refused outside a demo');
select tests.blocked('select public.end_demo()', 'end_demo needs a demo');
reset role;

select tests.login('m10@d.test'); set role authenticated;
select public.create_demo_company() as demo2 \gset
select tests.check((select count(*) from public.companies) = 2, 'a normal user can start a demo next to their real company');
select public.set_demo_role('finance');
select tests.check((select role from public.memberships where company_id = :'real') = 'management'
                   and (select role from public.memberships where company_id = :'demo2') = 'finance',
                   'set_demo_role only changes the demo membership');
select public.set_demo_role('management');
select tests.blocked(format('select public.invite_member(%L, %L, %L)', :'demo2', 'friend@x.test', 'sales'), 'no invitations in a normal user''s demo');
select public.create_demo_company() as demo3 \gset
select tests.check((select count(*) from public.companies where is_demo) = 1, 'starting again replaces the old demo');
reset role;
select tests.check(not exists (select 1 from public.companies where id = :'demo2'), 'old demo deleted');
select tests.check((select count(*) from public.quotations where company_id = :'demo2') = 0, 'old demo data deleted');

-- ---- 3. Works when new companies are switched off -------------------------------
update public.platform_settings set allow_new_companies = false;
select tests.login('n10@d.test'); set role authenticated;
select tests.blocked('select public.create_company(''Spam Co'')', 'real companies still blocked when switched off');
select public.create_demo_company() as demo_n \gset
select tests.check((select is_demo from public.companies where id = :'demo_n'), 'demo starts even when new companies are switched off');
reset role;
update public.platform_settings set allow_new_companies = true;

-- ---- 4. Abuse limit ---------------------------------------------------------------
insert into public.demo_starts (user_id) select null from generate_series(1, 150);
select tests.login('n10@d.test'); set role authenticated;
select tests.blocked_with('select public.create_demo_company()', 'Too many demos have been started in the last hour%',
                          'at most 150 demos an hour');
select tests.check((select count(*) from public.companies where id = :'demo_n') = 1, 'a refused restart keeps the current demo');
reset role;
delete from public.demo_starts where user_id is null;

-- ---- 5. No push or email from demo companies --------------------------------------
select public.set_outbox_secret('stage10-outbox-secret-0123456789');
select public.notify(:'real', :'m10', 'test', 'attention', 'Real alert', null, null, 'real-alert-10');
select tests.check((select count(*) from public.notifications n join public.companies c on c.id = n.company_id
                     where c.is_demo and n.severity <> 'info' and n.dispatched_at is null) > 0, 'demo companies have pending alerts');
set role anon;
create temp table claimed10 as select * from public.claim_outbox('stage10-outbox-secret-0123456789', 1000);
reset role;
select tests.check((select count(*) from claimed10 where title = 'Real alert') = 1, 'real company alerts are sent');
select tests.check((select count(*) from claimed10 c join public.notifications n on n.id = c.notification_id
                      join public.companies co on co.id = n.company_id where co.is_demo) = 0, 'demo alerts are never sent');
select tests.check((select count(*) from public.notifications n join public.companies c on c.id = n.company_id
                     where c.is_demo and n.severity <> 'info' and n.dispatched_at is null) = 0, 'demo alerts are marked handled');

-- ---- 6. End the demo ----------------------------------------------------------------
select tests.check((select count(*) from public.audit_log where company_id = :'demo') > 0, 'demo has history before ending');
select tests.login_guest(:'g1'); set role authenticated;
select public.end_demo();
select tests.check((select count(*) from public.companies) = 0, 'guest has no company after ending the demo');
reset role;
select tests.check(not exists (select 1 from public.companies where id = :'demo'), 'end_demo deletes the company');
select tests.check((select count(*) from public.stock_movements where company_id = :'demo') + (select count(*) from public.invoices where company_id = :'demo')
                   + (select count(*) from public.audit_log where company_id = :'demo') + (select count(*) from public.notifications where company_id = :'demo')
                   + (select count(*) from public.memberships where company_id = :'demo') + (select count(*) from public.products where company_id = :'demo') = 0,
                   'end_demo deletes all its data');

-- ---- 7. Scheduled clean-up ------------------------------------------------------------
select tests.login_guest(:'g3'); set role authenticated;
select public.create_demo_company() as demo_g3 \gset
reset role;
update auth.users set created_at = now() - interval '3 hours' where id in (:'g1', :'g2', :'g3')
   or email = 'lonely10@d.test';
update public.companies set demo_expires_at = now() - interval '1 minute' where id = :'demo3';
insert into storage.objects (bucket_id, name) values ('pod', :'demo3' || '/x/sig.png'), ('branding', :'real' || '/logo.png');
set role anon;
select public.run_all_alerts('stage10-outbox-secret-0123456789');
reset role;
select tests.check(not exists (select 1 from public.companies where id = :'demo3'), 'expired demo purged');
select tests.check((select count(*) from public.quotations where company_id = :'demo3') = 0, 'expired demo data purged');
select tests.check(exists (select 1 from public.companies where id = :'demo_g3') and exists (select 1 from public.companies where id = :'demo_n'),
                   'demos that have not expired are kept');
select tests.check(exists (select 1 from public.companies where id = :'real'), 'real companies are kept');
select tests.check(not exists (select 1 from auth.users where id in (:'g1', :'g2')), 'guest users without a company are removed');
select tests.check(exists (select 1 from auth.users where id = :'g3'), 'guest with a live demo is kept');
select tests.check((select count(*) from auth.users where email in ('lonely10@d.test', 'm10@d.test')) = 2,
                   'normal users are never removed');
select tests.check(not exists (select 1 from storage.objects where name like :'demo3' || '/%')
                   and exists (select 1 from storage.objects where name = :'real' || '/logo.png'), 'demo files removed, real files kept');

-- ---- 8. Who may call what -------------------------------------------------------------
select tests.check(not has_function_privilege('anon', 'public.create_demo_company()', 'execute')
                   and not has_function_privilege('anon', 'public.set_demo_role(public.app_role)', 'execute')
                   and not has_function_privilege('anon', 'public.end_demo()', 'execute')
                   and not has_function_privilege('anon', 'public.purge_demo_companies()', 'execute')
                   and not has_function_privilege('anon', 'public.is_anonymous_user()', 'execute')
                   and not has_function_privilege('anon', 'public.delete_demo_company(uuid)', 'execute'),
                   'anonymous role cannot call any demo function');
select tests.check(not has_function_privilege('authenticated', 'public.purge_demo_companies()', 'execute')
                   and not has_function_privilege('authenticated', 'public.delete_demo_company(uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.demo_quote(uuid, uuid, uuid, jsonb, date, integer, text, text)', 'execute')
                   and not has_function_privilege('authenticated', 'public.demo_invoice(uuid, date, date, jsonb)', 'execute'),
                   'signed-in users cannot call the internal demo functions');
select tests.check(has_function_privilege('authenticated', 'public.create_demo_company()', 'execute')
                   and has_function_privilege('authenticated', 'public.set_demo_role(public.app_role)', 'execute')
                   and has_function_privilege('authenticated', 'public.end_demo()', 'execute'), 'signed-in users can use the demo');
select tests.login('m10@d.test'); set role authenticated;
select tests.blocked('select public.purge_demo_companies()', 'the app cannot run the purge');
select tests.blocked(format('select public.delete_demo_company(%L)', :'demo_g3'), 'the app cannot delete someone else''s demo');
select tests.blocked('select count(*) from public.demo_starts', 'the demo log is private');
reset role;
select tests.check(not public.delete_demo_company(:'real') and exists (select 1 from public.companies where id = :'real'),
                   'the delete helper never touches a real company');

\echo 'ALL STAGE 10 TESTS PASSED'
