-- Tests for Stage 14 part 1: opportunities, activities, important dates, tenders, contracts, documents.
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


insert into auth.users (email) values ('m14@c.test'), ('s14@c.test'), ('f14@c.test'), ('p14@c.test'), ('d14@c.test'), ('x14@o.test');
insert into auth.users (is_anonymous) values (true) returning id as g14 \gset
select id as m14 from auth.users where email = 'm14@c.test' \gset
select id as s14 from auth.users where email = 's14@c.test' \gset
select id as p14 from auth.users where email = 'p14@c.test' \gset
select id as x14 from auth.users where email = 'x14@o.test' \gset

select tests.login('m14@c.test'); set role authenticated;
select public.create_company('CRM Co') as cid \gset
select public.invite_member(:'cid', 's14@c.test', 'sales');
select public.invite_member(:'cid', 'f14@c.test', 'finance');
select public.invite_member(:'cid', 'p14@c.test', 'procurement');
select public.invite_member(:'cid', 'd14@c.test', 'driver');
insert into public.clients (company_id, name) values (:'cid', 'Cement Works Ltd') returning id as client \gset
insert into public.clients (company_id, name) values (:'cid', 'Brewery Ltd') returning id as client2 \gset
insert into public.suppliers (company_id, name) values (:'cid', 'Oil Importers') returning id as sup \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'HYD', 'Hydraulic oil', 'drum', 900000) returning id as hyd \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'cid', 'GRS', 'Grease', 'pail', 200000) returning id as grs \gset
reset role;
select tests.login('s14@c.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('f14@c.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('p14@c.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('d14@c.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('x14@o.test'); set role authenticated; select public.create_company('Other CRM Co') as other \gset
insert into public.clients (company_id, name) values (:'other', 'Their Client') returning id as other_client \gset
reset role;

-- ---- Opportunities -----------------------------------------------------------------
select tests.login('s14@c.test'); set role authenticated;
insert into public.opportunities (company_id, title, prospect_name, contact_name, contact_phone, source, value, next_action, next_on)
values (:'cid', 'Oil for the new quarry', '  Quarry Ltd ', 'Eng. Juma', '0754 000 111', 'referral', 5000000, 'Call Eng. Juma', current_date)
returning id as o1 \gset
select tests.check((select number like 'OPP-____-0001' and stage = 'lead' and probability = 10 and owner_id = :'s14'
                           and prospect_name = 'Quarry Ltd' and client_id is null from public.opportunities where id = :'o1'),
                   'opportunity numbered, starts as a lead owned by its creator');
insert into public.opportunities (company_id, title, client_id, stage) values (:'cid', 'Sneaky win', :'client', 'won') returning id as o2 \gset
select tests.check((select stage = 'lead' and closed_at is null from public.opportunities where id = :'o2'), 'cannot add an opportunity as already won');
select tests.blocked(format('update public.opportunities set stage = %L where id = %L', 'won', :'o1'), 'stage cannot be typed in');
select tests.blocked(format('insert into public.opportunities (company_id, title) values (%L, %L)', :'cid', 'Nobody'),
                     'needs a client or a prospect name');
select tests.blocked(format('insert into public.opportunities (company_id, title, client_id) values (%L, %L, %L)', :'cid', 'Wrong', :'other_client'),
                     'client of another company refused');
select tests.blocked(format('insert into public.opportunities (company_id, title, client_id, owner_id) values (%L, %L, %L, %L)',
                            :'cid', 'Outsider owner', :'client', :'x14'),
                     'owner must be in the team');
select public.set_opportunity_stage(:'o1', 'qualified', null);
select tests.check((select stage = 'qualified' and probability = 25 from public.opportunities where id = :'o1'), 'stage moves with its probability');
select tests.blocked(format('select public.set_opportunity_stage(%L, %L, null)', :'o2', 'lost'), 'lost needs a reason');
select tests.blocked(format('select public.set_opportunity_stage(%L, %L, null)', :'o2', 'dreaming'), 'unknown stage refused');
select public.set_opportunity_stage(:'o2', 'lost', 'Too expensive');
select tests.check((select stage = 'lost' and probability = 0 and closed_at is not null and lost_reason = 'Too expensive'
                      from public.opportunities where id = :'o2'), 'lost with reason and close date');
select public.set_opportunity_stage(:'o2', 'negotiation', null);
select tests.check((select stage = 'negotiation' and closed_at is null and lost_reason is null from public.opportunities where id = :'o2'),
                   'a lost opportunity can be reopened');
reset role;

select tests.login('p14@c.test'); set role authenticated;
select tests.check((select count(*) from public.opportunities where company_id = :'cid') = 0, 'procurement does not see the pipeline');
select tests.blocked(format('select public.set_opportunity_stage(%L, %L, null)', :'o1', 'won'), 'procurement cannot move opportunities');
select tests.blocked(format('insert into public.opportunities (company_id, title, client_id) values (%L, %L, %L)', :'cid', 'X', :'client'),
                     'procurement cannot add opportunities');
reset role;
select tests.login('x14@o.test'); set role authenticated;
select tests.check((select count(*) from public.opportunities where company_id = :'cid') = 0, 'another company sees no opportunities');
select tests.blocked(format('select public.convert_opportunity_client(%L)', :'o1'), 'outsider cannot convert');
reset role;

-- ---- Activities and follow-up reminders --------------------------------------------------
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where user_id = :'s14' and kind = 'crm_followup' and link = '/crm/' || :'o1') = 1,
                   'owner reminded of the next step due today');
select tests.login('s14@c.test'); set role authenticated;
select tests.blocked(format('insert into public.crm_activities (company_id, opportunity_id, kind, happened_on, summary) values (%L, %L, %L, current_date + 5, %L)',
                            :'cid', :'o1', 'call', 'Future call'), 'activity date cannot be in the future');
select tests.blocked(format('insert into public.crm_activities (company_id, kind, summary) values (%L, %L, %L)', :'cid', 'call', 'Floating'),
                     'activity needs an opportunity or a client');
insert into public.crm_activities (company_id, opportunity_id, kind, summary, next_action, next_on)
values (:'cid', :'o1', 'call', 'Spoke to Eng. Juma, wants samples', 'Deliver samples', current_date + 3) returning id as a1 \gset
select tests.check((select next_action = 'Deliver samples' and next_on = current_date + 3 from public.opportunities where id = :'o1'),
                   'the next step of the call becomes the opportunity''s next step');
select tests.check((select read_at is not null from public.notifications where user_id = :'s14' and kind = 'crm_followup' and link = '/crm/' || :'o1'),
                   'logging the call clears the reminder');
update public.crm_activities set summary = 'Spoke to Eng. Juma; wants two sample drums' where id = :'a1';
select tests.blocked(format('update public.crm_activities set happened_on = current_date - 30 where id = %L', :'a1'), 'only the text of an activity can be fixed');
reset role;
select tests.login('m14@c.test'); set role authenticated;
select tests.no_rows(format('update public.crm_activities set summary = %L where id = %L', 'Changed by boss', :'a1'),
                     'only the person who logged it can edit an activity');
reset role;

-- Convert the prospect into a client.
select tests.login('s14@c.test'); set role authenticated;
select public.convert_opportunity_client(:'o1') as newclient \gset
select tests.check((select name from public.clients where id = :'newclient') = 'Quarry Ltd'
                   and (select client_id from public.opportunities where id = :'o1') = :'newclient',
                   'prospect becomes a client');
select tests.check((select count(*) from public.client_contacts where client_id = :'newclient' and phone = '0754 000 111') = 1,
                   'the contact person comes along');
select tests.check(public.convert_opportunity_client(:'o1') = :'newclient', 'converting twice changes nothing');
reset role;

-- ---- Quotation link: sent, revised, accepted ------------------------------------------------
select tests.login('m14@c.test'); set role authenticated;
select public.create_quotation(:'cid', :'newclient', null) as q \gset
insert into public.quotation_lines (company_id, quotation_id, product_id, description, quantity, unit, unit_price)
values (:'cid', :'q', :'hyd', 'Hydraulic oil', 10, 'drum', 900000);
reset role;
select tests.login('s14@c.test'); set role authenticated;
select tests.blocked(format('select public.link_opportunity_quotation(%L, %L)', :'o2', :'q'), 'quotation for another client refused');
select public.link_opportunity_quotation(:'o1', :'q');
select tests.check((select stage = 'quoted' and probability = 50 and quotation_id = :'q' from public.opportunities where id = :'o1'),
                   'linking a quotation makes the opportunity quoted');
reset role;
select tests.login('m14@c.test'); set role authenticated;
select public.submit_quotation(:'q');
select public.mark_quotation_sent(:'q');
select tests.check((select value from public.opportunities where id = :'o1') = 9000000, 'sending the quotation updates the value');
select public.revise_quotation(:'q') as q2 \gset
select tests.check((select quotation_id from public.opportunities where id = :'o1') = :'q2', 'the opportunity follows the revision');
select public.submit_quotation(:'q2');
select public.record_quotation_outcome(:'q2', true, 'LPO 55');
select tests.check((select stage = 'won' and probability = 100 and closed_at is not null from public.opportunities where id = :'o1'),
                   'accepted quotation wins the opportunity');
reset role;

-- ---- Important dates -----------------------------------------------------------------------
select tests.check(public.next_occurrence('2000-03-15', true, '2026-03-20') = '2027-03-15', 'yearly date passed: next year');
select tests.check(public.next_occurrence('2000-02-29', true, '2027-02-01') = '2027-02-28', '29 February falls on the 28th');
select tests.check(public.next_occurrence('2026-01-05', false, '2026-03-20') = '2026-01-05', 'one-off dates stay put');
select tests.login('s14@c.test'); set role authenticated;
insert into public.important_dates (company_id, client_id, title, kind, the_date, yearly, remind_days)
values (:'cid', :'client', 'MD birthday', 'birthday', (current_date + 2) - interval '30 years', true, 3) returning id as dt \gset
reset role;
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where user_id = :'s14' and kind = 'important_date') = 1,
                   'reminder before a client''s birthday');
select tests.login('f14@c.test'); set role authenticated;
select tests.check((select count(*) from public.important_dates where company_id = :'cid') = 0, 'finance does not see client dates');
reset role;

-- ---- Tenders ---------------------------------------------------------------------------------
select tests.login('s14@c.test'); set role authenticated;
select tests.blocked(format('insert into public.tenders (company_id, title, buyer_name, closing_at, status) values (%L, %L, %L, now(), %L)',
                            :'cid', 'Sneaky', 'Buyer', 'won'), 'tender status cannot be set when adding');
insert into public.tenders (company_id, title, buyer_name, reference, closing_at, bid_security, opportunity_id)
values (:'cid', 'Supply of lubricants 2027', 'Ports Authority', 'AE/016', now() + interval '1 day', 2000000, :'o2')
returning id as t1 \gset
select tests.check((select number like 'TND-____-0001' and status = 'preparing' and owner_id = :'s14' from public.tenders where id = :'t1'),
                   'tender numbered, starts as being prepared');
select tests.check((select count(*) from public.tender_tasks where tender_id = :'t1') = 9, 'tender comes with a 9-step checklist');
select id as task1 from public.tender_tasks where tender_id = :'t1' order by sort limit 1 \gset
select public.set_tender_task_done(:'task1', true);
select tests.check((select done_at is not null and done_by = :'s14' from public.tender_tasks where id = :'task1'), 'checklist step ticked');
select tests.blocked(format('update public.tender_tasks set done_at = now() where tender_id = %L', :'t1'), 'ticks only through the app');
insert into public.tender_tasks (company_id, tender_id, title) values (:'cid', :'t1', 'Samples to the buyer');
select tests.blocked(format('update public.tenders set status = %L where id = %L', 'won', :'t1'), 'tender status cannot be typed in');
select tests.blocked(format('select public.set_tender_status(%L, %L, null, null, null)', :'t1', 'submitted'), 'submitting needs our price');
reset role;
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where kind = 'tender_closing' and link = '/tenders/' || :'t1') = 2
                   and (select severity from public.notifications where kind = 'tender_closing' and user_id = :'s14') = 'critical',
                   'owner and management warned the tender closes in a day');
select tests.login('s14@c.test'); set role authenticated;
update public.tenders set our_price = 240000000 where id = :'t1';
select public.set_tender_status(:'t1', 'submitted', null, null, null);
select tests.check((select status = 'submitted' and submitted_at is not null from public.tenders where id = :'t1'), 'tender submitted');
select public.set_tender_status(:'t1', 'lost', 'Price', 231000000, 'Rival Oils Ltd');
select tests.check((select status = 'lost' and decided_at is not null and winning_price = 231000000 and winner = 'Rival Oils Ltd'
                      from public.tenders where id = :'t1'), 'tender result recorded with the winning price');
select tests.check((select stage = 'lost' and lost_reason = 'Price' from public.opportunities where id = :'o2'), 'lost tender loses its opportunity');
reset role;
select tests.login('p14@c.test'); set role authenticated;
select tests.check((select count(*) from public.tenders where company_id = :'cid') = 0, 'procurement does not see tenders');
select tests.blocked(format('select public.set_tender_task_done(%L, false)', :'task1'), 'procurement cannot tick tender steps');
reset role;

-- ---- Contracts and contract prices -------------------------------------------------------------
select tests.login('s14@c.test'); set role authenticated;
insert into public.contracts (company_id, client_id, title, start_date, end_date, remind_days)
values (:'cid', :'client', 'Framework 2026', current_date - 10, current_date + 20, 30) returning id as k1 \gset
select tests.check((select number like 'CTR-____-0001' from public.contracts where id = :'k1'), 'contract numbered');
select tests.blocked(format('insert into public.contracts (company_id, client_id, title, start_date, end_date) values (%L, %L, %L, current_date, current_date - 1)',
                            :'cid', :'client', 'Backwards'), 'end date cannot be before the start');
insert into public.contract_prices (company_id, contract_id, product_id, unit_price) values (:'cid', :'k1', :'hyd', 850000);
select tests.blocked(format('insert into public.contract_prices (company_id, contract_id, product_id, unit_price) values (%L, %L, %L, 1)',
                            :'cid', :'k1', :'hyd'), 'one price per product per contract');
-- An older contract that has ended does not apply.
insert into public.contracts (company_id, client_id, title, start_date, end_date) values (:'cid', :'client', 'Old one', current_date - 400, current_date - 35)
returning id as k0 \gset
insert into public.contract_prices (company_id, contract_id, product_id, unit_price) values (:'cid', :'k0', :'grs', 1000);
select tests.check((select count(*) from public.client_contract_prices(:'client', 'TZS')) = 1
                   and (select unit_price from public.client_contract_prices(:'client', 'TZS') where product_id = :'hyd') = 850000,
                   'only current contract prices apply');
select public.create_quotation(:'cid', :'client', null) as cq \gset
insert into public.quotation_lines (company_id, quotation_id, product_id, description, quantity, unit, unit_price, discount_pct)
values (:'cid', :'cq', :'hyd', 'Hydraulic oil', 2, 'drum', 900000, 5), (:'cid', :'cq', :'grs', 'Grease', 1, 'pail', 200000, 0);
select tests.check(public.apply_contract_prices(:'cq') = 1, 'contract prices put on the draft quotation');
select tests.check((select unit_price = 850000 and discount_pct = 0 from public.quotation_lines where quotation_id = :'cq' and product_id = :'hyd')
                   and (select unit_price from public.quotation_lines where quotation_id = :'cq' and product_id = :'grs') = 200000,
                   'only products with a contract price change');
reset role;
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where kind = 'contract_ending' and link = '/contracts/' || :'k1') = 2,
                   'management and sales reminded the contract ends soon');
select tests.login('f14@c.test'); set role authenticated;
select tests.check((select count(*) from public.contracts where company_id = :'cid') = 2
                   and (select count(*) from public.contract_prices where company_id = :'cid') = 2, 'finance can read contracts and prices');
select tests.blocked(format('insert into public.contract_prices (company_id, contract_id, product_id, unit_price) values (%L, %L, %L, 1)',
                            :'cid', :'k1', :'grs'), 'finance cannot change contract prices');
select tests.blocked(format('select public.apply_contract_prices(%L)', :'cq'), 'finance cannot change quotations');
reset role;
select tests.login('s14@c.test'); set role authenticated;
select tests.blocked(format('select public.cancel_contract(%L, %L)', :'k1', ''), 'ending early needs a reason');
select public.cancel_contract(:'k1', 'Client changed supplier');
select tests.check((select cancelled_at is not null from public.contracts where id = :'k1'), 'contract ended early');
select tests.blocked(format('update public.contract_prices set unit_price = 1 where contract_id = %L', :'k1'), 'ended contract prices are frozen');
select tests.blocked(format('update public.contracts set title = %L where id = %L', 'Changed', :'k1'), 'ended contract is frozen');
select tests.check((select count(*) from public.client_contract_prices(:'client', 'TZS')) = 0, 'ended contract prices no longer apply');
reset role;
select tests.login('x14@o.test'); set role authenticated;
select tests.check((select count(*) from public.client_contract_prices(:'client', null)) = 0, 'outsiders get no contract prices');
reset role;

-- ---- Documents library ------------------------------------------------------------------------------
select tests.login('p14@c.test'); set role authenticated;
insert into public.documents (company_id, title, kind, supplier_id, expires_on, remind_days)
values (:'cid', 'Supplier ISO certificate', 'certificate', :'sup', current_date + 10, 30) returning id as doc1 \gset
insert into storage.objects (bucket_id, name) values ('documents', :'cid' || '/' || :'doc1' || '/iso.pdf');
update public.documents set file_path = :'cid' || '/' || :'doc1' || '/iso.pdf', file_name = 'iso.pdf' where id = :'doc1';
select tests.check((select file_path is not null from public.documents where id = :'doc1'), 'procurement uploads a supplier certificate');
select tests.blocked(format('update public.documents set file_path = %L where id = %L', :'cid' || '/' || :'doc1' || '/missing.pdf', :'doc1'),
                     'the file must exist');
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'documents', :'cid' || '/' || gen_random_uuid() || '/x.pdf'),
                     'cannot upload outside a document''s folder');
select tests.blocked(format('insert into public.documents (company_id, title, issued_on, expires_on) values (%L, %L, current_date, current_date - 1)',
                            :'cid', 'Backwards'), 'expiry cannot be before issue');
reset role;
select tests.login('d14@c.test'); set role authenticated;
select tests.check((select count(*) from public.documents where company_id = :'cid') = 0
                   and (select count(*) from storage.objects where bucket_id = 'documents') = 0, 'drivers do not see the library');
reset role;
select tests.login('x14@o.test'); set role authenticated;
select tests.check((select count(*) from storage.objects where bucket_id = 'documents') = 0, 'another company cannot see the file');
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'documents', :'cid' || '/' || :'doc1' || '/evil.pdf'),
                     'another company cannot upload into the document');
reset role;
select tests.login('f14@c.test'); set role authenticated;
select tests.check((select count(*) from storage.objects where bucket_id = 'documents') = 1, 'finance can open the file');
reset role;
select public.run_company_alerts(:'cid');
select tests.check((select count(*) from public.notifications where kind = 'document_expiry' and link = '/documents/' || :'doc1') = 2,
                   'management and procurement warned the certificate expires');
select tests.login('p14@c.test'); set role authenticated;
update public.documents set archived_at = now() where id = :'doc1';
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'documents', :'cid' || '/' || :'doc1' || '/v2.pdf'),
                     'no new files on an archived document');
reset role;

-- ---- Feature catalogue ----------------------------------------------------------------------------------
select tests.login('m14@c.test'); set role authenticated;
select tests.check((select bool_and(enabled) from public.company_feature_map(:'cid')
                     where key in ('crm_pipeline', 'tenders', 'contracts', 'documents', 'bank_reconciliation')) = true,
                   'Stage 14 features are live and on at medium');
reset role;

-- ---- Reset before go-live ---------------------------------------------------------------------------------
select public.reset_company_transactions(:'cid', 'CRM Co');
select tests.check(not exists (select 1 from public.opportunities where company_id = :'cid')
                   and not exists (select 1 from public.crm_activities where company_id = :'cid')
                   and not exists (select 1 from public.tenders where company_id = :'cid'), 'reset clears the pipeline and tenders');
select tests.check((select count(*) from public.contracts where company_id = :'cid') = 2
                   and (select count(*) from public.documents where company_id = :'cid') = 1
                   and (select count(*) from public.important_dates where company_id = :'cid') = 1, 'reset keeps contracts, documents and dates');

-- ---- Demo ---------------------------------------------------------------------------------------------------
select tests.login_guest(:'g14'); set role authenticated;
select public.create_demo_company('medium') as demo \gset
select tests.check((select count(*) from public.opportunities where company_id = :'demo') >= 5, 'demo has a pipeline');
select tests.check((select count(*) from public.opportunities where company_id = :'demo' and stage in ('won', 'lost') and closed_at is null) = 0,
                   'demo closed opportunities have a close date');
select tests.check((select count(*) from public.tenders where company_id = :'demo') = 2
                   and (select count(*) from public.contracts where company_id = :'demo') = 1
                   and (select count(*) from public.contract_prices where company_id = :'demo') >= 1
                   and (select count(*) from public.documents where company_id = :'demo') >= 5, 'demo has tenders, a contract and documents');
reset role;
select tests.check(public.run_company_alerts(:'demo') >= 0, 'alerts run on the demo');
select tests.check((select count(*) from public.notifications where company_id = :'demo' and kind in ('document_expiry', 'contract_ending', 'tender_closing', 'crm_followup')) > 0,
                   'demo shows the new reminders');

\echo ALL STAGE 14 CRM TESTS PASSED
