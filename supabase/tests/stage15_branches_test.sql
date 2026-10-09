-- Tests for Stage 15 part 2: branches, approval steps, scheduled reports.
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

insert into auth.users (email) values ('m17@e.test'), ('n17@e.test'), ('f17@e.test'), ('p17@e.test'), ('s17@e.test'), ('w17@e.test'), ('x17@x.test');
insert into auth.users (is_anonymous) values (true) returning id as g17 \gset
select id as m17 from auth.users where email = 'm17@e.test' \gset
select id as x17 from auth.users where email = 'x17@x.test' \gset
select id as n17 from auth.users where email = 'n17@e.test' \gset
select id as f17 from auth.users where email = 'f17@e.test' \gset
select id as p17 from auth.users where email = 'p17@e.test' \gset

select tests.login('m17@e.test'); set role authenticated;
select public.create_company('Branch Co') as cid \gset
select public.set_business_level(:'cid', 'enterprise');
select public.invite_member(:'cid', 'n17@e.test', 'management');
select public.invite_member(:'cid', 'f17@e.test', 'finance');
select public.invite_member(:'cid', 'p17@e.test', 'procurement');
select public.invite_member(:'cid', 's17@e.test', 'sales');
select public.invite_member(:'cid', 'w17@e.test', 'warehouse');
select id as main from public.warehouses where company_id = :'cid' and code = 'MAIN' \gset
select id as cat from public.expense_categories where company_id = :'cid' order by sort limit 1 \gset
insert into public.clients (company_id, name) values (:'cid', 'Mine Ltd') returning id as client \gset
insert into public.suppliers (company_id, name) values (:'cid', 'Lube Importers') returning id as sup \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'OIL', 'Engine oil', 'drum', 500000) returning id as oil \gset
reset role;
select tests.login('n17@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('f17@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('p17@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('s17@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('w17@e.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('x17@x.test'); set role authenticated; select public.create_company('Other Branch Co') as other \gset
reset role;

-- ---- Branches ----------------------------------------------------------------------------------
select tests.login('m17@e.test'); set role authenticated;
insert into public.branches (company_id, name, code) values (:'cid', ' Dar es Salaam ', 'dsm') returning id as hq \gset
insert into public.branches (company_id, name, code, manager_id) values (:'cid', 'Arusha', 'ARU', :'n17') returning id as aru \gset
select tests.check((select name || '/' || code from public.branches where id = :'hq') = 'Dar es Salaam/DSM', 'branch name and code tidied');
select tests.blocked(format('insert into public.branches (company_id, name) values (%L, %L)', :'cid', 'arusha'), 'branch names are unique');
select tests.blocked(format('insert into public.branches (company_id, name, manager_id) values (%L, %L, %L)', :'cid', 'Mwanza', :'x17'), 'manager must be in the team');
update public.warehouses set branch_id = :'aru' where id = :'main';
select tests.check((select branch_id from public.warehouses where id = :'main') = :'aru', 'management puts a store in a branch');
select public.set_member_branch((select id from public.memberships where company_id = :'cid' and user_id = :'f17'), :'aru');
select public.set_member_branch((select id from public.memberships where company_id = :'cid' and user_id = :'p17'), :'aru');
select tests.blocked(format('select public.set_member_branch(%L, %L)', (select id from public.memberships where company_id = :'cid' and user_id = :'f17'),
                            gen_random_uuid()), 'cannot use an unknown branch');
select tests.blocked(format('update public.memberships set branch_id = null where company_id = %L', :'cid'), 'branch of a person only through the app');
reset role;
select tests.login('f17@e.test'); set role authenticated;
select tests.check((select count(*) from public.branches where company_id = :'cid') = 2, 'staff see the branches');
select tests.blocked(format('insert into public.branches (company_id, name) values (%L, %L)', :'cid', 'Mbeya'), 'finance cannot add branches');
select tests.no_rows(format('update public.branches set name = %L where id = %L', 'X', :'aru'), 'finance cannot rename a branch');
select tests.blocked(format('select public.set_member_branch(%L, null)', (select id from public.memberships where company_id = :'cid' and user_id = :'f17')), 'finance cannot move people');
-- Documents take the branch of the person making them.
select public.create_invoice(:'cid', :'client', null, null) as inv \gset
insert into public.invoice_lines (company_id, invoice_id, description, quantity, unit_price) values (:'cid', :'inv', 'Service', 1, 100000);
select public.issue_invoice(:'inv');
select tests.check((select branch_id from public.invoices where id = :'inv') = :'aru', 'invoice takes the branch of the person making it');
reset role;
select tests.login('m17@e.test'); set role authenticated;
select public.create_invoice(:'cid', :'client', null, null) as inv2 \gset
select tests.check((select branch_id from public.invoices where id = :'inv2') is null, 'no branch for someone not in a branch');
select public.set_document_branch('invoice', :'inv2', :'hq');
select tests.check((select branch_id from public.invoices where id = :'inv2') = :'hq', 'management moves a document');
select tests.blocked(format('select public.set_document_branch(%L, %L, %L)', 'clients', :'inv2', :'hq'), 'only known documents');
reset role;
select tests.login('f17@e.test'); set role authenticated;
select tests.blocked(format('select public.set_document_branch(%L, %L, %L)', 'invoice', :'inv', :'hq'), 'finance cannot move documents');
-- Head office figures.
select tests.check((select sales from public.branch_summary(:'cid', current_date - 30, current_date) where branch_id = :'aru') = 100000, 'branch sales');
select tests.check((select staff from public.branch_summary(:'cid', current_date - 30, current_date) where branch_id = :'aru') = 2, 'branch staff');
select tests.check((select stores from public.branch_summary(:'cid', current_date - 30, current_date) where branch_id = :'aru') = 1, 'branch stores');
select tests.check((select owed from public.branch_summary(:'cid', current_date - 30, current_date) where branch_id = :'aru')
                   = (select total from public.invoices where id = :'inv'), 'branch money owed');
select tests.check((select count(*) from public.branch_summary(:'cid', current_date - 30, current_date) where branch_id is null) = 1, 'the people with no branch are shown');
reset role;
select tests.login('s17@e.test'); set role authenticated;
select tests.blocked(format('select * from public.branch_summary(%L, current_date - 30, current_date)', :'cid'), 'sales cannot see head office figures');
reset role;
select tests.login('x17@x.test'); set role authenticated;
select tests.check((select count(*) from public.branches where company_id = :'cid') = 0, 'another company sees no branches');
select tests.blocked(format('select * from public.branch_summary(%L, current_date - 30, current_date)', :'cid'), 'another company cannot see branch figures');
reset role;

-- ---- Approval steps ----------------------------------------------------------------------------
select tests.login('m17@e.test'); set role authenticated;
select tests.check(public.set_approval_steps(:'cid', 'purchase_order',
  '[{"role": "finance", "min_amount": 1000000, "label": "Budget check"}, {"role": "management", "min_amount": 5000000}]'::jsonb) = 2, 'management sets two steps');
select tests.blocked(format('select public.set_approval_steps(%L, %L, %L::jsonb)', :'cid', 'purchase_order', '[{"role": "driver"}]'), 'drivers do not approve');
select tests.blocked(format('insert into public.approval_steps (company_id, step, role) values (%L, 3, %L)', :'cid', 'finance'), 'steps only through the app');
reset role;
select tests.login('f17@e.test'); set role authenticated;
select tests.blocked(format('select public.set_approval_steps(%L, %L, %L::jsonb)', :'cid', 'purchase_order', '[]'), 'finance cannot change the steps');
select tests.check((select count(*) from public.approval_steps where company_id = :'cid') = 2, 'everyone sees the steps');
reset role;

-- A small order: under both steps, so the usual limit applies (approved straight away under it).
select tests.login('p17@e.test'); set role authenticated;
select public.create_purchase_order(:'cid', :'sup', null) as po1 \gset
insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values (:'cid', :'po1', :'oil', 'Engine oil', 1, 'drum', 400000);
select tests.check(public.submit_purchase_order(:'po1') = 'approved', 'small order needs no steps');
select tests.check((select branch_id from public.purchase_orders where id = :'po1') = :'aru', 'purchase order takes the branch');

-- A middle order: finance only.
select public.create_purchase_order(:'cid', :'sup', null) as po2 \gset
insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values (:'cid', :'po2', :'oil', 'Engine oil', 5, 'drum', 400000);
select tests.check(public.submit_purchase_order(:'po2') = 'pending_approval', 'middle order waits');
select tests.check((select count(*) from public.po_approvals where po_id = :'po2') = 1, 'one step for the middle order');
select tests.blocked(format('select public.review_purchase_order(%L, true, null)', :'po2'), 'cannot approve own order');
reset role;
select tests.check(exists (select 1 from public.notifications where user_id = :'f17' and kind = 'po_approval' and link = '/purchase-orders/' || :'po2'),
                   'finance is told it is their turn');
select tests.check(not exists (select 1 from public.notifications where user_id = :'m17' and kind = 'po_approval' and link = '/purchase-orders/' || :'po2'),
                   'management is not told for a finance step');
select tests.login('f17@e.test'); set role authenticated;
select public.review_purchase_order(:'po2', true, 'Within budget');
select tests.check((select status from public.purchase_orders where id = :'po2') = 'approved', 'finance step approves the middle order');
reset role;

-- A large order: finance, then management; one person cannot approve both.
select tests.login('p17@e.test'); set role authenticated;
select public.create_purchase_order(:'cid', :'sup', null) as po3 \gset
insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values (:'cid', :'po3', :'oil', 'Engine oil', 20, 'drum', 400000);
select public.submit_purchase_order(:'po3');
reset role;
select tests.login('s17@e.test'); set role authenticated;
select tests.blocked(format('select public.review_purchase_order(%L, true, null)', :'po3'), 'sales cannot approve');
reset role;
select tests.login('w17@e.test'); set role authenticated;
select tests.blocked(format('select public.review_purchase_order(%L, true, null)', :'po3'), 'warehouse cannot take the finance step');
reset role;
select tests.login('m17@e.test'); set role authenticated;
select public.review_purchase_order(:'po3', true, null);
select tests.check((select approved_by from public.po_approvals where po_id = :'po3' and step = 1) = :'m17', 'management may take any step');
select tests.check((select status from public.purchase_orders where id = :'po3') = 'pending_approval', 'still waiting for step two');
select tests.blocked(format('select public.review_purchase_order(%L, true, null)', :'po3'), 'one person cannot approve two steps');
reset role;
select tests.check(exists (select 1 from public.notifications where user_id = :'n17' and kind = 'po_approval' and body like '%step 2%'),
                   'the next approver is told');
select tests.login('f17@e.test'); set role authenticated;
select tests.blocked(format('select public.review_purchase_order(%L, true, null)', :'po3'), 'finance cannot take the management step');
reset role;
select tests.login('n17@e.test'); set role authenticated;
select tests.blocked(format('select public.review_purchase_order(%L, false, null)', :'po3'), 'sending back needs a reason');
select public.review_purchase_order(:'po3', false, 'Split into two orders');
select tests.check((select status from public.purchase_orders where id = :'po3') = 'draft'
                   and not exists (select 1 from public.po_approvals where po_id = :'po3'), 'sent back to draft, approvals cleared');
reset role;
select tests.login('p17@e.test'); set role authenticated;
select public.submit_purchase_order(:'po3');
reset role;
select tests.login('f17@e.test'); set role authenticated; select public.review_purchase_order(:'po3', true, null); reset role;
select tests.login('n17@e.test'); set role authenticated; select public.review_purchase_order(:'po3', true, 'OK'); reset role;
select tests.check((select status from public.purchase_orders where id = :'po3') = 'approved'
                   and (select count(*) from public.po_approvals where po_id = :'po3' and approved_at is not null) = 2, 'both steps approve the large order');
select tests.check(exists (select 1 from public.notifications where user_id = :'p17' and kind = 'po_approved' and link = '/purchase-orders/' || :'po3'),
                   'the buyer is told it is approved');
select tests.login('s17@e.test'); set role authenticated;
select tests.check((select count(*) from public.po_approvals where company_id = :'cid') = 0, 'sales does not see approvals');
reset role;

-- With the feature off the steps are ignored.
select tests.login('m17@e.test'); set role authenticated;
select public.set_company_feature(:'cid', 'advanced_approvals', false);
reset role;
select tests.login('p17@e.test'); set role authenticated;
select public.create_purchase_order(:'cid', :'sup', null) as po4 \gset
insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values (:'cid', :'po4', :'oil', 'Engine oil', 20, 'drum', 400000);
select public.submit_purchase_order(:'po4');
select tests.check((select approval_reason from public.purchase_orders where id = :'po4') = 'value above the purchase approval limit'
                   and not exists (select 1 from public.po_approvals where po_id = :'po4'), 'feature off: one management approval as before');
reset role;
select tests.login('f17@e.test'); set role authenticated;
select tests.blocked(format('select public.review_purchase_order(%L, true, null)', :'po4'), 'feature off: finance cannot approve');
reset role;
select tests.login('n17@e.test'); set role authenticated;
select public.review_purchase_order(:'po4', true, null);
select tests.check((select status from public.purchase_orders where id = :'po4') = 'approved', 'feature off: management approves');
reset role;

-- ---- Scheduled reports -------------------------------------------------------------------------
select tests.login('f17@e.test'); set role authenticated;
insert into public.report_schedules (company_id, name, report_key, query, frequency) values (:'cid', 'Daily invoices', 'invoices', 'status=issued', 'daily') returning id as rs \gset
select tests.blocked(format('insert into public.report_schedules (company_id, name, report_key, frequency) values (%L, %L, %L, %L)', :'cid', 'Weekly', 'invoices', 'weekly'), 'weekly needs a day');
select tests.blocked(format('insert into public.report_schedules (company_id, user_id, name, report_key, frequency) values (%L, %L, %L, %L, %L)', :'cid', :'m17', 'For the boss', 'invoices', 'daily'), 'only for yourself');
select tests.blocked(format('insert into public.report_schedules (company_id, name, report_key, query, frequency) values (%L, %L, %L, %L, %L)', :'cid', 'Bad', 'invoices', 'a=<script>', 'daily'), 'no odd characters in the link');
reset role;
select tests.login('m17@e.test'); set role authenticated;
select tests.check((select count(*) from public.report_schedules where company_id = :'cid') = 0, 'others do not see your schedules');
select tests.no_rows(format('update public.report_schedules set active = false where id = %L', :'rs'), 'others cannot pause your schedule');
reset role;
select tests.login('x17@x.test'); set role authenticated;
select tests.blocked(format('insert into public.report_schedules (company_id, name, report_key, frequency) values (%L, %L, %L, %L)', :'cid', 'Spy', 'invoices', 'daily'), 'another company cannot schedule');
reset role;
-- Sending (as at 08:00 today, Dar es Salaam time).
update public.report_schedules set last_sent_on = null where id = :'rs';
select public.run_report_schedules() >= 0;
select tests.check(case when extract(hour from now() at time zone 'Africa/Dar_es_Salaam') < 7 then true
                        else exists (select 1 from public.notifications where user_id = :'f17' and kind = 'scheduled_report'
                                     and link = '/reports/invoices?status=issued&p=custom&from=' || (current_date - 1)::text || '&to=' || (current_date - 1)::text) end,
                   'daily report sent with yesterday''s dates');
select tests.check(case when extract(hour from now() at time zone 'Africa/Dar_es_Salaam') < 7 then true
                        else public.run_report_schedules() = 0 end, 'not sent twice a day');

-- ---- Feature catalogue -------------------------------------------------------------------------
select tests.login('m17@e.test'); set role authenticated;
select tests.check((select bool_and(enabled) from public.company_feature_map(:'cid')
                     where key in ('branches', 'consolidated_reports', 'scheduled_reports')) = true, 'part 2 features are live and on at enterprise');
reset role;

-- ---- Company deletion copes with branches ------------------------------------------------------
select tests.check(exists (select 1 from public.backup_table_plan() where table_name = 'branches'), 'branches are in backups');

-- ---- Demo --------------------------------------------------------------------------------------
select tests.login_guest(:'g17'); set role authenticated;
select public.create_demo_company('enterprise') as demo \gset
select tests.check((select count(*) from public.branches where company_id = :'demo') = 2, 'enterprise demo has two branches');
select tests.check((select count(*) from public.branch_summary(:'demo', current_date - 90, current_date) where branch_id is not null and sales > 0) >= 1, 'demo branches have sales');
select tests.check((select count(*) from public.approval_steps where company_id = :'demo') = 2, 'demo has approval steps');
reset role;

\echo ALL STAGE 15 BRANCHES TESTS PASSED
