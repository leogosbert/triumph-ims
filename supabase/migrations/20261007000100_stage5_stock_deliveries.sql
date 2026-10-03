-- =====================================================================
-- TRIUMPH IMS  ·  Stage 5: warehouses, stock, receiving, deliveries
--
-- Stock is a ledger: every receipt, dispatch, return and adjustment is a
-- movement row; stock on hand is the sum. Movements are written only by
-- the functions below, never typed in directly.
--
-- Receiving:  goods received note (GRN) against a purchase order →
--             stock in (with batch and expiry), PO partly/fully received.
-- Delivering: delivery note (DN), usually from an accepted quotation →
--             dispatch takes stock out, oldest expiry first (FEFO) →
--             driver confirms delivery with name, signature, photo, GPS
--             (can be captured offline and synced later) — or records a
--             failed delivery, which returns the stock.
--
-- Who can do what:
--   warehouses:  everyone reads; management edits
--   stock:       everyone except drivers reads; management and warehouse
--                adjust
--   receiving:   management, warehouse, procurement
--   deliveries:  management, sales, warehouse, finance read; drivers see
--                only deliveries assigned to them; management, sales,
--                warehouse create; management and warehouse dispatch;
--                the assigned driver, management or warehouse confirm
-- =====================================================================

-- ---------------------------------------------------------------------
-- Document numbers: GRN-2026-0001, DN-2026-0001
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
  v_prefix := case tg_table_name
                when 'rfqs' then 'RFQ-'
                when 'quotations' then 'QT-'
                when 'supplier_rfqs' then 'SRFQ-'
                when 'purchase_orders' then 'PO-'
                when 'goods_receipts' then 'GRN-'
                when 'deliveries' then 'DN-'
                else 'DOC-' end || v_year || '-';
  new.number := public.next_code(new.company_id, tg_table_name || '-' || v_year, v_prefix, 4);
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Warehouses
-- ---------------------------------------------------------------------
create table public.warehouses (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  code        text not null check (char_length(btrim(code)) between 1 and 20),
  name        text not null check (char_length(btrim(name)) between 2 and 120),
  address     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, code),
  unique (id, company_id)
);

-- Every company gets a main store.
create or replace function public.add_main_store()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.warehouses (company_id, code, name, address)
  values (new.id, 'MAIN', 'Main store', new.address)
  on conflict (company_id, code) do nothing;
  return new;
end;
$$;
create trigger companies_main_store after insert on public.companies
  for each row execute function public.add_main_store();
insert into public.warehouses (company_id, code, name, address)
select id, 'MAIN', 'Main store', address from public.companies
on conflict (company_id, code) do nothing;

-- ---------------------------------------------------------------------
-- Goods receipts (GRN)
-- ---------------------------------------------------------------------
create table public.goods_receipts (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  number                 text not null default '',
  po_id                  uuid not null,
  warehouse_id           uuid not null,
  received_on            date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  supplier_delivery_note text,
  notes                  text,
  received_by            uuid default auth.uid() references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  foreign key (po_id, company_id) references public.purchase_orders (id, company_id),
  foreign key (warehouse_id, company_id) references public.warehouses (id, company_id)
);

create table public.grn_lines (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  grn_id       uuid not null,
  po_line_id   uuid not null,
  product_id   uuid,
  description  text not null,
  quantity     numeric(18, 3) not null check (quantity > 0),
  unit         text not null,
  batch_no     text not null default '',
  expiry_date  date,
  condition    text not null default 'good' check (condition in ('good', 'damaged')),
  note         text,
  foreign key (grn_id, company_id) references public.goods_receipts (id, company_id) on delete cascade,
  foreign key (po_line_id, company_id) references public.po_lines (id, company_id),
  foreign key (product_id, company_id) references public.products (id, company_id)
);

-- ---------------------------------------------------------------------
-- Deliveries (DN)
-- ---------------------------------------------------------------------
alter table public.quotation_lines add constraint quotation_lines_id_company_key unique (id, company_id);

create table public.deliveries (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  number            text not null default '',
  client_id         uuid not null,
  quotation_id      uuid,
  warehouse_id      uuid not null,
  delivery_site     text,
  contact_name      text,
  contact_phone     text,
  planned_date      date,
  driver_id         uuid references auth.users (id) on delete set null,
  vehicle           text,
  status            text not null default 'draft' check (status in ('draft', 'dispatched', 'delivered', 'failed', 'cancelled')),
  notes             text,
  dispatched_at     timestamptz,
  delivered_at      timestamptz,
  received_by_name  text,
  signature_path    text,
  photo_path        text,
  gps_lat           numeric(9, 6),
  gps_lng           numeric(9, 6),
  pod_notes         text,
  pod_recorded_by   uuid references auth.users (id) on delete set null,
  failed_reason     text,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id),
  foreign key (warehouse_id, company_id) references public.warehouses (id, company_id)
);
create index deliveries_company_status_idx on public.deliveries (company_id, status, planned_date);
create index deliveries_driver_idx on public.deliveries (driver_id, status);

create table public.delivery_lines (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  delivery_id        uuid not null,
  line_no            integer not null default 0,
  product_id         uuid,
  quotation_line_id  uuid,
  description        text not null check (char_length(btrim(description)) > 0),
  quantity           numeric(18, 3) not null check (quantity > 0),
  unit               text not null default 'pcs',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, company_id),
  foreign key (delivery_id, company_id) references public.deliveries (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id),
  foreign key (quotation_line_id, company_id) references public.quotation_lines (id, company_id)
);
create index delivery_lines_idx on public.delivery_lines (delivery_id, line_no);

-- ---------------------------------------------------------------------
-- Stock ledger
-- ---------------------------------------------------------------------
create table public.stock_movements (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  product_id    uuid not null,
  warehouse_id  uuid not null,
  quantity      numeric(18, 3) not null check (quantity <> 0),
  kind          text not null check (kind in ('receipt', 'dispatch', 'return', 'adjustment')),
  batch_no      text not null default '',
  expiry_date   date,
  grn_id        uuid,
  delivery_id   uuid,
  note          text,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  foreign key (product_id, company_id) references public.products (id, company_id),
  foreign key (warehouse_id, company_id) references public.warehouses (id, company_id),
  foreign key (grn_id, company_id) references public.goods_receipts (id, company_id),
  foreign key (delivery_id, company_id) references public.deliveries (id, company_id)
);
create index stock_movements_product_idx on public.stock_movements (company_id, product_id, warehouse_id);
create index stock_movements_delivery_idx on public.stock_movements (delivery_id) where delivery_id is not null;

-- Stock on hand per product, store and batch (respects the caller's access).
create view public.stock_on_hand with (security_invoker = true) as
select company_id, product_id, warehouse_id, batch_no, expiry_date, sum(quantity) as quantity
  from public.stock_movements
 group by company_id, product_id, warehouse_id, batch_no, expiry_date
having sum(quantity) <> 0;

-- ---------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------
create trigger goods_receipts_number before insert on public.goods_receipts for each row execute function public.assign_doc_number();
create trigger deliveries_number     before insert on public.deliveries     for each row execute function public.assign_doc_number();

create or replace function public.prepare_delivery_line()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.deliveries where id = coalesce(new.delivery_id, old.delivery_id);
  if v_status is distinct from 'draft' and current_setting('ims.status_change', true) is distinct from 'on' then
    raise exception 'Only draft delivery notes can be changed.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and coalesce(new.line_no, 0) = 0 then
    select coalesce(max(line_no), 0) + 1 into new.line_no from public.delivery_lines where delivery_id = new.delivery_id;
  end if;
  return coalesce(new, old);
end;
$$;
create trigger delivery_lines_prepare before insert or update or delete on public.delivery_lines
  for each row execute function public.prepare_delivery_line();

-- After dispatch, only the driver, vehicle and planned date may still change.
create or replace function public.guard_delivery()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if current_setting('ims.status_change', true) = 'on' then
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'Use the buttons in the app to change the status.' using errcode = '42501';
  end if;
  if old.status <> 'draft'
     and (new.client_id, new.quotation_id, new.warehouse_id, new.delivery_site, new.contact_name, new.contact_phone, new.notes)
         is distinct from
         (old.client_id, old.quotation_id, old.warehouse_id, old.delivery_site, old.contact_name, old.contact_phone, old.notes) then
    raise exception 'This delivery note has been dispatched and can no longer be changed.' using errcode = '42501';
  end if;
  if old.status in ('delivered', 'failed', 'cancelled')
     and (new.driver_id, new.vehicle, new.planned_date) is distinct from (old.driver_id, old.vehicle, old.planned_date) then
    raise exception 'This delivery is closed.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger deliveries_guard before update on public.deliveries for each row execute function public.guard_delivery();

create trigger warehouses_touch      before update on public.warehouses      for each row execute function public.touch_updated_at();
create trigger deliveries_touch      before update on public.deliveries      for each row execute function public.touch_updated_at();
create trigger delivery_lines_touch  before update on public.delivery_lines  for each row execute function public.touch_updated_at();
create trigger warehouses_keep       before update on public.warehouses      for each row execute function public.keep_company();
create trigger deliveries_keep       before update on public.deliveries      for each row execute function public.keep_company();
create trigger delivery_lines_keep   before update on public.delivery_lines  for each row execute function public.keep_company();

create trigger warehouses_audit      after insert or update on public.warehouses                 for each row execute function public.audit_row();
create trigger goods_receipts_audit  after insert on public.goods_receipts                       for each row execute function public.audit_row();
create trigger deliveries_audit      after insert or update on public.deliveries                 for each row execute function public.audit_row();
create trigger delivery_lines_audit  after insert or update or delete on public.delivery_lines   for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.warehouses      enable row level security;
alter table public.goods_receipts  enable row level security;
alter table public.grn_lines       enable row level security;
alter table public.deliveries      enable row level security;
alter table public.delivery_lines  enable row level security;
alter table public.stock_movements enable row level security;

create policy warehouses_select on public.warehouses for select to authenticated using (public.is_member(company_id));
create policy warehouses_insert on public.warehouses for insert to authenticated with check (public.is_manager(company_id));
create policy warehouses_update on public.warehouses for update to authenticated
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));

create policy stock_movements_select on public.stock_movements for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'procurement', 'warehouse', 'finance']::public.app_role[]));

create policy goods_receipts_select on public.goods_receipts for select to authenticated
  using (public.has_role(company_id, array['management', 'procurement', 'warehouse', 'finance']::public.app_role[]));
create policy grn_lines_select on public.grn_lines for select to authenticated
  using (public.has_role(company_id, array['management', 'procurement', 'warehouse', 'finance']::public.app_role[]));

create policy deliveries_select on public.deliveries for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'warehouse', 'finance']::public.app_role[])
         or (driver_id = auth.uid() and public.is_member(company_id)));
create policy deliveries_insert on public.deliveries for insert to authenticated
  with check (public.has_role(company_id, array['management', 'sales', 'warehouse']::public.app_role[]) and status = 'draft');
create policy deliveries_update on public.deliveries for update to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'warehouse']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'sales', 'warehouse']::public.app_role[]));

create policy delivery_lines_select on public.delivery_lines for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'warehouse', 'finance']::public.app_role[])
         or exists (select 1 from public.deliveries d where d.id = delivery_id and d.driver_id = auth.uid()));
create policy delivery_lines_write on public.delivery_lines for all to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'warehouse']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'sales', 'warehouse']::public.app_role[]));

revoke all on public.warehouses, public.goods_receipts, public.grn_lines, public.deliveries, public.delivery_lines,
              public.stock_movements, public.stock_on_hand from anon, authenticated;
grant select, insert on public.warehouses to authenticated;
grant update (code, name, address, active) on public.warehouses to authenticated;
grant select on public.goods_receipts, public.grn_lines, public.stock_movements, public.stock_on_hand to authenticated;
grant select on public.deliveries to authenticated;
grant insert (company_id, client_id, quotation_id, warehouse_id, delivery_site, contact_name, contact_phone, planned_date,
              driver_id, vehicle, notes)
  on public.deliveries to authenticated;
grant update (client_id, quotation_id, warehouse_id, delivery_site, contact_name, contact_phone, planned_date, driver_id,
              vehicle, notes)
  on public.deliveries to authenticated;
grant select, insert, delete on public.delivery_lines to authenticated;
grant update (product_id, description, quantity, unit, line_no) on public.delivery_lines to authenticated;

-- ---------------------------------------------------------------------
-- Private storage for signatures and delivery photos:
--   pod/<company id>/<delivery id>/<file>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('pod', 'pod', false) on conflict (id) do nothing;

create policy pod_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pod'
    and exists (select 1 from public.deliveries d
                where d.company_id::text = (storage.foldername(name))[1]
                  and d.id::text = (storage.foldername(name))[2]
                  and (d.driver_id = auth.uid()
                       or public.has_role(d.company_id, array['management', 'warehouse']::public.app_role[])))
  );
create policy pod_select on storage.objects for select to authenticated
  using (
    bucket_id = 'pod'
    and exists (select 1 from public.deliveries d
                where d.company_id::text = (storage.foldername(name))[1]
                  and d.id::text = (storage.foldername(name))[2]
                  and (d.driver_id = auth.uid()
                       or public.has_role(d.company_id, array['management', 'sales', 'warehouse', 'finance']::public.app_role[])))
  );

-- ---------------------------------------------------------------------
-- Actions
-- ---------------------------------------------------------------------

-- Receive goods against a PO.
-- p_lines: [{po_line_id, quantity, batch_no, expiry_date, condition, note}]
create or replace function public.receive_goods(p_po uuid, p_warehouse uuid, p_received_on date, p_supplier_dn text,
                                                p_notes text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  po public.purchase_orders;
  r jsonb;
  pl public.po_lines;
  v_grn uuid;
  v_qty numeric;
  v_count int := 0;
  v_open numeric;
begin
  select * into po from public.purchase_orders where id = p_po;
  if po.id is null or not public.has_role(po.company_id, array['management', 'warehouse', 'procurement']::public.app_role[]) then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;
  if po.status not in ('approved', 'sent', 'confirmed', 'partially_received') then
    raise exception 'Goods can only be received against an approved purchase order.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse and company_id = po.company_id and active) then
    raise exception 'Choose an active store.' using errcode = '22023';
  end if;

  insert into public.goods_receipts (company_id, po_id, warehouse_id, received_on, supplier_delivery_note, notes)
  values (po.company_id, p_po, p_warehouse,
          coalesce(p_received_on, (now() at time zone 'Africa/Dar_es_Salaam')::date),
          nullif(btrim(p_supplier_dn), ''), nullif(btrim(p_notes), ''))
  returning id into v_grn;

  perform set_config('ims.status_change', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce((r ->> 'quantity')::numeric, 0);
    continue when v_qty = 0;
    if v_qty < 0 then raise exception 'Quantities cannot be negative.' using errcode = '22023'; end if;
    select * into pl from public.po_lines where id = (r ->> 'po_line_id')::uuid and po_id = p_po;
    if pl.id is null then raise exception 'A line does not belong to this purchase order.' using errcode = '22023'; end if;
    v_open := pl.quantity - pl.received_qty;
    if v_qty > v_open then
      raise exception 'Line %: receiving % but only % still to come.', pl.line_no, trim_scale(v_qty), trim_scale(v_open) using errcode = '22023';
    end if;

    insert into public.grn_lines (company_id, grn_id, po_line_id, product_id, description, quantity, unit, batch_no,
                                  expiry_date, condition, note)
    values (po.company_id, v_grn, pl.id, pl.product_id, pl.description, v_qty, pl.unit,
            coalesce(btrim(r ->> 'batch_no'), ''), nullif(r ->> 'expiry_date', '')::date,
            coalesce(nullif(r ->> 'condition', ''), 'good'), nullif(btrim(r ->> 'note'), ''));
    update public.po_lines set received_qty = received_qty + v_qty where id = pl.id;

    if pl.product_id is not null and coalesce(r ->> 'condition', 'good') = 'good' then
      insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, expiry_date, grn_id)
      values (po.company_id, pl.product_id, p_warehouse, v_qty, 'receipt', coalesce(btrim(r ->> 'batch_no'), ''),
              nullif(r ->> 'expiry_date', '')::date, v_grn);
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'Enter at least one quantity received.' using errcode = '22023';
  end if;

  update public.purchase_orders
     set status = case when exists (select 1 from public.po_lines where po_id = p_po and received_qty < quantity)
                       then 'partially_received' else 'received' end
   where id = p_po;
  perform set_config('ims.status_change', 'off', true);
  return v_grn;
end;
$$;

-- Opening balances, stock counts and write-offs (positive or negative).
create or replace function public.adjust_stock(p_company uuid, p_product uuid, p_warehouse uuid, p_quantity numeric,
                                               p_batch text, p_expiry date, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_have numeric;
begin
  if not public.has_role(p_company, array['management', 'warehouse']::public.app_role[]) then
    raise exception 'Only management and warehouse can adjust stock.' using errcode = '42501';
  end if;
  if coalesce(p_quantity, 0) = 0 then raise exception 'Enter a quantity to add or remove.' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason for the adjustment.' using errcode = '22023'; end if;
  if not exists (select 1 from public.products where id = p_product and company_id = p_company) then
    raise exception 'Product not found.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse and company_id = p_company) then
    raise exception 'Store not found.' using errcode = '22023';
  end if;
  if p_quantity < 0 then
    select coalesce(sum(quantity), 0) into v_have from public.stock_movements
     where product_id = p_product and warehouse_id = p_warehouse and batch_no = coalesce(btrim(p_batch), '');
    if v_have + p_quantity < 0 then
      raise exception 'Only % in stock for that store and batch.', trim_scale(v_have) using errcode = '22023';
    end if;
  end if;
  insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, expiry_date, note)
  values (p_company, p_product, p_warehouse, p_quantity, 'adjustment', coalesce(btrim(p_batch), ''), p_expiry, btrim(p_reason));
end;
$$;

-- New delivery note; from a quotation it copies what is still to deliver.
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
    insert into public.delivery_lines (company_id, delivery_id, line_no, product_id, quotation_line_id, description, quantity, unit)
    select p_company, v_id, ql.line_no, ql.product_id, ql.id, ql.description,
           ql.quantity - coalesce((select sum(dl.quantity) from public.delivery_lines dl
                                   join public.deliveries d on d.id = dl.delivery_id
                                  where dl.quotation_line_id = ql.id and d.status not in ('failed', 'cancelled')
                                    and d.id <> v_id), 0),
           ql.unit
      from public.quotation_lines ql
     where ql.quotation_id = p_quotation
       and ql.quantity - coalesce((select sum(dl.quantity) from public.delivery_lines dl
                                   join public.deliveries d on d.id = dl.delivery_id
                                  where dl.quotation_line_id = ql.id and d.status not in ('failed', 'cancelled')
                                    and d.id <> v_id), 0) > 0
     order by ql.line_no;
  end if;
  return v_id;
end;
$$;

-- Dispatch: takes stock out of the store, oldest expiry first.
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

  for l in select dl.*, p.name as product_name from public.delivery_lines dl
           left join public.products p on p.id = dl.product_id
           where dl.delivery_id = p_id and dl.product_id is not null order by dl.line_no loop
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

-- Proof of delivery (may have been captured offline: p_delivered_at is when it happened).
create or replace function public.confirm_delivery(p_id uuid, p_received_by text, p_signature_path text, p_photo_path text,
                                                   p_lat numeric, p_lng numeric, p_notes text, p_delivered_at timestamptz)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  d public.deliveries;
begin
  select * into d from public.deliveries where id = p_id for update;
  if d.id is null or not (d.driver_id = auth.uid()
                          or public.has_role(d.company_id, array['management', 'warehouse']::public.app_role[])) then
    raise exception 'Delivery not found.' using errcode = '42501';
  end if;
  if d.status = 'delivered' then
    return;  -- already confirmed (e.g. the same offline record synced twice)
  end if;
  if d.status <> 'dispatched' then raise exception 'Only a dispatched delivery can be confirmed.' using errcode = '22023'; end if;
  if coalesce(btrim(p_received_by), '') = '' then
    raise exception 'Enter the name of the person who received the goods.' using errcode = '22023';
  end if;
  if p_signature_path is null or p_signature_path not like d.company_id::text || '/' || d.id::text || '/%' then
    raise exception 'A signature is required.' using errcode = '22023';
  end if;
  if p_photo_path is not null and p_photo_path not like d.company_id::text || '/' || d.id::text || '/%' then
    raise exception 'Photo is not attached to this delivery.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.deliveries
     set status = 'delivered',
         delivered_at = least(coalesce(p_delivered_at, now()), now()),
         received_by_name = btrim(p_received_by), signature_path = p_signature_path, photo_path = p_photo_path,
         gps_lat = p_lat, gps_lng = p_lng, pod_notes = nullif(btrim(p_notes), ''), pod_recorded_by = auth.uid()
   where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Failed delivery: the goods come back into the store.
create or replace function public.fail_delivery(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  d public.deliveries;
begin
  select * into d from public.deliveries where id = p_id for update;
  if d.id is null or not (d.driver_id = auth.uid()
                          or public.has_role(d.company_id, array['management', 'warehouse']::public.app_role[])) then
    raise exception 'Delivery not found.' using errcode = '42501';
  end if;
  if d.status <> 'dispatched' then raise exception 'Only a dispatched delivery can fail.' using errcode = '22023'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Say why the delivery failed.' using errcode = '22023'; end if;
  insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, expiry_date, delivery_id, note)
  select company_id, product_id, warehouse_id, -quantity, 'return', batch_no, expiry_date, delivery_id, 'Failed delivery'
    from public.stock_movements where delivery_id = p_id and kind = 'dispatch';
  perform set_config('ims.status_change', 'on', true);
  update public.deliveries set status = 'failed', failed_reason = btrim(p_reason) where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

create or replace function public.cancel_delivery(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  d public.deliveries;
begin
  select * into d from public.deliveries where id = p_id;
  if d.id is null or not public.has_role(d.company_id, array['management', 'sales', 'warehouse']::public.app_role[]) then
    raise exception 'Delivery not found.' using errcode = '42501';
  end if;
  if d.status <> 'draft' then raise exception 'Only a draft delivery note can be cancelled.' using errcode = '22023'; end if;
  perform set_config('ims.status_change', 'on', true);
  update public.deliveries set status = 'cancelled' where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

revoke execute on function
  public.receive_goods(uuid, uuid, date, text, text, jsonb), public.adjust_stock(uuid, uuid, uuid, numeric, text, date, text),
  public.create_delivery(uuid, uuid, uuid, uuid), public.dispatch_delivery(uuid),
  public.confirm_delivery(uuid, text, text, text, numeric, numeric, text, timestamptz), public.fail_delivery(uuid, text),
  public.cancel_delivery(uuid)
from public, anon;
grant execute on function
  public.receive_goods(uuid, uuid, date, text, text, jsonb), public.adjust_stock(uuid, uuid, uuid, numeric, text, date, text),
  public.create_delivery(uuid, uuid, uuid, uuid), public.dispatch_delivery(uuid),
  public.confirm_delivery(uuid, text, text, text, numeric, numeric, text, timestamptz), public.fail_delivery(uuid, text),
  public.cancel_delivery(uuid)
to authenticated;

notify pgrst, 'reload schema';
