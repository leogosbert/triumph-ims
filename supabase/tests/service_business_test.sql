-- Tests for goods and services: item types, service jobs, maintenance, equipment, projects,
-- timesheets, hire and direct supply. Everything runs in one transaction that is rolled back.
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

insert into auth.users (email) values ('boss.sv@s.test'), ('sales.sv@s.test'), ('tech.sv@s.test'), ('fin.sv@s.test'),
                                      ('drv.sv@s.test'), ('other.sv@s.test');
select id as tech from auth.users where email = 'tech.sv@s.test' \gset
select id as drv from auth.users where email = 'drv.sv@s.test' \gset

select tests.login('boss.sv@s.test'); set role authenticated;
select public.create_company('Pipes & Services Ltd') as co \gset
select id as main from public.warehouses where company_id = :'co' and code = 'MAIN' \gset
select public.invite_member(:'co', 'sales.sv@s.test', 'sales');
select public.invite_member(:'co', 'tech.sv@s.test', 'warehouse');
select public.invite_member(:'co', 'fin.sv@s.test', 'finance');
select public.invite_member(:'co', 'drv.sv@s.test', 'driver');
reset role;
select tests.login('sales.sv@s.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('tech.sv@s.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('fin.sv@s.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('drv.sv@s.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('other.sv@s.test'); set role authenticated; select public.create_company('Other Ltd') as other \gset
reset role;

-- ---- 1. What the company sells -----------------------------------------------------------------
select tests.check((select business_type from public.companies where id = :'co') = 'goods', 'a new company sells goods');
select tests.check((select count(*) from public.features where module = 'Services' and status = 'live') = 8, 'eight live service features');
select tests.login('sales.sv@s.test'); set role authenticated;
select tests.blocked(format('select public.set_business_type(%L, %L)', :'co', 'both'), 'only management chooses what the company sells');
reset role;
select tests.login('boss.sv@s.test'); set role authenticated;
select public.set_business_level(:'co', 'small');
select tests.blocked(format('select public.set_business_type(%L, %L)', :'co', 'shoes'), 'goods, services or both only');
select public.set_business_type(:'co', 'both');
reset role;
select tests.check((select business_type from public.companies where id = :'co') = 'both', 'business type saved');
select tests.check(public.feature_on(:'co', 'service_jobs') and public.feature_on(:'co', 'equipment_register'),
                   'service screens switched on for a small company that also sells services');
select tests.check(not public.feature_on(:'co', 'projects'), 'projects stay off for a small goods-and-services company');
select tests.login('boss.sv@s.test'); set role authenticated;
update public.companies set wht_rate = 2 where id = :'co';
select tests.blocked(format('update public.companies set wht_rate = 50 where id = %L', :'co'), 'withholding tax rate stays sensible');

-- ---- 2. Goods and services on one quotation ----------------------------------------------------
insert into public.clients (company_id, name, delivery_sites) values (:'co', 'Mwanza Water', 'Pump house, Mwanza') returning id as client \gset
insert into public.suppliers (company_id, name) values (:'co', 'Pipe Mills Ltd') returning id as sup \gset
insert into public.products (company_id, sku, name, unit, selling_price) values (:'co', 'PIPE', 'HDPE pipe 110mm', 'm', 20000) returning id as pipe \gset
insert into public.products (company_id, sku, name, unit, selling_price, item_type)
values (:'co', 'INST', 'Pipe installation', 'm', 8000, 'service') returning id as inst \gset
insert into public.products (company_id, sku, name, unit, selling_price, item_type)
values (:'co', 'ENG', 'Engineer consultation', 'hour', 60000, 'consultancy') returning id as eng \gset
select tests.blocked(format('insert into public.products (company_id, sku, name, unit, item_type) values (%L, %L, %L, %L, %L)',
  :'co', 'X', 'Bad', 'pcs', 'magic'), 'item type must be known');
select public.adjust_stock(:'co', :'pipe', :'main', 500, '', null, 'Opening balance');

select public.create_quotation(:'co', :'client', null) as q \gset
insert into public.quotation_lines (company_id, quotation_id, product_id, description, quantity, unit, unit_price)
values (:'co', :'q', :'pipe', 'HDPE pipe 110mm', 100, 'm', 20000),
       (:'co', :'q', :'inst', 'Pipe installation', 100, 'm', 8000),
       (:'co', :'q', :'eng', 'Site survey', 4, 'hour', 60000);
select tests.check((select count(*) from public.quotation_lines where quotation_id = :'q' and is_service) = 2, 'service lines are marked');
select public.submit_quotation(:'q');
select public.record_quotation_outcome(:'q', true, 'PO-77');
select public.create_delivery(:'co', null, :'q', null) as dn \gset
select tests.check((select count(*) from public.delivery_lines where delivery_id = :'dn') = 1, 'only goods go on the delivery note');
reset role;

-- ---- 3. Service jobs ---------------------------------------------------------------------------
select tests.login('sales.sv@s.test'); set role authenticated;
insert into public.client_equipment (company_id, client_id, name, serial_no, location, installed_on, service_every_months)
values (:'co', :'client', 'Booster pump', 'SN-1', 'Pump house', current_date - 200, 6) returning id as eq \gset
insert into public.service_jobs (company_id, client_id, equipment_id, title, kind, assigned_to, scheduled_for, checklist)
values (:'co', :'client', :'eq', 'Install pipe line', 'installation', array[:'tech']::uuid[], now(),
        '[{"text": "Pressure test", "done": false}]'::jsonb) returning id as job \gset
select tests.check((select number from public.service_jobs where id = :'job') like 'JOB-%', 'jobs get a number');
select tests.blocked(format('insert into public.service_jobs (company_id, client_id, title, assigned_to) values (%L, %L, %L, array[%L]::uuid[])',
  :'co', :'client', 'Bad', '00000000-0000-0000-0000-000000000001'), 'only team members can be assigned');
select tests.blocked(format('update public.service_jobs set status = %L where id = %L', 'completed', :'job'), 'status only through the buttons');
reset role;

select tests.login('drv.sv@s.test'); set role authenticated;
select tests.check((select count(*) from public.service_jobs) = 0, 'a driver does not see jobs they are not on');
reset role;

select tests.login('tech.sv@s.test'); set role authenticated;
select tests.check((select count(*) from public.service_jobs where id = :'job') = 1, 'the technician sees the job');
select public.set_job_status(:'job', 'in_progress');
select public.update_job_progress(:'job', '[{"text": "Pressure test", "done": true}]'::jsonb, 'All joints tight');
insert into public.service_job_lines (company_id, job_id, kind, product_id, description, quantity, unit, unit_price)
values (:'co', :'job', 'material', :'pipe', 'HDPE pipe 110mm', 30, 'm', 20000),
       (:'co', :'job', 'labour', :'inst', 'Installation', 30, 'm', 8000);
insert into public.timesheets (company_id, work_date, hours, job_id, description) values (:'co', current_date, 6, :'job', 'Laying pipe');
select tests.blocked(format('select public.complete_service_job(%L, null, %L, %L)', :'job', 'Asha', 'other/jobs/x.png'), 'signature must be in the company folder');
select public.complete_service_job(:'job', null, 'Asha (client)', :'co' || '/jobs/' || :'job' || '/sig.png');
select tests.blocked(format('select public.invoice_service_job(%L)', :'job'), 'technicians do not invoice');
reset role;
select tests.check((select status from public.service_jobs where id = :'job') = 'completed', 'job completed');
select tests.check((select sum(quantity) from public.stock_movements where product_id = :'pipe') = 470, 'materials left the store');
select tests.check((select count(*) from public.stock_movements where job_id = :'job' and kind = 'job') = 1, 'stock movement linked to the job');
select tests.check((select next_service_on from public.client_equipment where id = :'eq') > current_date + 150, 'equipment next service moved on');

select tests.login('boss.sv@s.test'); set role authenticated;
insert into public.team_rates (company_id, user_id, bill_rate, cost_rate) values (:'co', :'tech', 25000, 10000);
reset role;
select tests.login('tech.sv@s.test'); set role authenticated;
insert into public.timesheets (company_id, work_date, hours, job_id, description) values (:'co', current_date, 2, :'job', 'Testing') returning id as ts2 \gset
select tests.check((select rate from public.timesheets where id = :'ts2') = 25000, 'rate taken from the person');
select tests.blocked(format('update public.timesheets set rate = 1 where id = %L', :'ts2'), 'people cannot set their own rate');
reset role;

select tests.login('fin.sv@s.test'); set role authenticated;
select public.invoice_service_job(:'job') as inv \gset
select tests.check((select count(*) from public.invoice_lines where invoice_id = :'inv') = 3, 'materials, labour and billable hours invoiced');
select tests.check((select count(*) from public.invoice_lines where invoice_id = :'inv' and is_service) = 2, 'service lines marked on the invoice');
select tests.check((select status from public.service_jobs where id = :'job') = 'invoiced', 'job invoiced');
reset role;
select tests.login('tech.sv@s.test'); set role authenticated;
update public.timesheets set hours = 1 where id = :'ts2';
reset role;
select tests.check((select hours from public.timesheets where id = :'ts2') = 2, 'invoiced hours stay as they are');
select tests.blocked(format('update public.timesheets set hours = 1 where id = %L', :'ts2'), 'invoiced hours are locked');

-- ---- 4. Maintenance contracts ------------------------------------------------------------------
select tests.login('sales.sv@s.test'); set role authenticated;
insert into public.service_contracts (company_id, client_id, title, frequency, starts_on, equipment_id, checklist, price)
values (:'co', :'client', 'Pump maintenance', 'quarterly', current_date + 3, :'eq', '["Check seals", "Grease bearings"]'::jsonb, 300000)
returning id as mc \gset
select tests.check((select number from public.service_contracts where id = :'mc') like 'MC-%', 'contracts get a number');
select tests.check(public.create_due_service_visits(:'co') = 1, 'the visit due soon becomes a job');
select tests.check(public.create_due_service_visits(:'co') = 0, 'no second job for the same visit');
select tests.check((select next_visit_on from public.service_contracts where id = :'mc') = current_date + 3 + interval '3 months', 'contract moves on a quarter');
select tests.check((select jsonb_array_length(checklist) from public.service_jobs where contract_id = :'mc') = 2, 'visit job has the checklist');
reset role;
select tests.login('drv.sv@s.test'); set role authenticated;
select tests.blocked(format('select public.create_due_service_visits(%L)', :'co'), 'drivers do not plan visits');
reset role;

-- ---- 5. Projects -------------------------------------------------------------------------------
select tests.login('sales.sv@s.test'); set role authenticated;
insert into public.projects (company_id, client_id, name, billing, default_rate) values (:'co', :'client', 'Water network design', 'milestone', 60000)
returning id as prj \gset
insert into public.project_milestones (company_id, project_id, title, amount) values (:'co', :'prj', 'Survey report', 2000000) returning id as ms \gset
reset role;
select tests.login('tech.sv@s.test'); set role authenticated;
insert into public.timesheets (company_id, work_date, hours, project_id) values (:'co', current_date - 1, 5, :'prj');
reset role;
select tests.login('fin.sv@s.test'); set role authenticated;
select public.invoice_project(:'prj', array[:'ms']::uuid[], current_date) as pinv \gset
select tests.check((select count(*) from public.invoice_lines where invoice_id = :'pinv') = 2, 'milestone and hours invoiced');
select tests.check((select status from public.project_milestones where id = :'ms') = 'invoiced', 'milestone marked invoiced');
select tests.blocked(format('select public.invoice_project(%L, null, current_date)', :'prj'), 'nothing left to invoice');
reset role;

-- ---- 6. Hire -----------------------------------------------------------------------------------
select tests.login('boss.sv@s.test'); set role authenticated;
insert into public.products (company_id, sku, name, unit, item_type) values (:'co', 'GEN', 'Generator 20kVA', 'pcs', 'hire') returning id as gen \gset
select public.adjust_stock(:'co', :'gen', :'main', 3, '', null, 'Owned units');
reset role;
select tests.login('sales.sv@s.test'); set role authenticated;
insert into public.hire_agreements (company_id, client_id, site, out_on, due_back_on, rate_period)
values (:'co', :'client', 'Pump house', current_date - 9, current_date + 5, 'week') returning id as hire \gset
select tests.check((select number from public.hire_agreements where id = :'hire') like 'HIRE-%', 'hires get a number');
insert into public.hire_lines (company_id, agreement_id, product_id, description, quantity, rate)
values (:'co', :'hire', :'gen', 'Generator 20kVA', 2, 150000);
select tests.blocked(format('insert into public.hire_lines (company_id, agreement_id, product_id, description, quantity) values (%L, %L, %L, %L, 2)',
  :'co', :'hire', :'gen', 'Generator'), 'cannot hire more than is free');
select tests.blocked(format('insert into public.hire_lines (company_id, agreement_id, product_id, description, quantity) values (%L, %L, %L, %L, 1)',
  :'co', :'hire', :'pipe', 'Pipe'), 'only hire items go on hire');
select tests.check((select on_hire from public.hire_available(:'co', :'gen')) = 2, 'two units out');
select tests.blocked(format('update public.hire_agreements set status = %L where id = %L', 'returned', :'hire'), 'return through the button');
reset role;
select tests.check((select sum(quantity) from public.stock_movements where product_id = :'gen') = 3, 'hire does not use up stock');
select tests.login('fin.sv@s.test'); set role authenticated;
select public.invoice_hire(:'hire', current_date - 3) as hinv1 \gset
-- 7 days out (to 3 days ago) = 1 week x 2 units
select tests.check((select quantity from public.invoice_lines where invoice_id = :'hinv1') = 2, 'first week invoiced while out');
select tests.check((select status from public.hire_agreements where id = :'hire') = 'out', 'still out after a part invoice');
reset role;
select tests.login('sales.sv@s.test'); set role authenticated;
select tests.blocked(format('select public.cancel_hire(%L)', :'hire'), 'an invoiced hire cannot be cancelled');
select public.return_hire(:'hire', current_date, 'One scratch');
reset role;
select tests.login('fin.sv@s.test'); set role authenticated;
select public.invoice_hire(:'hire', null) as hinv2 \gset
select tests.check((select quantity from public.invoice_lines where invoice_id = :'hinv2') = 2, 'rest of the time invoiced on return');
select tests.check((select status from public.hire_agreements where id = :'hire') = 'invoiced', 'hire closed');
select tests.blocked(format('select public.invoice_hire(%L, null)', :'hire'), 'nothing left to invoice');
reset role;
select tests.check((select on_hire from public.hire_available(:'co', :'gen')) = 0, 'units back in the yard');

-- ---- 7. Direct supply --------------------------------------------------------------------------
select tests.login('boss.sv@s.test'); set role authenticated;
select public.create_quotation(:'co', :'client', null) as q2 \gset
insert into public.quotation_lines (company_id, quotation_id, product_id, description, quantity, unit, unit_price)
values (:'co', :'q2', :'pipe', 'HDPE pipe 110mm', 1000, 'm', 20000), (:'co', :'q2', :'inst', 'Installation', 1000, 'm', 8000);
select public.submit_quotation(:'q2');
select public.record_quotation_outcome(:'q2', true, 'PO-88');
select public.create_purchase_order(:'co', :'sup', :'q2') as po \gset
select tests.check((select count(*) from public.po_lines where po_id = :'po') = 1, 'the order takes the goods only, not the installation');
update public.purchase_orders set direct_to_client = true, delivery_location = 'Pump house' where id = :'po';
update public.po_lines set unit_price = 15000 where po_id = :'po';
select tests.blocked(format('select public.record_direct_supply(%L, null, %L, null)', :'po', 'Juma'), 'only an approved order');
select public.submit_purchase_order(:'po');
select public.record_direct_supply(:'po', null, 'Juma (storekeeper)', 'Received in full') as ddn \gset
reset role;
select tests.check((select status from public.deliveries where id = :'ddn') = 'delivered', 'client delivery recorded as delivered');
select tests.check((select quotation_line_id is not null from public.delivery_lines where delivery_id = :'ddn'), 'linked to the quotation line');
select tests.check((select status from public.purchase_orders where id = :'po') = 'received', 'purchase order closed');
select tests.check((select sum(quantity) from public.stock_movements where product_id = :'pipe') = 470, 'stock untouched by direct supply');
select tests.login('boss.sv@s.test'); set role authenticated;
select tests.blocked(format('select public.record_direct_supply(%L, null, null, null)', :'po'), 'cannot record twice');
reset role;

-- ---- 8. Other companies see nothing ------------------------------------------------------------
select tests.login('other.sv@s.test'); set role authenticated;
select tests.check((select count(*) from public.service_jobs) + (select count(*) from public.hire_agreements)
                 + (select count(*) from public.projects) + (select count(*) from public.timesheets)
                 + (select count(*) from public.client_equipment) + (select count(*) from public.service_contracts) = 0,
                   'another company sees none of it');
select tests.blocked(format('select public.invoice_hire(%L, null)', :'hire'), 'another company cannot invoice');
reset role;

-- ---- 9. Clearing test transactions -------------------------------------------------------------
select public.reset_company_transactions(:'co', 'Pipes & Services Ltd');
select tests.check((select count(*) from public.service_jobs where company_id = :'co') = 0
               and (select count(*) from public.hire_agreements where company_id = :'co') = 0
               and (select count(*) from public.timesheets where company_id = :'co') = 0, 'reset clears jobs, hires and hours');
select tests.check((select count(*) from public.projects where company_id = :'co') = 1
               and (select count(*) from public.client_equipment where company_id = :'co') = 1, 'reset keeps projects and equipment');

rollback;
