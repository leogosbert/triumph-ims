-- =====================================================================
-- LeMoSp · Goods and services: service jobs, maintenance, equipment,
-- consulting projects and timesheets
--
--   What you sell      companies.business_type: goods, services or both.
--                      Set at company setup (or in Features & business
--                      level); it switches the matching features on.
--   Item types         products.item_type: goods, service, labour,
--                      consultancy or hire. Only goods are used up from stock and go
--                      on delivery notes; services are quoted and
--                      invoiced next to goods.
--   Withholding tax    companies.wht_rate (5% by default): what a client
--                      may withhold on services. Invoices know which
--                      lines are services (invoice_lines.is_service), and
--                      a payment can be the client's withholding
--                      certificate (method 'withholding_tax').
--   Service jobs       service_jobs + service_job_lines: installation,
--                      repair, maintenance, inspection or consultation at
--                      a client site: technicians, checklist, materials
--                      from stock, labour, client sign-off, invoice.
--   Maintenance        service_contracts: visits every month, quarter,
--                      half year or year; due visits become jobs.
--   Equipment          client_equipment: what was installed where, serial
--                      number, warranty and next service date.
--   Projects           projects + project_milestones: consulting and
--                      project work, billed fixed, by milestone or by time.
--   Timesheets         timesheets + team_rates: hours per person on jobs
--                      and projects, billable or not, with rates.
--   Hire               hire_agreements + hire_lines: equipment you own
--                      goes out to a client and comes back, charged per
--                      day, week or month (items of type 'hire').
--   Direct supply      purchase_orders.direct_to_client: the supplier
--                      delivers straight to your client; recording it
--                      closes the order and the client's delivery note
--                      without the goods passing through your store.
--
-- Run after the services & billing file. Safe to run more than once.
-- Two check constraints are replaced to allow the new values (payment
-- method and stock movement kind); no data is removed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. What the company sells, item types, withholding tax
-- ---------------------------------------------------------------------
alter table public.companies add column if not exists business_type text not null default 'goods';
alter table public.companies drop constraint if exists companies_business_type_check;
alter table public.companies add constraint companies_business_type_check check (business_type in ('goods', 'services', 'both'));
alter table public.companies add column if not exists wht_rate numeric(5, 2) not null default 5;
alter table public.companies drop constraint if exists companies_wht_rate_check;
alter table public.companies add constraint companies_wht_rate_check check (wht_rate between 0 and 30);
grant update (wht_rate) on public.companies to authenticated;

alter table public.products add column if not exists item_type text not null default 'goods';
alter table public.products drop constraint if exists products_item_type_check;
alter table public.products add constraint products_item_type_check check (item_type in ('goods', 'service', 'labour', 'consultancy', 'hire'));

alter table public.quotation_lines add column if not exists is_service boolean not null default false;
alter table public.invoice_lines add column if not exists is_service boolean not null default false;

-- A line is a service when its item is not goods (lines without an item keep what was given).
create or replace function public.mark_service_line()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.product_id is not null then
    new.is_service := coalesce((select p.item_type <> 'goods' from public.products p where p.id = new.product_id), false);
  end if;
  return new;
end;
$$;
drop trigger if exists quotation_lines_service on public.quotation_lines;
create trigger quotation_lines_service before insert or update of product_id on public.quotation_lines
  for each row execute function public.mark_service_line();
drop trigger if exists invoice_lines_service on public.invoice_lines;
create trigger invoice_lines_service before insert or update of product_id on public.invoice_lines
  for each row execute function public.mark_service_line();

-- The client's withholding tax certificate counts as a payment.
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('bank_transfer', 'cash', 'mobile_money', 'cheque', 'withholding_tax', 'other'));

-- Materials used on a job leave the store as their own kind of movement.
alter table public.stock_movements add column if not exists job_id uuid;
alter table public.stock_movements drop constraint if exists stock_movements_kind_check;
alter table public.stock_movements add constraint stock_movements_kind_check
  check (kind in ('receipt', 'dispatch', 'return', 'adjustment', 'transfer', 'job'));

-- ---------------------------------------------------------------------
-- 2. Features
-- ---------------------------------------------------------------------
insert into public.feature_categories (name, description, sort)
values ('Services', 'Service jobs, maintenance contracts, equipment, projects and timesheets.', 25)
on conflict (name) do nothing;

insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('service_items', 'Services on quotes & invoices',
 'Sell services, labour and consultancy next to goods: priced per hour, day, visit or job, never counted in stock, with withholding tax shown on invoices.',
 'Services', 'small', 'live', 'Every company that installs, repairs, transports or advises as well as selling goods.',
 'One quotation and one invoice for the pipes and the installation; services stay out of stock counts.',
 '[{"title": "Mark an item as a service", "body": "Open Products, choose the item and set Type to Service, Labour or Consultancy. Put the unit as hour, day, visit or job."},
   {"title": "Quote goods and services together", "body": "Add both to one quotation. The invoice shows the services total and the withholding tax a client may deduct."}]'::jsonb,
 '/products', 400),
('service_jobs', 'Service jobs (work orders)',
 'Installation, repair, maintenance and inspection jobs at client sites: technicians, date, checklist, materials and hours used, client sign-off, then one tap to invoice.',
 'Services', 'medium', 'live', 'Companies with technicians or installers working at client sites.',
 'Nothing is forgotten on site, materials leave stock correctly and every job is invoiced.',
 '[{"title": "Create a job", "body": "Open Service jobs, press New job, choose the client, the type of work, the date and the technicians."},
   {"title": "Do the work", "body": "The technician opens the job on the phone, ticks the checklist, adds the materials and hours used and the findings."},
   {"title": "Sign off and invoice", "body": "The client signs on the phone. Finance presses Make invoice: labour, materials and the agreed price become a draft invoice."}]'::jsonb,
 '/jobs', 410),
('maintenance_contracts', 'Maintenance contracts',
 'Agreements to service a client''s equipment every month, quarter, half year or year: the visits are planned for you and become service jobs.',
 'Services', 'medium', 'live', 'Companies that maintain pumps, generators, air conditioning, fire equipment, pipes or machines.',
 'Regular income and no missed visits.',
 '[{"title": "Record the contract", "body": "Open Maintenance, press New contract: client, how often, the first visit date, the price per period and what to check on each visit."},
   {"title": "Visits become jobs", "body": "Two weeks before each visit LeMoSp creates the service job with the checklist. Assign the technician and go."}]'::jsonb,
 '/maintenance', 420),
('equipment_register', 'Installed equipment register',
 'Everything you installed or maintain at each client: serial number, location, warranty end and next service date, with its job history.',
 'Services', 'medium', 'live', 'Companies that install and service equipment.',
 'Know what is where, what is under warranty and what is due for service.',
 '[{"title": "Add equipment", "body": "Open Equipment, press Add: client, item, serial number, where it is, install date, warranty and service interval."},
   {"title": "Follow it up", "body": "Warranties ending soon and services due show at the top, and each job on the equipment is kept in its history."}]'::jsonb,
 '/equipment', 430),
('projects', 'Projects & consulting',
 'Consulting and project work for clients: scope, budget, milestones and hours, billed at a fixed price, by milestone or by the time spent.',
 'Services', 'enterprise', 'live', 'Consultants, engineers and companies doing larger installation projects.',
 'See budget against hours used and invoice each milestone on time.',
 '[{"title": "Start a project", "body": "Open Projects, press New project: client, how it is billed, the budget and the milestones."},
   {"title": "Log time", "body": "Everyone records their hours in Timesheets against the project."},
   {"title": "Invoice", "body": "Invoice a finished milestone or the hours not yet billed, in one step."}]'::jsonb,
 '/projects', 440),
('timesheets', 'Timesheets & billable hours',
 'Each person records hours on jobs and projects, billable or not. Management sets the rate charged and the cost of each person.',
 'Services', 'enterprise', 'live', 'Companies that charge for time or want to know how busy their people are.',
 'Bill every hour worked and see each person''s workload.',
 '[{"title": "Record your hours", "body": "Open Timesheets, choose the day, the job or project, the hours and what you did."},
   {"title": "Rates", "body": "Management sets each person''s hourly rate and cost once; they are used for invoices and profit."}]'::jsonb,
 '/timesheets', 450),
('service_reports', 'Service reports',
 'Income from services against goods, profit per job, open and late jobs, visits due, warranties ending and how busy each person is.',
 'Services', 'medium', 'live', 'Owners and managers of companies that sell services.',
 'Know which work makes money and where people are overloaded.',
 '[{"title": "Open the reports", "body": "Open Service reports and choose the month. Each table can be printed."},
   {"title": "Act on it", "body": "Raise prices on jobs that lose money, plan visits that are due and share out work from people who are overloaded."}]'::jsonb,
 '/service-reports', 460)
on conflict (key) do nothing;

-- Switch features to match what the company sells (management; also called at the end of setup).
create or replace function public.set_business_type(p_company uuid, p_type text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  k text;
  v_lvl public.business_level;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can change what the company sells.' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('goods', 'services', 'both') then
    raise exception 'Choose goods, services or both.' using errcode = '22023';
  end if;
  update public.companies set business_type = p_type where id = p_company;
  select business_level into v_lvl from public.companies where id = p_company;

  if p_type in ('services', 'both') then
    -- Field work is the heart of a service business, whatever its size.
    foreach k in array array['service_items', 'service_jobs', 'equipment_register', 'maintenance_contracts', 'service_reports'] loop
      begin
        perform public.apply_company_feature(p_company, k, true, 'manual');
      exception when others then null;
      end;
    end loop;
    if v_lvl = 'enterprise' or p_type = 'services' then
      foreach k in array array['timesheets', 'projects'] loop
        begin
          perform public.apply_company_feature(p_company, k, true, 'manual');
        exception when others then null;
        end;
      end loop;
    end if;
  else
    -- Goods only: the service screens stay out of the way (they can be switched on later).
    foreach k in array array['service_jobs', 'maintenance_contracts', 'equipment_register', 'projects', 'timesheets', 'service_reports'] loop
      begin
        perform public.apply_company_feature(p_company, k, false, 'manual');
      exception when others then null;
      end;
    end loop;
  end if;
  if p_type = 'services' then
    -- No goods on the road: deliveries and the driver app are not needed at first.
    foreach k in array array['driver_app', 'batch_expiry', 'landed_cost'] loop
      begin
        perform public.apply_company_feature(p_company, k, false, 'manual');
      exception when others then null;
      end;
    end loop;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------
create table if not exists public.team_rates (
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  bill_rate   numeric(18, 2) check (bill_rate is null or bill_rate >= 0),   -- charged to clients per hour
  cost_rate   numeric(18, 2) check (cost_rate is null or cost_rate >= 0),   -- what an hour costs the company
  title       text check (title is null or char_length(title) <= 80),        -- e.g. Senior engineer
  updated_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.client_equipment (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  client_id             uuid not null,
  product_id            uuid,
  name                  text not null check (char_length(btrim(name)) between 2 and 200),
  serial_no             text check (serial_no is null or char_length(serial_no) <= 120),
  location              text check (location is null or char_length(location) <= 300),
  installed_on          date,
  warranty_until        date,
  service_every_months  integer check (service_every_months is null or service_every_months between 1 and 120),
  last_service_on       date,
  next_service_on       date,
  notes                 text check (notes is null or char_length(notes) <= 2000),
  active                boolean not null default true,
  created_by            uuid default auth.uid() references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (product_id, company_id) references public.products (id, company_id)
);
create index if not exists client_equipment_company_idx on public.client_equipment (company_id, client_id);
create index if not exists client_equipment_due_idx on public.client_equipment (company_id, next_service_on) where active;

create table if not exists public.service_contracts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  number          text not null default '',
  client_id       uuid not null,
  title           text not null check (char_length(btrim(title)) between 2 and 200),
  frequency       text not null default 'quarterly' check (frequency in ('monthly', 'quarterly', 'half_yearly', 'yearly')),
  starts_on       date not null,
  ends_on         date,
  next_visit_on   date,
  visit_title     text check (visit_title is null or char_length(visit_title) <= 200),
  checklist       jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  response_hours  integer check (response_hours is null or response_hours between 1 and 720),
  price           numeric(18, 2) check (price is null or price >= 0),          -- per period
  currency        text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  equipment_id    uuid,
  site            text check (site is null or char_length(site) <= 300),
  status          text not null default 'active' check (status in ('active', 'paused', 'ended')),
  notes           text check (notes is null or char_length(notes) <= 2000),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (equipment_id, company_id) references public.client_equipment (id, company_id)
);
create index if not exists service_contracts_company_idx on public.service_contracts (company_id, status, next_visit_on);

create table if not exists public.projects (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  number          text not null default '',
  client_id       uuid not null,
  name            text not null check (char_length(btrim(name)) between 2 and 200),
  description     text check (description is null or char_length(description) <= 4000),
  billing         text not null default 'time' check (billing in ('fixed', 'milestone', 'time')),
  budget_amount   numeric(18, 2) check (budget_amount is null or budget_amount >= 0),
  budget_hours    numeric(10, 2) check (budget_hours is null or budget_hours >= 0),
  default_rate    numeric(18, 2) check (default_rate is null or default_rate >= 0),
  currency        text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  starts_on       date,
  ends_on         date,
  manager_id      uuid references auth.users (id) on delete set null,
  status          text not null default 'active' check (status in ('active', 'on_hold', 'completed', 'cancelled')),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id)
);
create index if not exists projects_company_idx on public.projects (company_id, status);

create table if not exists public.project_milestones (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  project_id  uuid not null,
  title       text not null check (char_length(btrim(title)) between 2 and 200),
  due_on      date,
  amount      numeric(18, 2) check (amount is null or amount >= 0),
  status      text not null default 'open' check (status in ('open', 'done', 'invoiced')),
  invoice_id  uuid,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (project_id, company_id) references public.projects (id, company_id) on delete cascade,
  foreign key (invoice_id, company_id) references public.invoices (id, company_id)
);
create index if not exists project_milestones_project_idx on public.project_milestones (project_id, sort);

create table if not exists public.service_jobs (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  number           text not null default '',
  client_id        uuid not null,
  contract_id      uuid,
  equipment_id     uuid,
  project_id       uuid,
  quotation_id     uuid,
  title            text not null check (char_length(btrim(title)) between 2 and 200),
  kind             text not null default 'installation'
                   check (kind in ('installation', 'repair', 'maintenance', 'inspection', 'consultation', 'delivery_install', 'other')),
  priority         text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status           text not null default 'scheduled'
                   check (status in ('scheduled', 'in_progress', 'on_hold', 'completed', 'invoiced', 'cancelled')),
  site             text check (site is null or char_length(site) <= 300),
  contact          text check (contact is null or char_length(contact) <= 200),
  scheduled_for    timestamptz,
  due_by           timestamptz,
  assigned_to      uuid[] not null default '{}',
  description      text check (description is null or char_length(description) <= 4000),
  findings         text check (findings is null or char_length(findings) <= 4000),
  checklist        jsonb not null default '[]'::jsonb check (jsonb_typeof(checklist) = 'array'),
  price            numeric(18, 2) check (price is null or price >= 0),          -- agreed fixed price (else lines are billed)
  currency         text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  warehouse_id     uuid,
  started_at       timestamptz,
  completed_at     timestamptz,
  signed_by_name   text check (signed_by_name is null or char_length(signed_by_name) <= 120),
  signature_path   text,
  invoice_id       uuid,
  cancelled_reason text check (cancelled_reason is null or char_length(cancelled_reason) <= 300),
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (contract_id, company_id) references public.service_contracts (id, company_id),
  foreign key (equipment_id, company_id) references public.client_equipment (id, company_id),
  foreign key (project_id, company_id) references public.projects (id, company_id),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id),
  foreign key (warehouse_id, company_id) references public.warehouses (id, company_id),
  foreign key (invoice_id, company_id) references public.invoices (id, company_id)
);
create index if not exists service_jobs_company_idx on public.service_jobs (company_id, status, scheduled_for);
create index if not exists service_jobs_assigned_idx on public.service_jobs using gin (assigned_to);

create table if not exists public.service_job_lines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  job_id        uuid not null,
  kind          text not null default 'material' check (kind in ('material', 'labour', 'other')),
  product_id    uuid,
  description   text not null check (char_length(btrim(description)) between 1 and 300),
  quantity      numeric(18, 3) not null check (quantity > 0),
  unit          text not null default 'pcs' check (char_length(unit) <= 20),
  unit_price    numeric(18, 2) not null default 0 check (unit_price >= 0),
  unit_cost     numeric(18, 2) check (unit_cost is null or unit_cost >= 0),
  person_id     uuid references auth.users (id) on delete set null,
  posted_at     timestamptz,                                               -- materials taken from stock
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (job_id, company_id) references public.service_jobs (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id)
);
create index if not exists service_job_lines_job_idx on public.service_job_lines (job_id, created_at);

create table if not exists public.timesheets (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  work_date    date not null,
  hours        numeric(5, 2) not null check (hours > 0 and hours <= 24),
  project_id   uuid,
  job_id       uuid,
  client_id    uuid,
  description  text check (description is null or char_length(description) <= 500),
  billable     boolean not null default true,
  rate         numeric(18, 2) check (rate is null or rate >= 0),
  cost_rate    numeric(18, 2) check (cost_rate is null or cost_rate >= 0),
  invoice_id   uuid,
  created_at   timestamptz not null default now(),
  foreign key (project_id, company_id) references public.projects (id, company_id),
  foreign key (job_id, company_id) references public.service_jobs (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (invoice_id, company_id) references public.invoices (id, company_id)
);
create index if not exists timesheets_company_idx on public.timesheets (company_id, work_date desc);
create index if not exists timesheets_user_idx on public.timesheets (user_id, work_date desc);
create index if not exists timesheets_project_idx on public.timesheets (project_id) where project_id is not null;
create index if not exists timesheets_job_idx on public.timesheets (job_id) where job_id is not null;

alter table public.stock_movements drop constraint if exists stock_movements_job_fk;
alter table public.stock_movements add constraint stock_movements_job_fk
  foreign key (job_id) references public.service_jobs (id) on delete set null;

-- ---------------------------------------------------------------------
-- 4. Numbers, rates and checks on save
-- ---------------------------------------------------------------------
create or replace function public.prepare_service_record()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and coalesce(new.number, '') = '' then
    new.number := case tg_table_name
      when 'service_jobs' then public.next_code(new.company_id, 'service_jobs', 'JOB-', 4)
      when 'service_contracts' then public.next_code(new.company_id, 'service_contracts', 'MC-', 3)
      else public.next_code(new.company_id, 'projects', 'PRJ-', 3) end;
  end if;
  if tg_table_name = 'service_contracts' then
    if new.next_visit_on is null then new.next_visit_on := new.starts_on; end if;
    if new.ends_on is not null and new.ends_on < new.starts_on then
      raise exception 'The end date must be after the start date.' using errcode = '22023';
    end if;
  end if;
  if tg_table_name = 'projects' then
    if new.ends_on is not null and new.starts_on is not null and new.ends_on < new.starts_on then
      raise exception 'The end date must be after the start date.' using errcode = '22023';
    end if;
  end if;
  -- Status changes go through the functions below.
  if tg_op = 'UPDATE' and new.status is distinct from old.status and coalesce(current_setting('ims.status_change', true), '') <> 'on' then
    if tg_table_name = 'service_jobs' then
      raise exception 'Use the buttons on the job to change its status.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists service_jobs_prepare on public.service_jobs;
create trigger service_jobs_prepare before insert or update on public.service_jobs for each row execute function public.prepare_service_record();
drop trigger if exists service_contracts_prepare on public.service_contracts;
create trigger service_contracts_prepare before insert or update on public.service_contracts for each row execute function public.prepare_service_record();
drop trigger if exists projects_prepare on public.projects;
create trigger projects_prepare before insert or update on public.projects for each row execute function public.prepare_service_record();

-- Assigned people must be active members.
create or replace function public.check_job_people()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  u uuid;
begin
  foreach u in array coalesce(new.assigned_to, '{}') loop
    if not public.is_active_member(new.company_id, u) then
      raise exception 'Only active team members can be assigned to a job.' using errcode = '22023';
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists service_jobs_people on public.service_jobs;
create trigger service_jobs_people before insert or update of assigned_to on public.service_jobs
  for each row execute function public.check_job_people();

-- Timesheet lines: rates from the project or the person, a client from the job or project, and
-- invoiced hours stay as they are.
create or replace function public.prepare_timesheet()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  r public.team_rates;
begin
  if tg_op = 'UPDATE' and old.invoice_id is not null then
    raise exception 'These hours are already invoiced and cannot be changed.' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' then
    if not public.is_active_member(new.company_id, new.user_id) then
      raise exception 'Hours can only be recorded for active team members.' using errcode = '22023';
    end if;
    select * into r from public.team_rates where company_id = new.company_id and user_id = new.user_id;
    new.rate := coalesce(new.rate,
                         (select p.default_rate from public.projects p where p.id = new.project_id and p.default_rate is not null),
                         r.bill_rate);
    new.cost_rate := coalesce(new.cost_rate, r.cost_rate);
    new.invoice_id := null;
  end if;
  if new.client_id is null then
    new.client_id := coalesce((select j.client_id from public.service_jobs j where j.id = new.job_id),
                              (select p.client_id from public.projects p where p.id = new.project_id));
  end if;
  if new.work_date > (now() at time zone 'Africa/Dar_es_Salaam')::date + 7 then
    raise exception 'Hours cannot be recorded more than a week ahead.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists timesheets_prepare on public.timesheets;
create trigger timesheets_prepare before insert or update on public.timesheets for each row execute function public.prepare_timesheet();

-- ---------------------------------------------------------------------
-- 5. Triggers, row-level security and grants
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['team_rates', 'client_equipment', 'service_contracts', 'projects', 'project_milestones', 'service_jobs'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['team_rates', 'client_equipment', 'service_contracts', 'projects', 'project_milestones', 'service_jobs',
                           'service_job_lines', 'timesheets'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Who plans and runs service work.
create or replace function public.service_roles()
returns public.app_role[] language sql immutable set search_path = ''
as $$ select array['management', 'sales', 'warehouse']::public.app_role[]; $$;

-- Is the signed-in person one of the job's technicians?
create or replace function public.on_job(p_job uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.service_jobs j
                  where j.id = p_job and auth.uid() = any (j.assigned_to) and public.is_member(j.company_id));
$$;

-- Rates: management and finance; each person sees their own.
drop policy if exists team_rates_select on public.team_rates;
create policy team_rates_select on public.team_rates for select to authenticated
  using (public.has_role(company_id, public.finance_roles()) or (user_id = auth.uid() and public.is_member(company_id)));
drop policy if exists team_rates_insert on public.team_rates;
create policy team_rates_insert on public.team_rates for insert to authenticated
  with check (public.has_role(company_id, public.finance_roles()));
drop policy if exists team_rates_update on public.team_rates;
create policy team_rates_update on public.team_rates for update to authenticated
  using (public.has_role(company_id, public.finance_roles())) with check (public.has_role(company_id, public.finance_roles()));
grant insert (company_id, user_id, bill_rate, cost_rate, title) on public.team_rates to authenticated;
grant update (bill_rate, cost_rate, title) on public.team_rates to authenticated;

-- Equipment: everyone in the company can look it up; service roles keep it.
drop policy if exists client_equipment_select on public.client_equipment;
create policy client_equipment_select on public.client_equipment for select to authenticated using (public.is_member(company_id));
drop policy if exists client_equipment_insert on public.client_equipment;
create policy client_equipment_insert on public.client_equipment for insert to authenticated
  with check (public.has_role(company_id, public.service_roles()));
drop policy if exists client_equipment_update on public.client_equipment;
create policy client_equipment_update on public.client_equipment for update to authenticated
  using (public.has_role(company_id, public.service_roles())) with check (public.has_role(company_id, public.service_roles()));
grant insert (company_id, client_id, product_id, name, serial_no, location, installed_on, warranty_until, service_every_months,
              last_service_on, next_service_on, notes)
  on public.client_equipment to authenticated;
grant update (client_id, product_id, name, serial_no, location, installed_on, warranty_until, service_every_months,
              last_service_on, next_service_on, notes, active)
  on public.client_equipment to authenticated;

-- Maintenance contracts: management and sales keep them; finance reads them.
drop policy if exists service_contracts_select on public.service_contracts;
create policy service_contracts_select on public.service_contracts for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'finance', 'warehouse']::public.app_role[]));
drop policy if exists service_contracts_insert on public.service_contracts;
create policy service_contracts_insert on public.service_contracts for insert to authenticated
  with check (public.has_role(company_id, array['management', 'sales']::public.app_role[]));
drop policy if exists service_contracts_update on public.service_contracts;
create policy service_contracts_update on public.service_contracts for update to authenticated
  using (public.has_role(company_id, array['management', 'sales']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'sales']::public.app_role[]));
grant insert (company_id, client_id, title, frequency, starts_on, ends_on, next_visit_on, visit_title, checklist, response_hours,
              price, currency, equipment_id, site, notes)
  on public.service_contracts to authenticated;
grant update (title, frequency, ends_on, next_visit_on, visit_title, checklist, response_hours, price, currency, equipment_id,
              site, status, notes)
  on public.service_contracts to authenticated;

-- Projects: every member can see them (to record hours); management and sales keep them.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated using (public.is_member(company_id));
drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects for insert to authenticated
  with check (public.has_role(company_id, array['management', 'sales']::public.app_role[]));
drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects for update to authenticated
  using (public.has_role(company_id, array['management', 'sales']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'sales']::public.app_role[]));
grant insert (company_id, client_id, name, description, billing, budget_amount, budget_hours, default_rate, currency, starts_on,
              ends_on, manager_id)
  on public.projects to authenticated;
grant update (name, description, billing, budget_amount, budget_hours, default_rate, currency, starts_on, ends_on, manager_id, status)
  on public.projects to authenticated;

drop policy if exists project_milestones_select on public.project_milestones;
create policy project_milestones_select on public.project_milestones for select to authenticated using (public.is_member(company_id));
drop policy if exists project_milestones_insert on public.project_milestones;
create policy project_milestones_insert on public.project_milestones for insert to authenticated
  with check (public.has_role(company_id, array['management', 'sales']::public.app_role[]));
drop policy if exists project_milestones_update on public.project_milestones;
create policy project_milestones_update on public.project_milestones for update to authenticated
  using (public.has_role(company_id, array['management', 'sales']::public.app_role[]) and status <> 'invoiced')
  with check (public.has_role(company_id, array['management', 'sales']::public.app_role[]) and status <> 'invoiced');
drop policy if exists project_milestones_delete on public.project_milestones;
create policy project_milestones_delete on public.project_milestones for delete to authenticated
  using (public.has_role(company_id, array['management', 'sales']::public.app_role[]) and status = 'open');
grant insert (company_id, project_id, title, due_on, amount, sort) on public.project_milestones to authenticated;
grant update (title, due_on, amount, status, sort) on public.project_milestones to authenticated;
grant delete on public.project_milestones to authenticated;

-- Jobs: service roles and finance see them all; technicians see the jobs they are on.
drop policy if exists service_jobs_select on public.service_jobs;
create policy service_jobs_select on public.service_jobs for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'warehouse', 'finance']::public.app_role[])
         or (auth.uid() = any (assigned_to) and public.is_member(company_id)));
drop policy if exists service_jobs_insert on public.service_jobs;
create policy service_jobs_insert on public.service_jobs for insert to authenticated
  with check (public.has_role(company_id, public.service_roles()));
drop policy if exists service_jobs_update on public.service_jobs;
create policy service_jobs_update on public.service_jobs for update to authenticated
  using (public.has_role(company_id, public.service_roles()) and status not in ('invoiced', 'cancelled'))
  with check (public.has_role(company_id, public.service_roles()));
grant insert (company_id, client_id, contract_id, equipment_id, project_id, quotation_id, title, kind, priority, site, contact,
              scheduled_for, due_by, assigned_to, description, checklist, price, currency, warehouse_id)
  on public.service_jobs to authenticated;
grant update (title, kind, priority, site, contact, scheduled_for, due_by, assigned_to, description, checklist, price, currency,
              warehouse_id, equipment_id, project_id)
  on public.service_jobs to authenticated;

-- Job lines: service roles and the job's technicians add them while the job is open.
create or replace function public.job_open(p_job uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.service_jobs j where j.id = p_job and j.status in ('scheduled', 'in_progress', 'on_hold'));
$$;
drop policy if exists service_job_lines_select on public.service_job_lines;
create policy service_job_lines_select on public.service_job_lines for select to authenticated
  using (exists (select 1 from public.service_jobs j where j.id = job_id));
drop policy if exists service_job_lines_insert on public.service_job_lines;
create policy service_job_lines_insert on public.service_job_lines for insert to authenticated
  with check (public.job_open(job_id) and (public.has_role(company_id, public.service_roles()) or public.on_job(job_id)));
drop policy if exists service_job_lines_delete on public.service_job_lines;
create policy service_job_lines_delete on public.service_job_lines for delete to authenticated
  using (posted_at is null and public.job_open(job_id)
         and (public.has_role(company_id, public.service_roles()) or (created_by = auth.uid() and public.on_job(job_id))));
grant insert (company_id, job_id, kind, product_id, description, quantity, unit, unit_price, unit_cost, person_id)
  on public.service_job_lines to authenticated;
grant delete on public.service_job_lines to authenticated;

-- Timesheets: everyone records their own; management and finance see all and correct them.
drop policy if exists timesheets_select on public.timesheets;
create policy timesheets_select on public.timesheets for select to authenticated
  using ((user_id = auth.uid() and public.is_member(company_id)) or public.has_role(company_id, public.finance_roles()));
drop policy if exists timesheets_insert on public.timesheets;
create policy timesheets_insert on public.timesheets for insert to authenticated
  with check ((user_id = auth.uid() and public.is_member(company_id)) or public.is_manager(company_id));
drop policy if exists timesheets_update on public.timesheets;
create policy timesheets_update on public.timesheets for update to authenticated
  using (invoice_id is null and ((user_id = auth.uid() and public.is_member(company_id)) or public.is_manager(company_id)))
  with check ((user_id = auth.uid() and public.is_member(company_id)) or public.is_manager(company_id));
drop policy if exists timesheets_delete on public.timesheets;
create policy timesheets_delete on public.timesheets for delete to authenticated
  using (invoice_id is null and ((user_id = auth.uid() and public.is_member(company_id)) or public.is_manager(company_id)));
grant insert (company_id, user_id, work_date, hours, project_id, job_id, client_id, description, billable)
  on public.timesheets to authenticated;
grant update (work_date, hours, project_id, job_id, client_id, description, billable) on public.timesheets to authenticated;
grant update (rate, cost_rate) on public.timesheets to authenticated;
grant delete on public.timesheets to authenticated;

-- Only management and finance may set the money on a timesheet line.
create or replace function public.guard_timesheet_rates()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (new.rate is distinct from old.rate or new.cost_rate is distinct from old.cost_rate)
     and not public.has_role(new.company_id, public.finance_roles()) then
    raise exception 'Only management or finance can change rates.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists timesheets_rates on public.timesheets;
create trigger timesheets_rates before update on public.timesheets for each row execute function public.guard_timesheet_rates();

-- ---------------------------------------------------------------------
-- 6. Job steps
-- ---------------------------------------------------------------------
create or replace function public.can_work_job(p_job uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.service_jobs j
                  where j.id = p_job and (public.has_role(j.company_id, public.service_roles()) or public.on_job(p_job)));
$$;

-- The technician (or management) ticks the checklist and writes the findings.
create or replace function public.update_job_progress(p_job uuid, p_checklist jsonb, p_findings text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_work_job(p_job) then
    raise exception 'Job not found.' using errcode = '42501';
  end if;
  if not public.job_open(p_job) then
    raise exception 'This job is closed.' using errcode = '22023';
  end if;
  if p_checklist is not null and (jsonb_typeof(p_checklist) <> 'array' or jsonb_array_length(p_checklist) > 60) then
    raise exception 'The checklist can have at most 60 points.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_findings, '')) > 4000 then
    raise exception 'Please keep the findings under 4,000 characters.' using errcode = '22023';
  end if;
  update public.service_jobs
     set checklist = coalesce(p_checklist, checklist), findings = coalesce(nullif(btrim(p_findings), ''), findings)
   where id = p_job;
end;
$$;

-- Start, hold or resume.
create or replace function public.set_job_status(p_job uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  j public.service_jobs;
begin
  select * into j from public.service_jobs where id = p_job for update;
  if j.id is null or not public.can_work_job(p_job) then
    raise exception 'Job not found.' using errcode = '42501';
  end if;
  if p_status not in ('in_progress', 'on_hold', 'scheduled', 'cancelled') then
    raise exception 'Choose start, hold or cancel.' using errcode = '22023';
  end if;
  if j.status not in ('scheduled', 'in_progress', 'on_hold') then
    raise exception 'This job is closed.' using errcode = '22023';
  end if;
  if p_status = 'cancelled' then
    if not public.has_role(j.company_id, public.service_roles()) then
      raise exception 'Only management, sales or warehouse can cancel a job.' using errcode = '42501';
    end if;
    if exists (select 1 from public.service_job_lines where job_id = p_job and posted_at is not null) then
      raise exception 'Materials from this job already left the store. Complete it instead.' using errcode = '22023';
    end if;
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.service_jobs
     set status = p_status,
         started_at = case when p_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
         cancelled_reason = case when p_status = 'cancelled' then left(nullif(btrim(coalesce(p_reason, '')), ''), 300) else cancelled_reason end
   where id = p_job;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Finish the job: materials leave the store (oldest batches first), the equipment's service dates
-- move on, and the client's sign-off is kept.
create or replace function public.complete_service_job(p_job uuid, p_findings text, p_signed_by text, p_signature_path text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  j public.service_jobs;
  l record;
  b record;
  v_wh uuid;
  v_need numeric;
  v_take numeric;
  v_have numeric;
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
begin
  select * into j from public.service_jobs where id = p_job for update;
  if j.id is null or not public.can_work_job(p_job) then
    raise exception 'Job not found.' using errcode = '42501';
  end if;
  if j.status not in ('scheduled', 'in_progress', 'on_hold') then
    raise exception 'This job is already closed.' using errcode = '22023';
  end if;
  if p_signature_path is not null and p_signature_path !~ ('^' || j.company_id::text || '/jobs/[A-Za-z0-9._/-]+$') then
    raise exception 'Invalid signature file.' using errcode = '22023';
  end if;
  v_wh := coalesce(j.warehouse_id,
                   (select id from public.warehouses where company_id = j.company_id and active order by (code = 'MAIN') desc, created_at limit 1));

  for l in select sl.*, p.name as product_name from public.service_job_lines sl
             join public.products p on p.id = sl.product_id
            where sl.job_id = p_job and sl.kind = 'material' and sl.posted_at is null and p.item_type = 'goods'
            order by sl.created_at loop
    if v_wh is null then
      raise exception 'Add a store first: materials have to come from a store.' using errcode = '22023';
    end if;
    select coalesce(sum(quantity), 0) into v_have from public.stock_movements where product_id = l.product_id and warehouse_id = v_wh;
    if v_have < l.quantity then
      raise exception 'Not enough stock of % in the store: need %, have %.', l.product_name, trim_scale(l.quantity), trim_scale(v_have)
        using errcode = '22023';
    end if;
    v_need := l.quantity;
    for b in select batch_no, expiry_date, sum(quantity) as qty from public.stock_movements
              where product_id = l.product_id and warehouse_id = v_wh
              group by batch_no, expiry_date having sum(quantity) > 0
              order by expiry_date nulls last, batch_no loop
      exit when v_need <= 0;
      v_take := least(v_need, b.qty);
      insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, expiry_date, job_id, note)
      values (j.company_id, l.product_id, v_wh, -v_take, 'job', b.batch_no, b.expiry_date, p_job, j.number);
      v_need := v_need - v_take;
    end loop;
    update public.service_job_lines set posted_at = now() where id = l.id;
  end loop;

  perform set_config('ims.status_change', 'on', true);
  update public.service_jobs
     set status = 'completed', completed_at = now(), started_at = coalesce(started_at, now()), warehouse_id = coalesce(warehouse_id, v_wh),
         findings = coalesce(nullif(btrim(coalesce(p_findings, '')), ''), findings),
         signed_by_name = left(nullif(btrim(coalesce(p_signed_by, '')), ''), 120),
         signature_path = coalesce(p_signature_path, signature_path)
   where id = p_job;
  perform set_config('ims.status_change', 'off', true);

  if j.equipment_id is not null then
    update public.client_equipment
       set last_service_on = v_today,
           next_service_on = case when service_every_months is not null
                                  then (v_today + make_interval(months => service_every_months))::date else next_service_on end
     where id = j.equipment_id;
  end if;

  perform public.notify_roles(j.company_id, array['management', 'finance']::public.app_role[], auth.uid(), 'service', 'info',
    'Job completed: ' || j.number || ' · ' || j.title, 'Ready to invoice.', '/jobs/' || p_job, 'job-' || p_job::text || '-done');
end;
$$;

-- Finance: a draft invoice from a completed job (agreed price, or labour + materials + other lines,
-- plus billable hours on the job not invoiced yet).
create or replace function public.invoice_service_job(p_job uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  j public.service_jobs;
  co public.companies;
  cl public.clients;
  v_id uuid;
  n integer := 0;
  l record;
begin
  select * into j from public.service_jobs where id = p_job for update;
  if j.id is null or not public.has_role(j.company_id, array['management', 'finance']::public.app_role[]) then
    raise exception 'Only management and finance can invoice jobs.' using errcode = '42501';
  end if;
  if j.status <> 'completed' then
    raise exception 'Complete the job before invoicing it.' using errcode = '22023';
  end if;
  select * into co from public.companies where id = j.company_id;
  select * into cl from public.clients where id = j.client_id;

  insert into public.invoices (company_id, client_id, quotation_id, currency, exchange_rate, payment_terms, vat_rate, terms, notes, created_by)
  values (j.company_id, j.client_id, null, j.currency, 1, cl.payment_terms, co.vat_rate, co.invoice_terms,
          j.number || ' · ' || j.title || coalesce(' · ' || j.site, ''), auth.uid())
  returning id into v_id;

  if j.price is not null then
    n := 1;
    insert into public.invoice_lines (company_id, invoice_id, line_no, description, quantity, unit, unit_price, is_service)
    values (j.company_id, v_id, n, j.title || ' (' || j.number || ')', 1, 'job', j.price, true);
  else
    for l in select sl.*, coalesce(p.item_type, case when sl.kind = 'material' then 'goods' else 'service' end) as itype
               from public.service_job_lines sl left join public.products p on p.id = sl.product_id
              where sl.job_id = p_job order by (sl.kind = 'labour') desc, sl.created_at loop
      n := n + 1;
      insert into public.invoice_lines (company_id, invoice_id, line_no, product_id, description, quantity, unit, unit_price, is_service)
      values (j.company_id, v_id, n, l.product_id, l.description, l.quantity, l.unit, l.unit_price, l.itype <> 'goods');
    end loop;
    for l in select t.rate, sum(t.hours) as hours, string_agg(distinct coalesce(nullif(btrim(pr.full_name), ''), pr.email), ', ') as who
               from public.timesheets t left join public.profiles pr on pr.id = t.user_id
              where t.job_id = p_job and t.billable and t.invoice_id is null and coalesce(t.rate, 0) > 0
              group by t.rate loop
      n := n + 1;
      insert into public.invoice_lines (company_id, invoice_id, line_no, description, quantity, unit, unit_price, is_service)
      values (j.company_id, v_id, n, 'Labour: ' || coalesce(l.who, 'team'), l.hours, 'hour', l.rate, true);
    end loop;
    update public.timesheets set invoice_id = v_id
     where job_id = p_job and billable and invoice_id is null and coalesce(rate, 0) > 0;
  end if;
  if n = 0 then
    raise exception 'Nothing to invoice: give the job a price or add labour and materials.' using errcode = '22023';
  end if;

  perform set_config('ims.status_change', 'on', true);
  update public.service_jobs set status = 'invoiced', invoice_id = v_id where id = p_job;
  perform set_config('ims.status_change', 'off', true);
  return v_id;
end;
$$;

-- Maintenance: create the jobs for visits due in the next 14 days and move each contract on.
create or replace function public.create_due_service_visits(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  c public.service_contracts;
  v_n integer := 0;
  v_until date := (now() at time zone 'Africa/Dar_es_Salaam')::date + 14;
  v_step interval;
  v_loops integer;
begin
  if not public.has_role(p_company, public.service_roles()) then
    raise exception 'You cannot plan service visits.' using errcode = '42501';
  end if;
  for c in select * from public.service_contracts
            where company_id = p_company and status = 'active' and next_visit_on is not null and next_visit_on <= v_until
            for update loop
    v_step := case c.frequency when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
                               when 'half_yearly' then interval '6 months' else interval '1 year' end;
    v_loops := 0;
    while c.next_visit_on <= v_until and (c.ends_on is null or c.next_visit_on <= c.ends_on) and v_loops < 24 loop
      if not exists (select 1 from public.service_jobs
                      where contract_id = c.id and (scheduled_for at time zone 'Africa/Dar_es_Salaam')::date = c.next_visit_on
                        and status <> 'cancelled') then
        insert into public.service_jobs (company_id, client_id, contract_id, equipment_id, title, kind, site, scheduled_for,
                                         due_by, checklist, currency, created_by)
        values (c.company_id, c.client_id, c.id, c.equipment_id, coalesce(c.visit_title, c.title), 'maintenance', c.site,
                (c.next_visit_on + time '08:00') at time zone 'Africa/Dar_es_Salaam',
                case when c.response_hours is not null
                     then ((c.next_visit_on + time '08:00') at time zone 'Africa/Dar_es_Salaam') + make_interval(hours => c.response_hours) end,
                (select coalesce(jsonb_agg(jsonb_build_object('text', x, 'done', false)), '[]'::jsonb)
                   from jsonb_array_elements_text(c.checklist) x),
                c.currency, auth.uid());
        v_n := v_n + 1;
      end if;
      c.next_visit_on := (c.next_visit_on + v_step)::date;
      v_loops := v_loops + 1;
    end loop;
    update public.service_contracts
       set next_visit_on = c.next_visit_on,
           status = case when c.ends_on is not null and c.next_visit_on > c.ends_on then 'ended' else status end
     where id = c.id;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Projects: invoice milestones and hours
-- ---------------------------------------------------------------------
create or replace function public.invoice_project(p_project uuid, p_milestones uuid[], p_hours_until date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  p public.projects;
  co public.companies;
  cl public.clients;
  v_id uuid;
  n integer := 0;
  m record;
  l record;
begin
  select * into p from public.projects where id = p_project for update;
  if p.id is null or not public.has_role(p.company_id, array['management', 'finance']::public.app_role[]) then
    raise exception 'Only management and finance can invoice projects.' using errcode = '42501';
  end if;
  select * into co from public.companies where id = p.company_id;
  select * into cl from public.clients where id = p.client_id;

  insert into public.invoices (company_id, client_id, currency, exchange_rate, payment_terms, vat_rate, terms, notes, created_by)
  values (p.company_id, p.client_id, p.currency, 1, cl.payment_terms, co.vat_rate, co.invoice_terms, p.number || ' · ' || p.name, auth.uid())
  returning id into v_id;

  for m in select * from public.project_milestones
            where project_id = p_project and id = any (coalesce(p_milestones, '{}')) and status <> 'invoiced'
            order by sort, due_on nulls last loop
    if m.amount is null or m.amount <= 0 then
      raise exception 'Milestone "%" has no amount.', m.title using errcode = '22023';
    end if;
    n := n + 1;
    insert into public.invoice_lines (company_id, invoice_id, line_no, description, quantity, unit, unit_price, is_service)
    values (p.company_id, v_id, n, p.name || ': ' || m.title, 1, 'milestone', m.amount, true);
    update public.project_milestones set status = 'invoiced', invoice_id = v_id where id = m.id;
  end loop;

  if p_hours_until is not null then
    for l in select t.rate, sum(t.hours) as hours, coalesce(nullif(btrim(pr.full_name), ''), pr.email, 'Team') as who
               from public.timesheets t left join public.profiles pr on pr.id = t.user_id
              where t.project_id = p_project and t.billable and t.invoice_id is null and t.work_date <= p_hours_until
                and coalesce(t.rate, 0) > 0
              group by t.rate, t.user_id, pr.full_name, pr.email
              order by who loop
      n := n + 1;
      insert into public.invoice_lines (company_id, invoice_id, line_no, description, quantity, unit, unit_price, is_service)
      values (p.company_id, v_id, n, p.name || ': ' || l.who || ' (to ' || to_char(p_hours_until, 'DD Mon YYYY') || ')',
              l.hours, 'hour', l.rate, true);
    end loop;
    update public.timesheets set invoice_id = v_id
     where project_id = p_project and billable and invoice_id is null and work_date <= p_hours_until and coalesce(rate, 0) > 0;
  end if;

  if n = 0 then
    raise exception 'Nothing to invoice: choose a milestone with an amount, or hours with a rate.' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Deliveries carry goods only
-- ---------------------------------------------------------------------
create or replace function public.create_delivery(p_company uuid, p_client uuid, p_quotation uuid, p_warehouse uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  q public.quotations;
  cl public.clients;
  v_wh uuid := p_warehouse;
begin
  if not public.has_role(p_company, array['management', 'sales', 'warehouse']::public.app_role[]) then
    raise exception 'You cannot create delivery notes.' using errcode = '42501';
  end if;
  if p_quotation is not null then
    select * into q from public.quotations where id = p_quotation and company_id = p_company;
    if q.id is null then raise exception 'Quotation not found.' using errcode = '22023'; end if;
    if q.status <> 'accepted' then raise exception 'Only accepted quotations can be delivered.' using errcode = '22023'; end if;
    p_client := q.client_id;
  end if;
  select * into cl from public.clients where id = p_client and company_id = p_company;
  if cl.id is null then raise exception 'Client not found.' using errcode = '22023'; end if;
  if v_wh is null then
    select id into v_wh from public.warehouses where company_id = p_company and active order by (code = 'MAIN') desc, created_at limit 1;
  end if;

  insert into public.deliveries (company_id, client_id, quotation_id, warehouse_id, delivery_site, contact_name, created_by)
  values (p_company, p_client, p_quotation, v_wh, cl.delivery_sites, q.contact_name, auth.uid())
  returning id into v_id;

  if p_quotation is not null then
    -- Services (installation, labour, consultancy) are done, not delivered: they stay off the delivery note.
    insert into public.delivery_lines (company_id, delivery_id, line_no, product_id, quotation_line_id, description, quantity, unit)
    select p_company, v_id, ql.line_no, ql.product_id, ql.id, ql.description,
           ql.quantity - coalesce((select sum(dl.quantity) from public.delivery_lines dl
                                   join public.deliveries d on d.id = dl.delivery_id
                                  where dl.quotation_line_id = ql.id and d.status not in ('failed', 'cancelled')
                                    and d.id <> v_id), 0),
           ql.unit
      from public.quotation_lines ql
     where ql.quotation_id = p_quotation
       and not ql.is_service
       and ql.quantity - coalesce((select sum(dl.quantity) from public.delivery_lines dl
                                   join public.deliveries d on d.id = dl.delivery_id
                                  where dl.quotation_line_id = ql.id and d.status not in ('failed', 'cancelled')
                                    and d.id <> v_id), 0) > 0
     order by ql.line_no;
  end if;
  return v_id;
end;
$$;

create or replace function public.dispatch_delivery(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  d public.deliveries;
  l record;
  b record;
  v_need numeric;
  v_take numeric;
  v_have numeric;
begin
  select * into d from public.deliveries where id = p_id for update;
  if d.id is null or not public.has_role(d.company_id, array['management', 'warehouse']::public.app_role[]) then
    raise exception 'Only management and warehouse can dispatch.' using errcode = '42501';
  end if;
  if d.status <> 'draft' then raise exception 'This delivery note has already been dispatched.' using errcode = '22023'; end if;
  if not exists (select 1 from public.delivery_lines where delivery_id = p_id) then
    raise exception 'Add at least one item before dispatching.' using errcode = '22023';
  end if;

  -- Only goods leave the store (a service added by hand is ignored here).
  for l in select dl.*, p.name as product_name from public.delivery_lines dl
           join public.products p on p.id = dl.product_id
           where dl.delivery_id = p_id and p.item_type = 'goods' order by dl.line_no loop
    select coalesce(sum(quantity), 0) into v_have from public.stock_movements
     where product_id = l.product_id and warehouse_id = d.warehouse_id;
    if v_have < l.quantity then
      raise exception 'Not enough stock of % in this store: need %, have %.', l.product_name, trim_scale(l.quantity), trim_scale(v_have)
        using errcode = '22023';
    end if;
    v_need := l.quantity;
    for b in select batch_no, expiry_date, sum(quantity) as qty from public.stock_movements
              where product_id = l.product_id and warehouse_id = d.warehouse_id
              group by batch_no, expiry_date having sum(quantity) > 0
              order by expiry_date nulls last, batch_no loop
      exit when v_need <= 0;
      v_take := least(v_need, b.qty);
      insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, expiry_date, delivery_id)
      values (d.company_id, l.product_id, d.warehouse_id, -v_take, 'dispatch', b.batch_no, b.expiry_date, p_id);
      v_need := v_need - v_take;
    end loop;
  end loop;

  perform set_config('ims.status_change', 'on', true);
  update public.deliveries set status = 'dispatched', dispatched_at = now() where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Lines already saved: mark the services.
update public.quotation_lines ql set is_service = true
  from public.products p where p.id = ql.product_id and p.item_type <> 'goods' and not ql.is_service;
update public.invoice_lines il set is_service = true
  from public.products p where p.id = il.product_id and p.item_type <> 'goods' and not il.is_service;

-- Job sign-off pictures live in the private "pod" bucket under <company>/jobs/.
drop policy if exists pod_jobs_insert on storage.objects;
create policy pod_jobs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pod' and (storage.foldername(name))[2] = 'jobs'
              and public.is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists pod_jobs_select on storage.objects;
create policy pod_jobs_select on storage.objects for select to authenticated
  using (bucket_id = 'pod' and (storage.foldername(name))[2] = 'jobs'
         and public.is_member(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.mark_service_line(),
  public.set_business_type(uuid, text),
  public.prepare_service_record(),
  public.check_job_people(),
  public.prepare_timesheet(),
  public.service_roles(),
  public.on_job(uuid),
  public.guard_timesheet_rates(),
  public.can_work_job(uuid),
  public.job_open(uuid),
  public.update_job_progress(uuid, jsonb, text),
  public.set_job_status(uuid, text, text),
  public.complete_service_job(uuid, text, text, text),
  public.invoice_service_job(uuid),
  public.create_due_service_visits(uuid),
  public.invoice_project(uuid, uuid[], date)
from public, anon;
grant execute on function
  public.set_business_type(uuid, text),
  public.service_roles(),
  public.on_job(uuid),
  public.can_work_job(uuid),
  public.job_open(uuid),
  public.update_job_progress(uuid, jsonb, text),
  public.set_job_status(uuid, text, text),
  public.complete_service_job(uuid, text, text, text),
  public.invoice_service_job(uuid),
  public.create_due_service_visits(uuid),
  public.invoice_project(uuid, uuid[], date)
to authenticated;

-- ---------------------------------------------------------------------
-- 10. Hire (rental of equipment you own)
-- ---------------------------------------------------------------------
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('hire_rentals', 'Equipment hire',
 'Hire out equipment you own (scaffolding, generators, pumps, tents, machines): what is out, with whom, when it is due back, and invoices per day, week or month.',
 'Services', 'medium', 'live', 'Companies that rent out equipment as well as, or instead of, selling it.',
 'Nothing goes missing, late returns are seen at once and every day on hire is billed.',
 '[{"title": "Mark hire items", "body": "Open Products, choose the item and set Type to Hire. Receive the units you own into a store so LeMoSp knows how many you have."},
   {"title": "Hire out", "body": "Open Hire, press New hire: client, site, the date out, the date due back, and the items with the rate per day, week or month."},
   {"title": "Return and invoice", "body": "When the items come back, record the return. Make invoice bills the time on hire; long hires can be invoiced every month while still out."}]'::jsonb,
 '/hire', 470)
on conflict (key) do nothing;

create table if not exists public.hire_agreements (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  number           text not null default '',
  client_id        uuid not null,
  site             text check (site is null or char_length(site) <= 300),
  contact          text check (contact is null or char_length(contact) <= 200),
  out_on           date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  due_back_on      date,
  returned_on      date,
  rate_period      text not null default 'day' check (rate_period in ('day', 'week', 'month')),
  deposit          numeric(18, 2) check (deposit is null or deposit >= 0),
  currency         text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  status           text not null default 'out' check (status in ('out', 'returned', 'invoiced', 'cancelled')),
  invoiced_until   date,                                                    -- time on hire billed up to this day
  return_note      text check (return_note is null or char_length(return_note) <= 1000),
  notes            text check (notes is null or char_length(notes) <= 2000),
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id)
);
create index if not exists hire_agreements_company_idx on public.hire_agreements (company_id, status, due_back_on);

create table if not exists public.hire_lines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  agreement_id  uuid not null,
  product_id    uuid not null,
  description   text not null check (char_length(btrim(description)) between 1 and 300),
  quantity      numeric(18, 3) not null check (quantity > 0),
  rate          numeric(18, 2) not null default 0 check (rate >= 0),       -- per rate_period, per unit
  created_at    timestamptz not null default now(),
  foreign key (agreement_id, company_id) references public.hire_agreements (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id)
);
create index if not exists hire_lines_agreement_idx on public.hire_lines (agreement_id);
create index if not exists hire_lines_product_idx on public.hire_lines (company_id, product_id);

-- Units of a hire item: owned (in stock) and out on hire now.
create or replace function public.hire_available(p_company uuid, p_product uuid)
returns table (owned numeric, on_hire numeric, tracked boolean)
language sql stable security definer set search_path = ''
as $$
  select coalesce((select sum(m.quantity) from public.stock_movements m where m.company_id = p_company and m.product_id = p_product), 0),
         coalesce((select sum(l.quantity) from public.hire_lines l join public.hire_agreements a on a.id = l.agreement_id
                    where l.company_id = p_company and l.product_id = p_product and a.status = 'out'), 0),
         exists (select 1 from public.stock_movements m where m.company_id = p_company and m.product_id = p_product)
   where public.is_member(p_company);
$$;

create or replace function public.prepare_hire()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.number, '') = '' then
      new.number := public.next_code(new.company_id, 'hire_agreements', 'HIRE-', 4);
    end if;
    if coalesce(current_setting('ims.status_change', true), '') <> 'on' then
      new.status := 'out';
      new.returned_on := null;
      new.invoiced_until := null;
    end if;
  end if;
  if new.due_back_on is not null and new.due_back_on < new.out_on then
    raise exception 'The return date must be on or after the date out.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('ims.status_change', true), '') <> 'on' then
    if (new.status, new.returned_on, new.invoiced_until) is distinct from (old.status, old.returned_on, old.invoiced_until) then
      raise exception 'Use the buttons on the hire to return or invoice it.' using errcode = '42501';
    end if;
    if old.status <> 'out' and (new.client_id, new.out_on, new.rate_period, new.currency)
                              is distinct from (old.client_id, old.out_on, old.rate_period, old.currency) then
      raise exception 'This hire is closed.' using errcode = '22023';
    end if;
    if old.invoiced_until is not null and (new.out_on, new.rate_period) is distinct from (old.out_on, old.rate_period) then
      raise exception 'Part of this hire is invoiced: the date out and the rate period stay as they are.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists hire_agreements_prepare on public.hire_agreements;
create trigger hire_agreements_prepare before insert or update on public.hire_agreements
  for each row execute function public.prepare_hire();

-- Hire lines: only hire items, only while the hire is out and not invoiced, and not more than is free.
create or replace function public.prepare_hire_line()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  a public.hire_agreements;
  v record;
  v_type text;
begin
  select * into a from public.hire_agreements where id = coalesce(new.agreement_id, old.agreement_id);
  if coalesce(current_setting('ims.status_change', true), '') <> 'on'
     and (a.status <> 'out' or a.invoiced_until is not null) then
    raise exception 'Items can only be changed on a hire that is out and not invoiced yet.' using errcode = '22023';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  select item_type into v_type from public.products where id = new.product_id and company_id = new.company_id;
  if v_type is distinct from 'hire' then
    raise exception 'Only items of type Hire can go out on hire. Change the item''s type in Products.' using errcode = '22023';
  end if;
  select * into v from public.hire_available(new.company_id, new.product_id);
  if v.tracked and v.on_hire - (case when tg_op = 'UPDATE' then old.quantity else 0 end) + new.quantity > v.owned then
    raise exception 'Only % of this item are free to hire (% owned, % out).',
      trim_scale(greatest(v.owned - v.on_hire + (case when tg_op = 'UPDATE' then old.quantity else 0 end), 0)),
      trim_scale(v.owned), trim_scale(v.on_hire) using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists hire_lines_prepare on public.hire_lines;
create trigger hire_lines_prepare before insert or update or delete on public.hire_lines
  for each row execute function public.prepare_hire_line();

do $$
declare
  t text;
begin
  execute 'drop trigger if exists hire_agreements_touch on public.hire_agreements';
  execute 'create trigger hire_agreements_touch before update on public.hire_agreements for each row execute function public.touch_updated_at()';
  foreach t in array array['hire_agreements', 'hire_lines'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Hire: service roles and finance see it; service roles keep it.
drop policy if exists hire_agreements_select on public.hire_agreements;
create policy hire_agreements_select on public.hire_agreements for select to authenticated
  using (public.has_role(company_id, public.service_roles()) or public.has_role(company_id, array['finance']::public.app_role[]));
drop policy if exists hire_agreements_insert on public.hire_agreements;
create policy hire_agreements_insert on public.hire_agreements for insert to authenticated
  with check (public.has_role(company_id, public.service_roles()));
drop policy if exists hire_agreements_update on public.hire_agreements;
create policy hire_agreements_update on public.hire_agreements for update to authenticated
  using (public.has_role(company_id, public.service_roles())) with check (public.has_role(company_id, public.service_roles()));
grant insert (company_id, client_id, site, contact, out_on, due_back_on, rate_period, deposit, currency, notes)
  on public.hire_agreements to authenticated;
grant update (site, contact, out_on, due_back_on, rate_period, deposit, currency, notes) on public.hire_agreements to authenticated;

drop policy if exists hire_lines_select on public.hire_lines;
create policy hire_lines_select on public.hire_lines for select to authenticated
  using (public.has_role(company_id, public.service_roles()) or public.has_role(company_id, array['finance']::public.app_role[]));
drop policy if exists hire_lines_insert on public.hire_lines;
create policy hire_lines_insert on public.hire_lines for insert to authenticated
  with check (public.has_role(company_id, public.service_roles()));
drop policy if exists hire_lines_delete on public.hire_lines;
create policy hire_lines_delete on public.hire_lines for delete to authenticated
  using (public.has_role(company_id, public.service_roles()));
grant insert (company_id, agreement_id, product_id, description, quantity, rate) on public.hire_lines to authenticated;
grant delete on public.hire_lines to authenticated;

-- How many rate periods a stretch of days counts as (any part of a period is a full period).
create or replace function public.hire_periods(p_from date, p_to date, p_period text)
returns integer language sql immutable set search_path = ''
as $$
  select greatest(ceil((p_to - p_from + 1)::numeric / case p_period when 'week' then 7 when 'month' then 30 else 1 end)::integer, 0);
$$;

-- The items came back.
create or replace function public.return_hire(p_id uuid, p_returned_on date, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.hire_agreements;
  v_day date := coalesce(p_returned_on, (now() at time zone 'Africa/Dar_es_Salaam')::date);
begin
  select * into a from public.hire_agreements where id = p_id for update;
  if a.id is null or not public.has_role(a.company_id, public.service_roles()) then
    raise exception 'Hire not found.' using errcode = '42501';
  end if;
  if a.status <> 'out' then raise exception 'This hire is not out.' using errcode = '22023'; end if;
  if v_day < a.out_on then raise exception 'The return date cannot be before the date out.' using errcode = '22023'; end if;
  if v_day > (now() at time zone 'Africa/Dar_es_Salaam')::date then
    raise exception 'The return date cannot be in the future.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.hire_agreements
     set status = case when invoiced_until is not null and invoiced_until >= v_day then 'invoiced' else 'returned' end,
         returned_on = v_day, return_note = left(nullif(btrim(coalesce(p_note, '')), ''), 1000)
   where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Cancel a hire entered by mistake (nothing invoiced yet).
create or replace function public.cancel_hire(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.hire_agreements;
begin
  select * into a from public.hire_agreements where id = p_id for update;
  if a.id is null or not public.has_role(a.company_id, public.service_roles()) then
    raise exception 'Hire not found.' using errcode = '42501';
  end if;
  if a.status <> 'out' or a.invoiced_until is not null then
    raise exception 'Only a hire that is out and not invoiced can be cancelled.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.hire_agreements set status = 'cancelled' where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Finance: a draft invoice for the time on hire not billed yet (to the return date, or to p_until while
-- the items are still out).
create or replace function public.invoice_hire(p_id uuid, p_until date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  a public.hire_agreements;
  co public.companies;
  cl public.clients;
  v_id uuid;
  v_from date;
  v_to date;
  v_periods integer;
  n integer := 0;
  l record;
  v_unit text;
begin
  select * into a from public.hire_agreements where id = p_id for update;
  if a.id is null or not public.has_role(a.company_id, array['management', 'finance']::public.app_role[]) then
    raise exception 'Only management and finance can invoice hires.' using errcode = '42501';
  end if;
  if a.status not in ('out', 'returned') then
    raise exception 'This hire has nothing left to invoice.' using errcode = '22023';
  end if;
  v_from := coalesce(a.invoiced_until + 1, a.out_on);
  v_to := case when a.status = 'returned' then a.returned_on
               else least(coalesce(p_until, (now() at time zone 'Africa/Dar_es_Salaam')::date),
                          (now() at time zone 'Africa/Dar_es_Salaam')::date) end;
  if v_to < v_from then
    raise exception 'The time up to that day is already invoiced.' using errcode = '22023';
  end if;
  v_periods := public.hire_periods(v_from, v_to, a.rate_period);
  v_unit := a.rate_period;
  select * into co from public.companies where id = a.company_id;
  select * into cl from public.clients where id = a.client_id;

  insert into public.invoices (company_id, client_id, currency, exchange_rate, payment_terms, vat_rate, terms, notes, created_by)
  values (a.company_id, a.client_id, a.currency, 1, cl.payment_terms, co.vat_rate, co.invoice_terms,
          a.number || ' · hire ' || to_char(v_from, 'DD Mon YYYY') || ' to ' || to_char(v_to, 'DD Mon YYYY') || coalesce(' · ' || a.site, ''),
          auth.uid())
  returning id into v_id;

  for l in select * from public.hire_lines where agreement_id = p_id and rate > 0 order by created_at loop
    n := n + 1;
    insert into public.invoice_lines (company_id, invoice_id, line_no, product_id, description, quantity, unit, unit_price, is_service)
    values (a.company_id, v_id, n, l.product_id,
            l.description || ' × ' || trim_scale(l.quantity) || ' (' || to_char(v_from, 'DD Mon') || ' to ' || to_char(v_to, 'DD Mon YYYY') || ')',
            l.quantity * v_periods, v_unit, l.rate, true);
  end loop;
  if n = 0 then
    raise exception 'Nothing to invoice: give the items a hire rate.' using errcode = '22023';
  end if;

  perform set_config('ims.status_change', 'on', true);
  update public.hire_agreements
     set invoiced_until = v_to,
         status = case when status = 'returned' then 'invoiced' else status end
   where id = p_id;
  perform set_config('ims.status_change', 'off', true);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Direct supply (the supplier delivers straight to your client)
-- ---------------------------------------------------------------------
alter table public.purchase_orders add column if not exists direct_to_client boolean not null default false;
grant insert (direct_to_client), update (direct_to_client) on public.purchase_orders to authenticated;

-- Record that the supplier delivered to the client: the order is received, the client's delivery note
-- (for the quotation) is created as delivered, and nothing enters or leaves your stock.
create or replace function public.record_direct_supply(p_po uuid, p_delivered_on date, p_received_by text, p_note text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  po public.purchase_orders;
  q public.quotations;
  cl public.clients;
  v_wh uuid;
  v_id uuid;
  v_day date := coalesce(p_delivered_on, (now() at time zone 'Africa/Dar_es_Salaam')::date);
  l record;
  n integer := 0;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if po.id is null or not public.has_role(po.company_id, array['management', 'procurement', 'warehouse', 'sales']::public.app_role[]) then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;
  if not po.direct_to_client then
    raise exception 'This order is not marked for direct delivery to the client.' using errcode = '22023';
  end if;
  if po.status not in ('approved', 'sent', 'confirmed', 'partially_received') then
    raise exception 'Only an approved purchase order can be recorded as delivered.' using errcode = '22023';
  end if;
  if po.quotation_id is null then
    raise exception 'Link the order to the client''s quotation first: that is how LeMoSp knows the client.' using errcode = '22023';
  end if;
  if v_day > (now() at time zone 'Africa/Dar_es_Salaam')::date then
    raise exception 'The delivery date cannot be in the future.' using errcode = '22023';
  end if;
  select * into q from public.quotations where id = po.quotation_id;
  select * into cl from public.clients where id = q.client_id;
  select id into v_wh from public.warehouses where company_id = po.company_id and active order by (code = 'MAIN') desc, created_at limit 1;
  if v_wh is null then
    raise exception 'Add a store first.' using errcode = '22023';
  end if;

  perform set_config('ims.status_change', 'on', true);
  insert into public.deliveries (company_id, client_id, quotation_id, warehouse_id, delivery_site, contact_name, planned_date,
                                 status, dispatched_at, delivered_at, received_by_name, pod_notes, pod_recorded_by, notes, created_by)
  values (po.company_id, q.client_id, q.id, v_wh, coalesce(po.delivery_location, cl.delivery_sites), q.contact_name, v_day,
          'delivered', (v_day + time '08:00') at time zone 'Africa/Dar_es_Salaam', (v_day + time '12:00') at time zone 'Africa/Dar_es_Salaam',
          left(nullif(btrim(coalesce(p_received_by, '')), ''), 120), left(nullif(btrim(coalesce(p_note, '')), ''), 1000), auth.uid(),
          'Delivered direct by the supplier on ' || po.number, auth.uid())
  returning id into v_id;

  for l in select pl.*,
                  (select ql.id from public.quotation_lines ql
                    where ql.quotation_id = q.id and ql.product_id is not distinct from pl.product_id and not ql.is_service
                    order by ql.line_no limit 1) as ql_id
             from public.po_lines pl where pl.po_id = p_po and pl.received_qty < pl.quantity order by pl.line_no loop
    n := n + 1;
    insert into public.delivery_lines (company_id, delivery_id, line_no, product_id, quotation_line_id, description, quantity, unit)
    values (po.company_id, v_id, n, l.product_id, l.ql_id, l.description, l.quantity - l.received_qty, l.unit);
    update public.po_lines set received_qty = quantity where id = l.id;
  end loop;
  if n = 0 then
    raise exception 'Everything on this order has already arrived.' using errcode = '22023';
  end if;
  update public.purchase_orders set status = 'received' where id = p_po;
  perform set_config('ims.status_change', 'off', true);

  perform public.notify_roles(po.company_id, array['management', 'finance', 'sales']::public.app_role[], auth.uid(), 'delivery', 'info',
    'Delivered direct: ' || po.number || ' to ' || cl.name, 'Ready to invoice the client.', '/deliveries/' || v_id, 'direct-' || p_po::text);
  return v_id;
end;
$$;

-- A purchase order made from a quotation takes its goods only (services are done by your own team).
create or replace function public.create_purchase_order(p_company uuid, p_supplier uuid, p_quotation uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  sup public.suppliers;
  c public.companies;
  v_po uuid;
begin
  if not public.has_role(p_company, array['management', 'procurement']::public.app_role[]) then
    raise exception 'Only management and procurement can create purchase orders.' using errcode = '42501';
  end if;
  select * into sup from public.suppliers where id = p_supplier and company_id = p_company;
  if sup.id is null then raise exception 'Supplier not found.' using errcode = '22023'; end if;
  select * into c from public.companies where id = p_company;

  insert into public.purchase_orders (company_id, supplier_id, quotation_id, currency, exchange_rate, payment_terms,
         incoterms, vat_rate, terms, expected_date, created_by)
  values (p_company, p_supplier, p_quotation, sup.currency, 1, sup.payment_terms, sup.incoterms,
         case when coalesce(lower(sup.country), 'tanzania') in ('tanzania', 'tz') then c.vat_rate else 0 end,
         c.po_terms,
         case when sup.lead_time_days is not null then (now() at time zone 'Africa/Dar_es_Salaam')::date + sup.lead_time_days end,
         auth.uid())
  returning id into v_po;

  if p_quotation is not null then
    insert into public.po_lines (company_id, po_id, line_no, product_id, description, quantity, unit, unit_price)
    select p_company, v_po, l.line_no, l.product_id, l.description, l.quantity, l.unit, coalesce(pc.last_cost, 0)
      from public.quotation_lines l
      left join public.product_costs pc on pc.product_id = l.product_id
     where l.quotation_id = p_quotation and l.company_id = p_company and not l.is_service
     order by l.line_no;
  end if;
  return v_po;
end;
$$;

-- Clearing test transactions also clears jobs, hours and hires (projects, contracts and equipment are kept).
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
  delete from public.audit_log
   where company_id = p_company
     and entity in ('rfqs', 'rfq_lines', 'quotations', 'quotation_lines', 'supplier_rfqs', 'supplier_rfq_suppliers',
                    'purchase_orders', 'po_lines', 'goods_receipts', 'deliveries', 'delivery_lines', 'invoices',
                    'invoice_lines', 'payments', 'supplier_bills', 'supplier_payments', 'order_costs', 'expenses',
                    'followups', 'opportunities', 'crm_activities', 'tenders', 'tender_tasks',
                    'stock_transfers', 'stock_transfer_lines', 'requisitions', 'requisition_lines',
                    'vehicle_logs', 'cash_positions', 'service_jobs', 'service_job_lines', 'timesheets',
                    'hire_agreements', 'hire_lines');
  delete from public.code_counters
   where company_id = p_company
     and (kind ~ '^(rfqs|quotations|supplier_rfqs|purchase_orders|goods_receipts|deliveries|invoices|payments|supplier_bills|supplier_payments|expenses|opportunities|tenders|stock_transfers|requisitions)-' or kind in ('service_jobs', 'hire_agreements'));
  update public.companies set alerts_checked_at = null where id = p_company;

  perform set_config('ims.status_change', 'off', true);
  perform set_config('ims.allow_line_copy', 'off', true);
  return 'Test transactions cleared for ' || v_name || '. Master data, contracts, documents, vehicles, budgets, team and settings were kept.';
end;
$$;

-- ---------------------------------------------------------------------
-- 12. Price book: playbooks and packs for the three kinds of business
-- ---------------------------------------------------------------------
insert into public.price_items (key, category, name, description, unit, price_tzs, price_usd, level, included_users,
                                feature_keys, playbook_id, requestable, public, sort) values
  ('playbook_goods_business', 'playbook', 'Playbook: Run a goods business', 'Registering and setting up a trading company, buying, stock, pricing, delivering, direct supply and getting paid.', 'once', 30000, 12, null, null, '{}', 'goods-business', true, true, 12),
  ('playbook_services_business', 'playbook', 'Playbook: Run a service business', 'Registering a service company, withholding tax, service jobs, maintenance contracts, projects, timesheets and hire.', 'once', 30000, 12, null, null, '{}', 'services-business', true, true, 14),
  ('playbook_goods_and_services', 'playbook', 'Playbook: Sell goods and services together', 'One quotation for the pipes and the installation, jobs with materials from stock, maintenance afterwards and consultation.', 'once', 30000, 12, null, null, '{}', 'goods-and-services', true, true, 16),
  ('addon_field_service', 'addon', 'Field service pack', 'Service jobs, maintenance contracts, installed equipment register and service reports.', 'month', 40000, 16, null, null, '{service_jobs,maintenance_contracts,equipment_register,service_reports}', null, true, true, 60),
  ('addon_projects', 'addon', 'Projects & timesheets pack', 'Consulting and project work with milestones, hours, rates and invoicing by time.', 'month', 40000, 16, null, null, '{projects,timesheets}', null, true, true, 70),
  ('addon_hire', 'addon', 'Equipment hire', 'Hire out equipment you own: what is out, due back, and invoices per day, week or month.', 'month', 20000, 8, null, null, '{hire_rentals}', null, true, true, 80)
on conflict (key) do nothing;

revoke execute on function
  public.hire_available(uuid, uuid),
  public.prepare_hire(),
  public.prepare_hire_line(),
  public.hire_periods(date, date, text),
  public.return_hire(uuid, date, text),
  public.cancel_hire(uuid),
  public.invoice_hire(uuid, date),
  public.record_direct_supply(uuid, date, text, text)
from public, anon;
grant execute on function
  public.hire_available(uuid, uuid),
  public.hire_periods(date, date, text),
  public.return_hire(uuid, date, text),
  public.cancel_hire(uuid),
  public.invoice_hire(uuid, date),
  public.record_direct_supply(uuid, date, text, text)
to authenticated;
