-- =====================================================================
-- Payroll for Tanzania: monthly pay runs with PAYE, NSSF, SDL and WCF,
-- payslips, overtime from approved timesheets, unpaid leave from HR,
-- and the journals posted to the ledger.
--
--   Gross     = basic + allowances + overtime + bonus - unpaid leave
--   NSSF      = 10% of gross from the employee, 10% from the employer
--   Taxable   = gross - employee NSSF
--   PAYE      = monthly bands (Tanzania mainland, from July 2022):
--                 up to 270,000            0%
--                 270,000 - 520,000        8%  of the part above 270,000
--                 520,000 - 760,000       20,000 + 20% above 520,000
--                 760,000 - 1,000,000     68,000 + 25% above 760,000
--                 above 1,000,000        128,000 + 30% above 1,000,000
--   SDL       = 3.5% of gross, employer, when the company has 10 or more employees
--   WCF       = 0.5% of gross, employer (private sector)
--   Overtime  = hours above 45 in an approved timesheet week, at 1.5 x (basic / 195)
--
-- The rates are settings: management can change them when the law changes.
--
-- Approving a run posts:
--   Dr Salaries and wages, Employer NSSF, SDL, WCF
--   Cr PAYE payable, NSSF payable, SDL payable, WCF payable, Other deductions, Salaries payable
-- Paying it: Dr Salaries payable, Cr Bank / Cash / Mobile money.
-- Paying TRA, NSSF or WCF: Dr the payable, Cr Bank.
--
-- Pay is private: only management and finance see pay details and runs;
-- each employee sees their own payslips once a run is approved.
-- Safe to run more than once.
-- =====================================================================

insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('payroll', 'Payroll (PAYE, NSSF, SDL, WCF)',
 'Monthly payroll with PAYE, NSSF, SDL and WCF worked out for you, overtime from approved timesheets, unpaid leave, payslips on each person''s phone, and the journals posted to the accounts.',
 'HR & safety', 'medium', 'live', 'Companies paying salaries every month.',
 'Payroll in minutes, correct statutory figures for TRA, NSSF and WCF returns, and payslips nobody has to print.',
 '[{"title": "Pay details", "body": "Open Payroll → Pay details and enter each employee''s basic salary, allowances and how they are paid."},
   {"title": "Run the month", "body": "Press New pay run and choose the month. Overtime from approved timesheets and unpaid leave are filled in; add bonuses or deductions, then management approves."},
   {"title": "Pay and file", "body": "Mark the run paid when the money has gone out. The run shows the PAYE, NSSF, SDL and WCF totals to pay and file; record those payments from the run too."}]'::jsonb,
 '/payroll', 478)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Settings and pay details
-- ---------------------------------------------------------------------
create table if not exists public.payroll_settings (
  company_id          uuid primary key references public.companies (id) on delete cascade,
  paye_bands          jsonb not null default '[{"from": 0, "rate": 0}, {"from": 270000, "rate": 8}, {"from": 520000, "rate": 20}, {"from": 760000, "rate": 25}, {"from": 1000000, "rate": 30}]'::jsonb,
  nssf_employee_pct   numeric(5, 2) not null default 10 check (nssf_employee_pct between 0 and 50),
  nssf_employer_pct   numeric(5, 2) not null default 10 check (nssf_employer_pct between 0 and 50),
  sdl_pct             numeric(5, 2) not null default 3.5 check (sdl_pct between 0 and 20),
  sdl_min_employees   integer not null default 10 check (sdl_min_employees between 0 and 10000),
  wcf_pct             numeric(5, 2) not null default 0.5 check (wcf_pct between 0 and 20),
  overtime_after_hours numeric(5, 2) not null default 45 check (overtime_after_hours between 0 and 168),
  overtime_factor     numeric(4, 2) not null default 1.5 check (overtime_factor between 1 and 5),
  monthly_hours       numeric(6, 2) not null default 195 check (monthly_hours between 1 and 744),
  updated_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now()
);

create table if not exists public.employee_pay (
  employee_id       uuid primary key,
  company_id        uuid not null references public.companies (id) on delete cascade,
  basic_salary      numeric(18, 2) not null default 0 check (basic_salary >= 0),
  housing_allowance numeric(18, 2) not null default 0 check (housing_allowance >= 0),
  transport_allowance numeric(18, 2) not null default 0 check (transport_allowance >= 0),
  other_allowance   numeric(18, 2) not null default 0 check (other_allowance >= 0),
  monthly_deduction numeric(18, 2) not null default 0 check (monthly_deduction >= 0),
  deduction_label   text check (deduction_label is null or char_length(deduction_label) <= 80),
  nssf_member       boolean not null default true,
  paye_exempt       boolean not null default false,
  pays_overtime     boolean not null default true,
  pay_method        text not null default 'bank_transfer' check (pay_method in ('bank_transfer', 'cash', 'mobile_money')),
  bank_name         text check (bank_name is null or char_length(bank_name) <= 80),
  bank_account      text check (bank_account is null or char_length(bank_account) <= 60),
  mobile_number     text check (mobile_number is null or char_length(mobile_number) <= 30),
  updated_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- 2. Pay runs and payslips
-- ---------------------------------------------------------------------
create table if not exists public.payroll_runs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  number          text not null,
  period          date not null check (extract(day from period) = 1),
  status          text not null default 'draft' check (status in ('draft', 'approved', 'paid', 'cancelled')),
  pay_date        date,
  employees       integer not null default 0,
  gross           numeric(18, 2) not null default 0,
  nssf_employee   numeric(18, 2) not null default 0,
  paye            numeric(18, 2) not null default 0,
  deductions      numeric(18, 2) not null default 0,
  net             numeric(18, 2) not null default 0,
  nssf_employer   numeric(18, 2) not null default 0,
  sdl             numeric(18, 2) not null default 0,
  wcf             numeric(18, 2) not null default 0,
  notes           text check (notes is null or char_length(notes) <= 1000),
  approved_by     uuid references auth.users (id) on delete set null,
  approved_at     timestamptz,
  paid_by         uuid references auth.users (id) on delete set null,
  paid_at         timestamptz,
  paid_method     text,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, number)
);
create unique index if not exists payroll_runs_period_key on public.payroll_runs (company_id, period) where status <> 'cancelled';

create table if not exists public.payroll_lines (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  run_id            uuid not null,
  employee_id       uuid not null,
  employee_name     text not null,
  employee_no       text,
  job_title         text,
  basic             numeric(18, 2) not null default 0 check (basic >= 0),
  allowances        numeric(18, 2) not null default 0 check (allowances >= 0),
  overtime_hours    numeric(7, 2) not null default 0 check (overtime_hours >= 0),
  overtime          numeric(18, 2) not null default 0 check (overtime >= 0),
  bonus             numeric(18, 2) not null default 0 check (bonus >= 0),
  unpaid_days       numeric(5, 1) not null default 0 check (unpaid_days >= 0),
  unpaid_deduction  numeric(18, 2) not null default 0 check (unpaid_deduction >= 0),
  gross             numeric(18, 2) not null default 0,
  nssf_employee     numeric(18, 2) not null default 0,
  taxable           numeric(18, 2) not null default 0,
  paye              numeric(18, 2) not null default 0,
  other_deductions  numeric(18, 2) not null default 0 check (other_deductions >= 0),
  deduction_label   text,
  net               numeric(18, 2) not null default 0,
  nssf_employer     numeric(18, 2) not null default 0,
  sdl               numeric(18, 2) not null default 0,
  wcf               numeric(18, 2) not null default 0,
  nssf_member       boolean not null default true,
  paye_exempt       boolean not null default false,
  pay_method        text,
  pay_account       text,
  updated_at        timestamptz not null default now(),
  unique (run_id, employee_id),
  foreign key (run_id, company_id) references public.payroll_runs (id, company_id) on delete cascade,
  foreign key (employee_id, company_id) references public.employees (id, company_id)
);
create index if not exists payroll_lines_employee_idx on public.payroll_lines (employee_id);

-- ---------------------------------------------------------------------
-- 3. Calculations
-- ---------------------------------------------------------------------
create or replace function public.payroll_settings_of(p_company uuid)
returns public.payroll_settings language plpgsql security definer set search_path = ''
as $$
declare
  s public.payroll_settings;
begin
  select * into s from public.payroll_settings where company_id = p_company;
  if s.company_id is null then
    insert into public.payroll_settings (company_id) values (p_company) on conflict do nothing;
    select * into s from public.payroll_settings where company_id = p_company;
  end if;
  return s;
end;
$$;

-- PAYE on a monthly taxable amount, using marginal bands [{"from": amount, "rate": percent}, ...].
create or replace function public.paye_from_bands(p_bands jsonb, p_taxable numeric)
returns numeric language sql immutable set search_path = ''
as $$
  select coalesce(round(sum(greatest(least(p_taxable, coalesce(b.upto, p_taxable)) - b.lo, 0) * b.rate / 100), 0), 0)
    from (select (x ->> 'from')::numeric lo, (x ->> 'rate')::numeric rate,
                 lead((x ->> 'from')::numeric) over (order by (x ->> 'from')::numeric) upto
            from jsonb_array_elements(coalesce(p_bands, '[]'::jsonb)) x) b;
$$;

-- Work out one payslip line again from its inputs (internal).
create or replace function public.payroll_calc_line(p_line uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  l      public.payroll_lines;
  s      public.payroll_settings;
  v_ot   numeric;
  v_gross numeric;
  v_nssf numeric;
  v_tax  numeric;
  v_paye numeric;
  v_sdl  boolean;
  v_period date;
begin
  select * into l from public.payroll_lines where id = p_line;
  s := public.payroll_settings_of(l.company_id);
  select period into v_period from public.payroll_runs where id = l.run_id;
  v_ot := round(l.basic / s.monthly_hours * s.overtime_factor * l.overtime_hours, 0);
  v_gross := greatest(l.basic + l.allowances + v_ot + l.bonus - l.unpaid_deduction, 0);
  v_nssf := case when l.nssf_member then round(v_gross * s.nssf_employee_pct / 100, 0) else 0 end;
  v_tax := v_gross - v_nssf;
  v_paye := case when l.paye_exempt then 0 else public.paye_from_bands(s.paye_bands, v_tax) end;
  select count(*) >= s.sdl_min_employees into v_sdl from public.employees e
   where e.company_id = l.company_id and coalesce(e.start_date, v_period) <= (v_period + interval '1 month - 1 day')::date
     and (e.end_date is null or e.end_date >= v_period);
  update public.payroll_lines
     set overtime = v_ot, gross = v_gross, nssf_employee = v_nssf, taxable = v_tax, paye = v_paye,
         net = v_gross - v_nssf - v_paye - l.other_deductions,
         nssf_employer = case when l.nssf_member then round(v_gross * s.nssf_employer_pct / 100, 0) else 0 end,
         sdl = case when v_sdl then round(v_gross * s.sdl_pct / 100, 0) else 0 end,
         wcf = round(v_gross * s.wcf_pct / 100, 0)
   where id = p_line;
end;
$$;

create or replace function public.payroll_totals(p_run uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.payroll_runs r
     set employees = t.n, gross = t.gross, nssf_employee = t.nssf_e, paye = t.paye, deductions = t.ded, net = t.net,
         nssf_employer = t.nssf_r, sdl = t.sdl, wcf = t.wcf
    from (select count(*) n, coalesce(sum(gross), 0) gross, coalesce(sum(nssf_employee), 0) nssf_e, coalesce(sum(paye), 0) paye,
                 coalesce(sum(other_deductions), 0) ded, coalesce(sum(net), 0) net, coalesce(sum(nssf_employer), 0) nssf_r,
                 coalesce(sum(sdl), 0) sdl, coalesce(sum(wcf), 0) wcf
            from public.payroll_lines where run_id = p_run) t
   where r.id = p_run;
end;
$$;

-- Fill a run with everyone employed in its month who has pay details (internal; keeps manual entries).
create or replace function public.payroll_fill(p_run uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r       public.payroll_runs;
  s       public.payroll_settings;
  v_end   date;
  e       record;
  v_id    uuid;
  v_wdays integer;
  v_unpaid numeric;
  v_ot    numeric;
begin
  select * into r from public.payroll_runs where id = p_run;
  s := public.payroll_settings_of(r.company_id);
  v_end := (r.period + interval '1 month - 1 day')::date;
  v_wdays := public.weekdays_between(r.period, v_end);
  for e in
    select em.*, p.basic_salary, p.housing_allowance + p.transport_allowance + p.other_allowance allowances,
           p.monthly_deduction, p.deduction_label, p.nssf_member, p.paye_exempt, p.pays_overtime, p.pay_method,
           case p.pay_method when 'bank_transfer' then nullif(concat_ws(' ', p.bank_name, p.bank_account), '')
                             when 'mobile_money' then p.mobile_number end pay_account
      from public.employees em join public.employee_pay p on p.employee_id = em.id
     where em.company_id = r.company_id
       and coalesce(em.start_date, r.period) <= v_end and (em.end_date is null or em.end_date >= r.period)
  loop
    -- Unpaid leave approved in this month (working days inside the month).
    select coalesce(sum(public.weekdays_between(greatest(l.starts_on, r.period), least(l.ends_on, v_end))), 0) into v_unpaid
      from public.leave_requests l
     where l.employee_id = e.id and l.status = 'approved' and l.kind = 'unpaid' and l.starts_on <= v_end and l.ends_on >= r.period;
    -- Overtime: hours above the weekly limit in approved timesheet weeks starting in this month.
    v_ot := 0;
    if e.pays_overtime and e.user_id is not null then
      select coalesce(sum(greatest(w.hours - s.overtime_after_hours, 0)), 0) into v_ot
        from public.timesheet_weeks w
       where w.company_id = r.company_id and w.user_id = e.user_id and w.status = 'approved'
         and w.week_start between r.period and v_end;
    end if;
    select id into v_id from public.payroll_lines where run_id = p_run and employee_id = e.id;
    if v_id is null then
      insert into public.payroll_lines (company_id, run_id, employee_id, employee_name, employee_no, job_title, basic, allowances,
                                        overtime_hours, unpaid_days, unpaid_deduction, other_deductions, deduction_label,
                                        nssf_member, paye_exempt, pay_method, pay_account)
      values (r.company_id, p_run, e.id, e.full_name, e.employee_no, e.job_title, e.basic_salary, e.allowances,
              v_ot, v_unpaid, case when v_wdays > 0 then round(e.basic_salary * least(v_unpaid, v_wdays) / v_wdays, 0) else 0 end,
              e.monthly_deduction, e.deduction_label, e.nssf_member, e.paye_exempt, e.pay_method, e.pay_account)
      returning id into v_id;
    else
      update public.payroll_lines
         set employee_name = e.full_name, employee_no = e.employee_no, job_title = e.job_title, basic = e.basic_salary,
             allowances = e.allowances, nssf_member = e.nssf_member, paye_exempt = e.paye_exempt, pay_method = e.pay_method,
             pay_account = e.pay_account
       where id = v_id;
    end if;
    perform public.payroll_calc_line(v_id);
  end loop;
  perform public.payroll_totals(p_run);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Steps
-- ---------------------------------------------------------------------
create or replace function public.create_payroll_run(p_company uuid, p_period date, p_pay_date date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_period date := date_trunc('month', p_period)::date;
  v_id     uuid;
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management or finance can run payroll.' using errcode = '42501';
  end if;
  if p_period is null or v_period > date_trunc('month', (now() at time zone 'Africa/Dar_es_Salaam')::date + 31)::date then
    raise exception 'Choose this month or an earlier one.' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_runs where company_id = p_company and period = v_period and status <> 'cancelled') then
    raise exception 'There is already a pay run for %.', to_char(v_period, 'FMMonth YYYY') using errcode = '22023';
  end if;
  if not exists (select 1 from public.employee_pay p join public.employees e on e.id = p.employee_id
                  where p.company_id = p_company and (e.end_date is null or e.end_date >= v_period)) then
    raise exception 'Enter the pay details of your employees first.' using errcode = '22023';
  end if;
  insert into public.payroll_runs (company_id, number, period, pay_date)
  values (p_company, public.next_code(p_company, 'payroll_runs', 'PR-', 4), v_period,
          coalesce(p_pay_date, (v_period + interval '1 month - 1 day')::date))
  returning id into v_id;
  perform public.payroll_fill(v_id);
  return v_id;
end;
$$;

-- Draft runs: pick up changed pay details, leave and timesheets again.
create or replace function public.refresh_payroll_run(p_run uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run;
  if r.id is null or not public.has_role(r.company_id, public.finance_roles()) then
    raise exception 'Pay run not found.' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'Only a draft pay run can be changed.' using errcode = '22023';
  end if;
  perform public.payroll_fill(p_run);
end;
$$;

-- Draft runs: overtime hours, bonus, deductions and unpaid days of one person.
create or replace function public.update_payroll_line(p_line uuid, p_overtime_hours numeric, p_bonus numeric,
                                                      p_other_deductions numeric, p_unpaid_days numeric)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  l       public.payroll_lines;
  r       public.payroll_runs;
  v_wdays integer;
begin
  select * into l from public.payroll_lines where id = p_line;
  select * into r from public.payroll_runs where id = l.run_id;
  if l.id is null or not public.has_role(l.company_id, public.finance_roles()) then
    raise exception 'Payslip not found.' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'Only a draft pay run can be changed.' using errcode = '22023';
  end if;
  if coalesce(p_overtime_hours, 0) < 0 or coalesce(p_bonus, 0) < 0 or coalesce(p_other_deductions, 0) < 0 or coalesce(p_unpaid_days, 0) < 0 then
    raise exception 'Amounts cannot be negative.' using errcode = '22023';
  end if;
  v_wdays := public.weekdays_between(r.period, (r.period + interval '1 month - 1 day')::date);
  update public.payroll_lines
     set overtime_hours = coalesce(p_overtime_hours, overtime_hours),
         bonus = coalesce(p_bonus, bonus),
         other_deductions = coalesce(p_other_deductions, other_deductions),
         unpaid_days = coalesce(p_unpaid_days, unpaid_days),
         unpaid_deduction = case when v_wdays > 0 then round(basic * least(coalesce(p_unpaid_days, unpaid_days), v_wdays) / v_wdays, 0) else 0 end
   where id = p_line;
  perform public.payroll_calc_line(p_line);
  perform public.payroll_totals(l.run_id);
end;
$$;

create or replace function public.remove_payroll_line(p_line uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  l public.payroll_lines;
begin
  select * into l from public.payroll_lines where id = p_line;
  if l.id is null or not public.has_role(l.company_id, public.finance_roles()) then
    raise exception 'Payslip not found.' using errcode = '42501';
  end if;
  if (select status from public.payroll_runs where id = l.run_id) <> 'draft' then
    raise exception 'Only a draft pay run can be changed.' using errcode = '22023';
  end if;
  delete from public.payroll_lines where id = p_line;
  perform public.payroll_totals(l.run_id);
end;
$$;

-- Management approves: the run is fixed, posted to the accounts and payslips are shown to each person.
create or replace function public.approve_payroll_run(p_run uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r  public.payroll_runs;
  c  uuid;
  ln record;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null or not public.is_manager(r.company_id) then
    raise exception 'Only management can approve payroll.' using errcode = '42501';
  end if;
  if r.status <> 'draft' then
    raise exception 'This pay run is not a draft.' using errcode = '22023';
  end if;
  perform public.payroll_totals(p_run);
  select * into r from public.payroll_runs where id = p_run;
  if r.employees = 0 or r.gross = 0 then
    raise exception 'The pay run is empty.' using errcode = '22023';
  end if;
  if exists (select 1 from public.payroll_lines where run_id = p_run and net < 0) then
    raise exception 'Someone''s deductions are more than their pay. Check the payslips.' using errcode = '22023';
  end if;
  c := r.company_id;
  perform public.gl_post(c, public.gl_open_date(c, r.pay_date), r.pay_date, 'Payroll ' || to_char(r.period, 'FMMonth YYYY'),
    'payroll', r.id, r.number, null,
    jsonb_build_array(
      jsonb_build_object('a', public.gl_acct(c, 'salaries'), 'd', r.gross, 't', 'Gross pay'),
      jsonb_build_object('a', public.gl_acct(c, 'employer_nssf'), 'd', r.nssf_employer),
      jsonb_build_object('a', public.gl_acct(c, 'sdl_expense'), 'd', r.sdl),
      jsonb_build_object('a', public.gl_acct(c, 'wcf_expense'), 'd', r.wcf),
      jsonb_build_object('a', public.gl_acct(c, 'paye_payable'), 'c', r.paye),
      jsonb_build_object('a', public.gl_acct(c, 'nssf_payable'), 'c', r.nssf_employee + r.nssf_employer),
      jsonb_build_object('a', public.gl_acct(c, 'sdl_payable'), 'c', r.sdl),
      jsonb_build_object('a', public.gl_acct(c, 'wcf_payable'), 'c', r.wcf),
      jsonb_build_object('a', public.gl_acct(c, 'deductions_payable'), 'c', r.deductions),
      jsonb_build_object('a', public.gl_acct(c, 'salaries_payable'), 'c', r.net, 't', 'Net pay')));
  perform set_config('ims.status_change', 'on', true);
  update public.payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_run;
  perform set_config('ims.status_change', '', true);
  for ln in select e.user_id from public.payroll_lines l join public.employees e on e.id = l.employee_id
             where l.run_id = p_run and e.user_id is not null loop
    perform public.notify(c, ln.user_id, 'payslip', 'info', 'Your payslip is ready',
      to_char(r.period, 'FMMonth YYYY'), '/payroll/my', 'payslip:' || p_run || ':' || ln.user_id);
  end loop;
end;
$$;

-- Finance: the salaries have been paid.
create or replace function public.pay_payroll_run(p_run uuid, p_paid_on date, p_method text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.payroll_runs;
  v_on date := coalesce(p_paid_on, (now() at time zone 'Africa/Dar_es_Salaam')::date);
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null or not public.has_role(r.company_id, public.finance_roles()) then
    raise exception 'Only management or finance can do this.' using errcode = '42501';
  end if;
  if r.status <> 'approved' then
    raise exception 'Only an approved pay run can be paid.' using errcode = '22023';
  end if;
  if coalesce(p_method, 'bank_transfer') not in ('bank_transfer', 'cash', 'mobile_money', 'cheque') then
    raise exception 'Unknown payment method.' using errcode = '22023';
  end if;
  if r.net > 0 then
    perform public.gl_post(r.company_id, public.gl_open_date(r.company_id, v_on), v_on, 'Salaries paid ' || to_char(r.period, 'FMMonth YYYY'),
      'payroll_payment', r.id, r.number, null,
      jsonb_build_array(jsonb_build_object('a', public.gl_acct(r.company_id, 'salaries_payable'), 'd', r.net),
                        jsonb_build_object('a', public.gl_money_account(r.company_id, coalesce(p_method, 'bank_transfer')), 'c', r.net)));
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.payroll_runs set status = 'paid', paid_by = auth.uid(), paid_at = now(), paid_method = coalesce(p_method, 'bank_transfer')
   where id = p_run;
  perform set_config('ims.status_change', '', true);
end;
$$;

-- Finance: PAYE, NSSF, SDL, WCF or other deductions paid over.
create or replace function public.pay_statutory(p_company uuid, p_kind text, p_amount numeric, p_paid_on date, p_method text, p_reference text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_key  text;
  v_on   date := coalesce(p_paid_on, (now() at time zone 'Africa/Dar_es_Salaam')::date);
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management or finance can do this.' using errcode = '42501';
  end if;
  v_key := case p_kind when 'paye' then 'paye_payable' when 'nssf' then 'nssf_payable' when 'sdl' then 'sdl_payable'
                       when 'wcf' then 'wcf_payable' when 'deductions' then 'deductions_payable' end;
  if v_key is null then
    raise exception 'Choose PAYE, NSSF, SDL, WCF or other deductions.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Enter the amount paid.' using errcode = '22023';
  end if;
  return public.gl_post(p_company, v_on, v_on, upper(p_kind) || ' paid' || coalesce(' (' || nullif(btrim(p_reference), '') || ')', ''),
    'payroll_payment', null, left(nullif(btrim(coalesce(p_reference, '')), ''), 60), null,
    jsonb_build_array(jsonb_build_object('a', public.gl_acct(p_company, v_key), 'd', p_amount),
                      jsonb_build_object('a', public.gl_money_account(p_company, coalesce(p_method, 'bank_transfer')), 'c', p_amount)));
end;
$$;

-- Cancel: a draft (finance), or an approved run not yet paid (management; its journal is reversed).
create or replace function public.cancel_payroll_run(p_run uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.payroll_runs;
  j uuid;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null or not public.has_role(r.company_id, public.finance_roles()) then
    raise exception 'Pay run not found.' using errcode = '42501';
  end if;
  if r.status = 'approved' and not public.is_manager(r.company_id) then
    raise exception 'Only management can cancel an approved pay run.' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'approved') then
    raise exception 'A paid or cancelled pay run cannot be cancelled.' using errcode = '22023';
  end if;
  for j in select id from public.gl_journals where source = 'payroll' and source_id = p_run and reverses is null and reversed_by is null loop
    perform public.gl_reverse(j, 'Payroll ' || r.number || ' cancelled');
  end loop;
  perform set_config('ims.status_change', 'on', true);
  update public.payroll_runs set status = 'cancelled' where id = p_run;
  perform set_config('ims.status_change', '', true);
end;
$$;

-- Management: payroll rates (when the law changes).
create or replace function public.save_payroll_settings(p_company uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  b jsonb;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can change payroll rates.' using errcode = '42501';
  end if;
  b := p_settings -> 'paye_bands';
  if b is not null and (jsonb_typeof(b) <> 'array' or jsonb_array_length(b) < 1 or jsonb_array_length(b) > 12
     or exists (select 1 from jsonb_array_elements(b) x
                 where jsonb_typeof(x -> 'from') <> 'number' or jsonb_typeof(x -> 'rate') <> 'number'
                    or (x ->> 'from')::numeric < 0 or (x ->> 'rate')::numeric not between 0 and 100)) then
    raise exception 'Each tax band needs a starting amount and a rate between 0 and 100.' using errcode = '22023';
  end if;
  perform public.payroll_settings_of(p_company);
  update public.payroll_settings
     set paye_bands = coalesce(b, paye_bands),
         nssf_employee_pct = coalesce((p_settings ->> 'nssf_employee_pct')::numeric, nssf_employee_pct),
         nssf_employer_pct = coalesce((p_settings ->> 'nssf_employer_pct')::numeric, nssf_employer_pct),
         sdl_pct = coalesce((p_settings ->> 'sdl_pct')::numeric, sdl_pct),
         sdl_min_employees = coalesce((p_settings ->> 'sdl_min_employees')::int, sdl_min_employees),
         wcf_pct = coalesce((p_settings ->> 'wcf_pct')::numeric, wcf_pct),
         overtime_after_hours = coalesce((p_settings ->> 'overtime_after_hours')::numeric, overtime_after_hours),
         overtime_factor = coalesce((p_settings ->> 'overtime_factor')::numeric, overtime_factor),
         monthly_hours = coalesce((p_settings ->> 'monthly_hours')::numeric, monthly_hours),
         updated_by = auth.uid(), updated_at = now()
   where company_id = p_company;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (p_company, auth.uid(), 'update', 'payroll_settings', p_company::text, p_settings);
end;
$$;

create or replace function public.guard_payroll_run()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is distinct from old.status and coalesce(current_setting('ims.status_change', true), '') <> 'on' then
    raise exception 'Use the buttons on the pay run.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists payroll_runs_guard on public.payroll_runs;
create trigger payroll_runs_guard before update on public.payroll_runs for each row execute function public.guard_payroll_run();

-- ---------------------------------------------------------------------
-- 5. Row-level security and grants
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['payroll_settings', 'employee_pay', 'payroll_runs', 'payroll_lines'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['employee_pay', 'payroll_runs'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

drop policy if exists payroll_settings_select on public.payroll_settings;
create policy payroll_settings_select on public.payroll_settings for select to authenticated
  using (public.has_role(company_id, public.finance_roles()));

drop policy if exists employee_pay_select on public.employee_pay;
create policy employee_pay_select on public.employee_pay for select to authenticated
  using (public.has_role(company_id, public.finance_roles()));
drop policy if exists employee_pay_insert on public.employee_pay;
create policy employee_pay_insert on public.employee_pay for insert to authenticated
  with check (public.has_role(company_id, public.finance_roles()));
drop policy if exists employee_pay_update on public.employee_pay;
create policy employee_pay_update on public.employee_pay for update to authenticated
  using (public.has_role(company_id, public.finance_roles())) with check (public.has_role(company_id, public.finance_roles()));
grant insert (employee_id, company_id, basic_salary, housing_allowance, transport_allowance, other_allowance, monthly_deduction,
              deduction_label, nssf_member, paye_exempt, pays_overtime, pay_method, bank_name, bank_account, mobile_number)
  on public.employee_pay to authenticated;
grant update (basic_salary, housing_allowance, transport_allowance, other_allowance, monthly_deduction, deduction_label,
              nssf_member, paye_exempt, pays_overtime, pay_method, bank_name, bank_account, mobile_number)
  on public.employee_pay to authenticated;

-- An employee's own payslip once the run is approved.
create or replace function public.my_payslip(p_line_employee uuid, p_run uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.employees e join public.payroll_runs r on r.id = p_run
                  where e.id = p_line_employee and e.user_id = auth.uid() and r.status in ('approved', 'paid')
                    and public.is_member(e.company_id));
$$;

drop policy if exists payroll_runs_select on public.payroll_runs;
create policy payroll_runs_select on public.payroll_runs for select to authenticated
  using (public.has_role(company_id, public.finance_roles()));
drop policy if exists payroll_lines_select on public.payroll_lines;
create policy payroll_lines_select on public.payroll_lines for select to authenticated
  using (public.has_role(company_id, public.finance_roles()) or public.my_payslip(employee_id, run_id));

-- Payslips for the person signed in (with the month and status of the run).
create or replace function public.my_payslips(p_company uuid)
returns table (line_id uuid, run_id uuid, period date, pay_date date, status text, gross numeric, net numeric)
language sql stable security definer set search_path = ''
as $$
  select l.id, r.id, r.period, r.pay_date, r.status, l.gross, l.net
    from public.payroll_lines l
    join public.payroll_runs r on r.id = l.run_id
    join public.employees e on e.id = l.employee_id
   where l.company_id = p_company and e.user_id = auth.uid() and r.status in ('approved', 'paid')
     and public.is_member(p_company)
   order by r.period desc;
$$;

revoke execute on function
  public.payroll_settings_of(uuid), public.paye_from_bands(jsonb, numeric), public.payroll_calc_line(uuid),
  public.payroll_totals(uuid), public.payroll_fill(uuid), public.create_payroll_run(uuid, date, date),
  public.refresh_payroll_run(uuid), public.update_payroll_line(uuid, numeric, numeric, numeric, numeric),
  public.remove_payroll_line(uuid), public.approve_payroll_run(uuid), public.pay_payroll_run(uuid, date, text),
  public.pay_statutory(uuid, text, numeric, date, text, text), public.cancel_payroll_run(uuid),
  public.save_payroll_settings(uuid, jsonb), public.guard_payroll_run(), public.my_payslip(uuid, uuid), public.my_payslips(uuid)
from public, anon, authenticated;
grant execute on function
  public.paye_from_bands(jsonb, numeric), public.create_payroll_run(uuid, date, date),
  public.refresh_payroll_run(uuid), public.update_payroll_line(uuid, numeric, numeric, numeric, numeric),
  public.remove_payroll_line(uuid), public.approve_payroll_run(uuid), public.pay_payroll_run(uuid, date, text),
  public.pay_statutory(uuid, text, numeric, date, text, text), public.cancel_payroll_run(uuid),
  public.save_payroll_settings(uuid, jsonb), public.my_payslip(uuid, uuid), public.my_payslips(uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- 6. Clearing test transactions also clears the new records
--    (employees, pay details, the chart of accounts and assets are kept).
-- ---------------------------------------------------------------------
create or replace function public.reset_company_transactions(p_company uuid, p_confirm_name text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  select name into v_name from public.companies where id = p_company;
  if v_name is null then raise exception 'Company not found.'; end if;
  if p_confirm_name is distinct from v_name then
    raise exception 'Type the company name exactly (%) to confirm.', v_name;
  end if;
  perform set_config('ims.status_change', 'on', true);
  perform set_config('ims.allow_line_copy', 'on', true);

  -- Administration, payroll and the books first (they point at the documents below).
  delete from public.payroll_runs       where company_id = p_company;
  delete from public.corrective_actions where company_id = p_company;
  delete from public.hse_incidents      where company_id = p_company;
  delete from public.hse_inspections    where company_id = p_company;
  delete from public.quality_ncrs       where company_id = p_company;
  delete from public.leave_requests     where company_id = p_company;
  delete from public.timesheet_weeks    where company_id = p_company;
  delete from public.fixed_asset_depreciation where company_id = p_company;
  update public.fixed_assets set accumulated_dep = 0 where company_id = p_company;
  delete from public.gl_sync_issues     where company_id = p_company;
  update public.gl_journals set reverses = null, reversed_by = null where company_id = p_company;
  delete from public.gl_journals        where company_id = p_company and source <> 'fixed_asset';
  update public.companies set books_closed_until = null where id = p_company;

  delete from public.notifications     where company_id = p_company;
  delete from public.crm_activities    where company_id = p_company;
  delete from public.tenders           where company_id = p_company;
  delete from public.opportunities     where company_id = p_company;
  delete from public.followups         where company_id = p_company;
  delete from public.expenses          where company_id = p_company;
  delete from public.timesheets        where company_id = p_company;
  delete from public.service_jobs      where company_id = p_company;
  delete from public.hire_agreements   where company_id = p_company;
  update public.project_milestones set invoice_id = null, status = 'done' where company_id = p_company and invoice_id is not null;
  delete from public.payments          where company_id = p_company;
  delete from public.supplier_payments where company_id = p_company;
  delete from public.invoices          where company_id = p_company;
  delete from public.supplier_bills    where company_id = p_company;
  delete from public.order_costs       where company_id = p_company;
  delete from public.stock_movements   where company_id = p_company;
  delete from public.stock_transfers   where company_id = p_company;
  delete from public.vehicle_logs      where company_id = p_company;
  delete from public.cash_positions    where company_id = p_company;
  delete from public.requisitions      where company_id = p_company;
  delete from public.goods_receipts    where company_id = p_company;
  delete from public.deliveries        where company_id = p_company;
  delete from public.purchase_orders   where company_id = p_company;
  delete from public.supplier_rfqs     where company_id = p_company;
  delete from public.quotations        where company_id = p_company;
  delete from public.rfqs              where company_id = p_company;
  -- Deleting documents posts their reversals; the books start empty again (assets bought stay).
  delete from public.gl_journals       where company_id = p_company and source <> 'fixed_asset';
  delete from public.gl_sync_issues    where company_id = p_company;
  delete from public.audit_log
   where company_id = p_company
     and entity in ('rfqs', 'rfq_lines', 'quotations', 'quotation_lines', 'supplier_rfqs', 'supplier_rfq_suppliers',
                    'purchase_orders', 'po_lines', 'goods_receipts', 'deliveries', 'delivery_lines', 'invoices',
                    'invoice_lines', 'payments', 'supplier_bills', 'supplier_payments', 'order_costs', 'expenses',
                    'followups', 'opportunities', 'crm_activities', 'tenders', 'tender_tasks',
                    'stock_transfers', 'stock_transfer_lines', 'requisitions', 'requisition_lines',
                    'vehicle_logs', 'cash_positions', 'service_jobs', 'service_job_lines', 'timesheets',
                    'hire_agreements', 'hire_lines', 'leave_requests', 'timesheet_weeks', 'hse_incidents',
                    'hse_inspections', 'quality_ncrs', 'corrective_actions', 'payroll_runs');
  delete from public.code_counters
   where company_id = p_company
     and (kind ~ '^(rfqs|quotations|supplier_rfqs|purchase_orders|goods_receipts|deliveries|invoices|payments|supplier_bills|supplier_payments|expenses|opportunities|tenders|stock_transfers|requisitions)-'
          or kind in ('service_jobs', 'hire_agreements', 'hse_incidents', 'hse_inspections', 'quality_ncrs', 'payroll_runs'));
  update public.companies set alerts_checked_at = null where id = p_company;

  perform set_config('ims.status_change', 'off', true);
  perform set_config('ims.allow_line_copy', 'off', true);
  return 'Test transactions cleared for ' || v_name || '. Master data, employees, the chart of accounts, assets, contracts, documents, vehicles, budgets, team and settings were kept.';
end;
$$;

notify pgrst, 'reload schema';
