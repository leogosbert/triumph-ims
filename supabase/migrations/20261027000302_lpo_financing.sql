-- =====================================================================
-- LPO financing: borrow against a client's order (LPO) to pay the
-- suppliers, and repay from the client's payment of the invoice.
--
--   financing_requests  one request per bank and LPO: the order (an
--                       accepted quotation and the client's LPO number,
--                       date and copy from the documents library), the
--                       bank, amount, tenor, interest, what repays it,
--                       and its progress: draft -> submitted -> approved
--                       -> disbursed -> repaid (or declined / cancelled),
--                       with the repayment due date and reminders.
--   financing_pack()    everything the bank-ready pack prints: the LPO,
--                       our quotation, the supplier quotes and the cost
--                       and margin, the client's payment record, our
--                       compliance papers (BRELA, TIN, VAT, tax clearance,
--                       business licence) and a six-month money in / money
--                       out summary. The PDF is built in the app
--                       (/financing/<id>/pack, src/lib/pdf/financingPack.ts).
--
-- Who: management and finance (finance_roles). Reminders go to them:
-- repayment due within the reminder days, overdue (weekly), and a bank
-- that has not answered a submitted request after 14 days.
--
-- Clearing test transactions removes these with the quotations they
-- belong to (on delete cascade). Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Feature
-- ---------------------------------------------------------------------
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('lpo_financing', 'LPO financing',
 'Turn a client''s order (LPO) into a bank-ready financing pack in one PDF: the LPO, your quotation, the supplier quotes with cost and margin, the client''s payment record and statement, your BRELA, TIN, tax clearance and business licence copies, a money in and out summary and a cover letter with the amount, tenor and repayment from the invoice. Track each request with the bank and be reminded before repayment is due.',
 'Finance', 'medium', 'live', 'Suppliers who need cash to buy the goods for a big order before the client pays.',
 'Faster answers from the bank, no missing papers, and no repayment date forgotten.',
 '[{"title": "Start from the order", "body": "Open an accepted quotation (the client''s order) and tap Finance this LPO, or open Finance, then LPO financing, then New request."},
   {"title": "Download the pack", "body": "Enter the bank, amount and tenor, attach the client''s LPO from the documents library and download the pack: one PDF ready to email or print."},
   {"title": "Track the answer", "body": "Mark the request submitted, approved, disbursed and repaid. Management and finance are reminded before the repayment date."}]'::jsonb,
 '/financing', 455)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Table
-- ---------------------------------------------------------------------
create table if not exists public.financing_requests (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  number            text not null default '',
  quotation_id      uuid not null,
  client_id         uuid not null,
  lpo_number        text check (lpo_number is null or char_length(lpo_number) <= 120),
  lpo_date          date,
  lpo_amount        numeric(18, 2) check (lpo_amount is null or lpo_amount >= 0),
  lpo_document_id   uuid,
  currency          text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  bank_name         text not null check (char_length(btrim(bank_name)) between 2 and 120),
  bank_branch       text check (bank_branch is null or char_length(bank_branch) <= 120),
  bank_contact      text check (bank_contact is null or char_length(bank_contact) <= 200),
  facility          text not null default 'lpo_finance' check (facility in ('lpo_finance', 'invoice_discounting', 'overdraft', 'other')),
  amount            numeric(18, 2) not null check (amount > 0),
  tenor_days        integer not null default 90 check (tenor_days between 7 and 365),
  interest_rate     numeric(6, 3) check (interest_rate is null or interest_rate between 0 and 100),
  purpose           text check (purpose is null or char_length(purpose) <= 1000),
  repayment_source  text not null default 'Payment of the invoice by the client' check (char_length(repayment_source) <= 300),
  invoice_id        uuid,
  status            text not null default 'draft'
                    check (status in ('draft', 'submitted', 'approved', 'disbursed', 'repaid', 'declined', 'cancelled')),
  submitted_on      date,
  approved_amount   numeric(18, 2) check (approved_amount is null or approved_amount > 0),
  approved_on       date,
  disbursed_on      date,
  repayment_due     date,
  repaid_on         date,
  bank_reference    text check (bank_reference is null or char_length(bank_reference) <= 120),
  decision_note     text check (decision_note is null or char_length(decision_note) <= 500),
  remind_days       integer not null default 7 check (remind_days between 0 and 60),
  notes             text check (notes is null or char_length(notes) <= 2000),
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id) on delete cascade,
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (lpo_document_id, company_id) references public.documents (id, company_id) on delete set null (lpo_document_id),
  foreign key (invoice_id, company_id) references public.invoices (id, company_id) on delete set null (invoice_id)
);
create index if not exists financing_requests_company_idx on public.financing_requests (company_id, status, repayment_due);
create index if not exists financing_requests_quotation_idx on public.financing_requests (quotation_id);
create index if not exists financing_requests_client_idx on public.financing_requests (client_id);
create index if not exists financing_requests_document_idx on public.financing_requests (lpo_document_id) where lpo_document_id is not null;
create index if not exists financing_requests_invoice_idx on public.financing_requests (invoice_id) where invoice_id is not null;

-- ---------------------------------------------------------------------
-- 3. Rules on the rows
-- ---------------------------------------------------------------------
create or replace function public.prepare_financing_request()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_flag boolean := coalesce(current_setting('ims.status_change', true), '') = 'on';
  v_year text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY');
  q      record;
begin
  new.bank_name := btrim(new.bank_name);
  new.lpo_number := nullif(btrim(new.lpo_number), '');
  if tg_op = 'INSERT' then
    if coalesce(btrim(new.number), '') = '' then
      new.number := public.next_code(new.company_id, 'financing_requests-' || v_year, 'FIN-' || v_year || '-', 4);
    end if;
    if not v_flag then
      new.status := 'draft';
      new.submitted_on := null;
      new.approved_amount := null;
      new.approved_on := null;
      new.disbursed_on := null;
      new.repayment_due := null;
      new.repaid_on := null;
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
  elsif not v_flag then
    if (new.status, new.submitted_on, new.approved_amount, new.approved_on, new.disbursed_on, new.repaid_on, new.number,
        new.quotation_id, new.client_id, new.created_by)
       is distinct from (old.status, old.submitted_on, old.approved_amount, old.approved_on, old.disbursed_on, old.repaid_on,
                         old.number, old.quotation_id, old.client_id, old.created_by) then
      raise exception 'Use the buttons in the app to change the financing request status.' using errcode = '42501';
    end if;
    if old.status in ('repaid', 'declined', 'cancelled')
       and (new.amount, new.tenor_days, new.bank_name, new.lpo_number, new.lpo_amount, new.currency)
           is distinct from (old.amount, old.tenor_days, old.bank_name, old.lpo_number, old.lpo_amount, old.currency) then
      raise exception 'This request is closed. Start a new request to change the amounts.' using errcode = '22023';
    end if;
  end if;
  -- The order must be the company's own; the client follows the order.
  select id, client_id, status into q from public.quotations where id = new.quotation_id and company_id = new.company_id;
  if q.id is null then
    raise exception 'Order not found.' using errcode = '22023';
  end if;
  new.client_id := q.client_id;
  if new.lpo_document_id is not null and (tg_op = 'INSERT' or new.lpo_document_id is distinct from old.lpo_document_id)
     and not exists (select 1 from public.documents d where d.id = new.lpo_document_id and d.company_id = new.company_id
                       and d.archived_at is null and d.file_path is not null) then
    raise exception 'Choose an LPO copy from the documents library that has a file.' using errcode = '22023';
  end if;
  if new.invoice_id is not null and (tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id)
     and not exists (select 1 from public.invoices i where i.id = new.invoice_id and i.company_id = new.company_id
                       and i.client_id = q.client_id) then
    raise exception 'The invoice must be one of this client''s invoices.' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists financing_requests_prepare on public.financing_requests;
create trigger financing_requests_prepare before insert or update on public.financing_requests
  for each row execute function public.prepare_financing_request();

-- ---------------------------------------------------------------------
-- 4. Functions
-- ---------------------------------------------------------------------
-- A new request from an order. p keys: bank_name, bank_branch, bank_contact, facility, amount, tenor_days,
-- interest_rate, purpose, lpo_number, lpo_date, lpo_amount, lpo_document_id, remind_days, notes.
-- Without an amount: the cost of the goods (from the quotation margin) or 70% of the order.
create or replace function public.financing_create(p_quotation uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  q        record;
  v_amount numeric;
  v_id     uuid;
  v_tenor  integer := case when (p ->> 'tenor_days') ~ '^\d{1,3}$' then (p ->> 'tenor_days')::integer else 90 end;
begin
  select qt.id, qt.company_id, qt.client_id, qt.status, qt.total, qt.currency, qt.exchange_rate, qt.client_ref, qt.number,
         m.cost_base
    into q
    from public.quotations qt left join public.quotation_margins m on m.quotation_id = qt.id
   where qt.id = p_quotation;
  if q.id is null or not public.has_role(q.company_id, public.finance_roles()) then
    raise exception 'Order not found.' using errcode = '42501';
  end if;
  if not public.feature_on(q.company_id, 'lpo_financing') then
    raise exception 'Switch on LPO financing first (Settings, then Features).' using errcode = '22023';
  end if;
  if q.status <> 'accepted' then
    raise exception 'Mark the quotation as accepted (the client''s order received) first.' using errcode = '22023';
  end if;
  begin
    v_amount := nullif(btrim(coalesce(p ->> 'amount', '')), '')::numeric;
  exception when others then
    raise exception 'The amount must be a number.' using errcode = '22023';
  end;
  if v_amount is null then
    v_amount := coalesce(nullif(round(q.cost_base / q.exchange_rate, 2), 0), round(q.total * 0.7, 2));
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Enter the amount to borrow.' using errcode = '22023';
  end if;
  insert into public.financing_requests (company_id, quotation_id, client_id, lpo_number, lpo_date, lpo_amount, lpo_document_id,
                                         currency, bank_name, bank_branch, bank_contact, facility, amount, tenor_days,
                                         interest_rate, purpose, remind_days, notes)
  values (q.company_id, q.id, q.client_id,
          coalesce(nullif(left(btrim(coalesce(p ->> 'lpo_number', '')), 120), ''), q.client_ref),
          nullif(p ->> 'lpo_date', '')::date,
          coalesce(nullif(p ->> 'lpo_amount', '')::numeric, q.total),
          nullif(p ->> 'lpo_document_id', '')::uuid,
          q.currency,
          btrim(coalesce(p ->> 'bank_name', '')),
          nullif(left(btrim(coalesce(p ->> 'bank_branch', '')), 120), ''),
          nullif(left(btrim(coalesce(p ->> 'bank_contact', '')), 200), ''),
          coalesce(nullif(p ->> 'facility', ''), 'lpo_finance'),
          v_amount, v_tenor,
          nullif(p ->> 'interest_rate', '')::numeric,
          coalesce(nullif(left(btrim(coalesce(p ->> 'purpose', '')), 1000), ''),
                   'To pay our suppliers for the goods on order ' || q.number || coalesce(' (client LPO ' || q.client_ref || ')', '') || '.'),
          case when (p ->> 'remind_days') ~ '^\d{1,2}$' then (p ->> 'remind_days')::integer else 7 end,
          nullif(left(btrim(coalesce(p ->> 'notes', '')), 2000), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Status changes. p keys: on (date), approved_amount, bank_reference, note, invoice_id.
--   submitted  (from draft)                 submitted_on = on or today
--   approved   (from submitted)             approved_amount (default the amount), approved_on
--   disbursed  (from approved)              disbursed_on; repayment_due = disbursed_on + tenor
--   repaid     (from disbursed)             repaid_on
--   declined   (from submitted, approved)   note = the bank's reason
--   cancelled  (from draft, submitted, approved)
--   draft      (from declined, cancelled: try again)
create or replace function public.financing_set_status(p_id uuid, p_status text, p jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  f       public.financing_requests;
  v_on    date;
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_amt   numeric;
  v_ok    boolean;
begin
  select * into f from public.financing_requests where id = p_id for update;
  if f.id is null or not public.has_role(f.company_id, public.finance_roles()) then
    raise exception 'Financing request not found.' using errcode = '42501';
  end if;
  v_ok := case p_status
            when 'submitted' then f.status = 'draft'
            when 'approved' then f.status = 'submitted'
            when 'disbursed' then f.status = 'approved'
            when 'repaid' then f.status = 'disbursed'
            when 'declined' then f.status in ('submitted', 'approved')
            when 'cancelled' then f.status in ('draft', 'submitted', 'approved')
            when 'draft' then f.status in ('declined', 'cancelled')
            else null end;
  if v_ok is null then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  if not v_ok then
    raise exception 'A % request cannot be marked %.', f.status, p_status using errcode = '22023';
  end if;
  begin
    v_on := coalesce(nullif(p ->> 'on', '')::date, v_today);
    v_amt := nullif(btrim(coalesce(p ->> 'approved_amount', '')), '')::numeric;
  exception when others then
    raise exception 'Check the date and the amount.' using errcode = '22023';
  end;
  if v_on > v_today + 1 then
    raise exception 'The date cannot be in the future.' using errcode = '22023';
  end if;
  if p_status = 'approved' and v_amt is not null and v_amt <= 0 then
    raise exception 'The approved amount must be more than zero.' using errcode = '22023';
  end if;
  if p_status = 'declined' and nullif(btrim(coalesce(p ->> 'note', '')), '') is null then
    raise exception 'Write the bank''s reason.' using errcode = '22023';
  end if;
  if (p ->> 'invoice_id') is not null and not exists (select 1 from public.invoices i where i.id = (p ->> 'invoice_id')::uuid
                                                       and i.company_id = f.company_id and i.client_id = f.client_id) then
    raise exception 'The invoice must be one of this client''s invoices.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.financing_requests
     set status = p_status,
         submitted_on = case when p_status = 'submitted' then v_on when p_status = 'draft' then null else submitted_on end,
         approved_amount = case when p_status = 'approved' then coalesce(v_amt, f.amount) when p_status = 'draft' then null else approved_amount end,
         approved_on = case when p_status = 'approved' then v_on when p_status = 'draft' then null else approved_on end,
         disbursed_on = case when p_status = 'disbursed' then v_on when p_status = 'draft' then null else disbursed_on end,
         repayment_due = case when p_status = 'disbursed' then v_on + f.tenor_days when p_status = 'draft' then null else repayment_due end,
         repaid_on = case when p_status = 'repaid' then v_on else repaid_on end,
         bank_reference = coalesce(nullif(left(btrim(coalesce(p ->> 'bank_reference', '')), 120), ''), bank_reference),
         decision_note = case when p_status in ('declined', 'cancelled', 'approved') then
                                coalesce(nullif(left(btrim(coalesce(p ->> 'note', '')), 500), ''), decision_note)
                              when p_status = 'draft' then null else decision_note end,
         invoice_id = coalesce(nullif(p ->> 'invoice_id', '')::uuid, invoice_id)
   where id = f.id;
  perform set_config('ims.status_change', '', true);
end;
$$;

-- Money in and out by month (base currency), the last cash count and the book balances, for the pack.
create or replace function public.financing_cash_internal(p_company uuid, p_months integer)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with m as (
    select (date_trunc('month', (now() at time zone 'Africa/Dar_es_Salaam')::date) - make_interval(months => g))::date as month
      from generate_series(0, least(greatest(coalesce(p_months, 6), 1), 24) - 1) g
  )
  select jsonb_build_object(
    'months', coalesce((select jsonb_agg(jsonb_build_object(
        'month', m.month,
        'money_in', coalesce((select round(sum(p.amount * p.exchange_rate), 2) from public.payments p
                               where p.company_id = p_company and p.voided_at is null
                                 and p.received_on >= m.month and p.received_on < (m.month + interval '1 month')::date), 0),
        'paid_suppliers', coalesce((select round(sum(sp.amount * sp.exchange_rate), 2) from public.supplier_payments sp
                                     where sp.company_id = p_company and sp.voided_at is null
                                       and sp.paid_on >= m.month and sp.paid_on < (m.month + interval '1 month')::date), 0),
        'expenses', coalesce((select round(sum(e.amount * e.exchange_rate), 2) from public.expenses e
                               where e.company_id = p_company and e.voided_at is null
                                 and e.spent_on >= m.month and e.spent_on < (m.month + interval '1 month')::date), 0))
        order by m.month) from m), '[]'::jsonb),
    'cash_count', (select jsonb_build_object('as_of', c.as_of, 'amount', c.amount, 'note', c.note)
                     from public.cash_positions c where c.company_id = p_company order by c.as_of desc, c.created_at desc limit 1),
    'book_balances', coalesce((select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'balance', b.bal) order by a.code)
                                 from public.gl_accounts a
                                 join (select l.account_id, round(sum(l.debit - l.credit), 2) as bal from public.gl_lines l
                                        where l.company_id = p_company group by l.account_id) b on b.account_id = a.id
                                where a.company_id = p_company and a.system_key in ('cash', 'bank', 'mobile_money')), '[]'::jsonb),
    'receivables', coalesce((select round(sum((i.total - i.amount_paid) * i.exchange_rate), 2) from public.invoices i
                              where i.company_id = p_company and i.status in ('issued', 'partly_paid')), 0),
    'payables', coalesce((select round(sum((b.total - b.amount_paid) * b.exchange_rate), 2) from public.supplier_bills b
                           where b.company_id = p_company and b.status in ('open', 'partly_paid')), 0));
$$;

-- How the client has paid us (last 24 months, base currency).
create or replace function public.financing_client_record_internal(p_company uuid, p_client uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  with inv as (
    select i.id, i.issue_date, i.due_date, i.total * i.exchange_rate as total_base, (i.total - i.amount_paid) * i.exchange_rate as open_base,
           i.status,
           (select max(p.received_on) from public.payments p where p.invoice_id = i.id and p.voided_at is null) as last_paid
      from public.invoices i
     where i.company_id = p_company and i.client_id = p_client and i.status in ('issued', 'partly_paid', 'paid')
       and i.issue_date >= (now() at time zone 'Africa/Dar_es_Salaam')::date - 730
  )
  select jsonb_build_object(
    'client_since', (select min(i.issue_date) from public.invoices i where i.company_id = p_company and i.client_id = p_client
                       and i.status in ('issued', 'partly_paid', 'paid')),
    'invoices', (select count(*) from inv),
    'invoiced', coalesce((select round(sum(total_base), 2) from inv), 0),
    'paid_invoices', (select count(*) from inv where status = 'paid'),
    'on_time', (select count(*) from inv where status = 'paid' and last_paid <= coalesce(due_date, issue_date + 30)),
    'avg_days_to_pay', (select round(avg(last_paid - issue_date)) from inv where status = 'paid' and last_paid is not null),
    'open', coalesce((select round(sum(open_base), 2) from inv where status in ('issued', 'partly_paid')), 0),
    'overdue', coalesce((select round(sum(open_base), 2) from inv where status in ('issued', 'partly_paid')
                           and coalesce(due_date, issue_date + 30) < (now() at time zone 'Africa/Dar_es_Salaam')::date), 0),
    'orders_won', (select count(*) from public.quotations q where q.company_id = p_company and q.client_id = p_client and q.status = 'accepted'));
$$;

-- Everything the pack prints, for management and finance.
create or replace function public.financing_pack(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  f       public.financing_requests;
  v_q     public.quotations;
  v_codes text[] := array['BRELA_INCORPORATION', 'BRELA_MEMART', 'TRA_TIN', 'TRA_VAT_REGISTRATION', 'TRA_TAX_CLEARANCE', 'BUSINESS_LICENCE'];
begin
  select * into f from public.financing_requests where id = p_id;
  if f.id is null or not public.has_role(f.company_id, public.finance_roles()) then
    raise exception 'Financing request not found.' using errcode = '42501';
  end if;
  select * into v_q from public.quotations where id = f.quotation_id;
  return jsonb_build_object(
    'request', to_jsonb(f),
    'quotation', jsonb_build_object('id', v_q.id, 'number', v_q.number, 'revision', v_q.revision, 'status', v_q.status,
                                    'issue_date', v_q.issue_date, 'currency', v_q.currency, 'exchange_rate', v_q.exchange_rate,
                                    'subtotal', v_q.subtotal, 'vat_amount', v_q.vat_amount, 'total', v_q.total,
                                    'client_ref', v_q.client_ref, 'payment_terms', v_q.payment_terms, 'delivery_time', v_q.delivery_time,
                                    'decided_at', v_q.decided_at),
    'margin', (select jsonb_build_object('revenue_base', m.revenue_base, 'cost_base', m.cost_base, 'margin_pct', m.margin_pct,
                                         'lines_without_cost', m.lines_without_cost)
                 from public.quotation_margins m where m.quotation_id = v_q.id),
    'extra_costs', coalesce((select round(sum(oc.amount * oc.exchange_rate), 2) from public.order_costs oc where oc.quotation_id = v_q.id), 0),
    'client', (select jsonb_build_object('id', c.id, 'name', c.name, 'tin', c.tin, 'vrn', c.vrn, 'address', c.address,
                                         'industry', c.industry, 'payment_terms', c.payment_terms)
                 from public.clients c where c.id = f.client_id),
    'client_record', public.financing_client_record_internal(f.company_id, f.client_id),
    'supplier_quotes', coalesce((select jsonb_agg(x order by x ->> 'number', x ->> 'supplier') from (
        select jsonb_build_object(
                 'number', r.number, 'supplier', s.name, 'status', rs.status, 'currency', rs.currency,
                 'exchange_rate', rs.exchange_rate, 'lead_time_days', rs.lead_time_days, 'valid_until', rs.valid_until,
                 'supplier_ref', rs.supplier_ref, 'awarded', r.awarded_supplier_id = rs.supplier_id,
                 'total', round(coalesce((select sum(ql.unit_price * l.quantity) from public.supplier_quote_lines ql
                                           join public.supplier_rfq_lines l on l.id = ql.srfq_line_id
                                          where ql.srfq_supplier_id = rs.id and ql.unit_price is not null), 0) + rs.freight, 2),
                 'lines_priced', (select count(*) from public.supplier_quote_lines ql where ql.srfq_supplier_id = rs.id and ql.unit_price is not null),
                 'lines', (select count(*) from public.supplier_rfq_lines l where l.srfq_id = r.id)) x
          from public.supplier_rfqs r
          join public.supplier_rfq_suppliers rs on rs.srfq_id = r.id
          join public.suppliers s on s.id = rs.supplier_id
         where r.company_id = f.company_id and r.status <> 'cancelled' and rs.status = 'quoted'
           and (r.quotation_id = v_q.id or (v_q.rfq_id is not null and r.rfq_id = v_q.rfq_id))) y), '[]'::jsonb),
    'purchase_orders', coalesce((select jsonb_agg(jsonb_build_object('number', po.number, 'supplier', s.name, 'status', po.status,
                                                                     'currency', po.currency, 'total', po.total,
                                                                     'total_base', round(po.total * po.exchange_rate, 2)) order by po.number)
                                   from public.purchase_orders po join public.suppliers s on s.id = po.supplier_id
                                  where po.quotation_id = v_q.id and po.status <> 'cancelled'), '[]'::jsonb),
    'lpo_document', (select jsonb_build_object('id', d.id, 'title', d.title, 'file_path', d.file_path, 'file_name', d.file_name,
                                               'file_type', d.file_type)
                       from public.documents d where d.id = f.lpo_document_id),
    'compliance', coalesce((select jsonb_agg(jsonb_build_object(
          'code', k.code, 'name', k.name, 'status', i.status,
          'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'file_path', d.file_path,
                                                                     'file_name', d.file_name, 'file_type', d.file_type,
                                                                     'reference', d.reference, 'expires_on', d.expires_on) order by d.created_at desc)
                                   from public.compliance_documents cd join public.documents d on d.id = cd.document_id
                                  where cd.item_id = i.id and d.archived_at is null and d.file_path is not null), '[]'::jsonb))
          order by array_position(v_codes, k.code))
        from public.compliance_catalogue k
        left join public.compliance_items i on i.company_id = f.company_id and i.code = k.code
       where k.code = any (v_codes)), '[]'::jsonb),
    'licences', coalesce((select jsonb_agg(jsonb_build_object('name', l.name, 'authority', l.authority, 'licence_no', l.licence_no,
                                                              'expires_on', l.expires_on,
          'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'file_path', d.file_path,
                                                                     'file_name', d.file_name, 'file_type', d.file_type))
                                   from public.compliance_documents cd join public.documents d on d.id = cd.document_id
                                  where cd.licence_id = l.id and d.archived_at is null and d.file_path is not null), '[]'::jsonb))
          order by l.name)
        from public.licences l
       where l.company_id = f.company_id and l.status = 'active'
         and (l.expires_on is null or l.expires_on >= (now() at time zone 'Africa/Dar_es_Salaam')::date)), '[]'::jsonb),
    -- Company papers in the library not linked to the checklist (used when the checklist has no copy).
    'library', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'kind', d.kind, 'file_path', d.file_path,
                                                             'file_name', d.file_name, 'file_type', d.file_type, 'expires_on', d.expires_on)
                                          order by d.kind, d.title)
        from public.documents d
       where d.company_id = f.company_id and d.archived_at is null and d.file_path is not null
         and d.kind in ('company', 'tax', 'licence') and d.client_id is null and d.supplier_id is null and d.product_id is null
         and (d.expires_on is null or d.expires_on >= (now() at time zone 'Africa/Dar_es_Salaam')::date)), '[]'::jsonb),
    'cash', public.financing_cash_internal(f.company_id, 6));
end;
$$;

-- Reminders: repayment due soon or overdue (weekly), and a bank that has not answered in 14 days.
create or replace function public.financing_alerts_internal(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_today  date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  r        record;
  v_before bigint;
  v_after  bigint;
begin
  if not public.feature_on(p_company, 'lpo_financing') then
    return 0;
  end if;
  select count(*) into v_before from public.notifications where company_id = p_company;
  for r in select f.id, f.number, f.bank_name, f.repayment_due, coalesce(f.approved_amount, f.amount) as amt, f.currency, f.remind_days
             from public.financing_requests f
            where f.company_id = p_company and f.status = 'disbursed' and f.repayment_due is not null
              and f.repayment_due <= v_today + f.remind_days loop
    perform public.notify_roles(p_company, public.finance_roles(), null, 'financing_repayment',
      case when r.repayment_due <= v_today then 'critical' else 'attention' end,
      case when r.repayment_due < v_today then 'Loan repayment overdue: ' when r.repayment_due = v_today then 'Loan repayment due today: '
           else 'Loan repayment due: ' end || r.bank_name,
      r.number || ' · ' || r.currency || ' ' || to_char(r.amt, 'FM999,999,999,990') || ' · due ' || to_char(r.repayment_due, 'DD Mon YYYY'),
      '/financing/' || r.id,
      'fin-' || r.id || '-' || r.repayment_due || '-' ||
        case when r.repayment_due < v_today then 'late-' || ((v_today - r.repayment_due) / 7)::text
             when r.repayment_due = v_today then 'today' else 'soon' end);
  end loop;
  for r in select f.id, f.number, f.bank_name, f.submitted_on from public.financing_requests f
            where f.company_id = p_company and f.status = 'submitted' and f.submitted_on <= v_today - 14 loop
    perform public.notify_roles(p_company, public.finance_roles(), null, 'financing_waiting', 'info',
      'No answer from ' || r.bank_name || ' yet', r.number || ' · submitted ' || to_char(r.submitted_on, 'DD Mon YYYY') || ' · call the bank',
      '/financing/' || r.id, 'fin-wait-' || r.id || '-' || ((v_today - r.submitted_on) / 14)::text);
  end loop;
  select count(*) into v_after from public.notifications where company_id = p_company;
  return v_after - v_before;
end;
$$;

-- On opening the financing list (management and finance).
create or replace function public.financing_run_alerts(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  return public.financing_alerts_internal(p_company);
end;
$$;

-- The scheduled job (service role): every company.
create or replace function public.financing_run_all_alerts()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  c       record;
  v_total integer := 0;
begin
  for c in select distinct company_id from public.financing_requests where status in ('submitted', 'disbursed') loop
    begin
      v_total := v_total + public.financing_alerts_internal(c.company_id);
    exception when others then
      raise warning 'Financing reminders failed for %: %', c.company_id, sqlerrm;
    end;
  end loop;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Triggers, row-level security and grants
-- ---------------------------------------------------------------------
drop trigger if exists financing_requests_touch on public.financing_requests;
create trigger financing_requests_touch before update on public.financing_requests for each row execute function public.touch_updated_at();
drop trigger if exists financing_requests_keep on public.financing_requests;
create trigger financing_requests_keep before update on public.financing_requests for each row execute function public.keep_company();
drop trigger if exists financing_requests_audit on public.financing_requests;
create trigger financing_requests_audit after insert or update or delete on public.financing_requests
  for each row execute function public.audit_row();

alter table public.financing_requests enable row level security;
revoke all on public.financing_requests from public, anon, authenticated;
grant select on public.financing_requests to authenticated;
grant all on public.financing_requests to service_role;
drop policy if exists financing_requests_select on public.financing_requests;
create policy financing_requests_select on public.financing_requests for select to authenticated
  using (public.has_role(company_id, public.finance_roles()));
drop policy if exists financing_requests_update on public.financing_requests;
create policy financing_requests_update on public.financing_requests for update to authenticated
  using (public.has_role(company_id, public.finance_roles())) with check (public.has_role(company_id, public.finance_roles()));
drop policy if exists financing_requests_delete on public.financing_requests;
create policy financing_requests_delete on public.financing_requests for delete to authenticated
  using (public.is_manager(company_id) and status in ('draft', 'cancelled'));
grant update (lpo_number, lpo_date, lpo_amount, lpo_document_id, bank_name, bank_branch, bank_contact, facility, amount, tenor_days,
              interest_rate, purpose, repayment_source, invoice_id, repayment_due, bank_reference, remind_days, notes)
  on public.financing_requests to authenticated;
grant delete on public.financing_requests to authenticated;

revoke execute on function
  public.prepare_financing_request(), public.financing_create(uuid, jsonb), public.financing_set_status(uuid, text, jsonb),
  public.financing_cash_internal(uuid, integer), public.financing_client_record_internal(uuid, uuid), public.financing_pack(uuid),
  public.financing_alerts_internal(uuid), public.financing_run_alerts(uuid), public.financing_run_all_alerts()
from public, anon, authenticated;
grant execute on function
  public.financing_create(uuid, jsonb), public.financing_set_status(uuid, text, jsonb), public.financing_pack(uuid),
  public.financing_run_alerts(uuid)
to authenticated;
grant execute on function public.financing_run_all_alerts() to service_role;

notify pgrst, 'reload schema';
