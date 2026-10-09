-- =====================================================================
-- LeMoSp  ·  Stage 13: small-business essentials
--
--   Expenses        day-to-day spending with categories and a photo of the
--                   receipt (EXP- numbers). Management and finance see and
--                   manage all expenses; anyone else in the team can record
--                   their own (a driver buying fuel) and see only those.
--   Mobile money    payments in, payments to suppliers and expenses record
--                   the service (M-Pesa, Mixx by Yas / Tigo Pesa, Airtel
--                   Money, HaloPesa, AzamPesa) next to the transaction code.
--                   Companies print their mobile-money pay numbers on
--                   invoices (changing them needs a recent sign-in, like
--                   bank details).
--   Checking        "checked against the statement" on each payment and
--                   expense (management, finance), by ticking or by pasting
--                   the statement: recorded transaction codes found in it
--                   are ticked.
--   Follow-ups      calls / messages / visits logged on a quotation or an
--                   invoice, with the next follow-up date or the date the
--                   client promised to pay.
--   Reminders       configurable per company: follow up quotations every N
--                   days, remind before an invoice is due, and repeat
--                   overdue reminders every N days (paused while a promised
--                   payment date has not passed yet).
--
-- Also: the four Stage 13 features go live in the catalogue, test-data reset
-- and demos include the new records, and receipt photos are cleaned up with
-- closed and demo companies.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Company settings
-- ---------------------------------------------------------------------
alter table public.companies
  add column if not exists mobile_money_details       text,
  add column if not exists quote_followup_days        integer not null default 3,
  add column if not exists invoice_remind_before_days integer not null default 3,
  add column if not exists invoice_overdue_every_days integer not null default 7;
alter table public.companies drop constraint if exists companies_quote_followup_days_check;
alter table public.companies add constraint companies_quote_followup_days_check check (quote_followup_days between 0 and 60);
alter table public.companies drop constraint if exists companies_invoice_remind_before_days_check;
alter table public.companies add constraint companies_invoice_remind_before_days_check check (invoice_remind_before_days between 0 and 30);
alter table public.companies drop constraint if exists companies_invoice_overdue_every_days_check;
alter table public.companies add constraint companies_invoice_overdue_every_days_check check (invoice_overdue_every_days between 1 and 90);
grant update (mobile_money_details, quote_followup_days, invoice_remind_before_days, invoice_overdue_every_days)
  on public.companies to authenticated;

-- Mobile-money pay numbers are printed on invoices like bank details: changing them needs a
-- recent sign-in (same rule as Security plus).
create or replace function public.guard_bank_details()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- Demo data written by the demo set-up itself is not a change made by a person.
  if current_setting('ims.demo_seed', true) = 'on' then
    return new;
  end if;
  if auth.uid() is not null and (
       public.norm_doc_text(new.bank_details)         is distinct from public.norm_doc_text(old.bank_details)
    or public.norm_doc_text(new.mobile_money_details) is distinct from public.norm_doc_text(old.mobile_money_details)
    or public.norm_doc_text(new.document_footer)      is distinct from public.norm_doc_text(old.document_footer)
    or public.norm_doc_text(new.quote_terms)          is distinct from public.norm_doc_text(old.quote_terms)
    or public.norm_doc_text(new.po_terms)             is distinct from public.norm_doc_text(old.po_terms)
    or public.norm_doc_text(new.invoice_terms)        is distinct from public.norm_doc_text(old.invoice_terms)) then
    perform public.require_step_up(old.id);
  end if;
  return new;
end;
$$;
drop trigger if exists companies_bank_details_guard on public.companies;
create trigger companies_bank_details_guard
  before update of bank_details, mobile_money_details, document_footer, quote_terms, po_terms, invoice_terms on public.companies
  for each row execute function public.guard_bank_details();

-- ---------------------------------------------------------------------
-- 2. Mobile-money service and "checked" on payments
-- ---------------------------------------------------------------------
create or replace function public.mobile_money_providers()
returns text[] language sql immutable set search_path = ''
as $$
  select array['mpesa', 'tigopesa', 'airtel_money', 'halopesa', 'azampesa', 'other'];
$$;

alter table public.payments
  add column if not exists provider      text,
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciled_by uuid references auth.users (id) on delete set null;
alter table public.supplier_payments
  add column if not exists provider      text,
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciled_by uuid references auth.users (id) on delete set null;
alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check
  check (provider is null or (method = 'mobile_money' and provider = any (public.mobile_money_providers())));
alter table public.supplier_payments drop constraint if exists supplier_payments_provider_check;
alter table public.supplier_payments add constraint supplier_payments_provider_check
  check (provider is null or (method = 'mobile_money' and provider = any (public.mobile_money_providers())));
create index if not exists payments_reference_idx on public.payments (company_id, upper(reference)) where reference is not null;
create index if not exists supplier_payments_reference_idx on public.supplier_payments (company_id, upper(reference)) where reference is not null;
create index if not exists supplier_payments_company_date_idx on public.supplier_payments (company_id, paid_on desc);

-- The two "record a payment" actions take the mobile-money service too. The old versions are
-- replaced (one function per name keeps the app's calls unambiguous).
drop function if exists public.record_payment(uuid, date, numeric, text, text, numeric, text);
create or replace function public.record_payment(p_invoice uuid, p_received_on date, p_amount numeric, p_method text,
                                                 p_reference text, p_exchange_rate numeric, p_notes text,
                                                 p_provider text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  inv public.invoices;
  v_id uuid;
  v_open numeric;
  v_method text := coalesce(nullif(p_method, ''), 'bank_transfer');
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.id is null or not public.has_role(inv.company_id, array['management', 'finance']::public.app_role[]) then
    raise exception 'Invoice not found.' using errcode = '42501';
  end if;
  if inv.status not in ('issued', 'partly_paid') then
    raise exception 'Payments can only be recorded on an issued, unpaid invoice.' using errcode = '22023';
  end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount received.' using errcode = '22023'; end if;
  v_open := inv.total - inv.amount_paid;
  if round(p_amount, 2) > v_open then
    raise exception 'Only % % is still owed on this invoice.', inv.currency, to_char(v_open, 'FM999,999,999,990.00')
      using errcode = '22023';
  end if;

  insert into public.payments (company_id, invoice_id, client_id, received_on, amount, currency, exchange_rate, method,
                               provider, reference, notes)
  values (inv.company_id, p_invoice, inv.client_id,
          coalesce(p_received_on, (now() at time zone 'Africa/Dar_es_Salaam')::date), round(p_amount, 2), inv.currency,
          coalesce(nullif(p_exchange_rate, 0), inv.exchange_rate), v_method,
          case when v_method = 'mobile_money' then nullif(p_provider, '') end,
          nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''))
  returning id into v_id;

  perform set_config('ims.status_change', 'on', true);
  update public.invoices
     set amount_paid = amount_paid + round(p_amount, 2),
         status = case when amount_paid + round(p_amount, 2) >= total then 'paid' else 'partly_paid' end
   where id = p_invoice;
  perform set_config('ims.status_change', 'off', true);
  return v_id;
end;
$$;

drop function if exists public.pay_supplier_bill(uuid, date, numeric, text, text, numeric, text);
create or replace function public.pay_supplier_bill(p_bill uuid, p_paid_on date, p_amount numeric, p_method text,
                                                    p_reference text, p_exchange_rate numeric, p_notes text,
                                                    p_provider text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  b public.supplier_bills;
  v_id uuid;
  v_open numeric;
  v_method text := coalesce(nullif(p_method, ''), 'bank_transfer');
begin
  select * into b from public.supplier_bills where id = p_bill for update;
  if b.id is null or not public.has_role(b.company_id, array['management', 'finance']::public.app_role[]) then
    raise exception 'Bill not found.' using errcode = '42501';
  end if;
  if b.status not in ('open', 'partly_paid') then raise exception 'This bill is not open for payment.' using errcode = '22023'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount paid.' using errcode = '22023'; end if;
  v_open := b.total - b.amount_paid;
  if round(p_amount, 2) > v_open then
    raise exception 'Only % % is still owed on this bill.', b.currency, to_char(v_open, 'FM999,999,999,990.00') using errcode = '22023';
  end if;

  insert into public.supplier_payments (company_id, bill_id, supplier_id, paid_on, amount, currency, exchange_rate, method,
                                        provider, reference, notes)
  values (b.company_id, p_bill, b.supplier_id, coalesce(p_paid_on, (now() at time zone 'Africa/Dar_es_Salaam')::date),
          round(p_amount, 2), b.currency, coalesce(nullif(p_exchange_rate, 0), b.exchange_rate), v_method,
          case when v_method = 'mobile_money' then nullif(p_provider, '') end,
          nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''))
  returning id into v_id;

  perform set_config('ims.status_change', 'on', true);
  update public.supplier_bills
     set amount_paid = amount_paid + round(p_amount, 2),
         status = case when amount_paid + round(p_amount, 2) >= total then 'paid' else 'partly_paid' end
   where id = p_bill;
  perform set_config('ims.status_change', 'off', true);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Expense categories and expenses
-- ---------------------------------------------------------------------
create table if not exists public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 60),
  active      boolean not null default true,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (id, company_id)
);
create unique index if not exists expense_categories_name_key on public.expense_categories (company_id, lower(btrim(name)));

-- Every company starts with the usual categories (renamed or switched off as they like).
create or replace function public.default_expense_categories()
returns text[] language sql immutable set search_path = ''
as $$
  select array['Rent', 'Salaries & wages', 'Transport & fuel', 'Electricity & water', 'Phone & internet',
               'Office supplies', 'Bank & mobile-money charges', 'Taxes, licences & fees', 'Repairs & maintenance',
               'Marketing', 'Meals & entertainment', 'Professional fees', 'Other'];
$$;

create or replace function public.add_expense_categories()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_quiet text := current_setting('ims.quiet_audit', true);
begin
  -- The starting list is not news for the Activity log.
  perform set_config('ims.quiet_audit', 'on', true);
  insert into public.expense_categories (company_id, name, sort)
  select new.id, c.name, c.n * 10
    from unnest(public.default_expense_categories()) with ordinality as c(name, n)
  on conflict do nothing;
  perform set_config('ims.quiet_audit', coalesce(nullif(v_quiet, ''), 'off'), true);
  return null;
end;
$$;
drop trigger if exists companies_expense_categories on public.companies;
create trigger companies_expense_categories after insert on public.companies
  for each row execute function public.add_expense_categories();

do $$
begin
  perform set_config('ims.quiet_audit', 'on', true);
  insert into public.expense_categories (company_id, name, sort)
  select co.id, c.name, c.n * 10
    from public.companies co
    cross join unnest(public.default_expense_categories()) with ordinality as c(name, n)
   where not exists (select 1 from public.expense_categories e where e.company_id = co.id)
  on conflict do nothing;
  perform set_config('ims.quiet_audit', 'off', true);
end;
$$;

create table if not exists public.expenses (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  number         text not null default '',
  category_id    uuid not null,
  spent_on       date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  payee          text check (payee is null or char_length(payee) <= 200),
  description    text not null check (char_length(btrim(description)) between 2 and 300),
  -- What was paid, VAT included; vat_amount is the part of it that is VAT (0 if none or unknown).
  amount         numeric(18, 2) not null check (amount > 0),
  vat_amount     numeric(18, 2) not null default 0 check (vat_amount >= 0),
  currency       text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate  numeric(18, 6) not null default 1 check (exchange_rate > 0),
  method         text not null default 'cash'
                 check (method in ('bank_transfer', 'cash', 'mobile_money', 'cheque', 'other')),
  provider       text,
  reference      text check (reference is null or char_length(reference) <= 100),
  receipt_path   text,
  notes          text check (notes is null or char_length(notes) <= 1000),
  voided_at      timestamptz,
  voided_by      uuid references auth.users (id) on delete set null,
  void_reason    text,
  reconciled_at  timestamptz,
  reconciled_by  uuid references auth.users (id) on delete set null,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  check (vat_amount <= amount),
  check (provider is null or (method = 'mobile_money' and provider = any (public.mobile_money_providers()))),
  foreign key (category_id, company_id) references public.expense_categories (id, company_id)
);
create index if not exists expenses_company_date_idx on public.expenses (company_id, spent_on desc);
create index if not exists expenses_category_idx on public.expenses (category_id);
create index if not exists expenses_creator_idx on public.expenses (created_by, spent_on desc);
create index if not exists expenses_reference_idx on public.expenses (company_id, upper(reference)) where reference is not null;

-- Numbering adds expenses (EXP-).
create or replace function public.assign_doc_number()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_year text := to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY');
  v_prefix text;
begin
  if coalesce(btrim(new.number), '') <> '' then
    return new;
  end if;
  v_prefix := case tg_table_name
                when 'rfqs' then 'RFQ-'
                when 'quotations' then 'QT-'
                when 'supplier_rfqs' then 'SRFQ-'
                when 'purchase_orders' then 'PO-'
                when 'goods_receipts' then 'GRN-'
                when 'deliveries' then 'DN-'
                when 'payments' then 'RCT-'
                when 'supplier_bills' then 'BILL-'
                when 'supplier_payments' then 'PAY-'
                when 'expenses' then 'EXP-'
                else 'DOC-' end || v_year || '-';
  new.number := public.next_code(new.company_id, tg_table_name || '-' || v_year, v_prefix, 4);
  return new;
end;
$$;

-- Expenses: who recorded it, currency, mobile-money service, receipt file; frozen once voided,
-- amounts frozen once checked against the statement.
create or replace function public.prepare_expense()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_base text;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
    new.reconciled_at := null;
    new.reconciled_by := null;
  elsif current_setting('ims.status_change', true) is distinct from 'on' then
    if old.voided_at is not null then
      raise exception 'This expense was voided and can no longer be changed.' using errcode = '42501';
    end if;
    if (new.voided_at, new.voided_by, new.void_reason, new.reconciled_at, new.reconciled_by, new.number, new.created_by)
       is distinct from (old.voided_at, old.voided_by, old.void_reason, old.reconciled_at, old.reconciled_by, old.number, old.created_by) then
      raise exception 'Use the buttons in the app to change this.' using errcode = '42501';
    end if;
    if old.reconciled_at is not null
       and (new.amount, new.currency, new.exchange_rate, new.method, new.provider, new.reference, new.spent_on)
           is distinct from (old.amount, old.currency, old.exchange_rate, old.method, old.provider, old.reference, old.spent_on) then
      raise exception 'This expense has been checked against the statement. Untick it first to change the amount, date or reference.'
        using errcode = '42501';
    end if;
  end if;

  select base_currency into v_base from public.companies where id = new.company_id;
  new.currency := upper(coalesce(nullif(btrim(new.currency), ''), v_base));
  if new.currency = v_base then
    new.exchange_rate := 1;
  end if;
  new.description := btrim(new.description);
  new.payee := nullif(btrim(new.payee), '');
  new.reference := nullif(btrim(new.reference), '');
  new.notes := nullif(btrim(new.notes), '');
  if new.method <> 'mobile_money' then
    new.provider := null;
  end if;
  if new.vat_amount > new.amount then
    raise exception 'The VAT part cannot be more than the amount paid.' using errcode = '22023';
  end if;

  -- A receipt file must be this expense's own, already uploaded: receipts/<company>/<expense>/<file>.
  if new.receipt_path is not null and (tg_op = 'INSERT' or new.receipt_path is distinct from old.receipt_path) then
    if new.receipt_path not like new.company_id::text || '/' || new.id::text || '/%'
       or new.receipt_path like '%..%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'receipts' and o.name = new.receipt_path) then
      raise exception 'The receipt photo was not found. Please attach it again.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists expenses_number on public.expenses;
create trigger expenses_number before insert on public.expenses for each row execute function public.assign_doc_number();
drop trigger if exists expenses_prepare on public.expenses;
create trigger expenses_prepare before insert or update on public.expenses for each row execute function public.prepare_expense();
drop trigger if exists expenses_touch on public.expenses;
create trigger expenses_touch before update on public.expenses for each row execute function public.touch_updated_at();
drop trigger if exists expenses_keep on public.expenses;
create trigger expenses_keep before update on public.expenses for each row execute function public.keep_company();
drop trigger if exists expenses_audit on public.expenses;
create trigger expenses_audit after insert or update on public.expenses for each row execute function public.audit_row();

drop trigger if exists expense_categories_touch on public.expense_categories;
create trigger expense_categories_touch before update on public.expense_categories for each row execute function public.touch_updated_at();
drop trigger if exists expense_categories_keep on public.expense_categories;
create trigger expense_categories_keep before update on public.expense_categories for each row execute function public.keep_company();
drop trigger if exists expense_categories_audit on public.expense_categories;
create trigger expense_categories_audit after insert or update on public.expense_categories for each row execute function public.audit_row();

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories for select to authenticated
  using (public.is_member(company_id));
drop policy if exists expense_categories_insert on public.expense_categories;
create policy expense_categories_insert on public.expense_categories for insert to authenticated
  with check (public.has_role(company_id, array['management', 'finance']::public.app_role[]));
drop policy if exists expense_categories_update on public.expense_categories;
create policy expense_categories_update on public.expense_categories for update to authenticated
  using (public.has_role(company_id, array['management', 'finance']::public.app_role[]))
  with check (public.has_role(company_id, array['management', 'finance']::public.app_role[]));

-- Management and finance: every expense. Everyone else in the team: the ones they recorded.
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (public.has_role(company_id, array['management', 'finance']::public.app_role[])
         or (created_by = auth.uid() and public.is_member(company_id)));
drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (public.is_member(company_id));
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (public.has_role(company_id, array['management', 'finance']::public.app_role[])
         or (created_by = auth.uid() and public.is_member(company_id)))
  with check (public.has_role(company_id, array['management', 'finance']::public.app_role[])
              or (created_by = auth.uid() and public.is_member(company_id)));

revoke all on public.expense_categories, public.expenses from anon, authenticated;
grant select on public.expense_categories, public.expenses to authenticated;
grant insert (company_id, name, sort) on public.expense_categories to authenticated;
grant update (name, active, sort) on public.expense_categories to authenticated;
grant insert (company_id, category_id, spent_on, payee, description, amount, vat_amount, currency, exchange_rate, method,
              provider, reference, receipt_path, notes)
  on public.expenses to authenticated;
grant update (category_id, spent_on, payee, description, amount, vat_amount, currency, exchange_rate, method, provider,
              reference, receipt_path, notes)
  on public.expenses to authenticated;

-- Void an expense (it stays on record, struck through, and no longer counts).
create or replace function public.void_expense(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  e public.expenses;
begin
  select * into e from public.expenses where id = p_id for update;
  if e.id is null or not public.has_role(e.company_id, array['management', 'finance']::public.app_role[]) then
    raise exception 'Only management and finance can void an expense.' using errcode = '42501';
  end if;
  if e.voided_at is not null then return; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for voiding the expense.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.expenses
     set voided_at = now(), voided_by = auth.uid(), void_reason = left(btrim(p_reason), 300),
         reconciled_at = null, reconciled_by = null
   where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Receipt photos: receipts/<company id>/<expense id>/<file>, private.
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false) on conflict (id) do nothing;
do $$
begin
  update storage.buckets
     set file_size_limit = 5242880,
         allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
   where id = 'receipts';
exception when undefined_column then
  raise notice 'Storage limits not set (older storage version).';
end;
$$;

-- Who may see or add a receipt: whoever may see the expense (management, finance, the person who
-- recorded it); adding only while the expense is not voided.
create or replace function public.can_use_receipt(p_name text, p_adding boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.expenses e
     where e.company_id::text = (storage.foldername(p_name))[1]
       and e.id::text = (storage.foldername(p_name))[2]
       and (not p_adding or e.voided_at is null)
       and (public.has_role(e.company_id, array['management', 'finance']::public.app_role[])
            or (e.created_by = auth.uid() and public.is_member(e.company_id))));
$$;

drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.can_use_receipt(name, true));
drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.can_use_receipt(name, false));

-- Closed companies: receipt photos are removed together with the logo and delivery photos
-- (a platform admin clears whatever storage refuses to delete from SQL).
create or replace function public.add_receipts_cleanup()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.bucket = 'branding' then
    insert into public.storage_cleanup (bucket, prefix, company_ref)
    values ('receipts', new.prefix, new.company_ref)
    on conflict (bucket, prefix) do nothing;
    begin
      delete from storage.objects where bucket_id = 'receipts' and name like new.prefix || '%';
    exception when others then
      raise notice 'Receipt files for % left in storage: %', new.company_ref, sqlerrm;
    end;
  end if;
  return null;
end;
$$;
do $$
begin
  drop trigger if exists storage_cleanup_receipts on public.storage_cleanup;
  create trigger storage_cleanup_receipts after insert on public.storage_cleanup
    for each row execute function public.add_receipts_cleanup();
exception when undefined_table then
  raise notice 'Run the v1.14 deletion update first, then this one again, so receipt photos are cleaned up with closed companies.';
end;
$$;

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
  -- Uploaded logo / signature / receipt records (newer Supabase storage may refuse
  -- direct deletes; the files are then left for the storage API).
  begin
    delete from storage.objects
     where bucket_id in ('branding', 'pod', 'receipts') and name like p_company::text || '/%';
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
-- 4. Follow-ups on quotations and invoices
-- ---------------------------------------------------------------------
create table if not exists public.followups (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  quotation_id  uuid,
  invoice_id    uuid,
  channel       text not null default 'call' check (channel in ('call', 'whatsapp', 'sms', 'email', 'visit', 'other')),
  note          text check (note is null or char_length(note) <= 1000),
  -- Quotations: when to follow up next. Invoices: the date the client promised to pay.
  next_on       date,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (num_nonnulls(quotation_id, invoice_id) = 1),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id) on delete cascade,
  foreign key (invoice_id, company_id) references public.invoices (id, company_id) on delete cascade
);
create index if not exists followups_quotation_idx on public.followups (quotation_id, created_at desc) where quotation_id is not null;
create index if not exists followups_invoice_idx on public.followups (invoice_id, created_at desc) where invoice_id is not null;

alter table public.followups enable row level security;
drop policy if exists followups_select on public.followups;
create policy followups_select on public.followups for select to authenticated
  using ((quotation_id is not null and public.has_role(company_id, array['management', 'sales', 'procurement', 'finance']::public.app_role[]))
      or (invoice_id is not null and public.has_role(company_id, array['management', 'finance', 'sales']::public.app_role[])));
revoke all on public.followups from anon, authenticated;
grant select on public.followups to authenticated;

drop trigger if exists followups_audit on public.followups;
create trigger followups_audit after insert on public.followups for each row execute function public.audit_row();

-- Log a call, message or visit about an open quotation (management, sales) or an unpaid invoice
-- (management, finance, sales). The person's own reminders for it are marked as read.
create or replace function public.log_followup(p_quotation uuid, p_invoice uuid, p_channel text, p_note text, p_next_on date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_company uuid;
  v_status text;
  v_id uuid;
  v_link text;
begin
  if num_nonnulls(p_quotation, p_invoice) <> 1 then
    raise exception 'Choose the quotation or the invoice.' using errcode = '22023';
  end if;
  if p_quotation is not null then
    select company_id, status into v_company, v_status from public.quotations where id = p_quotation;
    if v_company is null or not public.has_role(v_company, array['management', 'sales']::public.app_role[]) then
      raise exception 'Quotation not found.' using errcode = '42501';
    end if;
    if v_status not in ('approved', 'sent') then
      raise exception 'Follow-ups are for quotations waiting for the client''s answer.' using errcode = '22023';
    end if;
    v_link := '/quotations/' || p_quotation;
  else
    select company_id, status into v_company, v_status from public.invoices where id = p_invoice;
    if v_company is null or not public.has_role(v_company, array['management', 'finance', 'sales']::public.app_role[]) then
      raise exception 'Invoice not found.' using errcode = '42501';
    end if;
    if v_status not in ('issued', 'partly_paid') then
      raise exception 'Follow-ups are for invoices that are not fully paid.' using errcode = '22023';
    end if;
    v_link := '/invoices/' || p_invoice;
  end if;
  if coalesce(p_channel, '') not in ('call', 'whatsapp', 'sms', 'email', 'visit', 'other') then
    raise exception 'Choose how you contacted the client.' using errcode = '22023';
  end if;
  if p_next_on is not null and (p_next_on < v_today or p_next_on > v_today + 365) then
    raise exception 'The next date must be between today and one year from now.' using errcode = '22023';
  end if;

  insert into public.followups (company_id, quotation_id, invoice_id, channel, note, next_on)
  values (v_company, p_quotation, p_invoice, p_channel, nullif(left(btrim(p_note), 1000), ''), p_next_on)
  returning id into v_id;

  update public.notifications
     set read_at = now()
   where user_id = auth.uid() and company_id = v_company and read_at is null
     and kind in ('quote_followup', 'quote_expiring', 'invoice_due', 'invoice_overdue')
     and (link = v_link or link like v_link || '#%');
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Checking payments and expenses against the statement
-- ---------------------------------------------------------------------
-- Tick (p_done true) or untick payments received ('payment'), payments to suppliers
-- ('supplier_payment') or expenses ('expense'). Voided records are skipped. Returns how many changed.
create or replace function public.set_reconciled(p_company uuid, p_kind text, p_ids uuid[], p_done boolean)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  if not public.has_role(p_company, array['management', 'finance']::public.app_role[]) then
    raise exception 'Only management and finance can check payments against statements.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(p_ids, 1) > 2000 then
    raise exception 'Tick at most 2,000 at a time.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  if p_kind = 'payment' then
    update public.payments
       set reconciled_at = case when p_done then now() end, reconciled_by = case when p_done then auth.uid() end
     where company_id = p_company and id = any (p_ids) and voided_at is null and (reconciled_at is null) = coalesce(p_done, false);
  elsif p_kind = 'supplier_payment' then
    update public.supplier_payments
       set reconciled_at = case when p_done then now() end, reconciled_by = case when p_done then auth.uid() end
     where company_id = p_company and id = any (p_ids) and voided_at is null and (reconciled_at is null) = coalesce(p_done, false);
  elsif p_kind = 'expense' then
    update public.expenses
       set reconciled_at = case when p_done then now() end, reconciled_by = case when p_done then auth.uid() end
     where company_id = p_company and id = any (p_ids) and voided_at is null and (reconciled_at is null) = coalesce(p_done, false);
  else
    raise exception 'Unknown kind of record.' using errcode = '22023';
  end if;
  get diagnostics v_n = row_count;
  perform set_config('ims.status_change', 'off', true);
  return v_n;
end;
$$;

-- Paste a statement (any layout: copied text or a CSV file's contents). Every unticked payment
-- and expense in the period, paid by p_method (null = any), whose reference (at least 6
-- characters) appears in the statement is ticked. Returns {"matched": n, "items": [...]}.
create or replace function public.match_statement(p_company uuid, p_method text, p_from date, p_to date, p_statement text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_text text;
  v_hits jsonb := '[]'::jsonb;
  v_pay uuid[] := '{}';
  v_sup uuid[] := '{}';
  v_exp uuid[] := '{}';
  r record;
begin
  if not public.has_role(p_company, array['management', 'finance']::public.app_role[]) then
    raise exception 'Only management and finance can check payments against statements.' using errcode = '42501';
  end if;
  if char_length(coalesce(p_statement, '')) > 500000 then
    raise exception 'The statement is too long. Paste one month at a time.' using errcode = '22023';
  end if;
  -- Compare without spaces and in capitals, so "QK7 1AB C2D" still matches "qk71abc2d".
  v_text := upper(regexp_replace(coalesce(p_statement, ''), '\s+', '', 'g'));
  if char_length(v_text) < 6 then
    return jsonb_build_object('matched', 0, 'items', '[]'::jsonb);
  end if;

  for r in
    select x.* from (
      select 'payment' as kind, p.id, p.number, p.reference, p.amount, p.currency, p.received_on as on_day
        from public.payments p
       where p.company_id = p_company and p.voided_at is null and p.reconciled_at is null
         and (p_method is null or p.method = p_method)
         and (p_from is null or p.received_on >= p_from) and (p_to is null or p.received_on <= p_to)
      union all
      select 'supplier_payment', s.id, s.number, s.reference, s.amount, s.currency, s.paid_on
        from public.supplier_payments s
       where s.company_id = p_company and s.voided_at is null and s.reconciled_at is null
         and (p_method is null or s.method = p_method)
         and (p_from is null or s.paid_on >= p_from) and (p_to is null or s.paid_on <= p_to)
      union all
      select 'expense', e.id, e.number, e.reference, e.amount, e.currency, e.spent_on
        from public.expenses e
       where e.company_id = p_company and e.voided_at is null and e.reconciled_at is null
         and (p_method is null or e.method = p_method)
         and (p_from is null or e.spent_on >= p_from) and (p_to is null or e.spent_on <= p_to)
    ) x
    where char_length(regexp_replace(coalesce(x.reference, ''), '\s+', '', 'g')) >= 6
      and strpos(v_text, upper(regexp_replace(x.reference, '\s+', '', 'g'))) > 0
    order by x.on_day, x.number
  loop
    v_hits := v_hits || jsonb_build_object('kind', r.kind, 'id', r.id, 'number', r.number, 'reference', r.reference,
                                           'amount', r.amount, 'currency', r.currency, 'date', r.on_day);
    case r.kind
      when 'payment' then v_pay := v_pay || r.id;
      when 'supplier_payment' then v_sup := v_sup || r.id;
      else v_exp := v_exp || r.id;
    end case;
  end loop;

  perform public.set_reconciled(p_company, 'payment', v_pay, true);
  perform public.set_reconciled(p_company, 'supplier_payment', v_sup, true);
  perform public.set_reconciled(p_company, 'expense', v_exp, true);
  return jsonb_build_object('matched', jsonb_array_length(v_hits), 'items', v_hits);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Time-based alerts, now with quotation follow-ups and configurable
--    invoice reminders (otherwise as in Stage 7)
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
  co public.companies;
  v_step int;
begin
  select count(*) into v_before from public.notifications where company_id = p_company;
  select * into co from public.companies where id = p_company;

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

  -- Quotations sent to the client without an answer: follow up every N days after sending or
  -- after the last follow-up (or on the next follow-up date that was set). 0 days = off.
  if coalesce(co.quote_followup_days, 0) > 0 then
    for r in select q.id, q.number, q.revision, q.created_by, q.total, q.currency, c.name as client, x.due_on
               from public.quotations q
               join public.clients c on c.id = q.client_id
               left join lateral (select f.next_on, (f.created_at at time zone 'Africa/Dar_es_Salaam')::date as on_day
                                    from public.followups f where f.quotation_id = q.id
                                   order by f.created_at desc limit 1) fu on true
               cross join lateral (select coalesce(fu.next_on,
                                                   greatest((coalesce(q.sent_at, q.approved_at, q.created_at) at time zone 'Africa/Dar_es_Salaam')::date,
                                                            fu.on_day) + co.quote_followup_days) as due_on) x
              where q.company_id = p_company and q.status = 'sent'
                and x.due_on <= v_today
                and (q.valid_until is null or q.valid_until >= v_today) loop
      if public.is_active_member(p_company, r.created_by) then
        perform public.notify(p_company, r.created_by, 'quote_followup', 'attention', 'Follow up quotation: ' || r.client,
          r.number || case when r.revision > 0 then '-R' || r.revision else '' end || ' · ' || public.fmt_money(r.total, r.currency)
            || ' · no answer yet',
          '/quotations/' || r.id || '#follow-up', 'qt-fu-' || r.id || '-' || r.due_on);
      else
        perform public.notify_roles(p_company, array['management']::public.app_role[], null, 'quote_followup', 'attention',
          'Follow up quotation: ' || r.client,
          r.number || case when r.revision > 0 then '-R' || r.revision else '' end || ' · ' || public.fmt_money(r.total, r.currency)
            || ' · no answer yet',
          '/quotations/' || r.id || '#follow-up', 'qt-fu-' || r.id || '-' || r.due_on);
      end if;
    end loop;
  end if;

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

  -- Client invoices due within N days (company setting, 0 = off): time to send a friendly reminder.
  if coalesce(co.invoice_remind_before_days, 0) > 0 then
    for r in select i.id, i.number, i.due_date, i.total - i.amount_paid as owed, i.currency, c.name as client
               from public.invoices i join public.clients c on c.id = i.client_id
              where i.company_id = p_company and i.status in ('issued', 'partly_paid')
                and i.due_date between v_today and v_today + co.invoice_remind_before_days loop
      perform public.notify_roles(p_company, array['finance', 'management']::public.app_role[], null, 'invoice_due', 'info',
        'Invoice due soon: ' || r.client,
        r.number || ' · ' || public.fmt_money(r.owed, r.currency) || ' · due ' || to_char(r.due_date, 'DD Mon')
          || ' · send the client a reminder',
        '/invoices/' || r.id || '#remind', 'inv-due-' || r.id || '-' || r.due_date);
    end loop;
  end if;

  -- Overdue client invoices: a reminder on the first day late, then every N days (company
  -- setting). Paused while the client's promised payment date has not passed.
  for r in select i.id, i.number, i.due_date, i.total - i.amount_paid as owed, i.currency, c.name as client,
                  v_today - i.due_date as late, fu.next_on as promised_on
             from public.invoices i
             join public.clients c on c.id = i.client_id
             left join lateral (select f.next_on from public.followups f where f.invoice_id = i.id
                                 order by f.created_at desc limit 1) fu on true
            where i.company_id = p_company and i.status in ('issued', 'partly_paid') and i.due_date < v_today
              and (fu.next_on is null or fu.next_on < v_today) loop
    if r.promised_on is not null then
      perform public.notify_roles(p_company, array['finance', 'management']::public.app_role[], null, 'invoice_overdue', 'attention',
        'Promised payment not received: ' || r.client,
        r.number || ' · ' || public.fmt_money(r.owed, r.currency) || ' · promised for ' || to_char(r.promised_on, 'DD Mon'),
        '/invoices/' || r.id || '#remind', 'inv-promise-' || r.id || '-' || r.promised_on);
    end if;
    v_step := (r.late - 1) / greatest(coalesce(co.invoice_overdue_every_days, 30), 1);
    v_band := 1 + v_step * greatest(coalesce(co.invoice_overdue_every_days, 30), 1);
    v_sev := case when r.late > 60 then 'critical' else 'attention' end;
    perform public.notify_roles(p_company, array['finance', 'management']::public.app_role[], null, 'invoice_overdue', v_sev,
      'Invoice overdue: ' || r.client,
      r.number || ' · ' || public.fmt_money(r.owed, r.currency) || ' · ' || r.late || ' days late',
      '/invoices/' || r.id || '#remind', 'inv-od-' || r.id || '-' || v_band);
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

-- ---------------------------------------------------------------------
-- 7. Clearing test data before go-live also clears expenses and follow-ups
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
  delete from public.followups         where company_id = p_company;
  delete from public.expenses          where company_id = p_company;
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
                    'invoice_lines', 'payments', 'supplier_bills', 'supplier_payments', 'order_costs', 'expenses',
                    'followups');
  delete from public.code_counters
   where company_id = p_company
     and kind ~ '^(rfqs|quotations|supplier_rfqs|purchase_orders|goods_receipts|deliveries|invoices|payments|supplier_bills|supplier_payments|expenses)-';
  update public.companies set alerts_checked_at = null where id = p_company;

  perform set_config('ims.status_change', 'off', true);
  perform set_config('ims.allow_line_copy', 'off', true);
  return 'Test transactions cleared for ' || v_name || '. Master data, team and settings were kept.';
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Feature catalogue: Stage 13 features are live
-- ---------------------------------------------------------------------
update public.features set status = 'live', route = '/expenses',
       description = 'Record day-to-day business expenses by category, with a photo of the receipt.',
       tutorial = '[{"title":"Record an expense","body":"Tap + Expense, enter the amount, category and date."},{"title":"Attach the receipt","body":"Take a photo of the receipt with your phone."},{"title":"See where money goes","body":"Expenses are added up by category and month, and appear in profit & loss."}]'
 where key = 'expenses';
update public.features set status = 'live', route = '/profit-loss',
       description = 'A plain monthly view of sales, cost of goods, expenses and profit.',
       tutorial = '[{"title":"Open Profit & loss","body":"Choose the month."},{"title":"Read the result","body":"Sales minus the cost of the goods and your expenses gives your profit."},{"title":"Compare","body":"See the month before and the year so far side by side."}]'
 where key = 'simple_pl';
update public.features set status = 'live', route = '/statements',
       tutorial = '[{"title":"Choose the customer or supplier","body":"Open Statements, or the statement link on their page."},{"title":"Pick the period","body":"The statement shows the opening balance, every invoice and payment, and the closing balance."},{"title":"Share it","body":"Download the PDF and send it."}]'
 where key = 'statements';
update public.features set status = 'live', route = '/reconcile',
       description = 'Record payments by M-Pesa, Mixx by Yas (Tigo Pesa), Airtel Money, HaloPesa and AzamPesa, and check them against the statement.',
       tutorial = '[{"title":"Record the payment","body":"Choose mobile money, the service and enter the transaction code."},{"title":"Print your pay numbers","body":"Add your Lipa numbers in company details: they appear on invoices."},{"title":"Check the statement","body":"Paste the statement: payments whose codes appear in it are ticked."}]'
 where key = 'mobile_money';
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values ('reminders', 'Follow-ups & payment reminders',
        'Reminders to follow up quotations and to remind clients before and after an invoice is due, with ready-made WhatsApp, SMS and email messages.',
        'Sales', 'small', 'live', 'Owner, sales and finance staff', 'Win more quotations and get paid on time.',
        '[{"title":"Set the timing","body":"In company details, choose after how many days to follow up and remind."},{"title":"Get reminded","body":"The app tells you which quotations and invoices need a follow-up."},{"title":"Send the message","body":"Open the quotation or invoice and send the ready-made WhatsApp, SMS or email, then log what the client said."}]',
        null, 205)
on conflict (key) do update
  set name = excluded.name, description = excluded.description, audience = excluded.audience,
      benefits = excluded.benefits, tutorial = excluded.tutorial, status = excluded.status;

-- ---------------------------------------------------------------------
-- 9. Demos: expenses, mobile-money services, checked payments, follow-ups
-- ---------------------------------------------------------------------
create or replace function public.demo_seed_stage13(p_company uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_level public.business_level;
  v_x numeric;
  v_month date;
  v_cat jsonb := '{}'::jsonb;
  k int;
  q record;
begin
  select business_level into v_level from public.companies where id = p_company and is_demo;
  if v_level is null then return; end if;
  v_x := case v_level when 'small' then 1 when 'medium' then 4 else 15 end;
  select jsonb_object_agg(name, id) into v_cat from public.expense_categories where company_id = p_company;
  if v_cat is null then return; end if;

  perform set_config('ims.demo_seed', 'on', true);
  update public.companies
     set mobile_money_details = case v_level
           when 'small' then 'M-Pesa Lipa namba 5512 334 (Neema General Supplies)' || chr(10) || 'Mixx by Yas Lipa namba 1478 220'
           else 'M-Pesa Lipa namba 5590 112' || chr(10) || 'Airtel Money Lipa namba 1890 455' end
   where id = p_company;
  perform set_config('ims.demo_seed', 'off', true);

  -- Three months of the usual spending.
  for k in 0..2 loop
    v_month := (date_trunc('month', v_today) - make_interval(months => k))::date;
    insert into public.expenses (company_id, category_id, spent_on, payee, description, amount, vat_amount, method, provider, reference)
    values
      (p_company, (v_cat ->> 'Rent')::uuid, v_month, 'Mzee Juma (landlord)', 'Shop and store rent', 450000 * v_x, 0,
       'bank_transfer', null, 'TRF' || to_char(v_month, 'YYMM') || '01'),
      (p_company, (v_cat ->> 'Salaries & wages')::uuid, v_month + 27, null, 'Staff wages', 1200000 * v_x, 0,
       'bank_transfer', null, 'SAL' || to_char(v_month, 'YYMM')),
      (p_company, (v_cat ->> 'Electricity & water')::uuid, v_month + 4, 'TANESCO', 'LUKU electricity tokens', 85000 * v_x, 12966 * v_x,
       'mobile_money', 'mpesa', 'SD' || to_char(v_month, 'YYMM') || 'LK45'),
      (p_company, (v_cat ->> 'Phone & internet')::uuid, v_month + 6, 'Vodacom', 'Airtime and internet bundles', 60000 * v_x, 0,
       'mobile_money', 'mpesa', 'SD' || to_char(v_month, 'YYMM') || 'VB12'),
      (p_company, (v_cat ->> 'Transport & fuel')::uuid, v_month + 9, 'Puma Energy Mwenge', 'Fuel for deliveries', 150000 * v_x, 0,
       'mobile_money', 'tigopesa', 'MP' || to_char(v_month, 'YYMMDD') || '.1130.F' || k),
      (p_company, (v_cat ->> 'Transport & fuel')::uuid, v_month + 19, 'Bajaji rider', 'Delivery to Kariakoo', 25000 * v_x, 0,
       'cash', null, null),
      (p_company, (v_cat ->> 'Bank & mobile-money charges')::uuid, v_month + 25, 'CRDB Bank', 'Monthly bank charges', 18000 * v_x, 0,
       'bank_transfer', null, null),
      (p_company, (v_cat ->> 'Office supplies')::uuid, v_month + 12, 'Kariakoo Stationers', 'Receipt books, paper and toner', 64000 * v_x, 0,
       'cash', null, null);
  end loop;
  insert into public.expenses (company_id, category_id, spent_on, payee, description, amount, method, provider, reference)
  values (p_company, (v_cat ->> 'Taxes, licences & fees')::uuid, v_today - 40, 'Kinondoni Municipal Council', 'Business licence renewal',
          300000 * v_x, 'bank_transfer', null, 'TRF-LIC-' || to_char(v_today - 40, 'YYMMDD')),
         (p_company, (v_cat ->> 'Repairs & maintenance')::uuid, v_today - 9, 'Fundi Hamisi', 'Fixed the store door lock', 45000 * v_x,
          'mobile_money', 'airtel_money', 'CI' || to_char(v_today - 9, 'YYMMDD') || '.1422.H55120');
  -- Future months are not spending yet.
  delete from public.expenses where company_id = p_company and spent_on > v_today;
  update public.expenses
     set created_at = least((spent_on + time '16:00') at time zone 'Africa/Dar_es_Salaam', now())
   where company_id = p_company;

  -- Mobile-money services on the demo payments, and last month's money checked.
  perform set_config('ims.status_change', 'on', true);
  update public.payments set provider = case when abs(hashtext(id::text)::bigint) % 3 = 0 then 'tigopesa' else 'mpesa' end
   where company_id = p_company and method = 'mobile_money' and provider is null;
  update public.supplier_payments set provider = 'mpesa'
   where company_id = p_company and method = 'mobile_money' and provider is null;
  update public.payments set reconciled_at = now()
   where company_id = p_company and received_on < date_trunc('month', v_today)::date;
  update public.supplier_payments set reconciled_at = now()
   where company_id = p_company and paid_on < date_trunc('month', v_today)::date;
  update public.expenses set reconciled_at = now()
   where company_id = p_company and spent_on < date_trunc('month', v_today)::date and method <> 'cash';
  perform set_config('ims.status_change', 'off', true);

  -- A follow-up already logged on the oldest quotation waiting for an answer.
  select id, created_by into q from public.quotations
   where company_id = p_company and status = 'sent' order by sent_at nulls last limit 1;
  if q.id is not null then
    insert into public.followups (company_id, quotation_id, channel, note, next_on, created_by, created_at)
    values (p_company, q.id, 'call', 'Spoke to the buyer: waiting for their manager''s approval. Call again next week.',
            v_today + 5, q.created_by, now() - interval '2 days');
  end if;
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

  v_id := case v_level
            when 'small' then public.demo_seed_small()
            when 'enterprise' then public.demo_seed_enterprise()
            else public.demo_seed_medium()
          end;
  perform public.demo_seed_stage13(v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
revoke execute on function
  public.mobile_money_providers(),
  public.default_expense_categories(),
  public.add_expense_categories(),
  public.prepare_expense(),
  public.can_use_receipt(text, boolean),
  public.add_receipts_cleanup(),
  public.delete_demo_company(uuid),
  public.guard_bank_details(),
  public.record_payment(uuid, date, numeric, text, text, numeric, text, text),
  public.pay_supplier_bill(uuid, date, numeric, text, text, numeric, text, text),
  public.void_expense(uuid, text),
  public.log_followup(uuid, uuid, text, text, date),
  public.set_reconciled(uuid, text, uuid[], boolean),
  public.match_statement(uuid, text, date, date, text),
  public.run_company_alerts(uuid),
  public.reset_company_transactions(uuid, text),
  public.demo_seed_stage13(uuid),
  public.create_demo_company(public.business_level),
  public.assign_doc_number()
from public, anon;
revoke execute on function
  public.add_expense_categories(),
  public.prepare_expense(),
  public.add_receipts_cleanup(),
  public.delete_demo_company(uuid),
  public.guard_bank_details(),
  public.run_company_alerts(uuid),
  public.reset_company_transactions(uuid, text),
  public.demo_seed_stage13(uuid)
from authenticated;
grant execute on function
  public.mobile_money_providers(),
  public.default_expense_categories(),
  public.can_use_receipt(text, boolean),
  public.record_payment(uuid, date, numeric, text, text, numeric, text, text),
  public.pay_supplier_bill(uuid, date, numeric, text, text, numeric, text, text),
  public.void_expense(uuid, text),
  public.log_followup(uuid, uuid, text, text, date),
  public.set_reconciled(uuid, text, uuid[], boolean),
  public.match_statement(uuid, text, date, date, text),
  public.create_demo_company(public.business_level)
to authenticated;

notify pgrst, 'reload schema';
