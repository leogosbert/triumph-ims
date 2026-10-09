-- =====================================================================
-- LeMoSp · Stage 15 part 1: enterprise planning and fleet
--
--   Budgets          monthly budgets for sales, gross profit, expenses (in
--                    total or by category) and net profit, set a year at a
--                    time with set_budget(); the app compares them with the
--                    actual figures from the profit & loss.
--   Cash-flow        cash_positions (cash and bank on a date) and
--   forecast         cashflow_forecast(): money expected in (unpaid invoices,
--                    by the promised or due date) and out (supplier bills,
--                    purchase orders not billed yet, usual monthly expenses),
--                    week by week.
--   Purchase         demand_plan(): what sells each day, how many days the
--   planning         stock lasts, when to reorder given the supplier's lead
--                    time, and how much to order.
--   Fleet            vehicles with insurance, inspection and service dates,
--                    and a log of fuel, services and repairs; reminders
--                    before the dates.
--
-- Run after the two Stage 14 files. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Budgets
-- ---------------------------------------------------------------------
create table if not exists public.budgets (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  year         integer not null check (year between 2000 and 2100),
  month        integer not null check (month between 1 and 12),
  measure      text not null check (measure in ('sales', 'gross_profit', 'expenses', 'net_profit', 'expense_category')),
  category_id  uuid,
  amount       numeric(18, 2) not null check (amount >= 0),
  updated_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check ((measure = 'expense_category') = (category_id is not null)),
  foreign key (category_id, company_id) references public.expense_categories (id, company_id) on delete cascade
);
create unique index if not exists budgets_key on public.budgets
  (company_id, year, month, measure, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid));

create or replace function public.finance_roles()
returns public.app_role[] language sql immutable set search_path = ''
as $$ select array['management', 'finance']::public.app_role[]; $$;

-- Set one budget line for a whole year: twelve monthly amounts (null = no budget that month).
create or replace function public.set_budget(p_company uuid, p_year int, p_measure text, p_category uuid, p_amounts numeric[])
returns void language plpgsql security definer set search_path = ''
as $$
declare
  i int;
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management and finance can set budgets.' using errcode = '42501';
  end if;
  if p_measure not in ('sales', 'gross_profit', 'expenses', 'net_profit', 'expense_category') then
    raise exception 'Unknown budget line.' using errcode = '22023';
  end if;
  if (p_measure = 'expense_category') <> (p_category is not null) then
    raise exception 'Choose the expense category.' using errcode = '22023';
  end if;
  if p_category is not null and not exists (select 1 from public.expense_categories where id = p_category and company_id = p_company) then
    raise exception 'Expense category not found.' using errcode = '22023';
  end if;
  if p_year is null or p_year not between 2000 and 2100 then raise exception 'Choose the year.' using errcode = '22023'; end if;
  if coalesce(array_length(p_amounts, 1), 0) <> 12 then raise exception 'Enter twelve months.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(p_amounts) a where a < 0) then
    raise exception 'Budgets cannot be negative.' using errcode = '22023';
  end if;
  delete from public.budgets
   where company_id = p_company and year = p_year and measure = p_measure
     and category_id is not distinct from p_category;
  for i in 1..12 loop
    if p_amounts[i] is not null then
      insert into public.budgets (company_id, year, month, measure, category_id, amount, updated_by)
      values (p_company, p_year, i, p_measure, p_category, round(p_amounts[i], 2), auth.uid());
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Cash-flow forecast
-- ---------------------------------------------------------------------
create table if not exists public.cash_positions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  as_of       date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  amount      numeric(18, 2) not null,
  note        text check (note is null or char_length(note) <= 300),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists cash_positions_company_idx on public.cash_positions (company_id, as_of desc, created_at desc);

-- Week by week (weeks start on Monday), in the base currency.
create or replace function public.cashflow_forecast(p_company uuid, p_weeks int default 13)
returns table (week_start date, cash_in numeric, bills_out numeric, orders_out numeric, expenses_out numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_first date := date_trunc('week', (now() at time zone 'Africa/Dar_es_Salaam')::date)::date;
  v_weeks int := least(greatest(coalesce(p_weeks, 13), 1), 52);
  v_weekly_exp numeric;
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management and finance can see the cash-flow forecast.' using errcode = '42501';
  end if;
  -- The usual spending: the last three full months of expenses, per week.
  select coalesce(sum(e.amount * e.exchange_rate), 0) / 13.0 into v_weekly_exp
    from public.expenses e
   where e.company_id = p_company and e.voided_at is null
     and e.spent_on >= (date_trunc('month', v_today) - interval '3 months')::date
     and e.spent_on < date_trunc('month', v_today)::date;

  return query
  with weeks as (
    select (v_first + 7 * g)::date as ws from generate_series(0, v_weeks - 1) g
  ), inv as (
    select greatest(coalesce((select f.next_on from public.followups f
                                where f.invoice_id = i.id and f.next_on is not null
                                order by f.created_at desc limit 1),
                             i.due_date, i.issue_date + 30, v_today), v_today) as on_day,
           (i.total - i.amount_paid) * i.exchange_rate as amt
      from public.invoices i
     where i.company_id = p_company and i.status in ('issued', 'partly_paid') and i.total > i.amount_paid
  ), bills as (
    select greatest(coalesce(b.due_date, b.bill_date + 30), v_today) as on_day,
           (b.total - b.amount_paid) * b.exchange_rate as amt
      from public.supplier_bills b
     where b.company_id = p_company and b.status in ('open', 'partly_paid') and b.total > b.amount_paid
  ), orders as (
    select greatest(coalesce(o.expected_date, o.order_date + 14), v_today) as on_day,
           o.total * o.exchange_rate
             - coalesce((select sum(b.total * b.exchange_rate) from public.supplier_bills b
                          where b.po_id = o.id and b.status <> 'cancelled'), 0) as amt
      from public.purchase_orders o
     where o.company_id = p_company and o.status in ('approved', 'sent', 'confirmed', 'partially_received')
  )
  select w.ws,
         round(coalesce((select sum(x.amt) from inv x where x.on_day >= w.ws and x.on_day < w.ws + 7), 0), 2),
         round(coalesce((select sum(x.amt) from bills x where x.on_day >= w.ws and x.on_day < w.ws + 7), 0), 2),
         round(coalesce((select sum(greatest(x.amt, 0)) from orders x where x.on_day >= w.ws and x.on_day < w.ws + 7), 0), 2),
         round(case when w.ws = v_first then v_weekly_exp * (7 - (v_today - v_first)) / 7.0 else v_weekly_exp end, 2)
    from weeks w
   order by w.ws;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Purchase planning from sales history
-- ---------------------------------------------------------------------
-- For each product sold in the last p_days: daily sales, days of stock left, the reorder point
-- (sales during the supplier's lead time plus a week of safety stock) and the quantity to order
-- so that a month of sales is covered after the goods arrive.
create or replace function public.demand_plan(p_company uuid, p_days int default 90)
returns table (product_id uuid, sku text, name text, unit text, sold numeric, per_day numeric, on_hand numeric,
               on_order numeric, lead_days int, cover_days numeric, reorder_point numeric, order_qty numeric,
               supplier_id uuid, supplier_name text, reorder_level numeric, max_level numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_days int := least(greatest(coalesce(p_days, 90), 14), 365);
begin
  if not public.has_role(p_company, array['management', 'procurement', 'warehouse']::public.app_role[]) then
    raise exception 'Only management, procurement and warehouse can see purchase planning.' using errcode = '42501';
  end if;
  return query
  with sold as (
    select m.product_id, -sum(m.quantity) as qty
      from public.stock_movements m
     where m.company_id = p_company and m.kind = 'dispatch' and m.created_at >= now() - make_interval(days => v_days)
     group by m.product_id
    having -sum(m.quantity) > 0
  ), stock as (
    select m.product_id, sum(m.quantity) as qty from public.stock_movements m where m.company_id = p_company group by m.product_id
  ), ordered as (
    select l.product_id, sum(greatest(l.quantity - l.received_qty, 0)) as qty
      from public.po_lines l join public.purchase_orders o on o.id = l.po_id
     where o.company_id = p_company and o.status in ('draft', 'pending_approval', 'approved', 'sent', 'confirmed', 'partially_received')
       and l.product_id is not null
     group by l.product_id
  ), requested as (
    select rl.product_id, sum(rl.quantity) as qty
      from public.requisition_lines rl join public.requisitions r on r.id = rl.requisition_id
     where r.company_id = p_company and r.status in ('draft', 'submitted', 'approved') and rl.product_id is not null
     group by rl.product_id
  ), last_po as (
    select distinct on (l.product_id) l.product_id, o.supplier_id, s.name as supplier_name, s.lead_time_days
      from public.po_lines l
      join public.purchase_orders o on o.id = l.po_id
      join public.suppliers s on s.id = o.supplier_id
     where o.company_id = p_company and o.status not in ('cancelled', 'draft') and l.product_id is not null
     order by l.product_id, o.order_date desc, o.created_at desc
  ), base as (
    select p.id, p.sku, p.name, p.unit, so.qty as sold, so.qty / v_days as per_day,
           coalesce(st.qty, 0) as on_hand, coalesce(od.qty, 0) + coalesce(rq.qty, 0) as on_order,
           coalesce(lp.lead_time_days, 14) as lead_days, lp.supplier_id, lp.supplier_name, p.reorder_level, p.max_level
      from sold so
      join public.products p on p.id = so.product_id
      left join stock st on st.product_id = p.id
      left join ordered od on od.product_id = p.id
      left join requested rq on rq.product_id = p.id
      left join last_po lp on lp.product_id = p.id
     where p.company_id = p_company and p.active
  )
  select b.id, b.sku, b.name, b.unit, round(b.sold, 3), round(b.per_day, 3), b.on_hand, b.on_order, b.lead_days,
         case when b.per_day > 0 then round(b.on_hand / b.per_day, 1) end,
         ceil(b.per_day * (b.lead_days + 7)),
         greatest(ceil(b.per_day * (b.lead_days + 7 + 30)) - b.on_hand - b.on_order, 0),
         b.supplier_id, b.supplier_name, b.reorder_level, b.max_level
    from base b
   order by (b.on_hand + b.on_order) / nullif(b.per_day, 0) nulls last, b.name;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Fleet: vehicles and their log
-- ---------------------------------------------------------------------
create table if not exists public.vehicles (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  plate               text not null check (char_length(btrim(plate)) between 2 and 20),
  name                text check (name is null or char_length(name) <= 80),
  kind                text not null default 'truck' check (kind in ('truck', 'pickup', 'van', 'car', 'motorcycle', 'other')),
  capacity_kg         numeric(12, 1) check (capacity_kg is null or capacity_kg > 0),
  driver_id           uuid references auth.users (id) on delete set null,
  insurance_expires   date,
  inspection_expires  date,
  service_due_on      date,
  service_due_km      integer check (service_due_km is null or service_due_km >= 0),
  odometer_km         integer check (odometer_km is null or odometer_km >= 0),
  remind_days         integer not null default 14 check (remind_days between 1 and 90),
  active              boolean not null default true,
  notes               text check (notes is null or char_length(notes) <= 1000),
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, company_id)
);
create unique index if not exists vehicles_plate_key on public.vehicles (company_id, upper(regexp_replace(plate, '\s', '', 'g')));

create table if not exists public.vehicle_logs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  vehicle_id   uuid not null,
  kind         text not null check (kind in ('fuel', 'service', 'repair', 'tyres', 'insurance', 'inspection', 'odometer', 'other')),
  happened_on  date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  odometer_km  integer check (odometer_km is null or odometer_km >= 0),
  litres       numeric(10, 2) check (litres is null or litres > 0),
  amount       numeric(18, 2) check (amount is null or amount >= 0),
  note         text check (note is null or char_length(note) <= 500),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (vehicle_id, company_id) references public.vehicles (id, company_id) on delete cascade
);
create index if not exists vehicle_logs_vehicle_idx on public.vehicle_logs (vehicle_id, happened_on desc, created_at desc);

create or replace function public.fleet_roles()
returns public.app_role[] language sql immutable set search_path = ''
as $$ select array['management', 'warehouse', 'finance', 'driver']::public.app_role[]; $$;

create or replace function public.prepare_vehicle()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.plate := upper(btrim(regexp_replace(new.plate, '\s+', ' ', 'g')));
  new.name := nullif(btrim(new.name), '');
  new.notes := nullif(btrim(new.notes), '');
  if new.driver_id is not null and not exists (
       select 1 from public.memberships m where m.company_id = new.company_id and m.user_id = new.driver_id and m.active) then
    raise exception 'The driver must be someone in the team.' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- A log line keeps the vehicle's odometer up to date.
create or replace function public.prepare_vehicle_log()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.note := nullif(btrim(new.note), '');
  if new.happened_on > (now() at time zone 'Africa/Dar_es_Salaam')::date then
    raise exception 'The date cannot be in the future.' using errcode = '22023';
  end if;
  if new.kind = 'fuel' and new.litres is null and new.amount is null then
    raise exception 'Enter the litres or the amount paid.' using errcode = '22023';
  end if;
  if new.odometer_km is not null then
    update public.vehicles set odometer_km = new.odometer_km
     where id = new.vehicle_id and coalesce(odometer_km, 0) < new.odometer_km;
  end if;
  return new;
end;
$$;

drop trigger if exists vehicles_prepare on public.vehicles;
create trigger vehicles_prepare before insert or update on public.vehicles for each row execute function public.prepare_vehicle();
drop trigger if exists vehicle_logs_prepare on public.vehicle_logs;
create trigger vehicle_logs_prepare before insert on public.vehicle_logs for each row execute function public.prepare_vehicle_log();

-- ---------------------------------------------------------------------
-- 5. Triggers, row-level security and grants
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['budgets', 'vehicles'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['budgets', 'cash_positions', 'vehicles', 'vehicle_logs'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Budgets: read by management and finance; written only through set_budget().
drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets for select to authenticated
  using (public.has_role(company_id, public.finance_roles()));

-- Cash positions: management and finance record and read them.
drop policy if exists cash_positions_select on public.cash_positions;
create policy cash_positions_select on public.cash_positions for select to authenticated
  using (public.has_role(company_id, public.finance_roles()));
drop policy if exists cash_positions_insert on public.cash_positions;
create policy cash_positions_insert on public.cash_positions for insert to authenticated
  with check (public.has_role(company_id, public.finance_roles()));
drop policy if exists cash_positions_delete on public.cash_positions;
create policy cash_positions_delete on public.cash_positions for delete to authenticated
  using (public.has_role(company_id, public.finance_roles()));
grant insert (company_id, as_of, amount, note) on public.cash_positions to authenticated;
grant delete on public.cash_positions to authenticated;

-- Vehicles: seen by the fleet roles; kept by management and warehouse.
drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles for select to authenticated
  using (public.has_role(company_id, public.fleet_roles()));
drop policy if exists vehicles_insert on public.vehicles;
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (public.has_role(company_id, public.stock_roles()));
drop policy if exists vehicles_update on public.vehicles;
create policy vehicles_update on public.vehicles for update to authenticated
  using (public.has_role(company_id, public.stock_roles())) with check (public.has_role(company_id, public.stock_roles()));
grant insert (company_id, plate, name, kind, capacity_kg, driver_id, insurance_expires, inspection_expires, service_due_on,
              service_due_km, odometer_km, remind_days, notes)
  on public.vehicles to authenticated;
grant update (plate, name, kind, capacity_kg, driver_id, insurance_expires, inspection_expires, service_due_on,
              service_due_km, odometer_km, remind_days, active, notes)
  on public.vehicles to authenticated;

-- Vehicle log: drivers add fuel and kilometres too; the person who wrote a line (or management) removes it.
drop policy if exists vehicle_logs_select on public.vehicle_logs;
create policy vehicle_logs_select on public.vehicle_logs for select to authenticated
  using (public.has_role(company_id, public.fleet_roles()));
drop policy if exists vehicle_logs_insert on public.vehicle_logs;
create policy vehicle_logs_insert on public.vehicle_logs for insert to authenticated
  with check (public.has_role(company_id, array['management', 'warehouse', 'driver']::public.app_role[]));
drop policy if exists vehicle_logs_delete on public.vehicle_logs;
create policy vehicle_logs_delete on public.vehicle_logs for delete to authenticated
  using ((created_by = auth.uid() and public.has_role(company_id, array['management', 'warehouse', 'driver']::public.app_role[]))
         or public.is_manager(company_id));
grant insert (company_id, vehicle_id, kind, happened_on, odometer_km, litres, amount, note) on public.vehicle_logs to authenticated;
grant delete on public.vehicle_logs to authenticated;

-- ---------------------------------------------------------------------
-- 6. Time-based alerts (as in Stage 14, plus vehicle insurance,
--    inspection and service dates)
-- ---------------------------------------------------------------------
create or replace function public.run_company_alerts(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_before bigint;
  v_after bigint;
  r record;
  v_band int;
  v_sev text;
  v_week text := to_char(v_today, 'IYYY-IW');
  co public.companies;
  v_step int;
  v_days int;
begin
  select count(*) into v_before from public.notifications where company_id = p_company;
  select * into co from public.companies where id = p_company;

  -- Client RFQs due today or late, not yet quoted.
  for r in select f.id, f.number, f.due_on, coalesce(f.assigned_to, f.created_by) as who, c.name as client
             from public.rfqs f join public.clients c on c.id = f.client_id
            where f.company_id = p_company and f.status in ('new', 'quoting') and f.due_on <= v_today loop
    perform public.notify(p_company, r.who, 'rfq_due', case when r.due_on < v_today then 'critical' else 'attention' end,
      case when r.due_on < v_today then 'RFQ overdue: ' else 'RFQ due today: ' end || r.client,
      r.number || ' · due ' || to_char(r.due_on, 'DD Mon'), '/rfqs/' || r.id,
      'rfq-due-' || r.id || '-' || case when r.due_on < v_today then 'late' else 'today' end);
  end loop;

  -- Quotations with the client that expire within 2 days.
  for r in select q.id, q.number, q.revision, q.valid_until, q.created_by, c.name as client
             from public.quotations q join public.clients c on c.id = q.client_id
            where q.company_id = p_company and q.status in ('approved', 'sent')
              and q.valid_until between v_today and v_today + 2 loop
    perform public.notify(p_company, r.created_by, 'quote_expiring', 'attention', 'Quotation expiring: ' || r.client,
      r.number || case when r.revision > 0 then '-R' || r.revision else '' end || ' · valid until ' || to_char(r.valid_until, 'DD Mon')
        || ' · follow up with the client',
      '/quotations/' || r.id, 'qt-exp-' || r.id || '-' || r.valid_until);
  end loop;

  -- Quotations sent to the client without an answer: follow up every N days.
  if coalesce(co.quote_followup_days, 0) > 0 then
    for r in select q.id, q.number, q.revision, q.created_by, q.total, q.currency, c.name as client, x.due_on
               from public.quotations q
               join public.clients c on c.id = q.client_id
               left join lateral (select f.next_on, (f.created_at at time zone 'Africa/Dar_es_Salaam')::date as on_day
                                    from public.followups f where f.quotation_id = q.id
                                   order by f.created_at desc limit 1) fu on true
               cross join lateral (select coalesce(fu.next_on,
                                                   greatest((coalesce(q.sent_at, q.approved_at, q.created_at) at time zone 'Africa/Dar_es_Salaam')::date,
                                                            fu.on_day) + co.quote_followup_days) as due_on) x
              where q.company_id = p_company and q.status = 'sent'
                and x.due_on <= v_today
                and (q.valid_until is null or q.valid_until >= v_today) loop
      if public.is_active_member(p_company, r.created_by) then
        perform public.notify(p_company, r.created_by, 'quote_followup', 'attention', 'Follow up quotation: ' || r.client,
          r.number || case when r.revision > 0 then '-R' || r.revision else '' end || ' · ' || public.fmt_money(r.total, r.currency)
            || ' · no answer yet',
          '/quotations/' || r.id || '#follow-up', 'qt-fu-' || r.id || '-' || r.due_on);
      else
        perform public.notify_roles(p_company, array['management']::public.app_role[], null, 'quote_followup', 'attention',
          'Follow up quotation: ' || r.client,
          r.number || case when r.revision > 0 then '-R' || r.revision else '' end || ' · ' || public.fmt_money(r.total, r.currency)
            || ' · no answer yet',
          '/quotations/' || r.id || '#follow-up', 'qt-fu-' || r.id || '-' || r.due_on);
      end if;
    end loop;
  end if;

  -- Opportunities whose next step is due (owner; management when the owner has left).
  for r in select o.id, o.number, o.title, o.next_on, o.next_action, o.owner_id,
                  coalesce(c.name, o.prospect_name) as party
             from public.opportunities o left join public.clients c on c.id = o.client_id
            where o.company_id = p_company and o.stage not in ('won', 'lost') and o.next_on <= v_today loop
    if public.is_active_member(p_company, r.owner_id) then
      perform public.notify(p_company, r.owner_id, 'crm_followup',
        case when r.next_on < v_today - 7 then 'critical' else 'attention' end,
        'Follow up: ' || r.party, coalesce(r.next_action, r.title) || ' · ' || r.number || ' · planned ' || to_char(r.next_on, 'DD Mon'),
        '/crm/' || r.id, 'crm-fu-' || r.id || '-' || r.next_on);
    else
      perform public.notify_roles(p_company, array['management']::public.app_role[], null, 'crm_followup', 'attention',
        'Follow up: ' || r.party, coalesce(r.next_action, r.title) || ' · ' || r.number || ' · planned ' || to_char(r.next_on, 'DD Mon'),
        '/crm/' || r.id, 'crm-fu-' || r.id || '-' || r.next_on);
    end if;
  end loop;

  -- Tenders closing within 7 days, 2 days and today (still being prepared).
  for r in select t.id, t.number, t.title, t.closing_at, t.owner_id, coalesce(c.name, t.buyer_name) as buyer,
                  ((t.closing_at at time zone 'Africa/Dar_es_Salaam')::date - v_today) as days_left,
                  (select count(*) from public.tender_tasks k where k.tender_id = t.id and k.done_at is null) as open_tasks
             from public.tenders t left join public.clients c on c.id = t.client_id
            where t.company_id = p_company and t.status = 'preparing'
              and t.closing_at >= now() - interval '1 day'
              and (t.closing_at at time zone 'Africa/Dar_es_Salaam')::date <= v_today + 7 loop
    v_band := case when r.days_left <= 0 then 0 when r.days_left <= 2 then 2 else 7 end;
    perform public.notify(p_company, r.owner_id, 'tender_closing', case when v_band <= 2 then 'critical' else 'attention' end,
      case when v_band = 0 then 'Tender closes today: ' else 'Tender closing: ' end || r.buyer,
      r.title || ' · closes ' || to_char(r.closing_at at time zone 'Africa/Dar_es_Salaam', 'DD Mon HH24:MI')
        || case when r.open_tasks > 0 then ' · ' || r.open_tasks || ' steps left' else '' end,
      '/tenders/' || r.id, 'tnd-' || r.id || '-' || v_band);
    perform public.notify_roles(p_company, array['management']::public.app_role[], r.owner_id, 'tender_closing',
      case when v_band <= 2 then 'critical' else 'attention' end,
      case when v_band = 0 then 'Tender closes today: ' else 'Tender closing: ' end || r.buyer,
      r.title || ' · closes ' || to_char(r.closing_at at time zone 'Africa/Dar_es_Salaam', 'DD Mon HH24:MI')
        || case when r.open_tasks > 0 then ' · ' || r.open_tasks || ' steps left' else '' end,
      '/tenders/' || r.id, 'tnd-' || r.id || '-' || v_band);
  end loop;

  -- Contracts ending within their reminder period, and on the last day.
  for r in select k.id, k.number, k.title, k.end_date, k.remind_days, k.created_by, c.name as client
             from public.contracts k join public.clients c on c.id = k.client_id
            where k.company_id = p_company and k.cancelled_at is null
              and k.end_date between v_today and v_today + k.remind_days loop
    v_band := case when r.end_date = v_today then 0 when r.end_date <= v_today + 7 then 7 else r.remind_days end;
    perform public.notify_roles(p_company, array['management', 'sales']::public.app_role[], null, 'contract_ending',
      case when v_band <= 7 then 'critical' else 'attention' end,
      case when v_band = 0 then 'Contract ends today: ' else 'Contract ending: ' end || r.client,
      r.number || ' · ' || r.title || ' · ends ' || to_char(r.end_date, 'DD Mon YYYY') || ' · time to renew',
      '/contracts/' || r.id, 'ctr-' || r.id || '-' || r.end_date || '-' || v_band);
  end loop;

  -- Library documents expiring within their reminder period, and once expired.
  for r in select d.id, d.title, d.kind, d.expires_on, d.remind_days
             from public.documents d
            where d.company_id = p_company and d.archived_at is null and d.expires_on is not null
              and d.expires_on <= v_today + d.remind_days and d.expires_on >= v_today - 1 loop
    v_band := case when r.expires_on < v_today then -1 when r.expires_on <= v_today + 7 then 7 else r.remind_days end;
    perform public.notify_roles(p_company, array['management', 'procurement']::public.app_role[], null, 'document_expiry',
      case when v_band <= 7 then 'critical' else 'attention' end,
      case when v_band = -1 then 'Document expired: ' else 'Document expiring: ' end || r.title,
      'Expires ' || to_char(r.expires_on, 'DD Mon YYYY') || ' · renew it and upload the new copy',
      '/documents/' || r.id, 'doc-' || r.id || '-' || r.expires_on || '-' || v_band);
  end loop;

  -- Important client dates (birthdays, renewals...) coming up.
  for r in select d.id, d.title, d.client_id, d.created_by, c.name as client,
                  public.next_occurrence(d.the_date, d.yearly, v_today) as on_day, d.remind_days
             from public.important_dates d join public.clients c on c.id = d.client_id
            where d.company_id = p_company loop
    v_days := r.on_day - v_today;
    if v_days between 0 and r.remind_days then
      if public.is_active_member(p_company, r.created_by) then
        perform public.notify(p_company, r.created_by, 'important_date', 'info',
          case when v_days = 0 then 'Today: ' else 'Coming up: ' end || r.title || ' · ' || r.client,
          to_char(r.on_day, 'DD Mon YYYY'), '/clients/' || r.client_id || '#dates', 'date-' || r.id || '-' || r.on_day);
      else
        perform public.notify_roles(p_company, public.crm_roles(), null, 'important_date', 'info',
          case when v_days = 0 then 'Today: ' else 'Coming up: ' end || r.title || ' · ' || r.client,
          to_char(r.on_day, 'DD Mon YYYY'), '/clients/' || r.client_id || '#dates', 'date-' || r.id || '-' || r.on_day);
      end if;
    end if;
  end loop;

  -- Supplier deliveries that are late.
  for r in select p.id, p.number, p.expected_date, p.created_by, s.name as supplier
             from public.purchase_orders p join public.suppliers s on s.id = p.supplier_id
            where p.company_id = p_company and p.status in ('approved', 'sent', 'confirmed', 'partially_received')
              and p.expected_date < v_today loop
    perform public.notify_roles(p_company, array['procurement']::public.app_role[], null, 'po_late', 'attention',
      'Supplier delivery late: ' || r.supplier, r.number || ' · expected ' || to_char(r.expected_date, 'DD Mon'),
      '/purchase-orders/' || r.id, 'po-late-' || r.id || '-' || r.expected_date);
    perform public.notify(p_company, r.created_by, 'po_late', 'attention',
      'Supplier delivery late: ' || r.supplier, r.number || ' · expected ' || to_char(r.expected_date, 'DD Mon'),
      '/purchase-orders/' || r.id, 'po-late-' || r.id || '-' || r.expected_date);
  end loop;

  -- Client invoices due within N days (company setting, 0 = off).
  if coalesce(co.invoice_remind_before_days, 0) > 0 then
    for r in select i.id, i.number, i.due_date, i.total - i.amount_paid as owed, i.currency, c.name as client
               from public.invoices i join public.clients c on c.id = i.client_id
              where i.company_id = p_company and i.status in ('issued', 'partly_paid')
                and i.due_date between v_today and v_today + co.invoice_remind_before_days loop
      perform public.notify_roles(p_company, array['finance', 'management']::public.app_role[], null, 'invoice_due', 'info',
        'Invoice due soon: ' || r.client,
        r.number || ' · ' || public.fmt_money(r.owed, r.currency) || ' · due ' || to_char(r.due_date, 'DD Mon')
          || ' · send the client a reminder',
        '/invoices/' || r.id || '#remind', 'inv-due-' || r.id || '-' || r.due_date);
    end loop;
  end if;

  -- Overdue client invoices: first day late, then every N days; paused while a promise has not passed.
  for r in select i.id, i.number, i.due_date, i.total - i.amount_paid as owed, i.currency, c.name as client,
                  v_today - i.due_date as late, fu.next_on as promised_on
             from public.invoices i
             join public.clients c on c.id = i.client_id
             left join lateral (select f.next_on from public.followups f where f.invoice_id = i.id
                                 order by f.created_at desc limit 1) fu on true
            where i.company_id = p_company and i.status in ('issued', 'partly_paid') and i.due_date < v_today
              and (fu.next_on is null or fu.next_on < v_today) loop
    if r.promised_on is not null then
      perform public.notify_roles(p_company, array['finance', 'management']::public.app_role[], null, 'invoice_overdue', 'attention',
        'Promised payment not received: ' || r.client,
        r.number || ' · ' || public.fmt_money(r.owed, r.currency) || ' · promised for ' || to_char(r.promised_on, 'DD Mon'),
        '/invoices/' || r.id || '#remind', 'inv-promise-' || r.id || '-' || r.promised_on);
    end if;
    v_step := (r.late - 1) / greatest(coalesce(co.invoice_overdue_every_days, 30), 1);
    v_band := 1 + v_step * greatest(coalesce(co.invoice_overdue_every_days, 30), 1);
    v_sev := case when r.late > 60 then 'critical' else 'attention' end;
    perform public.notify_roles(p_company, array['finance', 'management']::public.app_role[], null, 'invoice_overdue', v_sev,
      'Invoice overdue: ' || r.client,
      r.number || ' · ' || public.fmt_money(r.owed, r.currency) || ' · ' || r.late || ' days late',
      '/invoices/' || r.id || '#remind', 'inv-od-' || r.id || '-' || v_band);
  end loop;

  -- Supplier bills due within 3 days or late.
  for r in select b.id, b.number, b.supplier_invoice_no, b.due_date, b.total - b.amount_paid as owed, b.currency, s.name as supplier
             from public.supplier_bills b join public.suppliers s on s.id = b.supplier_id
            where b.company_id = p_company and b.status in ('open', 'partly_paid') and b.due_date <= v_today + 3 loop
    perform public.notify_roles(p_company, array['finance']::public.app_role[], null, 'bill_due',
      case when r.due_date < v_today then 'critical' else 'attention' end,
      case when r.due_date < v_today then 'Supplier payment late: ' else 'Supplier payment due: ' end || r.supplier,
      coalesce(r.supplier_invoice_no, r.number) || ' · ' || public.fmt_money(r.owed, r.currency) || ' · due ' || to_char(r.due_date, 'DD Mon'),
      '/bills/' || r.id, 'bill-due-' || r.id || '-' || case when r.due_date < v_today then 'late' else 'soon' end);
  end loop;

  -- Batches in stock that expire within 60 days (again at 30, 7 and when expired).
  for r in select s.product_id, s.warehouse_id, s.batch_no, s.expiry_date, s.quantity, p.name, p.unit, w.name as store
             from public.stock_on_hand s
             join public.products p on p.id = s.product_id
             join public.warehouses w on w.id = s.warehouse_id
            where s.company_id = p_company and s.quantity > 0 and s.expiry_date is not null
              and s.expiry_date <= v_today + 60 loop
    v_band := case when r.expiry_date <= v_today then 0 when r.expiry_date <= v_today + 7 then 7
                   when r.expiry_date <= v_today + 30 then 30 else 60 end;
    perform public.notify_roles(p_company, array['warehouse', 'management']::public.app_role[], null, 'batch_expiry',
      case when v_band <= 7 then 'critical' else 'attention' end,
      case when v_band = 0 then 'Batch expired: ' else 'Batch expiring: ' end || r.name,
      coalesce(nullif(r.batch_no, ''), 'no batch') || ' · ' || trim_scale(r.quantity) || ' ' || r.unit || ' in ' || r.store
        || ' · expiry ' || to_char(r.expiry_date, 'DD Mon YYYY'),
      '/stock/' || r.product_id,
      'exp-' || r.product_id || '-' || r.warehouse_id || '-' || r.batch_no || '-' || v_band);
  end loop;

  -- Products at or below their reorder level (weekly reminder).
  for r in select p.id, p.name, p.unit, p.reorder_level, coalesce(sum(m.quantity), 0) as on_hand
             from public.products p
             left join public.stock_movements m on m.product_id = p.id
            where p.company_id = p_company and p.active and p.reorder_level > 0
            group by p.id
           having coalesce(sum(m.quantity), 0) <= p.reorder_level loop
    perform public.notify_roles(p_company, array['warehouse', 'procurement']::public.app_role[], null, 'low_stock',
      case when r.on_hand <= 0 then 'critical' else 'attention' end,
      case when r.on_hand <= 0 then 'Out of stock: ' else 'Low stock: ' end || r.name,
      trim_scale(r.on_hand) || ' ' || r.unit || ' left · reorder level ' || trim_scale(r.reorder_level),
      '/stock/' || r.id, 'low-' || r.id || '-' || v_week);
  end loop;

  -- Vehicles: insurance, inspection and service dates within the reminder period, and once passed.
  for r in select v.id, v.plate, v.name, x.what, x.on_day, v.remind_days
             from public.vehicles v
            cross join lateral (values ('insurance', v.insurance_expires), ('inspection', v.inspection_expires),
                                       ('service', v.service_due_on)) as x(what, on_day)
            where v.company_id = p_company and v.active and x.on_day is not null
              and x.on_day <= v_today + v.remind_days and x.on_day >= v_today - 7 loop
    v_band := case when r.on_day < v_today then -1 when r.on_day <= v_today + 3 then 3 else r.remind_days end;
    perform public.notify_roles(p_company, array['management', 'warehouse']::public.app_role[], null, 'vehicle_due',
      case when v_band <= 3 then 'critical' else 'attention' end,
      case r.what when 'insurance' then 'Vehicle insurance: ' when 'inspection' then 'Vehicle inspection: '
                  else 'Vehicle service due: ' end || r.plate,
      coalesce(r.name || ' · ', '') || case when r.on_day < v_today then 'passed on ' else 'due ' end
        || to_char(r.on_day, 'DD Mon YYYY'),
      '/fleet/' || r.id, 'veh-' || r.id || '-' || r.what || '-' || r.on_day || '-' || v_band);
  end loop;

  update public.companies set alerts_checked_at = now() where id = p_company;
  select count(*) into v_after from public.notifications where company_id = p_company;
  return v_after - v_before;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Clearing test data before go-live also clears the vehicle log and
--    cash positions (vehicles and budgets are kept)
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

  delete from public.notifications     where company_id = p_company;
  delete from public.crm_activities    where company_id = p_company;
  delete from public.tenders           where company_id = p_company;
  delete from public.opportunities     where company_id = p_company;
  delete from public.followups         where company_id = p_company;
  delete from public.expenses          where company_id = p_company;
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
                    'vehicle_logs', 'cash_positions');
  delete from public.code_counters
   where company_id = p_company
     and kind ~ '^(rfqs|quotations|supplier_rfqs|purchase_orders|goods_receipts|deliveries|invoices|payments|supplier_bills|supplier_payments|expenses|opportunities|tenders|stock_transfers|requisitions)-';
  update public.companies set alerts_checked_at = null where id = p_company;

  perform set_config('ims.status_change', 'off', true);
  perform set_config('ims.allow_line_copy', 'off', true);
  return 'Test transactions cleared for ' || v_name || '. Master data, contracts, documents, vehicles, budgets, team and settings were kept.';
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Feature catalogue: budgets, cash-flow, planning and fleet are live
-- ---------------------------------------------------------------------
update public.features set status = 'live', route = '/budgets',
       tutorial = '[{"title":"Set the year","body":"Enter a monthly budget for sales, gross profit, expenses and net profit, or for each expense category."},{"title":"Compare","body":"Each month shows the budget, the actual figure and the difference."},{"title":"Act early","body":"Lines over budget are marked so you can act before the year ends."}]'
 where key = 'budgets';
update public.features set status = 'live', route = '/cashflow',
       tutorial = '[{"title":"Cash today","body":"Enter what is in the bank, mobile money and cash today."},{"title":"Week by week","body":"See money expected in from clients and out to suppliers and expenses for the next weeks."},{"title":"Plan ahead","body":"A week that goes below zero is marked, so you can chase payments or move orders."}]'
 where key = 'cashflow_forecast';
update public.features set status = 'live', route = '/planning',
       tutorial = '[{"title":"From your sales","body":"See how much of each product sells per day and how many days your stock lasts."},{"title":"When to order","body":"The reorder point counts the supplier''s lead time plus a week of safety stock."},{"title":"Order","body":"Turn the suggestions into purchase orders or set them as reorder levels."}]'
 where key = 'demand_forecast';
update public.features set status = 'live', route = '/fleet',
       tutorial = '[{"title":"Add vehicles","body":"Plate, driver, insurance, inspection and service dates."},{"title":"Log fuel and services","body":"Drivers and the store record fuel, kilometres and repairs."},{"title":"Reminders","body":"You are reminded before insurance, inspection or a service is due."}]'
 where key = 'fleet_tracking';

-- ---------------------------------------------------------------------
-- 9. Demos: budgets, a cash position and two vehicles with a log
-- ---------------------------------------------------------------------
create or replace function public.demo_seed_stage15(p_company uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_driver uuid;
  v_year int := extract(year from (now() at time zone 'Africa/Dar_es_Salaam'))::int;
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_sales numeric;
  v_exp numeric;
  v_v1 uuid;
  v_v2 uuid;
  i int;
begin
  if not exists (select 1 from public.companies where id = p_company and is_demo) then return; end if;
  select user_id into v_owner from public.memberships where company_id = p_company and role = 'management' and active
   order by created_at limit 1;
  select user_id into v_driver from public.memberships where company_id = p_company and role = 'driver' and active
   order by created_at limit 1;

  -- Budgets a little above last quarter's monthly average.
  select coalesce(sum((i2.total - i2.vat_amount) * i2.exchange_rate), 0) / 3 into v_sales
    from public.invoices i2
   where i2.company_id = p_company and i2.status <> 'cancelled' and i2.issue_date >= v_today - 90;
  select coalesce(sum((e.amount - e.vat_amount) * e.exchange_rate), 0) / 3 into v_exp
    from public.expenses e where e.company_id = p_company and e.voided_at is null and e.spent_on >= v_today - 90;
  v_sales := greatest(round(v_sales * 1.1, -4), 5000000);
  v_exp := greatest(round(v_exp, -4), 800000);
  for i in 1..12 loop
    insert into public.budgets (company_id, year, month, measure, amount, updated_by)
    values (p_company, v_year, i, 'sales', v_sales, v_owner),
           (p_company, v_year, i, 'gross_profit', round(v_sales * 0.22, -3), v_owner),
           (p_company, v_year, i, 'expenses', v_exp, v_owner),
           (p_company, v_year, i, 'net_profit', greatest(round(v_sales * 0.22, -3) - v_exp, 0), v_owner)
    on conflict do nothing;
  end loop;

  insert into public.cash_positions (company_id, as_of, amount, note, created_by)
  values (p_company, v_today, greatest(round(v_sales * 0.6, -4), 3000000), 'Bank and M-Pesa balances this morning', v_owner);

  insert into public.vehicles (company_id, plate, name, kind, capacity_kg, driver_id, insurance_expires, inspection_expires,
                               service_due_on, service_due_km, odometer_km, created_by)
  values (p_company, 'T 482 DKL', 'Isuzu FRR (blue)', 'truck', 5000, v_driver, v_today + 9, v_today + 120, v_today + 30, 128000, 121350, v_owner)
  returning id into v_v1;
  insert into public.vehicles (company_id, plate, name, kind, capacity_kg, insurance_expires, inspection_expires,
                               service_due_on, odometer_km, created_by)
  values (p_company, 'T 917 DSM', 'Toyota Hilux', 'pickup', 1000, v_today + 200, v_today + 45, v_today - 3, 64210, v_owner)
  returning id into v_v2;
  insert into public.vehicle_logs (company_id, vehicle_id, kind, happened_on, odometer_km, litres, amount, note, created_by)
  values (p_company, v_v1, 'fuel', v_today - 12, 120400, 120, 384000, 'Puma Nyerere Road', coalesce(v_driver, v_owner)),
         (p_company, v_v1, 'fuel', v_today - 5, 121000, 110, 352000, 'Puma Nyerere Road', coalesce(v_driver, v_owner)),
         (p_company, v_v1, 'tyres', v_today - 20, 119800, null, 1450000, 'Two rear tyres', v_owner),
         (p_company, v_v2, 'service', v_today - 80, 60100, null, 420000, 'Oil and filters', v_owner),
         (p_company, v_v2, 'fuel', v_today - 2, 64210, 55, 176000, null, v_owner);
end;
$$;

create or replace function public.create_demo_company(p_level public.business_level default 'medium')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_level public.business_level := coalesce(p_level, 'medium');
  v_id uuid;
  r record;
begin
  if v_user is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('ims.create_demo_company'));
  if (select count(*) from public.demo_starts where created_at > now() - interval '1 hour') >= 150 then
    raise exception 'Too many demos have been started in the last hour. Please try again a little later.'
      using errcode = '54000';
  end if;
  if (select count(*) from public.demo_starts where user_id = v_user and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You have restarted the demo many times in the last hour. Please try again a little later.'
      using errcode = '54000';
  end if;

  for r in select m.company_id from public.memberships m join public.companies c on c.id = m.company_id
            where m.user_id = v_user and c.is_demo loop
    perform public.delete_demo_company(r.company_id);
  end loop;

  insert into public.demo_starts (user_id) values (v_user);

  v_id := case v_level
            when 'small' then public.demo_seed_small()
            when 'enterprise' then public.demo_seed_enterprise()
            else public.demo_seed_medium()
          end;
  perform public.demo_seed_stage13(v_id);
  perform public.demo_seed_stage14(v_id);
  perform public.demo_seed_stage14_ops(v_id);
  perform public.demo_seed_stage15(v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
revoke execute on function
  public.finance_roles(),
  public.set_budget(uuid, int, text, uuid, numeric[]),
  public.cashflow_forecast(uuid, int),
  public.demand_plan(uuid, int),
  public.fleet_roles(),
  public.prepare_vehicle(),
  public.prepare_vehicle_log(),
  public.run_company_alerts(uuid),
  public.reset_company_transactions(uuid, text),
  public.demo_seed_stage15(uuid),
  public.create_demo_company(public.business_level)
from public, anon;
revoke execute on function
  public.prepare_vehicle(),
  public.prepare_vehicle_log(),
  public.run_company_alerts(uuid),
  public.reset_company_transactions(uuid, text),
  public.demo_seed_stage15(uuid)
from authenticated;
grant execute on function
  public.finance_roles(),
  public.set_budget(uuid, int, text, uuid, numeric[]),
  public.cashflow_forecast(uuid, int),
  public.demand_plan(uuid, int),
  public.fleet_roles(),
  public.create_demo_company(public.business_level)
to authenticated;
