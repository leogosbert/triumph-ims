-- =====================================================================
-- Getting paid (1 of 3): TRA fiscal receipts (EFD / VFD) and credit notes.
--
--   fiscal_settings   per company: manual (the receipt comes from the
--                     company's own EFD machine and staff type its number
--                     and verification code) or VFD (the app posts each
--                     invoice to TRA's Virtual Fiscal Device API itself),
--                     the TIN, the certificate serial and, after TRA has
--                     registered the company, the registration details and
--                     the receipt counters.
--   fiscal_secrets    the username, password and token TRA gives at
--                     registration. Only the server (service role) reads
--                     them; nobody in the app can, and backups skip them.
--   fiscal_receipts   one fiscal receipt per issued invoice (and one per
--                     credit note): number, Z number, verification code,
--                     time, the TRA verification link printed as a QR code,
--                     and the retry queue for VFD posts that failed.
--   fiscal_zreports   VFD mode: the daily Z report sent to TRA.
--   credit_notes      a credit note reduces what the client owes on an
--                     issued invoice (CN- numbers). It is kept as a
--                     settlement of the invoice (method credit_note, like a
--                     withholding tax certificate) so balances, statements
--                     and the books stay right: the books reverse the sale
--                     and its VAT.
--
-- When an invoice is issued (and the company has saved its TRA settings),
-- a receipt row is opened: in VFD mode it is queued for the server job
-- (/api/money/cron, every 15 minutes, and straight away from the invoice
-- screen); in manual mode it waits for staff to type the EFD receipt.
--
-- Who: management saves the settings; management and finance enter receipts,
-- retry posts and issue credit notes; cancelling a credit note is management
-- only. Management, finance and sales see receipts and credit notes (they see
-- invoices too).
--
-- NOT VERIFIED AGAINST A REAL TRA SERVICE: the VFD message layout, the tax
-- codes, the Z report and the verification link format follow TRA's VFD API
-- specification as we understand it. Test with TRA's test service first
-- (environment = test) and confirm with TRA before going live.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Feature
-- ---------------------------------------------------------------------
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('tra_fiscal', 'TRA fiscal receipts (EFD / VFD)',
 'Every issued invoice gets its TRA fiscal receipt: type the receipt number and verification code from your EFD machine, or let the app post it to TRA (VFD). The verification QR code is printed on the invoice, failed posts are retried, daily totals (Z report) and credit notes are kept.',
 'Finance', 'small', 'live', 'Every company that must issue TRA fiscal receipts (EFD or VFD).',
 'Invoices that carry their TRA receipt and QR code, nothing forgotten, and daily totals ready for the tax return.',
 '[{"title": "Choose how you issue receipts", "body": "Open Getting paid, then TRA receipts. Keep Manual if you use an EFD machine: after issuing an invoice, type the receipt number and verification code from the EFD receipt."},
   {"title": "The QR code on the invoice", "body": "The invoice and its PDF show the TRA receipt and a QR code clients scan to check it on the TRA website."},
   {"title": "Corrections", "body": "Never change an issued invoice: issue a credit note for the part that was wrong. The balance, the books and the daily totals follow."}]'::jsonb,
 '/getting-paid/tra', 56)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Settings and secrets
-- ---------------------------------------------------------------------
create or replace function public.fiscal_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Africa/Dar_es_Salaam')::date; $$;

create table if not exists public.fiscal_settings (
  company_id      uuid primary key references public.companies (id) on delete cascade,
  mode            text not null default 'manual' check (mode in ('manual', 'vfd')),
  environment     text not null default 'test' check (environment in ('test', 'live')),
  tin             text check (tin is null or tin ~ '^[0-9]{9}$'),
  vrn             text check (vrn is null or char_length(vrn) <= 20),
  -- The serial number of the certificate TRA issued (sent, base64, in the Cert-Serial header) and the
  -- VFD serial / certificate key TRA gave with it (e.g. 10TZ101807: CERTKEY and EFDSERIAL in the messages).
  cert_serial     text check (cert_serial is null or char_length(cert_serial) <= 100),
  vfd_serial      text check (vfd_serial is null or vfd_serial ~ '^[A-Za-z0-9-]{4,40}$'),
  -- Tax code for invoices without VAT: 3 = C (zero rated), 4 = D (special relief), 5 = E (exempt).
  zero_tax_code   smallint not null default 5 check (zero_tax_code in (3, 4, 5)),
  verify_base     text not null default 'https://verify.tra.go.tz'
                  check (verify_base ~ '^https://[a-z0-9.-]+\.go\.tz(/[A-Za-z0-9/_-]*)?$'),
  -- From TRA's registration answer (VFD mode).
  reg_id          text check (reg_id is null or char_length(reg_id) <= 60),
  uin             text check (uin is null or char_length(uin) <= 100),
  receipt_code    text check (receipt_code is null or receipt_code ~ '^[A-Za-z0-9]{1,20}$'),
  tax_office      text check (tax_office is null or char_length(tax_office) <= 100),
  routing_key     text check (routing_key is null or char_length(routing_key) <= 60),
  registered_at   timestamptz,
  -- Receipt counters (VFD): the last global number used, and the day counter of counter_day.
  global_counter  bigint not null default 0 check (global_counter >= 0),
  day_counter     integer not null default 0 check (day_counter >= 0),
  counter_day     date,
  updated_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists public.fiscal_secrets (
  company_id        uuid primary key references public.companies (id) on delete cascade,
  vfd_username      text,
  vfd_password      text,
  access_token      text,
  token_expires_at  timestamptz,
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. Credit notes and fiscal receipts
-- ---------------------------------------------------------------------
-- A credit note settles part of an invoice like a withholding tax certificate does.
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments add constraint payments_method_check
  check (method in ('bank_transfer', 'cash', 'mobile_money', 'cheque', 'withholding_tax', 'credit_note', 'other'));

create table if not exists public.credit_notes (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  number            text not null,
  invoice_id        uuid not null,
  payment_id        uuid references public.payments (id) on delete cascade,
  issued_on         date not null default public.fiscal_today(),
  amount            numeric(18, 2) not null check (amount > 0),
  vat_amount        numeric(18, 2) not null default 0 check (vat_amount >= 0),
  reason            text not null check (char_length(btrim(reason)) between 2 and 300),
  status            text not null default 'issued' check (status in ('issued', 'cancelled')),
  cancelled_reason  text check (cancelled_reason is null or char_length(cancelled_reason) <= 300),
  cancelled_at      timestamptz,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  foreign key (invoice_id, company_id) references public.invoices (id, company_id) on delete cascade
);
create index if not exists credit_notes_invoice_idx on public.credit_notes (invoice_id);

create table if not exists public.fiscal_receipts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  invoice_id         uuid not null,
  credit_note_id     uuid references public.credit_notes (id) on delete cascade,
  kind               text not null default 'receipt' check (kind in ('receipt', 'credit_note')),
  mode               text not null check (mode in ('manual', 'vfd')),
  -- pending: waiting for staff to type the EFD receipt; queued / posting / failed: the VFD queue;
  -- posted: TRA accepted it; recorded: typed by staff; void: no longer needed.
  status             text not null default 'pending' check (status in ('pending', 'queued', 'posting', 'posted', 'failed', 'recorded', 'void')),
  receipt_no         text check (receipt_no is null or char_length(receipt_no) <= 40),
  z_number           text check (z_number is null or char_length(z_number) <= 20),
  gc                 bigint,
  dc                 integer,
  verification_code  text check (verification_code is null or verification_code ~ '^[A-Za-z0-9]{4,40}$'),
  receipt_at         timestamptz,
  verify_url         text check (verify_url is null or verify_url ~ '^https://[a-z0-9.-]+\.go\.tz/'),
  -- Amounts in Tanzanian shillings, as TRA receives them.
  total_excl         numeric(18, 2) not null default 0,
  vat_amount         numeric(18, 2) not null default 0,
  total_incl         numeric(18, 2) not null default 0,
  attempts           integer not null default 0,
  next_attempt_at    timestamptz,
  claimed_at         timestamptz,
  last_error         text check (last_error is null or char_length(last_error) <= 500),
  ack_code           text check (ack_code is null or char_length(ack_code) <= 20),
  ack_message        text check (ack_message is null or char_length(ack_message) <= 300),
  posted_at          timestamptz,
  void_reason        text check (void_reason is null or char_length(void_reason) <= 300),
  entered_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, company_id),
  check ((kind = 'credit_note') = (credit_note_id is not null)),
  foreign key (invoice_id, company_id) references public.invoices (id, company_id) on delete cascade
);
create unique index if not exists fiscal_receipts_invoice_key on public.fiscal_receipts (invoice_id)
  where kind = 'receipt' and status <> 'void';
create unique index if not exists fiscal_receipts_credit_key on public.fiscal_receipts (credit_note_id)
  where credit_note_id is not null and status <> 'void';
create unique index if not exists fiscal_receipts_gc_key on public.fiscal_receipts (company_id, gc) where gc is not null;
create index if not exists fiscal_receipts_queue_idx on public.fiscal_receipts (next_attempt_at) where status in ('queued', 'posting', 'failed');
create index if not exists fiscal_receipts_company_idx on public.fiscal_receipts (company_id, receipt_at desc);

create table if not exists public.fiscal_zreports (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  z_day            date not null,
  status           text not null default 'queued' check (status in ('queued', 'posting', 'posted', 'failed')),
  receipts         integer not null default 0,
  total_excl       numeric(18, 2) not null default 0,
  vat_amount       numeric(18, 2) not null default 0,
  total_incl       numeric(18, 2) not null default 0,
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  claimed_at       timestamptz,
  last_error       text check (last_error is null or char_length(last_error) <= 500),
  ack_code         text,
  posted_at        timestamptz,
  created_at       timestamptz not null default now(),
  unique (company_id, z_day)
);

-- ---------------------------------------------------------------------
-- 3. Row-level security and grants: read only; every change is a function.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['fiscal_settings', 'fiscal_secrets', 'fiscal_receipts', 'fiscal_zreports', 'credit_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
  end loop;
  foreach t in array array['fiscal_settings', 'fiscal_receipts', 'fiscal_zreports', 'credit_notes'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
  end loop;
  foreach t in array array['fiscal_settings', 'fiscal_receipts'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['fiscal_settings', 'fiscal_receipts', 'credit_notes'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

grant select on public.fiscal_settings, public.fiscal_receipts, public.fiscal_zreports, public.credit_notes to authenticated;
create policy fiscal_settings_select on public.fiscal_settings for select to authenticated
  using (public.has_role(company_id, public.finance_roles()));
create policy fiscal_zreports_select on public.fiscal_zreports for select to authenticated
  using (public.has_role(company_id, public.finance_roles()));
create policy fiscal_receipts_select on public.fiscal_receipts for select to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'sales']::public.app_role[]));
create policy credit_notes_select on public.credit_notes for select to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'sales']::public.app_role[]));
-- fiscal_secrets: no policy and no grant for anyone in the app (the server uses the service role).

-- ---------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------
-- The TRA verification link: <base>/<verification code>_<HHMMSS of the receipt time>.
create or replace function public.fiscal_verify_url(p_base text, p_code text, p_at timestamptz)
returns text language sql stable set search_path = ''
as $$
  select case when coalesce(p_code, '') = '' then null
              else rtrim(coalesce(nullif(p_base, ''), 'https://verify.tra.go.tz'), '/') || '/' || p_code
                   || coalesce('_' || to_char(p_at at time zone 'Africa/Dar_es_Salaam', 'HH24MISS'), '') end;
$$;

-- Opens the receipt of an issued invoice (internal; never fails the invoice).
create or replace function public.fiscal_open_for_invoice(p_invoice uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  inv public.invoices;
  s   public.fiscal_settings;
  v_id uuid;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.status not in ('issued', 'partly_paid', 'paid') then
    return null;
  end if;
  select * into s from public.fiscal_settings where company_id = inv.company_id;
  if s.company_id is null or not public.feature_on(inv.company_id, 'tra_fiscal') then
    return null;
  end if;
  insert into public.fiscal_receipts (company_id, invoice_id, kind, mode, status, total_excl, vat_amount, total_incl, next_attempt_at)
  values (inv.company_id, inv.id, 'receipt', s.mode,
          case when s.mode = 'vfd' and s.reg_id is not null then 'queued' else 'pending' end,
          round(inv.subtotal * inv.exchange_rate, 2), round(inv.vat_amount * inv.exchange_rate, 2),
          round(inv.total * inv.exchange_rate, 2), now())
  on conflict do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.fiscal_on_invoice()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'issued' then
    begin
      perform public.fiscal_open_for_invoice(new.id);
    exception when others then
      raise warning 'Fiscal receipt not opened for invoice %: %', new.id, sqlerrm;
    end;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    -- Not sent yet: nothing for TRA. A receipt TRA already has stays (a credit note corrects it).
    update public.fiscal_receipts set status = 'void', void_reason = 'Invoice cancelled'
     where invoice_id = new.id and status in ('pending', 'queued', 'failed');
  end if;
  return null;
end;
$$;
drop trigger if exists invoices_fiscal on public.invoices;
create trigger invoices_fiscal after update of status on public.invoices
  for each row execute function public.fiscal_on_invoice();

-- ---------------------------------------------------------------------
-- 5. Actions in the app
-- ---------------------------------------------------------------------
-- Management saves how the company issues receipts. Changing the TIN or the certificate after TRA
-- registered the company clears the registration (it must be done again).
create or replace function public.fiscal_save_settings(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  s       public.fiscal_settings;
  v_mode  text := coalesce(nullif(p ->> 'mode', ''), 'manual');
  v_env   text := coalesce(nullif(p ->> 'environment', ''), 'test');
  v_tin   text := nullif(regexp_replace(coalesce(p ->> 'tin', ''), '[^0-9]', '', 'g'), '');
  v_cert  text := nullif(btrim(coalesce(p ->> 'cert_serial', '')), '');
  v_vfd   text := nullif(upper(btrim(coalesce(p ->> 'vfd_serial', ''))), '');
  v_zero  smallint := coalesce(nullif(p ->> 'zero_tax_code', '')::smallint, 5);
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can change the TRA settings.' using errcode = '42501';
  end if;
  if v_mode not in ('manual', 'vfd') then raise exception 'Choose manual or VFD.' using errcode = '22023'; end if;
  if v_env not in ('test', 'live') then raise exception 'Choose test or live.' using errcode = '22023'; end if;
  if v_tin is not null and v_tin !~ '^[0-9]{9}$' then
    raise exception 'A TIN has 9 digits (e.g. 123-456-789).' using errcode = '22023';
  end if;
  if v_mode = 'vfd' and (v_tin is null or v_cert is null or v_vfd is null) then
    raise exception 'VFD needs the company TIN, the certificate serial and the VFD serial (certificate key) from TRA.' using errcode = '22023';
  end if;
  if v_vfd is not null and v_vfd !~ '^[A-Z0-9-]{4,40}$' then
    raise exception 'The VFD serial is letters and numbers (e.g. 10TZ101807).' using errcode = '22023';
  end if;
  select * into s from public.fiscal_settings where company_id = p_company for update;
  if s.company_id is null then
    insert into public.fiscal_settings (company_id, mode, environment, tin, vrn, cert_serial, vfd_serial, zero_tax_code, updated_by)
    values (p_company, v_mode, v_env, v_tin, nullif(btrim(coalesce(p ->> 'vrn', '')), ''), v_cert, v_vfd, v_zero, auth.uid());
  else
    update public.fiscal_settings
       set mode = v_mode, environment = v_env, tin = v_tin, vrn = nullif(btrim(coalesce(p ->> 'vrn', '')), ''),
           cert_serial = v_cert, vfd_serial = v_vfd, zero_tax_code = v_zero, updated_by = auth.uid(),
           reg_id = case when (v_tin, v_cert, v_vfd, v_env) is distinct from (s.tin, s.cert_serial, s.vfd_serial, s.environment) then null else reg_id end,
           registered_at = case when (v_tin, v_cert, v_vfd, v_env) is distinct from (s.tin, s.cert_serial, s.vfd_serial, s.environment) then null else registered_at end
     where company_id = p_company;
    if (v_tin, v_cert, v_vfd, v_env) is distinct from (s.tin, s.cert_serial, s.vfd_serial, s.environment) then
      delete from public.fiscal_secrets where company_id = p_company;
    end if;
  end if;
end;
$$;

-- Staff type the receipt from the EFD machine (or the QR link they scanned) for an issued invoice,
-- or for a credit note. Typing again corrects it, unless TRA already accepted a VFD receipt.
create or replace function public.fiscal_record_manual(p_invoice uuid, p_credit_note uuid, p_receipt_no text, p_code text,
                                                       p_receipt_at timestamptz, p_z_number text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  inv     public.invoices;
  cn      public.credit_notes;
  s       public.fiscal_settings;
  r       public.fiscal_receipts;
  v_kind  text := case when p_credit_note is null then 'receipt' else 'credit_note' end;
  v_code  text := btrim(coalesce(p_code, ''));
  v_url   text;
  v_id    uuid;
  v_excl  numeric;
  v_vat   numeric;
  v_incl  numeric;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or not public.has_role(inv.company_id, public.finance_roles()) then
    raise exception 'Invoice not found.' using errcode = '42501';
  end if;
  if inv.status not in ('issued', 'partly_paid', 'paid') then
    raise exception 'Only issued invoices get a fiscal receipt.' using errcode = '22023';
  end if;
  if p_credit_note is not null then
    select * into cn from public.credit_notes where id = p_credit_note and invoice_id = p_invoice and status = 'issued';
    if cn.id is null then raise exception 'Credit note not found.' using errcode = '22023'; end if;
  end if;
  -- A scanned TRA link: keep the link, take the code from it.
  if v_code ~* '^https?://' then
    if v_code !~* '^https://([a-z0-9-]+\.)*tra\.go\.tz/' then
      raise exception 'That link is not a TRA verification link (it must be on tra.go.tz).' using errcode = '22023';
    end if;
    v_url := left(v_code, 300);
    v_code := substring(v_code from '^https://[^/]+/([A-Za-z0-9]{4,40})');
  end if;
  v_code := upper(v_code);
  if v_code is null or v_code !~ '^[A-Z0-9]{4,40}$' then
    raise exception 'Type the verification code printed on the EFD receipt (letters and numbers).' using errcode = '22023';
  end if;
  if coalesce(btrim(p_receipt_no), '') = '' then
    raise exception 'Type the receipt number.' using errcode = '22023';
  end if;
  select * into s from public.fiscal_settings where company_id = inv.company_id;
  v_url := coalesce(v_url, public.fiscal_verify_url(s.verify_base, v_code, p_receipt_at));
  if p_credit_note is null then
    v_excl := round(inv.subtotal * inv.exchange_rate, 2);
    v_vat := round(inv.vat_amount * inv.exchange_rate, 2);
    v_incl := round(inv.total * inv.exchange_rate, 2);
  else
    v_incl := -round(cn.amount * inv.exchange_rate, 2);
    v_vat := -round(cn.vat_amount * inv.exchange_rate, 2);
    v_excl := v_incl - v_vat;
  end if;

  select * into r from public.fiscal_receipts
   where invoice_id = p_invoice and kind = v_kind and credit_note_id is not distinct from p_credit_note and status <> 'void'
   for update;
  if r.id is not null and r.status in ('posted', 'posting') then
    raise exception 'TRA already has this receipt from the app; it cannot be typed over.' using errcode = '22023';
  end if;
  if r.id is null then
    insert into public.fiscal_receipts (company_id, invoice_id, credit_note_id, kind, mode, status, receipt_no, z_number,
                                        verification_code, receipt_at, verify_url, total_excl, vat_amount, total_incl, entered_by)
    values (inv.company_id, p_invoice, p_credit_note, v_kind, 'manual', 'recorded', left(btrim(p_receipt_no), 40),
            nullif(left(btrim(coalesce(p_z_number, '')), 20), ''), v_code, coalesce(p_receipt_at, now()), v_url,
            v_excl, v_vat, v_incl, auth.uid())
    returning id into v_id;
  else
    update public.fiscal_receipts
       set mode = 'manual', status = 'recorded', receipt_no = left(btrim(p_receipt_no), 40),
           z_number = nullif(left(btrim(coalesce(p_z_number, '')), 20), ''), verification_code = v_code,
           receipt_at = coalesce(p_receipt_at, now()), verify_url = v_url, total_excl = v_excl, vat_amount = v_vat,
           total_incl = v_incl, entered_by = auth.uid(), last_error = null, next_attempt_at = null
     where id = r.id
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

-- Opens the receipt of an invoice issued before the settings were saved (or after a void).
create or replace function public.fiscal_start(p_invoice uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
  v_id uuid;
begin
  select company_id into v_company from public.invoices where id = p_invoice;
  if v_company is null or not public.has_role(v_company, public.finance_roles()) then
    raise exception 'Invoice not found.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fiscal_settings where company_id = v_company) then
    raise exception 'Save the TRA settings first (Getting paid, then TRA receipts).' using errcode = '22023';
  end if;
  v_id := public.fiscal_open_for_invoice(p_invoice);
  if v_id is null then
    select id into v_id from public.fiscal_receipts where invoice_id = p_invoice and kind = 'receipt' and status <> 'void';
  end if;
  return v_id;
end;
$$;

-- Sends a failed VFD post again (straight away).
create or replace function public.fiscal_retry(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.fiscal_receipts;
begin
  select * into r from public.fiscal_receipts where id = p_id for update;
  if r.id is null or not public.has_role(r.company_id, public.finance_roles()) then
    raise exception 'Receipt not found.' using errcode = '42501';
  end if;
  if r.mode <> 'vfd' or r.status not in ('failed', 'queued') then
    raise exception 'Only a VFD receipt waiting to be sent can be retried.' using errcode = '22023';
  end if;
  update public.fiscal_receipts set status = 'queued', next_attempt_at = now(), claimed_at = null where id = p_id;
end;
$$;

-- Credit note: reduces what is still owed on an issued invoice (never more than that). The VAT part
-- is in proportion to the invoice. The fiscal receipt of the credit note is then typed in (manual),
-- like the invoice's.
create or replace function public.issue_credit_note(p_invoice uuid, p_amount numeric, p_reason text, p_issued_on date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  inv     public.invoices;
  v_open  numeric;
  v_amt   numeric := round(coalesce(p_amount, 0), 2);
  v_year  text := to_char(coalesce(p_issued_on, public.fiscal_today()), 'YYYY');
  v_no    text;
  v_pay   uuid;
  v_id    uuid;
  v_vat   numeric;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.id is null or not public.has_role(inv.company_id, public.finance_roles()) then
    raise exception 'Invoice not found.' using errcode = '42501';
  end if;
  if inv.status not in ('issued', 'partly_paid') then
    raise exception 'A credit note can only reduce what is still owed on an issued invoice.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give the reason for the credit note.' using errcode = '22023'; end if;
  if v_amt <= 0 then raise exception 'Enter the amount of the credit note.' using errcode = '22023'; end if;
  v_open := inv.total - inv.amount_paid;
  if v_amt > v_open then
    raise exception 'Only % % is still owed on this invoice. To give back money already paid, void the payment first.',
      inv.currency, to_char(v_open, 'FM999,999,999,990.00') using errcode = '22023';
  end if;
  v_vat := case when inv.total > 0 then round(v_amt * inv.vat_amount / inv.total, 2) else 0 end;
  v_no := public.next_code(inv.company_id, 'credit_notes-' || v_year, 'CN-' || v_year || '-', 4);

  insert into public.payments (company_id, invoice_id, client_id, received_on, amount, currency, exchange_rate, method,
                               reference, notes, reconciled_at, reconciled_by)
  values (inv.company_id, p_invoice, inv.client_id, coalesce(p_issued_on, public.fiscal_today()), v_amt, inv.currency,
          inv.exchange_rate, 'credit_note', v_no, left('Credit note: ' || btrim(p_reason), 300), now(), auth.uid())
  returning id into v_pay;

  perform set_config('ims.status_change', 'on', true);
  update public.invoices
     set amount_paid = amount_paid + v_amt,
         status = case when amount_paid + v_amt >= total then 'paid' else 'partly_paid' end
   where id = p_invoice;
  perform set_config('ims.status_change', 'off', true);

  insert into public.credit_notes (company_id, number, invoice_id, payment_id, issued_on, amount, vat_amount, reason)
  values (inv.company_id, v_no, p_invoice, v_pay, coalesce(p_issued_on, public.fiscal_today()), v_amt, v_vat, btrim(p_reason))
  returning id into v_id;

  if exists (select 1 from public.fiscal_settings where company_id = inv.company_id) and public.feature_on(inv.company_id, 'tra_fiscal') then
    insert into public.fiscal_receipts (company_id, invoice_id, credit_note_id, kind, mode, status, total_excl, vat_amount, total_incl)
    values (inv.company_id, p_invoice, v_id, 'credit_note', 'manual', 'pending',
            -round((v_amt - v_vat) * inv.exchange_rate, 2), -round(v_vat * inv.exchange_rate, 2), -round(v_amt * inv.exchange_rate, 2))
    on conflict do nothing;
  end if;
  return v_id;
end;
$$;

-- Management takes a credit note back (it was a mistake): the invoice is owed again.
create or replace function public.cancel_credit_note(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  cn public.credit_notes;
  pm public.payments;
begin
  select * into cn from public.credit_notes where id = p_id for update;
  if cn.id is null or not public.is_manager(cn.company_id) then
    raise exception 'Only management can cancel a credit note.' using errcode = '42501';
  end if;
  if cn.status = 'cancelled' then return; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Give a reason.' using errcode = '22023'; end if;
  if exists (select 1 from public.fiscal_receipts where credit_note_id = p_id and status in ('posted', 'recorded')) then
    raise exception 'TRA already has this credit note. Issue a new invoice for the amount instead.' using errcode = '22023';
  end if;
  select * into pm from public.payments where id = cn.payment_id for update;
  if pm.id is not null and pm.voided_at is null then
    update public.payments set voided_at = now(), voided_by = auth.uid(), void_reason = left('Credit note cancelled: ' || btrim(p_reason), 300)
     where id = pm.id;
    perform set_config('ims.status_change', 'on', true);
    update public.invoices
       set amount_paid = amount_paid - pm.amount,
           status = case when amount_paid - pm.amount <= 0 then 'issued' else 'partly_paid' end
     where id = pm.invoice_id;
    perform set_config('ims.status_change', 'off', true);
  end if;
  update public.credit_notes set status = 'cancelled', cancelled_reason = btrim(p_reason), cancelled_at = now() where id = p_id;
  update public.fiscal_receipts set status = 'void', void_reason = 'Credit note cancelled' where credit_note_id = p_id and status <> 'void';
end;
$$;

-- Daily totals (what the Z reports show): receipts, credit notes, VAT, per day, in TZS.
create or replace function public.fiscal_daily_totals(p_company uuid, p_from date, p_to date)
returns table (day date, receipts integer, credit_notes integer, total_excl numeric, vat_amount numeric, total_incl numeric,
               typed integer, posted integer, waiting integer, failed integer, zreport_status text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management and finance can see the daily totals.' using errcode = '42501';
  end if;
  return query
  with r as (
    select (coalesce(f.receipt_at, f.created_at) at time zone 'Africa/Dar_es_Salaam')::date d, f.*
      from public.fiscal_receipts f
     where f.company_id = p_company and f.status <> 'void'
  )
  select r.d, count(*) filter (where r.kind = 'receipt' and r.status in ('posted', 'recorded'))::int,
         count(*) filter (where r.kind = 'credit_note' and r.status in ('posted', 'recorded'))::int,
         coalesce(sum(r.total_excl) filter (where r.status in ('posted', 'recorded')), 0),
         coalesce(sum(r.vat_amount) filter (where r.status in ('posted', 'recorded')), 0),
         coalesce(sum(r.total_incl) filter (where r.status in ('posted', 'recorded')), 0),
         count(*) filter (where r.status = 'recorded')::int,
         count(*) filter (where r.status = 'posted')::int,
         count(*) filter (where r.status in ('pending', 'queued', 'posting'))::int,
         count(*) filter (where r.status = 'failed')::int,
         (select z.status from public.fiscal_zreports z where z.company_id = p_company and z.z_day = r.d)
    from r
   where r.d between coalesce(p_from, public.fiscal_today() - 30) and coalesce(p_to, public.fiscal_today())
   group by r.d
   order by r.d desc;
end;
$$;

-- What needs attention (overview and invoice list).
create or replace function public.fiscal_summary(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management and finance can see this.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'set_up', exists (select 1 from public.fiscal_settings where company_id = p_company),
    'mode', (select mode from public.fiscal_settings where company_id = p_company),
    'registered', (select reg_id is not null from public.fiscal_settings where company_id = p_company),
    'to_type', (select count(*) from public.fiscal_receipts where company_id = p_company and status = 'pending'),
    'queued', (select count(*) from public.fiscal_receipts where company_id = p_company and status in ('queued', 'posting')),
    'failed', (select count(*) from public.fiscal_receipts where company_id = p_company and status = 'failed'),
    'without', (select count(*) from public.invoices i where i.company_id = p_company and i.status in ('issued', 'partly_paid', 'paid')
                   and not exists (select 1 from public.fiscal_receipts f where f.invoice_id = i.id and f.kind = 'receipt' and f.status <> 'void')
                   and i.issue_date >= coalesce((select (created_at at time zone 'Africa/Dar_es_Salaam')::date from public.fiscal_settings
                                                  where company_id = p_company), i.issue_date + 1)));
end;
$$;

-- ---------------------------------------------------------------------
-- 6. The server job (service role only)
-- ---------------------------------------------------------------------
-- Settings and secrets for the VFD adapter.
create or replace function public.fiscal_vfd_config(p_company uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('settings', to_jsonb(s), 'secrets', to_jsonb(x) - 'company_id',
                            'company', jsonb_build_object('name', c.name, 'legal_name', c.legal_name, 'address', c.address,
                                                          'phone', c.phone, 'vrn', c.vrn, 'tin', c.tin))
    from public.fiscal_settings s
    join public.companies c on c.id = s.company_id
    left join public.fiscal_secrets x on x.company_id = s.company_id
   where s.company_id = p_company;
$$;

-- TRA's registration answer: registration details, username/password and the first counter.
create or replace function public.fiscal_save_registration(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.fiscal_settings where company_id = p_company and mode = 'vfd') then
    raise exception 'This company is not set up for VFD.' using errcode = '22023';
  end if;
  update public.fiscal_settings
     set reg_id = nullif(p ->> 'reg_id', ''), uin = nullif(p ->> 'uin', ''), receipt_code = nullif(p ->> 'receipt_code', ''),
         vfd_serial = coalesce(nullif(upper(p ->> 'serial'), ''), vfd_serial),
         tax_office = nullif(p ->> 'tax_office', ''), routing_key = coalesce(nullif(p ->> 'routing_key', ''), 'vfdrct'),
         global_counter = greatest(global_counter, coalesce(nullif(p ->> 'gc', '')::bigint, 0)),
         registered_at = now()
   where company_id = p_company;
  insert into public.fiscal_secrets (company_id, vfd_username, vfd_password, access_token, token_expires_at, updated_at)
  values (p_company, p ->> 'username', p ->> 'password', null, null, now())
  on conflict (company_id) do update
    set vfd_username = excluded.vfd_username, vfd_password = excluded.vfd_password, access_token = null,
        token_expires_at = null, updated_at = now();
  -- Receipts that waited for the registration go to the queue.
  update public.fiscal_receipts set status = 'queued', next_attempt_at = now()
   where company_id = p_company and mode = 'vfd' and status = 'pending' and kind = 'receipt';
end;
$$;

create or replace function public.fiscal_save_token(p_company uuid, p_token text, p_expires_at timestamptz)
returns void language sql security definer set search_path = ''
as $$
  update public.fiscal_secrets set access_token = p_token, token_expires_at = p_expires_at, updated_at = now()
   where company_id = p_company;
$$;

-- Hands receipts (and yesterday's Z reports) to the server to post. A receipt gets its counters the first
-- time it is claimed and keeps them on every retry (TRA expects the numbers in order, without gaps).
create or replace function public.fiscal_claim(p_limit integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r       record;
  s       public.fiscal_settings;
  inv     public.invoices;
  cl      public.clients;
  v_jobs  jsonb := '[]'::jsonb;
  v_today date := public.fiscal_today();
  v_lines jsonb;
  v_phone text;
begin
  -- Yesterday's Z report for each registered VFD company that sent receipts that day.
  insert into public.fiscal_zreports (company_id, z_day, receipts, total_excl, vat_amount, total_incl)
  select f.company_id, (f.receipt_at at time zone 'Africa/Dar_es_Salaam')::date, count(*),
         sum(f.total_excl), sum(f.vat_amount), sum(f.total_incl)
    from public.fiscal_receipts f
    join public.fiscal_settings fs on fs.company_id = f.company_id and fs.mode = 'vfd' and fs.reg_id is not null
   where f.status = 'posted' and f.mode = 'vfd'
     and (f.receipt_at at time zone 'Africa/Dar_es_Salaam')::date < v_today
     and (f.receipt_at at time zone 'Africa/Dar_es_Salaam')::date >= v_today - 7
   group by 1, 2
  on conflict (company_id, z_day) do nothing;

  for r in
    select f.id from public.fiscal_receipts f
     join public.fiscal_settings fs on fs.company_id = f.company_id and fs.mode = 'vfd' and fs.reg_id is not null
    where f.mode = 'vfd' and f.kind = 'receipt'
      and ((f.status in ('queued', 'failed') and coalesce(f.next_attempt_at, now()) <= now() and f.attempts < 10)
           or (f.status = 'posting' and f.claimed_at < now() - interval '10 minutes'))
    order by f.gc nulls last, f.created_at
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update of f skip locked
  loop
    select * into s from public.fiscal_settings
     where company_id = (select company_id from public.fiscal_receipts where id = r.id) for update;
    -- Counters, once.
    if (select gc from public.fiscal_receipts where id = r.id) is null then
      if s.counter_day is distinct from v_today then
        s.day_counter := 0;
        s.counter_day := v_today;
      end if;
      s.global_counter := s.global_counter + 1;
      s.day_counter := s.day_counter + 1;
      update public.fiscal_settings set global_counter = s.global_counter, day_counter = s.day_counter, counter_day = s.counter_day
       where company_id = s.company_id;
      update public.fiscal_receipts
         set gc = s.global_counter, dc = s.day_counter, receipt_no = s.global_counter::text,
             z_number = to_char(v_today, 'YYYYMMDD'), verification_code = s.receipt_code || s.global_counter::text,
             receipt_at = now()
       where id = r.id;
    end if;
    update public.fiscal_receipts set status = 'posting', claimed_at = now() where id = r.id;

    select * into inv from public.invoices where id = (select invoice_id from public.fiscal_receipts where id = r.id);
    select * into cl from public.clients where id = inv.client_id;
    select public.inbox_phone_of(cc.phone) into v_phone from public.client_contacts cc
     where cc.client_id = cl.id and coalesce(cc.phone, '') <> ''
     order by (cc.kind = 'finance') desc, cc.created_at limit 1;
    select coalesce(jsonb_agg(jsonb_build_object('id', l.line_no, 'desc', l.description, 'qty', l.quantity,
                                                 'amount', round(l.line_total * (1 + inv.vat_rate / 100) * inv.exchange_rate, 2))
                              order by l.line_no), '[]'::jsonb)
      into v_lines from public.invoice_lines l where l.invoice_id = inv.id;
    v_jobs := v_jobs || jsonb_build_array(jsonb_build_object(
      'job', 'receipt',
      'receipt', (select to_jsonb(f) from public.fiscal_receipts f where f.id = r.id),
      'settings', to_jsonb(s),
      'invoice', jsonb_build_object('id', inv.id, 'number', inv.number, 'vat_rate', inv.vat_rate,
                                    'subtotal', round(inv.subtotal * inv.exchange_rate, 2),
                                    'vat_amount', round(inv.vat_amount * inv.exchange_rate, 2),
                                    'total', round(inv.total * inv.exchange_rate, 2),
                                    'discount', round(inv.discount_total * inv.exchange_rate, 2)),
      'client', jsonb_build_object('name', cl.name, 'tin', regexp_replace(coalesce(cl.tin, ''), '[^0-9]', '', 'g'), 'phone', v_phone),
      'lines', v_lines));
  end loop;

  for r in
    select z.id from public.fiscal_zreports z
     where (z.status in ('queued', 'failed') and z.next_attempt_at <= now() and z.attempts < 10)
        or (z.status = 'posting' and z.claimed_at < now() - interval '10 minutes')
     order by z.z_day
     limit 10
     for update skip locked
  loop
    update public.fiscal_zreports set status = 'posting', claimed_at = now() where id = r.id;
    v_jobs := v_jobs || jsonb_build_array((
      select jsonb_build_object('job', 'zreport', 'zreport', to_jsonb(z), 'settings', to_jsonb(s2),
                                'company', jsonb_build_object('name', c.name, 'address', c.address, 'phone', c.phone, 'vrn', c.vrn))
        from public.fiscal_zreports z
        join public.fiscal_settings s2 on s2.company_id = z.company_id
        join public.companies c on c.id = z.company_id
       where z.id = r.id));
  end loop;
  return v_jobs;
end;
$$;

-- The answer of TRA for a claimed receipt or Z report. Failures are retried later (2, 5, 15, 30, 60
-- minutes, then every 3 hours); after 10 tries management is told and it waits for Retry.
create or replace function public.fiscal_result(p_job text, p_id uuid, p_ok boolean, p_ack_code text, p_ack_message text, p_error text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.fiscal_receipts;
  s public.fiscal_settings;
  v_wait interval;
  v_inv text;
begin
  if p_job = 'zreport' then
    update public.fiscal_zreports
       set status = case when p_ok then 'posted' else 'failed' end,
           attempts = attempts + case when p_ok then 0 else 1 end,
           ack_code = left(p_ack_code, 20), last_error = case when p_ok then null else left(p_error, 500) end,
           posted_at = case when p_ok then now() end,
           next_attempt_at = now() + case when attempts < 3 then interval '15 minutes' else interval '3 hours' end
     where id = p_id;
    return;
  end if;
  select * into r from public.fiscal_receipts where id = p_id for update;
  if r.id is null then return; end if;
  select * into s from public.fiscal_settings where company_id = r.company_id;
  if p_ok then
    update public.fiscal_receipts
       set status = 'posted', posted_at = now(), ack_code = left(p_ack_code, 20), ack_message = left(p_ack_message, 300),
           last_error = null, verify_url = public.fiscal_verify_url(s.verify_base, r.verification_code, r.receipt_at)
     where id = p_id;
  else
    v_wait := case r.attempts when 0 then interval '2 minutes' when 1 then interval '5 minutes' when 2 then interval '15 minutes'
                              when 3 then interval '30 minutes' when 4 then interval '60 minutes' else interval '3 hours' end;
    update public.fiscal_receipts
       set status = 'failed', attempts = attempts + 1, ack_code = left(p_ack_code, 20), ack_message = left(p_ack_message, 300),
           last_error = left(coalesce(p_error, p_ack_message, 'Not accepted'), 500), next_attempt_at = now() + v_wait
     where id = p_id;
    if r.attempts + 1 >= 10 then
      select number into v_inv from public.invoices where id = r.invoice_id;
      perform public.notify_roles(r.company_id, public.finance_roles(), null, 'fiscal_failed', 'attention',
        'TRA receipt not sent: ' || coalesce(v_inv, ''), left(coalesce(p_error, p_ack_message, ''), 200),
        '/invoices/' || r.invoice_id, 'fiscal_failed:' || r.id);
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. The books: a credit note reverses the sale and its VAT (instead of money coming in).
--    gl_desired as the ledger update left it, with the credit-note case added to payments.
-- ---------------------------------------------------------------------
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
    if p.voided_at is null and p.method = 'credit_note' then
      -- Credit note: sales and VAT go down in proportion to the invoice, and so does what the client owes.
      select * into i from public.invoices where id = p.invoice_id;
      select business_type into v_type from public.companies where id = p.company_id;
      v_total := round(p.amount * i.exchange_rate, 2);
      v_vat := case when i.total > 0 then round(v_total * i.vat_amount / i.total, 2) else 0 end;
      v_net := v_total - v_vat;
      select coalesce(sum(l.line_total), 0),
             coalesce(sum(l.line_total) filter (where coalesce(pr.item_type, case when v_type = 'services' then 'service' else 'goods' end) <> 'goods'), 0)
        into v_lines, v_serv
        from public.invoice_lines l
        left join public.products pr on pr.id = l.product_id
       where l.invoice_id = p.invoice_id;
      v_s := case when v_lines > 0 then round(v_net * v_serv / v_lines, 2) else 0 end;
      v_ln := jsonb_build_array(
        jsonb_build_object('a', public.gl_acct(p.company_id, 'sales_goods'), 'd', v_net - v_s, 'cl', p.client_id, 't', 'Credit note ' || coalesce(p.reference, p.number)),
        jsonb_build_object('a', public.gl_acct(p.company_id, 'sales_services'), 'd', v_s, 'cl', p.client_id),
        jsonb_build_object('a', public.gl_acct(p.company_id, 'vat_output'), 'd', v_vat, 'cl', p.client_id),
        jsonb_build_object('a', public.gl_acct(p.company_id, 'receivable'), 'c', v_total, 'cl', p.client_id));
      return jsonb_build_object('company', p.company_id, 'date', p.received_on, 'memo', 'Credit note ' || coalesce(p.reference, p.number),
                                'ref', coalesce(p.reference, p.number), 'lines', v_ln);
    end if;
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

-- "Payment received" alerts as in Stage 7, but not for a credit note (no money came in).
create or replace function public.on_payment_received()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_client text;
  v_inv text;
  v_seller uuid;
begin
  if new.method = 'credit_note' then
    return null;
  end if;
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

-- ---------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.fiscal_today(), public.fiscal_verify_url(text, text, timestamptz), public.fiscal_open_for_invoice(uuid),
  public.fiscal_on_invoice(), public.fiscal_save_settings(uuid, jsonb),
  public.fiscal_record_manual(uuid, uuid, text, text, timestamptz, text), public.fiscal_start(uuid), public.fiscal_retry(uuid),
  public.issue_credit_note(uuid, numeric, text, date), public.cancel_credit_note(uuid, text),
  public.fiscal_daily_totals(uuid, date, date), public.fiscal_summary(uuid),
  public.fiscal_vfd_config(uuid), public.fiscal_save_registration(uuid, jsonb), public.fiscal_save_token(uuid, text, timestamptz),
  public.fiscal_claim(integer), public.fiscal_result(text, uuid, boolean, text, text, text),
  public.gl_desired(text, uuid)
from public, anon, authenticated;

grant execute on function
  public.fiscal_today(), public.fiscal_save_settings(uuid, jsonb),
  public.fiscal_record_manual(uuid, uuid, text, text, timestamptz, text), public.fiscal_start(uuid), public.fiscal_retry(uuid),
  public.issue_credit_note(uuid, numeric, text, date), public.cancel_credit_note(uuid, text),
  public.fiscal_daily_totals(uuid, date, date), public.fiscal_summary(uuid)
to authenticated;

-- Only the server job (service role key) talks to TRA and reads the secrets.
grant execute on function
  public.fiscal_today(), public.fiscal_vfd_config(uuid), public.fiscal_save_registration(uuid, jsonb),
  public.fiscal_save_token(uuid, text, timestamptz), public.fiscal_claim(integer),
  public.fiscal_result(text, uuid, boolean, text, text, text)
to service_role;

notify pgrst, 'reload schema';
