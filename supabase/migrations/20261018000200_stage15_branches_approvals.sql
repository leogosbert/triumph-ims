-- =====================================================================
-- LeMoSp · Stage 15 part 2: branches, approvals in steps, scheduled reports
--
--   Branches         branches (business units) of a company. Stores and
--                    staff belong to a branch; quotations, invoices,
--                    purchase orders and expenses take the branch of the
--                    person who makes them (or of the quotation they come
--                    from). Management can move a document to another
--                    branch. branch_summary() gives head office the
--                    figures of every branch side by side.
--   Approvals in     approval_steps: purchase orders above an amount need
--   steps            one or more approvals in order (for example finance,
--                    then management). Each step is approved by its role
--                    (or management), never by the person who sent the
--                    order, and never twice by the same person. Without
--                    steps the single management approval stays as before.
--   Scheduled        report_schedules: any report, with its filters and
--   reports          columns, sent every day, week or month as an alert and
--                    email with a link to the report for the period.
--
-- Run after the Stage 15 part 1 file. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Branches
-- ---------------------------------------------------------------------
create table if not exists public.branches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 120),
  code        text check (code is null or code ~ '^[A-Z0-9-]{1,12}$'),
  address     text check (address is null or char_length(address) <= 300),
  phone       text check (phone is null or char_length(phone) <= 40),
  manager_id  uuid references auth.users (id) on delete set null,
  active      boolean not null default true,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, company_id)
);
create unique index if not exists branches_name_key on public.branches (company_id, lower(btrim(name)));
create unique index if not exists branches_code_key on public.branches (company_id, code) where code is not null;

create or replace function public.prepare_branch()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.code := nullif(upper(btrim(new.code)), '');
  if new.manager_id is not null and not exists (
    select 1 from public.memberships where company_id = new.company_id and user_id = new.manager_id and active
  ) then
    raise exception 'The branch manager must be a member of the company.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists branches_prepare on public.branches;
create trigger branches_prepare before insert or update on public.branches for each row execute function public.prepare_branch();

-- The branch of stores, staff and documents.
do $$
declare
  t text;
begin
  foreach t in array array['warehouses', 'memberships', 'quotations', 'invoices', 'purchase_orders', 'expenses'] loop
    execute format('alter table public.%I add column if not exists branch_id uuid', t);
    if not exists (select 1 from pg_catalog.pg_constraint where conname = t || '_branch_fk') then
      execute format('alter table public.%I add constraint %I foreign key (branch_id, company_id) '
                     'references public.branches (id, company_id)', t, t || '_branch_fk');
    end if;
    execute format('create index if not exists %I on public.%I (branch_id) where branch_id is not null', t || '_branch_idx', t);
  end loop;
end;
$$;

-- New documents take the branch of the quotation they come from, else of the person making them.
create or replace function public.fill_branch()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.branch_id is not null then return new; end if;
  if tg_table_name in ('invoices', 'purchase_orders') then
    if new.quotation_id is not null then
      select branch_id into new.branch_id from public.quotations where id = new.quotation_id;
    end if;
  end if;
  if new.branch_id is null then
    select branch_id into new.branch_id from public.memberships
     where company_id = new.company_id and user_id = auth.uid();
  end if;
  return new;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['quotations', 'invoices', 'purchase_orders', 'expenses'] loop
    execute format('drop trigger if exists %I_branch on public.%I', t, t);
    execute format('create trigger %I_branch before insert on public.%I for each row execute function public.fill_branch()', t, t);
  end loop;
end;
$$;

-- Management puts a person in a branch (null = head office / no branch).
create or replace function public.set_member_branch(p_membership uuid, p_branch uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m public.memberships;
begin
  select * into m from public.memberships where id = p_membership;
  if m.id is null or not public.is_manager(m.company_id) then
    raise exception 'Only management can change branches.' using errcode = '42501';
  end if;
  if p_branch is not null and not exists (select 1 from public.branches where id = p_branch and company_id = m.company_id) then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  update public.memberships set branch_id = p_branch where id = p_membership;
end;
$$;

-- Management moves a document to another branch.
create or replace function public.set_document_branch(p_kind text, p_id uuid, p_branch uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_table text;
  v_company uuid;
begin
  v_table := case p_kind when 'quotation' then 'quotations' when 'invoice' then 'invoices'
                         when 'purchase_order' then 'purchase_orders' when 'expense' then 'expenses' end;
  if v_table is null then raise exception 'Unknown document.' using errcode = '22023'; end if;
  execute format('select company_id from public.%I where id = $1', v_table) into v_company using p_id;
  if v_company is null or not public.is_manager(v_company) then
    raise exception 'Only management can change the branch of a document.' using errcode = '42501';
  end if;
  if p_branch is not null and not exists (select 1 from public.branches where id = p_branch and company_id = v_company) then
    raise exception 'Branch not found.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  execute format('update public.%I set branch_id = $1 where id = $2', v_table) using p_branch, p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Head office: the figures of every branch for a period (base currency).
--   sales / gross_profit  issued invoices before VAT, by issue date
--   expenses              expenses before VAT, not voided
--   purchases             purchase orders approved or further, by order date
--   owed                  unpaid invoice balances today
--   stock_value           stock in the branch's stores at last cost, today
-- A row with no branch_id holds what is not in any branch.
create or replace function public.branch_summary(p_company uuid, p_from date, p_to date)
returns table (branch_id uuid, branch_name text, sales numeric, gross_profit numeric, expenses numeric, purchases numeric,
               owed numeric, stock_value numeric, invoices bigint, staff bigint, stores bigint)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management and finance can see the branch figures.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Choose the dates.' using errcode = '22023';
  end if;
  return query
  with s as (
    select i.branch_id as b, sum(p.revenue_base) as sales, sum(p.revenue_base - p.cost_base) as gp, count(*) as n
      from public.invoice_profit p join public.invoices i on i.id = p.invoice_id
     where p.company_id = p_company and p.issue_date between p_from and p_to
     group by i.branch_id
  ), e as (
    select x.branch_id as b, sum((x.amount - x.vat_amount) * x.exchange_rate) as amt
      from public.expenses x
     where x.company_id = p_company and x.voided_at is null and x.spent_on between p_from and p_to
     group by x.branch_id
  ), po as (
    select x.branch_id as b, sum(x.total * x.exchange_rate) as amt
      from public.purchase_orders x
     where x.company_id = p_company and x.order_date between p_from and p_to
       and x.status in ('approved', 'sent', 'confirmed', 'partially_received', 'received', 'closed')
     group by x.branch_id
  ), o as (
    select x.branch_id as b, sum((x.total - x.amount_paid) * x.exchange_rate) as amt
      from public.invoices x
     where x.company_id = p_company and x.status in ('issued', 'partly_paid')
     group by x.branch_id
  ), st as (
    select w.branch_id as b, sum(greatest(q.qty, 0) * coalesce(c.last_cost, 0)) as amt
      from (select m.warehouse_id, m.product_id, sum(m.quantity) as qty
              from public.stock_movements m where m.company_id = p_company
             group by m.warehouse_id, m.product_id) q
      join public.warehouses w on w.id = q.warehouse_id
      left join public.product_costs c on c.product_id = q.product_id
     group by w.branch_id
  ), staff as (
    select m.branch_id as b, count(*) as n from public.memberships m
     where m.company_id = p_company and m.active group by m.branch_id
  ), stores as (
    select w.branch_id as b, count(*) as n from public.warehouses w
     where w.company_id = p_company and w.active group by w.branch_id
  ), keys as (
    select br.id as b, br.name, 0 as unassigned from public.branches br where br.company_id = p_company
    union all
    select null::uuid, null::text, 1
  )
  select k.b, k.name,
         round(coalesce(s.sales, 0), 2), round(coalesce(s.gp, 0), 2), round(coalesce(e.amt, 0), 2),
         round(coalesce(po.amt, 0), 2), round(coalesce(o.amt, 0), 2), round(coalesce(st.amt, 0), 2),
         coalesce(s.n, 0), coalesce(staff.n, 0), coalesce(stores.n, 0)
    from keys k
    left join s on s.b is not distinct from k.b
    left join e on e.b is not distinct from k.b
    left join po on po.b is not distinct from k.b
    left join o on o.b is not distinct from k.b
    left join st on st.b is not distinct from k.b
    left join staff on staff.b is not distinct from k.b
    left join stores on stores.b is not distinct from k.b
   where k.unassigned = 0
      or coalesce(s.sales, 0) <> 0 or coalesce(e.amt, 0) <> 0 or coalesce(po.amt, 0) <> 0
      or coalesce(o.amt, 0) <> 0 or coalesce(st.amt, 0) <> 0 or coalesce(staff.n, 0) <> 0 or coalesce(stores.n, 0) <> 0
   order by k.unassigned, k.name;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Approvals in steps (purchase orders)
-- ---------------------------------------------------------------------
create table if not exists public.approval_steps (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  doc_type    text not null default 'purchase_order' check (doc_type in ('purchase_order')),
  step        integer not null check (step between 1 and 6),
  role        public.app_role not null check (role in ('management', 'finance', 'procurement', 'warehouse')),
  min_amount  numeric(18, 2) not null default 0 check (min_amount >= 0),
  label       text check (label is null or char_length(label) <= 80),
  updated_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (company_id, doc_type, step)
);

-- What each purchase order needed and who approved each step.
create table if not exists public.po_approvals (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  po_id        uuid not null,
  step         integer not null,
  role         public.app_role not null,
  label        text,
  approved_by  uuid references auth.users (id) on delete set null,
  approved_at  timestamptz,
  note         text,
  created_at   timestamptz not null default now(),
  unique (po_id, step),
  foreign key (po_id, company_id) references public.purchase_orders (id, company_id) on delete cascade
);

-- Management sets all the steps at once: [{"role": "finance", "min_amount": 0, "label": "Budget check"}, …]
create or replace function public.set_approval_steps(p_company uuid, p_doc_type text, p_steps jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  s jsonb;
  i int := 0;
  v_role text;
  v_min numeric;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can set approval steps.' using errcode = '42501';
  end if;
  if p_doc_type is distinct from 'purchase_order' then raise exception 'Unknown document.' using errcode = '22023'; end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then raise exception 'Steps must be a list.' using errcode = '22023'; end if;
  if jsonb_array_length(p_steps) > 6 then raise exception 'At most six steps.' using errcode = '22023'; end if;
  delete from public.approval_steps where company_id = p_company and doc_type = p_doc_type;
  for s in select value from jsonb_array_elements(p_steps) loop
    i := i + 1;
    v_role := s ->> 'role';
    if v_role is null or v_role not in ('management', 'finance', 'procurement', 'warehouse') then
      raise exception 'Step %: choose who approves.', i using errcode = '22023';
    end if;
    begin
      v_min := coalesce(nullif(s ->> 'min_amount', '')::numeric, 0);
    exception when others then
      raise exception 'Step %: the amount is not a number.', i using errcode = '22023';
    end;
    if v_min < 0 then raise exception 'Step %: the amount cannot be negative.', i using errcode = '22023'; end if;
    insert into public.approval_steps (company_id, doc_type, step, role, min_amount, label, updated_by)
    values (p_company, p_doc_type, i, v_role::public.app_role, round(v_min, 2), nullif(left(btrim(s ->> 'label'), 80), ''), auth.uid());
  end loop;
  return i;
end;
$$;

create or replace function public.submit_purchase_order(p_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  po public.purchase_orders;
  c public.companies;
  v_lines int;
  v_reason text;
begin
  select * into po from public.purchase_orders where id = p_id;
  if po.id is null or not public.has_role(po.company_id, array['management', 'procurement']::public.app_role[]) then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;
  if po.status <> 'draft' then raise exception 'Only a draft can be submitted.' using errcode = '22023'; end if;
  select count(*) into v_lines from public.po_lines where po_id = p_id;
  if v_lines = 0 then raise exception 'Add at least one line before submitting.' using errcode = '22023'; end if;
  if po.total <= 0 then raise exception 'The purchase order total is zero. Check the prices.' using errcode = '22023'; end if;
  select * into c from public.companies where id = po.company_id;

  -- Approval steps (Enterprise): every step whose amount the order reaches, in order.
  delete from public.po_approvals where po_id = p_id;
  if public.feature_on(po.company_id, 'advanced_approvals') then
    insert into public.po_approvals (company_id, po_id, step, role, label)
    select po.company_id, p_id, s.step, s.role, s.label
      from public.approval_steps s
     where s.company_id = po.company_id and s.doc_type = 'purchase_order'
       and s.min_amount <= po.total * po.exchange_rate;
    if found then
      perform set_config('ims.status_change', 'on', true);
      update public.purchase_orders set status = 'pending_approval', submitted_at = now(), submitted_by = auth.uid(),
             approval_reason = 'approval steps', review_note = null where id = p_id;
      perform set_config('ims.status_change', 'off', true);
      return 'pending_approval';
    end if;
  end if;

  if po.total * po.exchange_rate > c.po_approval_above then
    v_reason := 'value above the purchase approval limit';
  end if;

  perform set_config('ims.status_change', 'on', true);
  if v_reason is null or public.is_manager(po.company_id) then
    update public.purchase_orders set status = 'approved', submitted_at = now(), submitted_by = auth.uid(),
           approved_at = now(), approved_by = case when v_reason is not null then auth.uid() end,
           approval_reason = v_reason, review_note = null where id = p_id;
    perform set_config('ims.status_change', 'off', true);
    return 'approved';
  end if;
  update public.purchase_orders set status = 'pending_approval', submitted_at = now(), submitted_by = auth.uid(),
         approval_reason = v_reason, review_note = null where id = p_id;
  perform set_config('ims.status_change', 'off', true);
  return 'pending_approval';
end;
$$;

create or replace function public.review_purchase_order(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  po public.purchase_orders;
  st public.po_approvals;
  nx public.po_approvals;
  v_supplier text;
begin
  select * into po from public.purchase_orders where id = p_id;
  if po.id is null or not public.has_role(po.company_id, array['management', 'procurement', 'finance', 'warehouse']::public.app_role[]) then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;
  if po.status <> 'pending_approval' then raise exception 'This purchase order is not waiting for approval.' using errcode = '22023'; end if;
  select * into st from public.po_approvals where po_id = p_id and approved_at is null order by step limit 1;

  if st.id is null then
    -- One approval by management, as before.
    if not public.is_manager(po.company_id) then
      raise exception 'Only management can approve purchase orders.' using errcode = '42501';
    end if;
  elsif not public.has_role(po.company_id, array[st.role, 'management']::public.app_role[]) then
    raise exception 'This step is approved by %.', st.role using errcode = '42501';
  end if;
  if po.submitted_by = auth.uid() then
    raise exception 'You cannot approve a purchase order you submitted yourself.' using errcode = '42501';
  end if;
  if st.id is not null and exists (select 1 from public.po_approvals where po_id = p_id and approved_by = auth.uid()) then
    raise exception 'You approved an earlier step. Another person must approve this one.' using errcode = '42501';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'Please say what needs to change.' using errcode = '22023';
  end if;

  perform set_config('ims.status_change', 'on', true);
  if not p_approve then
    delete from public.po_approvals where po_id = p_id;
    update public.purchase_orders set status = 'draft', review_note = btrim(p_note) where id = p_id;
  elsif st.id is null then
    update public.purchase_orders set status = 'approved', approved_at = now(), approved_by = auth.uid(),
           review_note = nullif(btrim(p_note), '') where id = p_id;
  else
    update public.po_approvals set approved_by = auth.uid(), approved_at = now(), note = nullif(left(btrim(p_note), 500), '')
     where id = st.id;
    select * into nx from public.po_approvals where po_id = p_id and approved_at is null order by step limit 1;
    if nx.id is null then
      update public.purchase_orders set status = 'approved', approved_at = now(), approved_by = auth.uid(),
             review_note = nullif(btrim(p_note), '') where id = p_id;
    else
      select name into v_supplier from public.suppliers where id = po.supplier_id;
      perform public.notify_roles(po.company_id, array[nx.role]::public.app_role[], po.submitted_by,
        'po_approval', 'attention', 'Purchase order waiting for your approval',
        po.number || ' · ' || v_supplier || ' · ' || public.fmt_money(po.total, po.currency)
          || ' · step ' || nx.step || coalesce(' (' || nx.label || ')', ''),
        '/purchase-orders/' || po.id, 'po-step-' || po.id || '-' || nx.step || '-' || extract(epoch from po.submitted_at)::bigint);
    end if;
  end if;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Notifications on purchase order status: as Stage 7, but the first approval
-- step's role is told when the order uses approval steps.
create or replace function public.on_po_status()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_supplier text;
  v_link text := '/purchase-orders/' || new.id;
  q record;
  st public.po_approvals;
begin
  if new.status is not distinct from old.status then return null; end if;
  select name into v_supplier from public.suppliers where id = new.supplier_id;

  if new.status = 'pending_approval' then
    select * into st from public.po_approvals where po_id = new.id and approved_at is null order by step limit 1;
    perform public.notify_roles(new.company_id, array[coalesce(st.role, 'management')]::public.app_role[], new.submitted_by,
      'po_approval', 'attention', 'Purchase order waiting for your approval',
      new.number || ' · ' || v_supplier || ' · ' || public.fmt_money(new.total, new.currency)
        || coalesce(' · step ' || st.step || coalesce(' (' || st.label || ')', ''), ''), v_link, null);
  elsif old.status = 'pending_approval' and new.status = 'approved' then
    perform public.notify(new.company_id, new.submitted_by, 'po_approved', 'info',
      'Purchase order approved: ' || new.number, v_supplier || ' · you can now send it', v_link, null);
  elsif old.status = 'pending_approval' and new.status = 'draft' then
    perform public.notify(new.company_id, new.submitted_by, 'po_returned', 'attention',
      'Purchase order sent back: ' || new.number, coalesce(new.review_note, 'Changes needed'), v_link, null);
  elsif new.status in ('partially_received', 'received') and old.status not in ('partially_received', 'received') then
    if new.created_by is distinct from auth.uid() then
      perform public.notify(new.company_id, new.created_by, 'goods_received', 'info',
        'Goods received: ' || new.number, v_supplier, v_link, null);
    end if;
    if new.quotation_id is not null then
      select qt.id, qt.created_by, c.name as client into q
        from public.quotations qt join public.clients c on c.id = qt.client_id where qt.id = new.quotation_id;
      perform public.notify(new.company_id, q.created_by, 'goods_received', 'attention',
        'Goods arrived for ' || q.client, new.number || ' from ' || v_supplier || ' · ready to deliver',
        '/quotations/' || q.id, 'goods-in-' || new.id);
    end if;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Scheduled reports
-- ---------------------------------------------------------------------
create table if not exists public.report_schedules (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 2 and 80),
  report_key    text not null check (report_key ~ '^[a-z0-9-]{2,40}$'),
  query         text not null default '' check (char_length(query) <= 1500 and query !~ '[\s<>"]'),
  frequency     text not null check (frequency in ('daily', 'weekly', 'monthly')),
  weekday       integer check (weekday between 1 and 7),
  active        boolean not null default true,
  last_sent_on  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((frequency = 'weekly') = (weekday is not null))
);
create index if not exists report_schedules_due_idx on public.report_schedules (frequency) where active;

-- Sends the reports due today (from 07:00 Dar es Salaam time). Each one is an alert with a
-- link to the report for the period just ended: yesterday, last week (Monday to Sunday) or last month.
create or replace function public.run_report_schedules()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamp := now() at time zone 'Africa/Dar_es_Salaam';
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  r record;
  v_from date;
  v_to date;
  v_when text;
  v_n int := 0;
begin
  if extract(hour from v_now) < 7 then return 0; end if;
  for r in
    select s.* from public.report_schedules s
      join public.memberships m on m.company_id = s.company_id and m.user_id = s.user_id and m.active
     where s.active and s.last_sent_on is distinct from v_today
       and public.feature_on(s.company_id, 'scheduled_reports')
       and (s.frequency = 'daily'
            or (s.frequency = 'weekly' and extract(isodow from v_today) = s.weekday)
            or (s.frequency = 'monthly' and extract(day from v_today) = 1))
  loop
    if r.frequency = 'daily' then
      v_from := v_today - 1; v_to := v_today - 1;
      v_when := to_char(v_from, 'DD Mon YYYY');
    elsif r.frequency = 'weekly' then
      v_from := v_today - 7; v_to := v_today - 1;
      v_when := to_char(v_from, 'DD Mon') || ' – ' || to_char(v_to, 'DD Mon YYYY');
    else
      v_from := (date_trunc('month', v_today) - interval '1 month')::date; v_to := v_today - 1;
      v_when := to_char(v_from, 'FMMonth YYYY');
    end if;
    perform public.notify(r.company_id, r.user_id, 'scheduled_report', 'attention', r.name, v_when,
      '/reports/' || r.report_key || '?' || concat_ws('&', nullif(r.query, ''), 'p=custom', 'from=' || v_from, 'to=' || v_to),
      'report-' || r.id || '-' || v_today);
    update public.report_schedules set last_sent_on = v_today where id = r.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Scheduled entry point: as Stage 11, plus the scheduled reports.
create or replace function public.run_all_alerts(p_secret text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  v_total int := 0;
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  perform public.purge_demo_companies();
  for c in select id from public.companies loop
    v_total := v_total + public.run_company_alerts(c.id);
  end loop;
  -- Growth recommendations never stop the alerts (each company is also
  -- protected inside run_all_growth_checks).
  begin
    perform public.run_all_growth_checks();
  exception when others then
    raise warning 'Growth checks failed: %', sqlerrm;
  end;
  begin
    v_total := v_total + public.run_report_schedules();
  exception when others then
    raise warning 'Scheduled reports failed: %', sqlerrm;
  end;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Triggers, row-level security and grants
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['branches', 'report_schedules'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['branches', 'approval_steps', 'po_approvals', 'report_schedules'] loop
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

-- Branches: everyone in the company sees them; management keeps them.
drop policy if exists branches_select on public.branches;
create policy branches_select on public.branches for select to authenticated using (public.is_member(company_id));
drop policy if exists branches_insert on public.branches;
create policy branches_insert on public.branches for insert to authenticated with check (public.is_manager(company_id));
drop policy if exists branches_update on public.branches;
create policy branches_update on public.branches for update to authenticated
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));
drop policy if exists branches_delete on public.branches;
create policy branches_delete on public.branches for delete to authenticated using (public.is_manager(company_id));
grant insert (company_id, name, code, address, phone, manager_id) on public.branches to authenticated;
grant update (name, code, address, phone, manager_id, active) on public.branches to authenticated;
grant delete on public.branches to authenticated;
-- Stores: management chooses the branch (the store policies already allow only management).
grant update (branch_id) on public.warehouses to authenticated;

-- Approval steps: everyone sees them (so they know who approves); written by set_approval_steps().
drop policy if exists approval_steps_select on public.approval_steps;
create policy approval_steps_select on public.approval_steps for select to authenticated using (public.is_member(company_id));

-- Approvals of a purchase order: seen by those who see purchase orders; written by the functions.
drop policy if exists po_approvals_select on public.po_approvals;
create policy po_approvals_select on public.po_approvals for select to authenticated
  using (public.has_role(company_id, array['management', 'procurement', 'finance', 'warehouse']::public.app_role[]));

-- Scheduled reports: each person keeps their own.
drop policy if exists report_schedules_select on public.report_schedules;
create policy report_schedules_select on public.report_schedules for select to authenticated
  using (user_id = auth.uid() and public.is_member(company_id));
drop policy if exists report_schedules_insert on public.report_schedules;
create policy report_schedules_insert on public.report_schedules for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(company_id));
drop policy if exists report_schedules_update on public.report_schedules;
create policy report_schedules_update on public.report_schedules for update to authenticated
  using (user_id = auth.uid() and public.is_member(company_id)) with check (user_id = auth.uid() and public.is_member(company_id));
drop policy if exists report_schedules_delete on public.report_schedules;
create policy report_schedules_delete on public.report_schedules for delete to authenticated
  using (user_id = auth.uid() and public.is_member(company_id));
grant insert (company_id, name, report_key, query, frequency, weekday) on public.report_schedules to authenticated;
grant update (name, frequency, weekday, active) on public.report_schedules to authenticated;
grant delete on public.report_schedules to authenticated;

-- ---------------------------------------------------------------------
-- 5. Feature catalogue: branches, head-office reports, approval steps and
--    scheduled reports are live
-- ---------------------------------------------------------------------
update public.features set status = 'live', route = '/branches',
       tutorial = '[{"title":"Add branches","body":"Name each branch or business unit and choose its manager."},{"title":"Stores and staff","body":"Put each store and each person in a branch. What they make is counted for that branch."},{"title":"Move a document","body":"Management can move a quotation, invoice, order or expense to another branch."}]'
 where key = 'branches';
update public.features set status = 'live', route = '/head-office',
       tutorial = '[{"title":"All branches together","body":"Sales, profit, expenses, purchases, money owed and stock of every branch side by side."},{"title":"Any period","body":"Choose a month or your own dates and compare."},{"title":"Totals","body":"The total row is the whole company."}]'
 where key = 'consolidated_reports';
update public.features set status = 'live', route = '/approvals',
       tutorial = '[{"title":"Set the steps","body":"For example: finance checks every order, management approves orders above an amount."},{"title":"In order","body":"Each step is asked in turn and the next person is told when it is their turn."},{"title":"Four eyes","body":"Nobody approves their own order, and one person cannot approve two steps."}]'
 where key = 'advanced_approvals';
update public.features set status = 'live', route = '/scheduled-reports',
       tutorial = '[{"title":"Choose a report","body":"Open any report, set its filters and columns."},{"title":"Email it to me","body":"Choose every day, every week or every month."},{"title":"Arrives by itself","body":"You get an alert and an email with a link to the report for the period just ended."}]'
 where key = 'scheduled_reports';

-- ---------------------------------------------------------------------
-- 6. Demos: two branches, approval steps and a weekly report
-- ---------------------------------------------------------------------
create or replace function public.demo_seed_branches(p_company uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_hq uuid;
  v_ar uuid;
  v_store uuid;
begin
  if not exists (select 1 from public.companies where id = p_company and is_demo) then return; end if;
  select user_id into v_owner from public.memberships where company_id = p_company and role = 'management' and active
   order by created_at limit 1;
  insert into public.branches (company_id, name, code, address, phone, manager_id, created_by)
  values (p_company, 'Dar es Salaam (head office)', 'DSM', 'Nyerere Road, Dar es Salaam', '+255 22 286 0000', v_owner, v_owner)
  returning id into v_hq;
  insert into public.branches (company_id, name, code, address, phone, created_by)
  values (p_company, 'Arusha', 'ARU', 'Sokoine Road, Arusha', '+255 27 250 0000', v_owner)
  returning id into v_ar;

  update public.memberships set branch_id = v_hq where company_id = p_company;
  update public.warehouses set branch_id = v_hq where company_id = p_company;
  -- A small Arusha store with part of the stock.
  select id into v_store from public.warehouses where company_id = p_company and active order by created_at desc limit 1;
  if (select count(*) from public.warehouses where company_id = p_company) > 1 then
    update public.warehouses set branch_id = v_ar where id = v_store;
  end if;

  perform set_config('ims.status_change', 'on', true);
  update public.quotations set branch_id = case when abs(hashtext(id::text)) % 3 = 0 then v_ar else v_hq end where company_id = p_company;
  update public.invoices i set branch_id = coalesce((select q.branch_id from public.quotations q where q.id = i.quotation_id),
                                                    case when abs(hashtext(i.id::text)) % 3 = 0 then v_ar else v_hq end)
   where i.company_id = p_company;
  update public.purchase_orders set branch_id = case when abs(hashtext(id::text)) % 4 = 0 then v_ar else v_hq end where company_id = p_company;
  update public.expenses set branch_id = case when abs(hashtext(id::text)) % 3 = 0 then v_ar else v_hq end where company_id = p_company;
  perform set_config('ims.status_change', 'off', true);

  insert into public.approval_steps (company_id, doc_type, step, role, min_amount, label, updated_by)
  values (p_company, 'purchase_order', 1, 'finance', 5000000, 'Budget check', v_owner),
         (p_company, 'purchase_order', 2, 'management', 20000000, 'Director', v_owner)
  on conflict do nothing;

  insert into public.report_schedules (company_id, user_id, name, report_key, query, frequency, weekday)
  values (p_company, v_owner, 'Weekly sales by client', 'sales-by-client', '', 'weekly', 1);
end;
$$;

-- As in part 1, plus branches, approval steps and a scheduled report.
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
  perform public.demo_seed_branches(p_company);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
revoke execute on function
  public.prepare_branch(),
  public.fill_branch(),
  public.set_member_branch(uuid, uuid),
  public.set_document_branch(text, uuid, uuid),
  public.branch_summary(uuid, date, date),
  public.set_approval_steps(uuid, text, jsonb),
  public.submit_purchase_order(uuid),
  public.review_purchase_order(uuid, boolean, text),
  public.on_po_status(),
  public.run_report_schedules(),
  public.run_all_alerts(text),
  public.demo_seed_branches(uuid),
  public.demo_seed_stage15(uuid)
from public, anon;
revoke execute on function
  public.prepare_branch(),
  public.fill_branch(),
  public.on_po_status(),
  public.run_report_schedules(),
  public.demo_seed_branches(uuid),
  public.demo_seed_stage15(uuid)
from authenticated;
grant execute on function
  public.set_member_branch(uuid, uuid),
  public.set_document_branch(text, uuid, uuid),
  public.branch_summary(uuid, date, date),
  public.set_approval_steps(uuid, text, jsonb),
  public.submit_purchase_order(uuid),
  public.review_purchase_order(uuid, boolean, text)
to authenticated;
-- The scheduled job calls this with its secret (as since Stage 10).
grant execute on function public.run_all_alerts(text) to anon, authenticated;
