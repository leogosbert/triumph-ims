-- =====================================================================
-- Security hardening (security review of 2026-10-27). Safe to run more than once.
--
--   H1  The scheduled jobs' functions (outbox, backups, deletions, admin summary) are callable only by
--       the server role. The app's job routes now use SUPABASE_SERVICE_ROLE_KEY; OUTBOX_SECRET stays as a
--       second check. RUN THIS TOGETHER WITH THE APP UPDATE (the old app used the browser key).
--   M2  The same payment reference cannot be recorded twice on one invoice.
--   M3  The database itself refuses: receiving more than was ordered, and paying more than the total.
--       Receiving goods locks the purchase order and its lines.
--   M4  Inbox files: only usual document and picture types are stored as they are.
--   M5  AI minutes of meetings: at most 5 runs per meeting and 30 per company per day, counted here;
--       the long-meeting writer reads the brief the app stored here, not one sent with the request.
--   M6  Policies read auth.uid() once per query; indexes on company_id and on the links the rules use.
--   L2  Daily AI allowances and the admin billing dates use the Dar es Salaam date.
--   L3  Job, project, asset, hire, contract, HSE and NCR numbers are unique per company.
--   L4  Job sign-off files: only people who work on the job, not demo companies.
--   L6  "Send now" buttons send only the pressing company's TRA receipts and reminders.
-- =====================================================================

-- ---------------------------------------------------------------------
-- H1. Job functions: server role only
-- ---------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.run_all_alerts(text)', 'public.claim_outbox(text,integer)', 'public.drop_push_endpoints(text,text[])',
    'public.claim_company_backup(text)', 'public.take_claimed_backup(text,uuid)', 'public.check_overdue_backups(text)',
    'public.claim_due_deletion(text)', 'public.finish_deletion(text,text,uuid)', 'public.claim_account_emails(text,integer)',
    'public.run_platform_daily_summary(text)', 'public.claim_platform_outbox(text,integer)', 'public.verify_next_backup(text)']
  loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- M2. One payment reference once per invoice (spaces and capitals do not matter)
-- ---------------------------------------------------------------------
create or replace function public.payment_ref_key(p_ref text)
returns text language sql immutable set search_path = ''
as $$ select nullif(upper(regexp_replace(btrim(coalesce(p_ref, '')), '\s+', ' ', 'g')), '') $$;

do $$
begin
  if to_regclass('public.payments_invoice_reference_key') is null then
    if exists (select 1 from public.payments
                where reference is not null and voided_at is null and method <> 'credit_note'
                group by invoice_id, public.payment_ref_key(reference) having count(*) > 1) then
      raise notice 'payments_invoice_reference_key not created: some invoices already have the same reference twice. Void one of each pair, then run this file again.';
    else
      create unique index payments_invoice_reference_key
        on public.payments (invoice_id, public.payment_ref_key(reference))
        where reference is not null and voided_at is null and method <> 'credit_note';
    end if;
  end if;
end;
$$;

-- record_payment: as in 20261016000100_stage13_small_essentials.sql, plus the reference check.
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
  -- The same transfer typed twice (a double tap, or two people): refused, with a clear message.
  if public.payment_ref_key(p_reference) is not null and exists (
       select 1 from public.payments
        where invoice_id = p_invoice and voided_at is null and method <> 'credit_note'
          and public.payment_ref_key(reference) = public.payment_ref_key(p_reference)) then
    raise exception 'This payment reference is already recorded on this invoice.' using errcode = '22023';
  end if;

  begin
    insert into public.payments (company_id, invoice_id, client_id, received_on, amount, currency, exchange_rate, method,
                                 provider, reference, notes)
    values (inv.company_id, p_invoice, inv.client_id,
            coalesce(p_received_on, (now() at time zone 'Africa/Dar_es_Salaam')::date), round(p_amount, 2), inv.currency,
            coalesce(nullif(p_exchange_rate, 0), inv.exchange_rate), v_method,
            case when v_method = 'mobile_money' then nullif(p_provider, '') end,
            nullif(btrim(p_reference), ''), nullif(btrim(p_notes), ''))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This payment reference is already recorded on this invoice.' using errcode = '22023';
  end;

  perform set_config('ims.status_change', 'on', true);
  update public.invoices
     set amount_paid = amount_paid + round(p_amount, 2),
         status = case when amount_paid + round(p_amount, 2) >= total then 'paid' else 'partly_paid' end
   where id = p_invoice;
  perform set_config('ims.status_change', 'off', true);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- M3. Ceilings the database keeps itself
-- ---------------------------------------------------------------------
-- Added NOT VALID first (new and changed rows are always checked), then validated for the old rows.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.po_lines'::regclass and conname = 'po_lines_received_le_ordered') then
    alter table public.po_lines add constraint po_lines_received_le_ordered check (received_qty <= quantity) not valid;
  end if;
  begin
    alter table public.po_lines validate constraint po_lines_received_le_ordered;
  exception when check_violation then
    raise notice 'Some purchase-order lines were received above the ordered quantity; new receipts are still checked.';
  end;
  if not exists (select 1 from pg_constraint where conrelid = 'public.invoices'::regclass and conname = 'invoices_paid_le_total') then
    alter table public.invoices add constraint invoices_paid_le_total check (amount_paid <= total) not valid;
  end if;
  begin
    alter table public.invoices validate constraint invoices_paid_le_total;
  exception when check_violation then
    raise notice 'Some invoices are paid above their total; new payments are still checked.';
  end;
end;
$$;

-- receive_goods: as in 20261007000100_stage5_stock_deliveries.sql, with the purchase order and each line
-- locked while they are checked, so two receipts at the same moment run one after the other.
create or replace function public.receive_goods(p_po uuid, p_warehouse uuid, p_received_on date, p_supplier_dn text,
                                                p_notes text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  po public.purchase_orders;
  r jsonb;
  pl public.po_lines;
  v_grn uuid;
  v_qty numeric;
  v_count int := 0;
  v_open numeric;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if po.id is null or not public.has_role(po.company_id, array['management', 'warehouse', 'procurement']::public.app_role[]) then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;
  if po.status not in ('approved', 'sent', 'confirmed', 'partially_received') then
    raise exception 'Goods can only be received against an approved purchase order.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse and company_id = po.company_id and active) then
    raise exception 'Choose an active store.' using errcode = '22023';
  end if;

  insert into public.goods_receipts (company_id, po_id, warehouse_id, received_on, supplier_delivery_note, notes)
  values (po.company_id, p_po, p_warehouse,
          coalesce(p_received_on, (now() at time zone 'Africa/Dar_es_Salaam')::date),
          nullif(btrim(p_supplier_dn), ''), nullif(btrim(p_notes), ''))
  returning id into v_grn;

  perform set_config('ims.status_change', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := coalesce((r ->> 'quantity')::numeric, 0);
    continue when v_qty = 0;
    if v_qty < 0 then raise exception 'Quantities cannot be negative.' using errcode = '22023'; end if;
    select * into pl from public.po_lines where id = (r ->> 'po_line_id')::uuid and po_id = p_po for update;
    if pl.id is null then raise exception 'A line does not belong to this purchase order.' using errcode = '22023'; end if;
    v_open := pl.quantity - pl.received_qty;
    if v_qty > v_open then
      raise exception 'Line %: receiving % but only % still to come.', pl.line_no, trim_scale(v_qty), trim_scale(v_open) using errcode = '22023';
    end if;

    insert into public.grn_lines (company_id, grn_id, po_line_id, product_id, description, quantity, unit, batch_no,
                                  expiry_date, condition, note)
    values (po.company_id, v_grn, pl.id, pl.product_id, pl.description, v_qty, pl.unit,
            coalesce(btrim(r ->> 'batch_no'), ''), nullif(r ->> 'expiry_date', '')::date,
            coalesce(nullif(r ->> 'condition', ''), 'good'), nullif(btrim(r ->> 'note'), ''));
    update public.po_lines set received_qty = received_qty + v_qty where id = pl.id;

    if pl.product_id is not null and coalesce(r ->> 'condition', 'good') = 'good' then
      insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind, batch_no, expiry_date, grn_id)
      values (po.company_id, pl.product_id, p_warehouse, v_qty, 'receipt', coalesce(btrim(r ->> 'batch_no'), ''),
              nullif(r ->> 'expiry_date', '')::date, v_grn);
    end if;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'Enter at least one quantity received.' using errcode = '22023';
  end if;

  update public.purchase_orders
     set status = case when exists (select 1 from public.po_lines where po_id = p_po and received_qty < quantity)
                       then 'partially_received' else 'received' end
   where id = p_po;
  perform set_config('ims.status_change', 'off', true);
  return v_grn;
end;
$$;

-- ---------------------------------------------------------------------
-- M4. Inbox files: usual types only (the webhook stores anything else as a plain download)
-- ---------------------------------------------------------------------
do $$
begin
  update storage.buckets
     set allowed_mime_types = array[
           'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic',
           'text/plain', 'text/csv', 'message/rfc822',
           'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
           'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
           'application/zip', 'application/octet-stream']
   where id = 'inbox';
exception when undefined_column then
  raise notice 'Storage limits not set (older storage version).';
end;
$$;

-- ---------------------------------------------------------------------
-- M5. AI minutes: a counted, single-use run
-- ---------------------------------------------------------------------
-- One row per AI run. The brief (what the AI reads) is written here by the app's server from the
-- database, and read once by the long-meeting writer. Only these functions touch the table.
create table if not exists public.meeting_ai_runs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  meeting_id  uuid not null references public.meetings (id) on delete cascade,
  user_id     uuid references auth.users (id) on delete set null,
  day         date not null default ((now() at time zone 'Africa/Dar_es_Salaam')::date),
  brief       jsonb,
  created_at  timestamptz not null default now(),
  taken_at    timestamptz
);
alter table public.meeting_ai_runs enable row level security;
revoke all on public.meeting_ai_runs from anon, authenticated;
grant all on public.meeting_ai_runs to service_role;
create index if not exists meeting_ai_runs_meeting_day_idx on public.meeting_ai_runs (meeting_id, day);
create index if not exists meeting_ai_runs_company_day_idx on public.meeting_ai_runs (company_id, day);
create index if not exists meeting_ai_runs_user_idx on public.meeting_ai_runs (user_id);

-- Counts one AI run for the meeting's minutes (someone who manages the meeting, after it ended).
-- Refused above 5 runs per meeting or 30 per company in one (Dar es Salaam) day. p_brief: what the
-- long-meeting writer will read (null for a short meeting written within the screen request).
-- p_kind 'minutes' (the default) needs a held meeting whose minutes are not approved yet; 'summary' (a recording's
-- summary) can run at any time. Both count towards the same caps.
drop function if exists public.meeting_ai_run_start(uuid, jsonb);
create or replace function public.meeting_ai_run_start(p_meeting uuid, p_brief jsonb default null, p_kind text default 'minutes')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings;
  v_day date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_id uuid;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if m.id is null or auth.uid() is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if coalesce(p_kind, 'minutes') not in ('minutes', 'summary') then
    raise exception 'Unknown AI run.' using errcode = '22023';
  end if;
  if p_kind = 'minutes' and (m.status <> 'held' or m.minutes_status = 'approved') then
    raise exception 'The minutes can be written once the meeting has ended, until they are approved.' using errcode = '22023';
  end if;
  if p_brief is not null and (jsonb_typeof(p_brief) <> 'object' or octet_length(p_brief::text) > 1000000) then
    raise exception 'The meeting is too long for the AI.' using errcode = '22023';
  end if;
  if (select count(*) from public.meeting_ai_runs where meeting_id = p_meeting and day = v_day) >= 5 then
    raise exception 'The AI has written these minutes 5 times today. Edit them by hand, or try again tomorrow.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('meeting_ai_runs:' || m.company_id::text));
  if (select count(*) from public.meeting_ai_runs where company_id = m.company_id and day = v_day) >= 30 then
    raise exception 'Today''s AI allowance for meeting minutes is used up. Try again tomorrow.' using errcode = '22023';
  end if;
  insert into public.meeting_ai_runs (company_id, meeting_id, user_id, day, brief)
  values (m.company_id, p_meeting, auth.uid(), v_day, p_brief)
  returning id into v_id;
  return v_id;
end;
$$;

-- The long-meeting writer takes its brief, once, as the person who started the run, within 20 minutes.
create or replace function public.meeting_ai_run_take(p_run uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r public.meeting_ai_runs;
begin
  select * into r from public.meeting_ai_runs where id = p_run for update;
  if r.id is null or r.user_id is distinct from auth.uid() or r.brief is null or r.taken_at is not null
     or r.created_at < now() - interval '20 minutes' or not public.meeting_can_manage(r.meeting_id) then
    return null;
  end if;
  update public.meeting_ai_runs set taken_at = now(), brief = null where id = p_run;
  return jsonb_build_object('meeting_id', r.meeting_id, 'brief', r.brief);
end;
$$;

revoke execute on function public.meeting_ai_run_start(uuid, jsonb, text), public.meeting_ai_run_take(uuid) from public, anon;
grant execute on function public.meeting_ai_run_start(uuid, jsonb, text), public.meeting_ai_run_take(uuid) to authenticated;
revoke execute on function public.payment_ref_key(text) from public, anon;
grant execute on function public.payment_ref_key(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- M6. Speed of the rules as data grows
-- ---------------------------------------------------------------------
-- a) Policies: auth.uid() once per query, not once per row (the same rule, written (select auth.uid())).
do $$
declare
  p record;
  v_q text;
  v_c text;
  v_sql text;
begin
  for p in
    select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies
     where schemaname = 'public'
       -- still a bare auth.uid() once the already-wrapped ones are left out
       and replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', '') ~ 'auth\.uid\(\)'
  loop
    v_q := replace(replace(replace(p.qual, '( SELECT auth.uid() AS uid)', chr(1)), 'auth.uid()', '(select auth.uid())'), chr(1), '(select auth.uid())');
    v_c := replace(replace(replace(p.with_check, '( SELECT auth.uid() AS uid)', chr(1)), 'auth.uid()', '(select auth.uid())'), chr(1), '(select auth.uid())');
    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_q is not null then v_sql := v_sql || ' using (' || v_q || ')'; end if;
    if v_c is not null then v_sql := v_sql || ' with check (' || v_c || ')'; end if;
    execute v_sql;
  end loop;
end;
$$;

-- b) Every company table gets an index that starts with company_id (the rules filter on it).
do $$
declare
  t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
     where c.relkind = 'r'
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped)
       and not exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                        where i.indrelid = c.oid and a.attname = 'company_id')
  loop
    execute format('create index if not exists %I on public.%I (company_id)', left(t.relname, 48) || '_company_id_idx', t.relname);
  end loop;
end;
$$;

-- c) Links without an index: the ones to other business records (joins), and the person columns that
--    a table's own rules compare (e.g. user_id = auth.uid()). "Created by" style columns are left as they are.
do $$
declare
  f record;
begin
  for f in
    select cl.relname, a.attname
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid
      join pg_namespace n on n.oid = cl.relnamespace and n.nspname = 'public'
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and array_length(c.conkey, 1) = 1 and a.attname <> 'company_id'
       and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
       and (c.confrelid not in ('auth.users'::regclass, 'public.profiles'::regclass)
            or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = cl.relname
                          and (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) ~ ('\m' || a.attname || '\M')))
  loop
    execute format('create index if not exists %I on public.%I (%I)', left(f.relname || '_' || f.attname, 59) || '_idx', f.relname, f.attname);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- L2. Dar es Salaam dates (the database server runs on UTC)
-- ---------------------------------------------------------------------
-- The same functions with current_date replaced (their latest version, whichever file it came from).
do $$
declare
  f text;
  v_def text;
begin
  foreach f in array array['public.use_assistant(uuid,integer)', 'public.use_ai_receipt(uuid,integer)',
                           'public.use_ai_document(uuid,integer)', 'public.admin_record_invoice_payment(uuid,numeric,text,text,date)',
                           'public.platform_billing_overview()']
  loop
    continue when to_regprocedure(f) is null;
    v_def := pg_get_functiondef(to_regprocedure(f));
    continue when v_def !~* '\mcurrent_date\M';
    execute regexp_replace(v_def, '\mcurrent_date\M', '((now() at time zone ''Africa/Dar_es_Salaam'')::date)', 'gi');
  end loop;
end;
$$;
alter table public.assistant_usage alter column day set default ((now() at time zone 'Africa/Dar_es_Salaam')::date);

-- ---------------------------------------------------------------------
-- L3. Document numbers unique per company
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  v_dup boolean;
begin
  foreach t in array array['service_jobs', 'projects', 'fixed_assets', 'hire_agreements', 'service_contracts',
                           'hse_incidents', 'hse_inspections', 'quality_ncrs']
  loop
    continue when to_regclass('public.' || t) is null or to_regclass('public.' || t || '_company_number_key') is not null;
    execute format('select exists (select 1 from public.%I where number is not null and number <> '''' group by company_id, number having count(*) > 1)', t)
      into v_dup;
    if v_dup then
      raise notice '%: some numbers are used twice in one company; the unique key is not added yet.', t;
    else
      execute format('create unique index %I on public.%I (company_id, number) where number is not null and number <> ''''',
                     t || '_company_number_key', t);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- L4. Job sign-off files (pod/<company>/jobs/<job>/...): people who work on that job, real companies
-- ---------------------------------------------------------------------
create or replace function public.can_upload_job_file(p_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_name not like '%..%'
     and (storage.foldername(p_name))[2] = 'jobs'
     and not public.folder_is_demo((storage.foldername(p_name))[1])
     and exists (select 1 from public.service_jobs j
                  where j.id = public.folder_company((storage.foldername(p_name))[3])
                    and j.company_id = public.folder_company((storage.foldername(p_name))[1])
                    and public.can_work_job(j.id));
$$;
revoke execute on function public.can_upload_job_file(text) from public, anon;
grant execute on function public.can_upload_job_file(text) to authenticated;

drop policy if exists pod_jobs_insert on storage.objects;
create policy pod_jobs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pod' and public.can_upload_job_file(name));
drop policy if exists pod_jobs_select on storage.objects;
create policy pod_jobs_select on storage.objects for select to authenticated
  using (bucket_id = 'pod' and (storage.foldername(name))[2] = 'jobs'
         and public.is_member(public.folder_company((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------
-- L6. One company's queue (the "Send now" buttons). The scheduled job still calls the old forms,
--     which now hand over to these with no company (= all).
-- ---------------------------------------------------------------------
-- fiscal_claim: as in 20261027000101_money_fiscal.sql, with p_company (null = every company).
create or replace function public.fiscal_claim(p_limit integer, p_company uuid)
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
     and (p_company is null or f.company_id = p_company)
     and (f.receipt_at at time zone 'Africa/Dar_es_Salaam')::date < v_today
     and (f.receipt_at at time zone 'Africa/Dar_es_Salaam')::date >= v_today - 7
   group by 1, 2
  on conflict (company_id, z_day) do nothing;

  for r in
    select f.id from public.fiscal_receipts f
     join public.fiscal_settings fs on fs.company_id = f.company_id and fs.mode = 'vfd' and fs.reg_id is not null
    where f.mode = 'vfd' and f.kind = 'receipt'
      and (p_company is null or f.company_id = p_company)
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
     where (p_company is null or z.company_id = p_company)
       and ((z.status in ('queued', 'failed') and z.next_attempt_at <= now() and z.attempts < 10)
            or (z.status = 'posting' and z.claimed_at < now() - interval '10 minutes'))
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

create or replace function public.fiscal_claim(p_limit integer)
returns jsonb language sql security definer set search_path = ''
as $$ select public.fiscal_claim(p_limit, null::uuid) $$;

-- reminder_claim: as in 20261027000103_money_reminders.sql, with p_company (null = every company).
create or replace function public.reminder_claim(p_limit integer, p_at timestamptz, p_company uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_at    timestamptz := coalesce(p_at, now());
  v_day   date := (coalesce(p_at, now()) at time zone 'Africa/Dar_es_Salaam')::date;
  v_hour  integer := extract(hour from coalesce(p_at, now()) at time zone 'Africa/Dar_es_Salaam')::int;
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_jobs  jsonb := '[]'::jsonb;
  v_n     integer := 0;
  x       record;
  ch      text;
  v_to    text;
  v_id    uuid;
  v_lang  text;
  v_code  text;
begin
  for x in
    select i.id as invoice_id, i.company_id, i.client_id, i.number, i.currency, i.total, i.amount_paid, i.due_date, i.issue_date,
           i.contact_name, c.name as client_name, coalesce(c.reminder_language, st.language) as lang, st.channels, st.include_pay_link,
           public.reminder_step_for(st.schedule, i.due_date, i.issue_date, v_day) as step,
           public.reminder_contact(c.id) as contact
      from public.reminder_settings st
      join public.companies co on co.id = st.company_id
      join public.invoices i on i.company_id = st.company_id
      join public.clients c on c.id = i.client_id
     where st.enabled and not coalesce(co.is_demo, false) and co.closing_after is null
       and (p_company is null or st.company_id = p_company)
       and v_hour between st.send_hour and 19
       and public.feature_on(st.company_id, 'auto_reminders')
       and i.status in ('issued', 'partly_paid') and i.due_date is not null and not i.no_reminders
       and not c.reminders_opt_out
       and i.total - i.amount_paid > st.min_balance
       and public.reminder_step_for(st.schedule, i.due_date, i.issue_date, v_day) is not null
       and not exists (select 1 from public.followups f where f.invoice_id = i.id and f.next_on >= v_day)
     order by i.due_date, i.number
  loop
    exit when v_n >= v_limit;
    v_code := null;
    foreach ch in array x.channels loop
      v_to := case ch when 'email' then x.contact[1] else x.contact[2] end;
      if v_to is null then
        insert into public.reminder_log (company_id, invoice_id, client_id, step, channel, recipient, language, status, error)
        values (x.company_id, x.invoice_id, x.client_id, x.step, ch, null, x.lang, 'skipped',
                case ch when 'email' then 'No email address for the client' else 'No phone number for the client' end)
        on conflict (invoice_id, step, channel) do nothing;
        continue;
      end if;
      insert into public.reminder_log (company_id, invoice_id, client_id, step, channel, recipient, language, status, claimed_at)
      values (x.company_id, x.invoice_id, x.client_id, x.step, ch, v_to, x.lang, 'sending', v_at)
      on conflict (invoice_id, step, channel) do nothing
      returning id into v_id;
      if v_id is null then continue; end if;
      if x.include_pay_link and v_code is null then
        v_code := public.pay_link_ensure(x.invoice_id);
      end if;
      v_jobs := v_jobs || public.reminder_job(v_id, v_code);
      v_n := v_n + 1;
      v_id := null;
    end loop;
  end loop;

  -- Failed ones, again (three tries at most), and ones the server took but never answered.
  for x in
    select r.id, r.invoice_id from public.reminder_log r
      join public.invoices i on i.id = r.invoice_id
      join public.reminder_settings st on st.company_id = r.company_id
      join public.companies co on co.id = r.company_id
      join public.clients c on c.id = i.client_id
     where r.status in ('failed', 'sending') and r.attempts < 3
       and (p_company is null or r.company_id = p_company)
       and r.claimed_at < v_at - interval '30 minutes' and r.claimed_at > v_at - interval '2 days'
       and st.enabled and i.status in ('issued', 'partly_paid') and not i.no_reminders and not c.reminders_opt_out
       and not coalesce(co.is_demo, false) and co.closing_after is null
       and v_hour between st.send_hour and 19
       and public.feature_on(r.company_id, 'auto_reminders')
     order by r.claimed_at
     limit greatest(0, v_limit - v_n)
     for update of r skip locked
  loop
    update public.reminder_log set status = 'sending', attempts = attempts + 1, claimed_at = v_at, error = null where id = x.id;
    v_jobs := v_jobs || public.reminder_job(x.id, case when (select include_pay_link from public.reminder_settings s
                                                                 join public.reminder_log l on l.company_id = s.company_id where l.id = x.id)
                                                         then public.pay_link_ensure(x.invoice_id) end);
  end loop;
  return v_jobs;
end;
$$;

create or replace function public.reminder_claim(p_limit integer, p_at timestamptz)
returns jsonb language sql security definer set search_path = ''
as $$ select public.reminder_claim(p_limit, p_at, null::uuid) $$;

revoke execute on function public.fiscal_claim(integer, uuid), public.reminder_claim(integer, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.fiscal_claim(integer, uuid), public.reminder_claim(integer, timestamptz, uuid)
  to service_role;

notify pgrst, 'reload schema';
