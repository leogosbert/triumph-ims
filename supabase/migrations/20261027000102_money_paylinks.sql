-- =====================================================================
-- Getting paid (2 of 3): pay links (M-Pesa, Airtel Money, Mixx by Yas,
-- HaloPesa, cards and bank) through a payment gateway, and matching
-- mobile-money and bank references to invoices.
--
--   pay_settings   per company: which gateway (first: Selcom; AzamPay and
--                  ClickPesa can be added later in src/lib/getpaid/gateways)
--                  and whether the link is printed on invoices.
--   pay_links      one link per issued invoice: /pay/<code>, a public page
--                  that shows what is owed and the Pay button (and the
--                  bank / mobile-money details when no gateway is set up).
--   pay_orders     each press of Pay: the order sent to the gateway, its
--                  checkout address and what came back.
--   pay_events     every webhook the gateway sent (checked or not), kept
--                  for questions and audits.
--
-- How money arrives: the gateway calls /api/payments/<provider>; the server
-- checks the signature (and asks the gateway to confirm the order), then
-- calls pay_gateway_result() with the service role key. The payment is
-- recorded exactly like one typed in the app (payments table: the books,
-- the receipt, the balance and the "payment received" alert follow), and
-- ticked as checked. When staff already typed the same transaction code
-- by hand, the two are matched instead of counted twice.
--
-- Matching references: staff paste mobile-money SMS or bank statement lines;
-- pay_match_suggest() says which are already recorded and which invoice
-- each one probably pays (invoice number in the text, a single invoice with
-- that balance, or the client's name).
--
-- Who: management saves the settings; management, finance and sales get and
-- share an invoice's link; management and finance see orders and events and
-- match references. Nobody in the app records a gateway payment.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Feature
-- ---------------------------------------------------------------------
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('pay_links', 'Pay links (mobile money and cards)',
 'Every issued invoice gets a pay link for the client: M-Pesa, Airtel Money, Mixx by Yas, HaloPesa, cards or bank. The link is on the invoice, its PDF (as a QR code) and the messages you share; payments come back into the app by themselves, and pasted mobile-money or bank references are matched to their invoices.',
 'Finance', 'small', 'live', 'Every company whose clients pay by mobile money, card or bank.',
 'Clients pay in a tap, payments are recorded and matched without typing, and you are paid sooner.',
 '[{"title": "Connect the payment service", "body": "Open Getting paid, then Pay links, and choose the payment service (Selcom first). Until it is connected the link shows your bank and mobile-money details."},
   {"title": "Share the link", "body": "On an issued invoice press Copy, WhatsApp or Email next to the pay link. The PDF carries it as a QR code."},
   {"title": "Payments come in by themselves", "body": "When the client pays, the payment is recorded on the invoice, ticked as checked and posted to the books. Paste statement lines under Match references for the rest."}]'::jsonb,
 '/getting-paid/links', 62)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create or replace function public.pay_providers()
returns text[] language sql immutable set search_path = ''
as $$ select array['selcom', 'azampay', 'clickpesa']; $$;

create table if not exists public.pay_settings (
  company_id     uuid primary key references public.companies (id) on delete cascade,
  provider       text check (provider is null or provider = any (public.pay_providers())),
  on_documents   boolean not null default true,
  allow_partial  boolean not null default false,
  updated_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.pay_links (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  invoice_id  uuid not null,
  code        text not null unique check (code ~ '^[a-f0-9]{32}$'),
  status      text not null default 'active' check (status in ('active', 'paid', 'cancelled')),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz,
  unique (id, company_id),
  foreign key (invoice_id, company_id) references public.invoices (id, company_id) on delete cascade
);
create unique index if not exists pay_links_active_key on public.pay_links (invoice_id) where status = 'active';

create table if not exists public.pay_orders (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  link_id         uuid not null,
  invoice_id      uuid not null,
  provider        text not null check (provider = any (public.pay_providers())),
  order_id        text not null unique check (order_id ~ '^[A-Za-z0-9-]{6,60}$'),
  amount          numeric(18, 2) not null check (amount > 0),
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  status          text not null default 'created' check (status in ('created', 'pending', 'paid', 'failed', 'cancelled')),
  checkout_url    text check (checkout_url is null or checkout_url ~ '^https://'),
  provider_ref    text check (provider_ref is null or char_length(provider_ref) <= 120),
  transaction_id  text check (transaction_id is null or char_length(transaction_id) <= 120),
  channel         text check (channel is null or char_length(channel) <= 40),
  payer_phone     text check (payer_phone is null or char_length(payer_phone) <= 20),
  amount_paid     numeric(18, 2),
  payment_id      uuid references public.payments (id) on delete set null,
  note            text check (note is null or char_length(note) <= 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  paid_at         timestamptz,
  unique (id, company_id),
  foreign key (link_id, company_id) references public.pay_links (id, company_id) on delete cascade,
  foreign key (invoice_id, company_id) references public.invoices (id, company_id) on delete cascade
);
create index if not exists pay_orders_invoice_idx on public.pay_orders (invoice_id, created_at desc);
create index if not exists pay_orders_company_idx on public.pay_orders (company_id, created_at desc);

create table if not exists public.pay_events (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid references public.companies (id) on delete cascade,
  provider     text not null check (char_length(provider) <= 20),
  order_id     text check (order_id is null or char_length(order_id) <= 60),
  verified     boolean not null default false,
  outcome      text not null check (char_length(outcome) <= 40),
  detail       jsonb not null default '{}'::jsonb,
  received_at  timestamptz not null default now()
);
create index if not exists pay_events_company_idx on public.pay_events (company_id, received_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['pay_settings', 'pay_links', 'pay_orders', 'pay_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
  end loop;
  foreach t in array array['pay_settings', 'pay_links', 'pay_orders'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
  end loop;
  foreach t in array array['pay_settings', 'pay_orders'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
end $$;
drop trigger if exists pay_settings_audit on public.pay_settings;
create trigger pay_settings_audit after insert or update on public.pay_settings for each row execute function public.audit_row();

create policy pay_settings_select on public.pay_settings for select to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'sales']::public.app_role[]));
create policy pay_links_select on public.pay_links for select to authenticated
  using (public.has_role(company_id, array['management', 'finance', 'sales']::public.app_role[]));
create policy pay_orders_select on public.pay_orders for select to authenticated
  using (public.has_role(company_id, public.finance_roles()));
create policy pay_events_select on public.pay_events for select to authenticated
  using (public.has_role(company_id, public.finance_roles()));

-- ---------------------------------------------------------------------
-- 2. Actions in the app
-- ---------------------------------------------------------------------
create or replace function public.pay_save_settings(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_provider text := nullif(p ->> 'provider', '');
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can change the pay link settings.' using errcode = '42501';
  end if;
  if v_provider is not null and not (v_provider = any (public.pay_providers())) then
    raise exception 'Unknown payment service.' using errcode = '22023';
  end if;
  insert into public.pay_settings (company_id, provider, on_documents, allow_partial, updated_by)
  values (p_company, v_provider, coalesce((p ->> 'on_documents')::boolean, true), coalesce((p ->> 'allow_partial')::boolean, false), auth.uid())
  on conflict (company_id) do update
    set provider = excluded.provider, on_documents = excluded.on_documents, allow_partial = excluded.allow_partial,
        updated_by = auth.uid();
end;
$$;

-- The pay link of an issued invoice (made the first time it is asked for).
create or replace function public.pay_link_get(p_invoice uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  inv    public.invoices;
  v_code text;
begin
  select * into inv from public.invoices where id = p_invoice;
  if inv.id is null or not public.has_role(inv.company_id, array['management', 'finance', 'sales']::public.app_role[]) then
    raise exception 'Invoice not found.' using errcode = '42501';
  end if;
  if not public.feature_on(inv.company_id, 'pay_links') then
    raise exception 'Pay links are switched off for this company (Settings, then Features).' using errcode = '22023';
  end if;
  select code into v_code from public.pay_links where invoice_id = p_invoice and status in ('active', 'paid')
   order by (status = 'active') desc, created_at desc limit 1;
  if v_code is not null then
    return v_code;
  end if;
  if inv.status not in ('issued', 'partly_paid') then
    raise exception 'Pay links are for issued invoices that are not paid yet.' using errcode = '22023';
  end if;
  insert into public.pay_links (company_id, invoice_id, code)
  values (inv.company_id, p_invoice, replace(gen_random_uuid()::text, '-', ''))
  on conflict do nothing
  returning code into v_code;
  if v_code is null then
    select code into v_code from public.pay_links where invoice_id = p_invoice and status = 'active';
  end if;
  return v_code;
end;
$$;

-- Stop a link (it was sent to the wrong person); the next one asked for is new.
create or replace function public.pay_link_cancel(p_invoice uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.invoices where id = p_invoice;
  if v_company is null or not public.has_role(v_company, public.finance_roles()) then
    raise exception 'Invoice not found.' using errcode = '42501';
  end if;
  update public.pay_links set status = 'cancelled', closed_at = now() where invoice_id = p_invoice and status = 'active';
end;
$$;

-- Which pasted references are already recorded, and which invoice each other one probably pays.
-- p_items: [{"ref": "QJK7..", "amount": 150000, "text": "the whole line"}] (at most 200).
create or replace function public.pay_match_suggest(p_company uuid, p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  it      jsonb;
  v_out   jsonb := '[]'::jsonb;
  v_ref   text;
  v_text  text;
  v_amt   numeric;
  v_pay   jsonb;
  v_inv   jsonb;
  v_why   text;
  v_n     integer := 0;
begin
  if not public.has_role(p_company, public.finance_roles()) then
    raise exception 'Only management and finance can match payments.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 200 then
    raise exception 'Paste at most 200 lines at a time.' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    v_ref := upper(nullif(btrim(it ->> 'ref'), ''));
    v_text := upper(coalesce(it ->> 'text', ''));
    v_amt := case when (it ->> 'amount') ~ '^[0-9]+(\.[0-9]+)?$' then (it ->> 'amount')::numeric end;
    v_pay := null;
    v_inv := null;
    v_why := null;
    if v_ref is not null then
      select jsonb_build_object('payment_id', p.id, 'number', p.number, 'invoice_id', i.id, 'invoice_number', i.number) into v_pay
        from public.payments p join public.invoices i on i.id = p.invoice_id
       where p.company_id = p_company and p.voided_at is null and upper(p.reference) = v_ref
       limit 1;
    end if;
    if v_pay is null then
      -- 1. The invoice number is in the text (spaces, dashes and slashes ignored).
      select jsonb_build_object('id', i.id, 'number', i.number, 'client', c.name, 'currency', i.currency, 'balance', i.total - i.amount_paid)
        into v_inv
        from public.invoices i join public.clients c on c.id = i.client_id
       where i.company_id = p_company and i.status in ('issued', 'partly_paid') and i.number <> ''
         and regexp_replace(v_text, '[^A-Z0-9]', '', 'g') like '%' || regexp_replace(upper(i.number), '[^A-Z0-9]', '', 'g') || '%'
       order by char_length(i.number) desc limit 1;
      if v_inv is not null then
        v_why := 'number';
      elsif v_amt is not null and v_amt > 0
            and (select count(*) from public.invoices where company_id = p_company and status in ('issued', 'partly_paid')
                  and total - amount_paid = v_amt) = 1 then
        -- 2. Exactly one open invoice owes this amount.
        select jsonb_build_object('id', i.id, 'number', i.number, 'client', c.name, 'currency', i.currency, 'balance', i.total - i.amount_paid)
          into v_inv
          from public.invoices i join public.clients c on c.id = i.client_id
         where i.company_id = p_company and i.status in ('issued', 'partly_paid') and i.total - i.amount_paid = v_amt;
        v_why := 'amount';
      end if;
      if v_inv is null then
        -- 3. The client's name is in the text and they have one open invoice.
        select jsonb_build_object('id', i.id, 'number', i.number, 'client', c.name, 'currency', i.currency, 'balance', i.total - i.amount_paid)
          into v_inv
          from public.clients c join public.invoices i on i.client_id = c.id
         where c.company_id = p_company and i.status in ('issued', 'partly_paid') and char_length(c.name) >= 4
           and v_text like '%' || upper(c.name) || '%'
           and (select count(*) from public.invoices i2 where i2.client_id = c.id and i2.status in ('issued', 'partly_paid')) = 1
         limit 1;
        if v_inv is not null then v_why := 'client'; end if;
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('i', v_n, 'ref', it ->> 'ref', 'amount', v_amt,
                                                           'recorded', v_pay, 'invoice', v_inv, 'why', v_why));
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. The public pay page and the gateway (service role only)
-- ---------------------------------------------------------------------
-- What the pay page shows. Null when the code is unknown.
create or replace function public.pay_link_public(p_code text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  l   public.pay_links;
  inv public.invoices;
  c   public.companies;
  s   public.pay_settings;
begin
  if p_code is null or p_code !~ '^[a-f0-9]{32}$' then return null; end if;
  select * into l from public.pay_links where code = p_code;
  if l.id is null then return null; end if;
  select * into inv from public.invoices where id = l.invoice_id;
  select * into c from public.companies where id = l.company_id;
  select * into s from public.pay_settings where company_id = l.company_id;
  return jsonb_build_object(
    'link_id', l.id,
    'status', case when l.status = 'cancelled' or inv.status = 'cancelled' then 'cancelled'
                   when inv.status = 'paid' then 'paid'
                   when not public.feature_on(l.company_id, 'pay_links') then 'cancelled'
                   else 'open' end,
    'provider', s.provider,
    'allow_partial', coalesce(s.allow_partial, false),
    'company', jsonb_build_object('name', c.name, 'logo_path', c.logo_path, 'phone', c.phone, 'email', c.email,
                                  'primary_color', c.primary_color, 'bank_details', c.bank_details,
                                  'mobile_money_details', c.mobile_money_details),
    'invoice', jsonb_build_object('number', inv.number, 'client', (select name from public.clients where id = inv.client_id),
                                  'issue_date', inv.issue_date, 'due_date', inv.due_date, 'currency', inv.currency,
                                  'total', inv.total, 'paid', inv.amount_paid, 'balance', inv.total - inv.amount_paid));
end;
$$;

-- A press of Pay: a new order for what is owed (or a part, when the company allows it).
create or replace function public.pay_order_start(p_code text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  l       public.pay_links;
  inv     public.invoices;
  s       public.pay_settings;
  v_open  numeric;
  v_amt   numeric;
  v_order text;
  v_id    uuid;
  v_email text;
  v_phone text;
  v_name  text;
begin
  select * into l from public.pay_links where code = p_code and status = 'active';
  if l.id is null then raise exception 'This pay link is no longer valid.' using errcode = '22023'; end if;
  select * into inv from public.invoices where id = l.invoice_id for update;
  select * into s from public.pay_settings where company_id = l.company_id;
  if s.provider is null then raise exception 'Online payment is not set up for this company.' using errcode = '22023'; end if;
  if not public.feature_on(l.company_id, 'pay_links') then raise exception 'This pay link is no longer valid.' using errcode = '22023'; end if;
  if inv.status not in ('issued', 'partly_paid') then raise exception 'This invoice is not open for payment.' using errcode = '22023'; end if;
  if inv.currency <> 'TZS' then
    raise exception 'Online payment is for invoices in TZS. Please pay by bank transfer.' using errcode = '22023';
  end if;
  if (select count(*) from public.pay_orders where link_id = l.id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many tries. Please wait a while and try again.' using errcode = '22023';
  end if;
  v_open := inv.total - inv.amount_paid;
  v_amt := case when coalesce(s.allow_partial, false) and coalesce(p_amount, 0) > 0 then round(p_amount, 0) else v_open end;
  if v_amt <= 0 or v_amt > v_open then
    raise exception 'Enter an amount up to %.', public.fmt_money(v_open, inv.currency) using errcode = '22023';
  end if;
  v_order := regexp_replace(coalesce(nullif(inv.number, ''), 'INV'), '[^A-Za-z0-9-]', '', 'g') || '-'
             || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into public.pay_orders (company_id, link_id, invoice_id, provider, order_id, amount, currency)
  values (l.company_id, l.id, inv.id, s.provider, v_order, v_amt, inv.currency)
  returning id into v_id;
  select name into v_name from public.clients where id = inv.client_id;
  select email into v_email from public.client_contacts
   where client_id = inv.client_id and coalesce(email, '') <> '' order by (kind = 'finance') desc, created_at limit 1;
  select public.inbox_phone_of(phone) into v_phone from public.client_contacts
   where client_id = inv.client_id and coalesce(phone, '') <> '' order by (kind = 'finance') desc, created_at limit 1;
  return jsonb_build_object('id', v_id, 'order_id', v_order, 'provider', s.provider, 'amount', v_amt, 'currency', inv.currency,
                            'invoice_number', inv.number, 'company', (select name from public.companies where id = l.company_id),
                            'buyer', jsonb_build_object('name', v_name, 'email', v_email, 'phone', v_phone));
end;
$$;

-- The gateway's answer to the new order: where to send the client (or why it failed).
create or replace function public.pay_order_checkout(p_order text, p_url text, p_ref text, p_error text)
returns void language sql security definer set search_path = ''
as $$
  update public.pay_orders
     set checkout_url = case when p_url ~ '^https://' then left(p_url, 1000) end,
         provider_ref = left(p_ref, 120),
         status = case when p_error is null and p_url ~ '^https://' then 'pending' else 'failed' end,
         note = left(p_error, 300)
   where order_id = p_order and status in ('created', 'pending');
$$;

-- What the gateway reported (after the server checked its signature). Records the payment once.
-- p_status: 'success', 'pending' or 'failed'. p_method / p_provider as in the payments table.
create or replace function public.pay_gateway_result(p_provider text, p_order text, p_status text, p_amount numeric,
                                                     p_transaction text, p_reference text, p_channel text, p_method text,
                                                     p_mm_provider text, p_phone text, p_detail jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  o        public.pay_orders;
  inv      public.invoices;
  v_open   numeric;
  v_apply  numeric;
  v_pay    uuid;
  v_ref    text := upper(nullif(btrim(coalesce(p_transaction, p_reference, '')), ''));
  v_out    text;
  v_method text := case when p_method in ('mobile_money', 'bank_transfer', 'other') then p_method else 'other' end;
  v_mm     text := case when p_method = 'mobile_money' and p_mm_provider = any (public.mobile_money_providers()) then p_mm_provider end;
begin
  select * into o from public.pay_orders where order_id = p_order and provider = p_provider for update;
  if o.id is null then
    insert into public.pay_events (company_id, provider, order_id, verified, outcome, detail)
    values (null, left(p_provider, 20), left(p_order, 60), true, 'unknown_order', coalesce(p_detail, '{}'::jsonb));
    return jsonb_build_object('outcome', 'unknown_order');
  end if;

  if o.status = 'paid' then
    v_out := 'duplicate';
  elsif p_status is distinct from 'success' then
    update public.pay_orders set status = case when p_status = 'failed' then 'failed' else 'pending' end,
                                 channel = coalesce(left(p_channel, 40), channel), note = left(p_detail ->> 'message', 300)
     where id = o.id;
    v_out := case when p_status = 'failed' then 'failed' else 'pending' end;
  else
    select * into inv from public.invoices where id = o.invoice_id for update;
    v_open := inv.total - inv.amount_paid;
    -- Staff may already have typed the same transaction code by hand: match it, do not count it twice.
    if v_ref is not null then
      select id into v_pay from public.payments
       where invoice_id = inv.id and voided_at is null and upper(reference) = v_ref limit 1;
    end if;
    if v_pay is not null then
      perform set_config('ims.status_change', 'on', true);
      update public.payments set reconciled_at = coalesce(reconciled_at, now()) where id = v_pay;
      perform set_config('ims.status_change', 'off', true);
      v_out := 'matched';
    elsif inv.status not in ('issued', 'partly_paid') or v_open <= 0 then
      v_out := 'overpaid';
    else
      v_apply := least(round(coalesce(p_amount, o.amount), 2), v_open);
      insert into public.payments (company_id, invoice_id, client_id, received_on, amount, currency, exchange_rate, method,
                                   provider, reference, notes, reconciled_at, created_by)
      values (inv.company_id, inv.id, inv.client_id, public.fiscal_today(), v_apply, inv.currency, inv.exchange_rate,
              v_method, v_mm, coalesce(v_ref, o.order_id),
              left('Paid online (' || p_provider || coalesce(', ' || p_channel, '') || coalesce(', ' || p_phone, '') || ') order ' || o.order_id, 300),
              now(), null)
      returning id into v_pay;
      perform set_config('ims.status_change', 'on', true);
      update public.invoices
         set amount_paid = amount_paid + v_apply,
             status = case when amount_paid + v_apply >= total then 'paid' else 'partly_paid' end
       where id = inv.id;
      perform set_config('ims.status_change', 'off', true);
      v_out := case when coalesce(p_amount, o.amount) > v_open then 'recorded_overpaid' else 'recorded' end;
    end if;
    update public.pay_orders
       set status = 'paid', paid_at = now(), payment_id = v_pay, amount_paid = p_amount,
           transaction_id = left(p_transaction, 120), provider_ref = coalesce(left(p_reference, 120), provider_ref),
           channel = left(p_channel, 40), payer_phone = left(p_phone, 20),
           note = case when v_out in ('overpaid', 'recorded_overpaid')
                       then left('Paid ' || public.fmt_money(p_amount, inv.currency) || ' but only '
                                 || public.fmt_money(greatest(v_open, 0), inv.currency) || ' was owed', 300) end
     where id = o.id;
    if (select status from public.invoices where id = inv.id) = 'paid' then
      update public.pay_links set status = 'paid', closed_at = now() where invoice_id = inv.id and status = 'active';
    end if;
    if v_out in ('overpaid', 'recorded_overpaid') then
      perform public.notify_roles(inv.company_id, public.finance_roles(), null, 'pay_overpaid', 'attention',
        'Client paid more than owed: ' || inv.number,
        public.fmt_money(p_amount, inv.currency) || ' through the pay link; ' || public.fmt_money(greatest(v_open, 0), inv.currency)
        || ' was owed. Refund or keep it as credit.', '/invoices/' || inv.id, 'pay_overpaid:' || o.id);
    end if;
  end if;
  insert into public.pay_events (company_id, provider, order_id, verified, outcome, detail)
  values (o.company_id, left(p_provider, 20), left(p_order, 60), true, v_out, coalesce(p_detail, '{}'::jsonb));
  return jsonb_build_object('outcome', v_out, 'payment_id', v_pay, 'invoice_id', o.invoice_id);
end;
$$;

-- A webhook whose signature did not check out (kept, never acted on).
create or replace function public.pay_event_rejected(p_provider text, p_order text, p_reason text, p_detail jsonb)
returns void language sql security definer set search_path = ''
as $$
  insert into public.pay_events (company_id, provider, order_id, verified, outcome, detail)
  values ((select company_id from public.pay_orders where order_id = p_order), left(p_provider, 20), left(p_order, 60), false,
          left(coalesce(p_reason, 'rejected'), 40), coalesce(p_detail, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.pay_providers(), public.pay_save_settings(uuid, jsonb), public.pay_link_get(uuid), public.pay_link_cancel(uuid),
  public.pay_match_suggest(uuid, jsonb), public.pay_link_public(text), public.pay_order_start(text, numeric),
  public.pay_order_checkout(text, text, text, text),
  public.pay_gateway_result(text, text, text, numeric, text, text, text, text, text, text, jsonb),
  public.pay_event_rejected(text, text, text, jsonb)
from public, anon, authenticated;

grant execute on function
  public.pay_providers(), public.pay_save_settings(uuid, jsonb), public.pay_link_get(uuid), public.pay_link_cancel(uuid),
  public.pay_match_suggest(uuid, jsonb)
to authenticated;

grant execute on function
  public.pay_providers(), public.pay_link_public(text), public.pay_order_start(text, numeric), public.pay_order_checkout(text, text, text, text),
  public.pay_gateway_result(text, text, text, numeric, text, text, text, text, text, text, jsonb),
  public.pay_event_rejected(text, text, text, jsonb)
to service_role;

notify pgrst, 'reload schema';
