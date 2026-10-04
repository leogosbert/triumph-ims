-- =====================================================================
-- TRIUMPH IMS  ·  Stage 10: demo mode
--
-- Prospects can try the app without setting anything up:
--   create_demo_company()  – a private, throw-away company "Demo Supplies
--                            Ltd" full of realistic sample data (fictional
--                            clients, suppliers and products). The caller
--                            is its manager. It expires after 48 hours.
--   set_demo_role(role)    – "view as" Sales, Driver, Finance… (only in
--                            the caller's own demo company).
--   end_demo()             – delete the caller's demo now.
--   purge_demo_companies() – removes expired demos and guest users that
--                            no longer belong anywhere; run by the
--                            scheduled job (run_all_alerts).
--
-- Callers may be Supabase anonymous ("guest") users – switch on
-- Authentication → Sign In / Providers → "Allow anonymous sign-ins".
-- Guests can only ever be in a demo company: they cannot create a real
-- company, accept invitations or be added to a real company. A demo
-- company is single-user (no invitations), never sends push or email,
-- and is created even when new companies are switched off.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columns (readable by members, never editable by users: companies only
-- has column-level update grants, and these columns are not among them)
-- ---------------------------------------------------------------------
alter table public.companies
  add column if not exists is_demo boolean not null default false,
  add column if not exists demo_expires_at timestamptz;
alter table public.companies drop constraint if exists companies_demo_expiry;
alter table public.companies add constraint companies_demo_expiry check (not is_demo or demo_expires_at is not null);
create index if not exists companies_demo_expiry_idx on public.companies (demo_expires_at) where is_demo;

-- Log of demo starts, for the abuse limits (kept one day).
create table if not exists public.demo_starts (
  id          bigint generated always as identity primary key,
  user_id     uuid,
  created_at  timestamptz not null default now()
);
create index if not exists demo_starts_time_idx on public.demo_starts (created_at);
alter table public.demo_starts enable row level security;  -- no policies: only used by functions
revoke all on public.demo_starts from anon, authenticated;

-- ---------------------------------------------------------------------
-- Guest (anonymous) users
-- ---------------------------------------------------------------------
create or replace function public.is_anonymous_user()
returns boolean language sql stable set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

-- Database-level rule: a guest can only be a member of a demo company,
-- and a demo company has exactly one member.
create or replace function public.guard_demo_membership()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce((select is_demo from public.companies where id = new.company_id), false) then
    if exists (select 1 from public.memberships where company_id = new.company_id and user_id <> new.user_id) then
      raise exception 'A demo company has a single user.' using errcode = '42501';
    end if;
  elsif exists (select 1 from auth.users where id = new.user_id and is_anonymous) then
    raise exception 'Guest users cannot join a company. Create an account first.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists memberships_guard_demo on public.memberships;
create trigger memberships_guard_demo before insert or update of company_id, user_id on public.memberships
  for each row execute function public.guard_demo_membership();

-- New companies switch: demo companies (created only by
-- create_demo_company, which sets the transaction-local flag) are allowed.
create or replace function public.guard_new_company()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.is_demo and current_setting('ims.demo_create', true) = 'on' then
    return new;
  end if;
  if new.is_demo then
    raise exception 'Demo companies are created with create_demo_company().' using errcode = '42501';
  end if;
  if auth.uid() is not null
     and not coalesce((select allow_new_companies from public.platform_settings where id), true) then
    raise exception 'New companies are switched off. Ask your manager to invite you.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Same as Stage 1, plus: guests cannot create real companies.
create or replace function public.create_company(p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  if public.is_anonymous_user() then
    raise exception 'Create an account to set up your own company. Guests can only use the demo.' using errcode = '42501';
  end if;
  insert into public.companies (name, created_by) values (btrim(p_name), auth.uid())
  returning id into v_id;
  insert into public.memberships (company_id, user_id, role) values (v_id, auth.uid(), 'management');
  return v_id;
end;
$$;

-- Same as Stage 1, plus: nobody can invite people into a demo company.
create or replace function public.invite_member(p_company uuid, p_email text, p_role public.app_role)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can invite people.' using errcode = '42501';
  end if;
  if exists (select 1 from public.companies where id = p_company and is_demo) then
    raise exception 'Inviting people is not available in the demo. Create your own company to build a team.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address does not look right.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships m join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and p.email = v_email and m.active
  ) then
    raise exception 'This person is already in the team.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.invitations i
    where i.company_id = p_company and i.email = v_email
      and i.accepted_at is null and i.revoked_at is null
  ) then
    raise exception 'An invitation for this email is already waiting.' using errcode = '23505';
  end if;

  insert into public.invitations (company_id, email, role, invited_by)
  values (p_company, v_email, p_role, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Same as Stage 1, plus: guests cannot accept invitations.
create or replace function public.accept_invitation(p_invitation uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  if public.is_anonymous_user() then
    raise exception 'Create an account (or sign in) to accept an invitation.' using errcode = '42501';
  end if;
  select * into v_inv from public.invitations
  where id = p_invitation and accepted_at is null and revoked_at is null
    and email = lower(auth.jwt() ->> 'email');
  if v_inv.id is null then
    raise exception 'Invitation not found or no longer valid.' using errcode = '42501';
  end if;

  insert into public.memberships (company_id, user_id, role, active)
  values (v_inv.company_id, auth.uid(), v_inv.role, true)
  on conflict (company_id, user_id) do update set role = excluded.role, active = true;

  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  return v_inv.company_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Deleting a demo company with everything in it (internal)
-- ---------------------------------------------------------------------
create or replace function public.delete_demo_company(p_company uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.companies where id = p_company and is_demo) then
    return false;  -- never touches a real company
  end if;
  -- Line guards would otherwise refuse deleting lines of issued documents.
  perform set_config('ims.status_change', 'on', true);
  perform set_config('ims.allow_line_copy', 'on', true);
  -- Uploaded logo / signature records (newer Supabase storage may refuse
  -- direct deletes; the files are then left for the storage API).
  begin
    delete from storage.objects
     where bucket_id in ('branding', 'pod') and name like p_company::text || '/%';
  exception when others then
    raise notice 'Demo files for % left in storage: %', p_company, sqlerrm;
  end;
  -- Everything else hangs off the company with ON DELETE CASCADE.
  delete from public.companies where id = p_company and is_demo;
  perform set_config('ims.status_change', 'off', true);
  perform set_config('ims.allow_line_copy', 'off', true);
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- Seed helpers (internal). They call the normal workflow functions as
-- the demo user, so every document goes through the real rules.
-- ---------------------------------------------------------------------

-- A quotation at a given stage: draft | pending | sent | accepted.
-- p_lines: [{p: product id, q: quantity, price: optional unit price}]
-- (ignored when the quotation comes from an RFQ: its lines are copied).
create or replace function public.demo_quote(p_company uuid, p_client uuid, p_rfq uuid, p_lines jsonb, p_issue date,
                                             p_valid_days integer, p_stage text, p_delivery text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_q uuid;
  r record;
  v_at timestamptz := (p_issue + time '09:30') at time zone 'Africa/Dar_es_Salaam';
begin
  v_q := public.create_quotation(p_company, p_client, p_rfq);
  if p_rfq is null then
    for r in select e.value as l from jsonb_array_elements(p_lines) with ordinality e order by e.ordinality loop
      insert into public.quotation_lines (company_id, quotation_id, product_id, description, quantity, unit, unit_price)
      select p_company, v_q, p.id, p.name, (r.l ->> 'q')::numeric, p.unit,
             coalesce((r.l ->> 'price')::numeric, p.selling_price)
        from public.products p where p.id = (r.l ->> 'p')::uuid and p.company_id = p_company;
    end loop;
  end if;
  update public.quotations
     set issue_date = p_issue, valid_until = p_issue + p_valid_days, delivery_time = p_delivery, created_at = v_at
   where id = v_q;
  if p_stage = 'draft' then
    return v_q;
  end if;

  perform public.submit_quotation(v_q);  -- the demo user is management: approved straight away
  if p_stage = 'pending' then
    -- Shown as submitted by a (former) sales person, so the demo user can approve it.
    perform set_config('ims.status_change', 'on', true);
    update public.quotations
       set status = 'pending_approval', submitted_by = null, approved_at = null, approved_by = null,
           submitted_at = v_at + interval '1 hour'
     where id = v_q;
    perform set_config('ims.status_change', 'off', true);
    return v_q;
  end if;

  perform public.mark_quotation_sent(v_q);
  if p_stage = 'accepted' then
    perform public.record_quotation_outcome(v_q, true, 'Client purchase order received');
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.quotations
     set submitted_at = v_at + interval '1 hour', approved_at = v_at + interval '1 hour',
         sent_at = v_at + interval '2 hours',
         decided_at = case when decided_at is not null then least(v_at + interval '3 days', now()) end
   where id = v_q;
  perform set_config('ims.status_change', 'off', true);
  return v_q;
end;
$$;

-- Invoice for an accepted quotation, issued on a past date, with payments.
-- p_payments: [{on: date, pct: percent of the total (capped at what is still owed), ref}]
create or replace function public.demo_invoice(p_quote uuid, p_issue date, p_due date, p_payments jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_c uuid;
  v_i uuid;
  inv public.invoices;
  r record;
  v_at timestamptz := least((p_issue + time '10:00') at time zone 'Africa/Dar_es_Salaam', now());
begin
  select company_id into v_c from public.quotations where id = p_quote;
  v_i := public.create_invoice(v_c, null, p_quote, null);
  update public.invoices set issue_date = p_issue, due_date = p_due where id = v_i;
  perform public.issue_invoice(v_i);
  perform set_config('ims.status_change', 'on', true);
  update public.invoices set issued_at = v_at, created_at = v_at where id = v_i;
  perform set_config('ims.status_change', 'off', true);

  for r in select e.value as p from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) with ordinality e
           order by e.ordinality loop
    select * into inv from public.invoices where id = v_i;
    perform public.record_payment(v_i, (r.p ->> 'on')::date,
      least(round(inv.total * (r.p ->> 'pct')::numeric / 100, 0), inv.total - inv.amount_paid),
      'bank_transfer', r.p ->> 'ref', null, null);
  end loop;
  return v_i;
end;
$$;

-- ---------------------------------------------------------------------
-- Start a demo
-- ---------------------------------------------------------------------
create or replace function public.create_demo_company()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_c uuid;
  v_main uuid;
  v_site uuid;
  r record;
  -- products
  p_oil uuid; p_brg uuid; p_grease uuid; p_caustic uuid; p_vbelt uuid;
  p_filter uuid; p_floc uuid; p_weld uuid; p_gloves uuid; p_splice uuid;
  -- suppliers
  s_lube uuid; s_ind uuid; s_chem uuid; s_ppe uuid;
  -- clients
  c_kilima uuid; c_pwani uuid; c_bonde uuid; c_mto uuid; c_ziwa uuid;
  -- documents
  v_rfq1 uuid; v_rfq2 uuid; v_rfq3 uuid; v_rfq4 uuid;
  q0 uuid; q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; q6 uuid; q7 uuid; q8 uuid; q9 uuid;
  v_po uuid; v_po_in uuid;
  v_bill uuid;
  v_dn uuid;
begin
  if v_user is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;

  -- Abuse limits (serialised so parallel calls cannot slip past them).
  perform pg_advisory_xact_lock(hashtext('ims.create_demo_company'));
  if (select count(*) from public.demo_starts where created_at > now() - interval '1 hour') >= 150 then
    raise exception 'Too many demos have been started in the last hour. Please try again a little later.'
      using errcode = '54000';
  end if;
  if (select count(*) from public.demo_starts where user_id = v_user and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You have restarted the demo many times in the last hour. Please try again a little later.'
      using errcode = '54000';
  end if;

  -- One demo per person: start fresh.
  for r in select m.company_id from public.memberships m join public.companies c on c.id = m.company_id
            where m.user_id = v_user and c.is_demo loop
    perform public.delete_demo_company(r.company_id);
  end loop;

  insert into public.demo_starts (user_id) values (v_user);

  -- ---- Company ---------------------------------------------------------
  perform set_config('ims.demo_create', 'on', true);
  insert into public.companies (
    name, legal_name, tin, vrn, registration_no, address, phone, email, website, bank_details, document_footer,
    vat_rate, quote_validity_days, quote_min_margin_pct, quote_approval_above, quote_terms,
    po_approval_above, po_terms, invoice_due_days, invoice_terms, is_demo, demo_expires_at, created_by)
  values (
    'Demo Supplies Ltd', 'Demo Supplies Limited', '100-200-300', '40-000000-D', 'DEMO-000000',
    'Plot 1, Demo Street, Mikocheni Light Industrial Area, Dar es Salaam, Tanzania',
    '+255 700 000 000', 'demo@example.com', 'https://example.com',
    'Demo Bank — not real. Account name: Demo Supplies Ltd · TZS a/c 0000000000 · USD a/c 0000000001 · SWIFT DEMOTZTZ',
    'Sample document from the LeMoSp demo — not a real company.',
    18, 30, 12, 25000000,
    'Prices exclude VAT unless stated. Delivery ex our Dar es Salaam store unless agreed otherwise.',
    2500000, 'Please quote our PO number on your invoice and delivery note.',
    30, 'Payment by bank transfer to the account shown. Interest may be charged on overdue amounts.',
    true, now() + interval '48 hours', v_user)
  returning id into v_c;
  perform set_config('ims.demo_create', 'off', true);

  insert into public.memberships (company_id, user_id, role) values (v_c, v_user, 'management');
  select id into v_main from public.warehouses where company_id = v_c and code = 'MAIN';
  insert into public.warehouses (company_id, code, name, address)
  values (v_c, 'GEITA', 'Geita site store', 'Container yard, Nyankumbu, Geita') returning id into v_site;
  insert into public.exchange_rates (company_id, currency, rate) values (v_c, 'USD', 2650);

  -- ---- Suppliers -------------------------------------------------------
  insert into public.suppliers (company_id, code, name, country, city, contact_person, email, phone, products_supplied, brands,
                                currency, payment_terms, incoterms, lead_time_days, minimum_order, tax_no, bank_details_received,
                                certificates)
  values (v_c, 'S-0001', 'Bahari Lubricants Ltd', 'Tanzania', 'Dar es Salaam', 'Salum Abdallah', 'sales@bahari-lube.example',
          '+255 700 000 201', 'Hydraulic oils, gear oils, greases', 'Nyota Lubes', 'TZS', 'Net 30', 'DAP', 7, '5 drums',
          '100-201-001', true, 'ISO 9001 (demo)')
  returning id into s_lube;
  insert into public.suppliers (company_id, code, name, country, city, contact_person, email, phone, products_supplied, brands,
                                currency, payment_terms, incoterms, lead_time_days, tax_no, bank_details_received)
  values (v_c, 'S-0002', 'Jangwani Industrial Supplies Ltd', 'Tanzania', 'Dar es Salaam', 'Rehema Kweka',
          'orders@jangwani-industrial.example', '+255 700 000 202', 'Bearings, V-belts, filters, conveyor spares',
          'Kasi Bearings, Mkanda Belts, Imara Filters', 'TZS', 'Net 30', 'DAP', 5, '100-201-002', true)
  returning id into s_ind;
  insert into public.suppliers (company_id, code, name, country, city, contact_person, email, phone, products_supplied, brands,
                                currency, payment_terms, incoterms, lead_time_days, minimum_order, bank_details_received,
                                certificates, notes)
  values (v_c, 'S-0003', 'Dhow Coast Chemicals FZE', 'United Arab Emirates', 'Jebel Ali', 'Imran Qureshi',
          'export@dhowcoast-chem.example', '+971 4 000 0003', 'Caustic soda, flocculants, water-treatment chemicals',
          'Safi Chem', 'USD', 'Net 30', 'CIF', 35, '1 x 20 ft container', true, 'SDS and CoA with every batch',
          'Ships CIF Dar es Salaam; we clear through our agent.')
  returning id into s_chem;
  insert into public.suppliers (company_id, code, name, country, city, contact_person, email, phone, products_supplied, brands,
                                currency, payment_terms, incoterms, lead_time_days, tax_no, bank_details_received)
  values (v_c, 'S-0004', 'Mlimani Safety & Welding Ltd', 'Tanzania', 'Arusha', 'Peter Lyimo', 'info@mlimani-safety.example',
          '+255 700 000 204', 'PPE, gloves, welding consumables', 'Ngao PPE, Moto Weld', 'TZS', 'Net 15', 'DAP', 4,
          '100-201-004', true)
  returning id into s_ppe;

  -- ---- Products and costs ------------------------------------------------
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, mfr_part_no, specification,
                               unit, pack_size, selling_price, reorder_level, sds_on_file, country_of_origin)
  values (v_c, 'LUB-HYD68', 'Hydraulic oil ISO VG 68 — 208 L drum', 'Lubricants and oils', 'Hydraulic oils', 'Nyota Lubes',
          'Nyota Lubes', 'NL-HV68-208', 'ISO VG 68, anti-wear, zinc-free', 'drum', '208 L', 1450000, 10, true, 'Tanzania')
  returning id into p_oil;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, mfr_part_no, specification, unit,
                               selling_price, reorder_level, warranty_months, country_of_origin)
  values (v_c, 'BRG-6312', 'Deep-groove ball bearing 6312', 'Bearings', 'Kasi Bearings', 'Kasi Bearings', '6312-2RS-C3',
          'Bore 60 mm · OD 130 mm · width 31 mm · sealed both sides · C3 clearance', 'pcs', 185000, 20, 12, 'India')
  returning id into p_brg;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, mfr_part_no, specification,
                               unit, pack_size, selling_price, reorder_level, sds_on_file, shelf_life_months)
  values (v_c, 'LUB-EP2-18', 'Grease EP2 — 18 kg pail', 'Lubricants and oils', 'Greases', 'Nyota Lubes', 'Nyota Lubes',
          'NL-EP2-18', 'Lithium complex, NLGI 2, extreme pressure', 'pail', '18 kg', 260000, 15, true, 36)
  returning id into p_grease;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, specification, unit,
                               pack_size, selling_price, reorder_level, hazardous, un_number, cas_number, shelf_life_months,
                               sds_on_file, country_of_origin, notes)
  values (v_c, 'CHM-NAOH-25', 'Caustic soda flakes — 25 kg bag', 'Chemicals', 'Alkalis', 'Safi Chem', 'Safi Chem',
          'Sodium hydroxide ≥ 98 %, flakes', 'bag', '25 kg', 95000, 100, true, 'UN1823', '1310-73-2', 24, true,
          'United Arab Emirates', 'Corrosive (class 8). Store dry, away from acids. CoA per batch.')
  returning id into p_caustic;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, mfr_part_no, specification, unit,
                               selling_price, reorder_level)
  values (v_c, 'MEC-VB-B65', 'V-belt B-65', 'Mechanical spares', 'Mkanda Belts', 'Mkanda Belts', 'B65',
          'Classical wrapped V-belt, section B (17 mm), inside length 65 in', 'pcs', 38000, 30)
  returning id into p_vbelt;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, mfr_part_no, specification, unit,
                               selling_price, reorder_level)
  values (v_c, 'FIL-DSL-01', 'Diesel fuel filter', 'Filters', 'Imara Filters', 'Imara Filters', 'IF-5052-D',
          'Spin-on, 10 micron, water separator', 'pcs', 72000, 25)
  returning id into p_filter;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, specification, unit,
                               pack_size, selling_price, reorder_level, cas_number, shelf_life_months, sds_on_file,
                               country_of_origin, notes)
  values (v_c, 'CHM-FLOC-25', 'Flocculant — 25 kg bag', 'Chemicals', 'Water treatment', 'Safi Chem', 'Safi Chem',
          'Anionic polyacrylamide, high molecular weight, powder', 'bag', '25 kg', 410000, 20, '9003-05-8', 24, true,
          'United Arab Emirates', 'For thickeners and water clarification. CoA per batch.')
  returning id into p_floc;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, specification, unit, pack_size,
                               selling_price, reorder_level, shelf_life_months)
  values (v_c, 'WLD-E6013-5', 'Welding electrodes E6013 — 5 kg', 'Consumables', 'Moto Weld', 'Moto Weld',
          'Rutile electrode, 3.2 mm, AWS A5.1 E6013', 'box', '5 kg', 68000, 40, 36)
  returning id into p_weld;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, specification, unit, pack_size,
                               selling_price, reorder_level)
  values (v_c, 'PPE-GLV-NIT', 'Nitrile safety gloves (box of 100)', 'Safety and PPE', 'Ngao PPE', 'Ngao PPE',
          'Disposable nitrile, powder-free, size L', 'box', '100 pcs', 32000, 50)
  returning id into p_gloves;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, mfr_part_no, specification, unit,
                               selling_price, reorder_level, warranty_months)
  values (v_c, 'MEC-CBSK', 'Conveyor belt splice kit', 'Mechanical spares', 'Mkanda Belts', 'Mkanda Belts', 'MB-SPK-1200',
          'Cold-vulcanising kit for 1,200 mm belts, incl. cement, buffing tools', 'set', 1850000, 2, 6)
  returning id into p_splice;

  insert into public.product_costs (product_id, company_id, main_supplier_id, last_cost) values
    (p_oil,     v_c, s_lube, 1080000),
    (p_brg,     v_c, s_ind,   118000),
    (p_grease,  v_c, s_lube,  182000),
    (p_caustic, v_c, s_chem,   61000),
    (p_vbelt,   v_c, s_ind,    21500),
    (p_filter,  v_c, s_ind,    44000),
    (p_floc,    v_c, s_chem,  291500),
    (p_weld,    v_c, s_ppe,    41000),
    (p_gloves,  v_c, s_ppe,    18500),
    (p_splice,  v_c, s_ind,  1320000);

  -- ---- Clients and contacts ----------------------------------------------
  insert into public.clients (company_id, code, name, industry, tin, vrn, address, region, delivery_sites, payment_terms,
                              currency, credit_limit, tax_status, vendor_status)
  values (v_c, 'C-0001', 'Kilima Gold Mines Ltd', 'Mining', '100-300-001', '40-000101-D', 'P.O. Box 101, Geita', 'Geita',
          'Kilima processing plant, main gate stores, Geita', 'Net 30', 'TZS', 150000000, 'VAT registered', 'Approved vendor')
  returning id into c_kilima;
  insert into public.clients (company_id, code, name, industry, tin, vrn, address, region, delivery_sites, payment_terms,
                              currency, credit_limit, tax_status, vendor_status)
  values (v_c, 'C-0002', 'Pwani Cement Co. Ltd', 'Cement', '100-300-002', '40-000102-D', 'P.O. Box 202, Tanga', 'Tanga',
          'Pwani Cement works, stores receiving bay, Tanga', 'Net 45', 'TZS', 80000000, 'VAT registered', 'Approved vendor')
  returning id into c_pwani;
  insert into public.clients (company_id, code, name, industry, tin, vrn, address, region, delivery_sites, payment_terms,
                              currency, credit_limit, tax_status, vendor_status)
  values (v_c, 'C-0003', 'Bonde Sugar Estates Ltd', 'Sugar', '100-300-003', '40-000103-D', 'P.O. Box 303, Kilombero',
          'Morogoro', 'Bonde factory stores, Kilombero', 'Net 30', 'TZS', 60000000, 'VAT registered', 'Approved vendor')
  returning id into c_bonde;
  insert into public.clients (company_id, code, name, industry, tin, vrn, address, region, delivery_sites, payment_terms,
                              currency, credit_limit, tax_status, vendor_status)
  values (v_c, 'C-0004', 'Mto Energy Ltd', 'Oil & Gas', '100-300-004', '40-000104-D', 'P.O. Box 404, Mtwara', 'Mtwara',
          'Mto Energy gas processing site, Msimbati, Mtwara', '50% advance', 'TZS', 50000000, 'VAT registered',
          'Registration in progress')
  returning id into c_mto;
  insert into public.clients (company_id, code, name, industry, tin, vrn, address, region, delivery_sites, payment_terms,
                              currency, credit_limit, tax_status, vendor_status)
  values (v_c, 'C-0005', 'Ziwa Breweries Ltd', 'Brewing', '100-300-005', '40-000105-D', 'P.O. Box 505, Mwanza', 'Mwanza',
          'Ziwa brewery, Igogo, Mwanza', 'Net 30', 'TZS', 40000000, 'VAT registered', 'Approved vendor')
  returning id into c_ziwa;

  insert into public.client_contacts (company_id, client_id, kind, name, position, email, phone) values
    (v_c, c_kilima, 'purchasing', 'Neema Mushi',     'Procurement Officer',   'neema.mushi@kilima-gold.example',  '+255 700 000 101'),
    (v_c, c_kilima, 'finance',    'Joseph Kimaro',   'Accounts Payable',      'ap@kilima-gold.example',           '+255 700 000 102'),
    (v_c, c_kilima, 'technical',  'Grace Mollel',    'Plant Maintenance Engineer', 'grace.mollel@kilima-gold.example', '+255 700 000 103'),
    (v_c, c_pwani,  'purchasing', 'Hamisi Said',     'Stores & Purchasing',   'purchasing@pwani-cement.example',  '+255 700 000 111'),
    (v_c, c_pwani,  'finance',    'Mary Shirima',    'Finance Officer',       'finance@pwani-cement.example',     '+255 700 000 112'),
    (v_c, c_bonde,  'purchasing', 'Daudi Mwakyusa',  'Purchasing Manager',    'daudi@bonde-sugar.example',        '+255 700 000 121'),
    (v_c, c_bonde,  'finance',    'Zawadi Ngowi',    'Creditors Clerk',       'creditors@bonde-sugar.example',    '+255 700 000 122'),
    (v_c, c_mto,    'purchasing', 'Fatma Rashid',    'Supply Chain Lead',     'scm@mto-energy.example',           '+255 700 000 131'),
    (v_c, c_mto,    'technical',  'Elias Massawe',   'Site Mechanical Supervisor', 'elias.massawe@mto-energy.example', '+255 700 000 132'),
    (v_c, c_ziwa,   'purchasing', 'Agnes Mwita',     'Procurement Officer',   'procurement@ziwa-breweries.example', '+255 700 000 141'),
    (v_c, c_ziwa,   'finance',    'Baraka Juma',     'Accounts',              'accounts@ziwa-breweries.example',  '+255 700 000 142');

  -- ---- Opening stock (some items below their reorder level) ---------------
  perform public.adjust_stock(v_c, p_oil,     v_main, 24,  '',        null,            'Opening stock');
  perform public.adjust_stock(v_c, p_brg,     v_main, 12,  '',        null,            'Opening stock');
  perform public.adjust_stock(v_c, p_grease,  v_main, 40,  'GR-2603', v_today + 700,   'Opening stock');
  perform public.adjust_stock(v_c, p_caustic, v_main, 40,  'CS-2511', v_today + 45,    'Opening stock');
  perform public.adjust_stock(v_c, p_caustic, v_main, 280, 'CS-2607', v_today + 600,   'Opening stock');
  perform public.adjust_stock(v_c, p_vbelt,   v_main, 18,  '',        null,            'Opening stock');
  perform public.adjust_stock(v_c, p_filter,  v_main, 60,  '',        null,            'Opening stock');
  perform public.adjust_stock(v_c, p_weld,    v_main, 85,  'WE-2604', v_today + 900,   'Opening stock');
  perform public.adjust_stock(v_c, p_gloves,  v_main, 140, '',        null,            'Opening stock');
  perform public.adjust_stock(v_c, p_splice,  v_main, 3,   '',        null,            'Opening stock');
  perform public.adjust_stock(v_c, p_grease,  v_site, 8,   'GR-2603', v_today + 700,   'Opening stock');
  perform public.adjust_stock(v_c, p_gloves,  v_site, 20,  '',        null,            'Opening stock');

  -- ---- Purchasing: imported flocculant, received (with landed cost) -------
  v_po_in := public.create_purchase_order(v_c, s_chem, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price)
  values (v_c, v_po_in, p_floc, 'Flocculant — 25 kg bag', 80, 'bag', 110);
  update public.purchase_orders
     set order_date = v_today - 62, expected_date = v_today - 26, delivery_location = 'Main store, Dar es Salaam',
         shipping_instructions = 'Ship CIF Dar es Salaam port. SDS and CoA to accompany the shipment.'
   where id = v_po_in;
  perform public.submit_purchase_order(v_po_in);
  perform public.mark_po_sent(v_po_in);
  perform public.confirm_purchase_order(v_po_in, 'DCC-SO-5521', v_today - 26);
  insert into public.order_costs (company_id, po_id, kind, description, amount, currency, incurred_on) values
    (v_c, v_po_in, 'clearing',  'Clearing & forwarding agent', 1250000, 'TZS', v_today - 27),
    (v_c, v_po_in, 'port',      'Port charges',                 380000, 'TZS', v_today - 27),
    (v_c, v_po_in, 'transport', 'Port to store',                220000, 'TZS', v_today - 26);
  perform public.receive_goods(v_po_in, v_main, v_today - 25, 'DCC-DN-118', 'Received in good order',
    jsonb_build_array(jsonb_build_object('po_line_id', (select id from public.po_lines where po_id = v_po_in),
                                         'quantity', 80, 'batch_no', 'FL-2608', 'expiry_date', v_today + 660)));
  perform public.apply_landed_cost(v_po_in);
  perform set_config('ims.status_change', 'on', true);
  update public.purchase_orders
     set created_at = (v_today - 62 + time '11:00') at time zone 'Africa/Dar_es_Salaam',
         submitted_at = (v_today - 62 + time '11:30') at time zone 'Africa/Dar_es_Salaam',
         approved_at = (v_today - 62 + time '11:30') at time zone 'Africa/Dar_es_Salaam',
         sent_at = (v_today - 62 + time '12:00') at time zone 'Africa/Dar_es_Salaam',
         confirmed_at = (v_today - 60 + time '09:00') at time zone 'Africa/Dar_es_Salaam'
   where id = v_po_in;
  perform set_config('ims.status_change', 'off', true);

  -- Supplier bill for it (USD), half paid.
  insert into public.supplier_bills (company_id, supplier_id, po_id, supplier_invoice_no, bill_date, due_date, currency,
                                     subtotal, vat_amount, notes)
  values (v_c, s_chem, v_po_in, 'DCC-INV-7781', v_today - 25, v_today + 5, 'USD', 8800, 0, 'CIF Dar es Salaam')
  returning id into v_bill;
  perform public.pay_supplier_bill(v_bill, v_today - 20, 4400, 'bank_transfer', 'TT-DEMO-0042', null, '50% on arrival');

  -- Restock order waiting for management approval (submitted by procurement).
  v_po := public.create_purchase_order(v_c, s_ind, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values
    (v_c, v_po, p_brg,   'Deep-groove ball bearing 6312', 40,  'pcs', 118000),
    (v_c, v_po, p_vbelt, 'V-belt B-65',                   100, 'pcs', 21500);
  update public.purchase_orders set delivery_location = 'Main store, Dar es Salaam', order_date = v_today - 1 where id = v_po;
  perform public.submit_purchase_order(v_po);
  perform set_config('ims.status_change', 'on', true);
  update public.purchase_orders
     set status = 'pending_approval', submitted_by = null, approved_at = null, approved_by = null,
         approval_reason = 'value above the purchase approval limit'
   where id = v_po;
  perform set_config('ims.status_change', 'off', true);

  -- Lubricants order confirmed by the supplier, now a day late.
  v_po := public.create_purchase_order(v_c, s_lube, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values
    (v_c, v_po, p_oil,    'Hydraulic oil ISO VG 68 — 208 L drum', 20, 'drum', 1080000),
    (v_c, v_po, p_grease, 'Grease EP2 — 18 kg pail',              30, 'pail', 182000);
  update public.purchase_orders set order_date = v_today - 12, delivery_location = 'Main store, Dar es Salaam' where id = v_po;
  perform public.submit_purchase_order(v_po);
  perform public.mark_po_sent(v_po);
  perform public.confirm_purchase_order(v_po, 'BL-SO-3310', v_today - 1);

  -- Other supplier bills: one overdue, one paid, one open.
  insert into public.supplier_bills (company_id, supplier_id, supplier_invoice_no, bill_date, due_date, currency, subtotal,
                                     vat_amount, notes)
  values (v_c, s_lube, 'BL/INV/0934', v_today - 50, v_today - 20, 'TZS', 10800000, 1944000, 'Hydraulic oil, 10 drums');
  insert into public.supplier_bills (company_id, supplier_id, supplier_invoice_no, bill_date, due_date, currency, subtotal,
                                     vat_amount, notes)
  values (v_c, s_ind, 'JIS-2231', v_today - 70, v_today - 40, 'TZS', 3000000, 540000, 'Bearings and belts')
  returning id into v_bill;
  perform public.pay_supplier_bill(v_bill, v_today - 42, 3540000, 'bank_transfer', 'EFT-DEMO-0031', null, null);
  insert into public.supplier_bills (company_id, supplier_id, supplier_invoice_no, bill_date, due_date, currency, subtotal,
                                     vat_amount, notes)
  values (v_c, s_ppe, 'MSW-118', v_today - 10, v_today + 5, 'TZS', 1400000, 252000, 'Gloves and electrodes');

  -- ---- Client RFQs -----------------------------------------------------------
  insert into public.rfqs (company_id, client_id, title, contact_name, client_ref, received_via, received_on, due_on, assigned_to)
  values (v_c, c_kilima, 'Conveyor shutdown spares — Geita plant', 'Grace Mollel', 'KGM-RFQ-0912', 'visit',
          v_today - 25, v_today - 22, v_user)
  returning id into v_rfq4;
  insert into public.rfq_lines (company_id, rfq_id, product_id, description, quantity, unit) values
    (v_c, v_rfq4, p_splice, 'Conveyor belt splice kit',          2,  'set'),
    (v_c, v_rfq4, p_brg,    'Deep-groove ball bearing 6312',     6,  'pcs'),
    (v_c, v_rfq4, p_weld,   'Welding electrodes E6013 — 5 kg',   20, 'box');

  insert into public.rfqs (company_id, client_id, title, contact_name, client_ref, received_via, received_on, due_on, assigned_to)
  values (v_c, c_pwani, 'Kiln maintenance shutdown spares', 'Hamisi Said', 'PCC/PR/2231', 'email',
          v_today - 6, v_today - 4, v_user)
  returning id into v_rfq1;
  insert into public.rfq_lines (company_id, rfq_id, product_id, description, quantity, unit) values
    (v_c, v_rfq1, p_brg,    'Deep-groove ball bearing 6312', 12, 'pcs'),
    (v_c, v_rfq1, p_vbelt,  'V-belt B-65',                   24, 'pcs'),
    (v_c, v_rfq1, p_grease, 'Grease EP2 — 18 kg pail',        6, 'pail');

  insert into public.rfqs (company_id, client_id, title, contact_name, client_ref, received_via, received_on, due_on, assigned_to)
  values (v_c, c_ziwa, 'Brewhouse CIP chemicals and PPE', 'Agnes Mwita', 'ZB-0457', 'whatsapp',
          v_today - 1, v_today + 2, v_user)
  returning id into v_rfq2;
  insert into public.rfq_lines (company_id, rfq_id, product_id, description, quantity, unit) values
    (v_c, v_rfq2, p_caustic, 'Caustic soda flakes — 25 kg bag',     80, 'bag'),
    (v_c, v_rfq2, p_gloves,  'Nitrile safety gloves (box of 100)',  20, 'box');

  -- New, not yet answered, due today.
  insert into public.rfqs (company_id, client_id, title, contact_name, client_ref, received_via, received_on, due_on, assigned_to,
                           notes)
  values (v_c, c_mto, 'Grease and hydraulic hoses for Msimbati site', 'Fatma Rashid', 'MTO-PR-1188', 'email',
          v_today, v_today, v_user, 'Client asked for delivery to site within 10 days.')
  returning id into v_rfq3;
  insert into public.rfq_lines (company_id, rfq_id, product_id, description, quantity, unit) values
    (v_c, v_rfq3, p_grease, 'Grease EP2 — 18 kg pail', 12, 'pail'),
    (v_c, v_rfq3, null,     'Hydraulic hose 1/2" two-wire (R2), 20 m roll', 4, 'roll');

  -- ---- Quotations (oldest first) ---------------------------------------------
  q0 := public.demo_quote(v_c, c_mto, null, jsonb_build_array(
          jsonb_build_object('p', p_oil, 'q', 8), jsonb_build_object('p', p_filter, 'q', 30)),
        v_today - 172, 30, 'accepted', 'Ex-stock');
  q1 := public.demo_quote(v_c, c_kilima, null, jsonb_build_array(
          jsonb_build_object('p', p_oil, 'q', 6), jsonb_build_object('p', p_grease, 'q', 10),
          jsonb_build_object('p', p_brg, 'q', 8)),
        v_today - 141, 30, 'accepted', 'Ex-stock, 2–3 days to site');
  q2 := public.demo_quote(v_c, c_pwani, null, jsonb_build_array(
          jsonb_build_object('p', p_vbelt, 'q', 40), jsonb_build_object('p', p_filter, 'q', 20),
          jsonb_build_object('p', p_gloves, 'q', 30), jsonb_build_object('p', p_weld, 'q', 25)),
        v_today - 112, 30, 'accepted', 'Ex-stock');
  q3 := public.demo_quote(v_c, c_bonde, null, jsonb_build_array(
          jsonb_build_object('p', p_caustic, 'q', 120), jsonb_build_object('p', p_floc, 'q', 20)),
        v_today - 83, 30, 'accepted', 'Ex-stock');
  q4 := public.demo_quote(v_c, c_ziwa, null, jsonb_build_array(
          jsonb_build_object('p', p_caustic, 'q', 60), jsonb_build_object('p', p_gloves, 'q', 50)),
        v_today - 52, 30, 'accepted', 'Ex-stock');
  q5 := public.demo_quote(v_c, c_kilima, v_rfq4, null, v_today - 24, 30, 'accepted', '1 week');
  q6 := public.demo_quote(v_c, c_mto, null, jsonb_build_array(
          jsonb_build_object('p', p_oil, 'q', 4), jsonb_build_object('p', p_filter, 'q', 10)),
        v_today - 9, 30, 'accepted', 'Ex-stock, delivery to site');
  q7 := public.demo_quote(v_c, c_pwani, v_rfq1, null, v_today - 5, 7, 'sent', '3–5 days');
  q8 := public.demo_quote(v_c, c_bonde, null, jsonb_build_array(
          jsonb_build_object('p', p_floc, 'q', 40, 'price', 300000)),
        v_today - 2, 30, 'pending', 'Ex-stock');
  q9 := public.demo_quote(v_c, c_ziwa, v_rfq2, null, v_today, 30, 'draft', 'Ex-stock');

  -- Extra cost on an order (shows on the profit report).
  insert into public.order_costs (company_id, quotation_id, kind, description, amount, currency, incurred_on)
  values (v_c, q1, 'transport', 'Truck hire Dar es Salaam → Geita', 650000, 'TZS', v_today - 138);

  -- ---- Invoices and payments, spread over the last six months -------------------
  perform public.demo_invoice(q0, v_today - 168, v_today - 138, jsonb_build_array(
    jsonb_build_object('on', v_today - 140, 'pct', 100, 'ref', 'MTO-EFT-2201')));
  perform public.demo_invoice(q1, v_today - 136, v_today - 106, jsonb_build_array(
    jsonb_build_object('on', v_today - 108, 'pct', 100, 'ref', 'KGM-EFT-7781')));
  perform public.demo_invoice(q2, v_today - 108, v_today - 63, jsonb_build_array(
    jsonb_build_object('on', v_today - 75, 'pct', 50, 'ref', 'PCC-CHQ-0412'),
    jsonb_build_object('on', v_today - 60, 'pct', 100, 'ref', 'PCC-CHQ-0433')));
  -- Part-paid and overdue.
  perform public.demo_invoice(q3, v_today - 78, v_today - 48, jsonb_build_array(
    jsonb_build_object('on', v_today - 40, 'pct', 50, 'ref', 'BSE-EFT-3390')));
  -- Unpaid and overdue.
  perform public.demo_invoice(q4, v_today - 48, v_today - 18, null);
  -- Recent, not yet due.
  perform public.demo_invoice(q5, v_today - 18, v_today + 12, null);
  -- Advance invoice this month, half paid.
  perform public.demo_invoice(q6, v_today, v_today + 30, jsonb_build_array(
    jsonb_build_object('on', v_today, 'pct', 50, 'ref', 'MTO-EFT-2290')));

  -- ---- Deliveries ------------------------------------------------------------
  -- Part of the Mto Energy order is on the road (the demo user is the driver,
  -- so "View as Driver" shows it); the rest waits in a draft delivery note.
  v_dn := public.create_delivery(v_c, null, q6, v_main);
  update public.delivery_lines set quantity = 6 where delivery_id = v_dn and product_id = p_filter;
  update public.deliveries
     set driver_id = v_user, vehicle = 'T 123 DMO', planned_date = v_today, contact_name = 'Elias Massawe',
         contact_phone = '+255 700 000 132', notes = 'Call the site supervisor 1 hour before arrival.'
   where id = v_dn;
  perform public.dispatch_delivery(v_dn);

  v_dn := public.create_delivery(v_c, null, q6, v_main);
  update public.deliveries
     set planned_date = v_today + 3, contact_name = 'Elias Massawe', contact_phone = '+255 700 000 132',
         notes = 'Balance of the order.'
   where id = v_dn;

  -- ---- Record times match the document dates (lists are sorted by them) ----------
  perform set_config('ims.status_change', 'on', true);
  update public.rfqs
     set created_at = least((received_on + time '08:45') at time zone 'Africa/Dar_es_Salaam', now()) where company_id = v_c;
  update public.goods_receipts
     set created_at = least((received_on + time '13:00') at time zone 'Africa/Dar_es_Salaam', now()) where company_id = v_c;
  update public.supplier_bills
     set created_at = least((bill_date + time '14:00') at time zone 'Africa/Dar_es_Salaam', now()) where company_id = v_c;
  update public.payments
     set created_at = least((received_on + time '15:00') at time zone 'Africa/Dar_es_Salaam', now()) where company_id = v_c;
  update public.supplier_payments
     set created_at = least((paid_on + time '15:00') at time zone 'Africa/Dar_es_Salaam', now()) where company_id = v_c;
  perform set_config('ims.status_change', 'off', true);

  -- ---- Notifications -----------------------------------------------------------
  perform public.notify(v_c, v_user, 'demo_welcome', 'info', 'Welcome to your demo company',
    'Everything here is sample data and is deleted after 48 hours. Try approving a quotation, receiving goods, '
      || 'or use "View as" to see the app as Sales, Driver or Finance.',
    '/', 'demo-welcome');
  perform public.run_company_alerts(v_c);

  return v_c;
end;
$$;

-- ---------------------------------------------------------------------
-- "View as": change your own role in your demo company
-- ---------------------------------------------------------------------
create or replace function public.set_demo_role(p_role public.app_role)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_m public.memberships;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'Choose a role.' using errcode = '22023';
  end if;
  select m.* into v_m from public.memberships m join public.companies c on c.id = m.company_id
   where m.user_id = auth.uid() and c.is_demo
   order by c.created_at desc limit 1;
  if v_m.id is null then
    raise exception 'Switching roles is only available in the demo company.' using errcode = '42501';
  end if;
  update public.memberships set role = p_role, active = true where id = v_m.id;
  -- Alerts for the new role straight away.
  perform public.run_company_alerts(v_m.company_id);
end;
$$;

-- ---------------------------------------------------------------------
-- End the demo now (deletes the caller's demo company and its data)
-- ---------------------------------------------------------------------
create or replace function public.end_demo()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  for r in select m.company_id from public.memberships m join public.companies c on c.id = m.company_id
            where m.user_id = auth.uid() and c.is_demo loop
    if public.delete_demo_company(r.company_id) then
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n = 0 then
    raise exception 'You have no demo company.' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Clean-up (scheduled): expired demos, old demo log rows, and guest
-- users that are no longer in any company (after an hour, so a guest who
-- has just signed in is not removed before their demo is created).
-- ---------------------------------------------------------------------
create or replace function public.purge_demo_companies()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
begin
  for r in select id from public.companies where is_demo and demo_expires_at <= now() loop
    -- One stubborn demo must never stop the scheduled alerts for everyone else.
    begin
      if public.delete_demo_company(r.id) then
        v_n := v_n + 1;
      end if;
    exception when others then
      raise warning 'Demo % could not be removed: %', r.id, sqlerrm;
    end;
  end loop;
  delete from public.demo_starts where created_at < now() - interval '1 day';
  begin
    delete from auth.users u
     where u.is_anonymous
       and u.created_at < now() - interval '1 hour'
       and not exists (select 1 from public.memberships m where m.user_id = u.id);
  exception when others then
    raise notice 'Guest users not removed: %', sqlerrm;
  end;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- Scheduled entry point: as Stage 7, plus the demo clean-up first.
-- ---------------------------------------------------------------------
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
  perform public.purge_demo_companies();
  for c in select id from public.companies loop
    v_total := v_total + public.run_company_alerts(c.id);
  end loop;
  return v_total;
end;
$$;

-- Outbox: as Stage 7, but demo companies never send push or email (their
-- pending notifications are simply marked as handled).
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
  update public.notifications n set dispatched_at = now()
   where n.dispatched_at is null and n.severity <> 'info'
     and n.company_id in (select co.id from public.companies co where co.is_demo);
  return query
  with picked as (
    select n.id from public.notifications n
     where n.dispatched_at is null and n.severity <> 'info' and n.created_at > now() - interval '2 days'
       and not exists (select 1 from public.companies d where d.id = n.company_id and d.is_demo)
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

-- ---------------------------------------------------------------------
-- Grants (new functions are executable by PUBLIC by default: revoke)
-- ---------------------------------------------------------------------
revoke execute on function
  public.is_anonymous_user(), public.guard_demo_membership(), public.delete_demo_company(uuid),
  public.demo_quote(uuid, uuid, uuid, jsonb, date, integer, text, text), public.demo_invoice(uuid, date, date, jsonb),
  public.create_demo_company(), public.set_demo_role(public.app_role), public.end_demo(), public.purge_demo_companies()
from public, anon, authenticated;
grant execute on function
  public.is_anonymous_user(), public.create_demo_company(), public.set_demo_role(public.app_role), public.end_demo()
to authenticated;

-- Redefined functions keep their grants; restated for clarity.
revoke execute on function
  public.create_company(text), public.invite_member(uuid, text, public.app_role), public.accept_invitation(uuid),
  public.guard_new_company()
from public, anon;
grant execute on function
  public.create_company(text), public.invite_member(uuid, text, public.app_role), public.accept_invitation(uuid)
to authenticated;
revoke execute on function public.run_all_alerts(text), public.claim_outbox(text, integer) from public;
grant execute on function public.run_all_alerts(text), public.claim_outbox(text, integer) to anon, authenticated;

notify pgrst, 'reload schema';
