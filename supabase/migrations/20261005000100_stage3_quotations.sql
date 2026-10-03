-- =====================================================================
-- TRIUMPH IMS  ·  Stage 3: client RFQs, quotations and approvals
--
-- Flow:  RFQ (client request) → quotation (draft) → submit
--          → approved automatically, or waits for management approval
--          → sent to client → accepted / rejected
--        A sent or rejected quotation can be revised (R1, R2 …).
--
-- Approval is needed when a quotation is submitted by someone who is not
-- management AND any of these is true:
--   · margin is below the company's minimum (default 12%)
--   · a line has no known cost, so the margin can't be checked
--   · the total is above the approval limit (default TZS 25,000,000)
-- Nobody approves their own quotation.
--
-- Who can do what:
--   read RFQs and quotations: management, sales, procurement, finance
--   create and edit:          management, sales
--   approve / send back:      management
--   see margins and costs:    management, procurement, finance
-- =====================================================================

-- ---------------------------------------------------------------------
-- Company settings for quotations
-- ---------------------------------------------------------------------
alter table public.companies
  add column if not exists vat_rate             numeric(5, 2)  not null default 18   check (vat_rate between 0 and 100),
  add column if not exists quote_validity_days  integer        not null default 30   check (quote_validity_days between 1 and 365),
  add column if not exists quote_min_margin_pct numeric(5, 2)  not null default 12   check (quote_min_margin_pct between 0 and 100),
  add column if not exists quote_approval_above numeric(18, 2) not null default 25000000 check (quote_approval_above >= 0),
  add column if not exists quote_terms          text;

grant update (vat_rate, quote_validity_days, quote_min_margin_pct, quote_approval_above, quote_terms)
  on public.companies to authenticated;

-- ---------------------------------------------------------------------
-- Document numbers: RFQ-2026-0001, QT-2026-0001 (restart each year)
-- ---------------------------------------------------------------------
create or replace function public.assign_doc_number()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_year text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY');
  v_prefix text;
begin
  if coalesce(btrim(new.number), '') <> '' then
    return new;
  end if;
  v_prefix := case tg_table_name when 'rfqs' then 'RFQ-' else 'QT-' end || v_year || '-';
  new.number := public.next_code(new.company_id, tg_table_name || '-' || v_year, v_prefix, 4);
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- RFQs
-- ---------------------------------------------------------------------
create table public.rfqs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  number        text not null default '',
  client_id     uuid not null,
  title         text,
  contact_name  text,
  client_ref    text,
  received_via  text not null default 'email' check (received_via in ('email', 'phone', 'whatsapp', 'visit', 'tender', 'other')),
  received_on   date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  due_on        date,
  assigned_to   uuid references auth.users (id) on delete set null,
  status        text not null default 'new' check (status in ('new', 'quoting', 'quoted', 'won', 'lost', 'cancelled')),
  notes         text,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id)
);
create index rfqs_company_status_idx on public.rfqs (company_id, status, due_on);

create table public.rfq_lines (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  rfq_id      uuid not null,
  line_no     integer not null default 0,
  product_id  uuid,
  description text not null check (char_length(btrim(description)) > 0),
  quantity    numeric(18, 3) not null default 1 check (quantity > 0),
  unit        text not null default 'pcs',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (rfq_id, company_id) references public.rfqs (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id)
);
create index rfq_lines_rfq_idx on public.rfq_lines (rfq_id, line_no);

-- ---------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------
create table public.quotations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  number           text not null default '',
  revision         integer not null default 0 check (revision >= 0),
  rfq_id           uuid,
  client_id        uuid not null,
  contact_name     text,
  client_ref       text,
  status           text not null default 'draft'
                   check (status in ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'rejected',
                                     'superseded', 'cancelled')),
  currency         text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate    numeric(18, 6) not null default 1 check (exchange_rate > 0),
  issue_date       date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  valid_until      date,
  delivery_time    text,
  payment_terms    text,
  incoterms        text,
  vat_rate         numeric(5, 2) not null default 18 check (vat_rate between 0 and 100),
  notes            text,
  terms            text,
  subtotal         numeric(18, 2) not null default 0,
  discount_total   numeric(18, 2) not null default 0,
  vat_amount       numeric(18, 2) not null default 0,
  total            numeric(18, 2) not null default 0,
  approval_reason  text,
  review_note      text,
  submitted_at     timestamptz,
  submitted_by     uuid references auth.users (id) on delete set null,
  approved_at      timestamptz,
  approved_by      uuid references auth.users (id) on delete set null,
  sent_at          timestamptz,
  decided_at       timestamptz,
  outcome_reason   text,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, number, revision),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (rfq_id, company_id) references public.rfqs (id, company_id)
);
create index quotations_company_status_idx on public.quotations (company_id, status, created_at desc);

create table public.quotation_lines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  quotation_id  uuid not null,
  line_no       integer not null default 0,
  product_id    uuid,
  description   text not null check (char_length(btrim(description)) > 0),
  quantity      numeric(18, 3) not null default 1 check (quantity > 0),
  unit          text not null default 'pcs',
  unit_price    numeric(18, 2) not null default 0 check (unit_price >= 0),
  discount_pct  numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  line_total    numeric(18, 2) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id)
);
create index quotation_lines_q_idx on public.quotation_lines (quotation_id, line_no);

-- Margin worked out at submission. Kept apart so Sales never sees costs.
create table public.quotation_margins (
  quotation_id     uuid primary key,
  company_id       uuid not null references public.companies (id) on delete cascade,
  revenue_base     numeric(18, 2) not null default 0,   -- lines with a known cost, in base currency, before VAT
  cost_base        numeric(18, 2) not null default 0,
  margin_pct       numeric(7, 2),
  lines_without_cost integer not null default 0,
  calculated_at    timestamptz not null default now(),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create trigger rfqs_number       before insert on public.rfqs       for each row execute function public.assign_doc_number();
create trigger quotations_number before insert on public.quotations for each row execute function public.assign_doc_number();

-- Line numbers and line totals.
create or replace function public.prepare_line()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and coalesce(new.line_no, 0) = 0 then
    if tg_table_name = 'quotation_lines' then
      select coalesce(max(line_no), 0) + 1 into new.line_no from public.quotation_lines where quotation_id = new.quotation_id;
    else
      select coalesce(max(line_no), 0) + 1 into new.line_no from public.rfq_lines where rfq_id = new.rfq_id;
    end if;
  end if;
  if tg_table_name = 'quotation_lines' then
    new.line_total := round(new.quantity * new.unit_price * (1 - new.discount_pct / 100), 2);
  end if;
  return new;
end;
$$;
create trigger rfq_lines_prepare       before insert or update on public.rfq_lines       for each row execute function public.prepare_line();
create trigger quotation_lines_prepare before insert or update on public.quotation_lines for each row execute function public.prepare_line();

-- Quotation lines can only change while the quotation is a draft.
create or replace function public.guard_quotation_lines()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.quotations where id = coalesce(new.quotation_id, old.quotation_id);
  if v_status is distinct from 'draft' and current_setting('ims.allow_line_copy', true) is distinct from 'on' then
    raise exception 'Only draft quotations can be changed. Create a revision instead.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger quotation_lines_guard before insert or update or delete on public.quotation_lines
  for each row execute function public.guard_quotation_lines();

-- After any line change, touch the quotation so its totals are recalculated.
create or replace function public.touch_quotation()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.quotations set updated_at = now() where id = coalesce(new.quotation_id, old.quotation_id);
  return null;
end;
$$;
create trigger quotation_lines_touch after insert or update or delete on public.quotation_lines
  for each row execute function public.touch_quotation();

-- Header: totals always recalculated from the lines; only drafts editable.
create or replace function public.prepare_quotation()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_gross numeric;
  v_net numeric;
begin
  if tg_op = 'UPDATE' and old.status <> 'draft'
     and current_setting('ims.status_change', true) is distinct from 'on'
     and (new.client_id, new.rfq_id, new.contact_name, new.client_ref, new.currency, new.exchange_rate,
          new.issue_date, new.valid_until, new.delivery_time, new.payment_terms, new.incoterms, new.vat_rate,
          new.notes, new.terms)
         is distinct from
         (old.client_id, old.rfq_id, old.contact_name, old.client_ref, old.currency, old.exchange_rate,
          old.issue_date, old.valid_until, old.delivery_time, old.payment_terms, old.incoterms, old.vat_rate,
          old.notes, old.terms) then
    raise exception 'Only draft quotations can be changed. Create a revision instead.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(sum(round(quantity * unit_price, 2)), 0), coalesce(sum(line_total), 0)
      into v_gross, v_net
      from public.quotation_lines where quotation_id = new.id;
  else
    v_gross := 0;
    v_net := 0;
  end if;
  new.subtotal := v_net;
  new.discount_total := v_gross - v_net;
  new.vat_amount := round(v_net * new.vat_rate / 100, 2);
  new.total := new.subtotal + new.vat_amount;
  return new;
end;
$$;
create trigger quotations_prepare before insert or update on public.quotations
  for each row execute function public.prepare_quotation();

-- RFQ and quotation status may only change through the functions below.
create or replace function public.guard_status()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.status is distinct from old.status and current_setting('ims.status_change', true) is distinct from 'on' then
    if tg_table_name = 'rfqs' and new.status = 'cancelled' then
      return new;  -- cancelling an RFQ by hand is allowed
    end if;
    raise exception 'Use the buttons in the app to change the status.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger rfqs_status_guard       before update on public.rfqs       for each row execute function public.guard_status();
create trigger quotations_status_guard before update on public.quotations for each row execute function public.guard_status();

create trigger rfqs_touch            before update on public.rfqs            for each row execute function public.touch_updated_at();
create trigger rfq_lines_touch       before update on public.rfq_lines       for each row execute function public.touch_updated_at();
create trigger quotation_lines_touch2 before update on public.quotation_lines for each row execute function public.touch_updated_at();

create trigger rfqs_keep_company            before update on public.rfqs            for each row execute function public.keep_company();
create trigger rfq_lines_keep_company       before update on public.rfq_lines       for each row execute function public.keep_company();
create trigger quotations_keep_company      before update on public.quotations      for each row execute function public.keep_company();
create trigger quotation_lines_keep_company before update on public.quotation_lines for each row execute function public.keep_company();

create trigger rfqs_audit            after insert or update on public.rfqs                      for each row execute function public.audit_row();
create trigger rfq_lines_audit       after insert or update or delete on public.rfq_lines       for each row execute function public.audit_row();
create trigger quotations_audit      after insert or update on public.quotations                for each row execute function public.audit_row();
create trigger quotation_lines_audit after insert or update or delete on public.quotation_lines for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.rfqs              enable row level security;
alter table public.rfq_lines         enable row level security;
alter table public.quotations        enable row level security;
alter table public.quotation_lines   enable row level security;
alter table public.quotation_margins enable row level security;

create policy rfqs_select on public.rfqs for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'procurement', 'finance']::public.app_role[]));
create policy rfqs_insert on public.rfqs for insert to authenticated
  with check (public.has_role(company_id, array['management', 'sales']::public.app_role[]));
create policy rfqs_update on public.rfqs for update to authenticated
  using (public.has_role(company_id, array['management', 'sales']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'sales']::public.app_role[]));

create policy rfq_lines_select on public.rfq_lines for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'procurement', 'finance']::public.app_role[]));
create policy rfq_lines_write on public.rfq_lines for all to authenticated
  using (public.has_role(company_id, array['management', 'sales']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'sales']::public.app_role[]));

create policy quotations_select on public.quotations for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'procurement', 'finance']::public.app_role[]));
create policy quotations_insert on public.quotations for insert to authenticated
  with check (public.has_role(company_id, array['management', 'sales']::public.app_role[]) and status = 'draft');
create policy quotations_update on public.quotations for update to authenticated
  using (public.has_role(company_id, array['management', 'sales']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'sales']::public.app_role[]));

create policy quotation_lines_select on public.quotation_lines for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'procurement', 'finance']::public.app_role[]));
create policy quotation_lines_write on public.quotation_lines for all to authenticated
  using (public.has_role(company_id, array['management', 'sales']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'sales']::public.app_role[]));

create policy quotation_margins_select on public.quotation_margins for select to authenticated
  using (public.has_role(company_id, array['management', 'procurement', 'finance']::public.app_role[]));

revoke all on public.rfqs, public.rfq_lines, public.quotations, public.quotation_lines, public.quotation_margins
  from anon, authenticated;
grant select, insert, delete on public.rfq_lines, public.quotation_lines to authenticated;
grant update (product_id, description, quantity, unit, notes, line_no) on public.rfq_lines to authenticated;
grant update (product_id, description, quantity, unit, unit_price, discount_pct, line_no) on public.quotation_lines to authenticated;
grant select, insert on public.rfqs to authenticated;
grant update (client_id, title, contact_name, client_ref, received_via, received_on, due_on, assigned_to, status, notes)
  on public.rfqs to authenticated;
grant select on public.quotations to authenticated;
grant insert (company_id, rfq_id, client_id, contact_name, client_ref, currency, exchange_rate, issue_date,
              valid_until, delivery_time, payment_terms, incoterms, vat_rate, notes, terms)
  on public.quotations to authenticated;
grant update (client_id, rfq_id, contact_name, client_ref, currency, exchange_rate, issue_date, valid_until,
              delivery_time, payment_terms, incoterms, vat_rate, notes, terms)
  on public.quotations to authenticated;
grant select on public.quotation_margins to authenticated;

-- ---------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------

-- New draft quotation for a client, with the company's defaults.
create or replace function public.create_quotation(p_company uuid, p_client uuid, p_rfq uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_client public.clients;
  v_company public.companies;
  v_id uuid;
  v_vat numeric;
  r record;
begin
  if not public.has_role(p_company, array['management', 'sales']::public.app_role[]) then
    raise exception 'Only management and sales can create quotations.' using errcode = '42501';
  end if;
  select * into v_company from public.companies where id = p_company;
  select * into v_client from public.clients where id = p_client and company_id = p_company;
  if v_client.id is null then
    raise exception 'Client not found.' using errcode = '22023';
  end if;
  if p_rfq is not null and not exists (select 1 from public.rfqs where id = p_rfq and company_id = p_company and client_id = p_client) then
    raise exception 'That RFQ belongs to a different client.' using errcode = '22023';
  end if;

  v_vat := case when v_client.tax_status in ('Exempt', 'Zero-rated') then 0 else v_company.vat_rate end;

  insert into public.quotations (company_id, rfq_id, client_id, contact_name, client_ref, currency, exchange_rate,
                                 valid_until, payment_terms, vat_rate, terms, created_by)
  select p_company, p_rfq, p_client, r2.contact_name, r2.client_ref, v_client.currency, 1,
         (now() at time zone 'Africa/Dar_es_Salaam')::date + v_company.quote_validity_days,
         v_client.payment_terms, v_vat, v_company.quote_terms, auth.uid()
  from (select (select contact_name from public.rfqs where id = p_rfq) as contact_name,
               (select client_ref from public.rfqs where id = p_rfq) as client_ref) r2
  returning id into v_id;

  if p_rfq is not null then
    -- Copy the requested items; prices start from the catalogue (base currency).
    for r in select l.*, p.selling_price from public.rfq_lines l
             left join public.products p on p.id = l.product_id
             where l.rfq_id = p_rfq order by l.line_no loop
      insert into public.quotation_lines (company_id, quotation_id, line_no, product_id, description, quantity, unit, unit_price)
      values (p_company, v_id, r.line_no, r.product_id, r.description, r.quantity, r.unit, coalesce(r.selling_price, 0));
    end loop;
    perform set_config('ims.status_change', 'on', true);
    update public.rfqs set status = 'quoting' where id = p_rfq and status = 'new';
    perform set_config('ims.status_change', 'off', true);
  end if;
  return v_id;
end;
$$;

-- Submit a draft: works out the margin and decides whether approval is needed.
create or replace function public.submit_quotation(p_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  q public.quotations;
  c public.companies;
  v_rev numeric := 0;
  v_cost numeric := 0;
  v_missing int := 0;
  v_lines int := 0;
  v_margin numeric;
  v_reasons text[] := '{}';
  v_status text;
begin
  select * into q from public.quotations where id = p_id;
  if q.id is null or not public.has_role(q.company_id, array['management', 'sales']::public.app_role[]) then
    raise exception 'Quotation not found.' using errcode = '42501';
  end if;
  if q.status <> 'draft' then
    raise exception 'Only a draft can be submitted.' using errcode = '22023';
  end if;
  select * into c from public.companies where id = q.company_id;

  select count(*),
         count(*) filter (where pc.last_cost is null),
         coalesce(sum(l.line_total * q.exchange_rate) filter (where pc.last_cost is not null), 0),
         coalesce(sum(l.quantity * pc.last_cost) filter (where pc.last_cost is not null), 0)
    into v_lines, v_missing, v_rev, v_cost
    from public.quotation_lines l
    left join public.product_costs pc on pc.product_id = l.product_id
   where l.quotation_id = p_id;

  if v_lines = 0 then
    raise exception 'Add at least one line before submitting.' using errcode = '22023';
  end if;
  if q.total <= 0 then
    raise exception 'The quotation total is zero. Check the prices.' using errcode = '22023';
  end if;

  v_margin := case when v_rev > 0 then round((v_rev - v_cost) / v_rev * 100, 2) end;

  insert into public.quotation_margins (quotation_id, company_id, revenue_base, cost_base, margin_pct, lines_without_cost, calculated_at)
  values (p_id, q.company_id, v_rev, v_cost, v_margin, v_missing, now())
  on conflict (quotation_id) do update set revenue_base = excluded.revenue_base, cost_base = excluded.cost_base,
    margin_pct = excluded.margin_pct, lines_without_cost = excluded.lines_without_cost, calculated_at = now();

  if v_margin is not null and v_margin < c.quote_min_margin_pct then
    v_reasons := v_reasons || format('margin below %s%%', trim(to_char(c.quote_min_margin_pct, 'FM990.##')));
  end if;
  if v_missing > 0 then
    v_reasons := v_reasons || format('%s line(s) without a known cost', v_missing);
  end if;
  if q.total * q.exchange_rate > c.quote_approval_above then
    v_reasons := v_reasons || 'value above the approval limit'::text;
  end if;

  perform set_config('ims.status_change', 'on', true);
  if cardinality(v_reasons) = 0 or public.is_manager(q.company_id) then
    v_status := 'approved';
    update public.quotations
       set status = 'approved', submitted_at = now(), submitted_by = auth.uid(),
           approved_at = now(), approved_by = case when cardinality(v_reasons) > 0 then auth.uid() end,
           approval_reason = nullif(array_to_string(v_reasons, '; '), ''), review_note = null
     where id = p_id;
  else
    v_status := 'pending_approval';
    update public.quotations
       set status = 'pending_approval', submitted_at = now(), submitted_by = auth.uid(),
           approval_reason = array_to_string(v_reasons, '; '), review_note = null
     where id = p_id;
  end if;
  perform set_config('ims.status_change', 'off', true);
  return v_status;
end;
$$;

-- Management decision on a quotation waiting for approval.
create or replace function public.review_quotation(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  q public.quotations;
begin
  select * into q from public.quotations where id = p_id;
  if q.id is null or not public.is_manager(q.company_id) then
    raise exception 'Only management can approve quotations.' using errcode = '42501';
  end if;
  if q.status <> 'pending_approval' then
    raise exception 'This quotation is not waiting for approval.' using errcode = '22023';
  end if;
  if q.submitted_by = auth.uid() then
    raise exception 'You cannot approve a quotation you submitted yourself.' using errcode = '42501';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'Please say what needs to change.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  if p_approve then
    update public.quotations set status = 'approved', approved_at = now(), approved_by = auth.uid(),
           review_note = nullif(btrim(p_note), '') where id = p_id;
  else
    update public.quotations set status = 'draft', review_note = btrim(p_note) where id = p_id;
  end if;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Mark as sent to the client.
create or replace function public.mark_quotation_sent(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  q public.quotations;
begin
  select * into q from public.quotations where id = p_id;
  if q.id is null or not public.has_role(q.company_id, array['management', 'sales']::public.app_role[]) then
    raise exception 'Quotation not found.' using errcode = '42501';
  end if;
  if q.status not in ('approved', 'sent') then
    raise exception 'Only an approved quotation can be sent.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.quotations set status = 'sent', sent_at = coalesce(sent_at, now()) where id = p_id;
  update public.rfqs set status = 'quoted' where id = q.rfq_id and status in ('new', 'quoting');
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Client's answer.
create or replace function public.record_quotation_outcome(p_id uuid, p_accepted boolean, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  q public.quotations;
begin
  select * into q from public.quotations where id = p_id;
  if q.id is null or not public.has_role(q.company_id, array['management', 'sales']::public.app_role[]) then
    raise exception 'Quotation not found.' using errcode = '42501';
  end if;
  if q.status not in ('approved', 'sent') then
    raise exception 'Only an approved or sent quotation can be accepted or rejected.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.quotations
     set status = case when p_accepted then 'accepted' else 'rejected' end,
         decided_at = now(), outcome_reason = nullif(btrim(p_reason), ''),
         sent_at = coalesce(sent_at, now())
   where id = p_id;
  if q.rfq_id is not null then
    if p_accepted then
      update public.rfqs set status = 'won' where id = q.rfq_id;
    elsif not exists (select 1 from public.quotations where rfq_id = q.rfq_id and id <> p_id
                      and status in ('draft', 'pending_approval', 'approved', 'sent', 'accepted')) then
      update public.rfqs set status = 'lost' where id = q.rfq_id;
    end if;
  end if;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Copy a quotation into a new draft revision (R1, R2 …); the old one is superseded.
create or replace function public.revise_quotation(p_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  q public.quotations;
  v_id uuid;
  v_rev int;
begin
  select * into q from public.quotations where id = p_id;
  if q.id is null or not public.has_role(q.company_id, array['management', 'sales']::public.app_role[]) then
    raise exception 'Quotation not found.' using errcode = '42501';
  end if;
  if q.status not in ('pending_approval', 'approved', 'sent', 'rejected') then
    raise exception 'This quotation cannot be revised.' using errcode = '22023';
  end if;
  select max(revision) + 1 into v_rev from public.quotations where company_id = q.company_id and number = q.number;

  insert into public.quotations (company_id, number, revision, rfq_id, client_id, contact_name, client_ref, currency,
         exchange_rate, valid_until, delivery_time, payment_terms, incoterms, vat_rate, notes, terms, created_by)
  values (q.company_id, q.number, v_rev, q.rfq_id, q.client_id, q.contact_name, q.client_ref, q.currency,
         q.exchange_rate, greatest(q.valid_until, (now() at time zone 'Africa/Dar_es_Salaam')::date), q.delivery_time,
         q.payment_terms, q.incoterms, q.vat_rate, q.notes, q.terms, auth.uid())
  returning id into v_id;

  insert into public.quotation_lines (company_id, quotation_id, line_no, product_id, description, quantity, unit,
                                      unit_price, discount_pct)
  select company_id, v_id, line_no, product_id, description, quantity, unit, unit_price, discount_pct
    from public.quotation_lines where quotation_id = p_id;

  perform set_config('ims.status_change', 'on', true);
  update public.quotations set status = 'superseded' where id = p_id;
  perform set_config('ims.status_change', 'off', true);
  return v_id;
end;
$$;

create or replace function public.cancel_quotation(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  q public.quotations;
begin
  select * into q from public.quotations where id = p_id;
  if q.id is null or not public.has_role(q.company_id, array['management', 'sales']::public.app_role[]) then
    raise exception 'Quotation not found.' using errcode = '42501';
  end if;
  if q.status in ('accepted', 'superseded', 'cancelled') then
    raise exception 'This quotation can no longer be cancelled.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.quotations set status = 'cancelled' where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

revoke execute on function
  public.create_quotation(uuid, uuid, uuid), public.submit_quotation(uuid), public.review_quotation(uuid, boolean, text),
  public.mark_quotation_sent(uuid), public.record_quotation_outcome(uuid, boolean, text), public.revise_quotation(uuid),
  public.cancel_quotation(uuid)
from public, anon;
grant execute on function
  public.create_quotation(uuid, uuid, uuid), public.submit_quotation(uuid), public.review_quotation(uuid, boolean, text),
  public.mark_quotation_sent(uuid), public.record_quotation_outcome(uuid, boolean, text), public.revise_quotation(uuid),
  public.cancel_quotation(uuid)
to authenticated;

notify pgrst, 'reload schema';
