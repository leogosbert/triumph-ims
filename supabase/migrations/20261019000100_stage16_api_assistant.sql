-- =====================================================================
-- LeMoSp · Stage 16: integrations & API, the business assistant
--
--   API keys          api_keys: management creates a key for another
--                     system (accounting software, a website, a client's
--                     portal). Only a SHA-256 hash is kept; the key itself
--                     is shown once. Keys can be switched off at any time.
--   Data API          api_read(key, resource, since, limit, offset): read
--                     clients, suppliers, products, stock, quotations,
--                     invoices, payments and purchase orders of the key's
--                     company, page by page. Read only. Works only while
--                     the company has "Integrations & API" switched on.
--   Assistant         assistant_usage: questions asked per person per day,
--                     so answers from the outside AI service stay within a
--                     daily allowance.
--   Features          mobile-money payments, the assistant and
--                     integrations become live.
--
-- Run after the feature categories file. Safe to run more than once.
-- No statement in this file removes anything.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. API keys
-- ---------------------------------------------------------------------
create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 2 and 80),
  prefix        text not null check (prefix ~ '^lmsp_[a-f0-9]{8}$'),
  key_hash      text not null unique check (key_hash ~ '^[a-f0-9]{64}$'),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  use_count     bigint not null default 0,
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users (id) on delete set null
);
create index if not exists api_keys_company_idx on public.api_keys (company_id, created_at desc);

alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;
grant select (id, company_id, name, prefix, created_by, created_at, last_used_at, use_count, revoked_at, revoked_by)
  on public.api_keys to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'api_keys' and policyname = 'api_keys_select') then
    create policy api_keys_select on public.api_keys for select to authenticated
      using (public.has_role(company_id, array['management']::public.app_role[]));
  end if;
end;
$$;

-- A new key for the company. Returns the key itself: it is never shown again.
create or replace function public.create_api_key(p_company uuid, p_name text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_key  text;
  v_id   uuid;
begin
  if not public.has_role(p_company, array['management']::public.app_role[]) then
    raise exception 'Only management can create API keys.' using errcode = '42501';
  end if;
  if not public.recent_auth(10) then
    raise exception 'Please confirm it is you: sign in again, then create the key.' using errcode = '42501';
  end if;
  if not public.feature_on(p_company, 'integrations') then
    raise exception 'Switch on Integrations & API first.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'Give the key a name of 2 to 80 characters, for example "Accounting software".' using errcode = '22023';
  end if;
  if (select count(*) from public.api_keys where company_id = p_company and revoked_at is null) >= 20 then
    raise exception 'A company can have up to 20 keys in use. Switch off one you no longer need.' using errcode = '22023';
  end if;
  -- 2 random UUIDs: 244 random bits.
  v_key := 'lmsp_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.api_keys (company_id, name, prefix, key_hash)
  values (p_company, btrim(p_name), left(v_key, 13), encode(sha256(convert_to(v_key, 'UTF8')), 'hex'))
  returning id into v_id;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (p_company, auth.uid(), 'insert', 'api_keys', v_id::text, jsonb_build_object('name', btrim(p_name), 'prefix', left(v_key, 13)));
  return v_key;
end;
$$;

create or replace function public.revoke_api_key(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  k public.api_keys;
begin
  select * into k from public.api_keys where id = p_id;
  if k.id is null or not public.has_role(k.company_id, array['management']::public.app_role[]) then
    raise exception 'Key not found.' using errcode = '42501';
  end if;
  if k.revoked_at is not null then
    return;
  end if;
  update public.api_keys set revoked_at = now(), revoked_by = auth.uid() where id = p_id;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (k.company_id, auth.uid(), 'update', 'api_keys', k.id::text,
          jsonb_build_object('name', k.name, 'prefix', k.prefix, 'revoked_at', jsonb_build_object('from', null, 'to', now())));
end;
$$;

-- ---------------------------------------------------------------------
-- 2. The data API (read only)
-- ---------------------------------------------------------------------
create or replace function public.api_resources()
returns text[] language sql immutable set search_path = ''
as $$
  select array['clients', 'suppliers', 'products', 'stock', 'quotations', 'invoices', 'payments', 'purchase_orders'];
$$;

create or replace function public.api_read(p_key text, p_resource text, p_since timestamptz default null,
                                           p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  k        public.api_keys;
  v_c      uuid;
  v_limit  integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_since  timestamptz := coalesce(p_since, '-infinity'::timestamptz);
  v_rows   jsonb;
begin
  if p_key is null or p_key !~ '^lmsp_[a-f0-9]{64}$' then
    raise exception 'Invalid API key.' using errcode = '28000';
  end if;
  select * into k from public.api_keys where key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex');
  if k.id is null or k.revoked_at is not null then
    raise exception 'Invalid API key.' using errcode = '28000';
  end if;
  v_c := k.company_id;
  if not public.feature_on(v_c, 'integrations') then
    raise exception 'Integrations & API is switched off for this company.' using errcode = '42501';
  end if;
  if p_resource is null or not (p_resource = any (public.api_resources())) then
    raise exception 'Unknown resource. Use one of: %', array_to_string(public.api_resources(), ', ') using errcode = '22023';
  end if;

  update public.api_keys
     set use_count = use_count + 1,
         last_used_at = case when last_used_at is null or last_used_at < now() - interval '1 minute' then now() else last_used_at end
   where id = k.id;

  if p_resource = 'clients' then
    select coalesce(jsonb_agg(r), '[]') into v_rows from (
      select id, code, name, industry, tin, vrn, address, region, payment_terms, currency, credit_limit, tax_status, active, created_at, updated_at
        from public.clients where company_id = v_c and updated_at > v_since
       order by created_at, id limit v_limit offset v_offset) r;
  elsif p_resource = 'suppliers' then
    select coalesce(jsonb_agg(r), '[]') into v_rows from (
      select id, code, name, country, city, contact_person, email, phone, currency, payment_terms, incoterms, lead_time_days, tax_no, active, created_at, updated_at
        from public.suppliers where company_id = v_c and updated_at > v_since
       order by created_at, id limit v_limit offset v_offset) r;
  elsif p_resource = 'products' then
    select coalesce(jsonb_agg(r), '[]') into v_rows from (
      select id, sku, name, category, subcategory, brand, manufacturer, mfr_part_no, unit, pack_size, selling_price, reorder_level, active, created_at, updated_at
        from public.products where company_id = v_c and updated_at > v_since
       order by created_at, id limit v_limit offset v_offset) r;
  elsif p_resource = 'stock' then
    select coalesce(jsonb_agg(r), '[]') into v_rows from (
      select s.product_id, p.sku, p.name as product, w.code as store, s.batch_no, s.expiry_date, s.quantity
        from (select product_id, warehouse_id, batch_no, expiry_date, sum(quantity) as quantity
                from public.stock_movements where company_id = v_c
               group by product_id, warehouse_id, batch_no, expiry_date
              having sum(quantity) <> 0) s
        join public.products p on p.id = s.product_id
        join public.warehouses w on w.id = s.warehouse_id
       order by p.sku, w.code, s.batch_no limit v_limit offset v_offset) r;
  elsif p_resource = 'quotations' then
    select coalesce(jsonb_agg(r), '[]') into v_rows from (
      select q.id, q.number, q.revision, q.status, q.client_id, c.name as client, q.currency, q.exchange_rate, q.issue_date, q.valid_until,
             q.subtotal, q.discount_total, q.vat_amount, q.total, q.sent_at, q.decided_at, q.created_at, q.updated_at
        from public.quotations q join public.clients c on c.id = q.client_id
       where q.company_id = v_c and q.updated_at > v_since
       order by q.created_at, q.id limit v_limit offset v_offset) r;
  elsif p_resource = 'invoices' then
    select coalesce(jsonb_agg(r), '[]') into v_rows from (
      select i.id, i.number, i.status, i.client_id, c.name as client, c.tin as client_tin, c.vrn as client_vrn, i.currency, i.exchange_rate,
             i.issue_date, i.due_date, i.client_ref, i.vat_rate, i.subtotal, i.discount_total, i.vat_amount, i.total, i.amount_paid,
             i.total - i.amount_paid as balance, i.issued_at, i.created_at, i.updated_at
        from public.invoices i join public.clients c on c.id = i.client_id
       where i.company_id = v_c and i.status <> 'draft' and i.updated_at > v_since
       order by i.created_at, i.id limit v_limit offset v_offset) r;
  elsif p_resource = 'payments' then
    select coalesce(jsonb_agg(r), '[]') into v_rows from (
      select p.id, p.number, p.invoice_id, i.number as invoice, p.client_id, c.name as client, p.received_on, p.amount, p.currency,
             p.exchange_rate, p.method, p.reference, p.voided_at, p.created_at
        from public.payments p join public.invoices i on i.id = p.invoice_id join public.clients c on c.id = p.client_id
       where p.company_id = v_c and greatest(p.created_at, coalesce(p.voided_at, p.created_at)) > v_since
       order by p.created_at, p.id limit v_limit offset v_offset) r;
  else
    select coalesce(jsonb_agg(r), '[]') into v_rows from (
      select o.id, o.number, o.status, o.supplier_id, s.name as supplier, o.currency, o.exchange_rate, o.order_date, o.expected_date,
             o.subtotal, o.vat_amount, o.total, o.approved_at, o.sent_at, o.confirmed_at, o.created_at, o.updated_at
        from public.purchase_orders o join public.suppliers s on s.id = o.supplier_id
       where o.company_id = v_c and o.status not in ('draft') and o.updated_at > v_since
       order by o.created_at, o.id limit v_limit offset v_offset) r;
  end if;

  return jsonb_build_object(
    'resource', p_resource,
    'count', jsonb_array_length(v_rows),
    'next_offset', case when jsonb_array_length(v_rows) = v_limit then v_offset + v_limit end,
    'data', v_rows);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Business assistant: daily allowance per person
-- ---------------------------------------------------------------------
create table if not exists public.assistant_usage (
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  day         date not null default current_date,
  questions   integer not null default 0,
  primary key (company_id, user_id, day)
);
alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from anon, authenticated;
grant select on public.assistant_usage to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'assistant_usage' and policyname = 'assistant_usage_select') then
    create policy assistant_usage_select on public.assistant_usage for select to authenticated
      using (user_id = auth.uid() and public.is_member(company_id));
  end if;
end;
$$;

-- Counts one question to the outside AI service. False when today's allowance is used up.
create or replace function public.use_assistant(p_company uuid, p_daily integer default 40)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null or not public.is_member(p_company) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  if not public.feature_on(p_company, 'ai_assistant') then
    raise exception 'Switch on the AI business assistant first.' using errcode = '42501';
  end if;
  insert into public.assistant_usage as u (company_id, user_id, day, questions)
  values (p_company, auth.uid(), current_date, 1)
  on conflict (company_id, user_id, day) do update set questions = u.questions + 1
  returning questions into v_n;
  return v_n <= least(greatest(coalesce(p_daily, 40), 1), 200);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Features: live
-- ---------------------------------------------------------------------
update public.features set status = 'live', route = '/reconcile' where key = 'mobile_money' and status <> 'live';
update public.features set status = 'live', route = '/assistant',
       tutorial = '[{"title":"Ask a question","body":"Open Assistant and type or tap a question, for example: who owes us money?"},{"title":"Open the records","body":"Each answer lists the records behind it; tap one to open it."},{"title":"Use the drafts","body":"Ask for a payment reminder to a client and copy the ready text into email or WhatsApp."}]'::jsonb
 where key = 'ai_assistant';
update public.features set status = 'live', route = '/integrations',
       tutorial = '[{"title":"Accounting export","body":"Download invoices and payments of a month as a spreadsheet your accountant or accounting software can import."},{"title":"Create an API key","body":"Management creates a key for the other system; it is shown once."},{"title":"Connect","body":"The other system reads clients, products, stock, invoices and payments with the key."}]'::jsonb
 where key = 'integrations';

-- ---------------------------------------------------------------------
-- 5. Closing a company: every call deletes something before it stops
--    (empty tables, such as a company without API keys, no longer use up
--    a call). Otherwise as in the deletion file.
-- ---------------------------------------------------------------------
create or replace function public.delete_company_step(p_company uuid, p_budget interval default interval '1.5 seconds')
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_start    timestamptz := clock_timestamp();
  p          record;
  v_n        integer;
  v_progress boolean;
  v_left     text;
  v_sql      text;
begin
  if not exists (select 1 from public.companies where id = p_company) then
    return true;
  end if;
  perform set_config('ims.quiet_audit', 'on', true);
  perform set_config('ims.status_change', 'on', true);
  perform set_config('ims.allow_line_copy', 'on', true);

  loop
    v_progress := false;
    v_left := null;
    -- Child tables (without company_id) first, then the rest; the closure bookkeeping is kept.
    for p in select * from public.backup_table_plan()
              where table_name not in ('company_closures', 'security_events')  -- sign-in history stays with each person
              order by (parent_table is null), table_name loop
      if p.parent_table is null then
        v_sql := format('delete from public.%I where ctid = any (array(select ctid from public.%I where company_id::text = $1 limit 2000))',
                        p.table_name, p.table_name);
      elsif p.parent_table = 'companies' then
        v_sql := format('delete from public.%I where ctid = any (array(select ctid from public.%I where %I::text = $1 limit 2000))',
                        p.table_name, p.table_name, p.fk_column);
      else
        v_sql := format('delete from public.%I where ctid = any (array(select x.ctid from public.%I x where x.%I in '
                        || '(select y.%I from public.%I y where y.company_id::text = $1) limit 2000))',
                        p.table_name, p.table_name, p.fk_column, p.parent_column, p.parent_table);
      end if;
      begin
        execute v_sql using p_company::text;
        get diagnostics v_n = row_count;
        if v_n > 0 then
          v_progress := true;
          if v_n = 2000 then
            v_left := p.table_name;  -- more to do here
          end if;
        end if;
      exception when foreign_key_violation then
        v_left := p.table_name;      -- another table still points at these rows: later
      end;
      if v_progress and clock_timestamp() - v_start > p_budget then
        return false;               -- time is up: what was deleted is kept, the next call carries on
      end if;
    end loop;
    exit when v_left is null;
    if not v_progress then
      raise exception 'Some records could not be deleted (%).', v_left;
    end if;
  end loop;

  -- Logo, signatures and delivery photos. Noted first; then tried directly (older Supabase
  -- allows it). Newer Supabase refuses: a platform admin removes them from the admin app.
  insert into public.storage_cleanup (bucket, prefix, company_ref)
  select b, p_company::text || '/', p_company from unnest(array['branding', 'pod']) b
  on conflict (bucket, prefix) do nothing;
  begin
    delete from storage.objects
     where bucket_id in ('branding', 'pod') and name like p_company::text || '/%';
  exception when others then
    raise notice 'Files for % left in storage: %', p_company, sqlerrm;
  end;
  update public.storage_cleanup s set done_at = now()
   where s.company_ref = p_company and s.done_at is null
     and not exists (select 1 from storage.objects o where o.bucket_id = s.bucket and left(o.name, length(s.prefix)) = s.prefix);
  -- Whatever is left hangs off the company with ON DELETE CASCADE (backups too).
  delete from public.companies where id = p_company;

  perform set_config('ims.quiet_audit', 'off', true);
  perform set_config('ims.status_change', 'off', true);
  perform set_config('ims.allow_line_copy', 'off', true);
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.create_api_key(uuid, text),
  public.revoke_api_key(uuid),
  public.api_read(text, text, timestamptz, integer, integer),
  public.use_assistant(uuid, integer),
  public.api_resources()
from public, anon;
grant execute on function public.api_resources() to authenticated;
grant execute on function
  public.create_api_key(uuid, text),
  public.revoke_api_key(uuid),
  public.use_assistant(uuid, integer)
to authenticated;
-- Other systems call the data API with the public (anon) key plus their own API key.
grant execute on function public.api_read(text, text, timestamptz, integer, integer) to anon, authenticated;
