-- Tests for payroll: PAYE, NSSF, SDL, WCF, overtime, unpaid leave, approval, payslips and the ledger.
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
create or replace function tests.bal(p_company uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.gl_lines l join public.gl_accounts a on a.id = l.account_id
   where a.company_id = p_company and a.system_key = p_key;
$$;
grant execute on all functions in schema tests to authenticated, anon;

-- PAYE bands (Tanzania mainland, monthly).
select tests.check(public.paye_from_bands(d.b, 270000) = 0 and public.paye_from_bands(d.b, 520000) = 20000
                   and public.paye_from_bands(d.b, 760000) = 68000 and public.paye_from_bands(d.b, 1000000) = 128000
                   and public.paye_from_bands(d.b, 1500000) = 278000 and public.paye_from_bands(d.b, 400000) = 10400,
  'PAYE bands: 0 / 20,000 / 68,000 / 128,000 / 278,000 / 10,400')
  from (select '[{"from": 0, "rate": 0}, {"from": 270000, "rate": 8}, {"from": 520000, "rate": 20}, {"from": 760000, "rate": 25}, {"from": 1000000, "rate": 30}]'::jsonb as b) d;

insert into auth.users (email) values ('boss.pr@g.test'), ('fin.pr@g.test'), ('tech.pr@g.test'), ('sales.pr@g.test');
select id as tech from auth.users where email = 'tech.pr@g.test' \gset

select tests.login('boss.pr@g.test'); set role authenticated;
select public.create_company('Payroll Co') as co \gset
reset role;
insert into public.memberships (company_id, user_id, role)
select :'co', id, r::public.app_role from (values ('fin.pr@g.test', 'finance'), ('tech.pr@g.test', 'warehouse'), ('sales.pr@g.test', 'sales')) v(e, r)
  join auth.users u on u.email = v.e;

select tests.login('boss.pr@g.test'); set role authenticated;
insert into public.employees (company_id, user_id, full_name, job_title, start_date) values (:'co', :'tech', 'Tumaini Tech', 'Technician', '2026-01-01')
returning id as e1 \gset
insert into public.employees (company_id, full_name, job_title, start_date) values (:'co', 'Mama Manager', 'Manager', '2026-01-01') returning id as e2 \gset
insert into public.employees (company_id, full_name, job_title, start_date) values (:'co', 'Late Starter', 'Clerk', '2026-12-01') returning id as e3 \gset
reset role;

-- ---- 1. Pay details are private ------------------------------------------------------------------
select tests.login('fin.pr@g.test'); set role authenticated;
select tests.blocked(format('select public.create_payroll_run(%L, %L, null)', :'co', '2026-09-01'), 'no run before pay details are entered');
insert into public.employee_pay (employee_id, company_id, basic_salary, transport_allowance, monthly_deduction, deduction_label, pay_method, mobile_number)
values (:'e1', :'co', 800000, 100000, 50000, 'Salary advance', 'mobile_money', '0754000000');
insert into public.employee_pay (employee_id, company_id, basic_salary, housing_allowance, pays_overtime)
values (:'e2', :'co', 2500000, 500000, false);
insert into public.employee_pay (employee_id, company_id, basic_salary) values (:'e3', :'co', 500000);
reset role;
select tests.login('tech.pr@g.test'); set role authenticated;
select tests.check((select count(*) from public.employee_pay) = 0, 'staff cannot see pay details, not even their own record');
select tests.blocked(format('select public.create_payroll_run(%L, %L, null)', :'co', '2026-09-01'), 'staff cannot run payroll');
reset role;

-- ---- 2. Overtime from an approved timesheet week and unpaid leave ----------------------------------
-- Week of Monday 7 September 2026: 50 hours, approved: 5 hours above 45.
insert into public.timesheet_weeks (company_id, user_id, week_start, status, hours) values (:'co', :'tech', '2026-09-07', 'approved', 50);
select tests.login('tech.pr@g.test'); set role authenticated;
select public.request_leave(:'e1', 'unpaid', '2026-09-21', '2026-09-22', 'Personal') as lv \gset
reset role;
select tests.login('boss.pr@g.test'); set role authenticated;
select public.decide_leave(:'lv', true, null);
reset role;

select tests.login('fin.pr@g.test'); set role authenticated;
select public.create_payroll_run(:'co', '2026-09-15', null) as run \gset
select tests.check((select period = '2026-09-01' and pay_date = '2026-09-30' and employees = 2 from public.payroll_runs where id = :'run'),
  'September run: 2 people (the one starting in December is left out), paid on the last day');
select tests.blocked(format('select public.create_payroll_run(%L, %L, null)', :'co', '2026-09-30'), 'one run per month');
select * from public.payroll_lines where employee_id = :'e1' \gset l_
-- Tech: basic 800,000, allowance 100,000; overtime 5h x 1.5 x 800,000/195 = 30,769; unpaid 2 of 22 working days = 72,727.
select tests.check(:'l_overtime_hours'::numeric = 5 and :'l_overtime'::numeric = 30769, 'overtime: 5 hours at 1.5 x hourly basic = 30,769');
select tests.check(:'l_unpaid_days'::numeric = 2 and :'l_unpaid_deduction'::numeric = 72727, 'unpaid leave: 2 of 22 working days = 72,727');
select tests.check(:'l_gross'::numeric = 858042, 'gross 800,000 + 100,000 + 30,769 - 72,727 = 858,042');
select tests.check(:'l_nssf_employee'::numeric = 85804 and :'l_taxable'::numeric = 772238, 'NSSF 10% = 85,804; taxable 772,238');
select tests.check(:'l_paye'::numeric = 71060, 'PAYE: 68,000 + 25% of 12,238 = 71,060');
select tests.check(:'l_other_deductions'::numeric = 50000 and :'l_net'::numeric = 858042 - 85804 - 71060 - 50000, 'net after the salary advance');
select tests.check(:'l_sdl'::numeric = 0 and :'l_wcf'::numeric = 4290 and :'l_nssf_employer'::numeric = 85804,
  'fewer than 10 employees: no SDL; WCF 0.5% = 4,290; employer NSSF 85,804');
select tests.check((select overtime_hours from public.payroll_lines where employee_id = :'e2') = 0, 'no overtime for someone not paid overtime');

select public.update_payroll_line(:'l_id', null, 100000, null, null);
select tests.check((select gross from public.payroll_lines where id = :'l_id') = 958042, 'a bonus raises gross pay');
select tests.check((select gross from public.payroll_runs where id = :'run') =
                   (select sum(gross) from public.payroll_lines where run_id = :'run'), 'run totals follow the payslips');
select tests.blocked(format('select public.approve_payroll_run(%L)', :'run'), 'finance cannot approve payroll');
reset role;

select tests.login('tech.pr@g.test'); set role authenticated;
select tests.check((select count(*) from public.payroll_lines) = 0 and (select count(*) from public.my_payslips(:'co')) = 0,
  'a draft payslip is not shown to the employee');
reset role;

-- ---- 3. Approve: posted to the ledger --------------------------------------------------------------
select tests.login('boss.pr@g.test'); set role authenticated;
select public.approve_payroll_run(:'run');
reset role;
select * from public.payroll_runs where id = :'run' \gset r_
select tests.check(tests.bal(:'co', 'salaries') = :'r_gross'::numeric
                   and tests.bal(:'co', 'paye_payable') = -:'r_paye'::numeric
                   and tests.bal(:'co', 'nssf_payable') = -(:'r_nssf_employee'::numeric + :'r_nssf_employer'::numeric)
                   and tests.bal(:'co', 'salaries_payable') = -:'r_net'::numeric
                   and tests.bal(:'co', 'deductions_payable') = -50000,
  'approved: salaries, PAYE, NSSF, deductions and net pay are in the books');
select tests.check((select sum(debit) = sum(credit) from public.gl_lines where company_id = :'co'), 'payroll journal balances');
select tests.check((select count(*) from public.notifications where user_id = :'tech' and kind = 'payslip') = 1, 'the employee is told the payslip is ready');

select tests.login('tech.pr@g.test'); set role authenticated;
select tests.check((select count(*) from public.payroll_lines) = 1 and (select employee_id from public.payroll_lines) = :'e1',
  'the employee sees only their own payslip');
select tests.check((select count(*) from public.my_payslips(:'co')) = 1, 'my payslips list');
select tests.check((select count(*) from public.payroll_runs) = 0, 'the employee does not see the run totals');
reset role;
select tests.login('sales.pr@g.test'); set role authenticated;
select tests.check((select count(*) from public.payroll_lines) = 0, 'others see no payslips');
reset role;

select tests.login('fin.pr@g.test'); set role authenticated;
select tests.blocked(format('select public.update_payroll_line(%L, 1, 1, 1, 1)', :'l_id'), 'an approved run cannot be changed');
select tests.blocked(format('select public.cancel_payroll_run(%L)', :'run'), 'finance cannot cancel an approved run');
select public.pay_payroll_run(:'run', '2026-09-30', 'bank_transfer');
select tests.check(tests.bal(:'co', 'salaries_payable') = 0 and tests.bal(:'co', 'bank') = -:'r_net'::numeric, 'paid: net pay leaves the bank');
select public.pay_statutory(:'co', 'paye', :'r_paye'::numeric, '2026-10-07', 'bank_transfer', 'TRA PRN 99');
select tests.check(tests.bal(:'co', 'paye_payable') = 0, 'PAYE paid to TRA');
select tests.blocked(format('select public.pay_statutory(%L, %L, 10, null, null, null)', :'co', 'lunch'), 'unknown statutory kind refused');
select tests.blocked(format('update public.payroll_runs set status = %L where id = %L', 'draft', :'run'), 'status only through the buttons');
reset role;

-- ---- 4. Cancel and SDL ------------------------------------------------------------------------------
select tests.login('boss.pr@g.test'); set role authenticated;
select public.save_payroll_settings(:'co', '{"sdl_min_employees": 2}'::jsonb);
select tests.blocked(format('select public.save_payroll_settings(%L, %L::jsonb)', :'co', '{"paye_bands": [{"from": 0, "rate": 150}]}'),
  'a tax rate above 100% is refused');
select public.create_payroll_run(:'co', '2026-10-01', null) as run2 \gset
select tests.check((select sdl from public.payroll_lines where run_id = :'run2' and employee_id = :'e2') = 105000,
  'with SDL on: 3.5% of 3,000,000 = 105,000');
select public.approve_payroll_run(:'run2');
select public.cancel_payroll_run(:'run2');
reset role;
select tests.check(tests.bal(:'co', 'sdl_payable') = 0 and (select status from public.payroll_runs where id = :'run2') = 'cancelled',
  'cancelling an approved run reverses its journal');
select tests.login('fin.pr@g.test'); set role authenticated;
select public.create_payroll_run(:'co', '2026-10-01', null) as run3 \gset
select tests.check(:'run3' is not null, 'a cancelled month can be run again');
reset role;

-- ---- 5. Clearing test transactions ------------------------------------------------------------------
select public.reset_company_transactions(:'co', 'Payroll Co') as msg \gset
select tests.check((select count(*) from public.payroll_runs where company_id = :'co') = 0
                   and (select count(*) from public.gl_journals where company_id = :'co') = 0
                   and (select count(*) from public.employees where company_id = :'co') = 3
                   and (select count(*) from public.employee_pay where company_id = :'co') = 3,
  'clearing test data removes pay runs and journals, keeps employees and pay details');

set role anon;
select tests.blocked('select count(*) from public.payroll_lines', 'anon: no payslips');
reset role;
