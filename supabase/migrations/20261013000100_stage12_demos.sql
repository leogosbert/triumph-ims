-- =====================================================================
-- LeMoSp  ·  Stage 12: demos for all three business levels
--
--   create_demo_company(level default 'medium')
--       Small      "Neema General Supplies (demo)"  – a small trader
--       Medium     "Demo Supplies Ltd"              – the Stage 10 demo
--       Enterprise "Demo Industrial Group Ltd"      – stores in four
--                  regions, imports in USD/EUR, approvals, supplier
--                  comparison, a year of invoices
--     The company's business_level is the chosen level, so the Stage 11
--     feature defaults follow it. Every Stage 10 rule still applies:
--     sign-in required, abuse limits, one demo per person (starting
--     again replaces it), guests stay inside their demo, created even
--     when new companies are switched off, expires after 48 hours,
--     no onboarding questions.
--   switch_demo_level(level) – replace the caller's demo with a fresh
--                              one at another level (same limits).
--   my_demo_level()          – level of the caller's demo, or null.
--
-- All sample data is fictional and goes through the normal workflow
-- functions, as in Stage 10. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Seed helpers (internal, never callable by users)
-- ---------------------------------------------------------------------

-- A quotation at a given stage: draft | pending | sent | accepted | rejected.
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
  elsif p_stage = 'rejected' then
    perform public.record_quotation_outcome(v_q, false, 'Client chose another supplier on price');
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
-- p_payments: [{on: date, pct: percent of the total (capped at what is still owed), ref,
--               method: optional, bank_transfer by default}]
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
    -- 100 % settles the balance exactly; part payments are whole shillings (cents in other currencies).
    perform public.record_payment(v_i, (r.p ->> 'on')::date,
      case when (r.p ->> 'pct')::numeric >= 100 then inv.total - inv.amount_paid
           else least(round(inv.total * (r.p ->> 'pct')::numeric / 100,
                            case when inv.currency = (select base_currency from public.companies where id = v_c) then 0 else 2 end),
                      inv.total - inv.amount_paid) end,
      coalesce(r.p ->> 'method', 'bank_transfer'), r.p ->> 'ref', null, null);
  end loop;
  return v_i;
end;
$$;

-- Dispatch a draft delivery note and record it as delivered on a past day
-- (sample proof of delivery: receiver's name, no signature file).
create or replace function public.demo_deliver(p_delivery uuid, p_on date, p_received_by text, p_vehicle text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_at timestamptz := least((p_on + time '08:00') at time zone 'Africa/Dar_es_Salaam', now());
begin
  update public.deliveries
     set driver_id = auth.uid(), vehicle = p_vehicle, planned_date = p_on
   where id = p_delivery;
  perform public.dispatch_delivery(p_delivery);
  perform set_config('ims.status_change', 'on', true);
  update public.deliveries
     set status = 'delivered', dispatched_at = v_at, delivered_at = least(v_at + interval '5 hours', now()),
         received_by_name = p_received_by, pod_recorded_by = auth.uid(),
         pod_notes = 'Sample proof of delivery (demo): goods received in good order.',
         created_at = v_at - interval '1 hour'
   where id = p_delivery;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- A growth recommendation for a demo company (the growth engine never checks
-- demos). Uses an existing rule; skipped quietly if the platform admin has
-- removed that rule or its feature.
create or replace function public.demo_recommend(p_company uuid, p_rule text, p_value numeric, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.recommendation_rules;
  v_id uuid;
begin
  select * into r from public.recommendation_rules where key = p_rule;
  if r.key is null
     or (r.feature_key is not null and not exists (select 1 from public.features f where f.key = r.feature_key)) then
    return;
  end if;
  insert into public.company_recommendations (company_id, rule_key, feature_key, target_level, title, reason, metric_value,
                                              threshold)
  values (p_company, r.key, r.feature_key, r.target_level, r.title, p_reason, p_value, r.threshold)
  on conflict (company_id, rule_key) do nothing
  returning id into v_id;
  if v_id is not null then
    perform public.notify(p_company, auth.uid(), 'growth', 'info', 'Suggestion for your business: ' || r.title, p_reason,
      '/growth', 'growth-' || v_id);
  end if;
end;
$$;

-- Record times match the document dates (lists are sorted by them).
create or replace function public.demo_fix_times(p_company uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('ims.status_change', 'on', true);
  update public.rfqs
     set created_at = least((received_on + time '08:45') at time zone 'Africa/Dar_es_Salaam', now()) where company_id = p_company;
  update public.goods_receipts
     set created_at = least((received_on + time '13:00') at time zone 'Africa/Dar_es_Salaam', now()) where company_id = p_company;
  update public.supplier_bills
     set created_at = least((bill_date + time '14:00') at time zone 'Africa/Dar_es_Salaam', now()) where company_id = p_company;
  update public.payments
     set created_at = least((received_on + time '15:00') at time zone 'Africa/Dar_es_Salaam', now()) where company_id = p_company;
  update public.supplier_payments
     set created_at = least((paid_on + time '15:00') at time zone 'Africa/Dar_es_Salaam', now()) where company_id = p_company;
  update public.purchase_orders
     set created_at = least((order_date + time '11:00') at time zone 'Africa/Dar_es_Salaam', now()),
         submitted_at = case when submitted_at is not null
                             then least((order_date + time '11:30') at time zone 'Africa/Dar_es_Salaam', now()) end,
         approved_at = case when approved_at is not null
                            then least((order_date + time '11:30') at time zone 'Africa/Dar_es_Salaam', now()) end,
         sent_at = case when sent_at is not null
                        then least((order_date + time '12:00') at time zone 'Africa/Dar_es_Salaam', now()) end,
         confirmed_at = case when confirmed_at is not null
                             then least((order_date + 2 + time '09:00') at time zone 'Africa/Dar_es_Salaam', now()) end
   where company_id = p_company;
  perform set_config('ims.status_change', 'off', true);
end;
$$;


-- ---------------------------------------------------------------------
-- SMALL: "Neema General Supplies (demo)" — a small trader in Sinza,
-- Dar es Salaam. One shop/store, Shillings only, not VAT registered,
-- no approvals, no supplier quotation requests. Mobile money, cash and
-- bank payments over the last three months; one overdue invoice; two
-- items running low.
-- ---------------------------------------------------------------------
create or replace function public.demo_seed_small()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_c uuid;
  v_main uuid;
  v_po uuid;
  v_dn uuid;
  -- products
  p_paper uuid; p_pens uuid; p_bleach uuid; p_soap uuid; p_gloves uuid; p_vest uuid; p_barrow uuid; p_oil uuid;
  -- suppliers
  s_stat uuid; s_hw uuid;
  -- clients
  c_school uuid; c_hotel uuid; c_build uuid; c_ngo uuid;
  -- documents
  v_rfq uuid;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; q6 uuid; q7 uuid; q8 uuid;
begin
  if v_user is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;

  -- ---- Company ---------------------------------------------------------
  perform set_config('ims.demo_create', 'on', true);
  insert into public.companies (
    name, legal_name, tin, registration_no, address, phone, email, bank_details, document_footer, second_currency,
    vat_rate, quote_validity_days, quote_min_margin_pct, quote_approval_above, quote_terms,
    po_approval_above, po_terms, invoice_due_days, invoice_terms, is_demo, demo_expires_at, created_by, business_level)
  values (
    'Neema General Supplies (demo)', 'Neema General Supplies', '100-400-100', 'BRELA-DEMO-0001',
    'Shop No. 4, Sinza Mori, Kinondoni, Dar es Salaam, Tanzania',
    '+255 700 000 400', 'neema.demo@example.com',
    'Demo Bank — not real. Account: Neema General Supplies · TZS a/c 0000000400 · M-Pesa Lipa Namba 000400 (demo)',
    'Sample document from the LeMoSp demo — not a real company.', null,
    0, 14, 0, 1000000000000,
    'Prices in TZS. Not VAT registered. Delivery free within Dar es Salaam for orders above TZS 500,000.',
    1000000000000, 'Please deliver to our Sinza shop and bring a delivery note.',
    30, 'Pay by M-Pesa (Lipa Namba 000400), cash at the shop or bank transfer.',
    true, now() + interval '48 hours', v_user, 'small')
  returning id into v_c;
  perform set_config('ims.demo_create', 'off', true);

  insert into public.memberships (company_id, user_id, role) values (v_c, v_user, 'management');
  select id into v_main from public.warehouses where company_id = v_c and code = 'MAIN';
  update public.warehouses set name = 'Shop & store, Sinza' where id = v_main;

  -- ---- Suppliers (local, Shillings) -------------------------------------------
  insert into public.suppliers (company_id, code, name, country, city, contact_person, email, phone, products_supplied,
                                currency, payment_terms, lead_time_days, notes)
  values (v_c, 'S-0001', 'Kariakoo Stationery Wholesalers', 'Tanzania', 'Dar es Salaam', 'Halima Mrisho',
          'orders@kariakoo-stationery.example', '+255 700 000 411', 'Paper, pens, office supplies', 'TZS', 'Cash on delivery', 1,
          'Delivers by boda-boda the same day for orders before 11:00.')
  returning id into s_stat;
  insert into public.suppliers (company_id, code, name, country, city, contact_person, email, phone, products_supplied,
                                currency, payment_terms, lead_time_days)
  values (v_c, 'S-0002', 'Tegeta Hardware & Lubricants', 'Tanzania', 'Dar es Salaam', 'Godfrey Mallya',
          'sales@tegeta-hardware.example', '+255 700 000 412', 'Cleaning materials, PPE, tools, engine oil', 'TZS', 'Net 7', 2)
  returning id into s_hw;

  -- ---- Products and costs ------------------------------------------------
  insert into public.products (company_id, sku, name, category, brand, specification, unit, pack_size, selling_price, reorder_level)
  values (v_c, 'OFF-A4-BOX', 'A4 copy paper 80 gsm — box of 5 reams', 'Office supplies', 'Karatasi Bora',
          '80 gsm, 500 sheets per ream, white', 'box', '5 reams', 72000, 10)
  returning id into p_paper;
  insert into public.products (company_id, sku, name, category, brand, specification, unit, pack_size, selling_price, reorder_level)
  values (v_c, 'OFF-PEN-50', 'Ballpoint pens, blue — box of 50', 'Office supplies', 'Kalamu', 'Medium point 1.0 mm',
          'box', '50 pcs', 15000, 5)
  returning id into p_pens;
  insert into public.products (company_id, sku, name, category, brand, specification, unit, pack_size, selling_price, reorder_level)
  values (v_c, 'CLN-BLEACH-5', 'Bleach — 5 L', 'Cleaning materials', 'Safi Home', 'Sodium hypochlorite 3.5 %',
          'jerrycan', '5 L', 18000, 10)
  returning id into p_bleach;
  insert into public.products (company_id, sku, name, category, brand, specification, unit, pack_size, selling_price, reorder_level)
  values (v_c, 'CLN-SOAP-20', 'Liquid hand & floor soap — 20 L', 'Cleaning materials', 'Safi Home', 'Multi-purpose, lemon',
          'jerrycan', '20 L', 45000, 5)
  returning id into p_soap;
  insert into public.products (company_id, sku, name, category, brand, specification, unit, selling_price, reorder_level)
  values (v_c, 'PPE-GLV-LTH', 'Leather work gloves (pair)', 'Safety and PPE', 'Ngao PPE', 'Cow-split leather, size L',
          'pair', 9000, 20)
  returning id into p_gloves;
  insert into public.products (company_id, sku, name, category, brand, specification, unit, selling_price, reorder_level)
  values (v_c, 'PPE-VEST-HV', 'Reflective safety vest', 'Safety and PPE', 'Ngao PPE', 'Hi-vis orange, two reflective bands',
          'pcs', 8000, 20)
  returning id into p_vest;
  insert into public.products (company_id, sku, name, category, brand, specification, unit, selling_price, reorder_level,
                               warranty_months)
  values (v_c, 'TLS-BARROW', 'Wheelbarrow 65 L heavy duty', 'Basic tools', 'Imara Tools', 'Steel tray, pneumatic wheel',
          'pcs', 145000, 4, 6)
  returning id into p_barrow;
  insert into public.products (company_id, sku, name, category, brand, specification, unit, pack_size, selling_price,
                               reorder_level, sds_on_file)
  values (v_c, 'LUB-15W40-5', 'Engine oil SAE 15W-40 — 5 L', 'Lubricants', 'Nyota Lubes', 'API CI-4, diesel and petrol engines',
          'can', '5 L', 48000, 10, true)
  returning id into p_oil;

  insert into public.product_costs (product_id, company_id, main_supplier_id, last_cost) values
    (p_paper,  v_c, s_stat, 58000),
    (p_pens,   v_c, s_stat, 10500),
    (p_bleach, v_c, s_hw,   12500),
    (p_soap,   v_c, s_hw,   33000),
    (p_gloves, v_c, s_hw,    5500),
    (p_vest,   v_c, s_hw,    4800),
    (p_barrow, v_c, s_hw,  112000),
    (p_oil,    v_c, s_hw,   37500);

  -- ---- Customers -----------------------------------------------------------
  insert into public.clients (company_id, code, name, industry, tin, address, region, delivery_sites, payment_terms, currency,
                              tax_status)
  values (v_c, 'C-0001', 'Upendo Hill Secondary School', 'Education', '100-500-001', 'P.O. Box 501, Kimara, Dar es Salaam',
          'Dar es Salaam', 'School office, Kimara Suka', 'Net 30', 'TZS', 'Exempt')
  returning id into c_school;
  insert into public.clients (company_id, code, name, industry, tin, address, region, delivery_sites, payment_terms, currency)
  values (v_c, 'C-0002', 'Pwani Breeze Hotel Ltd', 'Hospitality', '100-500-002', 'Plot 9, Mbezi Beach, Dar es Salaam',
          'Dar es Salaam', 'Housekeeping store, back gate', 'Cash on delivery', 'TZS')
  returning id into c_hotel;
  insert into public.clients (company_id, code, name, industry, tin, address, region, delivery_sites, payment_terms, currency)
  values (v_c, 'C-0003', 'Imara Builders & Contractors', 'Construction', '100-500-003', 'P.O. Box 503, Mbezi Luis, Dar es Salaam',
          'Dar es Salaam', 'Building site, Goba (call the foreman)', 'Net 30', 'TZS')
  returning id into c_build;
  insert into public.clients (company_id, code, name, industry, address, region, delivery_sites, payment_terms, currency,
                              tax_status)
  values (v_c, 'C-0004', 'Tumaini Community Health Initiative', 'NGO', 'Plot 22, Mwenge, Dar es Salaam', 'Dar es Salaam',
          'Office reception, Mwenge', 'Net 14', 'TZS', 'Exempt')
  returning id into c_ngo;

  insert into public.client_contacts (company_id, client_id, kind, name, position, email, phone) values
    (v_c, c_school, 'purchasing', 'Mwalimu Esther Kileo', 'Bursar',               'bursar@upendo-school.example', '+255 700 000 421'),
    (v_c, c_hotel,  'purchasing', 'Ali Mussa',            'Housekeeping Manager', 'housekeeping@pwanibreeze.example', '+255 700 000 422'),
    (v_c, c_build,  'purchasing', 'Emmanuel Shayo',       'Site Foreman',         'site@imara-builders.example',  '+255 700 000 423'),
    (v_c, c_ngo,    'finance',    'Rose Mbwambo',         'Office Administrator', 'admin@tumaini-chi.example',    '+255 700 000 424');

  -- ---- Opening stock (three months ago) ---------------------------------------
  perform public.adjust_stock(v_c, p_paper,  v_main, 12, '', null, 'Opening stock');
  perform public.adjust_stock(v_c, p_pens,   v_main, 10, '', null, 'Opening stock');
  perform public.adjust_stock(v_c, p_bleach, v_main, 15, '', null, 'Opening stock');
  perform public.adjust_stock(v_c, p_soap,   v_main, 6,  '', null, 'Opening stock');
  perform public.adjust_stock(v_c, p_gloves, v_main, 30, '', null, 'Opening stock');
  perform public.adjust_stock(v_c, p_vest,   v_main, 25, '', null, 'Opening stock');
  perform public.adjust_stock(v_c, p_barrow, v_main, 5,  '', null, 'Opening stock');
  perform public.adjust_stock(v_c, p_oil,    v_main, 8,  '', null, 'Opening stock');

  -- ---- Simple purchase orders, all received -------------------------------
  v_po := public.create_purchase_order(v_c, s_stat, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values
    (v_c, v_po, p_paper, 'A4 copy paper 80 gsm — box of 5 reams', 30, 'box', 58000),
    (v_c, v_po, p_pens,  'Ballpoint pens, blue — box of 50',      10, 'box', 10500);
  update public.purchase_orders set order_date = v_today - 78, expected_date = v_today - 77,
         delivery_location = 'Shop & store, Sinza' where id = v_po;
  perform public.submit_purchase_order(v_po);
  perform public.mark_po_sent(v_po);
  perform public.receive_goods(v_po, v_main, v_today - 77, 'KSW-4471', 'Received by Neema',
    (select jsonb_agg(jsonb_build_object('po_line_id', id, 'quantity', quantity)) from public.po_lines where po_id = v_po));

  v_po := public.create_purchase_order(v_c, s_hw, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values
    (v_c, v_po, p_gloves, 'Leather work gloves (pair)',   60, 'pair', 5500),
    (v_c, v_po, p_vest,   'Reflective safety vest',       40, 'pcs',  4800),
    (v_c, v_po, p_oil,    'Engine oil SAE 15W-40 — 5 L',  6,  'can',  37500);
  update public.purchase_orders set order_date = v_today - 52, expected_date = v_today - 50,
         delivery_location = 'Shop & store, Sinza' where id = v_po;
  perform public.submit_purchase_order(v_po);
  perform public.mark_po_sent(v_po);
  perform public.receive_goods(v_po, v_main, v_today - 50, 'THL-0932', 'Received by Neema',
    (select jsonb_agg(jsonb_build_object('po_line_id', id, 'quantity', quantity)) from public.po_lines where po_id = v_po));

  v_po := public.create_purchase_order(v_c, s_hw, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values
    (v_c, v_po, p_bleach, 'Bleach — 5 L',                     30, 'jerrycan', 12500),
    (v_c, v_po, p_soap,   'Liquid hand & floor soap — 20 L',  12, 'jerrycan', 33000);
  update public.purchase_orders set order_date = v_today - 21, expected_date = v_today - 19,
         delivery_location = 'Shop & store, Sinza' where id = v_po;
  perform public.submit_purchase_order(v_po);
  perform public.mark_po_sent(v_po);
  perform public.receive_goods(v_po, v_main, v_today - 19, 'THL-1017', 'Two jerrycans of soap to follow next week',
    (select jsonb_agg(jsonb_build_object('po_line_id', id, 'quantity', quantity)) from public.po_lines where po_id = v_po));

  -- ---- Quotations (a customer request came by WhatsApp) -----------------------
  insert into public.rfqs (company_id, client_id, title, contact_name, received_via, received_on, due_on, assigned_to, notes)
  values (v_c, c_school, 'Exam-term stationery', 'Mwalimu Esther Kileo', 'whatsapp', v_today - 2, v_today + 1, v_user,
          'Needs prices before the board meeting on Friday.')
  returning id into v_rfq;
  insert into public.rfq_lines (company_id, rfq_id, product_id, description, quantity, unit) values
    (v_c, v_rfq, p_paper, 'A4 copy paper 80 gsm — box of 5 reams', 15, 'box'),
    (v_c, v_rfq, p_pens,  'Ballpoint pens, blue — box of 50',      6,  'box');

  q1 := public.demo_quote(v_c, c_hotel, null, jsonb_build_array(
          jsonb_build_object('p', p_bleach, 'q', 10), jsonb_build_object('p', p_soap, 'q', 4)),
        v_today - 86, 14, 'accepted', 'Same day');
  q2 := public.demo_quote(v_c, c_school, null, jsonb_build_array(
          jsonb_build_object('p', p_paper, 'q', 20), jsonb_build_object('p', p_pens, 'q', 4)),
        v_today - 72, 14, 'accepted', 'Next day');
  q3 := public.demo_quote(v_c, c_build, null, jsonb_build_array(
          jsonb_build_object('p', p_gloves, 'q', 40), jsonb_build_object('p', p_vest, 'q', 30),
          jsonb_build_object('p', p_barrow, 'q', 3), jsonb_build_object('p', p_oil, 'q', 6)),
        v_today - 47, 14, 'accepted', '2 days, delivered to site');
  q4 := public.demo_quote(v_c, c_ngo, null, jsonb_build_array(
          jsonb_build_object('p', p_paper, 'q', 6), jsonb_build_object('p', p_soap, 'q', 3),
          jsonb_build_object('p', p_bleach, 'q', 6)),
        v_today - 27, 14, 'accepted', 'Next day');
  q5 := public.demo_quote(v_c, c_hotel, null, jsonb_build_array(
          jsonb_build_object('p', p_bleach, 'q', 12), jsonb_build_object('p', p_soap, 'q', 5),
          jsonb_build_object('p', p_gloves, 'q', 10)),
        v_today - 9, 14, 'accepted', 'Same day');
  q6 := public.demo_quote(v_c, c_build, null, jsonb_build_array(
          jsonb_build_object('p', p_barrow, 'q', 6, 'price', 150000)),
        v_today - 35, 14, 'rejected', '1 week');
  q7 := public.demo_quote(v_c, c_ngo, null, jsonb_build_array(
          jsonb_build_object('p', p_vest, 'q', 25), jsonb_build_object('p', p_gloves, 'q', 25)),
        v_today - 4, 14, 'sent', 'Ex-stock');
  q8 := public.demo_quote(v_c, c_school, v_rfq, null, v_today, 14, 'draft', 'Next day');

  -- ---- Invoices and payments (mobile money, bank, cash) ---------------------------
  perform public.demo_invoice(q1, v_today - 85, v_today - 85, jsonb_build_array(
    jsonb_build_object('on', v_today - 85, 'pct', 100, 'ref', 'M-Pesa QJK4D7XT2A', 'method', 'mobile_money')));
  perform public.demo_invoice(q2, v_today - 70, v_today - 40, jsonb_build_array(
    jsonb_build_object('on', v_today - 43, 'pct', 100, 'ref', 'EFT UPENDO-0311', 'method', 'bank_transfer')));
  -- Unpaid and overdue.
  perform public.demo_invoice(q3, v_today - 45, v_today - 15, null);
  -- Half paid in cash, not yet due.
  perform public.demo_invoice(q4, v_today - 25, v_today + 5, jsonb_build_array(
    jsonb_build_object('on', v_today - 12, 'pct', 50, 'ref', 'Receipt book 0457', 'method', 'cash')));
  perform public.demo_invoice(q5, v_today - 8, v_today - 8, jsonb_build_array(
    jsonb_build_object('on', v_today - 8, 'pct', 100, 'ref', 'Tigo Pesa 8F21KX90', 'method', 'mobile_money')));

  -- ---- Deliveries (the owner delivers with the shop's pick-up) ----------------------
  v_dn := public.create_delivery(v_c, null, q3, v_main);
  perform public.demo_deliver(v_dn, v_today - 44, 'Emmanuel Shayo (site foreman)', 'T 456 DMO (pick-up)');
  v_dn := public.create_delivery(v_c, null, q5, v_main);
  perform public.demo_deliver(v_dn, v_today - 8, 'Ali Mussa (housekeeping)', 'T 456 DMO (pick-up)');

  perform public.demo_fix_times(v_c);

  -- ---- Suggestion Box ------------------------------------------------------------
  perform public.submit_suggestion(v_c, 'sales', 'Send quotations by WhatsApp the same day',
    'Customers like the hotel decide quickly. If we share the PDF on WhatsApp within an hour we win more orders.');
  perform set_config('ims.status_change', 'on', true);
  update public.suggestions set created_at = now() - interval '6 days' where company_id = v_c;
  perform set_config('ims.status_change', 'off', true);

  -- ---- Growth suggestions (the growth engine never checks demos) ------------------
  perform public.demo_recommend(v_c, 'credit_customers', 3,
    'Three of your four customers pay on account, and Imara Builders & Contractors is 15 days late. '
      || 'Credit limits and payment terms protect your cash flow.');
  perform public.demo_recommend(v_c, 'products_inventory', 2,
    'Wheelbarrows and engine oil are running low. Reorder levels and low-stock alerts help you buy in time.');

  -- ---- Notifications -----------------------------------------------------------
  perform public.notify(v_c, v_user, 'demo_welcome', 'info', 'Welcome to the Small business demo',
    'Neema General Supplies is a small trader with one shop. Everything here is sample data and is deleted after 48 hours. '
      || 'Try turning the school''s request into a quotation or recording a mobile-money payment.',
    '/', 'demo-welcome');
  perform public.notify(v_c, v_user, 'low_stock', 'attention', 'Low stock: Wheelbarrow 65 L heavy duty',
    '2 pcs left · reorder level 4', '/stock/' || p_barrow, 'demo-low-barrow');
  perform public.notify(v_c, v_user, 'low_stock', 'attention', 'Low stock: Engine oil SAE 15W-40 — 5 L',
    '8 can left · reorder level 10', '/stock/' || p_oil, 'demo-low-oil');
  perform public.notify(v_c, v_user, 'rfq_new', 'info', 'New request: Upendo Hill Secondary School',
    'Exam-term stationery · received by WhatsApp · a draft quotation is ready', '/rfqs/' || v_rfq, 'demo-rfq-school');
  perform public.run_company_alerts(v_c);

  return v_c;
end;
$$;

-- ---------------------------------------------------------------------
-- MEDIUM: "Demo Supplies Ltd" — exactly the Stage 10 sample data.
-- ---------------------------------------------------------------------
create or replace function public.demo_seed_medium()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_c uuid;
  v_main uuid;
  v_site uuid;
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

  -- ---- Company ---------------------------------------------------------
  perform set_config('ims.demo_create', 'on', true);
  insert into public.companies (
    name, legal_name, tin, vrn, registration_no, address, phone, email, website, bank_details, document_footer,
    vat_rate, quote_validity_days, quote_min_margin_pct, quote_approval_above, quote_terms,
    po_approval_above, po_terms, invoice_due_days, invoice_terms, is_demo, demo_expires_at, created_by, business_level)
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
    true, now() + interval '48 hours', v_user, 'medium')
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
-- ENTERPRISE: "Demo Industrial Group Ltd" — four stores (Dar es Salaam,
-- Mwanza, Geita, Mbeya), corporate customers in mining, cement, sugar,
-- energy, brewing, health and construction, imports in USD and EUR with
-- landed cost, approvals waiting, a supplier comparison, a year of
-- invoices, deliveries from several stores, a customer close to its
-- credit limit, Suggestion Box entries and growth suggestions.
-- ---------------------------------------------------------------------
create or replace function public.demo_seed_enterprise()
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_usd constant numeric := 2650;
  v_eur constant numeric := 2900;
  v_c uuid;
  -- stores
  v_main uuid; v_mwz uuid; v_gta uuid; v_mby uuid;
  -- products
  p_oil uuid; p_hyd46 uuid; p_gear uuid; p_grease uuid; p_brg uuid; p_vbelt uuid; p_chain uuid; p_splice uuid;
  p_filter uuid; p_seal uuid; p_imp uuid; p_caustic uuid; p_floc uuid; p_hcl uuid; p_carbon uuid; p_lime uuid;
  p_hypo uuid; p_weld uuid; p_gloves uuid; p_helmet uuid; p_boots uuid; p_cable uuid;
  -- suppliers
  s_lube uuid; s_ind uuid; s_ppe uuid; s_chem uuid; s_gulf uuid; s_pump uuid;
  -- clients
  c_kilima uuid; c_nyanza uuid; c_pwani uuid; c_bonde uuid; c_mto uuid; c_ziwa uuid; c_hosp uuid; c_upepo uuid; c_kask uuid;
  -- documents
  v_rfq_b uuid; v_rfq_m uuid; v_rfq_h uuid; v_rfq_k uuid;
  v_srfq uuid; v_ss uuid;
  v_po uuid; v_po_imp uuid; v_po_eur uuid;
  v_bill uuid;
  v_dn uuid;
  v_inv uuid;
  dq1 uuid; dq2 uuid; dq3 uuid; dq4 uuid; v_q uuid;
  v_sug uuid;
  -- the year of sales
  v_clients uuid[];
  v_prods uuid[];
  m integer; k integer; v_n integer; v_idx integer; i1 integer; i2 integer;
  v_client uuid;
  v_cur text;
  v_price numeric;
  v_target numeric;
  v_lines jsonb;
  v_issue date;
  v_age integer;
  v_pay jsonb;
  -- credit and growth figures
  v_owed numeric;
  v_limit numeric;
  v_low integer;
  v_credit_clients integer;
begin
  if v_user is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;

  -- ---- Company ---------------------------------------------------------
  perform set_config('ims.demo_create', 'on', true);
  insert into public.companies (
    name, legal_name, tin, vrn, registration_no, address, phone, email, website, bank_details, document_footer,
    second_currency, vat_rate, quote_validity_days, quote_min_margin_pct, quote_approval_above, quote_terms,
    po_approval_above, po_terms, invoice_due_days, invoice_terms, is_demo, demo_expires_at, created_by, business_level)
  values (
    'Demo Industrial Group Ltd', 'Demo Industrial Group Limited', '100-700-100', '40-000700-D', 'DEMO-070000',
    'Plot 12, Nyerere Road, Industrial Area, Dar es Salaam, Tanzania',
    '+255 700 000 700', 'group.demo@example.com', 'https://example.com',
    'Demo Bank — not real. Demo Industrial Group Ltd · TZS a/c 0000000700 · USD a/c 0000000701 · EUR a/c 0000000702 · SWIFT DEMOTZTZ',
    'Sample document from the LeMoSp demo — not a real company.',
    'USD', 18, 30, 15, 150000000,
    'Prices exclude VAT. Delivery from the nearest of our Dar es Salaam, Mwanza, Geita and Mbeya stores unless agreed otherwise.',
    20000000, 'Quote our PO number on every invoice, delivery note and shipping document. SDS and CoA required for chemicals.',
    30, 'Payment by bank transfer within the agreed terms. Interest may be charged on overdue amounts.',
    true, now() + interval '48 hours', v_user, 'enterprise')
  returning id into v_c;
  perform set_config('ims.demo_create', 'off', true);

  insert into public.memberships (company_id, user_id, role) values (v_c, v_user, 'management');

  -- ---- Stores ------------------------------------------------------------
  select id into v_main from public.warehouses where company_id = v_c and code = 'MAIN';
  update public.warehouses set name = 'Dar es Salaam main warehouse', address = 'Plot 12, Nyerere Road, Dar es Salaam'
   where id = v_main;
  insert into public.warehouses (company_id, code, name, address)
  values (v_c, 'MWZ', 'Mwanza depot', 'Igogo industrial area, Mwanza') returning id into v_mwz;
  insert into public.warehouses (company_id, code, name, address)
  values (v_c, 'GEITA', 'Geita site store', 'Container yard, Nyankumbu, Geita') returning id into v_gta;
  insert into public.warehouses (company_id, code, name, address)
  values (v_c, 'MBY', 'Mbeya depot', 'Iyunga, Tanzam Highway, Mbeya') returning id into v_mby;

  insert into public.exchange_rates (company_id, currency, rate) values (v_c, 'USD', v_usd), (v_c, 'EUR', v_eur);

  -- ---- Suppliers (four local, two foreign) ----------------------------------
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
          'orders@jangwani-industrial.example', '+255 700 000 202', 'Bearings, belts, chains, filters, cables, conveyor spares',
          'Kasi Bearings, Mkanda Belts, Imara Filters, Waya Cables', 'TZS', 'Net 30', 'DAP', 5, '100-201-002', true)
  returning id into s_ind;
  insert into public.suppliers (company_id, code, name, country, city, contact_person, email, phone, products_supplied, brands,
                                currency, payment_terms, incoterms, lead_time_days, tax_no, bank_details_received)
  values (v_c, 'S-0003', 'Mlimani Safety & Welding Ltd', 'Tanzania', 'Arusha', 'Peter Lyimo', 'info@mlimani-safety.example',
          '+255 700 000 204', 'PPE, gloves, helmets, boots, welding consumables', 'Ngao PPE, Moto Weld', 'TZS', 'Net 15', 'DAP', 4,
          '100-201-004', true)
  returning id into s_ppe;
  insert into public.suppliers (company_id, code, name, country, city, contact_person, email, phone, products_supplied, brands,
                                currency, payment_terms, incoterms, lead_time_days, tax_no, bank_details_received, certificates)
  values (v_c, 'S-0004', 'Mkwawa Chemicals Ltd', 'Tanzania', 'Dar es Salaam', 'Zuhura Kombo', 'sales@mkwawa-chem.example',
          '+255 700 000 205', 'Lime, acids, chlorine, water-treatment chemicals (local stock)', 'Safi Chem', 'TZS', 'Net 30',
          'DAP', 5, '100-201-005', true, 'SDS on request (demo)')
  returning id into s_chem;
  insert into public.suppliers (company_id, code, name, country, city, contact_person, email, phone, products_supplied, brands,
                                currency, payment_terms, incoterms, lead_time_days, minimum_order, bank_details_received,
                                certificates, notes)
  values (v_c, 'S-0005', 'Coral Gulf Chemicals FZE', 'United Arab Emirates', 'Jebel Ali', 'Imran Qureshi',
          'export@coralgulf-chem.example', '+971 4 000 0705', 'Activated carbon, acids, caustic soda, flocculants',
          'Safi Chem, Kaboni', 'USD', 'Net 30', 'CIF', 35, '1 x 20 ft container', true, 'SDS and CoA with every batch',
          'Ships CIF Dar es Salaam; we clear through our agent.')
  returning id into s_gulf;
  insert into public.suppliers (company_id, code, name, country, city, contact_person, email, phone, products_supplied, brands,
                                currency, payment_terms, incoterms, lead_time_days, bank_details_received, certificates, notes)
  values (v_c, 'S-0006', 'Elbtal Pumpen GmbH', 'Germany', 'Hamburg', 'Katrin Vogel', 'export@elbtal-pumpen.example',
          '+49 40 0000 0706', 'Slurry pump spares, mechanical seals, impellers', 'Elbtal', 'EUR', '30% advance, balance on shipment',
          'CIP', 45, true, 'ISO 9001, material certificates EN 10204 3.1 (demo)', 'Air freight for urgent seals.')
  returning id into s_pump;

  -- ---- Products and costs (22 items) ------------------------------------------
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, mfr_part_no, specification,
                               unit, pack_size, selling_price, reorder_level, sds_on_file, shelf_life_months, country_of_origin)
  values (v_c, 'LUB-HYD68', 'Hydraulic oil ISO VG 68 — 208 L drum', 'Lubricants and oils', 'Hydraulic oils', 'Nyota Lubes',
          'Nyota Lubes', 'NL-HV68-208', 'ISO VG 68, anti-wear, zinc-free', 'drum', '208 L', 1450000, 20, true, 60, 'Tanzania')
  returning id into p_oil;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, mfr_part_no, specification,
                               unit, pack_size, selling_price, reorder_level, sds_on_file, shelf_life_months, country_of_origin)
  values (v_c, 'LUB-HYD46', 'Hydraulic oil ISO VG 46 — 208 L drum', 'Lubricants and oils', 'Hydraulic oils', 'Nyota Lubes',
          'Nyota Lubes', 'NL-HV46-208', 'ISO VG 46, anti-wear', 'drum', '208 L', 1390000, 15, true, 60, 'Tanzania')
  returning id into p_hyd46;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, mfr_part_no, specification,
                               unit, pack_size, selling_price, reorder_level, sds_on_file, shelf_life_months)
  values (v_c, 'LUB-GEAR320', 'Industrial gear oil ISO VG 320 — 208 L drum', 'Lubricants and oils', 'Gear oils', 'Nyota Lubes',
          'Nyota Lubes', 'NL-GO320-208', 'EP gear oil for mill and kiln drives', 'drum', '208 L', 1620000, 10, true, 60)
  returning id into p_gear;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, mfr_part_no, specification,
                               unit, pack_size, selling_price, reorder_level, sds_on_file, shelf_life_months)
  values (v_c, 'LUB-EP2-18', 'Grease EP2 — 18 kg pail', 'Lubricants and oils', 'Greases', 'Nyota Lubes', 'Nyota Lubes',
          'NL-EP2-18', 'Lithium complex, NLGI 2, extreme pressure', 'pail', '18 kg', 260000, 30, true, 36)
  returning id into p_grease;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, mfr_part_no, specification, unit,
                               selling_price, reorder_level, warranty_months, country_of_origin)
  values (v_c, 'BRG-6312', 'Deep-groove ball bearing 6312', 'Bearings', 'Kasi Bearings', 'Kasi Bearings', '6312-2RS-C3',
          'Bore 60 mm · OD 130 mm · width 31 mm · sealed both sides · C3 clearance', 'pcs', 185000, 40, 12, 'India')
  returning id into p_brg;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, mfr_part_no, specification, unit,
                               selling_price, reorder_level)
  values (v_c, 'MEC-VB-B65', 'V-belt B-65', 'Mechanical spares', 'Mkanda Belts', 'Mkanda Belts', 'B65',
          'Classical wrapped V-belt, section B (17 mm), inside length 65 in', 'pcs', 38000, 60)
  returning id into p_vbelt;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, mfr_part_no, specification, unit,
                               selling_price, reorder_level)
  values (v_c, 'MEC-CHN-80', 'Roller chain ANSI 80 — 3 m', 'Mechanical spares', 'Mkanda Belts', 'Mkanda Belts', '80-1R-3M',
          'Simplex, pitch 25.4 mm, with connecting link', 'length', 420000, 10)
  returning id into p_chain;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, mfr_part_no, specification, unit,
                               selling_price, reorder_level, warranty_months)
  values (v_c, 'MEC-CBSK', 'Conveyor belt splice kit', 'Mechanical spares', 'Mkanda Belts', 'Mkanda Belts', 'MB-SPK-1200',
          'Cold-vulcanising kit for 1,200 mm belts, incl. cement, buffing tools', 'set', 1850000, 4, 6)
  returning id into p_splice;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, mfr_part_no, specification, unit,
                               selling_price, reorder_level)
  values (v_c, 'FIL-DSL-01', 'Diesel fuel filter', 'Filters', 'Imara Filters', 'Imara Filters', 'IF-5052-D',
          'Spin-on, 10 micron, water separator', 'pcs', 72000, 50)
  returning id into p_filter;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, mfr_part_no, specification,
                               unit, selling_price, reorder_level, warranty_months, country_of_origin)
  values (v_c, 'PMP-SEAL-50', 'Cartridge mechanical seal 50 mm', 'Pump spares', 'Seals', 'Elbtal', 'Elbtal Pumpen',
          'EP-CS50-SiC', 'Single cartridge, SiC/SiC faces, for 6/4 slurry pumps', 'pcs', 2950000, 6, 12, 'Germany')
  returning id into p_seal;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, mfr_part_no, specification,
                               unit, selling_price, reorder_level, warranty_months, country_of_origin)
  values (v_c, 'PMP-IMP-150', 'Slurry pump impeller 150 mm, high-chrome', 'Pump spares', 'Impellers', 'Elbtal', 'Elbtal Pumpen',
          'EP-IMP150-HC', '27 % chrome white iron, 5 vanes, for 6/4 slurry pumps', 'pcs', 8400000, 2, 6, 'Germany')
  returning id into p_imp;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, specification, unit,
                               pack_size, selling_price, reorder_level, hazardous, un_number, cas_number, shelf_life_months,
                               sds_on_file, country_of_origin, notes)
  values (v_c, 'CHM-NAOH-25', 'Caustic soda flakes — 25 kg bag', 'Chemicals', 'Alkalis', 'Safi Chem', 'Safi Chem',
          'Sodium hydroxide ≥ 98 %, flakes', 'bag', '25 kg', 95000, 200, true, 'UN1823', '1310-73-2', 24, true,
          'United Arab Emirates', 'Corrosive (class 8). Store dry, away from acids. CoA per batch.')
  returning id into p_caustic;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, specification, unit,
                               pack_size, selling_price, reorder_level, cas_number, shelf_life_months, sds_on_file,
                               country_of_origin, notes)
  values (v_c, 'CHM-FLOC-25', 'Flocculant — 25 kg bag', 'Chemicals', 'Water treatment', 'Safi Chem', 'Safi Chem',
          'Anionic polyacrylamide, high molecular weight, powder', 'bag', '25 kg', 410000, 40, '9003-05-8', 24, true,
          'United Arab Emirates', 'For thickeners and water clarification. CoA per batch.')
  returning id into p_floc;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, specification, unit,
                               pack_size, selling_price, reorder_level, hazardous, un_number, cas_number, shelf_life_months,
                               sds_on_file, country_of_origin, notes)
  values (v_c, 'CHM-HCL-33', 'Hydrochloric acid 33 % — 25 L', 'Chemicals', 'Acids', 'Safi Chem', 'Safi Chem',
          'HCl 32–33 %, technical grade', 'jerrycan', '25 L', 78000, 100, true, 'UN1789', '7647-01-0', 24, true,
          'United Arab Emirates', 'Corrosive (class 8). Ventilated acid store only. CoA per batch.')
  returning id into p_hcl;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, specification, unit,
                               pack_size, selling_price, reorder_level, cas_number, sds_on_file, country_of_origin, notes)
  values (v_c, 'CHM-CARB-500', 'Activated carbon for gold recovery — 500 kg bag', 'Chemicals', 'Mining reagents', 'Kaboni',
          'Kaboni', 'Coconut shell, 6×12 mesh, CTC ≥ 60 %', 'bag', '500 kg', 6900000, 10, '7440-44-0', true,
          'United Arab Emirates', 'For CIL/CIP circuits. Hardness and activity on the CoA.')
  returning id into p_carbon;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, specification, unit,
                               pack_size, selling_price, reorder_level, cas_number, shelf_life_months, sds_on_file, country_of_origin)
  values (v_c, 'CHM-LIME-25', 'Hydrated lime — 25 kg bag', 'Chemicals', 'Alkalis', 'Chokaa Bora', 'Chokaa Bora',
          'Ca(OH)₂ ≥ 90 %, for pH control and juice clarification', 'bag', '25 kg', 21000, 300, '1305-62-0', 12, true,
          'Tanzania')
  returning id into p_lime;
  insert into public.products (company_id, sku, name, category, subcategory, brand, manufacturer, specification, unit,
                               pack_size, selling_price, reorder_level, hazardous, un_number, cas_number, shelf_life_months,
                               sds_on_file, notes)
  values (v_c, 'CHM-HYPO-45', 'Calcium hypochlorite 65 % — 45 kg drum', 'Chemicals', 'Disinfection', 'Safi Chem', 'Safi Chem',
          'Granular, 65–70 % available chlorine', 'drum', '45 kg', 520000, 20, true, 'UN2880', '7778-54-3', 24, true,
          'Oxidiser (class 5.1). Keep away from acids and organics.')
  returning id into p_hypo;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, specification, unit, pack_size,
                               selling_price, reorder_level, shelf_life_months)
  values (v_c, 'WLD-E6013-5', 'Welding electrodes E6013 — 5 kg', 'Consumables', 'Moto Weld', 'Moto Weld',
          'Rutile electrode, 3.2 mm, AWS A5.1 E6013', 'box', '5 kg', 68000, 80, 36)
  returning id into p_weld;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, specification, unit, pack_size,
                               selling_price, reorder_level)
  values (v_c, 'PPE-GLV-NIT', 'Nitrile safety gloves (box of 100)', 'Safety and PPE', 'Ngao PPE', 'Ngao PPE',
          'Disposable nitrile, powder-free, size L', 'box', '100 pcs', 32000, 100)
  returning id into p_gloves;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, specification, unit, selling_price,
                               reorder_level)
  values (v_c, 'PPE-HLM-WHT', 'Safety helmet with ratchet, white', 'Safety and PPE', 'Ngao PPE', 'Ngao PPE',
          'HDPE shell, 6-point harness, EN 397', 'pcs', 28000, 100)
  returning id into p_helmet;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, specification, unit, selling_price,
                               reorder_level)
  values (v_c, 'PPE-BOOT-STL', 'Safety boots, steel toe (pair)', 'Safety and PPE', 'Ngao PPE', 'Ngao PPE',
          'Leather, steel toe cap and midsole, S3, sizes 39–46', 'pair', 95000, 60)
  returning id into p_boots;
  insert into public.products (company_id, sku, name, category, brand, manufacturer, mfr_part_no, specification, unit,
                               pack_size, selling_price, reorder_level, country_of_origin)
  values (v_c, 'ELC-CBL-4C16', 'Armoured cable 4C × 16 mm² — 100 m drum', 'Electrical', 'Waya Cables', 'Waya Cables',
          'WC-SWA-4C16', 'Copper, XLPE/SWA/PVC, 0.6/1 kV', 'drum', '100 m', 4850000, 3, 'Kenya')
  returning id into p_cable;

  insert into public.product_costs (product_id, company_id, main_supplier_id, last_cost) values
    (p_oil,     v_c, s_lube, 1080000), (p_hyd46,  v_c, s_lube, 1035000), (p_gear,   v_c, s_lube, 1210000),
    (p_grease,  v_c, s_lube,  182000), (p_brg,    v_c, s_ind,   118000), (p_vbelt,  v_c, s_ind,    21500),
    (p_chain,   v_c, s_ind,   295000), (p_splice, v_c, s_ind,  1320000), (p_filter, v_c, s_ind,    44000),
    (p_seal,    v_c, s_pump, 2150000), (p_imp,    v_c, s_pump, 6300000), (p_caustic, v_c, s_gulf,   61000),
    (p_floc,    v_c, s_gulf,  291500), (p_hcl,    v_c, s_gulf,   52000), (p_carbon, v_c, s_gulf,  5050000),
    (p_lime,    v_c, s_chem,   13500), (p_hypo,   v_c, s_chem,  365000), (p_weld,   v_c, s_ppe,    41000),
    (p_gloves,  v_c, s_ppe,    18500), (p_helmet, v_c, s_ppe,    16000), (p_boots,  v_c, s_ppe,    62000),
    (p_cable,   v_c, s_ind,  3600000);

  -- ---- Corporate customers ---------------------------------------------------
  insert into public.clients (company_id, code, name, industry, tin, vrn, address, region, delivery_sites, payment_terms,
                              currency, credit_limit, tax_status, vendor_status)
  values
    (v_c, 'C-0001', 'Kilima Gold Mines Ltd', 'Mining', '100-300-001', '40-000101-D', 'P.O. Box 101, Geita', 'Geita',
     'Kilima processing plant, main gate stores, Geita', 'Net 30', 'TZS', 0, 'VAT registered', 'Approved vendor'),
    (v_c, 'C-0002', 'Nyanza Gold Corporation Ltd', 'Mining', '100-300-006', '40-000106-D', 'P.O. Box 606, Mwanza', 'Mwanza',
     'Nyanza mine site stores, Sengerema', 'Net 45', 'USD', 900000000, 'VAT registered', 'Approved vendor'),
    (v_c, 'C-0003', 'Pwani Cement Co. Ltd', 'Cement', '100-300-002', '40-000102-D', 'P.O. Box 202, Tanga', 'Tanga',
     'Pwani Cement works, stores receiving bay, Tanga', 'Net 45', 'TZS', 300000000, 'VAT registered', 'Approved vendor'),
    (v_c, 'C-0004', 'Bonde Sugar Estates Ltd', 'Sugar', '100-300-003', '40-000103-D', 'P.O. Box 303, Kilombero',
     'Morogoro', 'Bonde factory stores, Kilombero', 'Net 30', 'TZS', 250000000, 'VAT registered', 'Approved vendor'),
    (v_c, 'C-0005', 'Mto Energy Ltd', 'Oil & Gas', '100-300-004', '40-000104-D', 'P.O. Box 404, Mtwara', 'Mtwara',
     'Mto Energy gas processing site, Msimbati, Mtwara', 'Net 30', 'TZS', 200000000, 'VAT registered', 'Approved vendor'),
    (v_c, 'C-0006', 'Ziwa Breweries Ltd', 'Brewing', '100-300-005', '40-000105-D', 'P.O. Box 505, Mwanza', 'Mwanza',
     'Ziwa brewery, Igogo, Mwanza', 'Net 30', 'TZS', 180000000, 'VAT registered', 'Approved vendor'),
    (v_c, 'C-0007', 'Milimani Regional Referral Hospital', 'Healthcare (Government)', '100-300-007', null,
     'P.O. Box 707, Mbeya', 'Mbeya', 'Hospital main store, Mbeya', 'Net 60', 'TZS', 0, 'Exempt', 'Registered supplier (tender)'),
    (v_c, 'C-0008', 'Upepo Energy Ltd', 'Power generation', '100-300-008', '40-000108-D', 'P.O. Box 808, Singida', 'Singida',
     'Upepo wind farm substation, Singida', 'Net 30', 'TZS', 400000000, 'VAT registered', 'Approved vendor'),
    (v_c, 'C-0009', 'Kaskazini Construction Group Ltd', 'Construction', '100-300-009', '40-000109-D', 'P.O. Box 909, Arusha',
     'Arusha', 'Site office, Arusha bypass project', 'Net 30', 'TZS', 150000000, 'VAT registered', 'Approved vendor');
  select id into c_kilima from public.clients where company_id = v_c and code = 'C-0001';
  select id into c_nyanza from public.clients where company_id = v_c and code = 'C-0002';
  select id into c_pwani  from public.clients where company_id = v_c and code = 'C-0003';
  select id into c_bonde  from public.clients where company_id = v_c and code = 'C-0004';
  select id into c_mto    from public.clients where company_id = v_c and code = 'C-0005';
  select id into c_ziwa   from public.clients where company_id = v_c and code = 'C-0006';
  select id into c_hosp   from public.clients where company_id = v_c and code = 'C-0007';
  select id into c_upepo  from public.clients where company_id = v_c and code = 'C-0008';
  select id into c_kask   from public.clients where company_id = v_c and code = 'C-0009';

  insert into public.client_contacts (company_id, client_id, kind, name, position, email, phone) values
    (v_c, c_kilima, 'purchasing', 'Neema Mushi',     'Procurement Officer',        'neema.mushi@kilima-gold.example',   '+255 700 000 101'),
    (v_c, c_kilima, 'finance',    'Joseph Kimaro',   'Accounts Payable',           'ap@kilima-gold.example',            '+255 700 000 102'),
    (v_c, c_kilima, 'technical',  'Grace Mollel',    'Plant Maintenance Engineer', 'grace.mollel@kilima-gold.example',  '+255 700 000 103'),
    (v_c, c_nyanza, 'purchasing', 'David Ochieng',   'Supply Chain Manager',       'scm@nyanza-gold.example',           '+255 700 000 161'),
    (v_c, c_pwani,  'purchasing', 'Hamisi Said',     'Stores & Purchasing',        'purchasing@pwani-cement.example',   '+255 700 000 111'),
    (v_c, c_bonde,  'purchasing', 'Daudi Mwakyusa',  'Purchasing Manager',         'daudi@bonde-sugar.example',         '+255 700 000 121'),
    (v_c, c_mto,    'purchasing', 'Fatma Rashid',    'Supply Chain Lead',          'scm@mto-energy.example',            '+255 700 000 131'),
    (v_c, c_ziwa,   'purchasing', 'Agnes Mwita',     'Procurement Officer',        'procurement@ziwa-breweries.example', '+255 700 000 141'),
    (v_c, c_hosp,   'purchasing', 'Dkt. Paulo Mwakalinga', 'Head of Procurement Unit', 'pmu@milimani-hospital.example', '+255 700 000 171'),
    (v_c, c_upepo,  'technical',  'Lucy Njau',       'Substation Engineer',        'lucy.njau@upepo-energy.example',    '+255 700 000 181'),
    (v_c, c_kask,   'purchasing', 'Ibrahim Lema',    'Project Buyer',              'buyer@kaskazini-group.example',     '+255 700 000 191');

  -- ---- Opening stock across the four stores (batches for chemicals) --------------
  perform public.adjust_stock(v_c, p_oil,     v_main, 30,  'HY-2605', v_today + 540, 'Opening stock');
  perform public.adjust_stock(v_c, p_hyd46,   v_main, 20,  'HY-2606', v_today + 560, 'Opening stock');
  perform public.adjust_stock(v_c, p_gear,    v_main, 12,  'GO-2604', v_today + 500, 'Opening stock');
  perform public.adjust_stock(v_c, p_grease,  v_main, 50,  'GR-2604', v_today + 600, 'Opening stock');
  perform public.adjust_stock(v_c, p_brg,     v_main, 30,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_vbelt,   v_main, 120, '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_chain,   v_main, 8,   '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_splice,  v_main, 3,   '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_filter,  v_main, 90,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_imp,     v_main, 1,   '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_caustic, v_main, 60,  'CS-2511', v_today + 45,  'Opening stock');
  perform public.adjust_stock(v_c, p_caustic, v_main, 240, 'CS-2607', v_today + 600, 'Opening stock');
  perform public.adjust_stock(v_c, p_floc,    v_main, 50,  'FL-2606', v_today + 500, 'Opening stock');
  perform public.adjust_stock(v_c, p_hcl,     v_main, 60,  'HC-2605', v_today + 200, 'Opening stock');
  perform public.adjust_stock(v_c, p_lime,    v_main, 400, 'LM-2608', v_today + 300, 'Opening stock');
  perform public.adjust_stock(v_c, p_hypo,    v_main, 20,  'CH-2604', v_today + 300, 'Opening stock');
  perform public.adjust_stock(v_c, p_weld,    v_main, 120, 'WE-2604', v_today + 900, 'Opening stock');
  perform public.adjust_stock(v_c, p_gloves,  v_main, 200, '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_helmet,  v_main, 60,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_boots,   v_main, 30,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_cable,   v_main, 1,   '',        null,          'Opening stock');

  perform public.adjust_stock(v_c, p_oil,     v_mwz, 10,  'HY-2605', v_today + 540, 'Opening stock');
  perform public.adjust_stock(v_c, p_hyd46,   v_mwz, 8,   'HY-2606', v_today + 560, 'Opening stock');
  perform public.adjust_stock(v_c, p_grease,  v_mwz, 20,  'GR-2604', v_today + 600, 'Opening stock');
  perform public.adjust_stock(v_c, p_vbelt,   v_mwz, 40,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_filter,  v_mwz, 30,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_caustic, v_mwz, 150, 'CS-2607', v_today + 600, 'Opening stock');
  perform public.adjust_stock(v_c, p_hcl,     v_mwz, 50,  'HC-2603', v_today + 25,  'Opening stock');
  perform public.adjust_stock(v_c, p_hypo,    v_mwz, 25,  'CH-2604', v_today + 300, 'Opening stock');
  perform public.adjust_stock(v_c, p_lime,    v_mwz, 200, 'LM-2608', v_today + 300, 'Opening stock');
  perform public.adjust_stock(v_c, p_gloves,  v_mwz, 80,  '',        null,          'Opening stock');

  perform public.adjust_stock(v_c, p_grease,  v_gta, 24,  'GR-2604', v_today + 600, 'Opening stock');
  perform public.adjust_stock(v_c, p_gloves,  v_gta, 80,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_helmet,  v_gta, 90,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_boots,   v_gta, 40,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_carbon,  v_gta, 4,   'AC-2603', null,          'Opening stock');
  perform public.adjust_stock(v_c, p_floc,    v_gta, 30,  'FL-2606', v_today + 500, 'Opening stock');
  perform public.adjust_stock(v_c, p_weld,    v_gta, 40,  'WE-2604', v_today + 900, 'Opening stock');
  perform public.adjust_stock(v_c, p_filter,  v_gta, 20,  '',        null,          'Opening stock');

  perform public.adjust_stock(v_c, p_oil,     v_mby, 6,   'HY-2605', v_today + 540, 'Opening stock');
  perform public.adjust_stock(v_c, p_hyd46,   v_mby, 6,   'HY-2606', v_today + 560, 'Opening stock');
  perform public.adjust_stock(v_c, p_filter,  v_mby, 25,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_helmet,  v_mby, 30,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_boots,   v_mby, 20,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_vbelt,   v_mby, 30,  '',        null,          'Opening stock');
  perform public.adjust_stock(v_c, p_lime,    v_mby, 150, 'LM-2608', v_today + 300, 'Opening stock');

  -- ---- Purchasing -----------------------------------------------------------------
  -- 1. Import from the Gulf (USD), received in Dar es Salaam with landed cost.
  v_po_imp := public.create_purchase_order(v_c, s_gulf, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values
    (v_c, v_po_imp, p_carbon, 'Activated carbon for gold recovery — 500 kg bag', 12,  'bag',      1780),
    (v_c, v_po_imp, p_hcl,    'Hydrochloric acid 33 % — 25 L',                   300, 'jerrycan', 17.5);
  update public.purchase_orders
     set order_date = v_today - 70, expected_date = v_today - 32, freight = 2400, delivery_location = 'Dar es Salaam main warehouse',
         shipping_instructions = 'Ship CIF Dar es Salaam port in one 20 ft container. SDS and CoA to accompany the shipment.'
   where id = v_po_imp;
  perform public.submit_purchase_order(v_po_imp);  -- above the limit: the demo user (management) approves it
  perform public.mark_po_sent(v_po_imp);
  perform public.confirm_purchase_order(v_po_imp, 'CGC-SO-8812', v_today - 32);
  insert into public.order_costs (company_id, po_id, kind, description, amount, currency, incurred_on) values
    (v_c, v_po_imp, 'insurance', 'Marine insurance',             180,     'USD', v_today - 66),
    (v_c, v_po_imp, 'duty',      'Import duty and levies',       4200000, 'TZS', v_today - 31),
    (v_c, v_po_imp, 'clearing',  'Clearing & forwarding agent',  1650000, 'TZS', v_today - 31),
    (v_c, v_po_imp, 'port',      'Port charges',                  720000, 'TZS', v_today - 31),
    (v_c, v_po_imp, 'transport', 'Port to main warehouse',        980000, 'TZS', v_today - 30);
  perform public.receive_goods(v_po_imp, v_main, v_today - 30, 'CGC-DN-0419', 'Container received, seals intact',
    (select jsonb_agg(jsonb_build_object('po_line_id', l.id, 'quantity', l.quantity,
                                         'batch_no', case when l.product_id = p_carbon then 'AC-2608' else 'HC-2609' end,
                                         'expiry_date', case when l.product_id = p_hcl then v_today + 700 end))
       from public.po_lines l where l.po_id = v_po_imp));
  perform public.apply_landed_cost(v_po_imp);
  insert into public.supplier_bills (company_id, supplier_id, po_id, supplier_invoice_no, bill_date, due_date, currency,
                                     subtotal, vat_amount, notes)
  values (v_c, s_gulf, v_po_imp, 'CGC-INV-2291', v_today - 33, v_today + 10, 'USD', 29010, 0, 'CIF Dar es Salaam')
  returning id into v_bill;
  perform public.pay_supplier_bill(v_bill, v_today - 28, 14505, 'bank_transfer', 'TT-DEMO-0711', null, '50% on arrival');

  -- 2. Pump spares from Germany (EUR), confirmed and on the way; 30 % paid in advance.
  v_po_eur := public.create_purchase_order(v_c, s_pump, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values
    (v_c, v_po_eur, p_seal, 'Cartridge mechanical seal 50 mm',          12, 'pcs', 760),
    (v_c, v_po_eur, p_imp,  'Slurry pump impeller 150 mm, high-chrome', 4,  'pcs', 2050);
  update public.purchase_orders
     set order_date = v_today - 24, freight = 650, delivery_location = 'Geita site store',
         shipping_instructions = 'Air freight to Dar es Salaam (JNIA). Material certificates 3.1 with the goods.'
   where id = v_po_eur;
  perform public.submit_purchase_order(v_po_eur);
  perform public.mark_po_sent(v_po_eur);
  perform public.confirm_purchase_order(v_po_eur, 'EP-AB-26-0457', v_today + 18);
  insert into public.supplier_bills (company_id, supplier_id, po_id, supplier_invoice_no, bill_date, due_date, currency,
                                     subtotal, vat_amount, notes)
  values (v_c, s_pump, v_po_eur, 'EP-PI-26-0457', v_today - 22, v_today + 18, 'EUR', 17970, 0,
          'Proforma: 30% advance, balance on shipment')
  returning id into v_bill;
  perform public.pay_supplier_bill(v_bill, v_today - 20, 5391, 'bank_transfer', 'TT-DEMO-0733', null, '30% advance');

  -- 3. Cable for the Mwanza depot: two drums arrived, four to come (late).
  v_po := public.create_purchase_order(v_c, s_ind, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price)
  values (v_c, v_po, p_cable, 'Armoured cable 4C × 16 mm² — 100 m drum', 6, 'drum', 3600000);
  update public.purchase_orders set order_date = v_today - 40, delivery_location = 'Mwanza depot' where id = v_po;
  perform public.submit_purchase_order(v_po);
  perform public.mark_po_sent(v_po);
  perform public.confirm_purchase_order(v_po, 'JIS-SO-7740', v_today - 10);
  perform public.receive_goods(v_po, v_mwz, v_today - 12, 'JIS-DN-5512', 'Part delivery: 2 of 6 drums',
    (select jsonb_agg(jsonb_build_object('po_line_id', id, 'quantity', 2)) from public.po_lines where po_id = v_po));

  -- 4. PPE for the Geita site store, received.
  v_po := public.create_purchase_order(v_c, s_ppe, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values
    (v_c, v_po, p_helmet, 'Safety helmet with ratchet, white',  200, 'pcs',  16000),
    (v_c, v_po, p_boots,  'Safety boots, steel toe (pair)',     80,  'pair', 62000),
    (v_c, v_po, p_gloves, 'Nitrile safety gloves (box of 100)', 300, 'box',  18500);
  update public.purchase_orders set order_date = v_today - 45, delivery_location = 'Geita site store' where id = v_po;
  perform public.submit_purchase_order(v_po);
  perform public.mark_po_sent(v_po);
  perform public.confirm_purchase_order(v_po, 'MSW-SO-2210', v_today - 39);
  perform public.receive_goods(v_po, v_gta, v_today - 38, 'MSW-DN-2210', 'Received in good order',
    (select jsonb_agg(jsonb_build_object('po_line_id', id, 'quantity', quantity)) from public.po_lines where po_id = v_po));
  insert into public.supplier_bills (company_id, supplier_id, po_id, supplier_invoice_no, bill_date, due_date, currency,
                                     subtotal, vat_amount, notes)
  values (v_c, s_ppe, v_po, 'MSW-INV-2210', v_today - 37, v_today + 2, 'TZS', 13710000, 2467800, 'PPE for Geita');

  -- 5. Grease confirmed by the supplier, now two days late.
  v_po := public.create_purchase_order(v_c, s_lube, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price)
  values (v_c, v_po, p_grease, 'Grease EP2 — 18 kg pail', 60, 'pail', 182000);
  update public.purchase_orders set order_date = v_today - 14, delivery_location = 'Dar es Salaam main warehouse' where id = v_po;
  perform public.submit_purchase_order(v_po);
  perform public.mark_po_sent(v_po);
  perform public.confirm_purchase_order(v_po, 'BL-SO-3391', v_today - 2);

  -- 6 and 7. Two restock orders waiting for management approval (raised by procurement).
  v_po := public.create_purchase_order(v_c, s_ind, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values
    (v_c, v_po, p_brg,   'Deep-groove ball bearing 6312', 150, 'pcs',    118000),
    (v_c, v_po, p_vbelt, 'V-belt B-65',                   200, 'pcs',     21500),
    (v_c, v_po, p_chain, 'Roller chain ANSI 80 — 3 m',    20,  'length', 295000);
  update public.purchase_orders set order_date = v_today - 1, delivery_location = 'Mwanza depot' where id = v_po;
  perform public.submit_purchase_order(v_po);
  perform set_config('ims.status_change', 'on', true);
  update public.purchase_orders
     set status = 'pending_approval', submitted_by = null, approved_at = null, approved_by = null,
         approval_reason = 'value above the purchase approval limit'
   where id = v_po;
  perform set_config('ims.status_change', 'off', true);

  v_po := public.create_purchase_order(v_c, s_lube, null);
  insert into public.po_lines (company_id, po_id, product_id, description, quantity, unit, unit_price) values
    (v_c, v_po, p_oil,  'Hydraulic oil ISO VG 68 — 208 L drum',        16, 'drum', 1080000),
    (v_c, v_po, p_gear, 'Industrial gear oil ISO VG 320 — 208 L drum', 6,  'drum', 1210000);
  update public.purchase_orders set order_date = v_today, delivery_location = 'Mbeya depot' where id = v_po;
  perform public.submit_purchase_order(v_po);
  perform set_config('ims.status_change', 'on', true);
  update public.purchase_orders
     set status = 'pending_approval', submitted_by = null, approved_at = null, approved_by = null,
         approval_reason = 'value above the purchase approval limit'
   where id = v_po;
  perform set_config('ims.status_change', 'off', true);

  -- Other supplier bills: one late, two paid.
  insert into public.supplier_bills (company_id, supplier_id, supplier_invoice_no, bill_date, due_date, currency, subtotal,
                                     vat_amount, notes)
  values (v_c, s_lube, 'BL/INV/1022', v_today - 50, v_today - 20, 'TZS', 21600000, 3888000, 'Hydraulic oil, 20 drums');
  insert into public.supplier_bills (company_id, supplier_id, supplier_invoice_no, bill_date, due_date, currency, subtotal,
                                     vat_amount, notes)
  values (v_c, s_ind, 'JIS-2318', v_today - 75, v_today - 45, 'TZS', 9400000, 1692000, 'Bearings, belts and filters')
  returning id into v_bill;
  perform public.pay_supplier_bill(v_bill, v_today - 46, 11092000, 'bank_transfer', 'EFT-DEMO-0751', null, null);
  insert into public.supplier_bills (company_id, supplier_id, supplier_invoice_no, bill_date, due_date, currency, subtotal,
                                     vat_amount, notes)
  values (v_c, s_chem, 'MKC-0988', v_today - 35, v_today - 5, 'TZS', 6300000, 1134000, 'Lime and calcium hypochlorite')
  returning id into v_bill;
  perform public.pay_supplier_bill(v_bill, v_today - 6, 7434000, 'bank_transfer', 'EFT-DEMO-0764', null, null);

  -- ---- Client RFQs ------------------------------------------------------------------
  insert into public.rfqs (company_id, client_id, title, contact_name, client_ref, received_via, received_on, due_on, assigned_to)
  values (v_c, c_bonde, 'Boiler water and juice clarification chemicals', 'Daudi Mwakyusa', 'BSE-PR-4410', 'email',
          v_today - 4, v_today + 1, v_user)
  returning id into v_rfq_b;
  insert into public.rfq_lines (company_id, rfq_id, product_id, description, quantity, unit) values
    (v_c, v_rfq_b, p_lime, 'Hydrated lime — 25 kg bag',               400, 'bag'),
    (v_c, v_rfq_b, p_hcl,  'Hydrochloric acid 33 % — 25 L',           120, 'jerrycan'),
    (v_c, v_rfq_b, p_hypo, 'Calcium hypochlorite 65 % — 45 kg drum',  15,  'drum');

  insert into public.rfqs (company_id, client_id, title, contact_name, client_ref, received_via, received_on, due_on, assigned_to,
                           notes)
  values (v_c, c_mto, 'Hydraulic and gear oils for Msimbati compressors', 'Fatma Rashid', 'MTO-PR-1290', 'email',
          v_today, v_today, v_user, 'Delivery to site within 10 days.')
  returning id into v_rfq_m;
  insert into public.rfq_lines (company_id, rfq_id, product_id, description, quantity, unit) values
    (v_c, v_rfq_m, p_oil,  'Hydraulic oil ISO VG 68 — 208 L drum',        8, 'drum'),
    (v_c, v_rfq_m, p_gear, 'Industrial gear oil ISO VG 320 — 208 L drum', 4, 'drum');

  insert into public.rfqs (company_id, client_id, title, contact_name, client_ref, received_via, received_on, due_on, assigned_to,
                           notes)
  values (v_c, c_hosp, 'Quarterly tender: disinfectants and PPE', 'Dkt. Paulo Mwakalinga', 'MRRH/PMU/T/2026/14', 'tender',
          v_today - 3, v_today + 6, v_user, 'Sealed bid; tender security not required. Submit at the PMU office.')
  returning id into v_rfq_h;
  insert into public.rfq_lines (company_id, rfq_id, product_id, description, quantity, unit) values
    (v_c, v_rfq_h, p_hypo,   'Calcium hypochlorite 65 % — 45 kg drum', 24,  'drum'),
    (v_c, v_rfq_h, p_gloves, 'Nitrile safety gloves (box of 100)',     400, 'box'),
    (v_c, v_rfq_h, p_boots,  'Safety boots, steel toe (pair)',         40,  'pair');

  insert into public.rfqs (company_id, client_id, title, contact_name, client_ref, received_via, received_on, due_on, assigned_to)
  values (v_c, c_kilima, 'Mill relining shutdown spares', 'Grace Mollel', 'KGM-RFQ-1031', 'visit',
          v_today - 2, v_today + 3, v_user)
  returning id into v_rfq_k;
  insert into public.rfq_lines (company_id, rfq_id, product_id, description, quantity, unit) values
    (v_c, v_rfq_k, p_chain,  'Roller chain ANSI 80 — 3 m',          6,  'length'),
    (v_c, v_rfq_k, p_splice, 'Conveyor belt splice kit',            2,  'set'),
    (v_c, v_rfq_k, p_weld,   'Welding electrodes E6013 — 5 kg',     40, 'box'),
    (v_c, v_rfq_k, p_seal,   'Cartridge mechanical seal 50 mm',     4,  'pcs');

  -- ---- Supplier quotation request and comparison (for the Bonde Sugar RFQ) --------------
  v_srfq := public.create_supplier_rfq(v_c, v_rfq_b, null);
  update public.supplier_rfqs set due_on = v_today, delivery_location = 'Bonde factory stores, Kilombero',
         created_at = (v_today - 3 + time '10:00') at time zone 'Africa/Dar_es_Salaam'
   where id = v_srfq;
  -- Local stock, fast.
  insert into public.supplier_rfq_suppliers (company_id, srfq_id, supplier_id, status, currency, exchange_rate, lead_time_days,
                                             payment_terms, incoterms, freight, valid_until, supplier_ref, received_on, notes)
  values (v_c, v_srfq, s_chem, 'quoted', 'TZS', 1, 5, 'Net 30', 'DAP', 0, v_today + 14, 'MKC-Q-3310', v_today - 1,
          'Ex-stock Dar es Salaam, delivered Kilombero.')
  returning id into v_ss;
  insert into public.supplier_quote_lines (company_id, srfq_supplier_id, srfq_line_id, unit_price)
  select v_c, v_ss, l.id, case l.product_id when p_lime then 14200 when p_hcl then 49500 when p_hypo then 372000 end
    from public.supplier_rfq_lines l where l.srfq_id = v_srfq;
  -- Imported, cheaper per unit but freight and five weeks.
  insert into public.supplier_rfq_suppliers (company_id, srfq_id, supplier_id, status, currency, exchange_rate, lead_time_days,
                                             payment_terms, incoterms, freight, valid_until, supplier_ref, received_on, notes)
  values (v_c, v_srfq, s_gulf, 'quoted', 'USD', v_usd, 35, 'Net 30', 'CIF', 1850, v_today + 21, 'CGC-Q-0912', v_today,
          'CIF Dar es Salaam; clearing and inland transport not included.')
  returning id into v_ss;
  insert into public.supplier_quote_lines (company_id, srfq_supplier_id, srfq_line_id, unit_price)
  select v_c, v_ss, l.id, case l.product_id when p_lime then 4.60 when p_hcl then 17.50 when p_hypo then 128.00 end
    from public.supplier_rfq_lines l where l.srfq_id = v_srfq;
  -- Declined.
  insert into public.supplier_rfq_suppliers (company_id, srfq_id, supplier_id, status, currency, exchange_rate, received_on, notes)
  values (v_c, v_srfq, s_ind, 'declined', 'TZS', 1, v_today - 2, 'Does not stock chemicals.');

  -- ---- A year of sales: quotations, invoices and payments, growing month by month ------
  v_clients := array[c_kilima, c_nyanza, c_pwani, c_bonde, c_mto, c_ziwa, c_hosp, c_upepo, c_kask];
  v_prods := array[p_oil, p_hyd46, p_gear, p_grease, p_brg, p_vbelt, p_chain, p_splice, p_filter, p_seal, p_imp,
                   p_caustic, p_floc, p_hcl, p_carbon, p_lime, p_hypo, p_weld, p_gloves, p_helmet, p_boots, p_cable];
  for m in 0..11 loop
    v_n := 2 + (m % 2) + case when m >= 8 then 1 else 0 end;
    for k in 1..v_n loop
      v_client := v_clients[1 + ((m * 3 + k * 5) % array_length(v_clients, 1))];
      select currency into v_cur from public.clients where id = v_client;
      i1 := 1 + ((m * 7 + k * 3) % array_length(v_prods, 1));
      i2 := 1 + ((m * 5 + k * 11 + 4) % array_length(v_prods, 1));
      if i2 = i1 then i2 := 1 + (i1 % array_length(v_prods, 1)); end if;
      v_target := 5000000 * (1 + m * 0.12) * (1 + (k - 1) * 0.35);
      v_lines := '[]'::jsonb;
      foreach v_idx in array array[i1, i2] loop
        select selling_price into v_price from public.products where id = v_prods[v_idx];
        v_lines := v_lines || jsonb_build_array(
          jsonb_build_object('p', v_prods[v_idx], 'q', greatest(1, round(v_target / v_price)))
          || case when v_cur = 'USD' then jsonb_build_object('price', round(v_price / v_usd, 2)) else '{}'::jsonb end);
      end loop;
      v_issue := v_today - (11 - m) * 30 - (k - 1) * 7 - 2;
      if (m * 3 + k) % 7 = 0 then
        -- Some quotations are lost.
        perform public.demo_quote(v_c, v_client, null, v_lines, v_issue - 5, 30, 'rejected', '1–2 weeks');
        continue;
      end if;
      v_q := public.demo_quote(v_c, v_client, null, v_lines, v_issue - 5, 30, 'accepted', '1–2 weeks');
      v_age := v_today - v_issue;
      if v_client = c_kilima and v_age < 120 then
        v_pay := null;  -- Kilima pays slowly: its open invoices build up towards the credit limit
      elsif v_age > 100 then
        v_pay := jsonb_build_array(jsonb_build_object('on', v_issue + 22 + (k * 5) % 15, 'pct', 100,
                                                      'ref', 'EFT-' || to_char(v_issue, 'YYMMDD') || '-' || k));
      elsif v_age > 40 then
        v_pay := jsonb_build_array(jsonb_build_object('on', v_issue + 30, 'pct', case when (m + k) % 3 = 0 then 50 else 100 end,
                                                      'ref', 'EFT-' || to_char(v_issue, 'YYMMDD') || '-' || k));
      else
        v_pay := null;
      end if;
      perform public.demo_invoice(v_q, v_issue, v_issue + 30, v_pay);
    end loop;
  end loop;

  -- Kilima's recent big orders, not yet paid (one overdue).
  v_q := public.demo_quote(v_c, c_kilima, null, jsonb_build_array(
           jsonb_build_object('p', p_carbon, 'q', 4), jsonb_build_object('p', p_floc, 'q', 20)),
         v_today - 60, 30, 'accepted', 'Ex-stock Geita');
  perform public.demo_invoice(v_q, v_today - 55, v_today - 25, null);
  v_q := public.demo_quote(v_c, c_kilima, null, jsonb_build_array(
           jsonb_build_object('p', p_grease, 'q', 20), jsonb_build_object('p', p_seal, 'q', 2)),
         v_today - 27, 30, 'accepted', 'Seals on order from Germany');
  perform public.demo_invoice(v_q, v_today - 25, v_today + 5, null);

  -- ---- Recent orders delivered from different stores ---------------------------------
  -- Mbeya: delivered two weeks ago and invoiced from the delivery note.
  dq4 := public.demo_quote(v_c, c_upepo, null, jsonb_build_array(
           jsonb_build_object('p', p_filter, 'q', 10), jsonb_build_object('p', p_helmet, 'q', 10),
           jsonb_build_object('p', p_hyd46, 'q', 2)),
         v_today - 18, 30, 'accepted', 'Ex-stock Mbeya');
  v_dn := public.create_delivery(v_c, null, dq4, v_mby);
  perform public.demo_deliver(v_dn, v_today - 15, 'Lucy Njau (substation engineer)', 'T 702 DMO');
  v_inv := public.create_invoice(v_c, null, null, v_dn);
  update public.invoices set issue_date = v_today - 15, due_date = v_today + 15 where id = v_inv;
  perform public.issue_invoice(v_inv);

  -- Dar es Salaam: delivered last week, invoiced from the delivery note, part paid.
  dq1 := public.demo_quote(v_c, c_pwani, null, jsonb_build_array(
           jsonb_build_object('p', p_vbelt, 'q', 30), jsonb_build_object('p', p_brg, 'q', 10)),
         v_today - 12, 30, 'accepted', 'Ex-stock Dar es Salaam');
  v_dn := public.create_delivery(v_c, null, dq1, v_main);
  perform public.demo_deliver(v_dn, v_today - 6, 'Hamisi Said (stores)', 'T 701 DMO');
  v_inv := public.create_invoice(v_c, null, null, v_dn);
  update public.invoices set issue_date = v_today - 6, due_date = v_today + 39 where id = v_inv;
  perform public.issue_invoice(v_inv);
  perform public.record_payment(v_inv, v_today - 1, round((select total from public.invoices where id = v_inv) / 2, 0),
                                'bank_transfer', 'PCC-EFT-5120', null, 'Part payment');

  -- Geita: on the road today (the demo user is the driver, so "View as Driver" shows it).
  dq2 := public.demo_quote(v_c, c_kilima, null, jsonb_build_array(
           jsonb_build_object('p', p_grease, 'q', 8), jsonb_build_object('p', p_gloves, 'q', 20),
           jsonb_build_object('p', p_helmet, 'q', 30), jsonb_build_object('p', p_boots, 'q', 24)),
         v_today - 5, 30, 'accepted', 'Ex-stock Geita, 1 day');
  insert into public.order_costs (company_id, quotation_id, kind, description, amount, currency, incurred_on)
  values (v_c, dq2, 'transport', 'Site delivery, Geita store → Kilima plant', 350000, 'TZS', v_today);
  perform public.demo_invoice(dq2, v_today - 1, v_today + 29, null);
  v_dn := public.create_delivery(v_c, null, dq2, v_gta);
  update public.deliveries
     set driver_id = v_user, vehicle = 'T 703 DMO', planned_date = v_today, contact_name = 'Grace Mollel',
         contact_phone = '+255 700 000 103', notes = 'Deliver to the plant stores; gate pass needed.'
   where id = v_dn;
  perform public.dispatch_delivery(v_dn);

  -- Mwanza: prepared, leaves in two days.
  dq3 := public.demo_quote(v_c, c_ziwa, null, jsonb_build_array(
           jsonb_build_object('p', p_caustic, 'q', 40), jsonb_build_object('p', p_hypo, 'q', 8)),
         v_today - 3, 30, 'accepted', 'Ex-stock Mwanza');
  v_dn := public.create_delivery(v_c, null, dq3, v_mwz);
  update public.deliveries
     set planned_date = v_today + 2, contact_name = 'Agnes Mwita', contact_phone = '+255 700 000 141',
         notes = 'Chemicals: driver must carry the SDS and spill kit.'
   where id = v_dn;

  -- ---- Open quotations ------------------------------------------------------------------
  -- Large order above the approval limit, waiting for management.
  perform public.demo_quote(v_c, c_upepo, null, jsonb_build_array(jsonb_build_object('p', p_cable, 'q', 30)),
    v_today - 1, 30, 'pending', '3–4 weeks (cable from the factory)');
  perform public.demo_quote(v_c, c_hosp, v_rfq_h, null, v_today - 2, 30, 'sent', 'Ex-stock Mbeya, 1 week');
  perform public.demo_quote(v_c, c_kask, null, jsonb_build_array(
    jsonb_build_object('p', p_cable, 'q', 2), jsonb_build_object('p', p_helmet, 'q', 100),
    jsonb_build_object('p', p_boots, 'q', 60)),
    v_today - 28, 30, 'sent', '1 week');  -- expires in two days
  perform public.demo_quote(v_c, c_bonde, v_rfq_b, null, v_today, 30, 'draft', '5 days');

  -- ---- Credit: Kilima Gold Mines has used about 92 % of its limit -------------------------
  select coalesce(sum(round((total - amount_paid) * exchange_rate, 2)), 0) into v_owed
    from public.invoices where client_id = c_kilima and status in ('issued', 'partly_paid');
  v_limit := case when v_owed > 0 then ceil(v_owed / 0.92 / 1000000) * 1000000 else 50000000 end;
  update public.clients set credit_limit = v_limit where id = c_kilima;

  perform public.demo_fix_times(v_c);

  -- ---- Suggestion Box (the demo user is the only member) ----------------------------------
  v_sug := public.submit_suggestion(v_c, 'procurement', 'Ask three suppliers for every chemical order above TZS 10M',
    'The Bonde Sugar comparison showed the local quote was cheaper once freight was added. Let us always compare.');
  update public.suggestions set created_at = now() - interval '2 days' where id = v_sug;
  v_sug := public.submit_suggestion(v_c, 'inventory', 'Monthly stock count at the Geita site store',
    'Helmets and boots move fast at Geita. A short count every month would catch differences early.');
  perform public.review_suggestion(v_sug, 'under_review', 'Good idea — checking with the store keeper.');
  update public.suggestions set created_at = now() - interval '9 days' where id = v_sug;
  v_sug := public.submit_suggestion(v_c, 'hse', 'Spill kits next to the chemical racks in Mwanza',
    'Acid and hypochlorite are stored together in the Mwanza depot. We need spill kits and a separate acid rack.');
  perform public.review_suggestion(v_sug, 'approved', 'Approved. Buy two spill kits this month.');
  update public.suggestions set created_at = now() - interval '16 days' where id = v_sug;
  v_sug := public.create_improvement(v_c, 'finance', 'Call customers five days before invoices fall due',
    'Finance phones the buyer five days before the due date to confirm the invoice is approved for payment.', null, 'Finance');
  perform public.review_suggestion(v_sug, 'implemented', 'Done since last month — late payments are down.');
  update public.suggestions set created_at = now() - interval '40 days' where id = v_sug;

  -- ---- Growth suggestions (the growth engine never checks demos) ---------------------------
  -- Two features this company has not switched on yet, with the reasons the engine would give.
  insert into public.company_features (company_id, feature_key, enabled, source, changed_by)
  select v_c, f.key, false, 'manual', v_user
    from public.features f where f.key in ('credit_management', 'reorder_levels') and f.status = 'live' and not f.core
  on conflict (company_id, feature_key) do nothing;
  select count(*) into v_credit_clients from public.clients where company_id = v_c and credit_limit > 0;
  perform public.demo_recommend(v_c, 'credit_customers', v_credit_clients,
    'Kilima Gold Mines Ltd has used ' || round(v_owed / v_limit * 100) || '% of its TZS ' || public.fmt_count(v_limit)
      || ' credit limit, and ' || v_credit_clients || ' customers buy on credit. Credit management shows every '
      || 'customer''s limit and headroom before you quote or invoice.');
  select count(*) into v_low
    from (select p.id from public.products p left join public.stock_movements sm on sm.product_id = p.id
           where p.company_id = v_c and p.reorder_level > 0
           group by p.id, p.reorder_level having coalesce(sum(sm.quantity), 0) <= p.reorder_level) x;
  perform public.demo_recommend(v_c, 'products_inventory', v_low,
    v_low || ' products across your four stores are at or below their minimum, including bearings, mechanical seals '
      || 'and splice kits. Reorder levels and low-stock alerts tell stores and purchasing in time.');

  -- ---- Notifications -----------------------------------------------------------------------
  perform public.notify(v_c, v_user, 'demo_welcome', 'info', 'Welcome to the Enterprise demo',
    'Demo Industrial Group runs four stores and imports in USD and EUR. Everything here is sample data and is deleted '
      || 'after 48 hours. Start with the approvals waiting, the supplier comparison or the stock per store.',
    '/', 'demo-welcome');
  -- (The purchase orders and the quotation waiting for approval notify management by themselves.)
  perform public.notify(v_c, v_user, 'srfq_quotes', 'info', 'Supplier quotes received: Bonde Sugar chemicals',
    '2 quotes in, 1 supplier declined · compare and choose', '/supplier-rfqs/' || v_srfq, 'demo-srfq');
  perform public.notify(v_c, v_user, 'credit', 'attention', 'Kilima Gold Mines Ltd is close to its credit limit',
    round(v_owed / v_limit * 100) || '% of TZS ' || public.fmt_count(v_limit) || ' used', '/clients/' || c_kilima,
    'demo-credit-kilima');
  perform public.notify(v_c, v_user, 'low_stock', 'attention', v_low || ' products are below their reorder level',
    'Bearings, roller chain, splice kits, mechanical seals, impellers and cable', '/stock', 'demo-low-stock');
  perform public.run_company_alerts(v_c);

  return v_c;
end;
$$;


-- ---------------------------------------------------------------------
-- Start a demo at a level (no argument = Medium, as before)
-- ---------------------------------------------------------------------
drop function if exists public.create_demo_company();

create or replace function public.create_demo_company(p_level public.business_level default 'medium')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_level public.business_level := coalesce(p_level, 'medium');
  r record;
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

  return case v_level
           when 'small' then public.demo_seed_small()
           when 'enterprise' then public.demo_seed_enterprise()
           else public.demo_seed_medium()
         end;
end;
$$;

-- Replace the caller's demo with a fresh one at another level.
create or replace function public.switch_demo_level(p_level public.business_level)
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  if p_level is null then
    raise exception 'Choose a business level.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.memberships m join public.companies c on c.id = m.company_id
                  where m.user_id = auth.uid() and c.is_demo) then
    raise exception 'You have no demo company. Start a demo first.' using errcode = '22023';
  end if;
  return public.create_demo_company(p_level);
end;
$$;

-- Level of the caller's demo company (null when there is none).
create or replace function public.my_demo_level()
returns public.business_level language sql stable security definer set search_path = ''
as $$
  select c.business_level
    from public.memberships m join public.companies c on c.id = m.company_id
   where m.user_id = auth.uid() and c.is_demo
   order by c.created_at desc
   limit 1;
$$;

-- ---------------------------------------------------------------------
-- Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
revoke execute on function
  public.demo_quote(uuid, uuid, uuid, jsonb, date, integer, text, text),
  public.demo_invoice(uuid, date, date, jsonb),
  public.demo_deliver(uuid, date, text, text),
  public.demo_recommend(uuid, text, numeric, text),
  public.demo_fix_times(uuid),
  public.demo_seed_small(),
  public.demo_seed_medium(),
  public.demo_seed_enterprise(),
  public.create_demo_company(public.business_level),
  public.switch_demo_level(public.business_level),
  public.my_demo_level()
from public, anon, authenticated;
grant execute on function
  public.create_demo_company(public.business_level),
  public.switch_demo_level(public.business_level),
  public.my_demo_level()
to authenticated;

notify pgrst, 'reload schema';
