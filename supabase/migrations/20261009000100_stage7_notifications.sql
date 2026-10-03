-- =====================================================================
-- TRIUMPH IMS  ·  Stage 7: notifications, alerts, push and email
--
-- Notifications are rows per person. They are created:
--   • immediately, by triggers, when something happens that someone must
--     act on (an RFQ assigned to you, a quotation or PO waiting for your
--     approval, an order won, goods arrived, a delivery assigned to you,
--     delivered and ready to invoice, a payment received…);
--   • by the alert check (run_company_alerts), for things that become
--     urgent with time (overdue invoices, RFQs due, quotations expiring,
--     late POs, supplier bills due, batches expiring, low stock). It runs
--     at most every 30 minutes when someone opens the app, and every few
--     minutes from the server's scheduled job. Each alert is sent once
--     (dedupe key), with reminders when it gets worse.
--
-- Severity: info (in the app only), attention and critical (also sent as
-- phone push and email, if the person has them switched on).
--
-- Push and email are sent by the web server, which collects pending
-- notifications with claim_outbox(secret). The secret is set once in the
-- SQL editor with set_outbox_secret('…') and the same value is put in the
-- hosting settings as OUTBOX_SECRET. No service key is needed.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  kind           text not null,
  severity       text not null default 'info' check (severity in ('info', 'attention', 'critical')),
  title          text not null,
  body           text,
  link           text,
  dedupe_key     text,
  created_at     timestamptz not null default now(),
  read_at        timestamptz,
  dispatched_at  timestamptz
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_outbox_idx on public.notifications (created_at) where dispatched_at is null and severity <> 'info';
create unique index notifications_dedupe_key on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

create table public.notification_settings (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  email_alerts  boolean not null default true,
  push_alerts   boolean not null default true,
  updated_at    timestamptz not null default now()
);

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint    text not null unique check (endpoint like 'https://%'),
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Hashed secrets used by the web server (never readable by app users).
create table public.app_secrets (
  name  text primary key,
  hash  text not null
);

alter table public.companies add column if not exists alerts_checked_at timestamptz;

alter table public.notifications         enable row level security;
alter table public.notification_settings enable row level security;
alter table public.push_subscriptions    enable row level security;
alter table public.app_secrets           enable row level security;

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notification_settings_own on public.notification_settings for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.notifications, public.notification_settings, public.push_subscriptions, public.app_secrets
  from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert on public.notification_settings to authenticated;
grant update (email_alerts, push_alerts) on public.notification_settings to authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;

-- ---------------------------------------------------------------------
-- Helpers (internal: only used by the triggers and functions below)
-- ---------------------------------------------------------------------
create or replace function public.notify(p_company uuid, p_user uuid, p_kind text, p_severity text, p_title text,
                                         p_body text, p_link text, p_key text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_user is null then return; end if;
  if not exists (select 1 from public.memberships where company_id = p_company and user_id = p_user and active) then
    return;
  end if;
  insert into public.notifications (company_id, user_id, kind, severity, title, body, link, dedupe_key)
  values (p_company, p_user, p_kind, p_severity, left(p_title, 200), left(p_body, 500), p_link, p_key)
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end;
$$;

-- Everyone in the company with one of the roles, except p_exclude.
create or replace function public.notify_roles(p_company uuid, p_roles public.app_role[], p_exclude uuid, p_kind text,
                                               p_severity text, p_title text, p_body text, p_link text, p_key text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m record;
begin
  for m in select user_id from public.memberships
            where company_id = p_company and active and role = any (p_roles)
              and user_id is distinct from p_exclude loop
    perform public.notify(p_company, m.user_id, p_kind, p_severity, p_title, p_body, p_link, p_key);
  end loop;
end;
$$;

create or replace function public.fmt_money(p_amount numeric, p_currency text)
returns text language sql immutable set search_path = ''
as $$
  select p_currency || ' ' || case when p_currency = 'TZS' then to_char(round(p_amount), 'FM999,999,999,999,990')
                                   else to_char(p_amount, 'FM999,999,999,990.00') end;
$$;

-- ---------------------------------------------------------------------
-- Event notifications
-- ---------------------------------------------------------------------
create or replace function public.on_rfq_assigned()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_client text;
begin
  if new.assigned_to is null or new.assigned_to is not distinct from auth.uid() then return null; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return null; end if;
  if new.status not in ('new', 'quoting') then return null; end if;
  select name into v_client from public.clients where id = new.client_id;
  perform public.notify(new.company_id, new.assigned_to, 'rfq_assigned', 'attention',
    'New client RFQ: ' || v_client,
    new.number || coalesce(' · ' || new.title, '') || coalesce(' · due ' || to_char(new.due_on, 'DD Mon'), ''),
    '/rfqs/' || new.id, 'rfq-assigned-' || new.id || '-' || new.assigned_to);
  return null;
end;
$$;
create trigger rfqs_notify after insert or update of assigned_to on public.rfqs
  for each row execute function public.on_rfq_assigned();

create or replace function public.on_quotation_status()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_client text;
  v_no text := new.number || case when new.revision > 0 then '-R' || new.revision else '' end;
  v_link text := '/quotations/' || new.id;
  v_value text := public.fmt_money(new.total, new.currency);
begin
  if new.status is not distinct from old.status then return null; end if;
  select name into v_client from public.clients where id = new.client_id;

  if new.status = 'pending_approval' then
    perform public.notify_roles(new.company_id, array['management']::public.app_role[], new.submitted_by,
      'quote_approval', 'attention', 'Quotation waiting for your approval',
      v_no || ' · ' || v_client || ' · ' || v_value || coalesce(' · ' || new.approval_reason, ''), v_link, null);
  elsif old.status = 'pending_approval' and new.status = 'approved' then
    perform public.notify(new.company_id, new.submitted_by, 'quote_approved', 'info',
      'Quotation approved: ' || v_no, v_client || ' · you can now send it', v_link, null);
  elsif old.status = 'pending_approval' and new.status = 'draft' then
    perform public.notify(new.company_id, new.submitted_by, 'quote_returned', 'attention',
      'Quotation sent back: ' || v_no, coalesce(new.review_note, 'Changes needed'), v_link, null);
  elsif new.status = 'accepted' then
    if new.created_by is distinct from auth.uid() then
      perform public.notify(new.company_id, new.created_by, 'order_won', 'info',
        'Order won: ' || v_client, v_no || ' · ' || v_value, v_link, null);
    end if;
    perform public.notify_roles(new.company_id, array['procurement', 'management']::public.app_role[], auth.uid(),
      'order_won', 'attention', 'Order won – arrange the goods', v_client || ' · ' || v_no || ' · ' || v_value, v_link,
      'order-won-' || new.id);
  elsif new.status = 'rejected' and new.created_by is distinct from auth.uid() then
    perform public.notify(new.company_id, new.created_by, 'order_lost', 'info',
      'Quotation declined: ' || v_no, v_client || coalesce(' · ' || new.outcome_reason, ''), v_link, null);
  end if;
  return null;
end;
$$;
create trigger quotations_notify after update of status on public.quotations
  for each row execute function public.on_quotation_status();

create or replace function public.on_po_status()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_supplier text;
  v_link text := '/purchase-orders/' || new.id;
  q record;
begin
  if new.status is not distinct from old.status then return null; end if;
  select name into v_supplier from public.suppliers where id = new.supplier_id;

  if new.status = 'pending_approval' then
    perform public.notify_roles(new.company_id, array['management']::public.app_role[], new.submitted_by,
      'po_approval', 'attention', 'Purchase order waiting for your approval',
      new.number || ' · ' || v_supplier || ' · ' || public.fmt_money(new.total, new.currency), v_link, null);
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
create trigger purchase_orders_notify after update of status on public.purchase_orders
  for each row execute function public.on_po_status();

create or replace function public.on_delivery_change()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_client text;
  v_link text := '/deliveries/' || new.id;
begin
  select name into v_client from public.clients where id = new.client_id;

  if new.status = 'dispatched' and new.driver_id is not null
     and (old.status <> 'dispatched' or new.driver_id is distinct from old.driver_id)
     and new.driver_id is distinct from auth.uid() then
    perform public.notify(new.company_id, new.driver_id, 'delivery_assigned', 'attention',
      'Delivery for you: ' || v_client,
      new.number || coalesce(' · ' || new.delivery_site, '') || coalesce(' · ' || new.vehicle, ''),
      '/driver', 'dn-driver-' || new.id || '-' || new.driver_id);
  end if;

  if new.status is distinct from old.status then
    if new.status = 'delivered' then
      if new.created_by is distinct from auth.uid() then
        perform public.notify(new.company_id, new.created_by, 'delivered', 'info',
          'Delivered: ' || v_client, new.number || coalesce(' · received by ' || new.received_by_name, ''), v_link, null);
      end if;
      perform public.notify_roles(new.company_id, array['finance']::public.app_role[], auth.uid(),
        'ready_to_invoice', 'attention', 'Delivered – ready to invoice', v_client || ' · ' || new.number, v_link,
        'to-invoice-' || new.id);
    elsif new.status = 'failed' then
      perform public.notify_roles(new.company_id, array['management', 'warehouse']::public.app_role[], auth.uid(),
        'delivery_failed', 'critical', 'Delivery failed: ' || v_client,
        new.number || coalesce(' · ' || new.failed_reason, ''), v_link, 'dn-failed-' || new.id);
      if new.created_by is distinct from auth.uid() then
        perform public.notify(new.company_id, new.created_by, 'delivery_failed', 'critical', 'Delivery failed: ' || v_client,
          new.number || coalesce(' · ' || new.failed_reason, ''), v_link, 'dn-failed-' || new.id);
      end if;
    end if;
  end if;
  return null;
end;
$$;
create trigger deliveries_notify after update on public.deliveries
  for each row execute function public.on_delivery_change();

create or replace function public.on_payment_received()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_client text;
  v_inv text;
  v_seller uuid;
begin
  select c.name, i.number, q.created_by into v_client, v_inv, v_seller
    from public.invoices i
    join public.clients c on c.id = i.client_id
    left join public.quotations q on q.id = i.quotation_id
   where i.id = new.invoice_id;
  perform public.notify_roles(new.company_id, array['management']::public.app_role[], auth.uid(), 'payment_received', 'info',
    'Payment received: ' || v_client, public.fmt_money(new.amount, new.currency) || ' · ' || v_inv,
    '/invoices/' || new.invoice_id, null);
  if v_seller is distinct from auth.uid() then
    perform public.notify(new.company_id, v_seller, 'payment_received', 'info', 'Your client paid: ' || v_client,
      public.fmt_money(new.amount, new.currency) || ' · ' || v_inv, '/invoices/' || new.invoice_id, null);
  end if;
  return null;
end;
$$;
create trigger payments_notify after insert on public.payments
  for each row execute function public.on_payment_received();

-- ---------------------------------------------------------------------
-- Time-based alerts for one company. Returns how many were created.
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
begin
  select count(*) into v_before from public.notifications where company_id = p_company;

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

  -- Overdue client invoices: reminders at 1, 31, 61 and 91 days.
  for r in select i.id, i.number, i.due_date, i.total - i.amount_paid as owed, i.currency, c.name as client,
                  v_today - i.due_date as late
             from public.invoices i join public.clients c on c.id = i.client_id
            where i.company_id = p_company and i.status in ('issued', 'partly_paid') and i.due_date < v_today loop
    v_band := case when r.late > 90 then 91 when r.late > 60 then 61 when r.late > 30 then 31 else 1 end;
    v_sev := case when r.late > 60 then 'critical' else 'attention' end;
    perform public.notify_roles(p_company, array['finance', 'management']::public.app_role[], null, 'invoice_overdue', v_sev,
      'Invoice overdue: ' || r.client,
      r.number || ' · ' || public.fmt_money(r.owed, r.currency) || ' · ' || r.late || ' days late',
      '/invoices/' || r.id, 'inv-od-' || r.id || '-' || v_band);
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

  update public.companies set alerts_checked_at = now() where id = p_company;
  select count(*) into v_after from public.notifications where company_id = p_company;
  return v_after - v_before;
end;
$$;

-- Called when someone opens the app: runs the check at most every 30 minutes.
create or replace function public.refresh_alerts(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_last timestamptz;
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  select alerts_checked_at into v_last from public.companies where id = p_company for update;
  if v_last is not null and v_last > now() - interval '30 minutes' then
    return 0;
  end if;
  return public.run_company_alerts(p_company);
end;
$$;

-- ---------------------------------------------------------------------
-- Server outbox (push + email), protected by a shared secret
-- ---------------------------------------------------------------------
create or replace function public.secret_ok(p_name text, p_secret text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.app_secrets
                  where name = p_name and hash = encode(sha256(convert_to(coalesce(p_secret, ''), 'UTF8')), 'hex'));
$$;

-- Run once in the SQL editor:  select public.set_outbox_secret('a long random text');
create or replace function public.set_outbox_secret(p_secret text)
returns text language plpgsql security definer set search_path = ''
as $$
begin
  if char_length(coalesce(p_secret, '')) < 24 then
    raise exception 'Use at least 24 characters.' using errcode = '22023';
  end if;
  insert into public.app_secrets (name, hash) values ('outbox', encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'))
  on conflict (name) do update set hash = excluded.hash;
  return 'Outbox secret saved. Put the same text in Netlify as OUTBOX_SECRET.';
end;
$$;

-- Runs the alert check for every company (scheduled job).
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
  for c in select id from public.companies loop
    v_total := v_total + public.run_company_alerts(c.id);
  end loop;
  return v_total;
end;
$$;

-- Hands pending attention/critical notifications to the server (once).
create or replace function public.claim_outbox(p_secret text, p_limit integer)
returns table (
  notification_id uuid, user_id uuid, email text, full_name text, company_name text, title text, body text,
  link text, severity text, created_at timestamptz, want_email boolean, want_push boolean, subscriptions jsonb
)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return query
  with picked as (
    select n.id from public.notifications n
     where n.dispatched_at is null and n.severity <> 'info' and n.created_at > now() - interval '2 days'
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update skip locked
  ), marked as (
    update public.notifications n set dispatched_at = now() from picked where n.id = picked.id
    returning n.*
  )
  select m.id, m.user_id, pr.email, pr.full_name, co.name, m.title, m.body, m.link, m.severity, m.created_at,
         coalesce(ns.email_alerts, true), coalesce(ns.push_alerts, true),
         coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                     from public.push_subscriptions s where s.user_id = m.user_id), '[]'::jsonb)
    from marked m
    join public.companies co on co.id = m.company_id
    left join public.profiles pr on pr.id = m.user_id
    left join public.notification_settings ns on ns.user_id = m.user_id;
end;
$$;

-- Phones that unsubscribed or reinstalled: forget their push addresses.
create or replace function public.drop_push_endpoints(p_secret text, p_endpoints text[])
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v int;
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where endpoint = any (p_endpoints);
  get diagnostics v = row_count;
  return v;
end;
$$;

-- "Send me a test" button in the app (at most one a minute).
create or replace function public.send_test_notification(p_company uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  perform public.notify(p_company, auth.uid(), 'test', 'attention', 'Test notification',
    'If this reached your phone or inbox, alerts are working.', '/notifications',
    'test-' || to_char(now(), 'YYYYMMDDHH24MI'));
end;
$$;

revoke execute on function
  public.send_test_notification(uuid),
  public.notify(uuid, uuid, text, text, text, text, text, text),
  public.notify_roles(uuid, public.app_role[], uuid, text, text, text, text, text, text),
  public.run_company_alerts(uuid), public.set_outbox_secret(text), public.secret_ok(text, text),
  public.refresh_alerts(uuid), public.run_all_alerts(text), public.claim_outbox(text, integer),
  public.drop_push_endpoints(text, text[])
from public, anon, authenticated;
grant execute on function public.refresh_alerts(uuid), public.send_test_notification(uuid) to authenticated;
-- The web server calls these with the publishable key and the secret.
grant execute on function public.run_all_alerts(text), public.claim_outbox(text, integer),
  public.drop_push_endpoints(text, text[]) to anon, authenticated;
grant execute on function public.fmt_money(numeric, text) to authenticated;

notify pgrst, 'reload schema';
