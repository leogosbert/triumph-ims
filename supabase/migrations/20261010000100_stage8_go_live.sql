-- =====================================================================
-- TRIUMPH IMS  ·  Stage 8: go-live hardening and tools
--
-- Security fixes from the pre-launch review:
--   1. Deliveries: only the assigned driver (still an active member),
--      management or warehouse can confirm/fail a delivery; the driver
--      must be an active team member; after dispatch only management or
--      warehouse can change the driver; the signature file must exist.
--   2. Exchange rates: documents in the base currency always use rate 1;
--      foreign-currency documents must stay within 10% of the company's
--      rate table, which only management and finance maintain. Approval
--      and credit-limit checks can no longer be dodged with a fake rate.
--   3. Supplier RFQ status can only be changed by hand to "cancelled";
--      client RFQs can only be created as "new"; invoices can only be
--      linked to an order or delivery by create_invoice().
--   4. Hardening: no table access for anonymous visitors; former members
--      no longer see their old notifications; logo path must be inside the
--      company's folder; push addresses must be real push services;
--      logo uploads limited to images up to 2 MB.
--
-- Go-live tools:
--   • platform_settings.allow_new_companies – switch off public sign-up of
--     new companies once your company is set up (invitations still work).
--   • import_opening_stock() – opening stock from a spreadsheet.
--   • reset_company_transactions() – clear test transactions before go-live
--     (SQL editor only).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Deliveries
-- ---------------------------------------------------------------------
create or replace function public.is_active_member(p_company uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.memberships where company_id = p_company and user_id = p_user and active);
$$;

create or replace function public.check_delivery_driver()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.driver_id is not distinct from old.driver_id then
    return new;
  end if;
  if new.driver_id is not null and not public.is_active_member(new.company_id, new.driver_id) then
    raise exception 'The driver must be an active member of the team.' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'draft'
     and not public.has_role(new.company_id, array['management', 'warehouse']::public.app_role[]) then
    raise exception 'Only management or the warehouse can change the driver after dispatch.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger deliveries_check_driver before insert or update of driver_id on public.deliveries
  for each row execute function public.check_delivery_driver();

create or replace function public.can_handle_delivery(d public.deliveries)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(d.driver_id = auth.uid(), false) and public.is_member(d.company_id)
         or public.has_role(d.company_id, array['management', 'warehouse']::public.app_role[]);
$$;

create or replace function public.confirm_delivery(p_id uuid, p_received_by text, p_signature_path text, p_photo_path text,
                                                   p_lat numeric, p_lng numeric, p_notes text, p_delivered_at timestamptz)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  d public.deliveries;
begin
  select * into d from public.deliveries where id = p_id for update;
  if d.id is null or not public.can_handle_delivery(d) then
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
  if not exists (select 1 from storage.objects where bucket_id = 'pod' and name = p_signature_path) then
    raise exception 'The signature has not been uploaded yet. Try again when there is signal.' using errcode = '22023';
  end if;
  if p_photo_path is not null and (p_photo_path not like d.company_id::text || '/' || d.id::text || '/%'
     or not exists (select 1 from storage.objects where bucket_id = 'pod' and name = p_photo_path)) then
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

create or replace function public.fail_delivery(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  d public.deliveries;
begin
  select * into d from public.deliveries where id = p_id for update;
  if d.id is null or not public.can_handle_delivery(d) then
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

-- ---------------------------------------------------------------------
-- 2. Exchange rates
-- ---------------------------------------------------------------------
create table public.exchange_rates (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  currency    text not null check (currency ~ '^[A-Z]{3}$'),
  rate        numeric(18, 6) not null check (rate > 0),
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid() references auth.users (id) on delete set null,
  unique (company_id, currency)
);
alter table public.exchange_rates enable row level security;
create policy exchange_rates_select on public.exchange_rates for select to authenticated using (public.is_member(company_id));
create policy exchange_rates_write on public.exchange_rates for all to authenticated
  using (public.has_role(company_id, array['management', 'finance']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'finance']::public.app_role[]));
revoke all on public.exchange_rates from anon, authenticated;
grant select, insert, delete on public.exchange_rates to authenticated;
grant update (rate) on public.exchange_rates to authenticated;

create or replace function public.prepare_exchange_rate()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if exists (select 1 from public.companies where id = new.company_id and base_currency = new.currency) then
    raise exception 'The main currency always has rate 1.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger exchange_rates_prepare before insert or update on public.exchange_rates
  for each row execute function public.prepare_exchange_rate();
create trigger exchange_rates_keep before update on public.exchange_rates for each row execute function public.keep_company();
create trigger exchange_rates_audit after insert or update or delete on public.exchange_rates
  for each row execute function public.audit_row();

-- Every money document: base currency → rate 1; foreign currency → the
-- company rate (filled in automatically) or within 10% of it.
create or replace function public.check_exchange_rate()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_base text;
  v_trusted numeric;
begin
  if tg_op = 'UPDATE' and new.currency is not distinct from old.currency
     and new.exchange_rate is not distinct from old.exchange_rate then
    return new;
  end if;
  select base_currency into v_base from public.companies where id = new.company_id;
  if new.currency = v_base then
    new.exchange_rate := 1;
    return new;
  end if;
  select rate into v_trusted from public.exchange_rates where company_id = new.company_id and currency = new.currency;
  if v_trusted is null then
    raise exception 'Set the % exchange rate first (Finance → Exchange rates; management or finance).', new.currency
      using errcode = '22023';
  end if;
  if new.exchange_rate is null or new.exchange_rate = 1 then
    new.exchange_rate := v_trusted;
  elsif abs(new.exchange_rate - v_trusted) / v_trusted > 0.10 then
    raise exception 'Exchange rate % for % is more than 10%% away from the company rate %. Ask finance to update the rate.',
      trim_scale(new.exchange_rate), new.currency, trim_scale(v_trusted) using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger a_quotations_rate      before insert or update on public.quotations      for each row execute function public.check_exchange_rate();
create trigger a_purchase_orders_rate before insert or update on public.purchase_orders for each row execute function public.check_exchange_rate();
create trigger a_invoices_rate        before insert or update on public.invoices        for each row execute function public.check_exchange_rate();
create trigger a_supplier_bills_rate  before insert or update on public.supplier_bills  for each row execute function public.check_exchange_rate();
create trigger a_payments_rate        before insert on public.payments                  for each row execute function public.check_exchange_rate();
create trigger a_supplier_pay_rate    before insert on public.supplier_payments         for each row execute function public.check_exchange_rate();
create trigger a_order_costs_rate     before insert or update on public.order_costs     for each row execute function public.check_exchange_rate();

-- ---------------------------------------------------------------------
-- 3. Status and link rules
-- ---------------------------------------------------------------------
create or replace function public.guard_srfq_status()
returns trigger language plpgsql set search_path = ''
as $$
begin
  -- Direct changes by app users only (the app's own functions run as the owner).
  if new.status is distinct from old.status and current_user in ('authenticated', 'anon')
     and current_setting('ims.status_change', true) is distinct from 'on'
     and not (old.status = 'open' and new.status = 'cancelled') then
    raise exception 'Use the buttons in the app to change the status.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger supplier_rfqs_status_guard before update on public.supplier_rfqs
  for each row execute function public.guard_srfq_status();

-- Client RFQs: created as "new" by the person entering them.
revoke insert on public.rfqs from authenticated;
grant insert (company_id, client_id, title, contact_name, client_ref, received_via, received_on, due_on, assigned_to, notes)
  on public.rfqs to authenticated;

-- Invoices: the link to an order or delivery is set only by create_invoice().
revoke insert on public.invoices from authenticated;
grant insert (company_id, client_id, currency, exchange_rate, issue_date, due_date, client_ref, contact_name, payment_terms,
              vat_rate, notes, terms)
  on public.invoices to authenticated;

-- ---------------------------------------------------------------------
-- 4. Hardening
-- ---------------------------------------------------------------------
-- Anonymous visitors never read or write tables (the server outbox only
-- uses its three secret-protected functions).
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;

-- Former members no longer see their old notifications.
drop policy notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid() and public.is_member(company_id));
drop policy notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid() and public.is_member(company_id)) with check (user_id = auth.uid());

-- Logo must be a file in the company's own folder.
create or replace function public.check_logo_path()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.logo_path is distinct from old.logo_path and new.logo_path is not null
     and new.logo_path not like new.id::text || '/%' then
    raise exception 'That file does not belong to this company.' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger companies_logo_path before update of logo_path on public.companies
  for each row execute function public.check_logo_path();

-- Push notifications only to the real push services (Google, Apple, Mozilla, Microsoft).
alter table public.push_subscriptions add constraint push_subscriptions_service check (
  endpoint ~ '^https://([a-z0-9-]+\.)*(googleapis\.com|push\.apple\.com|mozilla\.com|mozaws\.net|notify\.windows\.com)/'
) not valid;

-- Logo uploads: images only, up to 2 MB (only where the storage version supports it).
do $$
begin
  update storage.buckets
     set file_size_limit = 2097152,
         allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
   where id = 'branding';
  update storage.buckets
     set file_size_limit = 5242880,
         allowed_mime_types = array['image/png', 'image/jpeg']
   where id = 'pod';
exception when undefined_column then
  raise notice 'Storage limits not set (older storage version).';
end;
$$;

-- ---------------------------------------------------------------------
-- Go-live: new companies switch
-- ---------------------------------------------------------------------
create table public.platform_settings (
  id                   boolean primary key default true check (id),
  allow_new_companies  boolean not null default true
);
insert into public.platform_settings (id) values (true) on conflict do nothing;
alter table public.platform_settings enable row level security;
create policy platform_settings_read on public.platform_settings for select to authenticated using (true);
revoke all on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to authenticated;

create or replace function public.guard_new_company()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null
     and not coalesce((select allow_new_companies from public.platform_settings where id), true) then
    raise exception 'New companies are switched off. Ask your manager to invite you.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger companies_guard_new before insert on public.companies
  for each row execute function public.guard_new_company();

-- ---------------------------------------------------------------------
-- Go-live: opening stock
-- p_rows: [{sku, store, quantity, batch_no, expiry_date}] — all or nothing.
-- ---------------------------------------------------------------------
create or replace function public.import_opening_stock(p_company uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  r jsonb;
  v_i int := 0;
  v_ok int := 0;
  v_errors text[] := '{}';
  v_product uuid;
  v_store uuid;
  v_qty numeric;
  v_expiry date;
begin
  if not public.has_role(p_company, array['management', 'warehouse']::public.app_role[]) then
    raise exception 'Only management and warehouse can load stock.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'The file has no rows.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Load at most 5,000 rows at a time.' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    select id into v_product from public.products where company_id = p_company and lower(sku) = lower(btrim(r ->> 'sku'));
    select id into v_store from public.warehouses
     where company_id = p_company and active and lower(code) = lower(coalesce(nullif(btrim(r ->> 'store'), ''), 'MAIN'));
    begin
      v_qty := (r ->> 'quantity')::numeric;
      v_expiry := nullif(btrim(r ->> 'expiry_date'), '')::date;
    exception when others then
      v_qty := null;
      v_errors := v_errors || format('Row %s: quantity or expiry date is not valid', v_i + 1);
      continue;
    end;
    if v_product is null then
      v_errors := v_errors || format('Row %s: no product with SKU "%s"', v_i + 1, r ->> 'sku');
    elsif v_store is null then
      v_errors := v_errors || format('Row %s: no active store with code "%s"', v_i + 1, r ->> 'store');
    elsif v_qty is null or v_qty <= 0 then
      v_errors := v_errors || format('Row %s: quantity must be more than zero', v_i + 1);
    else
      insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, expiry_date, note)
      values (p_company, v_product, v_store, v_qty, 'adjustment', coalesce(btrim(r ->> 'batch_no'), ''), v_expiry, 'Opening stock');
      v_ok := v_ok + 1;
    end if;
  end loop;

  if array_length(v_errors, 1) > 0 then
    raise exception 'Nothing was loaded. Fix these rows and try again: %',
      array_to_string(v_errors[1:10], '; ') || case when array_length(v_errors, 1) > 10
        then format(' (and %s more)', array_length(v_errors, 1) - 10) else '' end
      using errcode = '22023';
  end if;
  return v_ok;
end;
$$;

-- ---------------------------------------------------------------------
-- Go-live: clear test transactions (SQL editor only). Keeps the company,
-- team, settings, clients, suppliers, products, prices and stores;
-- removes RFQs, quotations, POs, receipts, stock movements, deliveries,
-- invoices, payments, bills, costs, notifications and their history, and
-- restarts document numbers at 0001.
--   select public.reset_company_transactions(
--     (select id from public.companies where name = 'Your Company'), 'Your Company');
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
  delete from public.payments          where company_id = p_company;
  delete from public.supplier_payments where company_id = p_company;
  delete from public.invoices          where company_id = p_company;
  delete from public.supplier_bills    where company_id = p_company;
  delete from public.order_costs       where company_id = p_company;
  delete from public.stock_movements   where company_id = p_company;
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
                    'invoice_lines', 'payments', 'supplier_bills', 'supplier_payments', 'order_costs');
  delete from public.code_counters
   where company_id = p_company
     and kind ~ '^(rfqs|quotations|supplier_rfqs|purchase_orders|goods_receipts|deliveries|invoices|payments|supplier_bills|supplier_payments)-';
  update public.companies set alerts_checked_at = null where id = p_company;

  perform set_config('ims.status_change', 'off', true);
  perform set_config('ims.allow_line_copy', 'off', true);
  return 'Test transactions cleared for ' || v_name || '. Master data, team and settings were kept.';
end;
$$;

revoke execute on function
  public.is_active_member(uuid, uuid), public.can_handle_delivery(public.deliveries),
  public.import_opening_stock(uuid, jsonb), public.reset_company_transactions(uuid, text)
from public, anon, authenticated;
grant execute on function public.import_opening_stock(uuid, jsonb) to authenticated;
grant execute on function public.confirm_delivery(uuid, text, text, text, numeric, numeric, text, timestamptz),
  public.fail_delivery(uuid, text) to authenticated;

-- Functions: nothing for anonymous visitors except the three outbox
-- functions (secret-protected); signed-in users keep their explicit grants.
-- (Kept last so it also covers the functions created above. Postgres gives
-- new functions to PUBLIC by default, so later migrations must revoke too.)
revoke execute on all functions in schema public from public, anon;
grant execute on function public.run_all_alerts(text), public.claim_outbox(text, integer),
  public.drop_push_endpoints(text, text[]) to anon;

notify pgrst, 'reload schema';
