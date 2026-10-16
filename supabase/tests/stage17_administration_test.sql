-- Tests for the Administration package: employees, leave, timesheet approval, HSE, quality, actions.
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
grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (email) values ('boss.ad@g.test'), ('tech.ad@g.test'), ('driver.ad@g.test'), ('fin.ad@g.test'), ('other.ad@g.test');
select id as boss from auth.users where email = 'boss.ad@g.test' \gset
select id as tech from auth.users where email = 'tech.ad@g.test' \gset
select id as driver from auth.users where email = 'driver.ad@g.test' \gset
select id as fin from auth.users where email = 'fin.ad@g.test' \gset
select id as outsider from auth.users where email = 'other.ad@g.test' \gset
update public.profiles set full_name = 'Tumaini Tech' where id = :'tech';

select tests.login('boss.ad@g.test'); set role authenticated;
select public.create_company('Admin Co') as co \gset
reset role;
select tests.login('other.ad@g.test'); set role authenticated;
select public.create_company('Other Admin Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
values (:'co', :'tech', 'warehouse'), (:'co', :'driver', 'driver'), (:'co', :'fin', 'finance');
insert into public.suppliers (company_id, name) values (:'co', 'Valves Ltd') returning id as sup \gset
insert into public.suppliers (company_id, name) values (:'other', 'Other Supplier') returning id as osup \gset

-- ---- 1. Employees -------------------------------------------------------------------------
select tests.login('boss.ad@g.test'); set role authenticated;
insert into public.employees (company_id, user_id, full_name, job_title, employment_type, start_date, contract_end, nssf_no)
values (:'co', :'tech', 'Tumaini Tech', 'Technician', 'contract', '2026-01-05', (current_date + 20), 'NSSF-1')
returning id as emp_tech, employee_no as no_tech \gset
insert into public.employees (company_id, user_id, full_name, job_title)
values (:'co', :'driver', 'Dereva Driver', 'Driver') returning id as emp_driver \gset
insert into public.employees (company_id, full_name, job_title) values (:'co', 'Casual Cleaner', 'Cleaner') returning id as emp_casual \gset
select tests.check(:'no_tech' = 'EMP-001', 'employee numbers are given: EMP-001');
select tests.blocked(format('insert into public.employees (company_id, user_id, full_name) values (%L, %L, %L)', :'co', :'outsider', 'Stranger'),
  'a login that is not in the team cannot be linked');
select tests.blocked(format('update public.employees set status = %L where id = %L', 'left', :'emp_casual'),
  'status only through Mark as left');
insert into public.employee_certificates (company_id, employee_id, name, expires_on)
values (:'co', :'emp_tech', 'Working at height', current_date + 10),
       (:'co', :'emp_driver', 'Driving licence class C', current_date - 1);
reset role;

select tests.login('tech.ad@g.test'); set role authenticated;
select tests.check((select count(*) from public.employees) = 1 and (select id from public.employees) = :'emp_tech',
  'a team member sees only their own employee file');
select tests.check((select count(*) from public.employee_certificates) = 1, 'and only their own certificates');
update public.employees set job_title = 'Boss' where id = :'emp_tech';
select tests.check((select job_title from public.employees where id = :'emp_tech') = 'Technician', 'a team member cannot edit their file');
select tests.check(public.my_employee_id(:'co') = :'emp_tech', 'my_employee_id finds the file');
reset role;

select tests.login('fin.ad@g.test'); set role authenticated;
select tests.check((select count(*) from public.employees) = 3, 'finance reads all employee files (payroll)');
select tests.blocked(format('insert into public.employees (company_id, full_name) values (%L, %L)', :'co', 'Fin Hire'),
  'finance cannot add employees');
reset role;

select tests.login('other.ad@g.test'); set role authenticated;
select tests.check((select count(*) from public.employees where company_id = :'co') = 0, 'another company sees no employees');
reset role;

-- ---- 2. Leave -----------------------------------------------------------------------------------
select tests.login('tech.ad@g.test'); set role authenticated;
-- Monday 2 November 2026 to Friday 6 November: 5 working days; the weekend after is not counted.
select public.request_leave(:'emp_tech', 'annual', '2026-11-02', '2026-11-08', 'Family visit') as lv \gset
select tests.check((select days from public.leave_requests where id = :'lv') = 5, 'leave counts working days only (5)');
select tests.blocked(format('select public.request_leave(%L, %L, %L, %L, null)', :'emp_tech', 'annual', '2026-11-04', '2026-11-05'),
  'overlapping leave refused');
select tests.blocked(format('select public.request_leave(%L, %L, %L, %L, null)', :'emp_driver', 'annual', '2026-12-01', '2026-12-02'),
  'cannot ask for leave for someone else');
select tests.blocked(format('select public.request_leave(%L, %L, %L, %L, null)', :'emp_tech', 'annual', '2026-11-14', '2026-11-15'),
  'weekend-only leave refused');
select tests.blocked(format('select public.decide_leave(%L, true, null)', :'lv'), 'cannot approve own leave');
reset role;
select tests.check((select count(*) from public.notifications where user_id = :'boss' and kind = 'leave_request') = 1,
  'management is told about the leave request');

select tests.login('boss.ad@g.test'); set role authenticated;
select public.decide_leave(:'lv', true, 'Enjoy');
select tests.check((public.leave_balance(:'emp_tech', 2026) ->> 'left')::numeric = 23, 'balance: 28 - 5 = 23 days left');
select tests.blocked(format('select public.decide_leave(%L, false, null)', :'lv'), 'cannot answer twice');
select public.request_leave(:'emp_driver', 'sick', '2026-11-10', '2026-11-10', null) as lv2 \gset
select public.decide_leave(:'lv2', false, 'No note from the doctor');
reset role;
select tests.check((select count(*) from public.notifications where user_id = :'tech' and kind = 'leave_decided') = 1,
  'the employee is told the decision');

select tests.login('tech.ad@g.test'); set role authenticated;
select tests.check((select count(*) from public.leave_requests) = 1, 'a team member sees only their own leave');
select public.cancel_leave(:'lv');
select tests.check((select status from public.leave_requests where id = :'lv') = 'cancelled', 'own future leave can be cancelled');
select tests.blocked(format('select public.cancel_leave(%L)', :'lv2'), 'cannot cancel someone else''s leave');
reset role;

-- ---- 3. Timesheet weeks ----------------------------------------------------------------------------
select public.monday_of(current_date) as wk \gset
select tests.login('tech.ad@g.test'); set role authenticated;
select tests.blocked(format('select public.submit_timesheet_week(%L, %L)', :'co', :'wk'), 'an empty week cannot be submitted');
insert into public.timesheets (company_id, work_date, hours, description) values (:'co', :'wk', 8, 'Pump install') returning id as ts \gset
insert into public.timesheets (company_id, work_date, hours, description) values (:'co', (:'wk'::date + 1), 6, 'Pump service');
select public.submit_timesheet_week(:'co', (:'wk'::date + 3)) as tw \gset
select tests.check((select hours from public.timesheet_weeks where id = :'tw') = 14 and
                   (select week_start from public.timesheet_weeks where id = :'tw') = :'wk'::date,
  'submitting any day files the whole week (14 hours)');
select tests.blocked(format('update public.timesheets set hours = 9 where id = %L', :'ts'), 'submitted hours are locked');
select tests.blocked(format('delete from public.timesheets where id = %L', :'ts'), 'submitted hours cannot be removed');
select tests.blocked(format('insert into public.timesheets (company_id, work_date, hours) values (%L, %L, 2)', :'co', :'wk'),
  'no new hours in a submitted week');
select tests.blocked(format('select public.decide_timesheet_week(%L, true, null)', :'tw'), 'cannot approve own week');
reset role;

select tests.login('boss.ad@g.test'); set role authenticated;
select tests.blocked(format('select public.decide_timesheet_week(%L, false, %L)', :'tw', ''), 'sending back needs a note');
select public.decide_timesheet_week(:'tw', false, 'Add the job number');
reset role;
select tests.login('tech.ad@g.test'); set role authenticated;
update public.timesheets set description = 'Pump install JOB-0001' where id = :'ts';
select tests.check(public.submit_timesheet_week(:'co', :'wk') = :'tw', 'a returned week can be fixed and submitted again');
reset role;
select tests.login('boss.ad@g.test'); set role authenticated;
select public.decide_timesheet_week(:'tw', true, null);
select tests.check((select status from public.timesheet_weeks where id = :'tw') = 'approved', 'manager approves the week');
update public.timesheets set hours = 7.5 where id = :'ts';
select tests.check((select hours from public.timesheets where id = :'ts') = 7.5, 'management can still correct approved hours');
reset role;
select tests.login('tech.ad@g.test'); set role authenticated;
select tests.blocked(format('select public.submit_timesheet_week(%L, %L)', :'co', :'wk'), 'an approved week cannot be submitted again');
reset role;
select tests.login('driver.ad@g.test'); set role authenticated;
select tests.check((select count(*) from public.timesheet_weeks) = 0, 'others do not see someone''s weeks');
reset role;
select tests.login('boss.ad@g.test'); set role authenticated;
select public.reopen_timesheet_week(:'tw');
reset role;
select tests.login('tech.ad@g.test'); set role authenticated;
update public.timesheets set hours = 8 where id = :'ts';
select tests.check((select hours from public.timesheets where id = :'ts') = 8, 'a reopened week can be changed again');
reset role;

-- ---- 4. Health & safety ------------------------------------------------------------------------------
select tests.login('driver.ad@g.test'); set role authenticated;
insert into public.hse_incidents (company_id, occurred_at, site, kind, severity, title, description, immediate_action)
values (:'co', now() - interval '2 hours', 'Geita pit 3', 'vehicle', 'high', 'Truck slid into ditch', 'Wet road, no injuries', 'Area closed')
returning id as inc, number as inc_no \gset
select tests.check(:'inc_no' = 'INC-0001', 'incidents are numbered');
select tests.check((select count(*) from public.hse_incidents) = 1, 'the reporter sees their incident');
update public.hse_incidents set root_cause = 'x' where id = :'inc';
select tests.check((select root_cause from public.hse_incidents where id = :'inc') is null, 'the reporter cannot investigate');
select tests.blocked(format('insert into public.hse_incidents (company_id, occurred_at, kind, title, description) values (%L, now() + interval %L, %L, %L, %L)',
  :'co', '2 days', 'other', 'Future', 'Not yet'), 'an incident cannot be in the future');
reset role;
select tests.check((select severity from public.notifications where user_id = :'boss' and kind = 'hse_incident') = 'attention',
  'management is told at once (high = attention)');

select tests.login('tech.ad@g.test'); set role authenticated;
select tests.check((select count(*) from public.hse_incidents) = 0, 'others do not see the incident');
insert into public.hse_inspections (company_id, inspected_on, kind, topic, result, attendees, attendee_count)
values (:'co', current_date, 'toolbox_talk', 'Working near haul roads', 'pass', 'Whole crew', 12) returning id as insp, number as insp_no \gset
select tests.check(:'insp_no' = 'INSP-0001', 'inspections are numbered');
reset role;

select tests.login('boss.ad@g.test'); set role authenticated;
update public.hse_incidents set root_cause = 'No drainage on the road', lost_days = 0 where id = :'inc';
select public.set_admin_status('incident', :'inc', 'investigating');
insert into public.corrective_actions (company_id, source_kind, source_id, action, owner_id, due_on)
values (:'co', 'incident', :'inc', 'Dig drainage on the haul road', :'tech', current_date - 1) returning id as act \gset
select tests.blocked(format('insert into public.corrective_actions (company_id, source_kind, source_id, action) values (%L, %L, %L, %L)',
  :'co', 'ncr', :'inc', 'Wrong kind'), 'an action must point at a real record');
select tests.blocked(format('select public.set_admin_status(%L, %L, %L)', 'incident', :'inc', 'closed'),
  'cannot close with open actions');
select (public.admin_summary(:'co')) as s \gset
select tests.check((:'s'::jsonb ->> 'incidents_open')::int = 1 and (:'s'::jsonb ->> 'actions_overdue')::int = 1
                   and (:'s'::jsonb ->> 'certs_expired')::int = 1 and (:'s'::jsonb ->> 'certs_expiring')::int = 1
                   and (:'s'::jsonb ->> 'contracts_ending')::int = 1,
  'summary: open incident, overdue action, expired and expiring certificates, contract ending');
reset role;
select tests.check((select count(*) from public.notifications where user_id = :'tech' and kind = 'corrective_action') = 1,
  'the owner is told about the action');

select tests.login('tech.ad@g.test'); set role authenticated;
select tests.check((select count(*) from public.corrective_actions) = 1, 'the owner sees their action');
select tests.check((public.admin_summary(:'co') ->> 'my_actions_overdue')::int = 1 and not (public.admin_summary(:'co') ->> 'manager')::boolean,
  'the owner''s summary shows their overdue action, no company figures');
select tests.blocked(format('select public.finish_corrective_action(%L, true, %L)', :'act', ''), 'done needs a note');
select tests.blocked(format('select public.finish_corrective_action(%L, false, null)', :'act'), 'the owner cannot cancel');
select public.finish_corrective_action(:'act', true, 'Drain dug and gravelled');
reset role;
select tests.login('boss.ad@g.test'); set role authenticated;
select public.set_admin_status('incident', :'inc', 'closed');
select tests.check((select status from public.hse_incidents where id = :'inc') = 'closed', 'incident closed once actions are done');
select tests.blocked(format('update public.hse_incidents set status = %L where id = %L', 'open', :'inc'), 'status only through the buttons');
reset role;

-- ---- 5. Quality ------------------------------------------------------------------------------------------
select tests.login('tech.ad@g.test'); set role authenticated;
insert into public.quality_ncrs (company_id, source, title, description, supplier_id, quantity_affected)
values (:'co', 'supplier', 'Valves leaking', '6 of 20 valves leak at test pressure', :'sup', 6) returning id as ncr, number as ncr_no \gset
select tests.check(:'ncr_no' = 'NCR-0001', 'NCRs are numbered');
update public.quality_ncrs set disposition = 'return_to_supplier', root_cause = 'Bad seals' where id = :'ncr';
select tests.blocked(format('select public.set_admin_status(%L, %L, %L)', 'ncr', :'ncr', 'closed'), 'only management closes an NCR');
select tests.blocked(format('insert into public.quality_ncrs (company_id, source, title, description, supplier_id) values (%L, %L, %L, %L, %L)',
  :'co', 'supplier', 'Wrong supplier', 'Other company''s supplier', :'osup'), 'cannot point at another company''s supplier');
reset role;
select tests.login('driver.ad@g.test'); set role authenticated;
select tests.check((select count(*) from public.quality_ncrs) = 0, 'drivers do not see NCRs');
select tests.blocked(format('insert into public.quality_ncrs (company_id, title, description) values (%L, %L, %L)', :'co', 'Mine', 'x x x'),
  'drivers cannot raise NCRs');
reset role;
select tests.login('fin.ad@g.test'); set role authenticated;
select tests.check((select count(*) from public.quality_ncrs) = 1, 'finance sees NCRs');
reset role;
select tests.login('boss.ad@g.test'); set role authenticated;
select public.set_admin_status('ncr', :'ncr', 'closed');
select tests.check((select status from public.quality_ncrs where id = :'ncr') = 'closed' and
                   (select closed_by from public.quality_ncrs where id = :'ncr') = :'boss', 'management closes the NCR');
reset role;
select tests.login('tech.ad@g.test'); set role authenticated;
update public.quality_ncrs set cost = 5 where id = :'ncr';
select tests.check((select cost from public.quality_ncrs where id = :'ncr') = 0, 'a closed NCR cannot be changed by its author');
reset role;

-- ---- 6. Employees leave, anon --------------------------------------------------------------------------
select tests.login('boss.ad@g.test'); set role authenticated;
select public.set_employee_status(:'emp_casual', 'left', current_date, 'End of season');
select tests.check((select status from public.employees where id = :'emp_casual') = 'left', 'mark as left');
select tests.blocked(format('select public.request_leave(%L, %L, %L, %L, null)', :'emp_casual', 'annual', '2026-12-01', '2026-12-02'),
  'no leave for someone who left');
select tests.check((public.admin_summary(:'co') ->> 'employees')::int = 2, 'people who left are not counted');
reset role;
select tests.login('tech.ad@g.test'); set role authenticated;
select tests.blocked(format('select public.set_employee_status(%L, %L, null, null)', :'emp_casual', 'active'), 'only management changes status');
reset role;

set role anon;
select tests.blocked('select count(*) from public.employees', 'anon: no employees');
select tests.blocked(format('select public.admin_summary(%L)', :'co'), 'anon: no summary');
reset role;
