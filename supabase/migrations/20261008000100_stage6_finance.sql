-- =====================================================================
-- TRIUMPH IMS  ·  Stage 6: invoices, payments, supplier bills, profit
--
-- Selling side:  invoice (from an accepted quotation, a delivered
--                delivery note, or blank) → issue (gets its number,
--                due date, credit-limit check, cost snapshot for profit)
--                → payments received (partly paid → paid).
-- Buying side:   supplier bill (usually from a PO) → payments made.
-- Costs:         extra costs per order or per PO (freight, duty,
--                clearing, bank charges…). For a PO they make up the
--                landed cost, which can be written into product costs.
-- Profit:        invoice revenue (before VAT, in base currency) minus
--                the cost of the goods at the time of invoicing, minus
--                extra costs on the order.
--
-- Who can do what:
--   invoices:        read management, finance, sales;
--                    create/issue management, finance;
--                    above a client's credit limit only management issues;
--                    cancelling an issued invoice: management only
--   payments in:     read as invoices; record management, finance;
--                    void management
--   supplier bills:  read management, finance, procurement;
--                    edit and pay management, finance; void payments management
--   costs & profit:  management, finance, procurement (never sales)
-- =====================================================================

alter table public.companies
  add column if not exists invoice_due_days integer not null default 30 check (invoice_due_days between 0 and 365),
  add column if not exists invoice_terms text;
grant update (invoice_due_days, invoice_terms) on public.companies to authenticated;

-- Numbering adds receipts (RCT-) and supplier bills (BILL-). Invoices are
-- numbered only when issued, so the INV- sequence has no gaps.
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
                when 'goods_receipts' then 'GRN-'
                when 'deliveries' then 'DN-'
                when 'payments' then 'RCT-'
                when 'supplier_bills' then 'BILL-'
                when 'supplier_payments' then 'PAY-'
                else 'DOC-' end || v_year || '-';
  new.number := public.next_code(new.company_id, tg_table_name || '-' || v_year, v_prefix, 4);
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------
create table public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  number             text not null default '',
  client_id          uuid not null,
  quotation_id       uuid,
  delivery_id        uuid,
  status             text not null default 'draft'
                     check (status in ('draft', 'issued', 'partly_paid', 'paid', 'cancelled')),
  currency           text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate      numeric(18, 6) not null default 1 check (exchange_rate > 0),
  issue_date         date,
  due_date           date,
  client_ref         text,
  contact_name       text,
  payment_terms      text,
  vat_rate           numeric(5, 2) not null default 18 check (vat_rate between 0 and 100),
  notes              text,
  terms              text,
  subtotal           numeric(18, 2) not null default 0,
  discount_total     numeric(18, 2) not null default 0,
  vat_amount         numeric(18, 2) not null default 0,
  total              numeric(18, 2) not null default 0,
  amount_paid        numeric(18, 2) not null default 0 check (amount_paid >= 0),
  issued_at          timestamptz,
  issued_by          uuid references auth.users (id) on delete set null,
  credit_override_by uuid references auth.users (id) on delete set null,
  cancelled_reason   text,
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id),
  foreign key (delivery_id, company_id) references public.deliveries (id, company_id)
);
create unique index invoices_number_key on public.invoices (company_id, number) where number <> '';
create index invoices_company_status_idx on public.invoices (company_id, status, due_date);
create index invoices_client_idx on public.invoices (client_id, status);
create index invoices_quotation_idx on public.invoices (quotation_id) where quotation_id is not null;

create table public.invoice_lines (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  invoice_id         uuid not null,
  line_no            integer not null default 0,
  product_id         uuid,
  quotation_line_id  uuid,
  description        text not null check (char_length(btrim(description)) > 0),
  quantity           numeric(18, 3) not null default 1 check (quantity > 0),
  unit               text not null default 'pcs',
  unit_price         numeric(18, 2) not null default 0 check (unit_price >= 0),
  discount_pct       numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  line_total         numeric(18, 2) not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, company_id),
  foreign key (invoice_id, company_id) references public.invoices (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id),
  foreign key (quotation_line_id, company_id) references public.quotation_lines (id, company_id)
);
create index invoice_lines_idx on public.invoice_lines (invoice_id, line_no);
create index invoice_lines_qline_idx on public.invoice_lines (quotation_line_id) where quotation_line_id is not null;

-- Cost of each line when the invoice was issued (base currency). Kept apart
-- so Sales never sees it.
create table public.invoice_costs (
  invoice_line_id  uuid primary key,
  company_id       uuid not null references public.companies (id) on delete cascade,
  invoice_id       uuid not null,
  unit_cost        numeric(18, 2),
  foreign key (invoice_line_id, company_id) references public.invoice_lines (id, company_id) on delete cascade,
  foreign key (invoice_id, company_id) references public.invoices (id, company_id) on delete cascade
);
create index invoice_costs_invoice_idx on public.invoice_costs (invoice_id);

-- Payments received from clients (one invoice per payment).
create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  number         text not null default '',
  invoice_id     uuid not null,
  client_id      uuid not null,
  received_on    date not null,
  amount         numeric(18, 2) not null check (amount > 0),
  currency       text not null check (currency ~ '^[A-Z]{3}$'),
  exchange_rate  numeric(18, 6) not null default 1 check (exchange_rate > 0),
  method         text not null default 'bank_transfer'
                 check (method in ('bank_transfer', 'cash', 'mobile_money', 'cheque', 'other')),
  reference      text,
  notes          text,
  voided_at      timestamptz,
  voided_by      uuid references auth.users (id) on delete set null,
  void_reason    text,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  foreign key (invoice_id, company_id) references public.invoices (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id)
);
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_company_date_idx on public.payments (company_id, received_on desc);

-- ---------------------------------------------------------------------
-- Supplier bills and payments made
-- ---------------------------------------------------------------------
create table public.supplier_bills (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  number               text not null default '',
  supplier_id          uuid not null,
  po_id                uuid,
  supplier_invoice_no  text,
  bill_date            date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  due_date             date,
  currency             text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate        numeric(18, 6) not null default 1 check (exchange_rate > 0),
  subtotal             numeric(18, 2) not null default 0 check (subtotal >= 0),
  vat_amount           numeric(18, 2) not null default 0 check (vat_amount >= 0),
  total                numeric(18, 2) not null default 0,
  amount_paid          numeric(18, 2) not null default 0 check (amount_paid >= 0),
  status               text not null default 'open' check (status in ('open', 'partly_paid', 'paid', 'cancelled')),
  notes                text,
  created_by           uuid default auth.uid() references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id),
  foreign key (po_id, company_id) references public.purchase_orders (id, company_id)
);
create index supplier_bills_company_status_idx on public.supplier_bills (company_id, status, due_date);
create index supplier_bills_po_idx on public.supplier_bills (po_id) where po_id is not null;

create table public.supplier_payments (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  number         text not null default '',
  bill_id        uuid not null,
  supplier_id    uuid not null,
  paid_on        date not null,
  amount         numeric(18, 2) not null check (amount > 0),
  currency       text not null check (currency ~ '^[A-Z]{3}$'),
  exchange_rate  numeric(18, 6) not null default 1 check (exchange_rate > 0),
  method         text not null default 'bank_transfer'
                 check (method in ('bank_transfer', 'cash', 'mobile_money', 'cheque', 'other')),
  reference      text,
  notes          text,
  voided_at      timestamptz,
  voided_by      uuid references auth.users (id) on delete set null,
  void_reason    text,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  foreign key (bill_id, company_id) references public.supplier_bills (id, company_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id)
);
create index supplier_payments_bill_idx on public.supplier_payments (bill_id);

-- ---------------------------------------------------------------------
-- Extra costs on an order (quotation) or a purchase order
-- ---------------------------------------------------------------------
create table public.order_costs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  quotation_id   uuid,
  po_id          uuid,
  kind           text not null default 'other'
                 check (kind in ('freight', 'insurance', 'duty', 'clearing', 'port', 'transport', 'bank', 'commission', 'other')),
  description    text,
  amount         numeric(18, 2) not null check (amount > 0),
  currency       text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate  numeric(18, 6) not null default 1 check (exchange_rate > 0),
  incurred_on    date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (num_nonnulls(quotation_id, po_id) = 1),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id) on delete cascade,
  foreign key (po_id, company_id) references public.purchase_orders (id, company_id) on delete cascade
);
create index order_costs_quotation_idx on public.order_costs (quotation_id) where quotation_id is not null;
create index order_costs_po_idx on public.order_costs (po_id) where po_id is not null;

alter table public.purchase_orders
  add column if not exists landed_cost_base  numeric(18, 2),
  add column if not exists landed_applied_at timestamptz;

-- Profit per issued invoice (respects the caller's access: without cost
-- access, costs come out empty).
create view public.invoice_profit with (security_invoker = true) as
select i.id as invoice_id, i.company_id, i.client_id, i.quotation_id, i.issue_date, i.currency, i.status,
       round(i.subtotal * i.exchange_rate, 2) as revenue_base,
       coalesce(sum(round(l.quantity * c.unit_cost, 2)), 0) as cost_base,
       count(l.id) filter (where c.unit_cost is null) as lines_without_cost
  from public.invoices i
  join public.invoice_lines l on l.invoice_id = i.id
  left join public.invoice_costs c on c.invoice_line_id = l.id
 where i.status in ('issued', 'partly_paid', 'paid')
 group by i.id;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create trigger payments_number          before insert on public.payments          for each row execute function public.assign_doc_number();
create trigger supplier_bills_number    before insert on public.supplier_bills    for each row execute function public.assign_doc_number();
create trigger supplier_payments_number before insert on public.supplier_payments for each row execute function public.assign_doc_number();

-- Invoice lines: numbering, totals, and only while the invoice is a draft.
create or replace function public.prepare_invoice_line()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is distinct from 'draft' and current_setting('ims.status_change', true) is distinct from 'on' then
    raise exception 'Only draft invoices can be changed.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'INSERT' and coalesce(new.line_no, 0) = 0 then
    select coalesce(max(line_no), 0) + 1 into new.line_no from public.invoice_lines where invoice_id = new.invoice_id;
  end if;
  new.line_total := round(new.quantity * new.unit_price * (1 - new.discount_pct / 100), 2);
  return new;
end;
$$;
create trigger invoice_lines_prepare before insert or update or delete on public.invoice_lines
  for each row execute function public.prepare_invoice_line();

create or replace function public.touch_invoice()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  update public.invoices set updated_at = now() where id = coalesce(new.invoice_id, old.invoice_id);
  return null;
end;
$$;
create trigger invoice_lines_touch after insert or update or delete on public.invoice_lines
  for each row execute function public.touch_invoice();

-- Invoice header: totals from the lines; frozen once issued.
create or replace function public.prepare_invoice()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_gross numeric;
  v_net numeric;
begin
  if tg_op = 'UPDATE' and current_setting('ims.status_change', true) is distinct from 'on' then
    if old.status <> 'draft'
       and (new.client_id, new.quotation_id, new.delivery_id, new.currency, new.exchange_rate, new.issue_date,
            new.due_date, new.client_ref, new.contact_name, new.payment_terms, new.vat_rate, new.notes, new.terms)
           is distinct from
           (old.client_id, old.quotation_id, old.delivery_id, old.currency, old.exchange_rate, old.issue_date,
            old.due_date, old.client_ref, old.contact_name, old.payment_terms, old.vat_rate, old.notes, old.terms) then
      raise exception 'This invoice has been issued and can no longer be changed.' using errcode = '42501';
    end if;
    if (new.status, new.number, new.amount_paid, new.issued_at, new.issued_by, new.credit_override_by)
       is distinct from (old.status, old.number, old.amount_paid, old.issued_at, old.issued_by, old.credit_override_by) then
      raise exception 'Use the buttons in the app to change the status.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'INSERT' and (new.status <> 'draft' or new.amount_paid <> 0 or coalesce(new.number, '') <> '') then
    raise exception 'New invoices start as drafts.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(sum(round(quantity * unit_price, 2)), 0), coalesce(sum(line_total), 0)
      into v_gross, v_net
      from public.invoice_lines where invoice_id = new.id;
  else
    v_gross := 0;
    v_net := 0;
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft' then
    return new;  -- issued totals never move
  end if;
  new.subtotal := v_net;
  new.discount_total := v_gross - v_net;
  new.vat_amount := round(v_net * new.vat_rate / 100, 2);
  new.total := new.subtotal + new.vat_amount;
  return new;
end;
$$;
create trigger invoices_prepare before insert or update on public.invoices
  for each row execute function public.prepare_invoice();

-- Supplier bills: total from subtotal + VAT; frozen once paid or cancelled.
create or replace function public.prepare_supplier_bill()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and (new.status <> 'open' or new.amount_paid <> 0) then
    raise exception 'New bills start unpaid.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and current_setting('ims.status_change', true) is distinct from 'on' then
    if (new.status, new.amount_paid) is distinct from (old.status, old.amount_paid) then
      raise exception 'Use the buttons in the app to change the status.' using errcode = '42501';
    end if;
    if (old.status <> 'open' or old.amount_paid > 0)
       and (new.supplier_id, new.po_id, new.currency, new.exchange_rate, new.subtotal, new.vat_amount, new.bill_date)
           is distinct from
           (old.supplier_id, old.po_id, old.currency, old.exchange_rate, old.subtotal, old.vat_amount, old.bill_date) then
      raise exception 'A bill with payments can no longer be changed. Void the payments first.' using errcode = '42501';
    end if;
  end if;
  new.total := new.subtotal + new.vat_amount;
  if new.total <= 0 then
    raise exception 'Enter the bill amount.' using errcode = '22023';
  end if;
  if new.po_id is not null
     and not exists (select 1 from public.purchase_orders where id = new.po_id and supplier_id = new.supplier_id) then
    raise exception 'The purchase order belongs to another supplier.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger supplier_bills_prepare before insert or update on public.supplier_bills
  for each row execute function public.prepare_supplier_bill();

create trigger invoices_touch          before update on public.invoices          for each row execute function public.touch_updated_at();
create trigger invoice_lines_touch2    before update on public.invoice_lines     for each row execute function public.touch_updated_at();
create trigger supplier_bills_touch    before update on public.supplier_bills    for each row execute function public.touch_updated_at();
create trigger order_costs_touch       before update on public.order_costs       for each row execute function public.touch_updated_at();

create trigger invoices_keep           before update on public.invoices          for each row execute function public.keep_company();
create trigger invoice_lines_keep      before update on public.invoice_lines     for each row execute function public.keep_company();
create trigger supplier_bills_keep     before update on public.supplier_bills    for each row execute function public.keep_company();
create trigger order_costs_keep        before update on public.order_costs       for each row execute function public.keep_company();

create trigger invoices_audit          after insert or update on public.invoices                 for each row execute function public.audit_row();
create trigger invoice_lines_audit     after insert or update or delete on public.invoice_lines  for each row execute function public.audit_row();
create trigger payments_audit          after insert or update on public.payments                 for each row execute function public.audit_row();
create trigger supplier_bills_audit    after insert or update on public.supplier_bills           for each row execute function public.audit_row();
create trigger supplier_payments_audit after insert or update on public.supplier_payments        for each row execute function public.audit_row();
create trigger order_costs_audit       after insert or update or delete on public.order_costs    for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.invoices          enable row level security;
alter table public.invoice_lines     enable row level security;
alter table public.invoice_costs     enable row level security;
alter table public.payments          enable row level security;
alter table public.supplier_bills    enable row level security;
alter table public.supplier_payments enable row level security;
alter table public.order_costs       enable row level security;

create policy invoices_select on public.invoices for select to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'sales']::public.app_role[]));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (public.has_role(company_id, array['management', 'finance']::public.app_role[]));
create policy invoices_update on public.invoices for update to authenticated
  using (public.has_role(company_id, array['management', 'finance']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'finance']::public.app_role[]));

create policy invoice_lines_select on public.invoice_lines for select to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'sales']::public.app_role[]));
create policy invoice_lines_write on public.invoice_lines for all to authenticated
  using (public.has_role(company_id, array['management', 'finance']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'finance']::public.app_role[]));

create policy invoice_costs_select on public.invoice_costs for select to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'procurement']::public.app_role[]));

create policy payments_select on public.payments for select to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'sales']::public.app_role[]));

create policy supplier_bills_select on public.supplier_bills for select to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'procurement']::public.app_role[]));
create policy supplier_bills_insert on public.supplier_bills for insert to authenticated
  with check (public.has_role(company_id, array['management', 'finance']::public.app_role[]));
create policy supplier_bills_update on public.supplier_bills for update to authenticated
  using (public.has_role(company_id, array['management', 'finance']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'finance']::public.app_role[]));

create policy supplier_payments_select on public.supplier_payments for select to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'procurement']::public.app_role[]));

create policy order_costs_all on public.order_costs for all to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'procurement']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'finance', 'procurement']::public.app_role[]));

revoke all on public.invoices, public.invoice_lines, public.invoice_costs, public.payments, public.supplier_bills,
              public.supplier_payments, public.order_costs, public.invoice_profit from anon, authenticated;
grant select on public.invoices, public.invoice_costs, public.payments, public.supplier_payments, public.invoice_profit
  to authenticated;
grant insert (company_id, client_id, quotation_id, delivery_id, currency, exchange_rate, issue_date, due_date, client_ref,
              contact_name, payment_terms, vat_rate, notes, terms)
  on public.invoices to authenticated;
grant update (client_id, currency, exchange_rate, issue_date, due_date, client_ref, contact_name, payment_terms, vat_rate,
              notes, terms)
  on public.invoices to authenticated;
grant select, insert, delete on public.invoice_lines to authenticated;
grant update (product_id, description, quantity, unit, unit_price, discount_pct, line_no) on public.invoice_lines to authenticated;
grant select on public.supplier_bills to authenticated;
grant insert (company_id, supplier_id, po_id, supplier_invoice_no, bill_date, due_date, currency, exchange_rate, subtotal,
              vat_amount, notes)
  on public.supplier_bills to authenticated;
grant update (supplier_id, po_id, supplier_invoice_no, bill_date, due_date, currency, exchange_rate, subtotal, vat_amount, notes)
  on public.supplier_bills to authenticated;
grant select, insert, delete on public.order_costs to authenticated;
grant update (kind, description, amount, currency, exchange_rate, incurred_on) on public.order_costs to authenticated;

-- ---------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------

-- New draft invoice. From a delivered delivery note it bills exactly what
-- was delivered; from an accepted quotation it bills what is not yet
-- invoiced; otherwise it starts blank for the client.
create or replace function public.create_invoice(p_company uuid, p_client uuid, p_quotation uuid, p_delivery uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  q public.quotations;
  d public.deliveries;
  cl public.clients;
  co public.companies;
  v_existing text;
begin
  if not public.has_role(p_company, array['management', 'finance']::public.app_role[]) then
    raise exception 'Only management and finance can create invoices.' using errcode = '42501';
  end if;
  select * into co from public.companies where id = p_company;

  if p_delivery is not null then
    select * into d from public.deliveries where id = p_delivery and company_id = p_company;
    if d.id is null then raise exception 'Delivery not found.' using errcode = '22023'; end if;
    if d.status <> 'delivered' then raise exception 'Only delivered goods can be invoiced from a delivery note.' using errcode = '22023'; end if;
    select coalesce(nullif(number, ''), 'a draft invoice') into v_existing from public.invoices
     where delivery_id = p_delivery and status <> 'cancelled' limit 1;
    if v_existing is not null then
      raise exception 'This delivery is already invoiced (%).', v_existing using errcode = '22023';
    end if;
    p_client := d.client_id;
    p_quotation := d.quotation_id;
  end if;

  if p_quotation is not null then
    select * into q from public.quotations where id = p_quotation and company_id = p_company;
    if q.id is null then raise exception 'Quotation not found.' using errcode = '22023'; end if;
    if q.status <> 'accepted' then raise exception 'Only accepted quotations can be invoiced.' using errcode = '22023'; end if;
    p_client := q.client_id;
  end if;

  select * into cl from public.clients where id = p_client and company_id = p_company;
  if cl.id is null then raise exception 'Client not found.' using errcode = '22023'; end if;

  insert into public.invoices (company_id, client_id, quotation_id, delivery_id, currency, exchange_rate, client_ref,
                               contact_name, payment_terms, vat_rate, terms, created_by)
  values (p_company, p_client, p_quotation, p_delivery,
          coalesce(q.currency, cl.currency, co.base_currency), coalesce(q.exchange_rate, 1),
          q.client_ref, q.contact_name, coalesce(q.payment_terms, cl.payment_terms),
          coalesce(q.vat_rate, co.vat_rate), co.invoice_terms, auth.uid())
  returning id into v_id;

  if p_delivery is not null then
    insert into public.invoice_lines (company_id, invoice_id, line_no, product_id, quotation_line_id, description, quantity,
                                      unit, unit_price, discount_pct)
    select p_company, v_id, dl.line_no, dl.product_id, dl.quotation_line_id, dl.description, dl.quantity, dl.unit,
           coalesce(ql.unit_price, p.selling_price, 0), coalesce(ql.discount_pct, 0)
      from public.delivery_lines dl
      left join public.quotation_lines ql on ql.id = dl.quotation_line_id
      left join public.products p on p.id = dl.product_id
     where dl.delivery_id = p_delivery
     order by dl.line_no;
  elsif p_quotation is not null then
    insert into public.invoice_lines (company_id, invoice_id, line_no, product_id, quotation_line_id, description, quantity,
                                      unit, unit_price, discount_pct)
    select p_company, v_id, x.line_no, x.product_id, x.id, x.description, x.remaining, x.unit, x.unit_price, x.discount_pct
      from (select ql.*, ql.quantity - coalesce((select sum(il.quantity) from public.invoice_lines il
                                                   join public.invoices i on i.id = il.invoice_id
                                                  where il.quotation_line_id = ql.id and i.status <> 'cancelled'
                                                    and i.id <> v_id), 0) as remaining
              from public.quotation_lines ql where ql.quotation_id = p_quotation) x
     where x.remaining > 0
     order by x.line_no;
    if not found then
      raise exception 'Everything on this quotation has already been invoiced.' using errcode = '22023';
    end if;
  end if;
  return v_id;
end;
$$;

-- Issue: number, dates, credit check, cost snapshot.
create or replace function public.issue_invoice(p_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  inv public.invoices;
  cl public.clients;
  co public.companies;
  v_owed numeric;
  v_this numeric;
  v_override uuid;
  v_year text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY');
  v_number text;
  v_issue date;
begin
  select * into inv from public.invoices where id = p_id for update;
  if inv.id is null or not public.has_role(inv.company_id, array['management', 'finance']::public.app_role[]) then
    raise exception 'Invoice not found.' using errcode = '42501';
  end if;
  if inv.status <> 'draft' then raise exception 'This invoice has already been issued.' using errcode = '22023'; end if;
  if not exists (select 1 from public.invoice_lines where invoice_id = p_id) then
    raise exception 'Add at least one item before issuing.' using errcode = '22023';
  end if;
  if inv.total <= 0 then raise exception 'The invoice total must be more than zero.' using errcode = '22023'; end if;

  select * into cl from public.clients where id = inv.client_id;
  select * into co from public.companies where id = inv.company_id;

  -- Credit limit (0 = no limit set). Amounts in base currency.
  if cl.credit_limit > 0 then
    select coalesce(sum(round((total - amount_paid) * exchange_rate, 2)), 0) into v_owed
      from public.invoices where client_id = inv.client_id and status in ('issued', 'partly_paid');
    v_this := round(inv.total * inv.exchange_rate, 2);
    if v_owed + v_this > cl.credit_limit then
      if not public.is_manager(inv.company_id) then
        raise exception 'Credit limit exceeded: % already owes % and this invoice adds %, above the limit of %. A manager must issue it.',
          cl.name, to_char(v_owed, 'FM999,999,999,990'), to_char(v_this, 'FM999,999,999,990'),
          to_char(cl.credit_limit, 'FM999,999,999,990') using errcode = '22023';
      end if;
      v_override := auth.uid();
    end if;
  end if;

  v_issue := coalesce(inv.issue_date, (now() at time zone 'Africa/Dar_es_Salaam')::date);
  v_number := public.next_code(inv.company_id, 'invoices-' || v_year, 'INV-' || v_year || '-', 4);

  perform set_config('ims.status_change', 'on', true);
  update public.invoices
     set status = 'issued', number = v_number, issue_date = v_issue,
         due_date = coalesce(due_date, v_issue + co.invoice_due_days),
         issued_at = now(), issued_by = auth.uid(), credit_override_by = v_override
   where id = p_id;
  perform set_config('ims.status_change', 'off', true);

  insert into public.invoice_costs (invoice_line_id, company_id, invoice_id, unit_cost)
  select l.id, inv.company_id, p_id, pc.last_cost
    from public.invoice_lines l
    left join public.product_costs pc on pc.product_id = l.product_id
   where l.invoice_id = p_id
  on conflict (invoice_line_id) do update set unit_cost = excluded.unit_cost;
  return v_number;
end;
$$;

-- Cancel: drafts by finance/management; issued (unpaid) invoices by management only.
create or replace function public.cancel_invoice(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  inv public.invoices;
begin
  select * into inv from public.invoices where id = p_id for update;
  if inv.id is null or not public.has_role(inv.company_id, array['management', 'finance']::public.app_role[]) then
    raise exception 'Invoice not found.' using errcode = '42501';
  end if;
  if inv.status = 'cancelled' then return; end if;
  if inv.status <> 'draft' then
    if not public.is_manager(inv.company_id) then
      raise exception 'Only management can cancel an issued invoice.' using errcode = '42501';
    end if;
    if inv.amount_paid > 0 then
      raise exception 'This invoice has payments. Void the payments first.' using errcode = '22023';
    end if;
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'Give a reason for cancelling an issued invoice.' using errcode = '22023';
    end if;
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.invoices set status = 'cancelled', cancelled_reason = nullif(btrim(p_reason), '') where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Payment received against an invoice, in the invoice's currency.
create or replace function public.record_payment(p_invoice uuid, p_received_on date, p_amount numeric, p_method text,
                                                 p_reference text, p_exchange_rate numeric, p_notes text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  inv public.invoices;
  v_id uuid;
  v_open numeric;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.id is null or not public.has_role(inv.company_id, array['management', 'finance']::public.app_role[]) then
    raise exception 'Invoice not found.' using errcode = '42501';
  end if;
  if inv.status not in ('issued', 'partly_paid') then
    raise exception 'Payments can only be recorded on an issued, unpaid invoice.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount received.' using errcode = '22023'; end if;
  v_open := inv.total - inv.amount_paid;
  if round(p_amount, 2) > v_open then
    raise exception 'Only % % is still owed on this invoice.', inv.currency, to_char(v_open, 'FM999,999,999,990.00')
      using errcode = '22023';
  end if;

  insert into public.payments (company_id, invoice_id, client_id, received_on, amount, currency, exchange_rate, method,
                               reference, notes)
  values (inv.company_id, p_invoice, inv.client_id,
          coalesce(p_received_on, (now() at time zone 'Africa/Dar_es_Salaam')::date), round(p_amount, 2), inv.currency,
          coalesce(nullif(p_exchange_rate, 0), inv.exchange_rate), coalesce(nullif(p_method, ''), 'bank_transfer'),
          nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''))
  returning id into v_id;

  perform set_config('ims.status_change', 'on', true);
  update public.invoices
     set amount_paid = amount_paid + round(p_amount, 2),
         status = case when amount_paid + round(p_amount, 2) >= total then 'paid' else 'partly_paid' end
   where id = p_invoice;
  perform set_config('ims.status_change', 'off', true);
  return v_id;
end;
$$;

create or replace function public.void_payment(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  pm public.payments;
begin
  select * into pm from public.payments where id = p_id for update;
  if pm.id is null or not public.is_manager(pm.company_id) then
    raise exception 'Only management can void a payment.' using errcode = '42501';
  end if;
  if pm.voided_at is not null then return; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for voiding the payment.' using errcode = '22023'; end if;
  update public.payments set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) where id = p_id;
  perform set_config('ims.status_change', 'on', true);
  update public.invoices
     set amount_paid = amount_paid - pm.amount,
         status = case when amount_paid - pm.amount <= 0 then 'issued' else 'partly_paid' end
   where id = pm.invoice_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Payment made to a supplier against a bill, in the bill's currency.
create or replace function public.pay_supplier_bill(p_bill uuid, p_paid_on date, p_amount numeric, p_method text,
                                                    p_reference text, p_exchange_rate numeric, p_notes text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  b public.supplier_bills;
  v_id uuid;
  v_open numeric;
begin
  select * into b from public.supplier_bills where id = p_bill for update;
  if b.id is null or not public.has_role(b.company_id, array['management', 'finance']::public.app_role[]) then
    raise exception 'Bill not found.' using errcode = '42501';
  end if;
  if b.status not in ('open', 'partly_paid') then raise exception 'This bill is not open for payment.' using errcode = '22023'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount paid.' using errcode = '22023'; end if;
  v_open := b.total - b.amount_paid;
  if round(p_amount, 2) > v_open then
    raise exception 'Only % % is still owed on this bill.', b.currency, to_char(v_open, 'FM999,999,999,990.00') using errcode = '22023';
  end if;

  insert into public.supplier_payments (company_id, bill_id, supplier_id, paid_on, amount, currency, exchange_rate, method,
                                        reference, notes)
  values (b.company_id, p_bill, b.supplier_id, coalesce(p_paid_on, (now() at time zone 'Africa/Dar_es_Salaam')::date),
          round(p_amount, 2), b.currency, coalesce(nullif(p_exchange_rate, 0), b.exchange_rate),
          coalesce(nullif(p_method, ''), 'bank_transfer'), nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''))
  returning id into v_id;

  perform set_config('ims.status_change', 'on', true);
  update public.supplier_bills
     set amount_paid = amount_paid + round(p_amount, 2),
         status = case when amount_paid + round(p_amount, 2) >= total then 'paid' else 'partly_paid' end
   where id = p_bill;
  perform set_config('ims.status_change', 'off', true);
  return v_id;
end;
$$;

create or replace function public.void_supplier_payment(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  sp public.supplier_payments;
begin
  select * into sp from public.supplier_payments where id = p_id for update;
  if sp.id is null or not public.is_manager(sp.company_id) then
    raise exception 'Only management can void a payment.' using errcode = '42501';
  end if;
  if sp.voided_at is not null then return; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for voiding the payment.' using errcode = '22023'; end if;
  update public.supplier_payments set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason) where id = p_id;
  perform set_config('ims.status_change', 'on', true);
  update public.supplier_bills
     set amount_paid = amount_paid - sp.amount,
         status = case when amount_paid - sp.amount <= 0 then 'open' else 'partly_paid' end
   where id = sp.bill_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

create or replace function public.cancel_supplier_bill(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  b public.supplier_bills;
begin
  select * into b from public.supplier_bills where id = p_id for update;
  if b.id is null or not public.has_role(b.company_id, array['management', 'finance']::public.app_role[]) then
    raise exception 'Bill not found.' using errcode = '42501';
  end if;
  if b.amount_paid > 0 then raise exception 'This bill has payments. Void them first.' using errcode = '22023'; end if;
  perform set_config('ims.status_change', 'on', true);
  update public.supplier_bills set status = 'cancelled' where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Landed cost of a PO: goods + PO freight + extra costs on the PO, shared
-- over the lines by value, written into each product's last cost.
-- Returns the total landed cost in base currency.
create or replace function public.apply_landed_cost(p_po uuid)
returns numeric language plpgsql security definer set search_path = ''
as $$
declare
  po public.purchase_orders;
  v_extras numeric;
  v_spread numeric;
  v_total numeric;
begin
  select * into po from public.purchase_orders where id = p_po;
  if po.id is null or not public.has_role(po.company_id, array['management', 'procurement', 'finance']::public.app_role[]) then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;
  if po.status not in ('confirmed', 'partially_received', 'received', 'closed') then
    raise exception 'Landed cost can be applied once the supplier has confirmed the order.' using errcode = '22023';
  end if;
  if po.subtotal <= 0 then raise exception 'The purchase order has no value.' using errcode = '22023'; end if;

  select coalesce(sum(round(amount * exchange_rate, 2)), 0) into v_extras from public.order_costs where po_id = p_po;
  v_spread := round(po.freight * po.exchange_rate, 2) + v_extras;
  v_total := round(po.subtotal * po.exchange_rate, 2) + v_spread;

  insert into public.product_costs (product_id, company_id, main_supplier_id, last_cost)
  select l.product_id, po.company_id, po.supplier_id,
         round((l.line_total * po.exchange_rate + v_spread * l.line_total / po.subtotal) / l.quantity, 2)
    from public.po_lines l
   where l.po_id = p_po and l.product_id is not null
  on conflict (product_id) do update
    set last_cost = excluded.last_cost,
        main_supplier_id = coalesce(public.product_costs.main_supplier_id, excluded.main_supplier_id);

  update public.purchase_orders set landed_cost_base = v_total, landed_applied_at = now() where id = p_po;
  return v_total;
end;
$$;

revoke execute on function
  public.create_invoice(uuid, uuid, uuid, uuid), public.issue_invoice(uuid), public.cancel_invoice(uuid, text),
  public.record_payment(uuid, date, numeric, text, text, numeric, text), public.void_payment(uuid, text),
  public.pay_supplier_bill(uuid, date, numeric, text, text, numeric, text), public.void_supplier_payment(uuid, text),
  public.cancel_supplier_bill(uuid), public.apply_landed_cost(uuid)
from public, anon;
grant execute on function
  public.create_invoice(uuid, uuid, uuid, uuid), public.issue_invoice(uuid), public.cancel_invoice(uuid, text),
  public.record_payment(uuid, date, numeric, text, text, numeric, text), public.void_payment(uuid, text),
  public.pay_supplier_bill(uuid, date, numeric, text, text, numeric, text), public.void_supplier_payment(uuid, text),
  public.cancel_supplier_bill(uuid), public.apply_landed_cost(uuid)
to authenticated;

notify pgrst, 'reload schema';
