-- =====================================================================
-- Order progress: every order (a quotation and what follows it) shows its
-- status, a progress bar, the next stage and, for managers only, the
-- person responsible for each stage.
--
-- Stages, in order:
--   Quoted → Approved → Sent to client → Won → Goods bought (only when the
--   order has purchase orders) → Delivered → Invoiced → Paid
--
-- The person responsible for a stage is the one a manager assigned, or
-- else the person who works on that record (who made the quotation, the
-- driver of the delivery, ...). Only managers can see or change who is
-- responsible: order_stage_owners has a managers-only policy, and the
-- order_progress() functions leave the names out for everyone else.
--
-- Safe to run more than once.
-- =====================================================================

create table if not exists public.order_stage_owners (
  quotation_id uuid not null references public.quotations (id) on delete cascade,
  company_id   uuid not null references public.companies (id) on delete cascade,
  stage        text not null check (stage in ('quoted', 'approved', 'sent', 'won', 'bought', 'delivered', 'invoiced', 'paid')),
  user_id      uuid not null references auth.users (id) on delete cascade,
  assigned_by  uuid references auth.users (id) on delete set null,
  assigned_at  timestamptz not null default now(),
  primary key (quotation_id, stage)
);
create index if not exists order_stage_owners_company_idx on public.order_stage_owners (company_id);
create index if not exists order_stage_owners_user_idx on public.order_stage_owners (user_id);

-- Order progress looks these up per order (lists show up to 100 orders).
create index if not exists purchase_orders_quotation_idx on public.purchase_orders (quotation_id) where quotation_id is not null;
create index if not exists deliveries_quotation_idx on public.deliveries (quotation_id) where quotation_id is not null;

alter table public.order_stage_owners enable row level security;
drop policy if exists order_stage_owners_select on public.order_stage_owners;
create policy order_stage_owners_select on public.order_stage_owners
  for select to authenticated using (public.is_manager(company_id));
revoke all on public.order_stage_owners from public, anon, authenticated;
grant select on public.order_stage_owners to authenticated;

-- ---------------------------------------------------------------------
-- The stages of one order (internal). p_names: include who is responsible.
-- ---------------------------------------------------------------------
create or replace function public.order_progress_of(p_quotation uuid, p_names boolean)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  q          public.quotations;
  v_pos      integer;
  v_pos_open integer;
  v_direct   boolean;
  v_dn_done  boolean;
  v_dn_user  uuid;
  v_inv      integer;
  v_inv_out  boolean;
  v_inv_paid boolean;
  v_inv_user uuid;
  v_po_user  uuid;
  v_stages   jsonb := '[]'::jsonb;
  v_done     integer := 0;
  v_next     jsonb;
  v_current  jsonb;
  v_status   text;
  s          record;
  v_owner    uuid;
  v_assigned boolean;
begin
  select * into q from public.quotations where id = p_quotation;
  if q.id is null then
    return null;
  end if;

  select count(*) filter (where status <> 'cancelled'),
         count(*) filter (where status not in ('cancelled', 'received', 'closed')),
         coalesce(bool_or(direct_to_client and status in ('received', 'closed')), false)
    into v_pos, v_pos_open, v_direct
    from public.purchase_orders where quotation_id = p_quotation;
  select created_by into v_po_user from public.purchase_orders
   where quotation_id = p_quotation and status <> 'cancelled' order by created_at desc limit 1;

  select coalesce(bool_or(status = 'delivered'), false) into v_dn_done
    from public.deliveries where quotation_id = p_quotation;
  select coalesce(driver_id, created_by) into v_dn_user from public.deliveries
   where quotation_id = p_quotation and status <> 'cancelled' order by created_at desc limit 1;

  select count(*) filter (where status <> 'cancelled'),
         coalesce(bool_or(status in ('issued', 'partly_paid', 'paid')), false),
         count(*) filter (where status <> 'cancelled') > 0
           and coalesce(bool_and(status = 'paid') filter (where status <> 'cancelled'), false)
    into v_inv, v_inv_out, v_inv_paid
    from public.invoices where quotation_id = p_quotation;
  select coalesce(issued_by, created_by) into v_inv_user from public.invoices
   where quotation_id = p_quotation and status <> 'cancelled' order by created_at desc limit 1;

  for s in
    select * from (values
      (1, 'quoted',    'Quoted',         true,                                          q.created_by),
      (2, 'approved',  'Approved',       q.status in ('approved', 'sent', 'accepted'),  q.approved_by),
      (3, 'sent',      'Sent to client', q.status in ('sent', 'accepted'),              q.created_by),
      (4, 'won',       'Won',            q.status = 'accepted',                         q.created_by),
      (5, 'bought',    'Goods bought',   v_pos > 0 and v_pos_open = 0,                  v_po_user),
      (6, 'delivered', 'Delivered',      v_dn_done or v_direct,                         v_dn_user),
      (7, 'invoiced',  'Invoiced',       v_inv_out,                                     v_inv_user),
      (8, 'paid',      'Paid',           v_inv_paid,                                    v_inv_user)
    ) as t (n, key, label, done, fallback)
    where t.key <> 'bought' or v_pos > 0
    order by n
  loop
    v_owner := null;
    v_assigned := false;
    if p_names then
      select o.user_id into v_owner from public.order_stage_owners o
       where o.quotation_id = p_quotation and o.stage = s.key;
      v_assigned := v_owner is not null;
      v_owner := coalesce(v_owner, s.fallback);
    end if;
    v_stages := v_stages || jsonb_build_object(
      'key', s.key, 'label', s.label, 'done', s.done,
      'owner_id', v_owner,
      'owner', case when v_owner is not null then
                 (select coalesce(nullif(btrim(p.full_name), ''), p.email, 'Team member')
                    from public.profiles p where p.id = v_owner) end,
      'assigned', v_assigned);
    if s.done then
      v_done := v_done + 1;
      v_current := v_stages -> -1;
    elsif v_next is null then
      v_next := v_stages -> -1;
    end if;
  end loop;

  v_status := case
    when q.status in ('rejected', 'cancelled', 'superseded') then q.status
    when v_next is null then 'completed'
    else 'in_progress' end;

  return jsonb_build_object(
    'quotation_id', q.id,
    'status', v_status,
    'stages', v_stages,
    'done', v_done,
    'total', jsonb_array_length(v_stages),
    'percent', round(100.0 * v_done / greatest(jsonb_array_length(v_stages), 1)),
    -- "Now at": the last stage done; "next": the first not done yet.
    'current', v_current,
    'next', case when v_status = 'in_progress' then v_next end,
    'can_assign', p_names);
end;
$$;

-- One order, for anyone in the company who can see the quotation.
create or replace function public.order_progress(p_quotation uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.quotations where id = p_quotation;
  if v_company is null or not public.is_member(v_company) then
    raise exception 'Order not found.' using errcode = '42501';
  end if;
  return public.order_progress_of(p_quotation, public.is_manager(v_company));
end;
$$;

-- Several orders at once (lists). Orders of other companies are left out.
create or replace function public.orders_progress(p_quotations uuid[])
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_out jsonb := '{}'::jsonb;
  r     record;
begin
  for r in
    select q.id, q.company_id from public.quotations q
     where q.id = any (coalesce(p_quotations, '{}')) limit 200
  loop
    if public.is_member(r.company_id) then
      v_out := v_out || jsonb_build_object(r.id::text, public.order_progress_of(r.id, public.is_manager(r.company_id)));
    end if;
  end loop;
  return v_out;
end;
$$;

-- Managers: choose who is responsible for a stage (null = back to the default).
create or replace function public.set_order_stage_owner(p_quotation uuid, p_stage text, p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.quotations where id = p_quotation;
  if v_company is null or not public.is_manager(v_company) then
    raise exception 'Only management can choose who is responsible.' using errcode = '42501';
  end if;
  if p_stage is null or p_stage not in ('quoted', 'approved', 'sent', 'won', 'bought', 'delivered', 'invoiced', 'paid') then
    raise exception 'Unknown stage.' using errcode = '22023';
  end if;
  if p_user is null then
    delete from public.order_stage_owners where quotation_id = p_quotation and stage = p_stage;
  else
    if not exists (select 1 from public.memberships m
                    where m.company_id = v_company and m.user_id = p_user and m.active) then
      raise exception 'That person is not in your team.' using errcode = '22023';
    end if;
    insert into public.order_stage_owners (quotation_id, company_id, stage, user_id, assigned_by)
    values (p_quotation, v_company, p_stage, p_user, auth.uid())
    on conflict (quotation_id, stage) do update
      set user_id = excluded.user_id, assigned_by = excluded.assigned_by, assigned_at = now();
  end if;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (v_company, auth.uid(), 'assign', 'order_stage', p_quotation::text,
          jsonb_build_object('stage', p_stage, 'user', p_user));
end;
$$;

revoke execute on function
  public.order_progress_of(uuid, boolean),
  public.order_progress(uuid),
  public.orders_progress(uuid[]),
  public.set_order_stage_owner(uuid, text, uuid)
from public, anon, authenticated;
grant execute on function
  public.order_progress(uuid),
  public.orders_progress(uuid[]),
  public.set_order_stage_owner(uuid, text, uuid)
to authenticated;

notify pgrst, 'reload schema';
