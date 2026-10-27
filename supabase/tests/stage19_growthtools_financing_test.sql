-- Tests for LPO financing: requests from an order, status steps, the pack data and the reminders.
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

insert into auth.users (email) values ('boss.lf@g.test'), ('sales.lf@g.test'), ('fin.lf@g.test'), ('other.lf@g.test');
select id as boss from auth.users where email = 'boss.lf@g.test' \gset
select id as sales from auth.users where email = 'sales.lf@g.test' \gset
select id as fin from auth.users where email = 'fin.lf@g.test' \gset
select id as outsider from auth.users where email = 'other.lf@g.test' \gset

select tests.login('boss.lf@g.test'); set role authenticated;
select public.create_company('LPO Finance Co') as co \gset
reset role;
select tests.login('other.lf@g.test'); set role authenticated;
select public.create_company('Other Finance Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role) values (:'co', :'sales', 'sales'), (:'co', :'fin', 'finance');
insert into public.clients (company_id, name, tin) values (:'co', 'Kilombero Sugar Co', '100-200-300') returning id as client \gset
insert into public.suppliers (company_id, name) values (:'co', 'Lubes Ltd') returning id as sup \gset
insert into public.suppliers (company_id, name) values (:'co', 'Oils Co') returning id as sup2 \gset

select tests.login('sales.lf@g.test'); set role authenticated;
select public.create_quotation(:'co', :'client', null) as q \gset
insert into public.quotation_lines (company_id, quotation_id, description, quantity, unit, unit_price)
values (:'co', :'q', 'Gear oil 220, 208 L drum', 10, 'drum', 1000000);
reset role;
update public.quotations set client_ref = 'LPO-KSC-0091' where id = :'q';
insert into public.quotation_margins (quotation_id, company_id, revenue_base, cost_base, margin_pct)
values (:'q', :'co', 10000000, 7500000, 25)
on conflict (quotation_id) do update set revenue_base = excluded.revenue_base, cost_base = excluded.cost_base, margin_pct = excluded.margin_pct;

-- A supplier RFQ for the order with two quotes.
insert into public.supplier_rfqs (company_id, quotation_id, title) values (:'co', :'q', 'Gear oil') returning id as srfq \gset
insert into public.supplier_rfq_lines (company_id, srfq_id, description, quantity, unit) values (:'co', :'srfq', 'Gear oil 220', 10, 'drum')
returning id as sline \gset
insert into public.supplier_rfq_suppliers (company_id, srfq_id, supplier_id, status, freight) values
  (:'co', :'srfq', :'sup', 'quoted', 100000) returning id as rs1 \gset
insert into public.supplier_rfq_suppliers (company_id, srfq_id, supplier_id, status) values
  (:'co', :'srfq', :'sup2', 'quoted') returning id as rs2 \gset
insert into public.supplier_quote_lines (company_id, srfq_supplier_id, srfq_line_id, unit_price) values
  (:'co', :'rs1', :'sline', 720000), (:'co', :'rs2', :'sline', 760000);

-- ---- 1. A request needs an accepted order ---------------------------------------------------------
select tests.check((select default_level = 'medium' and module = 'Finance' from public.features where key = 'lpo_financing'),
  'LPO financing: a medium Finance feature');
select tests.login('fin.lf@g.test'); set role authenticated;
select tests.blocked(format('select public.financing_create(%L, %L)', :'q', '{"bank_name": "CRDB Bank"}'),
  'an order that is not accepted yet cannot be financed');
reset role;
select set_config('ims.status_change', 'on', false) as x \gset
update public.quotations set status = 'approved', approved_by = :'boss' where id = :'q';
update public.quotations set status = 'accepted' where id = :'q';
select set_config('ims.status_change', '', false) as x \gset

select tests.login('sales.lf@g.test'); set role authenticated;
select tests.blocked(format('select public.financing_create(%L, %L)', :'q', '{"bank_name": "CRDB Bank"}'), 'sales cannot ask for financing');
select tests.check((select count(*) from public.financing_requests) = 0, 'sales does not see financing requests');
reset role;

select tests.login('fin.lf@g.test'); set role authenticated;
select public.financing_create(:'q', '{"bank_name": " CRDB Bank ", "tenor_days": 60, "interest_rate": 16.5}') as f \gset
select tests.check((select number like 'FIN-____-0001' and status = 'draft' and bank_name = 'CRDB Bank' and client_id = :'client'
                           and lpo_number = 'LPO-KSC-0091' and amount = 7500000 and tenor_days = 60 and currency = 'TZS'
                           and created_by = :'fin' and purpose like 'To pay our suppliers%'
                      from public.financing_requests where id = :'f'),
  'a request from the order: numbered, client and LPO number from the order, amount = cost of the goods');
select tests.blocked(format('select public.financing_create(%L, %L)', :'q', '{"bank_name": "X"}'), 'the bank name is required');
select tests.blocked(format('select public.financing_create(%L, %L)', :'q', '{"bank_name": "NMB", "amount": "lots"}'), 'the amount must be a number');
select tests.blocked(format('update public.financing_requests set status = %L where id = %L', 'approved', :'f'),
  'the status changes only with the buttons');
update public.financing_requests set amount = 7000000, bank_branch = 'Morogoro' where id = :'f';
select tests.check((select amount = 7000000 and bank_branch = 'Morogoro' from public.financing_requests where id = :'f'),
  'the details can be corrected');
select tests.blocked(format('update public.financing_requests set quotation_id = %L where id = %L', :'q', :'f'),
  'the order of a request cannot be changed');
reset role;

-- ---- 2. Status steps ---------------------------------------------------------------------------------
select tests.login('fin.lf@g.test'); set role authenticated;
select tests.blocked(format('select public.financing_set_status(%L, %L, %L)', :'f', 'disbursed', '{}'), 'cannot skip from draft to disbursed');
select public.financing_set_status(:'f', 'submitted', jsonb_build_object('on', (current_date - 20)::text));
select tests.blocked(format('select public.financing_set_status(%L, %L, %L)', :'f', 'declined', '{}'), 'declining needs the bank''s reason');
select tests.blocked(format('select public.financing_set_status(%L, %L, %L)', :'f', 'approved', jsonb_build_object('on', (current_date + 10)::text)),
  'dates in the future are refused');
reset role;

-- No answer for 14 days: a reminder.
select tests.login('fin.lf@g.test'); set role authenticated;
select public.financing_run_alerts(:'co') as a0 \gset
reset role;
select tests.check((select count(*) from public.notifications where kind = 'financing_waiting' and company_id = :'co') = 2,
  'no answer after 14 days: management and finance are reminded to call the bank');

select tests.login('fin.lf@g.test'); set role authenticated;
select public.financing_set_status(:'f', 'approved', '{"approved_amount": 6500000, "bank_reference": "CRDB/LPO/77"}');
select public.financing_set_status(:'f', 'disbursed', jsonb_build_object('on', (current_date - 55)::text));
select tests.check((select status = 'disbursed' and approved_amount = 6500000 and bank_reference = 'CRDB/LPO/77'
                           and repayment_due = current_date + 5 and disbursed_on = current_date - 55
                      from public.financing_requests where id = :'f'),
  'approved for less, disbursed: repayment due = disbursement + tenor');
select public.financing_run_alerts(:'co') as a1 \gset
select tests.check(:'a1' = 2, 'repayment due within the reminder days: management and finance told');
select tests.check(public.financing_run_alerts(:'co') = 0, 'the same reminder is not sent twice');
reset role;
select tests.check((select severity = 'attention' and title = 'Loan repayment due: CRDB Bank' from public.notifications
                     where kind = 'financing_repayment' and user_id = :'boss'), 'the reminder names the bank');
select tests.check((select count(*) from public.notifications where kind = 'financing_repayment' and user_id = :'sales') = 0,
  'sales is not told');

update public.financing_requests set repayment_due = current_date - 3 where id = :'f';
set role service_role;
select tests.check(public.financing_run_all_alerts() = 2, 'overdue: the scheduled job reminds again');
reset role;
select tests.check((select count(*) from public.notifications where kind = 'financing_repayment' and severity = 'critical'
                      and title like 'Loan repayment overdue%') = 2, 'overdue reminders are critical');

-- ---- 3. The pack -----------------------------------------------------------------------------------------
select tests.login('fin.lf@g.test'); set role authenticated;
select public.financing_pack(:'f') as pk \gset
select tests.check((:'pk'::jsonb #>> '{quotation,client_ref}') = 'LPO-KSC-0091'
                   and (:'pk'::jsonb #>> '{client,name}') = 'Kilombero Sugar Co'
                   and (:'pk'::jsonb #>> '{margin,cost_base}')::numeric = 7500000,
  'pack: the order, the client and the cost');
select tests.check(jsonb_array_length(:'pk'::jsonb -> 'supplier_quotes') = 2
                   and (select (x ->> 'total')::numeric from jsonb_array_elements(:'pk'::jsonb -> 'supplier_quotes') x
                         where x ->> 'supplier' = 'Lubes Ltd') = 7300000,
  'pack: both supplier quotes with their totals (prices x quantities + freight)');
select tests.check(jsonb_array_length(:'pk'::jsonb -> 'compliance') = 6
                   and (select bool_and(x ->> 'status' is null) from jsonb_array_elements(:'pk'::jsonb -> 'compliance') x),
  'pack: the six company papers are listed (none on the checklist yet)');
select tests.check(jsonb_array_length(:'pk'::jsonb #> '{cash,months}') = 6 and (:'pk'::jsonb #>> '{client_record,invoices}')::int = 0,
  'pack: six months of money in and out, and the client record');
reset role;
select tests.login('sales.lf@g.test'); set role authenticated;
select tests.blocked(format('select public.financing_pack(%L)', :'f'), 'sales cannot read the pack');
reset role;
select tests.login('other.lf@g.test'); set role authenticated;
select tests.blocked(format('select public.financing_pack(%L)', :'f'), 'another company cannot read the pack');
select tests.check((select count(*) from public.financing_requests where company_id = :'co') = 0, 'another company sees no requests');
reset role;

-- ---- 4. Closing ---------------------------------------------------------------------------------------------
select tests.login('fin.lf@g.test'); set role authenticated;
select public.financing_set_status(:'f', 'repaid', '{}');
select tests.check((select status = 'repaid' and repaid_on = current_date from public.financing_requests where id = :'f'), 'repaid');
select tests.blocked(format('update public.financing_requests set amount = 1 where id = %L', :'f'), 'a closed request cannot change amounts');
delete from public.financing_requests where id = :'f';
select tests.check((select count(*) from public.financing_requests where id = :'f') = 1, 'finance cannot delete');
select public.financing_create(:'q', '{"bank_name": "NMB Bank", "amount": "5000000"}') as f2 \gset
select public.financing_set_status(:'f2', 'cancelled', '{"note": "Paid from our own cash"}');
select public.financing_set_status(:'f2', 'draft', '{}');
select tests.check((select status = 'draft' and decision_note is null from public.financing_requests where id = :'f2'), 'a cancelled request can be tried again');
reset role;
select tests.login('boss.lf@g.test'); set role authenticated;
delete from public.financing_requests where id = :'f2';
select tests.check((select count(*) from public.financing_requests where id = :'f2') = 0, 'management deletes a draft');
reset role;

-- Clearing test transactions removes the requests with the orders.
select public.reset_company_transactions(:'co', 'LPO Finance Co') as msg \gset
select tests.check((select count(*) from public.financing_requests where company_id = :'co') = 0, 'clearing test transactions removes the requests');
