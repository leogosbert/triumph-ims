-- =====================================================================
-- TRIUMPH IMS  ·  Stage 4: supplier RFQs, comparison, purchase orders
--
-- Flow:  supplier RFQ (from a client RFQ, an accepted quotation, or
--        from scratch) → invite suppliers → record their prices →
--        compare → award one supplier → draft purchase order
--        PO → submit → approved (or waits for management) → sent →
--        confirmed by supplier (updates product costs) → received in
--        Stage 5.
--
-- PO approval: a PO submitted by someone who is not management needs
-- management approval when its total (in base currency) is above the
-- company's limit (default TZS 2,500,000). Nobody approves their own PO.
--
-- Who can do what:
--   supplier RFQs:   management, procurement (read and edit)
--   purchase orders: read management, procurement, finance, warehouse
--                    edit management, procurement; approve management
-- =====================================================================

alter table public.companies
  add column if not exists po_approval_above numeric(18, 2) not null default 2500000 check (po_approval_above >= 0),
  add column if not exists po_terms text;
grant update (po_approval_above, po_terms) on public.companies to authenticated;

-- Numbering now also covers supplier RFQs and purchase orders.
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
  v_prefix := case tg_table_name
                when 'rfqs' then 'RFQ-'
                when 'quotations' then 'QT-'
                when 'supplier_rfqs' then 'SRFQ-'
                when 'purchase_orders' then 'PO-'
                else 'DOC-' end || v_year || '-';
  new.number := public.next_code(new.company_id, tg_table_name || '-' || v_year, v_prefix, 4);
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Supplier RFQs
-- ---------------------------------------------------------------------
create table public.supplier_rfqs (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  number               text not null default '',
  rfq_id               uuid,
  quotation_id         uuid,
  title                text,
  due_on               date,
  delivery_location    text,
  notes                text,
  status               text not null default 'open' check (status in ('open', 'awarded', 'cancelled')),
  awarded_supplier_id  uuid,
  created_by           uuid default auth.uid() references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  foreign key (rfq_id, company_id) references public.rfqs (id, company_id),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id),
  foreign key (awarded_supplier_id, company_id) references public.suppliers (id, company_id)
);

create table public.supplier_rfq_lines (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  srfq_id      uuid not null,
  line_no      integer not null default 0,
  product_id   uuid,
  description  text not null check (char_length(btrim(description)) > 0),
  quantity     numeric(18, 3) not null default 1 check (quantity > 0),
  unit         text not null default 'pcs',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (id, company_id),
  foreign key (srfq_id, company_id) references public.supplier_rfqs (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id)
);
create index supplier_rfq_lines_idx on public.supplier_rfq_lines (srfq_id, line_no);

-- Each supplier asked, with their answer (one quote per supplier).
create table public.supplier_rfq_suppliers (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  srfq_id         uuid not null,
  supplier_id     uuid not null,
  status          text not null default 'invited' check (status in ('invited', 'quoted', 'declined')),
  currency        text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate   numeric(18, 6) not null default 1 check (exchange_rate > 0),
  lead_time_days  integer check (lead_time_days is null or lead_time_days between 0 and 730),
  payment_terms   text,
  incoterms       text,
  freight         numeric(18, 2) not null default 0 check (freight >= 0),
  valid_until     date,
  supplier_ref    text,
  notes           text,
  received_on     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (srfq_id, supplier_id),
  unique (id, company_id),
  foreign key (srfq_id, company_id) references public.supplier_rfqs (id, company_id) on delete cascade,
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id)
);

create table public.supplier_quote_lines (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  srfq_supplier_id  uuid not null,
  srfq_line_id      uuid not null,
  unit_price        numeric(18, 2) check (unit_price is null or unit_price >= 0),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (srfq_supplier_id, srfq_line_id),
  foreign key (srfq_supplier_id, company_id) references public.supplier_rfq_suppliers (id, company_id) on delete cascade,
  foreign key (srfq_line_id, company_id) references public.supplier_rfq_lines (id, company_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------
create table public.purchase_orders (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  number                 text not null default '',
  supplier_id            uuid not null,
  srfq_id                uuid,
  quotation_id           uuid,
  status                 text not null default 'draft'
                         check (status in ('draft', 'pending_approval', 'approved', 'sent', 'confirmed',
                                           'partially_received', 'received', 'closed', 'cancelled')),
  currency               text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate          numeric(18, 6) not null default 1 check (exchange_rate > 0),
  order_date             date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  expected_date          date,
  delivery_location      text,
  payment_terms          text,
  incoterms              text,
  supplier_ref           text,
  shipping_instructions  text,
  notes                  text,
  terms                  text,
  freight                numeric(18, 2) not null default 0 check (freight >= 0),
  vat_rate               numeric(5, 2) not null default 0 check (vat_rate between 0 and 100),
  subtotal               numeric(18, 2) not null default 0,
  vat_amount             numeric(18, 2) not null default 0,
  total                  numeric(18, 2) not null default 0,
  approval_reason        text,
  review_note            text,
  submitted_at           timestamptz,
  submitted_by           uuid references auth.users (id) on delete set null,
  approved_at            timestamptz,
  approved_by            uuid references auth.users (id) on delete set null,
  sent_at                timestamptz,
  confirmed_at           timestamptz,
  created_by             uuid default auth.uid() references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id),
  foreign key (srfq_id, company_id) references public.supplier_rfqs (id, company_id),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id)
);
create index purchase_orders_company_status_idx on public.purchase_orders (company_id, status, created_at desc);

create table public.po_lines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  po_id         uuid not null,
  line_no       integer not null default 0,
  product_id    uuid,
  description   text not null check (char_length(btrim(description)) > 0),
  quantity      numeric(18, 3) not null default 1 check (quantity > 0),
  unit          text not null default 'pcs',
  unit_price    numeric(18, 2) not null default 0 check (unit_price >= 0),
  line_total    numeric(18, 2) not null default 0,
  received_qty  numeric(18, 3) not null default 0 check (received_qty >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, company_id),
  foreign key (po_id, company_id) references public.purchase_orders (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id)
);
create index po_lines_po_idx on public.po_lines (po_id, line_no);

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create trigger supplier_rfqs_number   before insert on public.supplier_rfqs   for each row execute function public.assign_doc_number();
create trigger purchase_orders_number before insert on public.purchase_orders for each row execute function public.assign_doc_number();

create or replace function public.prepare_purchasing_line()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and coalesce(new.line_no, 0) = 0 then
    if tg_table_name = 'po_lines' then
      select coalesce(max(line_no), 0) + 1 into new.line_no from public.po_lines where po_id = new.po_id;
    else
      select coalesce(max(line_no), 0) + 1 into new.line_no from public.supplier_rfq_lines where srfq_id = new.srfq_id;
    end if;
  end if;
  if tg_table_name = 'po_lines' then
    new.line_total := round(new.quantity * new.unit_price, 2);
  end if;
  return new;
end;
$$;
create trigger supplier_rfq_lines_prepare before insert or update on public.supplier_rfq_lines
  for each row execute function public.prepare_purchasing_line();
create trigger po_lines_prepare before insert or update on public.po_lines
  for each row execute function public.prepare_purchasing_line();

-- PO lines change only while the PO is a draft (received quantities are
-- updated by the Stage 5 receiving functions).
create or replace function public.guard_po_lines()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
begin
  if current_setting('ims.status_change', true) = 'on' then
    return coalesce(new, old);
  end if;
  select status into v_status from public.purchase_orders where id = coalesce(new.po_id, old.po_id);
  if v_status is distinct from 'draft' then
    raise exception 'Only draft purchase orders can be changed.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger po_lines_guard before insert or update or delete on public.po_lines
  for each row execute function public.guard_po_lines();

create or replace function public.touch_po()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.purchase_orders set updated_at = now() where id = coalesce(new.po_id, old.po_id);
  return null;
end;
$$;
create trigger po_lines_touch after insert or update or delete on public.po_lines
  for each row execute function public.touch_po();

create or replace function public.prepare_po()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status <> 'draft'
     and current_setting('ims.status_change', true) is distinct from 'on'
     and (new.supplier_id, new.srfq_id, new.quotation_id, new.currency, new.exchange_rate, new.order_date,
          new.expected_date, new.delivery_location, new.payment_terms, new.incoterms, new.supplier_ref,
          new.shipping_instructions, new.notes, new.terms, new.freight, new.vat_rate)
         is distinct from
         (old.supplier_id, old.srfq_id, old.quotation_id, old.currency, old.exchange_rate, old.order_date,
          old.expected_date, old.delivery_location, old.payment_terms, old.incoterms, old.supplier_ref,
          old.shipping_instructions, old.notes, old.terms, old.freight, old.vat_rate) then
    raise exception 'Only draft purchase orders can be changed.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(sum(line_total), 0) into new.subtotal from public.po_lines where po_id = new.id;
  else
    new.subtotal := 0;
  end if;
  new.vat_amount := round((new.subtotal + new.freight) * new.vat_rate / 100, 2);
  new.total := new.subtotal + new.freight + new.vat_amount;
  return new;
end;
$$;
create trigger purchase_orders_prepare before insert or update on public.purchase_orders
  for each row execute function public.prepare_po();

create trigger purchase_orders_status_guard before update on public.purchase_orders
  for each row execute function public.guard_status();

create trigger supplier_rfqs_touch          before update on public.supplier_rfqs          for each row execute function public.touch_updated_at();
create trigger supplier_rfq_lines_touch     before update on public.supplier_rfq_lines     for each row execute function public.touch_updated_at();
create trigger supplier_rfq_suppliers_touch before update on public.supplier_rfq_suppliers for each row execute function public.touch_updated_at();
create trigger supplier_quote_lines_touch   before update on public.supplier_quote_lines   for each row execute function public.touch_updated_at();
create trigger po_lines_touch2              before update on public.po_lines               for each row execute function public.touch_updated_at();

create trigger supplier_rfqs_keep          before update on public.supplier_rfqs          for each row execute function public.keep_company();
create trigger supplier_rfq_lines_keep     before update on public.supplier_rfq_lines     for each row execute function public.keep_company();
create trigger supplier_rfq_suppliers_keep before update on public.supplier_rfq_suppliers for each row execute function public.keep_company();
create trigger supplier_quote_lines_keep   before update on public.supplier_quote_lines   for each row execute function public.keep_company();
create trigger purchase_orders_keep        before update on public.purchase_orders        for each row execute function public.keep_company();
create trigger po_lines_keep               before update on public.po_lines               for each row execute function public.keep_company();

create trigger supplier_rfqs_audit          after insert or update on public.supplier_rfqs                      for each row execute function public.audit_row();
create trigger supplier_rfq_suppliers_audit after insert or update or delete on public.supplier_rfq_suppliers  for each row execute function public.audit_row();
create trigger purchase_orders_audit        after insert or update on public.purchase_orders                    for each row execute function public.audit_row();
create trigger po_lines_audit               after insert or update or delete on public.po_lines                 for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.supplier_rfqs          enable row level security;
alter table public.supplier_rfq_lines     enable row level security;
alter table public.supplier_rfq_suppliers enable row level security;
alter table public.supplier_quote_lines   enable row level security;
alter table public.purchase_orders        enable row level security;
alter table public.po_lines               enable row level security;

create policy supplier_rfqs_all on public.supplier_rfqs for all to authenticated
  using (public.has_role(company_id, array['management', 'procurement']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'procurement']::public.app_role[]));
create policy supplier_rfq_lines_all on public.supplier_rfq_lines for all to authenticated
  using (public.has_role(company_id, array['management', 'procurement']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'procurement']::public.app_role[]));
create policy supplier_rfq_suppliers_all on public.supplier_rfq_suppliers for all to authenticated
  using (public.has_role(company_id, array['management', 'procurement']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'procurement']::public.app_role[]));
create policy supplier_quote_lines_all on public.supplier_quote_lines for all to authenticated
  using (public.has_role(company_id, array['management', 'procurement']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'procurement']::public.app_role[]));

create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (public.has_role(company_id, array['management', 'procurement', 'finance', 'warehouse']::public.app_role[]));
create policy purchase_orders_insert on public.purchase_orders for insert to authenticated
  with check (public.has_role(company_id, array['management', 'procurement']::public.app_role[]) and status = 'draft');
create policy purchase_orders_update on public.purchase_orders for update to authenticated
  using (public.has_role(company_id, array['management', 'procurement']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'procurement']::public.app_role[]));

create policy po_lines_select on public.po_lines for select to authenticated
  using (public.has_role(company_id, array['management', 'procurement', 'finance', 'warehouse']::public.app_role[]));
create policy po_lines_write on public.po_lines for all to authenticated
  using (public.has_role(company_id, array['management', 'procurement']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'procurement']::public.app_role[]));

revoke all on public.supplier_rfqs, public.supplier_rfq_lines, public.supplier_rfq_suppliers, public.supplier_quote_lines,
              public.purchase_orders, public.po_lines from anon, authenticated;
grant select, insert, update, delete on public.supplier_rfq_lines, public.supplier_rfq_suppliers,
                                        public.supplier_quote_lines to authenticated;
grant select, insert on public.supplier_rfqs to authenticated;
grant update (rfq_id, quotation_id, title, due_on, delivery_location, notes, status) on public.supplier_rfqs to authenticated;
grant select on public.purchase_orders to authenticated;
grant insert (company_id, supplier_id, srfq_id, quotation_id, currency, exchange_rate, order_date, expected_date,
              delivery_location, payment_terms, incoterms, supplier_ref, shipping_instructions, notes, terms, freight, vat_rate)
  on public.purchase_orders to authenticated;
grant update (supplier_id, currency, exchange_rate, order_date, expected_date, delivery_location, payment_terms,
              incoterms, supplier_ref, shipping_instructions, notes, terms, freight, vat_rate)
  on public.purchase_orders to authenticated;
grant select, insert, delete on public.po_lines to authenticated;
grant update (product_id, description, quantity, unit, unit_price, line_no) on public.po_lines to authenticated;

-- ---------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------

-- New supplier RFQ, copying the items from an accepted/any quotation or a client RFQ.
create or replace function public.create_supplier_rfq(p_company uuid, p_rfq uuid, p_quotation uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_title text;
begin
  if not public.has_role(p_company, array['management', 'procurement']::public.app_role[]) then
    raise exception 'Only management and procurement can request supplier quotes.' using errcode = '42501';
  end if;
  if p_quotation is not null then
    select coalesce(r.title, 'For ' || c.name), coalesce(p_rfq, q.rfq_id) into v_title, p_rfq
      from public.quotations q join public.clients c on c.id = q.client_id
      left join public.rfqs r on r.id = q.rfq_id
     where q.id = p_quotation and q.company_id = p_company;
    if not found then raise exception 'Quotation not found.' using errcode = '22023'; end if;
  elsif p_rfq is not null then
    select coalesce(r.title, 'For ' || c.name) into v_title
      from public.rfqs r join public.clients c on c.id = r.client_id
     where r.id = p_rfq and r.company_id = p_company;
    if not found then raise exception 'RFQ not found.' using errcode = '22023'; end if;
  end if;

  insert into public.supplier_rfqs (company_id, rfq_id, quotation_id, title, due_on, created_by)
  values (p_company, p_rfq, p_quotation, v_title,
          (now() at time zone 'Africa/Dar_es_Salaam')::date + 3, auth.uid())
  returning id into v_id;

  if p_quotation is not null then
    insert into public.supplier_rfq_lines (company_id, srfq_id, line_no, product_id, description, quantity, unit)
    select p_company, v_id, line_no, product_id, description, quantity, unit
      from public.quotation_lines where quotation_id = p_quotation;
  elsif p_rfq is not null then
    insert into public.supplier_rfq_lines (company_id, srfq_id, line_no, product_id, description, quantity, unit)
    select p_company, v_id, line_no, product_id, description, quantity, unit
      from public.rfq_lines where rfq_id = p_rfq;
  end if;
  return v_id;
end;
$$;

-- Award a supplier RFQ to one supplier and create a draft PO from their prices.
create or replace function public.award_supplier_rfq(p_srfq_supplier uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s public.supplier_rfq_suppliers;
  r public.supplier_rfqs;
  sup public.suppliers;
  c public.companies;
  v_po uuid;
  v_count int;
begin
  select * into s from public.supplier_rfq_suppliers where id = p_srfq_supplier;
  if s.id is null or not public.has_role(s.company_id, array['management', 'procurement']::public.app_role[]) then
    raise exception 'Supplier quote not found.' using errcode = '42501';
  end if;
  select * into r from public.supplier_rfqs where id = s.srfq_id;
  if r.status <> 'open' then
    raise exception 'This supplier RFQ is already %.', r.status using errcode = '22023';
  end if;
  select count(*) into v_count from public.supplier_quote_lines where srfq_supplier_id = s.id and unit_price is not null;
  if v_count = 0 then
    raise exception 'Record this supplier''s prices before awarding.' using errcode = '22023';
  end if;
  select * into sup from public.suppliers where id = s.supplier_id;
  select * into c from public.companies where id = s.company_id;

  insert into public.purchase_orders (company_id, supplier_id, srfq_id, quotation_id, currency, exchange_rate,
         expected_date, delivery_location, payment_terms, incoterms, supplier_ref, freight, vat_rate, terms, created_by)
  values (s.company_id, s.supplier_id, r.id, r.quotation_id, s.currency, s.exchange_rate,
         case when s.lead_time_days is not null then (now() at time zone 'Africa/Dar_es_Salaam')::date + s.lead_time_days end,
         r.delivery_location, coalesce(s.payment_terms, sup.payment_terms), coalesce(s.incoterms, sup.incoterms),
         s.supplier_ref, s.freight,
         case when coalesce(lower(sup.country), 'tanzania') in ('tanzania', 'tz') then c.vat_rate else 0 end,
         c.po_terms, auth.uid())
  returning id into v_po;

  insert into public.po_lines (company_id, po_id, line_no, product_id, description, quantity, unit, unit_price)
  select s.company_id, v_po, l.line_no, l.product_id, l.description, l.quantity, l.unit, ql.unit_price
    from public.supplier_rfq_lines l
    join public.supplier_quote_lines ql on ql.srfq_line_id = l.id and ql.srfq_supplier_id = s.id
   where ql.unit_price is not null
   order by l.line_no;

  update public.supplier_rfqs set status = 'awarded', awarded_supplier_id = s.supplier_id where id = r.id;
  return v_po;
end;
$$;

-- New draft PO for a supplier, optionally copying an accepted client quotation's items at last known cost.
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
     where l.quotation_id = p_quotation and l.company_id = p_company
     order by l.line_no;
  end if;
  return v_po;
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
begin
  select * into po from public.purchase_orders where id = p_id;
  if po.id is null or not public.is_manager(po.company_id) then
    raise exception 'Only management can approve purchase orders.' using errcode = '42501';
  end if;
  if po.status <> 'pending_approval' then raise exception 'This purchase order is not waiting for approval.' using errcode = '22023'; end if;
  if po.submitted_by = auth.uid() then
    raise exception 'You cannot approve a purchase order you submitted yourself.' using errcode = '42501';
  end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'Please say what needs to change.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  if p_approve then
    update public.purchase_orders set status = 'approved', approved_at = now(), approved_by = auth.uid(),
           review_note = nullif(btrim(p_note), '') where id = p_id;
  else
    update public.purchase_orders set status = 'draft', review_note = btrim(p_note) where id = p_id;
  end if;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

create or replace function public.mark_po_sent(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_id;
  if po.id is null or not public.has_role(po.company_id, array['management', 'procurement']::public.app_role[]) then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;
  if po.status not in ('approved', 'sent') then raise exception 'Only an approved purchase order can be sent.' using errcode = '22023'; end if;
  perform set_config('ims.status_change', 'on', true);
  update public.purchase_orders set status = 'sent', sent_at = coalesce(sent_at, now()) where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Supplier confirmed: record their reference and date, and update product costs.
create or replace function public.confirm_purchase_order(p_id uuid, p_supplier_ref text, p_expected date)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_id;
  if po.id is null or not public.has_role(po.company_id, array['management', 'procurement']::public.app_role[]) then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;
  if po.status not in ('approved', 'sent') then raise exception 'Only an approved or sent purchase order can be confirmed.' using errcode = '22023'; end if;
  perform set_config('ims.status_change', 'on', true);
  update public.purchase_orders
     set status = 'confirmed', confirmed_at = now(), sent_at = coalesce(sent_at, now()),
         supplier_ref = coalesce(nullif(btrim(p_supplier_ref), ''), supplier_ref),
         expected_date = coalesce(p_expected, expected_date)
   where id = p_id;
  perform set_config('ims.status_change', 'off', true);

  -- Latest confirmed price becomes the product's last cost (in base currency).
  insert into public.product_costs (product_id, company_id, main_supplier_id, last_cost)
  select l.product_id, po.company_id, po.supplier_id, round(l.unit_price * po.exchange_rate, 2)
    from public.po_lines l where l.po_id = p_id and l.product_id is not null
  on conflict (product_id) do update
    set last_cost = excluded.last_cost,
        main_supplier_id = coalesce(public.product_costs.main_supplier_id, excluded.main_supplier_id);
end;
$$;

create or replace function public.cancel_purchase_order(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_id;
  if po.id is null or not public.has_role(po.company_id, array['management', 'procurement']::public.app_role[]) then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;
  if po.status in ('partially_received', 'received', 'closed', 'cancelled') then
    raise exception 'This purchase order can no longer be cancelled.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.purchase_orders set status = 'cancelled' where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

revoke execute on function
  public.create_supplier_rfq(uuid, uuid, uuid), public.award_supplier_rfq(uuid),
  public.create_purchase_order(uuid, uuid, uuid), public.submit_purchase_order(uuid),
  public.review_purchase_order(uuid, boolean, text), public.mark_po_sent(uuid),
  public.confirm_purchase_order(uuid, text, date), public.cancel_purchase_order(uuid)
from public, anon;
grant execute on function
  public.create_supplier_rfq(uuid, uuid, uuid), public.award_supplier_rfq(uuid),
  public.create_purchase_order(uuid, uuid, uuid), public.submit_purchase_order(uuid),
  public.review_purchase_order(uuid, boolean, text), public.mark_po_sent(uuid),
  public.confirm_purchase_order(uuid, text, date), public.cancel_purchase_order(uuid)
to authenticated;

notify pgrst, 'reload schema';
