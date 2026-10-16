-- =====================================================================
-- Administration package: people (HR), timesheet approval, health &
-- safety (HSE) and quality, joined to the rest of LeMoSp.
--
--   HR            employees (linked to a team login when they have one),
--                 certificates and licences with expiry, contracts and
--                 probation dates, leave requests and balances.
--   Timesheets    each person submits a week of hours; management
--                 approves or sends it back; approved weeks are locked.
--   HSE           incidents (injury, near miss, vehicle, fire, ...) on
--                 jobs, projects and vehicles; inspections and toolbox talks.
--   Quality       non-conformance reports (NCRs) on suppliers, client
--                 complaints, products, purchase orders and deliveries.
--   Actions       corrective actions on incidents, inspections and NCRs,
--                 with an owner and a due date.
--
-- Who sees what:
--   * Management sees and runs everything. Finance can read employee
--     files (needed for payroll).
--   * Everyone else sees their own employee file, leave, weeks, the
--     incidents and inspections they recorded and the actions they own.
--   * NCRs are visible to everyone except drivers.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Features
-- ---------------------------------------------------------------------
insert into public.feature_categories (name, description, sort)
values ('HR & safety', 'Employees, leave, timesheet approval, payroll, health & safety and quality.', 85)
on conflict (name) do nothing;

insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('hr_people', 'Employees & leave',
 'An employee file for everyone, with or without a login: job, contract and probation dates, NIDA, TIN and NSSF numbers, certificates and licences with expiry reminders, leave requests and balances.',
 'HR & safety', 'medium', 'live', 'Every company with staff.',
 'No expired licence or certificate on site, no forgotten contract end, and leave approved in one tap.',
 '[{"title": "Add your people", "body": "Open Employees and press New employee. Link the person to their LeMoSp login if they have one, so they can ask for leave and see their own file."},
   {"title": "Certificates and licences", "body": "On the employee, add driving licences, first-aid, working-at-height and other certificates with their expiry date. Those ending in the next 30 days show on the dashboard."},
   {"title": "Leave", "body": "Anyone asks for leave from Leave. Management approves or declines it; the balance of annual leave is worked out for you."}]'::jsonb,
 '/hr', 470),
('timesheet_approval', 'Timesheet approval',
 'Each person submits a week of hours; management approves it or sends it back with a note. Approved weeks are locked, so invoices and payroll use checked hours.',
 'HR & safety', 'medium', 'live', 'Companies that bill for time or pay overtime.',
 'Hours are checked once, before they are invoiced or paid.',
 '[{"title": "Submit your week", "body": "In Timesheets, record the hours, then press Submit week."},
   {"title": "Approve", "body": "Management opens Approve timesheets, checks each week and approves it or sends it back with a note."}]'::jsonb,
 '/timesheets/approve', 475),
('hse', 'Health & safety (HSE)',
 'Report incidents and near misses from the phone, investigate and close them, record site, vehicle and equipment inspections and toolbox talks, and follow up corrective actions.',
 'HR & safety', 'medium', 'live', 'Companies working on mine sites, construction, transport or with chemicals.',
 'Clients and OSHA ask for safety records: they are ready, and nothing reported is forgotten.',
 '[{"title": "Report an incident", "body": "Anyone opens Health & safety and presses Report incident: what happened, where, how serious and what was done at once. Management is told at once."},
   {"title": "Investigate and act", "body": "Management records the root cause, adds corrective actions with an owner and a due date, and closes the incident when they are done."},
   {"title": "Inspections and toolbox talks", "body": "Record each inspection or talk with the date, the place, the result and who attended."}]'::jsonb,
 '/hse', 480),
('quality', 'Quality (NCRs)',
 'Non-conformance reports for wrong or damaged goods from suppliers, client complaints and internal mistakes, with root cause, what was done, the cost and corrective actions.',
 'HR & safety', 'medium', 'live', 'Companies supplying mines, factories or government, often asked for ISO 9001 records.',
 'See which supplier or product causes problems, and show clients that complaints are handled.',
 '[{"title": "Raise an NCR", "body": "Open Quality and press New NCR: where the problem came from, the supplier, client, product or order, and what is wrong."},
   {"title": "Close it out", "body": "Record the root cause, what was done with the goods and the cost, add corrective actions and close the NCR."}]'::jsonb,
 '/quality', 485)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Employees
-- ---------------------------------------------------------------------
create table if not exists public.employees (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  employee_no        text not null default '',
  user_id            uuid references auth.users (id) on delete set null,
  full_name          text not null check (char_length(btrim(full_name)) between 2 and 120),
  job_title          text check (job_title is null or char_length(job_title) <= 80),
  department         text check (department is null or char_length(department) <= 80),
  employment_type    text not null default 'permanent'
                     check (employment_type in ('permanent', 'contract', 'casual', 'intern')),
  start_date         date,
  probation_end      date,
  contract_end       date,
  end_date           date,
  status             text not null default 'active' check (status in ('active', 'left')),
  leaving_reason     text check (leaving_reason is null or char_length(leaving_reason) <= 300),
  phone              text check (phone is null or char_length(phone) <= 40),
  email              text check (email is null or char_length(email) <= 120),
  emergency_contact  text check (emergency_contact is null or char_length(emergency_contact) <= 120),
  emergency_phone    text check (emergency_phone is null or char_length(emergency_phone) <= 40),
  id_number          text check (id_number is null or char_length(id_number) <= 40),
  tin                text check (tin is null or char_length(tin) <= 40),
  nssf_no            text check (nssf_no is null or char_length(nssf_no) <= 40),
  annual_leave_days  numeric(5, 1) not null default 28 check (annual_leave_days between 0 and 365),
  notes              text check (notes is null or char_length(notes) <= 2000),
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, company_id),
  check (end_date is null or start_date is null or end_date >= start_date),
  check (probation_end is null or start_date is null or probation_end >= start_date),
  check (contract_end is null or start_date is null or contract_end >= start_date)
);
create unique index if not exists employees_user_key on public.employees (company_id, user_id) where user_id is not null;
create unique index if not exists employees_no_key on public.employees (company_id, employee_no) where employee_no <> '';
create index if not exists employees_company_idx on public.employees (company_id, status, full_name);

create table if not exists public.employee_certificates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  employee_id  uuid not null,
  name         text not null check (char_length(btrim(name)) between 2 and 120),
  issuer       text check (issuer is null or char_length(issuer) <= 120),
  number       text check (number is null or char_length(number) <= 60),
  issued_on    date,
  expires_on   date,
  notes        text check (notes is null or char_length(notes) <= 500),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id) on delete cascade,
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index if not exists employee_certificates_employee_idx on public.employee_certificates (employee_id);
create index if not exists employee_certificates_expiry_idx on public.employee_certificates (company_id, expires_on) where expires_on is not null;

-- The employee file of the person signed in (null when none).
create or replace function public.my_employee_id(p_company uuid)
returns uuid language sql stable security definer set search_path = ''
as $$
  select e.id from public.employees e
   where e.company_id = p_company and e.user_id = auth.uid() and auth.uid() is not null
     and public.is_member(p_company);
$$;

-- Management and finance read every file; everyone reads their own.
create or replace function public.can_see_employee(p_employee uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.employees e
                  where e.id = p_employee
                    and (public.has_role(e.company_id, public.finance_roles())
                         or (e.user_id = auth.uid() and public.is_member(e.company_id))));
$$;

create or replace function public.prepare_employee()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and coalesce(btrim(new.employee_no), '') = '' then
    new.employee_no := public.next_code(new.company_id, 'employees', 'EMP-', 3);
  end if;
  if tg_op = 'UPDATE' and coalesce(btrim(new.employee_no), '') = '' then
    new.employee_no := old.employee_no;  -- left empty on the form: keep the number
  end if;
  new.employee_no := btrim(new.employee_no);
  new.full_name := btrim(new.full_name);
  if new.user_id is not null and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id)
     and not exists (select 1 from public.memberships m where m.company_id = new.company_id and m.user_id = new.user_id) then
    raise exception 'That login is not in your team.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status
     and coalesce(current_setting('ims.status_change', true), '') <> 'on' then
    raise exception 'Use Mark as left or Bring back on the employee.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists employees_prepare on public.employees;
create trigger employees_prepare before insert or update on public.employees for each row execute function public.prepare_employee();

-- Management: someone leaves, or comes back.
create or replace function public.set_employee_status(p_employee uuid, p_status text, p_date date, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  e public.employees;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null or not public.is_manager(e.company_id) then
    raise exception 'Only management can change this.' using errcode = '42501';
  end if;
  if p_status not in ('active', 'left') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  if p_status = 'left' then
    update public.employees
       set status = 'left',
           end_date = coalesce(p_date, (now() at time zone 'Africa/Dar_es_Salaam')::date),
           leaving_reason = nullif(btrim(coalesce(p_reason, '')), '')
     where id = p_employee;
  else
    update public.employees set status = 'active', end_date = null, leaving_reason = null where id = p_employee;
  end if;
  perform set_config('ims.status_change', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Leave
-- ---------------------------------------------------------------------
create table if not exists public.leave_requests (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  employee_id    uuid not null,
  kind           text not null default 'annual'
                 check (kind in ('annual', 'sick', 'maternity', 'paternity', 'compassionate', 'study', 'unpaid', 'other')),
  starts_on      date not null,
  ends_on        date not null,
  days           numeric(5, 1) not null check (days > 0),
  reason         text check (reason is null or char_length(reason) <= 500),
  status         text not null default 'requested' check (status in ('requested', 'approved', 'declined', 'cancelled')),
  decided_by     uuid references auth.users (id) on delete set null,
  decided_at     timestamptz,
  decision_note  text check (decision_note is null or char_length(decision_note) <= 500),
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (employee_id, company_id) references public.employees (id, company_id) on delete cascade,
  check (ends_on >= starts_on)
);
create index if not exists leave_requests_employee_idx on public.leave_requests (employee_id, starts_on desc);
create index if not exists leave_requests_company_idx on public.leave_requests (company_id, status, starts_on);

-- Working days (Monday to Friday) between two dates, both included.
create or replace function public.weekdays_between(p_from date, p_to date)
returns integer language sql immutable set search_path = ''
as $$
  select count(*)::int from generate_series(p_from, p_to, interval '1 day') d
   where extract(isodow from d) < 6;
$$;

-- Annual leave for a calendar year: entitlement, taken (approved) and waiting.
create or replace function public.leave_balance(p_employee uuid, p_year integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  e        public.employees;
  v_taken  numeric;
  v_wait   numeric;
  v_by     jsonb;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null or not (public.can_see_employee(p_employee)) then
    raise exception 'Employee not found.' using errcode = '42501';
  end if;
  select coalesce(sum(days) filter (where status = 'approved' and kind = 'annual'), 0),
         coalesce(sum(days) filter (where status = 'requested' and kind = 'annual'), 0)
    into v_taken, v_wait
    from public.leave_requests
   where employee_id = p_employee and extract(year from starts_on) = p_year;
  select coalesce(jsonb_object_agg(kind, d), '{}'::jsonb) into v_by from (
    select kind, sum(days) d from public.leave_requests
     where employee_id = p_employee and status = 'approved' and extract(year from starts_on) = p_year
     group by kind) x;
  return jsonb_build_object('year', p_year, 'entitled', e.annual_leave_days, 'taken', v_taken, 'waiting', v_wait,
                            'left', e.annual_leave_days - v_taken, 'by_kind', v_by);
end;
$$;

-- Ask for leave: for yourself, or management for anyone.
create or replace function public.request_leave(p_employee uuid, p_kind text, p_from date, p_to date, p_reason text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  e      public.employees;
  v_days integer;
  v_id   uuid;
begin
  select * into e from public.employees where id = p_employee;
  if e.id is null or not public.is_member(e.company_id)
     or not (e.user_id = auth.uid() or public.is_manager(e.company_id)) then
    raise exception 'You can only ask for leave for yourself.' using errcode = '42501';
  end if;
  if e.status <> 'active' then
    raise exception 'This employee has left.' using errcode = '22023';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose the first and last day of leave.' using errcode = '22023';
  end if;
  if p_to - p_from > 366 then
    raise exception 'Leave cannot be longer than a year.' using errcode = '22023';
  end if;
  v_days := public.weekdays_between(p_from, p_to);
  if v_days = 0 then
    raise exception 'Those days are all weekend days.' using errcode = '22023';
  end if;
  if exists (select 1 from public.leave_requests l
              where l.employee_id = p_employee and l.status in ('requested', 'approved')
                and l.starts_on <= p_to and l.ends_on >= p_from) then
    raise exception 'There is already leave on some of those days.' using errcode = '22023';
  end if;
  insert into public.leave_requests (company_id, employee_id, kind, starts_on, ends_on, days, reason)
  values (e.company_id, p_employee, coalesce(p_kind, 'annual'), p_from, p_to, v_days, nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_id;
  perform public.notify_roles(e.company_id, array['management']::public.app_role[], auth.uid(), 'leave_request', 'info',
    'Leave request: ' || e.full_name,
    v_days || ' working day(s) of ' || replace(coalesce(p_kind, 'annual'), '_', ' ') || ' leave from ' || to_char(p_from, 'DD Mon YYYY'),
    '/hr/leave', 'leave:' || v_id);
  return v_id;
end;
$$;

create or replace function public.decide_leave(p_request uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  l public.leave_requests;
  e public.employees;
begin
  select * into l from public.leave_requests where id = p_request;
  if l.id is null or not public.is_manager(l.company_id) then
    raise exception 'Only management can approve leave.' using errcode = '42501';
  end if;
  if l.status <> 'requested' then
    raise exception 'This request has already been answered.' using errcode = '22023';
  end if;
  update public.leave_requests
     set status = case when p_approve then 'approved' else 'declined' end,
         decided_by = auth.uid(), decided_at = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_request;
  select * into e from public.employees where id = l.employee_id;
  perform public.notify(l.company_id, e.user_id, 'leave_decided', 'info',
    case when p_approve then 'Leave approved' else 'Leave declined' end,
    to_char(l.starts_on, 'DD Mon') || ' – ' || to_char(l.ends_on, 'DD Mon YYYY') || coalesce(': ' || nullif(btrim(p_note), ''), ''),
    '/hr/leave', 'leave-decided:' || l.id);
end;
$$;

-- Cancel: the person before it starts, management at any time.
create or replace function public.cancel_leave(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  l public.leave_requests;
  e public.employees;
begin
  select * into l from public.leave_requests where id = p_request;
  select * into e from public.employees where id = l.employee_id;
  if l.id is null or not public.is_member(l.company_id) then
    raise exception 'Leave not found.' using errcode = '42501';
  end if;
  if not public.is_manager(l.company_id) then
    if e.user_id is distinct from auth.uid() then
      raise exception 'You can only cancel your own leave.' using errcode = '42501';
    end if;
    if l.starts_on <= (now() at time zone 'Africa/Dar_es_Salaam')::date then
      raise exception 'This leave has started; ask management to change it.' using errcode = '22023';
    end if;
  end if;
  if l.status not in ('requested', 'approved') then
    raise exception 'This leave is already closed.' using errcode = '22023';
  end if;
  update public.leave_requests set status = 'cancelled' where id = p_request;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Timesheet weeks (submit and approve)
-- ---------------------------------------------------------------------
create table if not exists public.timesheet_weeks (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  week_start    date not null check (extract(isodow from week_start) = 1),
  status        text not null default 'submitted' check (status in ('submitted', 'approved', 'returned')),
  hours         numeric(7, 2) not null default 0,
  submitted_at  timestamptz not null default now(),
  decided_by    uuid references auth.users (id) on delete set null,
  decided_at    timestamptz,
  note          text check (note is null or char_length(note) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, user_id, week_start)
);
create index if not exists timesheet_weeks_company_idx on public.timesheet_weeks (company_id, status, week_start desc);

create or replace function public.monday_of(p_day date)
returns date language sql immutable set search_path = ''
as $$ select p_day - (extract(isodow from p_day)::int - 1); $$;

create or replace function public.submit_timesheet_week(p_company uuid, p_week date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_week  date := public.monday_of(p_week);
  v_hours numeric;
  w       public.timesheet_weeks;
  v_name  text;
begin
  if auth.uid() is null or not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  select coalesce(sum(hours), 0) into v_hours from public.timesheets
   where company_id = p_company and user_id = auth.uid() and work_date between v_week and v_week + 6;
  if v_hours = 0 then
    raise exception 'Record your hours for the week before submitting it.' using errcode = '22023';
  end if;
  select * into w from public.timesheet_weeks where company_id = p_company and user_id = auth.uid() and week_start = v_week;
  if w.status in ('submitted', 'approved') then
    raise exception 'This week is already %.', w.status using errcode = '22023';
  end if;
  insert into public.timesheet_weeks (company_id, user_id, week_start, status, hours, submitted_at)
  values (p_company, auth.uid(), v_week, 'submitted', v_hours, now())
  on conflict (company_id, user_id, week_start) do update
    set status = 'submitted', hours = excluded.hours, submitted_at = now(), decided_by = null, decided_at = null, note = null
  returning * into w;
  select coalesce(nullif(btrim(full_name), ''), email, 'A team member') into v_name from public.profiles where id = auth.uid();
  perform public.notify_roles(p_company, array['management']::public.app_role[], auth.uid(), 'timesheet_week', 'info',
    'Timesheet to approve: ' || v_name,
    v_hours || ' hours, week of ' || to_char(v_week, 'DD Mon YYYY'), '/timesheets/approve', 'tsweek:' || w.id || ':' || extract(epoch from now())::bigint);
  return w.id;
end;
$$;

create or replace function public.decide_timesheet_week(p_week uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  w       public.timesheet_weeks;
  v_hours numeric;
begin
  select * into w from public.timesheet_weeks where id = p_week;
  if w.id is null or not public.is_manager(w.company_id) then
    raise exception 'Only management can approve timesheets.' using errcode = '42501';
  end if;
  if w.status <> 'submitted' then
    raise exception 'This week is not waiting for approval.' using errcode = '22023';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'Say what needs to change.' using errcode = '22023';
  end if;
  select coalesce(sum(hours), 0) into v_hours from public.timesheets
   where company_id = w.company_id and user_id = w.user_id and work_date between w.week_start and w.week_start + 6;
  update public.timesheet_weeks
     set status = case when p_approve then 'approved' else 'returned' end,
         hours = v_hours, decided_by = auth.uid(), decided_at = now(), note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_week;
  perform public.notify(w.company_id, w.user_id, 'timesheet_week', case when p_approve then 'info' else 'attention' end,
    case when p_approve then 'Timesheet approved' else 'Timesheet sent back' end,
    'Week of ' || to_char(w.week_start, 'DD Mon YYYY') || coalesce(': ' || nullif(btrim(p_note), ''), ''),
    '/timesheets?week=' || w.week_start, 'tsweek-decided:' || w.id || ':' || extract(epoch from now())::bigint);
end;
$$;

-- Management: open an approved week again (for a correction).
create or replace function public.reopen_timesheet_week(p_week uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  w public.timesheet_weeks;
begin
  select * into w from public.timesheet_weeks where id = p_week;
  if w.id is null or not public.is_manager(w.company_id) then
    raise exception 'Only management can open a week again.' using errcode = '42501';
  end if;
  delete from public.timesheet_weeks where id = p_week;
end;
$$;

-- Hours of a submitted or approved week stay as they are (management and finance can still correct them).
create or replace function public.guard_timesheet_week()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  r record;
begin
  if tg_op = 'DELETE' and (coalesce(current_setting('ims.status_change', true), '') = 'on'
                           or not exists (select 1 from public.companies c where c.id = old.company_id)
                           or not exists (select 1 from auth.users u where u.id = old.user_id)) then
    return old;  -- clearing test data, or the company or person is being removed
  end if;
  if tg_op = 'UPDATE' and new.work_date = old.work_date and new.hours = old.hours and new.user_id = old.user_id
     and new.project_id is not distinct from old.project_id and new.job_id is not distinct from old.job_id
     and new.client_id is not distinct from old.client_id and new.description is not distinct from old.description
     and new.billable = old.billable then
    return new;  -- only invoice or rate details changed
  end if;
  for r in
    select x.company_id, x.user_id, x.work_date from (
      select new.company_id, new.user_id, new.work_date where tg_op <> 'DELETE'
      union all
      select old.company_id, old.user_id, old.work_date where tg_op <> 'INSERT') x
  loop
    if exists (select 1 from public.timesheet_weeks w
                where w.company_id = r.company_id and w.user_id = r.user_id
                  and w.week_start = public.monday_of(r.work_date) and w.status in ('submitted', 'approved'))
       and not public.has_role(r.company_id, public.finance_roles()) then
      raise exception 'This week has been submitted. Ask management to send it back before changing it.' using errcode = '22023';
    end if;
  end loop;
  return coalesce(new, old);
end;
$$;
drop trigger if exists timesheets_week_lock on public.timesheets;
create trigger timesheets_week_lock before insert or update or delete on public.timesheets
  for each row execute function public.guard_timesheet_week();

-- ---------------------------------------------------------------------
-- 5. Health & safety
-- ---------------------------------------------------------------------
create table if not exists public.hse_incidents (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  number            text not null default '',
  occurred_at       timestamptz not null,
  site              text check (site is null or char_length(site) <= 200),
  kind              text not null default 'near_miss'
                    check (kind in ('injury', 'near_miss', 'property_damage', 'environmental', 'vehicle', 'fire', 'other')),
  severity          text not null default 'low' check (severity in ('low', 'medium', 'high', 'critical')),
  title             text not null check (char_length(btrim(title)) between 3 and 160),
  description       text not null check (char_length(btrim(description)) between 3 and 4000),
  people_involved   text check (people_involved is null or char_length(people_involved) <= 500),
  employee_id       uuid,
  client_id         uuid,
  project_id        uuid,
  job_id            uuid,
  vehicle_id        uuid,
  immediate_action  text check (immediate_action is null or char_length(immediate_action) <= 2000),
  root_cause        text check (root_cause is null or char_length(root_cause) <= 2000),
  lost_days         numeric(6, 1) not null default 0 check (lost_days >= 0),
  reportable        boolean not null default false,
  status            text not null default 'open' check (status in ('open', 'investigating', 'closed')),
  closed_by         uuid references auth.users (id) on delete set null,
  closed_at         timestamptz,
  reported_by       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, company_id),
  foreign key (employee_id, company_id) references public.employees (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (project_id, company_id) references public.projects (id, company_id),
  foreign key (job_id, company_id) references public.service_jobs (id, company_id),
  foreign key (vehicle_id, company_id) references public.vehicles (id, company_id)
);
create index if not exists hse_incidents_company_idx on public.hse_incidents (company_id, occurred_at desc);
create index if not exists hse_incidents_open_idx on public.hse_incidents (company_id) where status <> 'closed';

create table if not exists public.hse_inspections (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  number          text not null default '',
  inspected_on    date not null,
  kind            text not null default 'site'
                  check (kind in ('site', 'vehicle', 'equipment', 'ppe', 'fire', 'toolbox_talk', 'other')),
  site            text check (site is null or char_length(site) <= 200),
  vehicle_id      uuid,
  project_id      uuid,
  job_id          uuid,
  topic           text check (topic is null or char_length(topic) <= 200),
  result          text not null default 'pass' check (result in ('pass', 'actions_needed', 'fail')),
  findings        text check (findings is null or char_length(findings) <= 4000),
  attendees       text check (attendees is null or char_length(attendees) <= 2000),
  attendee_count  integer check (attendee_count is null or attendee_count between 0 and 10000),
  inspector_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, company_id),
  foreign key (vehicle_id, company_id) references public.vehicles (id, company_id),
  foreign key (project_id, company_id) references public.projects (id, company_id),
  foreign key (job_id, company_id) references public.service_jobs (id, company_id)
);
create index if not exists hse_inspections_company_idx on public.hse_inspections (company_id, inspected_on desc);

-- ---------------------------------------------------------------------
-- 6. Quality: non-conformance reports
-- ---------------------------------------------------------------------
create or replace function public.quality_roles()
returns public.app_role[] language sql immutable set search_path = ''
as $$ select array['management', 'sales', 'procurement', 'warehouse', 'finance']::public.app_role[]; $$;

create table if not exists public.quality_ncrs (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  number             text not null default '',
  raised_on          date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  source             text not null default 'supplier'
                     check (source in ('supplier', 'client_complaint', 'internal', 'audit', 'other')),
  title              text not null check (char_length(btrim(title)) between 3 and 160),
  description        text not null check (char_length(btrim(description)) between 3 and 4000),
  supplier_id        uuid,
  client_id          uuid,
  product_id         uuid,
  purchase_order_id  uuid,
  delivery_id        uuid,
  quantity_affected  numeric(18, 3) check (quantity_affected is null or quantity_affected >= 0),
  disposition        text check (disposition is null or disposition in ('return_to_supplier', 'replace', 'rework', 'use_as_is', 'scrap', 'credit_note', 'other')),
  root_cause         text check (root_cause is null or char_length(root_cause) <= 2000),
  cost               numeric(18, 2) not null default 0 check (cost >= 0),
  status             text not null default 'open' check (status in ('open', 'action', 'closed')),
  closed_by          uuid references auth.users (id) on delete set null,
  closed_at          timestamptz,
  raised_by          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, company_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (product_id, company_id) references public.products (id, company_id),
  foreign key (purchase_order_id, company_id) references public.purchase_orders (id, company_id),
  foreign key (delivery_id, company_id) references public.deliveries (id, company_id)
);
create index if not exists quality_ncrs_company_idx on public.quality_ncrs (company_id, raised_on desc);
create index if not exists quality_ncrs_supplier_idx on public.quality_ncrs (supplier_id) where supplier_id is not null;

-- ---------------------------------------------------------------------
-- 7. Corrective actions (on incidents, inspections and NCRs)
-- ---------------------------------------------------------------------
create table if not exists public.corrective_actions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  source_kind  text not null check (source_kind in ('incident', 'inspection', 'ncr')),
  source_id    uuid not null,
  action       text not null check (char_length(btrim(action)) between 3 and 1000),
  owner_id     uuid references auth.users (id) on delete set null,
  due_on       date,
  status       text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  done_note    text check (done_note is null or char_length(done_note) <= 1000),
  done_by      uuid references auth.users (id) on delete set null,
  done_at      timestamptz,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists corrective_actions_source_idx on public.corrective_actions (source_kind, source_id);
create index if not exists corrective_actions_owner_idx on public.corrective_actions (owner_id) where status = 'open';
create index if not exists corrective_actions_company_idx on public.corrective_actions (company_id, status, due_on);

-- Numbers, checks and status changes through the functions below.
create or replace function public.prepare_admin_record()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and tg_table_name in ('hse_incidents', 'hse_inspections', 'quality_ncrs') then
    if coalesce(new.number, '') = '' then
      new.number := case tg_table_name
        when 'hse_incidents' then public.next_code(new.company_id, 'hse_incidents', 'INC-', 4)
        when 'hse_inspections' then public.next_code(new.company_id, 'hse_inspections', 'INSP-', 4)
        else public.next_code(new.company_id, 'quality_ncrs', 'NCR-', 4) end;
    end if;
  end if;
  if tg_op = 'INSERT' and tg_table_name in ('hse_incidents', 'quality_ncrs') then
    new.status := 'open';
    new.closed_by := null;
    new.closed_at := null;
  end if;
  if tg_op = 'INSERT' and tg_table_name = 'corrective_actions' then
    new.status := 'open';
    new.done_by := null;
    new.done_at := null;
    if not exists (
      select 1 from public.hse_incidents i where new.source_kind = 'incident' and i.id = new.source_id and i.company_id = new.company_id
      union all
      select 1 from public.hse_inspections s where new.source_kind = 'inspection' and s.id = new.source_id and s.company_id = new.company_id
      union all
      select 1 from public.quality_ncrs n where new.source_kind = 'ncr' and n.id = new.source_id and n.company_id = new.company_id) then
      raise exception 'Record not found.' using errcode = '22023';
    end if;
  end if;
  if tg_table_name = 'corrective_actions' then
    if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id) then
      if not public.is_active_member(new.company_id, new.owner_id) then
        raise exception 'Only active team members can own an action.' using errcode = '22023';
      end if;
    end if;
  end if;
  if tg_table_name = 'hse_incidents' then
    if new.occurred_at > now() + interval '1 hour' then
      raise exception 'The incident cannot be in the future.' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE' and tg_table_name <> 'hse_inspections' then
    if to_jsonb(new) -> 'status' is distinct from to_jsonb(old) -> 'status'
       and coalesce(current_setting('ims.status_change', true), '') <> 'on' then
      raise exception 'Use the buttons to change the status.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['hse_incidents', 'hse_inspections', 'quality_ncrs', 'corrective_actions'] loop
    execute format('drop trigger if exists %I_prepare on public.%I', t, t);
    execute format('create trigger %I_prepare before insert or update on public.%I for each row execute function public.prepare_admin_record()', t, t);
  end loop;
end $$;

-- Management is told about new incidents and NCRs; owners about actions given to them.
create or replace function public.on_admin_record_added()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'hse_incidents' then
    perform public.notify_roles(new.company_id, array['management']::public.app_role[], new.reported_by, 'hse_incident',
      case new.severity when 'critical' then 'critical' when 'high' then 'attention' else 'info' end,
      'Incident ' || new.number || ': ' || new.title,
      initcap(replace(new.kind, '_', ' ')) || ', ' || new.severity || coalesce(' at ' || nullif(btrim(new.site), ''), ''),
      '/hse/' || new.id, 'incident:' || new.id);
  elsif tg_table_name = 'quality_ncrs' then
    perform public.notify_roles(new.company_id, array['management']::public.app_role[], new.raised_by, 'quality_ncr', 'info',
      'NCR ' || new.number || ': ' || new.title, initcap(replace(new.source, '_', ' ')), '/quality/' || new.id, 'ncr:' || new.id);
  elsif tg_table_name = 'corrective_actions' and new.owner_id is not null then
    perform public.notify(new.company_id, new.owner_id, 'corrective_action', 'attention',
      'Action for you', left(new.action, 200) || coalesce(' (due ' || to_char(new.due_on, 'DD Mon YYYY') || ')', ''),
      case new.source_kind when 'ncr' then '/quality/' else '/hse/' end
        || case new.source_kind when 'inspection' then 'inspections/' else '' end || new.source_id,
      'action:' || new.id || ':' || new.owner_id);
  end if;
  return new;
end;
$$;
drop trigger if exists hse_incidents_added on public.hse_incidents;
create trigger hse_incidents_added after insert on public.hse_incidents for each row execute function public.on_admin_record_added();
drop trigger if exists quality_ncrs_added on public.quality_ncrs;
create trigger quality_ncrs_added after insert on public.quality_ncrs for each row execute function public.on_admin_record_added();
drop trigger if exists corrective_actions_added on public.corrective_actions;
create trigger corrective_actions_added after insert or update of owner_id on public.corrective_actions
  for each row execute function public.on_admin_record_added();

-- Management: move an incident or NCR on (open → investigating/action → closed, or back to open).
create or replace function public.set_admin_status(p_kind text, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_open    integer;
begin
  if p_kind = 'incident' then
    select company_id into v_company from public.hse_incidents where id = p_id;
    if p_status not in ('open', 'investigating', 'closed') then
      raise exception 'Unknown status.' using errcode = '22023';
    end if;
  elsif p_kind = 'ncr' then
    select company_id into v_company from public.quality_ncrs where id = p_id;
    if p_status not in ('open', 'action', 'closed') then
      raise exception 'Unknown status.' using errcode = '22023';
    end if;
  else
    raise exception 'Unknown record.' using errcode = '22023';
  end if;
  if v_company is null or not public.is_manager(v_company) then
    raise exception 'Only management can change the status.' using errcode = '42501';
  end if;
  if p_status = 'closed' then
    select count(*) into v_open from public.corrective_actions
     where source_kind = p_kind and source_id = p_id and status = 'open';
    if v_open > 0 then
      raise exception 'Finish or cancel the % open action(s) first.', v_open using errcode = '22023';
    end if;
  end if;
  perform set_config('ims.status_change', 'on', true);
  if p_kind = 'incident' then
    update public.hse_incidents
       set status = p_status,
           closed_by = case when p_status = 'closed' then auth.uid() end,
           closed_at = case when p_status = 'closed' then now() end
     where id = p_id;
  else
    update public.quality_ncrs
       set status = p_status,
           closed_by = case when p_status = 'closed' then auth.uid() end,
           closed_at = case when p_status = 'closed' then now() end
     where id = p_id;
  end if;
  perform set_config('ims.status_change', '', true);
end;
$$;

-- The owner (or management) marks an action done; management can cancel it.
create or replace function public.finish_corrective_action(p_action uuid, p_done boolean, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.corrective_actions;
begin
  select * into a from public.corrective_actions where id = p_action;
  if a.id is null or not public.is_member(a.company_id) then
    raise exception 'Action not found.' using errcode = '42501';
  end if;
  if not public.is_manager(a.company_id) and (not p_done or a.owner_id is distinct from auth.uid()) then
    raise exception 'Only the owner or management can do this.' using errcode = '42501';
  end if;
  if a.status <> 'open' then
    raise exception 'This action is already closed.' using errcode = '22023';
  end if;
  if p_done and coalesce(btrim(p_note), '') = '' then
    raise exception 'Say what was done.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.corrective_actions
     set status = case when p_done then 'done' else 'cancelled' end,
         done_note = nullif(btrim(coalesce(p_note, '')), ''), done_by = auth.uid(), done_at = now()
   where id = p_action;
  perform set_config('ims.status_change', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Triggers, row-level security and grants
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['employees', 'employee_certificates', 'leave_requests', 'timesheet_weeks',
                           'hse_incidents', 'hse_inspections', 'quality_ncrs', 'corrective_actions'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Employees: management writes; management, finance and the person read.
drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees for select to authenticated
  using (public.has_role(company_id, public.finance_roles()) or (user_id = auth.uid() and public.is_member(company_id)));
drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees for insert to authenticated with check (public.is_manager(company_id));
drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees for update to authenticated
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));
grant insert (company_id, employee_no, user_id, full_name, job_title, department, employment_type, start_date, probation_end,
              contract_end, phone, email, emergency_contact, emergency_phone, id_number, tin, nssf_no, annual_leave_days, notes)
  on public.employees to authenticated;
grant update (employee_no, user_id, full_name, job_title, department, employment_type, start_date, probation_end,
              contract_end, phone, email, emergency_contact, emergency_phone, id_number, tin, nssf_no, annual_leave_days, notes)
  on public.employees to authenticated;

drop policy if exists employee_certificates_select on public.employee_certificates;
create policy employee_certificates_select on public.employee_certificates for select to authenticated
  using (public.can_see_employee(employee_id));
drop policy if exists employee_certificates_insert on public.employee_certificates;
create policy employee_certificates_insert on public.employee_certificates for insert to authenticated with check (public.is_manager(company_id));
drop policy if exists employee_certificates_update on public.employee_certificates;
create policy employee_certificates_update on public.employee_certificates for update to authenticated
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));
drop policy if exists employee_certificates_delete on public.employee_certificates;
create policy employee_certificates_delete on public.employee_certificates for delete to authenticated using (public.is_manager(company_id));
grant insert (company_id, employee_id, name, issuer, number, issued_on, expires_on, notes) on public.employee_certificates to authenticated;
grant update (name, issuer, number, issued_on, expires_on, notes) on public.employee_certificates to authenticated;
grant delete on public.employee_certificates to authenticated;

-- Leave: read your own, management reads all. Changes only through the functions.
drop policy if exists leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests for select to authenticated
  using (public.can_see_employee(employee_id));

drop policy if exists timesheet_weeks_select on public.timesheet_weeks;
create policy timesheet_weeks_select on public.timesheet_weeks for select to authenticated
  using ((user_id = auth.uid() and public.is_member(company_id)) or public.has_role(company_id, public.finance_roles()));

-- Incidents: anyone reports; management sees and updates all; the reporter sees their own.
drop policy if exists hse_incidents_select on public.hse_incidents;
create policy hse_incidents_select on public.hse_incidents for select to authenticated
  using (public.is_manager(company_id) or (reported_by = auth.uid() and public.is_member(company_id)));
drop policy if exists hse_incidents_insert on public.hse_incidents;
create policy hse_incidents_insert on public.hse_incidents for insert to authenticated
  with check (reported_by = auth.uid() and public.is_member(company_id));
drop policy if exists hse_incidents_update on public.hse_incidents;
create policy hse_incidents_update on public.hse_incidents for update to authenticated
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));
grant insert (company_id, occurred_at, site, kind, severity, title, description, people_involved, employee_id, client_id,
              project_id, job_id, vehicle_id, immediate_action, lost_days)
  on public.hse_incidents to authenticated;
grant update (occurred_at, site, kind, severity, title, description, people_involved, employee_id, client_id, project_id,
              job_id, vehicle_id, immediate_action, root_cause, lost_days, reportable)
  on public.hse_incidents to authenticated;

drop policy if exists hse_inspections_select on public.hse_inspections;
create policy hse_inspections_select on public.hse_inspections for select to authenticated
  using (public.is_manager(company_id) or (inspector_id = auth.uid() and public.is_member(company_id)));
drop policy if exists hse_inspections_insert on public.hse_inspections;
create policy hse_inspections_insert on public.hse_inspections for insert to authenticated
  with check (inspector_id = auth.uid() and public.is_member(company_id));
drop policy if exists hse_inspections_update on public.hse_inspections;
create policy hse_inspections_update on public.hse_inspections for update to authenticated
  using (public.is_manager(company_id) or (inspector_id = auth.uid() and public.is_member(company_id)))
  with check (public.is_manager(company_id) or (inspector_id = auth.uid() and public.is_member(company_id)));
grant insert (company_id, inspected_on, kind, site, vehicle_id, project_id, job_id, topic, result, findings, attendees, attendee_count)
  on public.hse_inspections to authenticated;
grant update (inspected_on, kind, site, vehicle_id, project_id, job_id, topic, result, findings, attendees, attendee_count)
  on public.hse_inspections to authenticated;

drop policy if exists quality_ncrs_select on public.quality_ncrs;
create policy quality_ncrs_select on public.quality_ncrs for select to authenticated
  using (public.has_role(company_id, public.quality_roles()));
drop policy if exists quality_ncrs_insert on public.quality_ncrs;
create policy quality_ncrs_insert on public.quality_ncrs for insert to authenticated
  with check (raised_by = auth.uid() and public.has_role(company_id, public.quality_roles()));
drop policy if exists quality_ncrs_update on public.quality_ncrs;
create policy quality_ncrs_update on public.quality_ncrs for update to authenticated
  using (public.is_manager(company_id) or (raised_by = auth.uid() and status <> 'closed' and public.has_role(company_id, public.quality_roles())))
  with check (public.has_role(company_id, public.quality_roles()));
grant insert (company_id, raised_on, source, title, description, supplier_id, client_id, product_id, purchase_order_id,
              delivery_id, quantity_affected, disposition, cost)
  on public.quality_ncrs to authenticated;
grant update (raised_on, source, title, description, supplier_id, client_id, product_id, purchase_order_id, delivery_id,
              quantity_affected, disposition, root_cause, cost)
  on public.quality_ncrs to authenticated;

-- Actions: management adds and changes; the owner sees theirs; anyone who can see the record sees its actions.
drop policy if exists corrective_actions_select on public.corrective_actions;
create policy corrective_actions_select on public.corrective_actions for select to authenticated
  using (public.is_manager(company_id)
         or (owner_id = auth.uid() and public.is_member(company_id))
         or (source_kind = 'ncr' and public.has_role(company_id, public.quality_roles()))
         or (source_kind = 'incident' and exists (select 1 from public.hse_incidents i where i.id = source_id and i.reported_by = auth.uid()))
         or (source_kind = 'inspection' and exists (select 1 from public.hse_inspections s where s.id = source_id and s.inspector_id = auth.uid())));
drop policy if exists corrective_actions_insert on public.corrective_actions;
create policy corrective_actions_insert on public.corrective_actions for insert to authenticated with check (public.is_manager(company_id));
drop policy if exists corrective_actions_update on public.corrective_actions;
create policy corrective_actions_update on public.corrective_actions for update to authenticated
  using (public.is_manager(company_id) and status = 'open') with check (public.is_manager(company_id));
grant insert (company_id, source_kind, source_id, action, owner_id, due_on) on public.corrective_actions to authenticated;
grant update (action, owner_id, due_on) on public.corrective_actions to authenticated;

-- ---------------------------------------------------------------------
-- 9. What needs attention (dashboard and the Administration page)
-- ---------------------------------------------------------------------
create or replace function public.admin_summary(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_me    uuid := public.my_employee_id(p_company);
  v_mine  jsonb;
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  v_mine := jsonb_build_object(
    'employee_id', v_me,
    'my_actions', (select count(*) from public.corrective_actions where company_id = p_company and owner_id = auth.uid() and status = 'open'),
    'my_actions_overdue', (select count(*) from public.corrective_actions
                            where company_id = p_company and owner_id = auth.uid() and status = 'open' and due_on < v_today),
    'my_leave_waiting', (select count(*) from public.leave_requests where employee_id = v_me and status = 'requested'),
    'my_week_returned', (select count(*) from public.timesheet_weeks
                          where company_id = p_company and user_id = auth.uid() and status = 'returned'),
    'my_certs_expiring', (select count(*) from public.employee_certificates
                           where employee_id = v_me and expires_on <= v_today + 30));
  if not public.is_manager(p_company) then
    return v_mine || jsonb_build_object('manager', false);
  end if;
  return v_mine || jsonb_build_object(
    'manager', true,
    'employees', (select count(*) from public.employees where company_id = p_company and status = 'active'),
    'on_leave_today', (select count(*) from public.leave_requests l join public.employees e on e.id = l.employee_id
                        where l.company_id = p_company and l.status = 'approved' and v_today between l.starts_on and l.ends_on
                          and e.status = 'active'),
    'certs_expired', (select count(*) from public.employee_certificates c join public.employees e on e.id = c.employee_id
                       where c.company_id = p_company and e.status = 'active' and c.expires_on < v_today),
    'certs_expiring', (select count(*) from public.employee_certificates c join public.employees e on e.id = c.employee_id
                        where c.company_id = p_company and e.status = 'active' and c.expires_on between v_today and v_today + 30),
    'contracts_ending', (select count(*) from public.employees
                          where company_id = p_company and status = 'active' and contract_end between v_today and v_today + 30),
    'probation_ending', (select count(*) from public.employees
                          where company_id = p_company and status = 'active' and probation_end between v_today and v_today + 14),
    'leave_waiting', (select count(*) from public.leave_requests where company_id = p_company and status = 'requested'),
    'weeks_waiting', (select count(*) from public.timesheet_weeks where company_id = p_company and status = 'submitted'),
    'incidents_open', (select count(*) from public.hse_incidents where company_id = p_company and status <> 'closed'),
    'incidents_serious_open', (select count(*) from public.hse_incidents
                                where company_id = p_company and status <> 'closed' and severity in ('high', 'critical')),
    'days_since_injury', (select v_today - max((occurred_at at time zone 'Africa/Dar_es_Salaam')::date)
                            from public.hse_incidents where company_id = p_company and kind = 'injury'),
    'ncrs_open', (select count(*) from public.quality_ncrs where company_id = p_company and status <> 'closed'),
    'actions_open', (select count(*) from public.corrective_actions where company_id = p_company and status = 'open'),
    'actions_overdue', (select count(*) from public.corrective_actions
                         where company_id = p_company and status = 'open' and due_on < v_today));
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Functions: who may call them
-- ---------------------------------------------------------------------
revoke execute on function
  public.my_employee_id(uuid),
  public.can_see_employee(uuid),
  public.prepare_employee(),
  public.set_employee_status(uuid, text, date, text),
  public.weekdays_between(date, date),
  public.leave_balance(uuid, integer),
  public.request_leave(uuid, text, date, date, text),
  public.decide_leave(uuid, boolean, text),
  public.cancel_leave(uuid),
  public.monday_of(date),
  public.submit_timesheet_week(uuid, date),
  public.decide_timesheet_week(uuid, boolean, text),
  public.reopen_timesheet_week(uuid),
  public.guard_timesheet_week(),
  public.quality_roles(),
  public.prepare_admin_record(),
  public.on_admin_record_added(),
  public.set_admin_status(text, uuid, text),
  public.finish_corrective_action(uuid, boolean, text),
  public.admin_summary(uuid)
from public, anon, authenticated;
grant execute on function
  public.my_employee_id(uuid),
  public.can_see_employee(uuid),
  public.set_employee_status(uuid, text, date, text),
  public.weekdays_between(date, date),
  public.leave_balance(uuid, integer),
  public.request_leave(uuid, text, date, date, text),
  public.decide_leave(uuid, boolean, text),
  public.cancel_leave(uuid),
  public.monday_of(date),
  public.submit_timesheet_week(uuid, date),
  public.decide_timesheet_week(uuid, boolean, text),
  public.reopen_timesheet_week(uuid),
  public.quality_roles(),
  public.set_admin_status(text, uuid, text),
  public.finish_corrective_action(uuid, boolean, text),
  public.admin_summary(uuid)
to authenticated;

notify pgrst, 'reload schema';
