-- =====================================================================
-- Getting paid (3 of 3): automatic payment reminders by email, SMS and
-- WhatsApp.
--
--   reminder_settings  per company: on or off (off until management
--                      switches it on), the schedule in days around the
--                      due date (default 3 days before, on the day, 7 and
--                      14 days after), the channels, the hour to send, the
--                      language and whether the pay link goes in.
--   clients            + reminders_opt_out (the client asked not to get
--                      them) and reminder_language (en / sw).
--   invoices           + no_reminders ("don't remind" on one invoice).
--   reminder_log       every reminder: when, to whom, by which channel,
--                      the text, sent or why not. One per invoice, step and
--                      channel, so nobody is reminded twice.
--
-- The server job (/api/money/cron every 15 minutes, netlify/functions/
-- money-cron.mts) calls reminder_claim() with the service role key, sends
-- what it gets and reports back with reminder_mark(). Nothing is sent while
-- a promised payment date (follow-ups) has not passed, for demo companies,
-- or outside 08:00-19:59 Tanzania time (from the company's hour).
--
-- Who: management changes the settings; management and finance switch an
-- invoice off; management, finance and sales mark a client's choice and
-- see the log.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Feature
-- ---------------------------------------------------------------------
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('auto_reminders', 'Automatic payment reminders',
 'Polite reminders go to clients by email, SMS and WhatsApp on the days you choose (for example 3 days before the due date, on the day, then 7 and 14 days late), in English or Kiswahili, with the pay link. Clients can be left out, single invoices switched off, and every reminder is logged.',
 'Finance', 'small', 'live', 'Every company that sells on credit.',
 'Clients are reminded on time without anyone chasing by hand, and you see who was reminded when.',
 '[{"title": "Switch it on", "body": "Open Getting paid, then Reminders. Choose the days, the channels and the language, and switch reminders on. Nothing is sent before that."},
   {"title": "Who is reminded", "body": "Reminders go to the client contact with an email address or phone number (the finance contact first). A client who asked not to be reminded, or an invoice marked Do not remind, is skipped."},
   {"title": "See what went out", "body": "The reminder log shows every message, to whom, by which channel and whether it arrived at the provider. A promised payment date pauses the reminders."}]'::jsonb,
 '/getting-paid/reminders', 64)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Settings and switches
-- ---------------------------------------------------------------------
create or replace function public.reminder_channels()
returns text[] language sql immutable set search_path = ''
as $$ select array['email', 'sms', 'whatsapp']; $$;

create table if not exists public.reminder_settings (
  company_id        uuid primary key references public.companies (id) on delete cascade,
  enabled           boolean not null default false,
  schedule          integer[] not null default '{-3,0,7,14}'
                    check (cardinality(schedule) between 1 and 8 and -30 <= all (schedule) and 120 >= all (schedule)),
  channels          text[] not null default '{email}'
                    check (cardinality(channels) between 1 and 3 and channels <@ array['email', 'sms', 'whatsapp']),
  send_hour         integer not null default 9 check (send_hour between 8 and 18),
  language          text not null default 'en' check (language in ('en', 'sw', 'both')),
  include_pay_link  boolean not null default true,
  min_balance       numeric(18, 2) not null default 0 check (min_balance >= 0),
  updated_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.clients
  add column if not exists reminders_opt_out boolean not null default false,
  add column if not exists reminder_language text check (reminder_language is null or reminder_language in ('en', 'sw', 'both'));
alter table public.invoices add column if not exists no_reminders boolean not null default false;

create table if not exists public.reminder_log (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  invoice_id   uuid not null,
  client_id    uuid,
  step         integer not null,
  channel      text not null check (channel in ('email', 'sms', 'whatsapp')),
  recipient    text check (recipient is null or char_length(recipient) <= 200),
  language     text not null default 'en' check (language in ('en', 'sw', 'both')),
  status       text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'skipped')),
  attempts     integer not null default 1,
  provider_id  text check (provider_id is null or char_length(provider_id) <= 200),
  error        text check (error is null or char_length(error) <= 500),
  body         text check (body is null or char_length(body) <= 5000),
  claimed_at   timestamptz not null default now(),
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (invoice_id, step, channel),
  foreign key (invoice_id, company_id) references public.invoices (id, company_id) on delete cascade
);
create index if not exists reminder_log_company_idx on public.reminder_log (company_id, created_at desc);
create index if not exists reminder_log_retry_idx on public.reminder_log (claimed_at) where status in ('sending', 'failed');

do $$
declare
  t text;
begin
  foreach t in array array['reminder_settings', 'reminder_log'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
  end loop;
end $$;
drop trigger if exists reminder_settings_touch on public.reminder_settings;
create trigger reminder_settings_touch before update on public.reminder_settings for each row execute function public.touch_updated_at();
drop trigger if exists reminder_settings_audit on public.reminder_settings;
create trigger reminder_settings_audit after insert or update on public.reminder_settings for each row execute function public.audit_row();
create policy reminder_settings_select on public.reminder_settings for select to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'sales']::public.app_role[]));
create policy reminder_log_select on public.reminder_log for select to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'sales']::public.app_role[]));

-- ---------------------------------------------------------------------
-- 2. Actions in the app
-- ---------------------------------------------------------------------
create or replace function public.reminder_save_settings(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_schedule integer[];
  v_channels text[];
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can change the reminder settings.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct x::int order by x::int), '{}') into v_schedule
    from jsonb_array_elements_text(coalesce(p -> 'schedule', '[-3, 0, 7, 14]'::jsonb)) x;
  select coalesce(array_agg(distinct x order by x), '{}') into v_channels
    from jsonb_array_elements_text(coalesce(p -> 'channels', '["email"]'::jsonb)) x;
  if cardinality(v_schedule) = 0 then raise exception 'Choose at least one day to remind.' using errcode = '22023'; end if;
  if cardinality(v_channels) = 0 then raise exception 'Choose at least one way to remind (email, SMS or WhatsApp).' using errcode = '22023'; end if;
  if not (v_channels <@ public.reminder_channels()) then raise exception 'Unknown channel.' using errcode = '22023'; end if;
  if cardinality(v_schedule) > 8 or not (-30 <= all (v_schedule) and 120 >= all (v_schedule)) then
    raise exception 'Choose at most 8 days, from 30 days before to 120 days after the due date.' using errcode = '22023';
  end if;
  insert into public.reminder_settings (company_id, enabled, schedule, channels, send_hour, language, include_pay_link, min_balance, updated_by)
  values (p_company, coalesce((p ->> 'enabled')::boolean, false), v_schedule, v_channels,
          coalesce((p ->> 'send_hour')::int, 9), coalesce(nullif(p ->> 'language', ''), 'en'),
          coalesce((p ->> 'include_pay_link')::boolean, true), coalesce((p ->> 'min_balance')::numeric, 0), auth.uid())
  on conflict (company_id) do update
    set enabled = excluded.enabled, schedule = excluded.schedule, channels = excluded.channels, send_hour = excluded.send_hour,
        language = excluded.language, include_pay_link = excluded.include_pay_link, min_balance = excluded.min_balance,
        updated_by = auth.uid();
end;
$$;

-- "Don't remind" on one invoice.
create or replace function public.reminder_set_invoice(p_invoice uuid, p_off boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.invoices where id = p_invoice;
  if v_company is null or not public.has_role(v_company, public.finance_roles()) then
    raise exception 'Invoice not found.' using errcode = '42501';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.invoices set no_reminders = coalesce(p_off, false) where id = p_invoice;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- The client asked not to be reminded (or for another language).
create or replace function public.reminder_set_client(p_client uuid, p_opt_out boolean, p_language text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.clients where id = p_client;
  if v_company is null or not public.has_role(v_company, array['management', 'finance', 'sales']::public.app_role[]) then
    raise exception 'Client not found.' using errcode = '42501';
  end if;
  if p_language is not null and p_language not in ('en', 'sw', 'both') then
    raise exception 'Choose English, Kiswahili or both.' using errcode = '22023';
  end if;
  update public.clients set reminders_opt_out = coalesce(p_opt_out, false), reminder_language = nullif(p_language, '')
   where id = p_client;
end;
$$;

-- Where a reminder for the client goes: [email, phone] (the finance contact first).
create or replace function public.reminder_contact(p_client uuid)
returns text[] language sql stable security definer set search_path = ''
as $$
  select array[
    (select public.inbox_email_of(email) from public.client_contacts
      where client_id = p_client and public.inbox_email_of(email) is not null order by (kind = 'finance') desc, created_at limit 1),
    (select public.inbox_phone_of(phone) from public.client_contacts
      where client_id = p_client and public.inbox_phone_of(phone) is not null order by (kind = 'finance') desc, created_at limit 1)];
$$;

-- The step of the schedule due for an invoice on a day (null: none). A step is sent on its day or up
-- to 2 days late (the job may have been down), never before the invoice was issued.
create or replace function public.reminder_step_for(p_schedule integer[], p_due date, p_issued date, p_day date)
returns integer language sql immutable set search_path = ''
as $$
  select s from unnest(p_schedule) s
   where p_due + s <= p_day and p_day - (p_due + s) <= 2 and p_due + s >= coalesce(p_issued, p_due + s)
   order by s desc limit 1;
$$;

-- What is coming in the next days (the reminders screen), with the reason when one will not go.
create or replace function public.reminder_upcoming(p_company uuid, p_days integer)
returns table (invoice_id uuid, number text, client text, due_date date, balance numeric, currency text, step integer,
               send_on date, blocked text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  st      public.reminder_settings;
  v_today date := public.fiscal_today();
begin
  if not public.has_role(p_company, array['management', 'finance', 'sales']::public.app_role[]) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  select * into st from public.reminder_settings where company_id = p_company;
  if st.company_id is null then
    st.schedule := '{-3,0,7,14}';
    st.min_balance := 0;
  end if;
  return query
  select i.id, i.number, c.name, i.due_date, i.total - i.amount_paid, i.currency, s, i.due_date + s,
         case when not coalesce(st.enabled, false) then 'Reminders are off'
              when i.no_reminders then 'Do not remind (this invoice)'
              when c.reminders_opt_out then 'The client asked not to be reminded'
              when (public.reminder_contact(c.id))[1] is null and (public.reminder_contact(c.id))[2] is null then 'No email or phone for the client'
              when exists (select 1 from public.followups f where f.invoice_id = i.id and f.next_on >= i.due_date + s) then 'Promised to pay'
              when i.total - i.amount_paid <= st.min_balance then 'Balance below the minimum'
         end
    from public.invoices i
    join public.clients c on c.id = i.client_id
    cross join lateral unnest(st.schedule) s
   where i.company_id = p_company and i.status in ('issued', 'partly_paid') and i.due_date is not null
     and i.due_date + s between v_today and v_today + greatest(0, least(coalesce(p_days, 14), 60))
     and i.due_date + s >= coalesce(i.issue_date, i.due_date + s)
     and not exists (select 1 from public.reminder_log r where r.invoice_id = i.id and r.step = s and r.status = 'sent')
   order by i.due_date + s, i.number;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. The server job (service role only)
-- ---------------------------------------------------------------------
-- An invoice's pay link without a role check (internal).
create or replace function public.pay_link_ensure(p_invoice uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  inv public.invoices;
  v_code text;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or inv.status not in ('issued', 'partly_paid') or not public.feature_on(inv.company_id, 'pay_links') then
    return null;
  end if;
  select code into v_code from public.pay_links where invoice_id = p_invoice and status = 'active';
  if v_code is null then
    insert into public.pay_links (company_id, invoice_id, code, created_by)
    values (inv.company_id, p_invoice, replace(gen_random_uuid()::text, '-', ''), null)
    on conflict do nothing
    returning code into v_code;
  end if;
  return v_code;
end;
$$;

-- Reminders to send now. Each is written to the log first ("sending"), so a reminder is never sent twice;
-- ones that failed are offered again after 30 minutes, three times at most.
-- p_at: the moment to plan for (now() by default; the tests pass a fixed time).
create or replace function public.reminder_claim(p_limit integer, p_at timestamptz)
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

-- Everything the server needs to write and send one reminder (internal).
create or replace function public.reminder_job(p_log uuid, p_code text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_array(jsonb_build_object(
    'id', r.id, 'channel', r.channel, 'to', r.recipient, 'language', r.language, 'step', r.step,
    'company', jsonb_build_object('id', co.id, 'name', co.name, 'phone', co.phone, 'email', co.email,
                                  'bank_details', co.bank_details, 'mobile_money_details', co.mobile_money_details),
    'invoice', jsonb_build_object('id', i.id, 'number', i.number, 'currency', i.currency, 'total', i.total, 'paid', i.amount_paid,
                                  'balance', i.total - i.amount_paid, 'due_date', i.due_date, 'contact_name', i.contact_name),
    'client', jsonb_build_object('id', c.id, 'name', c.name),
    'pay_code', p_code,
    'whatsapp_phone_number_id', (select whatsapp_phone_number_id from public.inbox_settings where company_id = co.id),
    'reply_to', (select inbound_address from public.inbox_settings where company_id = co.id)))
    from public.reminder_log r
    join public.invoices i on i.id = r.invoice_id
    join public.companies co on co.id = r.company_id
    join public.clients c on c.id = i.client_id
   where r.id = p_log;
$$;

-- The server's report for one reminder (p_ok null: not sent on purpose, e.g. a dry run).
create or replace function public.reminder_mark(p_id uuid, p_ok boolean, p_provider_id text, p_error text, p_body text)
returns void language sql security definer set search_path = ''
as $$
  update public.reminder_log
     set status = case when p_ok then 'sent' when p_ok is null then 'skipped' else 'failed' end,
         sent_at = case when p_ok then now() end,
         provider_id = left(p_provider_id, 200),
         error = case when p_ok then null else left(coalesce(p_error, 'Not sent'), 500) end,
         body = coalesce(left(p_body, 5000), body)
   where id = p_id and status = 'sending';
$$;

-- ---------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.reminder_channels(), public.reminder_save_settings(uuid, jsonb), public.reminder_set_invoice(uuid, boolean),
  public.reminder_set_client(uuid, boolean, text), public.reminder_contact(uuid),
  public.reminder_step_for(integer[], date, date, date), public.reminder_upcoming(uuid, integer),
  public.pay_link_ensure(uuid), public.reminder_claim(integer, timestamptz), public.reminder_job(uuid, text),
  public.reminder_mark(uuid, boolean, text, text, text)
from public, anon, authenticated;

grant execute on function
  public.reminder_channels(), public.reminder_save_settings(uuid, jsonb), public.reminder_set_invoice(uuid, boolean),
  public.reminder_set_client(uuid, boolean, text), public.reminder_step_for(integer[], date, date, date),
  public.reminder_upcoming(uuid, integer)
to authenticated;

grant execute on function
  public.reminder_claim(integer, timestamptz), public.reminder_mark(uuid, boolean, text, text, text)
to service_role;

notify pgrst, 'reload schema';
