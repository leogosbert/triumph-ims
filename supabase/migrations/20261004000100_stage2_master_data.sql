-- =====================================================================
-- TRIUMPH IMS  ·  Stage 2: master data
-- Clients (with contacts), suppliers, products, and product costs.
--
-- Who can do what:
--   Clients    read: everyone in the company · edit: management, sales, finance
--              credit limit: management and finance only
--   Suppliers  read: management, procurement, finance, warehouse
--              edit: management, procurement
--   Products   read: everyone · edit: management, procurement, sales
--   Costs      (last cost, main supplier) read: management, procurement,
--              finance · edit: management, procurement
-- Nothing is hard-deleted: records are archived (active = false).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------

-- Running numbers per company (C-0001, S-0001, P-00001 ...).
create table public.code_counters (
  company_id  uuid not null references public.companies (id) on delete cascade,
  kind        text not null,
  last_value  integer not null default 0,
  primary key (company_id, kind)
);
alter table public.code_counters enable row level security;  -- no policies: only used by functions
revoke all on public.code_counters from anon, authenticated;

create or replace function public.next_code(p_company uuid, p_kind text, p_prefix text, p_width int)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v int;
begin
  insert into public.code_counters (company_id, kind, last_value) values (p_company, p_kind, 1)
  on conflict (company_id, kind) do update set last_value = public.code_counters.last_value + 1
  returning last_value into v;
  return p_prefix || lpad(v::text, p_width, '0');
end;
$$;
revoke execute on function public.next_code(uuid, text, text, int) from public, anon, authenticated;

-- Records can never be moved to another company.
create or replace function public.keep_company()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id then
    raise exception 'Records cannot be moved to another company.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------
create table public.clients (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  code             text not null default '',
  name             text not null check (char_length(btrim(name)) between 2 and 200),
  industry         text,
  tin              text,
  vrn              text,
  registration_no  text,
  address          text,
  region           text,
  delivery_sites   text,
  payment_terms    text,
  currency         text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  credit_limit     numeric(18, 2) not null default 0 check (credit_limit >= 0),
  tax_status       text,
  vendor_status    text,
  notes            text,
  active           boolean not null default true,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, code),
  unique (id, company_id)
);
create index clients_company_name_idx on public.clients (company_id, lower(name));

create table public.client_contacts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  client_id   uuid not null,
  kind        text not null default 'other' check (kind in ('purchasing', 'finance', 'technical', 'other')),
  name        text,
  position    text,
  email       text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade,
  check (coalesce(btrim(name), '') <> '' or coalesce(btrim(email), '') <> '' or coalesce(btrim(phone), '') <> '')
);
create index client_contacts_client_idx on public.client_contacts (client_id);

-- ---------------------------------------------------------------------
-- Suppliers
-- ---------------------------------------------------------------------
create table public.suppliers (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  code                   text not null default '',
  name                   text not null check (char_length(btrim(name)) between 2 and 200),
  country                text,
  city                   text,
  contact_person         text,
  email                  text,
  phone                  text,
  products_supplied      text,
  brands                 text,
  currency               text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  payment_terms          text,
  incoterms              text,
  lead_time_days         integer check (lead_time_days is null or lead_time_days between 0 and 730),
  minimum_order          text,
  tax_no                 text,
  bank_details_received  boolean not null default false,
  certificates           text,
  notes                  text,
  active                 boolean not null default true,
  created_by             uuid default auth.uid() references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (company_id, code),
  unique (id, company_id)
);
create index suppliers_company_name_idx on public.suppliers (company_id, lower(name));

-- ---------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------
create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  sku                text not null default '',
  name               text not null check (char_length(btrim(name)) between 2 and 300),
  category           text,
  subcategory        text,
  brand              text,
  manufacturer       text,
  mfr_part_no        text,
  specification      text,
  unit               text not null default 'pcs',
  pack_size          text,
  selling_price      numeric(18, 2) check (selling_price is null or selling_price >= 0),
  reorder_level      numeric(18, 3) check (reorder_level is null or reorder_level >= 0),
  hazardous          boolean not null default false,
  un_number          text,
  cas_number         text,
  shelf_life_months  integer check (shelf_life_months is null or shelf_life_months between 0 and 600),
  warranty_months    integer check (warranty_months is null or warranty_months between 0 and 600),
  sds_on_file        boolean not null default false,
  country_of_origin  text,
  notes              text,
  active             boolean not null default true,
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (company_id, sku),
  unique (id, company_id)
);
create index products_company_name_idx on public.products (company_id, lower(name));

-- Purchasing information kept apart so Sales and Drivers never see costs.
create table public.product_costs (
  product_id        uuid primary key,
  company_id        uuid not null references public.companies (id) on delete cascade,
  main_supplier_id  uuid,
  last_cost         numeric(18, 2) check (last_cost is null or last_cost >= 0),
  updated_at        timestamptz not null default now(),
  foreign key (product_id, company_id) references public.products (id, company_id) on delete cascade,
  foreign key (main_supplier_id, company_id) references public.suppliers (id, company_id)
);

-- ---------------------------------------------------------------------
-- Triggers: automatic codes, timestamps, company lock, credit guard, log
-- ---------------------------------------------------------------------
create or replace function public.assign_code()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v text;
  taken boolean;
begin
  if tg_table_name = 'clients' then
    new.code := btrim(coalesce(new.code, ''));
    while new.code = '' loop
      v := public.next_code(new.company_id, 'client', 'C-', 4);
      select exists (select 1 from public.clients where company_id = new.company_id and code = v) into taken;
      if not taken then new.code := v; end if;
    end loop;
  elsif tg_table_name = 'suppliers' then
    new.code := btrim(coalesce(new.code, ''));
    while new.code = '' loop
      v := public.next_code(new.company_id, 'supplier', 'S-', 4);
      select exists (select 1 from public.suppliers where company_id = new.company_id and code = v) into taken;
      if not taken then new.code := v; end if;
    end loop;
  elsif tg_table_name = 'products' then
    new.sku := btrim(coalesce(new.sku, ''));
    while new.sku = '' loop
      v := public.next_code(new.company_id, 'product', 'P-', 5);
      select exists (select 1 from public.products where company_id = new.company_id and sku = v) into taken;
      if not taken then new.sku := v; end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger clients_code   before insert on public.clients   for each row execute function public.assign_code();
create trigger suppliers_code before insert on public.suppliers for each row execute function public.assign_code();
create trigger products_code  before insert on public.products  for each row execute function public.assign_code();

-- Only management and finance may set or change a client's credit limit.
create or replace function public.guard_credit_limit()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;  -- database administrators and system jobs
  end if;
  if (tg_op = 'INSERT' and new.credit_limit <> 0)
     or (tg_op = 'UPDATE' and new.credit_limit is distinct from old.credit_limit) then
    if not public.has_role(new.company_id, array['management', 'finance']::public.app_role[]) then
      raise exception 'Only management or finance can set a credit limit.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger clients_credit_guard before insert or update on public.clients
  for each row execute function public.guard_credit_limit();

create trigger clients_touch         before update on public.clients         for each row execute function public.touch_updated_at();
create trigger client_contacts_touch before update on public.client_contacts for each row execute function public.touch_updated_at();
create trigger suppliers_touch       before update on public.suppliers       for each row execute function public.touch_updated_at();
create trigger products_touch        before update on public.products        for each row execute function public.touch_updated_at();
create trigger product_costs_touch   before update on public.product_costs   for each row execute function public.touch_updated_at();

create trigger clients_keep_company         before update on public.clients         for each row execute function public.keep_company();
create trigger client_contacts_keep_company before update on public.client_contacts for each row execute function public.keep_company();
create trigger suppliers_keep_company       before update on public.suppliers       for each row execute function public.keep_company();
create trigger products_keep_company        before update on public.products        for each row execute function public.keep_company();
create trigger product_costs_keep_company   before update on public.product_costs   for each row execute function public.keep_company();

create trigger clients_audit         after insert or update on public.clients                   for each row execute function public.audit_row();
create trigger client_contacts_audit after insert or update or delete on public.client_contacts for each row execute function public.audit_row();
create trigger suppliers_audit       after insert or update on public.suppliers                 for each row execute function public.audit_row();
create trigger products_audit        after insert or update on public.products                  for each row execute function public.audit_row();
create trigger product_costs_audit   after insert or update on public.product_costs             for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.clients         enable row level security;
alter table public.client_contacts enable row level security;
alter table public.suppliers       enable row level security;
alter table public.products        enable row level security;
alter table public.product_costs   enable row level security;

create policy clients_select on public.clients for select to authenticated
  using (public.is_member(company_id));
create policy clients_insert on public.clients for insert to authenticated
  with check (public.has_role(company_id, array['management', 'sales', 'finance']::public.app_role[]));
create policy clients_update on public.clients for update to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'finance']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'sales', 'finance']::public.app_role[]));

create policy client_contacts_select on public.client_contacts for select to authenticated
  using (public.is_member(company_id));
create policy client_contacts_insert on public.client_contacts for insert to authenticated
  with check (public.has_role(company_id, array['management', 'sales', 'finance']::public.app_role[]));
create policy client_contacts_update on public.client_contacts for update to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'finance']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'sales', 'finance']::public.app_role[]));
create policy client_contacts_delete on public.client_contacts for delete to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'finance']::public.app_role[]));

create policy suppliers_select on public.suppliers for select to authenticated
  using (public.has_role(company_id, array['management', 'procurement', 'finance', 'warehouse']::public.app_role[]));
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (public.has_role(company_id, array['management', 'procurement']::public.app_role[]));
create policy suppliers_update on public.suppliers for update to authenticated
  using (public.has_role(company_id, array['management', 'procurement']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'procurement']::public.app_role[]));

create policy products_select on public.products for select to authenticated
  using (public.is_member(company_id));
create policy products_insert on public.products for insert to authenticated
  with check (public.has_role(company_id, array['management', 'procurement', 'sales']::public.app_role[]));
create policy products_update on public.products for update to authenticated
  using (public.has_role(company_id, array['management', 'procurement', 'sales']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'procurement', 'sales']::public.app_role[]));

create policy product_costs_select on public.product_costs for select to authenticated
  using (public.has_role(company_id, array['management', 'procurement', 'finance']::public.app_role[]));
create policy product_costs_insert on public.product_costs for insert to authenticated
  with check (public.has_role(company_id, array['management', 'procurement']::public.app_role[]));
create policy product_costs_update on public.product_costs for update to authenticated
  using (public.has_role(company_id, array['management', 'procurement']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'procurement']::public.app_role[]));

revoke all on public.clients, public.client_contacts, public.suppliers, public.products, public.product_costs
  from anon, authenticated;
grant select, insert, update on public.clients, public.client_contacts, public.suppliers,
                                public.products, public.product_costs to authenticated;
grant delete on public.client_contacts to authenticated;

-- ---------------------------------------------------------------------
-- Spreadsheet import (management only). Runs as the signed-in user, so
-- every rule above still applies. All-or-nothing: if any row fails,
-- nothing is saved. Existing records are matched by their code / SKU.
-- ---------------------------------------------------------------------
create or replace function public.import_master_data(
  p_company uuid, p_suppliers jsonb, p_clients jsonb, p_products jsonb
)
returns jsonb language plpgsql set search_path = ''
as $$
declare
  r jsonb;
  v_id uuid;
  v_new boolean;
  v_supplier uuid;
  k text;
  c jsonb;
  v_out jsonb := jsonb_build_object(
    'suppliers_added', 0, 'suppliers_updated', 0,
    'clients_added', 0, 'clients_updated', 0,
    'products_added', 0, 'products_updated', 0,
    'unmatched_suppliers', '[]'::jsonb);
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can import data.' using errcode = '42501';
  end if;

  -- Suppliers first, so products can be linked to them by name.
  for r in select * from jsonb_array_elements(coalesce(p_suppliers, '[]'::jsonb)) loop
    insert into public.suppliers as s (
      company_id, code, name, country, city, contact_person, email, phone, products_supplied, brands,
      currency, payment_terms, incoterms, lead_time_days, minimum_order, tax_no, bank_details_received,
      certificates, notes)
    values (
      p_company, coalesce(r ->> 'code', ''), r ->> 'name', r ->> 'country', r ->> 'city', r ->> 'contact_person',
      r ->> 'email', r ->> 'phone', r ->> 'products_supplied', r ->> 'brands',
      coalesce(r ->> 'currency', 'TZS'), r ->> 'payment_terms', r ->> 'incoterms',
      (r ->> 'lead_time_days')::int, r ->> 'minimum_order', r ->> 'tax_no',
      coalesce((r ->> 'bank_details_received')::boolean, false), r ->> 'certificates', r ->> 'notes')
    on conflict (company_id, code) do update set
      name = excluded.name, country = excluded.country, city = excluded.city,
      contact_person = excluded.contact_person, email = excluded.email, phone = excluded.phone,
      products_supplied = excluded.products_supplied, brands = excluded.brands, currency = excluded.currency,
      payment_terms = excluded.payment_terms, incoterms = excluded.incoterms,
      lead_time_days = excluded.lead_time_days, minimum_order = excluded.minimum_order,
      tax_no = excluded.tax_no, bank_details_received = excluded.bank_details_received,
      certificates = excluded.certificates, notes = excluded.notes, active = true
    returning (xmax = 0) into v_new;
    k := case when v_new then 'suppliers_added' else 'suppliers_updated' end;
    v_out := jsonb_set(v_out, array[k], to_jsonb((v_out ->> k)::int + 1));
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_clients, '[]'::jsonb)) loop
    insert into public.clients as cl (
      company_id, code, name, industry, tin, vrn, registration_no, address, region, delivery_sites,
      payment_terms, currency, credit_limit, tax_status, vendor_status, notes)
    values (
      p_company, coalesce(r ->> 'code', ''), r ->> 'name', r ->> 'industry', r ->> 'tin', r ->> 'vrn',
      r ->> 'registration_no', r ->> 'address', r ->> 'region', r ->> 'delivery_sites', r ->> 'payment_terms',
      coalesce(r ->> 'currency', 'TZS'), coalesce((r ->> 'credit_limit')::numeric, 0), r ->> 'tax_status',
      r ->> 'vendor_status', r ->> 'notes')
    on conflict (company_id, code) do update set
      name = excluded.name, industry = excluded.industry, tin = excluded.tin, vrn = excluded.vrn,
      registration_no = excluded.registration_no, address = excluded.address, region = excluded.region,
      delivery_sites = excluded.delivery_sites, payment_terms = excluded.payment_terms,
      currency = excluded.currency, credit_limit = excluded.credit_limit, tax_status = excluded.tax_status,
      vendor_status = excluded.vendor_status, notes = excluded.notes, active = true
    returning id, (xmax = 0) into v_id, v_new;
    k := case when v_new then 'clients_added' else 'clients_updated' end;
    v_out := jsonb_set(v_out, array[k], to_jsonb((v_out ->> k)::int + 1));

    -- Up to three contacts per client: purchasing, finance, technical.
    for c in select * from jsonb_array_elements(coalesce(r -> 'contacts', '[]'::jsonb)) loop
      if coalesce(c ->> 'name', '') = '' and coalesce(c ->> 'email', '') = '' and coalesce(c ->> 'phone', '') = '' then
        continue;
      end if;
      update public.client_contacts
         set name = c ->> 'name', email = c ->> 'email', phone = c ->> 'phone'
       where id = (select id from public.client_contacts
                   where client_id = v_id and kind = c ->> 'kind' order by created_at limit 1);
      if not found then
        insert into public.client_contacts (company_id, client_id, kind, name, email, phone)
        values (p_company, v_id, c ->> 'kind', c ->> 'name', c ->> 'email', c ->> 'phone');
      end if;
    end loop;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) loop
    insert into public.products as p (
      company_id, sku, name, category, subcategory, brand, manufacturer, mfr_part_no, specification, unit,
      pack_size, selling_price, reorder_level, hazardous, un_number, cas_number, shelf_life_months,
      warranty_months, sds_on_file, country_of_origin, notes)
    values (
      p_company, coalesce(r ->> 'sku', ''), r ->> 'name', r ->> 'category', r ->> 'subcategory', r ->> 'brand',
      r ->> 'manufacturer', r ->> 'mfr_part_no', r ->> 'specification', coalesce(r ->> 'unit', 'pcs'),
      r ->> 'pack_size', (r ->> 'selling_price')::numeric, (r ->> 'reorder_level')::numeric,
      coalesce((r ->> 'hazardous')::boolean, false), r ->> 'un_number', r ->> 'cas_number',
      (r ->> 'shelf_life_months')::int, (r ->> 'warranty_months')::int,
      coalesce((r ->> 'sds_on_file')::boolean, false), r ->> 'country_of_origin', r ->> 'notes')
    on conflict (company_id, sku) do update set
      name = excluded.name, category = excluded.category, subcategory = excluded.subcategory,
      brand = excluded.brand, manufacturer = excluded.manufacturer, mfr_part_no = excluded.mfr_part_no,
      specification = excluded.specification, unit = excluded.unit, pack_size = excluded.pack_size,
      selling_price = excluded.selling_price, reorder_level = excluded.reorder_level,
      hazardous = excluded.hazardous, un_number = excluded.un_number, cas_number = excluded.cas_number,
      shelf_life_months = excluded.shelf_life_months, warranty_months = excluded.warranty_months,
      sds_on_file = excluded.sds_on_file, country_of_origin = excluded.country_of_origin,
      notes = excluded.notes, active = true
    returning id, (xmax = 0) into v_id, v_new;
    k := case when v_new then 'products_added' else 'products_updated' end;
    v_out := jsonb_set(v_out, array[k], to_jsonb((v_out ->> k)::int + 1));

    v_supplier := null;
    if coalesce(r ->> 'main_supplier', '') <> '' then
      select id into v_supplier from public.suppliers
      where company_id = p_company and lower(btrim(name)) = lower(btrim(r ->> 'main_supplier'))
      order by created_at limit 1;
      if v_supplier is null then
        v_out := jsonb_set(v_out, '{unmatched_suppliers}', (v_out -> 'unmatched_suppliers') || to_jsonb(r ->> 'main_supplier'));
      end if;
    end if;
    if v_supplier is not null or r ? 'last_cost' then
      insert into public.product_costs (product_id, company_id, main_supplier_id, last_cost)
      values (v_id, p_company, v_supplier, (r ->> 'last_cost')::numeric)
      on conflict (product_id) do update set
        main_supplier_id = coalesce(excluded.main_supplier_id, public.product_costs.main_supplier_id),
        last_cost = coalesce(excluded.last_cost, public.product_costs.last_cost);
    end if;
  end loop;

  return v_out;
end;
$$;

revoke execute on function public.import_master_data(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.import_master_data(uuid, jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
