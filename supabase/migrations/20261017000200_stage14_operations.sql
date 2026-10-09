-- =====================================================================
-- LeMoSp · Stage 14 part 2: medium operations
--
--   Stock transfers  move stock between stores (TRF-): send (stock leaves
--                    the store, "in transit"), receive (it arrives), or
--                    cancel (stock goes back). Batches and expiry dates go
--                    with the goods, oldest expiry first.
--   Min / max        products.max_level next to the reorder level, and
--                    reorder_suggestions(): what to order, how much, from
--                    whom, counting what is already on order.
--   Purchase         requisitions (REQ-): anyone except drivers asks for
--   requests         goods; management approves or rejects; procurement
--                    turns an approved request into a draft purchase order.
--
-- Three-way match (PO / goods received / supplier bill), backorders and the
-- insights page are read from existing tables by the app.
--
-- Run after 20261017000100_stage14_crm_contracts.sql. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Numbering: TRF- and REQ- (assign_doc_number already knows them since
--    part 1; repeated here so this file also works on its own order).
-- ---------------------------------------------------------------------
create or replace function public.assign_doc_number()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_prefix text;
  v_year   text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY');
begin
  if new.number is null or new.number = '' then
    v_prefix := case tg_table_name
                  when 'rfqs' then 'RFQ-'
                  when 'quotations' then 'QT-'
                  when 'supplier_rfqs' then 'SRFQ-'
                  when 'purchase_orders' then 'PO-'
                  when 'goods_receipts' then 'GRN-'
                  when 'deliveries' then 'DN-'
                  when 'invoices' then 'INV-'
                  when 'payments' then 'RCT-'
                  when 'supplier_bills' then 'BILL-'
                  when 'supplier_payments' then 'SPAY-'
                  when 'expenses' then 'EXP-'
                  when 'opportunities' then 'OPP-'
                  when 'tenders' then 'TND-'
                  when 'contracts' then 'CTR-'
                  when 'stock_transfers' then 'TRF-'
                  when 'requisitions' then 'REQ-'
                  else 'DOC-'
                end;
    new.number := public.next_code(new.company_id, tg_table_name || '-' || v_year, v_prefix || v_year || '-', 4);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Stock transfers between stores
-- ---------------------------------------------------------------------
create table if not exists public.stock_transfers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  number            text not null default '',
  from_warehouse_id uuid not null,
  to_warehouse_id   uuid not null,
  status            text not null default 'draft' check (status in ('draft', 'in_transit', 'received', 'cancelled')),
  reason            text check (reason is null or char_length(reason) <= 300),
  vehicle           text check (vehicle is null or char_length(vehicle) <= 120),
  notes             text check (notes is null or char_length(notes) <= 1000),
  sent_at           timestamptz,
  sent_by           uuid references auth.users (id) on delete set null,
  received_at       timestamptz,
  received_by       uuid references auth.users (id) on delete set null,
  receive_note      text,
  cancelled_at      timestamptz,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  check (from_warehouse_id <> to_warehouse_id),
  foreign key (from_warehouse_id, company_id) references public.warehouses (id, company_id),
  foreign key (to_warehouse_id, company_id) references public.warehouses (id, company_id)
);
create index if not exists stock_transfers_company_idx on public.stock_transfers (company_id, status, created_at desc);

create table if not exists public.stock_transfer_lines (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  transfer_id  uuid not null,
  product_id   uuid not null,
  quantity     numeric(18, 3) not null check (quantity > 0),
  note         text check (note is null or char_length(note) <= 300),
  created_at   timestamptz not null default now(),
  unique (transfer_id, product_id),
  foreign key (transfer_id, company_id) references public.stock_transfers (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id)
);
create index if not exists stock_transfer_lines_transfer_idx on public.stock_transfer_lines (transfer_id);

-- Stock movements may now be transfers, and point at their transfer.
alter table public.stock_movements add column if not exists transfer_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'stock_movements_transfer_fk') then
    alter table public.stock_movements
      add constraint stock_movements_transfer_fk foreign key (transfer_id, company_id)
      references public.stock_transfers (id, company_id);
  end if;
end;
$$;
create index if not exists stock_movements_transfer_idx on public.stock_movements (transfer_id) where transfer_id is not null;
alter table public.stock_movements drop constraint if exists stock_movements_kind_check;
alter table public.stock_movements
  add constraint stock_movements_kind_check check (kind in ('receipt', 'dispatch', 'return', 'adjustment', 'transfer'));

create or replace function public.stock_roles()
returns public.app_role[] language sql immutable set search_path = ''
as $$ select array['management', 'warehouse']::public.app_role[]; $$;

create or replace function public.prepare_stock_transfer()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if current_setting('ims.status_change', true) is distinct from 'on' then
      new.status := 'draft';
      new.sent_at := null; new.sent_by := null; new.received_at := null; new.received_by := null; new.cancelled_at := null;
    end if;
  elsif current_setting('ims.status_change', true) is distinct from 'on' then
    if (new.status, new.sent_at, new.received_at, new.cancelled_at, new.number, new.created_by)
       is distinct from (old.status, old.sent_at, old.received_at, old.cancelled_at, old.number, old.created_by) then
      raise exception 'Use the buttons in the app to send or receive the transfer.' using errcode = '42501';
    end if;
    if old.status <> 'draft' and (new.from_warehouse_id, new.to_warehouse_id) is distinct from (old.from_warehouse_id, old.to_warehouse_id) then
      raise exception 'The stores cannot be changed once the goods have left.' using errcode = '22023';
    end if;
  end if;
  new.reason := nullif(btrim(new.reason), '');
  new.vehicle := nullif(btrim(new.vehicle), '');
  new.notes := nullif(btrim(new.notes), '');
  return new;
end;
$$;

-- Items can only be changed while the transfer is a draft.
create or replace function public.guard_transfer_lines()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
begin
  if current_setting('ims.status_change', true) = 'on' then
    return coalesce(new, old);
  end if;
  select status into v_status from public.stock_transfers where id = coalesce(new.transfer_id, old.transfer_id);
  if v_status is distinct from 'draft' then
    raise exception 'The goods have left: the items can no longer be changed.' using errcode = '22023';
  end if;
  return coalesce(new, old);
end;
$$;

-- Send: the goods leave the source store (oldest expiry first) and are "in transit".
-- (The work itself, without the role check: also used by the demo.)
create or replace function public.stock_transfer_send(p_id uuid, p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  t public.stock_transfers;
  l record;
  b record;
  v_need numeric;
  v_take numeric;
  v_have numeric;
begin
  select * into t from public.stock_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfer not found.' using errcode = '22023'; end if;
  if t.status <> 'draft' then raise exception 'This transfer has already been sent.' using errcode = '22023'; end if;
  if not exists (select 1 from public.stock_transfer_lines where transfer_id = p_id) then
    raise exception 'Add at least one item before sending.' using errcode = '22023';
  end if;
  for l in select tl.*, p.name as product_name, p.unit from public.stock_transfer_lines tl
             join public.products p on p.id = tl.product_id
            where tl.transfer_id = p_id order by p.name loop
    select coalesce(sum(quantity), 0) into v_have from public.stock_movements
     where product_id = l.product_id and warehouse_id = t.from_warehouse_id;
    if v_have < l.quantity then
      raise exception 'Not enough % in the sending store: need %, have %.', l.product_name, trim_scale(l.quantity), trim_scale(v_have)
        using errcode = '22023';
    end if;
    v_need := l.quantity;
    for b in select batch_no, expiry_date, sum(quantity) as qty from public.stock_movements
              where product_id = l.product_id and warehouse_id = t.from_warehouse_id
              group by batch_no, expiry_date having sum(quantity) > 0
              order by expiry_date nulls last, batch_no loop
      exit when v_need <= 0;
      v_take := least(v_need, b.qty);
      insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, expiry_date, transfer_id, note)
      values (t.company_id, l.product_id, t.from_warehouse_id, -v_take, 'transfer', b.batch_no, b.expiry_date, p_id, 'Sent: ' || t.number);
      v_need := v_need - v_take;
    end loop;
  end loop;
  perform set_config('ims.status_change', 'on', true);
  update public.stock_transfers set status = 'in_transit', sent_at = now(), sent_by = p_user where id = p_id;
  perform set_config('ims.status_change', 'off', true);
  perform public.notify_roles(t.company_id, array['warehouse']::public.app_role[], p_user, 'transfer', 'info',
    'Stock on the way: ' || (select name from public.warehouses where id = t.to_warehouse_id),
    t.number || ' from ' || (select name from public.warehouses where id = t.from_warehouse_id) || ' · receive it when it arrives',
    '/transfers/' || p_id, 'trf-sent-' || p_id);
end;
$$;

create or replace function public.send_stock_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.stock_transfers where id = p_id;
  if v_company is null or not public.has_role(v_company, public.stock_roles()) then
    raise exception 'Only management and warehouse can send stock.' using errcode = '42501';
  end if;
  perform public.stock_transfer_send(p_id, auth.uid());
end;
$$;

-- Receive: the same batches arrive in the destination store.
create or replace function public.receive_stock_transfer(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  t public.stock_transfers;
begin
  select * into t from public.stock_transfers where id = p_id for update;
  if t.id is null or not public.has_role(t.company_id, public.stock_roles()) then
    raise exception 'Only management and warehouse can receive stock.' using errcode = '42501';
  end if;
  if t.status <> 'in_transit' then raise exception 'Only a transfer on the way can be received.' using errcode = '22023'; end if;
  insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, expiry_date, transfer_id, note)
  select t.company_id, m.product_id, t.to_warehouse_id, -sum(m.quantity), 'transfer', m.batch_no, m.expiry_date, p_id, 'Received: ' || t.number
    from public.stock_movements m
   where m.transfer_id = p_id and m.warehouse_id = t.from_warehouse_id
   group by m.product_id, m.batch_no, m.expiry_date
  having sum(m.quantity) < 0;
  perform set_config('ims.status_change', 'on', true);
  update public.stock_transfers
     set status = 'received', received_at = now(), received_by = auth.uid(), receive_note = nullif(btrim(p_note), '')
   where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Cancel: a draft is simply cancelled; goods on the way go back into the sending store.
create or replace function public.cancel_stock_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  t public.stock_transfers;
begin
  select * into t from public.stock_transfers where id = p_id for update;
  if t.id is null or not public.has_role(t.company_id, public.stock_roles()) then
    raise exception 'Transfer not found.' using errcode = '42501';
  end if;
  if t.status not in ('draft', 'in_transit') then
    raise exception 'A received transfer cannot be cancelled: make a transfer back instead.' using errcode = '22023';
  end if;
  if t.status = 'in_transit' then
    insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, expiry_date, transfer_id, note)
    select t.company_id, m.product_id, t.from_warehouse_id, -sum(m.quantity), 'transfer', m.batch_no, m.expiry_date, p_id, 'Cancelled: ' || t.number
      from public.stock_movements m
     where m.transfer_id = p_id and m.warehouse_id = t.from_warehouse_id
     group by m.product_id, m.batch_no, m.expiry_date
    having sum(m.quantity) < 0;
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.stock_transfers set status = 'cancelled', cancelled_at = now() where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Maximum stock level and reorder suggestions
-- ---------------------------------------------------------------------
alter table public.products add column if not exists max_level numeric(18, 3);
alter table public.products drop constraint if exists products_max_level_check;
alter table public.products
  add constraint products_max_level_check check (max_level is null or (max_level > 0 and max_level >= coalesce(reorder_level, 0)));

-- ---------------------------------------------------------------------
-- 4. Purchase requests (requisitions)
-- ---------------------------------------------------------------------
create table if not exists public.requisitions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  number         text not null default '',
  status         text not null default 'draft'
                 check (status in ('draft', 'submitted', 'approved', 'rejected', 'ordered', 'cancelled')),
  needed_by      date,
  warehouse_id   uuid,
  reason         text check (reason is null or char_length(reason) <= 500),
  notes          text check (notes is null or char_length(notes) <= 1000),
  submitted_at   timestamptz,
  decided_at     timestamptz,
  decided_by     uuid references auth.users (id) on delete set null,
  decision_note  text,
  po_id          uuid,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  foreign key (warehouse_id, company_id) references public.warehouses (id, company_id),
  foreign key (po_id, company_id) references public.purchase_orders (id, company_id) on delete set null (po_id)
);
create index if not exists requisitions_company_idx on public.requisitions (company_id, status, created_at desc);

create table if not exists public.requisition_lines (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  requisition_id  uuid not null,
  product_id      uuid,
  description     text not null check (char_length(btrim(description)) between 1 and 300),
  quantity        numeric(18, 3) not null check (quantity > 0),
  unit            text not null default 'pcs',
  note            text check (note is null or char_length(note) <= 300),
  created_at      timestamptz not null default now(),
  foreign key (requisition_id, company_id) references public.requisitions (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id)
);
create index if not exists requisition_lines_req_idx on public.requisition_lines (requisition_id);

-- Everyone except drivers may ask for goods.
create or replace function public.requisition_roles()
returns public.app_role[] language sql immutable set search_path = ''
as $$ select array['management', 'sales', 'procurement', 'warehouse', 'finance']::public.app_role[]; $$;

create or replace function public.prepare_requisition()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if current_setting('ims.status_change', true) is distinct from 'on' then
      new.status := 'draft';
      new.submitted_at := null; new.decided_at := null; new.decided_by := null; new.decision_note := null; new.po_id := null;
    end if;
  elsif current_setting('ims.status_change', true) is distinct from 'on' then
    if (new.status, new.submitted_at, new.decided_at, new.decided_by, new.decision_note, new.po_id, new.number, new.created_by)
       is distinct from (old.status, old.submitted_at, old.decided_at, old.decided_by, old.decision_note, old.po_id, old.number, old.created_by) then
      raise exception 'Use the buttons in the app to send or approve the request.' using errcode = '42501';
    end if;
    if old.status <> 'draft' then
      raise exception 'The request has been sent: it can no longer be changed.' using errcode = '22023';
    end if;
  end if;
  new.reason := nullif(btrim(new.reason), '');
  new.notes := nullif(btrim(new.notes), '');
  return new;
end;
$$;

create or replace function public.prepare_requisition_line()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
  p public.products;
begin
  if current_setting('ims.status_change', true) is distinct from 'on' then
    select status into v_status from public.requisitions where id = coalesce(new.requisition_id, old.requisition_id);
    if v_status is distinct from 'draft' then
      raise exception 'The request has been sent: the items can no longer be changed.' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.product_id is not null then
    select * into p from public.products where id = new.product_id;
    new.description := coalesce(nullif(btrim(new.description), ''), p.name);
    -- The product's own unit unless another one was chosen ('pcs' is the column default).
    if coalesce(nullif(btrim(new.unit), ''), 'pcs') = 'pcs' then new.unit := p.unit; end if;
  end if;
  new.description := btrim(new.description);
  return new;
end;
$$;

-- Send the request for approval (management's own requests are approved at once).
create or replace function public.submit_requisition(p_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  r public.requisitions;
  v_who text;
begin
  select * into r from public.requisitions where id = p_id for update;
  if r.id is null or not public.has_role(r.company_id, public.requisition_roles())
     or (r.created_by is distinct from auth.uid() and not public.has_role(r.company_id, array['management', 'procurement']::public.app_role[])) then
    raise exception 'Request not found.' using errcode = '42501';
  end if;
  if r.status <> 'draft' then raise exception 'This request has already been sent.' using errcode = '22023'; end if;
  if not exists (select 1 from public.requisition_lines where requisition_id = p_id) then
    raise exception 'Add at least one item before sending.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  if public.is_manager(r.company_id) then
    update public.requisitions set status = 'approved', submitted_at = now(), decided_at = now(), decided_by = auth.uid()
     where id = p_id;
    perform set_config('ims.status_change', 'off', true);
    perform public.notify_roles(r.company_id, array['procurement']::public.app_role[], auth.uid(), 'requisition', 'attention',
      'Approved purchase request to order', r.number || coalesce(' · ' || r.reason, ''), '/requisitions/' || p_id, 'req-ok-' || p_id);
    return 'approved';
  end if;
  update public.requisitions set status = 'submitted', submitted_at = now() where id = p_id;
  perform set_config('ims.status_change', 'off', true);
  select coalesce(nullif(btrim(full_name), ''), email) into v_who from public.profiles where id = auth.uid();
  perform public.notify_roles(r.company_id, array['management']::public.app_role[], auth.uid(), 'requisition', 'attention',
    'Purchase request to approve' || coalesce(': ' || v_who, ''), r.number || coalesce(' · ' || r.reason, ''),
    '/requisitions/' || p_id, 'req-sub-' || p_id);
  return 'submitted';
end;
$$;

create or replace function public.decide_requisition(p_id uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.requisitions;
begin
  select * into r from public.requisitions where id = p_id for update;
  if r.id is null or not public.is_manager(r.company_id) then
    raise exception 'Only management can approve purchase requests.' using errcode = '42501';
  end if;
  if r.status <> 'submitted' then raise exception 'This request is not waiting for approval.' using errcode = '22023'; end if;
  if not p_approve and coalesce(btrim(p_note), '') = '' then
    raise exception 'Say why the request is rejected.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.requisitions
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_at = now(), decided_by = auth.uid(), decision_note = nullif(btrim(p_note), '')
   where id = p_id;
  perform set_config('ims.status_change', 'off', true);
  update public.notifications set read_at = now()
   where company_id = r.company_id and read_at is null and dedupe_key = 'req-sub-' || p_id;
  perform public.notify(r.company_id, r.created_by, 'requisition', case when p_approve then 'info' else 'attention' end,
    case when p_approve then 'Purchase request approved' else 'Purchase request rejected' end,
    r.number || coalesce(' · ' || nullif(btrim(p_note), ''), ''), '/requisitions/' || p_id, 'req-dec-' || p_id);
  if p_approve then
    perform public.notify_roles(r.company_id, array['procurement']::public.app_role[], r.created_by, 'requisition', 'attention',
      'Approved purchase request to order', r.number || coalesce(' · ' || r.reason, ''), '/requisitions/' || p_id, 'req-ok-' || p_id);
  end if;
end;
$$;

-- Procurement turns an approved request into a draft purchase order for one supplier
-- (prices from the last cost; procurement checks and sends it as usual).
create or replace function public.requisition_to_po(p_id uuid, p_supplier uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  r public.requisitions;
  v_po uuid;
begin
  select * into r from public.requisitions where id = p_id for update;
  if r.id is null or not public.has_role(r.company_id, array['management', 'procurement']::public.app_role[]) then
    raise exception 'Only management and procurement can order.' using errcode = '42501';
  end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be ordered.' using errcode = '22023'; end if;
  v_po := public.create_purchase_order(r.company_id, p_supplier, null);
  insert into public.po_lines (company_id, po_id, line_no, product_id, description, quantity, unit, unit_price)
  select r.company_id, v_po, row_number() over (order by l.created_at, l.id), l.product_id, l.description, l.quantity, l.unit,
         coalesce(pc.last_cost, 0)
    from public.requisition_lines l
    left join public.product_costs pc on pc.product_id = l.product_id
   where l.requisition_id = p_id;
  update public.purchase_orders
     set notes = concat_ws(E'\n', notes, 'From purchase request ' || r.number),
         expected_date = coalesce(expected_date, r.needed_by)
   where id = v_po;
  perform set_config('ims.status_change', 'on', true);
  update public.requisitions set status = 'ordered', po_id = v_po where id = p_id;
  perform set_config('ims.status_change', 'off', true);
  update public.notifications set read_at = now()
   where company_id = r.company_id and read_at is null and dedupe_key = 'req-ok-' || p_id;
  perform public.notify(r.company_id, r.created_by, 'requisition', 'info', 'Your purchase request is being ordered',
    r.number || ' · ' || (select number from public.purchase_orders where id = v_po), '/requisitions/' || p_id, 'req-po-' || p_id);
  return v_po;
end;
$$;

create or replace function public.cancel_requisition(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.requisitions;
begin
  select * into r from public.requisitions where id = p_id for update;
  if r.id is null or not public.has_role(r.company_id, public.requisition_roles())
     or (r.created_by is distinct from auth.uid() and not public.is_manager(r.company_id)) then
    raise exception 'Request not found.' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'submitted', 'approved') then
    raise exception 'This request can no longer be cancelled.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.requisitions set status = 'cancelled' where id = p_id;
  perform set_config('ims.status_change', 'off', true);
  update public.notifications set read_at = now()
   where company_id = r.company_id and read_at is null and dedupe_key in ('req-sub-' || p_id, 'req-ok-' || p_id);
end;
$$;

-- Products at or below their reorder level: how much to order to reach the maximum (or twice the
-- reorder level when no maximum is set), less what is already on order; the last supplier and cost.
create or replace function public.reorder_suggestions(p_company uuid)
returns table (product_id uuid, sku text, name text, unit text, on_hand numeric, on_order numeric, reorder_level numeric,
               max_level numeric, suggest numeric, supplier_id uuid, supplier_name text, last_cost numeric, last_currency text)
language sql stable security definer set search_path = ''
as $$
  with stock as (
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
    select distinct on (l.product_id) l.product_id, o.supplier_id, s.name as supplier_name, l.unit_price, o.currency
      from public.po_lines l
      join public.purchase_orders o on o.id = l.po_id
      join public.suppliers s on s.id = o.supplier_id
     where o.company_id = p_company and o.status not in ('cancelled', 'draft') and l.product_id is not null
     order by l.product_id, o.order_date desc, o.created_at desc
  )
  select p.id, p.sku, p.name, p.unit,
         coalesce(st.qty, 0), coalesce(od.qty, 0) + coalesce(rq.qty, 0), p.reorder_level, p.max_level,
         greatest(coalesce(p.max_level, p.reorder_level * 2) - coalesce(st.qty, 0) - coalesce(od.qty, 0) - coalesce(rq.qty, 0), 0),
         lp.supplier_id, lp.supplier_name,
         case when public.has_role(p_company, array['management', 'procurement', 'finance']::public.app_role[]) then lp.unit_price end,
         lp.currency
    from public.products p
    left join stock st on st.product_id = p.id
    left join ordered od on od.product_id = p.id
    left join requested rq on rq.product_id = p.id
    left join last_po lp on lp.product_id = p.id
   where p.company_id = p_company
     and public.has_role(p_company, array['management', 'procurement', 'warehouse']::public.app_role[])
     and p.active and coalesce(p.reorder_level, 0) > 0
     and coalesce(st.qty, 0) <= p.reorder_level
   order by (coalesce(st.qty, 0) <= 0) desc, p.name;
$$;

-- ---------------------------------------------------------------------
-- 5. Triggers, row-level security and grants
-- ---------------------------------------------------------------------
drop trigger if exists stock_transfers_number on public.stock_transfers;
create trigger stock_transfers_number before insert on public.stock_transfers for each row execute function public.assign_doc_number();
drop trigger if exists stock_transfers_prepare on public.stock_transfers;
create trigger stock_transfers_prepare before insert or update on public.stock_transfers for each row execute function public.prepare_stock_transfer();
drop trigger if exists stock_transfer_lines_guard on public.stock_transfer_lines;
create trigger stock_transfer_lines_guard before insert or update or delete on public.stock_transfer_lines
  for each row execute function public.guard_transfer_lines();
drop trigger if exists requisitions_number on public.requisitions;
create trigger requisitions_number before insert on public.requisitions for each row execute function public.assign_doc_number();
drop trigger if exists requisitions_prepare on public.requisitions;
create trigger requisitions_prepare before insert or update on public.requisitions for each row execute function public.prepare_requisition();
drop trigger if exists requisition_lines_prepare on public.requisition_lines;
create trigger requisition_lines_prepare before insert or update or delete on public.requisition_lines
  for each row execute function public.prepare_requisition_line();

do $$
declare
  t text;
begin
  foreach t in array array['stock_transfers', 'requisitions'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['stock_transfers', 'stock_transfer_lines', 'requisitions', 'requisition_lines'] loop
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

-- Transfers: seen by everyone who sees stock; prepared by management and warehouse.
drop policy if exists stock_transfers_select on public.stock_transfers;
create policy stock_transfers_select on public.stock_transfers for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'procurement', 'warehouse', 'finance']::public.app_role[]));
drop policy if exists stock_transfers_insert on public.stock_transfers;
create policy stock_transfers_insert on public.stock_transfers for insert to authenticated
  with check (public.has_role(company_id, public.stock_roles()));
drop policy if exists stock_transfers_update on public.stock_transfers;
create policy stock_transfers_update on public.stock_transfers for update to authenticated
  using (public.has_role(company_id, public.stock_roles())) with check (public.has_role(company_id, public.stock_roles()));
grant insert (company_id, from_warehouse_id, to_warehouse_id, reason, vehicle, notes) on public.stock_transfers to authenticated;
grant update (from_warehouse_id, to_warehouse_id, reason, vehicle, notes) on public.stock_transfers to authenticated;

drop policy if exists stock_transfer_lines_select on public.stock_transfer_lines;
create policy stock_transfer_lines_select on public.stock_transfer_lines for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'procurement', 'warehouse', 'finance']::public.app_role[]));
drop policy if exists stock_transfer_lines_insert on public.stock_transfer_lines;
create policy stock_transfer_lines_insert on public.stock_transfer_lines for insert to authenticated
  with check (public.has_role(company_id, public.stock_roles()));
drop policy if exists stock_transfer_lines_update on public.stock_transfer_lines;
create policy stock_transfer_lines_update on public.stock_transfer_lines for update to authenticated
  using (public.has_role(company_id, public.stock_roles())) with check (public.has_role(company_id, public.stock_roles()));
drop policy if exists stock_transfer_lines_delete on public.stock_transfer_lines;
create policy stock_transfer_lines_delete on public.stock_transfer_lines for delete to authenticated
  using (public.has_role(company_id, public.stock_roles()));
grant insert (company_id, transfer_id, product_id, quantity, note) on public.stock_transfer_lines to authenticated;
grant update (quantity, note) on public.stock_transfer_lines to authenticated;
grant delete on public.stock_transfer_lines to authenticated;

-- Requests: each person sees their own; management and procurement see all of them.
drop policy if exists requisitions_select on public.requisitions;
create policy requisitions_select on public.requisitions for select to authenticated
  using (public.has_role(company_id, array['management', 'procurement']::public.app_role[])
         or (created_by = auth.uid() and public.has_role(company_id, public.requisition_roles())));
drop policy if exists requisitions_insert on public.requisitions;
create policy requisitions_insert on public.requisitions for insert to authenticated
  with check (public.has_role(company_id, public.requisition_roles()));
drop policy if exists requisitions_update on public.requisitions;
create policy requisitions_update on public.requisitions for update to authenticated
  using (created_by = auth.uid() and public.has_role(company_id, public.requisition_roles()))
  with check (created_by = auth.uid() and public.has_role(company_id, public.requisition_roles()));
grant insert (company_id, needed_by, warehouse_id, reason, notes) on public.requisitions to authenticated;
grant update (needed_by, warehouse_id, reason, notes) on public.requisitions to authenticated;

-- Can the signed-in person change the items of this request (their own draft)?
create or replace function public.can_edit_requisition(p_requisition uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.requisitions r
                  where r.id = p_requisition and r.created_by = auth.uid()
                    and public.has_role(r.company_id, public.requisition_roles()));
$$;
create or replace function public.can_see_requisition(p_requisition uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.requisitions r
                  where r.id = p_requisition
                    and (public.has_role(r.company_id, array['management', 'procurement']::public.app_role[])
                         or (r.created_by = auth.uid() and public.has_role(r.company_id, public.requisition_roles()))));
$$;

drop policy if exists requisition_lines_select on public.requisition_lines;
create policy requisition_lines_select on public.requisition_lines for select to authenticated
  using (public.can_see_requisition(requisition_id));
drop policy if exists requisition_lines_insert on public.requisition_lines;
create policy requisition_lines_insert on public.requisition_lines for insert to authenticated
  with check (public.can_edit_requisition(requisition_id));
drop policy if exists requisition_lines_update on public.requisition_lines;
create policy requisition_lines_update on public.requisition_lines for update to authenticated
  using (public.can_edit_requisition(requisition_id)) with check (public.can_edit_requisition(requisition_id));
drop policy if exists requisition_lines_delete on public.requisition_lines;
create policy requisition_lines_delete on public.requisition_lines for delete to authenticated
  using (public.can_edit_requisition(requisition_id));
grant insert (company_id, requisition_id, product_id, description, quantity, unit, note) on public.requisition_lines to authenticated;
grant update (description, quantity, unit, note) on public.requisition_lines to authenticated;
grant delete on public.requisition_lines to authenticated;

-- ---------------------------------------------------------------------
-- 6. Clearing test data before go-live also clears transfers and requests
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
                    'stock_transfers', 'stock_transfer_lines', 'requisitions', 'requisition_lines');
  delete from public.code_counters
   where company_id = p_company
     and kind ~ '^(rfqs|quotations|supplier_rfqs|purchase_orders|goods_receipts|deliveries|invoices|payments|supplier_bills|supplier_payments|expenses|opportunities|tenders|stock_transfers|requisitions)-';
  update public.companies set alerts_checked_at = null where id = p_company;

  perform set_config('ims.status_change', 'off', true);
  perform set_config('ims.allow_line_copy', 'off', true);
  return 'Test transactions cleared for ' || v_name || '. Master data, contracts, documents, team and settings were kept.';
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Feature catalogue: transfers, purchase requests and insights are live
-- ---------------------------------------------------------------------
update public.features set status = 'live', route = '/transfers',
       tutorial = '[{"title":"Start a transfer","body":"Choose the store the goods leave and the store they go to, then add the items."},{"title":"Send","body":"The goods leave the first store and show as on the way."},{"title":"Receive","body":"When they arrive, the receiving store taps Received and the stock is there."}]'
 where key = 'stock_transfers';
update public.features set status = 'live', route = '/requisitions',
       tutorial = '[{"title":"Ask for goods","body":"Anyone can make a purchase request: what is needed, how many and by when."},{"title":"Approval","body":"Management approves or rejects it, with a note."},{"title":"Order","body":"Procurement turns the approved request into a purchase order in one tap."}]'
 where key = 'requisitions';
update public.features set status = 'live', route = '/insights',
       tutorial = '[{"title":"Open Insights","body":"See which suppliers deliver on time, which stock does not move and which quotations turn into orders."},{"title":"Act on it","body":"Each list links to the product, supplier or client so you can act straight away."},{"title":"Check monthly","body":"Look again each month to see what has changed."}]'
 where key = 'bi_insights';

-- ---------------------------------------------------------------------
-- 8. Demos: a transfer on the way, a purchase request to approve, maximum levels
-- ---------------------------------------------------------------------
create or replace function public.demo_seed_stage14_ops(p_company uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_wh uuid;
  v_main uuid;
  v_other uuid;
  v_t uuid;
  v_r uuid;
  p record;
  v_n int := 0;
begin
  if not exists (select 1 from public.companies where id = p_company and is_demo) then return; end if;
  select user_id into v_owner from public.memberships where company_id = p_company and role = 'management' and active
   order by created_at limit 1;
  select coalesce((select user_id from public.memberships where company_id = p_company and role = 'warehouse' and active
                    order by created_at limit 1), v_owner) into v_wh;
  select id into v_main from public.warehouses where company_id = p_company and active order by (code = 'MAIN') desc, created_at limit 1;
  select id into v_other from public.warehouses where company_id = p_company and active and id <> v_main order by created_at limit 1;

  -- Maximum levels at three times the reorder level.
  update public.products set max_level = reorder_level * 3
   where company_id = p_company and coalesce(reorder_level, 0) > 0 and max_level is null;

  -- A transfer on the way to the second store (only when there is one).
  if v_other is not null then
    perform set_config('ims.status_change', 'on', true);
    insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id, reason, vehicle, created_by)
    values (p_company, v_main, v_other, 'Top up the branch store', 'T 482 DKL', v_wh)
    returning id into v_t;
    perform set_config('ims.status_change', 'off', true);
    for p in select m.product_id, sum(m.quantity) as qty from public.stock_movements m
              where m.company_id = p_company and m.warehouse_id = v_main
              group by m.product_id having sum(m.quantity) >= 10 order by sum(m.quantity) desc limit 2 loop
      insert into public.stock_transfer_lines (company_id, transfer_id, product_id, quantity)
      values (p_company, v_t, p.product_id, floor(p.qty / 4));
      v_n := v_n + 1;
    end loop;
    if v_n > 0 then
      perform public.stock_transfer_send(v_t, v_wh);
      perform set_config('ims.status_change', 'on', true);
      update public.stock_transfers set sent_at = now() - interval '1 day' where id = v_t;
      perform set_config('ims.status_change', 'off', true);
    else
      delete from public.stock_transfers where id = v_t;
    end if;
  end if;

  -- A purchase request waiting for approval.
  perform set_config('ims.status_change', 'on', true);
  insert into public.requisitions (company_id, needed_by, warehouse_id, reason, status, submitted_at, created_by)
  values (p_company, (now() at time zone 'Africa/Dar_es_Salaam')::date + 10, v_main,
          'Running low before the month-end orders', 'submitted', now() - interval '3 hours', v_wh)
  returning id into v_r;
  insert into public.requisition_lines (company_id, requisition_id, product_id, description, quantity, unit)
  select p_company, v_r, x.id, x.name, greatest(x.reorder_level * 2, 1), x.unit
    from public.products x
   where x.company_id = p_company and x.active and coalesce(x.reorder_level, 0) > 0
   order by x.created_at limit 2;
  if not exists (select 1 from public.requisition_lines where requisition_id = v_r) then
    insert into public.requisition_lines (company_id, requisition_id, description, quantity, unit)
    values (p_company, v_r, 'Printer paper A4', 10, 'box');
  end if;
  perform set_config('ims.status_change', 'off', true);
  perform public.notify_roles(p_company, array['management']::public.app_role[], null, 'requisition', 'attention',
    'Purchase request to approve', (select number from public.requisitions where id = v_r) || ' · Running low before the month-end orders',
    '/requisitions/' || v_r, 'req-sub-' || v_r);
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
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
revoke execute on function
  public.assign_doc_number(),
  public.stock_roles(),
  public.prepare_stock_transfer(),
  public.guard_transfer_lines(),
  public.stock_transfer_send(uuid, uuid),
  public.send_stock_transfer(uuid),
  public.receive_stock_transfer(uuid, text),
  public.cancel_stock_transfer(uuid),
  public.reorder_suggestions(uuid),
  public.requisition_roles(),
  public.prepare_requisition(),
  public.prepare_requisition_line(),
  public.submit_requisition(uuid),
  public.decide_requisition(uuid, boolean, text),
  public.requisition_to_po(uuid, uuid),
  public.cancel_requisition(uuid),
  public.can_edit_requisition(uuid),
  public.can_see_requisition(uuid),
  public.reset_company_transactions(uuid, text),
  public.demo_seed_stage14_ops(uuid),
  public.create_demo_company(public.business_level)
from public, anon;
revoke execute on function
  public.prepare_stock_transfer(),
  public.guard_transfer_lines(),
  public.stock_transfer_send(uuid, uuid),
  public.prepare_requisition(),
  public.prepare_requisition_line(),
  public.reset_company_transactions(uuid, text),
  public.demo_seed_stage14_ops(uuid)
from authenticated;
grant execute on function
  public.stock_roles(),
  public.send_stock_transfer(uuid),
  public.receive_stock_transfer(uuid, text),
  public.cancel_stock_transfer(uuid),
  public.reorder_suggestions(uuid),
  public.requisition_roles(),
  public.submit_requisition(uuid),
  public.decide_requisition(uuid, boolean, text),
  public.requisition_to_po(uuid, uuid),
  public.cancel_requisition(uuid),
  public.can_edit_requisition(uuid),
  public.can_see_requisition(uuid),
  public.create_demo_company(public.business_level)
to authenticated;
