-- =====================================================================
-- General ledger: chart of accounts, double-entry journals, closing the
-- books, fixed assets with depreciation, and the reports an accountant
-- or TRA asks for (trial balance, profit & loss, balance sheet, VAT).
--
-- The books keep themselves. Every issued invoice, payment received,
-- supplier bill, supplier payment and expense is posted automatically:
--
--   Invoice issued     Dr Clients (receivable)      Cr Sales goods / Sales services, Cr VAT output
--                      Dr Cost of sales              Cr Stock          (goods lines with a cost)
--   Payment received   Dr Bank / Cash / Mobile money / Withholding tax  Cr Clients
--   Supplier bill      Dr Stock (bill on a purchase order) or Other purchases, Dr VAT input   Cr Suppliers
--   Supplier payment   Dr Suppliers                  Cr Bank / Cash / Mobile money
--   Expense            Dr the expense category's account, Dr VAT input   Cr Bank / Cash / Mobile money
--
-- Amounts are in the company's base currency at each document's rate;
-- a payment at a different rate than its invoice or bill posts the
-- difference to Exchange gains and losses.
--
-- When a document changes or is cancelled or voided, its entry is
-- reversed and posted again: nothing is ever edited or deleted, so the
-- history always adds up. Closed periods are never touched: corrections
-- are dated on the first open day.
--
-- Payroll (the next file) posts its journals here too.
--
-- Management and finance see and run the books. Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Features
-- ---------------------------------------------------------------------
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('ledger', 'Accounts: ledger & financial statements',
 'Double-entry books that keep themselves: every invoice, payment, bill, expense and payroll is posted to a chart of accounts. Trial balance, profit & loss, balance sheet, VAT return, journals and closing of months.',
 'Finance', 'medium', 'live', 'Companies with an accountant, a bank loan, or audited accounts for TRA.',
 'Your accountant gets a trial balance and statements straight from LeMoSp, with every figure traced to the invoice, bill or payment behind it.',
 '[{"title": "Nothing to post by hand", "body": "Invoices, payments, supplier bills, expenses and payroll are posted for you. Open Accounts to see the trial balance, profit & loss and balance sheet for any dates."},
   {"title": "Opening balances", "body": "When you start, enter what the bank, cash, loans and capital were on the first day as an opening journal. Unpaid invoices and bills entered in LeMoSp are already in the books."},
   {"title": "Journals and closing", "body": "Your accountant records adjustments as journals. At month end, management closes the month so nobody changes it again."}]'::jsonb,
 '/accounts', 760),
('fixed_assets', 'Fixed assets & depreciation',
 'A register of vehicles, machines, computers and furniture with cost, life and location; depreciation is posted every month in one tap and sales of assets show the gain or loss.',
 'Finance', 'medium', 'live', 'Companies with vehicles, equipment or machinery.',
 'Correct depreciation in the accounts and a register ready for the auditor and the insurer.',
 '[{"title": "Add an asset", "body": "Open Accounts → Fixed assets and press Add asset: what it is, when it was bought, the cost, how it was paid and how many years it lasts."},
   {"title": "Depreciation", "body": "Each month press Post depreciation. The amount is spread evenly over the asset''s life."}]'::jsonb,
 '/accounts/assets', 765)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Chart of accounts
-- ---------------------------------------------------------------------
alter table public.companies add column if not exists books_closed_until date;

create table if not exists public.gl_accounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  code        text not null check (code ~ '^[0-9]{3,6}$'),
  name        text not null check (char_length(btrim(name)) between 2 and 120),
  type        text not null check (type in ('asset', 'liability', 'equity', 'income', 'expense')),
  system_key  text,
  active      boolean not null default true,
  notes       text check (notes is null or char_length(notes) <= 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, code)
);
create unique index if not exists gl_accounts_system_key on public.gl_accounts (company_id, system_key) where system_key is not null;

alter table public.expense_categories add column if not exists gl_account_id uuid;
alter table public.expense_categories drop constraint if exists expense_categories_gl_account_fk;
alter table public.expense_categories add constraint expense_categories_gl_account_fk
  foreign key (gl_account_id, company_id) references public.gl_accounts (id, company_id);

-- The standard chart for a Tanzanian small or medium business.
create or replace function public.gl_default_accounts()
returns table (code text, name text, type text, system_key text)
language sql immutable set search_path = ''
as $$
  values
    ('1000', 'Cash on hand', 'asset', 'cash'),
    ('1010', 'Bank', 'asset', 'bank'),
    ('1020', 'Mobile money', 'asset', 'mobile_money'),
    ('1100', 'Clients (accounts receivable)', 'asset', 'receivable'),
    ('1150', 'Withholding tax deducted by clients', 'asset', 'wht_receivable'),
    ('1200', 'Stock', 'asset', 'inventory'),
    ('1300', 'VAT input (on purchases)', 'asset', 'vat_input'),
    ('1400', 'Prepayments and deposits', 'asset', 'prepayments'),
    ('1500', 'Fixed assets at cost', 'asset', 'fixed_assets'),
    ('1590', 'Accumulated depreciation', 'asset', 'accum_depreciation'),
    ('2000', 'Suppliers (accounts payable)', 'liability', 'payable'),
    ('2100', 'VAT output (on sales)', 'liability', 'vat_output'),
    ('2200', 'PAYE payable', 'liability', 'paye_payable'),
    ('2210', 'NSSF payable', 'liability', 'nssf_payable'),
    ('2220', 'SDL payable', 'liability', 'sdl_payable'),
    ('2230', 'WCF payable', 'liability', 'wcf_payable'),
    ('2240', 'Salaries payable', 'liability', 'salaries_payable'),
    ('2250', 'Other payroll deductions payable', 'liability', 'deductions_payable'),
    ('2300', 'Loans', 'liability', 'loans'),
    ('3000', 'Owner''s capital', 'equity', 'capital'),
    ('3100', 'Retained earnings', 'equity', 'retained_earnings'),
    ('3200', 'Opening balances', 'equity', 'opening_balance'),
    ('4000', 'Sales: goods', 'income', 'sales_goods'),
    ('4010', 'Sales: services', 'income', 'sales_services'),
    ('4900', 'Other income', 'income', 'other_income'),
    ('4920', 'Gain or loss on sale of assets', 'income', 'disposal_gain_loss'),
    ('4950', 'Exchange gains and losses', 'income', 'fx_gain_loss'),
    ('5000', 'Cost of sales', 'expense', 'cost_of_sales'),
    ('5100', 'Other purchases (bills without an order)', 'expense', 'other_purchases'),
    ('6000', 'Salaries and wages', 'expense', 'salaries'),
    ('6010', 'Employer NSSF', 'expense', 'employer_nssf'),
    ('6020', 'Skills and development levy (SDL)', 'expense', 'sdl_expense'),
    ('6030', 'Workers compensation (WCF)', 'expense', 'wcf_expense'),
    ('6100', 'General expenses', 'expense', 'general_expense'),
    ('6800', 'Bank charges', 'expense', 'bank_charges'),
    ('6900', 'Depreciation', 'expense', 'depreciation');
$$;

-- An account with a system key (created when missing, with the next free code nearby).
create or replace function public.gl_acct(p_company uuid, p_key text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id   uuid;
  d      record;
  v_code integer;
begin
  select id into v_id from public.gl_accounts where company_id = p_company and system_key = p_key;
  if v_id is not null then
    return v_id;
  end if;
  select * into d from public.gl_default_accounts() a where a.system_key = p_key;
  if d.code is null then
    raise exception 'Unknown account %.', p_key;
  end if;
  v_code := d.code::int;
  while exists (select 1 from public.gl_accounts where company_id = p_company and code = v_code::text) loop
    v_code := v_code + 1;
  end loop;
  insert into public.gl_accounts (company_id, code, name, type, system_key)
  values (p_company, v_code::text, d.name, d.type, p_key)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.gl_accounts where company_id = p_company and system_key = p_key;
  end if;
  return v_id;
end;
$$;

create or replace function public.gl_ensure_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  k text;
begin
  for k in select system_key from public.gl_default_accounts() loop
    perform public.gl_acct(p_company, k);
  end loop;
end;
$$;

-- The account of an expense category (each category gets its own 61xx account).
create or replace function public.gl_category_account(p_category uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  c      public.expense_categories;
  v_id   uuid;
  v_code integer;
begin
  select * into c from public.expense_categories where id = p_category;
  if c.id is null then
    return null;
  end if;
  if c.gl_account_id is not null then
    return c.gl_account_id;
  end if;
  select coalesce(max(code::int), 6100) + 1 into v_code from public.gl_accounts
   where company_id = c.company_id and code ~ '^61[0-9]{2}$';
  while exists (select 1 from public.gl_accounts where company_id = c.company_id and code = v_code::text) loop
    v_code := v_code + 1;
  end loop;
  if v_code > 6799 then
    return public.gl_acct(c.company_id, 'general_expense');
  end if;
  insert into public.gl_accounts (company_id, code, name, type)
  values (c.company_id, v_code::text, left(c.name, 120), 'expense')
  returning id into v_id;
  update public.expense_categories set gl_account_id = v_id where id = p_category;
  return v_id;
end;
$$;

-- Accounts are added and renamed by management and finance; system accounts stay.
create or replace function public.guard_gl_account()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'UPDATE' then
    if new.type is distinct from old.type and exists (select 1 from public.gl_lines l where l.account_id = old.id) then
      raise exception 'This account has entries; its type cannot change.' using errcode = '22023';
    end if;
    if old.system_key is not null and (not new.active or new.system_key is distinct from old.system_key) then
      raise exception 'LeMoSp posts to this account; it cannot be switched off.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists gl_accounts_guard on public.gl_accounts;
create trigger gl_accounts_guard before update on public.gl_accounts for each row execute function public.guard_gl_account();

-- ---------------------------------------------------------------------
-- 3. Journals
-- ---------------------------------------------------------------------
create table if not exists public.gl_journals (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  number       text not null,
  entry_date   date not null,
  doc_date     date,
  memo         text check (memo is null or char_length(memo) <= 500),
  source       text not null check (source in ('manual', 'opening', 'invoices', 'payments', 'supplier_bills', 'supplier_payments',
                                               'expenses', 'payroll', 'payroll_payment', 'fixed_asset', 'depreciation', 'asset_disposal')),
  source_id    uuid,
  source_ref   text,
  reverses     uuid references public.gl_journals (id) on delete set null,
  reversed_by  uuid references public.gl_journals (id) on delete set null,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, number)
);
create index if not exists gl_journals_company_idx on public.gl_journals (company_id, entry_date desc);
create index if not exists gl_journals_source_idx on public.gl_journals (source, source_id) where source_id is not null;

create table if not exists public.gl_lines (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  journal_id   uuid not null,
  account_id   uuid not null,
  debit        numeric(18, 2) not null default 0 check (debit >= 0),
  credit       numeric(18, 2) not null default 0 check (credit >= 0),
  description  text check (description is null or char_length(description) <= 300),
  client_id    uuid,
  supplier_id  uuid,
  employee_id  uuid,
  foreign key (journal_id, company_id) references public.gl_journals (id, company_id) on delete cascade,
  foreign key (account_id, company_id) references public.gl_accounts (id, company_id),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);
create index if not exists gl_lines_journal_idx on public.gl_lines (journal_id);
create index if not exists gl_lines_account_idx on public.gl_lines (account_id);

-- When the posting of a document fails, the document is still saved and the problem is kept here.
create table if not exists public.gl_sync_issues (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  source      text not null,
  source_id   uuid not null,
  error       text not null,
  created_at  timestamptz not null default now(),
  unique (source, source_id)
);

-- The first day that can still be posted to.
create or replace function public.gl_open_date(p_company uuid, p_date date)
returns date language sql stable security definer set search_path = ''
as $$
  select greatest(p_date, coalesce((select books_closed_until + 1 from public.companies where id = p_company), p_date));
$$;

-- Post one balanced journal (internal). Lines: [{"a": account, "d": debit, "c": credit, "t": text, "cl": client, "su": supplier, "em": employee}]
create or replace function public.gl_post(p_company uuid, p_date date, p_doc_date date, p_memo text, p_source text, p_source_id uuid,
                                          p_ref text, p_reverses uuid, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id     uuid;
  v_dr     numeric;
  v_cr     numeric;
  v_closed date;
  l        jsonb;
begin
  select books_closed_until into v_closed from public.companies where id = p_company;
  if p_date is null or (v_closed is not null and p_date <= v_closed) then
    raise exception 'The books are closed up to %. Choose a later date.', to_char(v_closed, 'DD Mon YYYY') using errcode = '22023';
  end if;
  select coalesce(sum(round(coalesce((x ->> 'd')::numeric, 0), 2)), 0), coalesce(sum(round(coalesce((x ->> 'c')::numeric, 0), 2)), 0)
    into v_dr, v_cr from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x;
  if v_dr <> v_cr then
    raise exception 'The journal does not balance: debits % and credits %.', v_dr, v_cr using errcode = '22023';
  end if;
  if v_dr = 0 then
    raise exception 'The journal has no amounts.' using errcode = '22023';
  end if;
  insert into public.gl_journals (company_id, number, entry_date, doc_date, memo, source, source_id, source_ref, reverses)
  values (p_company, public.next_code(p_company, 'gl_journals', 'JV-', 5), p_date, coalesce(p_doc_date, p_date),
          left(p_memo, 500), p_source, p_source_id, left(p_ref, 60), p_reverses)
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    if round(coalesce((l ->> 'd')::numeric, 0), 2) <> 0 or round(coalesce((l ->> 'c')::numeric, 0), 2) <> 0 then
      if round(coalesce((l ->> 'd')::numeric, 0), 2) < 0 or round(coalesce((l ->> 'c')::numeric, 0), 2) < 0
         or (round(coalesce((l ->> 'd')::numeric, 0), 2) > 0 and round(coalesce((l ->> 'c')::numeric, 0), 2) > 0) then
        raise exception 'Each line is either a debit or a credit, above zero.' using errcode = '22023';
      end if;
      insert into public.gl_lines (company_id, journal_id, account_id, debit, credit, description, client_id, supplier_id, employee_id)
      values (p_company, v_id, (l ->> 'a')::uuid, round(coalesce((l ->> 'd')::numeric, 0), 2), round(coalesce((l ->> 'c')::numeric, 0), 2),
              left(l ->> 't', 300), (l ->> 'cl')::uuid, (l ->> 'su')::uuid, (l ->> 'em')::uuid);
    end if;
  end loop;
  return v_id;
end;
$$;

-- Reverse a journal on the first open day (internal).
create or replace function public.gl_reverse(p_journal uuid, p_memo text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  j     public.gl_journals;
  v_id  uuid;
  v_ln  jsonb;
begin
  select * into j from public.gl_journals where id = p_journal for update;
  if j.id is null or j.reversed_by is not null or j.reverses is not null then
    return null;
  end if;
  select jsonb_agg(jsonb_build_object('a', account_id, 'd', credit, 'c', debit, 't', description,
                                      'cl', client_id, 'su', supplier_id, 'em', employee_id))
    into v_ln from public.gl_lines where journal_id = p_journal;
  v_id := public.gl_post(j.company_id, public.gl_open_date(j.company_id, (now() at time zone 'Africa/Dar_es_Salaam')::date),
                         null, coalesce(p_memo, 'Reversal of ' || j.number), j.source, j.source_id, j.source_ref, j.id, v_ln);
  update public.gl_journals set reversed_by = v_id where id = p_journal;
  return v_id;
end;
$$;

-- The account money moves through for a payment method.
create or replace function public.gl_money_account(p_company uuid, p_method text)
returns uuid language sql security definer set search_path = ''
as $$
  select public.gl_acct(p_company, case p_method
    when 'cash' then 'cash' when 'mobile_money' then 'mobile_money' when 'withholding_tax' then 'wht_receivable' else 'bank' end);
$$;

-- What a document should have in the books right now (internal):
-- {"company", "date", "memo", "ref", "lines": [...]}; empty lines when it posts nothing.
create or replace function public.gl_desired(p_source text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_ln      jsonb := '[]'::jsonb;
  i         public.invoices;
  p         public.payments;
  b         public.supplier_bills;
  sp        public.supplier_payments;
  e         public.expenses;
  v_type    text;
  v_total   numeric;
  v_vat     numeric;
  v_net     numeric;
  v_lines   numeric;
  v_serv    numeric;
  v_s       numeric;
  v_cogs    numeric;
  v_rate    numeric;
  v_bank    numeric;
  v_ctrl    numeric;
  v_ref     text;
begin
  if p_source = 'invoices' then
    select * into i from public.invoices where id = p_id;
    if i.id is null then return null; end if;
    if i.status in ('issued', 'partly_paid', 'paid') then
      select business_type into v_type from public.companies where id = i.company_id;
      v_total := round(i.total * i.exchange_rate, 2);
      v_vat := round(i.vat_amount * i.exchange_rate, 2);
      v_net := v_total - v_vat;
      select coalesce(sum(l.line_total), 0),
             coalesce(sum(l.line_total) filter (where coalesce(pr.item_type, case when v_type = 'services' then 'service' else 'goods' end) <> 'goods'), 0),
             coalesce(sum(round(l.quantity * c.unit_cost, 2)) filter (where coalesce(pr.item_type, 'goods') = 'goods' and l.product_id is not null), 0)
        into v_lines, v_serv, v_cogs
        from public.invoice_lines l
        left join public.products pr on pr.id = l.product_id
        left join public.invoice_costs c on c.invoice_line_id = l.id
       where l.invoice_id = p_id;
      v_s := case when v_lines > 0 then round(v_net * v_serv / v_lines, 2) else 0 end;
      v_ln := jsonb_build_array(
        jsonb_build_object('a', public.gl_acct(i.company_id, 'receivable'), 'd', v_total, 'cl', i.client_id, 't', 'Invoice ' || i.number),
        jsonb_build_object('a', public.gl_acct(i.company_id, 'sales_goods'), 'c', v_net - v_s, 'cl', i.client_id),
        jsonb_build_object('a', public.gl_acct(i.company_id, 'sales_services'), 'c', v_s, 'cl', i.client_id),
        jsonb_build_object('a', public.gl_acct(i.company_id, 'vat_output'), 'c', v_vat, 'cl', i.client_id));
      if v_cogs > 0 then
        v_ln := v_ln || jsonb_build_array(
          jsonb_build_object('a', public.gl_acct(i.company_id, 'cost_of_sales'), 'd', v_cogs, 't', 'Cost of goods sold'),
          jsonb_build_object('a', public.gl_acct(i.company_id, 'inventory'), 'c', v_cogs, 't', 'Cost of goods sold'));
      end if;
    end if;
    return jsonb_build_object('company', i.company_id, 'date', coalesce(i.issue_date, (i.issued_at at time zone 'Africa/Dar_es_Salaam')::date),
                              'memo', 'Invoice ' || i.number, 'ref', i.number, 'lines', v_ln);

  elsif p_source = 'payments' then
    select * into p from public.payments where id = p_id;
    if p.id is null then return null; end if;
    if p.voided_at is null then
      select exchange_rate into v_rate from public.invoices where id = p.invoice_id;
      v_bank := round(p.amount * p.exchange_rate, 2);
      v_ctrl := round(p.amount * coalesce(v_rate, p.exchange_rate), 2);
      v_ln := jsonb_build_array(
        jsonb_build_object('a', public.gl_money_account(p.company_id, p.method), 'd', v_bank, 'cl', p.client_id, 't', 'Payment ' || p.number),
        jsonb_build_object('a', public.gl_acct(p.company_id, 'receivable'), 'c', v_ctrl, 'cl', p.client_id));
      if v_bank <> v_ctrl then
        v_ln := v_ln || jsonb_build_array(jsonb_build_object('a', public.gl_acct(p.company_id, 'fx_gain_loss'),
          'd', greatest(v_ctrl - v_bank, 0), 'c', greatest(v_bank - v_ctrl, 0), 't', 'Exchange difference'));
      end if;
    end if;
    return jsonb_build_object('company', p.company_id, 'date', p.received_on, 'memo', 'Payment received ' || p.number, 'ref', p.number, 'lines', v_ln);

  elsif p_source = 'supplier_bills' then
    select * into b from public.supplier_bills where id = p_id;
    if b.id is null then return null; end if;
    if b.status <> 'cancelled' then
      v_total := round(b.total * b.exchange_rate, 2);
      v_vat := round(b.vat_amount * b.exchange_rate, 2);
      v_ref := coalesce(nullif(b.supplier_invoice_no, ''), b.number);
      v_ln := jsonb_build_array(
        jsonb_build_object('a', public.gl_acct(b.company_id, case when b.po_id is not null then 'inventory' else 'other_purchases' end),
                           'd', v_total - v_vat, 'su', b.supplier_id, 't', 'Bill ' || v_ref),
        jsonb_build_object('a', public.gl_acct(b.company_id, 'vat_input'), 'd', v_vat, 'su', b.supplier_id),
        jsonb_build_object('a', public.gl_acct(b.company_id, 'payable'), 'c', v_total, 'su', b.supplier_id));
    end if;
    return jsonb_build_object('company', b.company_id, 'date', b.bill_date, 'memo', 'Supplier bill ' || b.number, 'ref', b.number, 'lines', v_ln);

  elsif p_source = 'supplier_payments' then
    select * into sp from public.supplier_payments where id = p_id;
    if sp.id is null then return null; end if;
    if sp.voided_at is null then
      select exchange_rate into v_rate from public.supplier_bills where id = sp.bill_id;
      v_bank := round(sp.amount * sp.exchange_rate, 2);
      v_ctrl := round(sp.amount * coalesce(v_rate, sp.exchange_rate), 2);
      v_ln := jsonb_build_array(
        jsonb_build_object('a', public.gl_acct(sp.company_id, 'payable'), 'd', v_ctrl, 'su', sp.supplier_id, 't', 'Payment ' || sp.number),
        jsonb_build_object('a', public.gl_money_account(sp.company_id, sp.method), 'c', v_bank, 'su', sp.supplier_id));
      if v_bank <> v_ctrl then
        v_ln := v_ln || jsonb_build_array(jsonb_build_object('a', public.gl_acct(sp.company_id, 'fx_gain_loss'),
          'd', greatest(v_bank - v_ctrl, 0), 'c', greatest(v_ctrl - v_bank, 0), 't', 'Exchange difference'));
      end if;
    end if;
    return jsonb_build_object('company', sp.company_id, 'date', sp.paid_on, 'memo', 'Supplier payment ' || sp.number, 'ref', sp.number, 'lines', v_ln);

  elsif p_source = 'expenses' then
    select * into e from public.expenses where id = p_id;
    if e.id is null then return null; end if;
    if e.voided_at is null then
      v_total := round(e.amount * e.exchange_rate, 2);
      v_vat := round(e.vat_amount * e.exchange_rate, 2);
      v_ln := jsonb_build_array(
        jsonb_build_object('a', coalesce(public.gl_category_account(e.category_id), public.gl_acct(e.company_id, 'general_expense')),
                           'd', v_total - v_vat, 't', left(e.description, 300)),
        jsonb_build_object('a', public.gl_acct(e.company_id, 'vat_input'), 'd', v_vat),
        jsonb_build_object('a', public.gl_money_account(e.company_id, e.method), 'c', v_total, 't', e.payee));
    end if;
    return jsonb_build_object('company', e.company_id, 'date', e.spent_on, 'memo', 'Expense ' || e.number, 'ref', e.number, 'lines', v_ln);
  end if;
  return null;
end;
$$;

-- Lines reduced to what matters for comparing two postings: net per account and party, sorted.
create or replace function public.gl_shape(p_lines jsonb)
returns jsonb language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_array(a, cl, su, em, n) order by a, cl, su, em), '[]'::jsonb)
    from (select x ->> 'a' a, coalesce(x ->> 'cl', '') cl, coalesce(x ->> 'su', '') su, coalesce(x ->> 'em', '') em,
                 sum(round(coalesce((x ->> 'd')::numeric, 0), 2) - round(coalesce((x ->> 'c')::numeric, 0), 2)) n
            from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
           group by 1, 2, 3, 4) s
   where n <> 0;
$$;

-- Bring a document's entry in the books up to date (internal; idempotent).
create or replace function public.gl_sync(p_source text, p_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  d         jsonb := public.gl_desired(p_source, p_id);
  j         public.gl_journals;
  v_company uuid;
  v_have    jsonb := '[]'::jsonb;
  v_want    jsonb;
  v_date    date;
  v_reuse   text;
  v_new     uuid;
begin
  select * into j from public.gl_journals
   where source = p_source and source_id = p_id and reverses is null and reversed_by is null
   order by created_at desc limit 1;
  v_company := coalesce((d ->> 'company')::uuid, j.company_id);
  if v_company is null then
    return false;
  end if;
  v_want := public.gl_shape(d -> 'lines');
  v_date := (d ->> 'date')::date;
  if j.id is not null then
    select public.gl_shape(jsonb_agg(jsonb_build_object('a', account_id, 'd', debit, 'c', credit,
                                                        'cl', client_id, 'su', supplier_id, 'em', employee_id)))
      into v_have from public.gl_lines where journal_id = j.id;
  end if;
  if v_have = v_want and (j.id is null or j.doc_date is not distinct from v_date) then
    return false;
  end if;
  if j.id is not null and j.created_at = now() then
    -- Posted earlier in this same transaction (e.g. the costs of an invoice being issued): nobody has
    -- seen it yet, so it is replaced rather than reversed, and the new entry keeps its number.
    v_reuse := j.number;
    delete from public.gl_journals where id = j.id;
  elsif j.id is not null then
    perform public.gl_reverse(j.id, 'Reversal of ' || j.number || ' (' || coalesce(d ->> 'memo', 'document removed') || ' changed)');
  end if;
  if v_want <> '[]'::jsonb then
    v_new := public.gl_post(v_company, public.gl_open_date(v_company, coalesce(v_date, (now() at time zone 'Africa/Dar_es_Salaam')::date)),
                            v_date, d ->> 'memo', p_source, p_id, d ->> 'ref', null, d -> 'lines');
    if v_reuse is not null then
      update public.gl_journals set number = v_reuse where id = v_new;
    end if;
  end if;
  delete from public.gl_sync_issues where source = p_source and source_id = p_id;
  return true;
end;
$$;

-- Trigger on the documents: post, and never stop the document being saved.
create or replace function public.gl_on_document()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_source text := tg_table_name;
  v_id     uuid;
  v_co     uuid;
begin
  if tg_table_name = 'invoice_costs' then
    v_source := 'invoices';
    v_id := coalesce(new.invoice_id, old.invoice_id);
  elsif tg_table_name = 'invoice_lines' then
    v_source := 'invoices';
    v_id := coalesce(new.invoice_id, old.invoice_id);
  else
    v_id := coalesce(new.id, old.id);
  end if;
  v_co := coalesce(new.company_id, old.company_id);
  begin
    perform public.gl_sync(v_source, v_id);
  exception when others then
    insert into public.gl_sync_issues (company_id, source, source_id, error)
    values (v_co, v_source, v_id, left(sqlerrm, 500))
    on conflict (source, source_id) do update set error = excluded.error, created_at = now();
  end;
  return null;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['invoices', 'payments', 'supplier_bills', 'supplier_payments', 'expenses'] loop
    execute format('drop trigger if exists %I_gl on public.%I', t, t);
    execute format('create trigger %I_gl after insert or update on public.%I for each row execute function public.gl_on_document()', t, t);
  end loop;
end $$;
drop trigger if exists invoice_costs_gl on public.invoice_costs;
create trigger invoice_costs_gl after insert or update or delete on public.invoice_costs
  for each row execute function public.gl_on_document();

-- ---------------------------------------------------------------------
-- 4. Fixed assets
-- ---------------------------------------------------------------------
create table if not exists public.fixed_assets (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  number            text not null default '',
  name              text not null check (char_length(btrim(name)) between 2 and 120),
  category          text not null default 'equipment'
                    check (category in ('land_buildings', 'vehicles', 'machinery', 'equipment', 'computers', 'furniture', 'other')),
  serial_no         text check (serial_no is null or char_length(serial_no) <= 80),
  location          text check (location is null or char_length(location) <= 120),
  vehicle_id        uuid,
  bought_on         date not null,
  cost              numeric(18, 2) not null check (cost > 0),
  residual_value    numeric(18, 2) not null default 0 check (residual_value >= 0),
  life_months       integer not null check (life_months between 1 and 1200),
  paid_from         text not null default 'bank' check (paid_from in ('bank', 'cash', 'mobile_money', 'payable', 'bill', 'opening')),
  accumulated_dep   numeric(18, 2) not null default 0,
  status            text not null default 'active' check (status in ('active', 'disposed')),
  disposed_on       date,
  disposal_amount   numeric(18, 2),
  notes             text check (notes is null or char_length(notes) <= 1000),
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, company_id),
  foreign key (vehicle_id, company_id) references public.vehicles (id, company_id),
  check (residual_value < cost)
);
create index if not exists fixed_assets_company_idx on public.fixed_assets (company_id, status);

create table if not exists public.fixed_asset_depreciation (
  asset_id    uuid not null,
  company_id  uuid not null references public.companies (id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  amount      numeric(18, 2) not null check (amount > 0),
  journal_id  uuid,
  primary key (asset_id, month),
  foreign key (asset_id, company_id) references public.fixed_assets (id, company_id) on delete cascade,
  foreign key (journal_id, company_id) references public.gl_journals (id, company_id) on delete set null (journal_id)
);

-- Add an asset: posts its cost against how it was paid.
create or replace function public.add_fixed_asset(p_company uuid, p_name text, p_category text, p_bought_on date, p_cost numeric,
                                                  p_residual numeric, p_life_months integer, p_paid_from text, p_serial text,
                                                  p_location text, p_vehicle uuid, p_notes text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id  uuid;
  v_no  text;
  v_cr  uuid;
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management or finance can add assets.' using errcode = '42501';
  end if;
  v_no := public.next_code(p_company, 'fixed_assets', 'FA-', 4);
  insert into public.fixed_assets (company_id, number, name, category, serial_no, location, vehicle_id, bought_on, cost,
                                   residual_value, life_months, paid_from, notes)
  values (p_company, v_no, btrim(p_name), coalesce(p_category, 'equipment'), nullif(btrim(coalesce(p_serial, '')), ''),
          nullif(btrim(coalesce(p_location, '')), ''), p_vehicle, p_bought_on, p_cost, coalesce(p_residual, 0), p_life_months,
          coalesce(p_paid_from, 'bank'), nullif(btrim(coalesce(p_notes, '')), ''))
  returning id into v_id;
  v_cr := public.gl_acct(p_company, case coalesce(p_paid_from, 'bank')
            when 'cash' then 'cash' when 'mobile_money' then 'mobile_money' when 'payable' then 'payable'
            when 'bill' then 'other_purchases' when 'opening' then 'opening_balance' else 'bank' end);
  perform public.gl_post(p_company, public.gl_open_date(p_company, p_bought_on), p_bought_on, 'Asset bought: ' || v_no || ' ' || btrim(p_name),
    'fixed_asset', v_id, v_no, null,
    jsonb_build_array(jsonb_build_object('a', public.gl_acct(p_company, 'fixed_assets'), 'd', p_cost, 't', btrim(p_name)),
                      jsonb_build_object('a', v_cr, 'c', p_cost, 't', btrim(p_name))));
  return v_id;
end;
$$;

-- Straight-line depreciation for one month, for every active asset (finance; once per month).
create or replace function public.post_depreciation(p_company uuid, p_month date)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  a       record;
  v_amt   numeric;
  v_total numeric := 0;
  v_count integer := 0;
  v_jid   uuid;
  v_list  jsonb := '[]'::jsonb;
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management or finance can post depreciation.' using errcode = '42501';
  end if;
  if v_end > (now() at time zone 'Africa/Dar_es_Salaam')::date + 31 then
    raise exception 'That month has not come yet.' using errcode = '22023';
  end if;
  for a in
    select f.* from public.fixed_assets f
     where f.company_id = p_company and f.status = 'active' and f.bought_on <= v_end
       and not exists (select 1 from public.fixed_asset_depreciation d where d.asset_id = f.id and d.month = v_month)
     for update
  loop
    v_amt := least(round((a.cost - a.residual_value) / a.life_months, 2), a.cost - a.residual_value - a.accumulated_dep);
    if v_amt > 0 then
      v_list := v_list || jsonb_build_array(jsonb_build_object('id', a.id, 'amount', v_amt));
      v_total := v_total + v_amt;
      v_count := v_count + 1;
    end if;
  end loop;
  if v_count = 0 then
    return jsonb_build_object('assets', 0, 'amount', 0);
  end if;
  v_jid := public.gl_post(p_company, public.gl_open_date(p_company, v_end), v_end,
    'Depreciation ' || to_char(v_month, 'Mon YYYY'), 'depreciation', null, to_char(v_month, 'YYYY-MM'), null,
    jsonb_build_array(jsonb_build_object('a', public.gl_acct(p_company, 'depreciation'), 'd', v_total),
                      jsonb_build_object('a', public.gl_acct(p_company, 'accum_depreciation'), 'c', v_total)));
  insert into public.fixed_asset_depreciation (asset_id, company_id, month, amount, journal_id)
  select (x ->> 'id')::uuid, p_company, v_month, (x ->> 'amount')::numeric, v_jid from jsonb_array_elements(v_list) x;
  perform set_config('ims.status_change', 'on', true);
  update public.fixed_assets f set accumulated_dep = f.accumulated_dep + (x ->> 'amount')::numeric
    from jsonb_array_elements(v_list) x where f.id = (x ->> 'id')::uuid;
  perform set_config('ims.status_change', '', true);
  return jsonb_build_object('assets', v_count, 'amount', v_total, 'journal', v_jid);
end;
$$;

-- Sell or scrap an asset: removes it from the books and shows the gain or loss.
create or replace function public.dispose_fixed_asset(p_asset uuid, p_on date, p_amount numeric, p_method text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a      public.fixed_assets;
  v_book numeric;
  v_amt  numeric := coalesce(p_amount, 0);
  v_ln   jsonb;
begin
  select * into a from public.fixed_assets where id = p_asset for update;
  if a.id is null or not public.has_role(a.company_id, public.finance_roles()) then
    raise exception 'Only management or finance can do this.' using errcode = '42501';
  end if;
  if a.status <> 'active' then
    raise exception 'This asset is already disposed of.' using errcode = '22023';
  end if;
  if v_amt < 0 then
    raise exception 'The amount cannot be negative.' using errcode = '22023';
  end if;
  v_book := a.cost - a.accumulated_dep;
  v_ln := jsonb_build_array(
    jsonb_build_object('a', public.gl_acct(a.company_id, 'accum_depreciation'), 'd', a.accumulated_dep),
    jsonb_build_object('a', public.gl_acct(a.company_id, 'fixed_assets'), 'c', a.cost, 't', a.name),
    jsonb_build_object('a', public.gl_money_account(a.company_id, coalesce(p_method, 'bank')), 'd', v_amt),
    jsonb_build_object('a', public.gl_acct(a.company_id, 'disposal_gain_loss'),
                       'd', greatest(v_book - v_amt, 0), 'c', greatest(v_amt - v_book, 0), 't', 'Gain or loss on ' || a.number));
  perform public.gl_post(a.company_id, public.gl_open_date(a.company_id, coalesce(p_on, (now() at time zone 'Africa/Dar_es_Salaam')::date)),
    p_on, 'Asset disposed: ' || a.number || ' ' || a.name, 'asset_disposal', a.id, a.number, null, v_ln);
  perform set_config('ims.status_change', 'on', true);
  update public.fixed_assets set status = 'disposed', disposed_on = coalesce(p_on, (now() at time zone 'Africa/Dar_es_Salaam')::date),
         disposal_amount = v_amt where id = p_asset;
  perform set_config('ims.status_change', '', true);
end;
$$;

create or replace function public.guard_fixed_asset()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (new.cost, new.residual_value, new.life_months, new.bought_on, new.paid_from, new.accumulated_dep, new.status)
     is distinct from (old.cost, old.residual_value, old.life_months, old.bought_on, old.paid_from, old.accumulated_dep, old.status)
     and coalesce(current_setting('ims.status_change', true), '') <> 'on' then
    raise exception 'Cost, life and status are fixed once posted. Dispose of the asset and add it again to correct them.' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists fixed_assets_guard on public.fixed_assets;
create trigger fixed_assets_guard before update on public.fixed_assets for each row execute function public.guard_fixed_asset();

-- ---------------------------------------------------------------------
-- 5. Manual journals and closing the books
-- ---------------------------------------------------------------------
create or replace function public.gl_manual_journal(p_company uuid, p_date date, p_memo text, p_lines jsonb, p_opening boolean)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  l jsonb;
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management or finance can post journals.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_memo), '') = '' then
    raise exception 'Say what the journal is for.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 or jsonb_array_length(p_lines) > 200 then
    raise exception 'A journal needs between 2 and 200 lines.' using errcode = '22023';
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if not exists (select 1 from public.gl_accounts a where a.id = (l ->> 'a')::uuid and a.company_id = p_company and a.active) then
      raise exception 'Choose an account on every line.' using errcode = '22023';
    end if;
  end loop;
  return public.gl_post(p_company, p_date, p_date, btrim(p_memo), case when p_opening then 'opening' else 'manual' end,
                        null, null, null, p_lines);
end;
$$;

-- Reverse a journal posted by hand (documents correct themselves: change or cancel the document).
create or replace function public.gl_reverse_journal(p_journal uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  j public.gl_journals;
begin
  select * into j from public.gl_journals where id = p_journal;
  if j.id is null or not public.has_role(j.company_id, public.finance_roles()) then
    raise exception 'Journal not found.' using errcode = '42501';
  end if;
  if j.source not in ('manual', 'opening') then
    raise exception 'This entry comes from a document. Change or cancel the document instead.' using errcode = '22023';
  end if;
  if j.reversed_by is not null or j.reverses is not null then
    raise exception 'This journal is already reversed.' using errcode = '22023';
  end if;
  return public.gl_reverse(p_journal, 'Reversal of ' || j.number);
end;
$$;

-- Management: close the books up to a date (null opens them all again).
create or replace function public.gl_close_books(p_company uuid, p_until date)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_old date;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can close the books.' using errcode = '42501';
  end if;
  if p_until is not null and p_until > (now() at time zone 'Africa/Dar_es_Salaam')::date then
    raise exception 'You cannot close days that have not ended.' using errcode = '22023';
  end if;
  select books_closed_until into v_old from public.companies where id = p_company;
  update public.companies set books_closed_until = p_until where id = p_company;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (p_company, auth.uid(), 'update', 'books', p_company::text,
          jsonb_build_object('closed until', jsonb_build_object('from', v_old, 'to', p_until)));
end;
$$;

-- Post (again) every document of a company; returns how many entries changed.
create or replace function public.gl_resync_internal(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  r       record;
  v_count integer := 0;
begin
  perform public.gl_ensure_accounts(p_company);
  for r in
    select 'invoices' s, id from public.invoices where company_id = p_company and status in ('issued', 'partly_paid', 'paid', 'cancelled')
    union all select 'payments', id from public.payments where company_id = p_company
    union all select 'supplier_bills', id from public.supplier_bills where company_id = p_company
    union all select 'supplier_payments', id from public.supplier_payments where company_id = p_company
    union all select 'expenses', id from public.expenses where company_id = p_company
  loop
    begin
      if public.gl_sync(r.s, r.id) then
        v_count := v_count + 1;
      end if;
    exception when others then
      insert into public.gl_sync_issues (company_id, source, source_id, error)
      values (p_company, r.s, r.id, left(sqlerrm, 500))
      on conflict (source, source_id) do update set error = excluded.error, created_at = now();
    end;
  end loop;
  return v_count;
end;
$$;

create or replace function public.gl_resync(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management or finance can do this.' using errcode = '42501';
  end if;
  return public.gl_resync_internal(p_company);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Reports
-- ---------------------------------------------------------------------
-- Every account with its balance before p_from, what moved from p_from to p_to, and the balance at p_to
-- (debits positive). p_from null = from the very beginning.
create or replace function public.gl_trial_balance(p_company uuid, p_from date, p_to date)
returns table (account_id uuid, code text, name text, type text, system_key text, active boolean,
               opening numeric, debit numeric, credit numeric, closing numeric)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management or finance can see the books.' using errcode = '42501';
  end if;
  return query
  select a.id, a.code, a.name, a.type, a.system_key, a.active,
         coalesce(sum(l.debit - l.credit) filter (where p_from is not null and j.entry_date < p_from), 0),
         coalesce(sum(l.debit) filter (where p_from is null or j.entry_date >= p_from), 0),
         coalesce(sum(l.credit) filter (where p_from is null or j.entry_date >= p_from), 0),
         coalesce(sum(l.debit - l.credit), 0)
    from public.gl_accounts a
    left join public.gl_lines l on l.account_id = a.id
    left join public.gl_journals j on j.id = l.journal_id and j.entry_date <= p_to
   where a.company_id = p_company and (l.id is null or j.id is not null)
   group by a.id
  union all
  -- accounts whose every entry is after p_to
  select a.id, a.code, a.name, a.type, a.system_key, a.active, 0, 0, 0, 0
    from public.gl_accounts a
   where a.company_id = p_company
     and exists (select 1 from public.gl_lines l where l.account_id = a.id)
     and not exists (select 1 from public.gl_lines l join public.gl_journals j on j.id = l.journal_id
                      where l.account_id = a.id and j.entry_date <= p_to)
   order by 2;
end;
$$;

-- Health check: debits equal credits, and the client and supplier accounts match the open documents.
create or replace function public.gl_check(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_dr numeric;
  v_cr numeric;
  v_ar numeric;
  v_ap numeric;
  v_ar_docs numeric;
  v_ap_docs numeric;
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management or finance can see the books.' using errcode = '42501';
  end if;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_dr, v_cr from public.gl_lines where company_id = p_company;
  select coalesce(sum(l.debit - l.credit), 0) into v_ar from public.gl_lines l join public.gl_accounts a on a.id = l.account_id
   where l.company_id = p_company and a.system_key = 'receivable';
  select coalesce(sum(l.credit - l.debit), 0) into v_ap from public.gl_lines l join public.gl_accounts a on a.id = l.account_id
   where l.company_id = p_company and a.system_key = 'payable';
  select coalesce(sum(round(total * exchange_rate, 2)), 0)
         - coalesce((select sum(round(p.amount * i2.exchange_rate, 2)) from public.payments p join public.invoices i2 on i2.id = p.invoice_id
                      where p.company_id = p_company and p.voided_at is null and i2.status in ('issued', 'partly_paid', 'paid')), 0)
    into v_ar_docs from public.invoices where company_id = p_company and status in ('issued', 'partly_paid', 'paid');
  select coalesce(sum(round(total * exchange_rate, 2)), 0)
         - coalesce((select sum(round(sp.amount * b2.exchange_rate, 2)) from public.supplier_payments sp join public.supplier_bills b2 on b2.id = sp.bill_id
                      where sp.company_id = p_company and sp.voided_at is null and b2.status <> 'cancelled'), 0)
    into v_ap_docs from public.supplier_bills where company_id = p_company and status <> 'cancelled';
  return jsonb_build_object(
    'balanced', v_dr = v_cr, 'debits', v_dr, 'credits', v_cr,
    'receivable_books', v_ar, 'receivable_documents', v_ar_docs,
    'payable_books', v_ap, 'payable_documents', v_ap_docs,
    'issues', (select count(*) from public.gl_sync_issues where company_id = p_company),
    'closed_until', (select books_closed_until from public.companies where id = p_company));
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Triggers, row-level security and grants
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['gl_accounts', 'fixed_assets'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
  foreach t in array array['gl_accounts', 'gl_journals', 'gl_lines', 'gl_sync_issues', 'fixed_assets', 'fixed_asset_depreciation'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_role(company_id, public.finance_roles()))', t, t);
  end loop;
end $$;

drop policy if exists gl_accounts_insert on public.gl_accounts;
create policy gl_accounts_insert on public.gl_accounts for insert to authenticated
  with check (public.has_role(company_id, public.finance_roles()) and system_key is null);
drop policy if exists gl_accounts_update on public.gl_accounts;
create policy gl_accounts_update on public.gl_accounts for update to authenticated
  using (public.has_role(company_id, public.finance_roles())) with check (public.has_role(company_id, public.finance_roles()));
grant insert (company_id, code, name, type, notes) on public.gl_accounts to authenticated;
grant update (code, name, notes, active) on public.gl_accounts to authenticated;

drop policy if exists fixed_assets_update on public.fixed_assets;
create policy fixed_assets_update on public.fixed_assets for update to authenticated
  using (public.has_role(company_id, public.finance_roles())) with check (public.has_role(company_id, public.finance_roles()));
grant update (name, category, serial_no, location, vehicle_id, notes) on public.fixed_assets to authenticated;

revoke execute on function
  public.gl_default_accounts(), public.gl_acct(uuid, text), public.gl_ensure_accounts(uuid), public.gl_category_account(uuid),
  public.guard_gl_account(), public.gl_open_date(uuid, date),
  public.gl_post(uuid, date, date, text, text, uuid, text, uuid, jsonb), public.gl_reverse(uuid, text),
  public.gl_money_account(uuid, text), public.gl_desired(text, uuid), public.gl_shape(jsonb), public.gl_sync(text, uuid),
  public.gl_on_document(),
  public.add_fixed_asset(uuid, text, text, date, numeric, numeric, integer, text, text, text, uuid, text),
  public.post_depreciation(uuid, date), public.dispose_fixed_asset(uuid, date, numeric, text), public.guard_fixed_asset(),
  public.gl_manual_journal(uuid, date, text, jsonb, boolean), public.gl_reverse_journal(uuid), public.gl_close_books(uuid, date),
  public.gl_resync_internal(uuid), public.gl_resync(uuid), public.gl_trial_balance(uuid, date, date), public.gl_check(uuid)
from public, anon, authenticated;
grant execute on function
  public.add_fixed_asset(uuid, text, text, date, numeric, numeric, integer, text, text, text, uuid, text),
  public.post_depreciation(uuid, date), public.dispose_fixed_asset(uuid, date, numeric, text),
  public.gl_manual_journal(uuid, date, text, jsonb, boolean), public.gl_reverse_journal(uuid), public.gl_close_books(uuid, date),
  public.gl_resync(uuid), public.gl_trial_balance(uuid, date, date), public.gl_check(uuid)
to authenticated;

-- ---------------------------------------------------------------------
-- 8. Every company gets its chart, and existing documents are posted
-- ---------------------------------------------------------------------
create or replace function public.gl_new_company()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.gl_ensure_accounts(new.id);
  return null;
end;
$$;
revoke execute on function public.gl_new_company() from public, anon, authenticated;
drop trigger if exists companies_gl_accounts on public.companies;
create trigger companies_gl_accounts after insert on public.companies for each row execute function public.gl_new_company();

do $$
declare
  c record;
begin
  perform set_config('ims.quiet_audit', 'on', true);
  for c in select id from public.companies loop
    perform public.gl_resync_internal(c.id);
  end loop;
  perform set_config('ims.quiet_audit', 'off', true);
end $$;

notify pgrst, 'reload schema';
