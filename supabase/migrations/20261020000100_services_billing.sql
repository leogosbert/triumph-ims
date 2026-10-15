-- =====================================================================
-- LeMoSp · Services, price book, playbooks on request and billing
--
--   Price book       price_items: every plan, extra, add-on, usage
--                    bundle, setup, training, support level, service and
--                    playbook LeMo Tech sells, in TZS and USD. Managed by
--                    the LeMo Tech team in LeMoSp ADMIN. Prices start
--                    from the pricing proposal (11 October 2026).
--   Requests         service_requests: a company asks for a service, an
--                    add-on or a playbook; LeMo Tech approves (or
--                    declines), delivers and bills it. Approving an add-on
--                    switches its features on. Playbooks open only when
--                    approved for the company (demo companies have all).
--   Billing          platform_billing_settings: LeMo Tech's own details,
--                    VAT rate, pricing rate and payment instructions.
--                    company_billing: each company's plan terms (currency,
--                    cycle, discount, account status).
--                    platform_invoices + platform_invoice_lines: LeMo
--                    Tech's invoices to companies, issued and paid.
--
-- Run after the Stage 16 file. Safe to run more than once.
-- No statement in this file removes anything. Price items that already
-- exist are left as they are (the team's own prices are kept).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Price book
-- ---------------------------------------------------------------------
create table if not exists public.price_items (
  key             text primary key check (key ~ '^[a-z][a-z0-9_-]{1,59}$'),
  category        text not null check (category in ('plan', 'extra', 'addon', 'usage', 'setup', 'training',
                                                    'support', 'service', 'playbook')),
  name            text not null check (char_length(btrim(name)) between 2 and 120),
  description     text not null default '' check (char_length(description) <= 600),
  unit            text not null default 'once' check (unit in ('month', 'once', 'hour', 'day', 'user_month', 'bundle', 'visit')),
  price_tzs       numeric(14, 2) check (price_tzs is null or price_tzs >= 0),   -- null = quoted on request
  price_usd       numeric(12, 2) check (price_usd is null or price_usd >= 0),
  level           public.business_level,                                      -- plans: the level they match
  included_users  integer check (included_users is null or included_users >= 0),
  feature_keys    text[] not null default '{}',                               -- add-ons: features switched on
  playbook_id     text unique check (playbook_id is null or playbook_id ~ '^[a-z][a-z0-9-]{1,39}$'),
  requestable     boolean not null default true,
  public          boolean not null default false,                             -- shown on the public price page
  active          boolean not null default true,
  sort            integer not null default 100,
  updated_at      timestamptz not null default now()
);
create index if not exists price_items_sort_idx on public.price_items (category, sort, name);

drop trigger if exists price_items_touch on public.price_items;
create trigger price_items_touch before update on public.price_items for each row execute function public.touch_updated_at();

alter table public.price_items enable row level security;
drop policy if exists price_items_select on public.price_items;
create policy price_items_select on public.price_items for select to authenticated
  using (active or public.is_platform_admin());
revoke all on public.price_items from public, anon, authenticated;
grant select on public.price_items to authenticated;

-- ---------------------------------------------------------------------
-- 2. LeMo Tech's billing settings (one row)
-- ---------------------------------------------------------------------
create table if not exists public.platform_billing_settings (
  id               boolean primary key default true check (id),
  legal_name       text not null default 'LeMo Tech Solutions' check (char_length(legal_name) between 2 and 120),
  tin              text not null default '' check (char_length(tin) <= 40),
  vrn              text not null default '' check (char_length(vrn) <= 40),
  address          text not null default 'Dar es Salaam, Tanzania' check (char_length(address) <= 300),
  phone            text not null default '' check (char_length(phone) <= 60),
  email            text not null default '' check (char_length(email) <= 120),
  bank_details     text not null default '' check (char_length(bank_details) <= 600),
  mobile_money     text not null default '' check (char_length(mobile_money) <= 400),
  vat_rate         numeric(5, 2) not null default 0 check (vat_rate between 0 and 50),
  usd_rate         numeric(10, 2) not null default 2500 check (usd_rate > 0),
  payment_days     integer not null default 7 check (payment_days between 0 and 90),
  invoice_note     text not null default 'Thank you for using LeMoSp. Please use the invoice number as the payment reference.'
                   check (char_length(invoice_note) <= 600),
  next_invoice_no  integer not null default 1 check (next_invoice_no > 0),
  updated_at       timestamptz not null default now()
);
insert into public.platform_billing_settings (id) values (true) on conflict (id) do nothing;

alter table public.platform_billing_settings enable row level security;
drop policy if exists platform_billing_settings_select on public.platform_billing_settings;
create policy platform_billing_settings_select on public.platform_billing_settings for select to authenticated using (true);
revoke all on public.platform_billing_settings from public, anon, authenticated;
-- LeMo Tech's own business details: shown to every customer on invoices and "How to pay".
grant select (id, legal_name, tin, vrn, address, phone, email, bank_details, mobile_money, vat_rate, usd_rate,
              payment_days, invoice_note, updated_at)
  on public.platform_billing_settings to authenticated;

-- ---------------------------------------------------------------------
-- 3. Each company's billing terms
-- ---------------------------------------------------------------------
create table if not exists public.company_billing (
  company_id       uuid primary key references public.companies (id) on delete cascade,
  currency         text not null default 'TZS' check (currency in ('TZS', 'USD')),
  cycle            text not null default 'monthly' check (cycle in ('monthly', 'quarterly', 'annual')),
  discount_pct     numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  founding         boolean not null default false,
  status           text not null default 'trial' check (status in ('trial', 'active', 'grace', 'read_only', 'suspended', 'free')),
  trial_ends_on    date,
  next_invoice_on  date,
  billing_name     text check (billing_name is null or char_length(billing_name) <= 160),
  billing_email    text check (billing_email is null or char_length(billing_email) <= 160),
  billing_tin      text check (billing_tin is null or char_length(billing_tin) <= 40),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. LeMo Tech's invoices to companies
-- ---------------------------------------------------------------------
create table if not exists public.platform_invoices (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  number        text,
  currency      text not null check (currency in ('TZS', 'USD')),
  status        text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'void')),
  issued_on     date,
  due_on        date,
  period_start  date,
  period_end    date,
  subtotal      numeric(14, 2) not null default 0,
  discount_pct  numeric(5, 2) not null default 0,
  discount      numeric(14, 2) not null default 0,
  vat_rate      numeric(5, 2) not null default 0,
  vat           numeric(14, 2) not null default 0,
  total         numeric(14, 2) not null default 0,
  paid_amount   numeric(14, 2) not null default 0,
  paid_on       date,
  paid_method   text check (paid_method is null or char_length(paid_method) <= 60),
  paid_ref      text check (paid_ref is null or char_length(paid_ref) <= 120),
  notes         text check (notes is null or char_length(notes) <= 1000),
  void_reason   text check (void_reason is null or char_length(void_reason) <= 300),
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists platform_invoices_number_key on public.platform_invoices (number) where number is not null;
create index if not exists platform_invoices_company_idx on public.platform_invoices (company_id, created_at desc);
create index if not exists platform_invoices_open_idx on public.platform_invoices (due_on) where status = 'issued';

create table if not exists public.platform_invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.platform_invoices (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  item_key    text references public.price_items (key) on update cascade on delete set null,
  description text not null check (char_length(btrim(description)) between 1 and 300),
  quantity    numeric(12, 2) not null check (quantity > 0),
  unit_price  numeric(14, 2) not null check (unit_price >= 0),
  amount      numeric(14, 2) not null,
  sort        integer not null default 0
);
create index if not exists platform_invoice_lines_invoice_idx on public.platform_invoice_lines (invoice_id, sort);

-- ---------------------------------------------------------------------
-- 5. Requests for services, add-ons and playbooks
-- ---------------------------------------------------------------------
create table if not exists public.service_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  item_key      text not null references public.price_items (key) on update cascade,
  quantity      numeric(12, 2) not null default 1 check (quantity > 0 and quantity <= 10000),
  note          text check (note is null or char_length(note) <= 1000),
  status        text not null default 'requested'
                check (status in ('requested', 'approved', 'delivered', 'declined', 'cancelled', 'ended')),
  requested_by  uuid default auth.uid() references auth.users (id) on delete set null,
  requested_at  timestamptz not null default now(),
  admin_note    text check (admin_note is null or char_length(admin_note) <= 1000),
  quoted_price  numeric(14, 2) check (quoted_price is null or quoted_price >= 0),   -- for items priced on request
  decided_by    uuid references auth.users (id) on delete set null,
  decided_at    timestamptz,
  invoice_id    uuid references public.platform_invoices (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists service_requests_company_idx on public.service_requests (company_id, requested_at desc);
create index if not exists service_requests_status_idx on public.service_requests (status, requested_at desc);
-- One waiting request per company and item.
create unique index if not exists service_requests_open_key on public.service_requests (company_id, item_key)
  where status = 'requested';

-- ---------------------------------------------------------------------
-- 6. Triggers and row-level security for the company tables
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['company_billing', 'platform_invoices', 'service_requests'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['company_billing', 'platform_invoices', 'platform_invoice_lines', 'service_requests'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['company_billing', 'platform_invoices', 'service_requests'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end;
$$;

-- Plan & billing: management and finance of the company, and the LeMo Tech team.
drop policy if exists company_billing_select on public.company_billing;
create policy company_billing_select on public.company_billing for select to authenticated
  using (public.has_role(company_id, array['management', 'finance']::public.app_role[]) or public.is_platform_admin());
-- Invoices: drafts are only for the LeMo Tech team.
drop policy if exists platform_invoices_select on public.platform_invoices;
create policy platform_invoices_select on public.platform_invoices for select to authenticated
  using ((status <> 'draft' and public.has_role(company_id, array['management', 'finance']::public.app_role[]))
         or public.is_platform_admin());
drop policy if exists platform_invoice_lines_select on public.platform_invoice_lines;
create policy platform_invoice_lines_select on public.platform_invoice_lines for select to authenticated
  using (exists (select 1 from public.platform_invoices i where i.id = invoice_id));
-- Requests: management and finance see all of the company's; everyone sees their own.
drop policy if exists service_requests_select on public.service_requests;
create policy service_requests_select on public.service_requests for select to authenticated
  using ((public.is_member(company_id)
          and (requested_by = auth.uid() or public.has_role(company_id, array['management', 'finance']::public.app_role[])))
         or public.is_platform_admin());

-- ---------------------------------------------------------------------
-- 7. Helpers
-- ---------------------------------------------------------------------
create or replace function public.fmt_billing_money(p_amount numeric, p_currency text)
returns text language sql immutable set search_path = ''
as $$
  select p_currency || ' ' || case when p_currency = 'TZS' then to_char(round(coalesce(p_amount, 0)), 'FM999,999,999,999,990')
                                   else to_char(coalesce(p_amount, 0), 'FM999,999,999,990.00') end;
$$;

-- The price of an item in a currency (null = priced on request).
create or replace function public.item_price(p_key text, p_currency text)
returns numeric language sql stable security definer set search_path = ''
as $$
  select case when p_currency = 'USD' then i.price_usd else i.price_tzs end
    from public.price_items i where i.key = p_key;
$$;

-- Tell management and finance of a company (billing news).
create or replace function public.notify_billing(p_company uuid, p_severity text, p_title text, p_body text, p_link text, p_key text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.notify_roles(p_company, array['management', 'finance']::public.app_role[], null, 'billing', p_severity,
                              p_title, p_body, p_link, p_key);
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Playbooks
-- ---------------------------------------------------------------------

-- May the signed-in person read this playbook now? (Approved for the company, a demo, or LeMo Tech.)
create or replace function public.has_playbook(p_company uuid, p_playbook text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_platform_admin()
      or (public.is_member(p_company)
          and (exists (select 1 from public.companies c where c.id = p_company and c.is_demo)
               or exists (select 1 from public.service_requests r
                            join public.price_items i on i.key = r.item_key
                           where r.company_id = p_company and i.playbook_id = p_playbook
                             and r.status in ('approved', 'delivered'))));
$$;

-- Every playbook in the price book with this company's state: 'granted', 'requested' or null.
create or replace function public.company_playbooks(p_company uuid)
returns table (playbook_id text, item_key text, state text, requested_at timestamptz, decided_at timestamptz, admin_note text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_demo boolean;
begin
  if not public.is_member(p_company) and not public.is_platform_admin() then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  select c.is_demo into v_demo from public.companies c where c.id = p_company;
  return query
    select i.playbook_id, i.key,
           case when coalesce(v_demo, false) then 'granted'
                when r.status in ('approved', 'delivered') then 'granted'
                when r.status = 'requested' then 'requested'
                when r.status = 'declined' then 'declined'
                when r.status = 'ended' then 'ended' end,
           r.requested_at, r.decided_at, r.admin_note
      from public.price_items i
      left join lateral (
        select x.status, x.requested_at, x.decided_at, x.admin_note
          from public.service_requests x
         where x.company_id = p_company and x.item_key = i.key and x.status <> 'cancelled'
         order by case x.status when 'approved' then 1 when 'delivered' then 1 when 'requested' then 2 else 3 end, x.requested_at desc
         limit 1) r on true
     where i.playbook_id is not null and i.active;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Company side: request and cancel
-- ---------------------------------------------------------------------

-- Playbooks: any team member. Everything else: management or finance (it is a purchase).
create or replace function public.request_service(p_company uuid, p_item text, p_quantity numeric default 1, p_note text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  i public.price_items;
  c public.companies;
  v_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_qty numeric := coalesce(p_quantity, 1);
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  select * into i from public.price_items where key = p_item and active;
  if i.key is null or not i.requestable then
    raise exception 'This service cannot be requested.' using errcode = '22023';
  end if;
  if i.playbook_id is null and not public.has_role(p_company, array['management', 'finance']::public.app_role[]) then
    raise exception 'Only management or finance can request paid services. Ask your manager.' using errcode = '42501';
  end if;
  if v_qty <= 0 or v_qty > 10000 then
    raise exception 'Choose a quantity between 1 and 10,000.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 1000 then
    raise exception 'Please keep the note under 1,000 characters.' using errcode = '22023';
  end if;
  select * into c from public.companies where id = p_company;
  if i.playbook_id is not null and public.has_playbook(p_company, i.playbook_id) then
    raise exception 'Your company already has this playbook.' using errcode = '22023';
  end if;
  if exists (select 1 from public.service_requests where company_id = p_company and item_key = p_item and status = 'requested') then
    raise exception 'This is already requested and waiting for LeMo Tech.' using errcode = '22023';
  end if;
  if (select count(*) from public.service_requests
       where company_id = p_company and requested_at > now() - interval '1 hour') >= 30 then
    raise exception 'Many requests were sent in the last hour. Please try again later.' using errcode = '54000';
  end if;

  insert into public.service_requests (company_id, item_key, quantity, note, requested_by)
  values (p_company, p_item, v_qty, v_note, auth.uid())
  returning id into v_id;

  if not c.is_demo then
    begin
      perform public.platform_notify('service_request',
        case when i.playbook_id is not null then 'Playbook requested: ' else 'Service requested: ' end || i.name,
        c.name || case when v_qty <> 1 then ' · × ' || trim(to_char(v_qty, 'FM999,990.##')) else '' end
          || coalesce(' · ' || left(v_note, 200), ''),
        '/admin/billing/requests', 'attention', p_company, 'service-request:' || v_id::text);
    exception when others then
      raise warning 'Platform notification (service request) failed: %', sqlerrm;
    end;
  end if;
  return v_id;
end;
$$;

-- The person who asked, or management: take back a waiting request.
create or replace function public.cancel_service_request(p_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.service_requests;
begin
  select * into r from public.service_requests where id = p_id for update;
  if r.id is null or not public.is_member(r.company_id) then
    raise exception 'Request not found.' using errcode = '42501';
  end if;
  if r.requested_by is distinct from auth.uid() and not public.is_manager(r.company_id) then
    raise exception 'Only the person who asked, or management, can cancel this request.' using errcode = '42501';
  end if;
  if r.status <> 'requested' then
    raise exception 'Only a waiting request can be cancelled.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.service_requests set status = 'cancelled' where id = p_id;
end;
$$;

-- Management: the company's name, email and TIN for LeMo Tech's invoices.
create or replace function public.set_billing_details(p_company uuid, p_name text, p_email text, p_tin text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can change the billing details.' using errcode = '42501';
  end if;
  if char_length(coalesce(p_name, '')) > 160 or char_length(coalesce(p_email, '')) > 160 or char_length(coalesce(p_tin, '')) > 40 then
    raise exception 'One of the details is too long.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_email, '')), '') is not null and btrim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  insert into public.company_billing (company_id, billing_name, billing_email, billing_tin)
  values (p_company, nullif(btrim(p_name), ''), nullif(btrim(p_email), ''), nullif(btrim(p_tin), ''))
  on conflict (company_id) do update
    set billing_name = excluded.billing_name, billing_email = excluded.billing_email, billing_tin = excluded.billing_tin;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. LeMo Tech team (platform admin)
-- ---------------------------------------------------------------------

-- Approve, decline, mark delivered or end a request. Approving an add-on switches its features on;
-- ending it puts them back to the level default. A playbook opens when approved.
create or replace function public.admin_decide_request(p_id uuid, p_action text, p_note text default null,
                                                       p_quoted_price numeric default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.service_requests;
  i public.price_items;
  v_status text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  k text;
  m record;
begin
  perform public.require_platform_admin();
  select * into r from public.service_requests where id = p_id for update;
  if r.id is null then
    raise exception 'Request not found.' using errcode = '22023';
  end if;
  select * into i from public.price_items where key = r.item_key;
  v_status := case p_action when 'approve' then 'approved' when 'decline' then 'declined'
                            when 'deliver' then 'delivered' when 'end' then 'ended' end;
  if v_status is null then
    raise exception 'Choose approve, decline, delivered or end.' using errcode = '22023';
  end if;
  if (p_action in ('approve', 'decline') and r.status <> 'requested')
     or (p_action = 'deliver' and r.status not in ('requested', 'approved'))
     or (p_action = 'end' and r.status not in ('approved', 'delivered')) then
    raise exception 'This request is % and cannot be changed that way.', r.status using errcode = '22023';
  end if;
  if char_length(coalesce(v_note, '')) > 1000 then
    raise exception 'Please keep the note under 1,000 characters.' using errcode = '22023';
  end if;
  if p_quoted_price is not null and p_quoted_price < 0 then
    raise exception 'The price cannot be negative.' using errcode = '22023';
  end if;

  perform set_config('ims.status_change', 'on', true);
  update public.service_requests
     set status = v_status, admin_note = coalesce(v_note, admin_note),
         quoted_price = coalesce(p_quoted_price, quoted_price),
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;

  -- Add-on modules follow the request.
  if i.category = 'addon' and cardinality(i.feature_keys) > 0 then
    foreach k in array i.feature_keys loop
      if exists (select 1 from public.features f where f.key = k and f.status = 'live' and f.active) then
        if v_status in ('approved', 'delivered') and r.status = 'requested' then
          perform public.apply_company_feature(r.company_id, k, true, 'admin');
        elsif v_status = 'ended' then
          perform public.apply_company_feature(r.company_id, k, null, 'admin');
        end if;
      end if;
    end loop;
  end if;

  -- Tell the person who asked (or management when LeMo Tech added it).
  for m in
    select ms.user_id from public.memberships ms
     where ms.company_id = r.company_id and ms.active
       and (ms.user_id = r.requested_by or (r.requested_by is null and ms.role = 'management'))
  loop
    perform public.notify(r.company_id, m.user_id, case when i.playbook_id is null then 'service' else 'playbook' end,
      case when v_status = 'declined' then 'attention' else 'info' end,
      case v_status
        when 'approved' then case when i.playbook_id is not null then 'Playbook ready: ' else 'Request approved: ' end || i.name
        when 'delivered' then 'Done: ' || i.name
        when 'declined' then 'Request not approved: ' || i.name
        else 'Ended: ' || i.name end,
      coalesce(v_note, case when v_status = 'approved' and i.playbook_id is not null
                            then 'Open Playbooks to read it or download the PDF.'
                            else 'From the LeMo Tech team.' end),
      case when i.playbook_id is not null and v_status in ('approved', 'delivered') then '/playbooks/' || i.playbook_id
           else '/services' end,
      'service-' || p_id::text || '-' || v_status);
  end loop;
end;
$$;

-- Give a company an item without a request (for example a playbook as a gift, or a service agreed by phone).
create or replace function public.admin_grant_item(p_company uuid, p_item text, p_quantity numeric default 1, p_note text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_open uuid;
begin
  perform public.require_platform_admin();
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'Company not found.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.price_items where key = p_item) then
    raise exception 'Unknown item.' using errcode = '22023';
  end if;
  select id into v_open from public.service_requests where company_id = p_company and item_key = p_item and status = 'requested';
  if v_open is not null then
    perform public.admin_decide_request(v_open, 'approve', p_note);
    return v_open;
  end if;
  insert into public.service_requests (company_id, item_key, quantity, note, requested_by)
  values (p_company, p_item, greatest(coalesce(p_quantity, 1), 0.01), null, null)
  returning id into v_id;
  perform public.admin_decide_request(v_id, 'approve', coalesce(nullif(btrim(p_note), ''), 'Added for you by the LeMo Tech team.'));
  return v_id;
end;
$$;

-- Add or change a price book item.
create or replace function public.admin_save_price_item(p jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_key text := btrim(coalesce(p ->> 'key', ''));
begin
  perform public.require_platform_admin();
  if v_key !~ '^[a-z][a-z0-9_-]{1,59}$' then
    raise exception 'The key must be 2 to 60 small letters, numbers, - or _.' using errcode = '22023';
  end if;
  insert into public.price_items (key, category, name, description, unit, price_tzs, price_usd, level, included_users,
                                  feature_keys, playbook_id, requestable, public, active, sort)
  values (v_key, p ->> 'category', btrim(p ->> 'name'), coalesce(btrim(p ->> 'description'), ''), coalesce(p ->> 'unit', 'once'),
          nullif(p ->> 'price_tzs', '')::numeric, nullif(p ->> 'price_usd', '')::numeric,
          nullif(p ->> 'level', '')::public.business_level, nullif(p ->> 'included_users', '')::integer,
          coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'feature_keys', '[]'::jsonb))), '{}'),
          nullif(p ->> 'playbook_id', ''),
          coalesce((p ->> 'requestable')::boolean, true), coalesce((p ->> 'public')::boolean, false),
          coalesce((p ->> 'active')::boolean, true), coalesce(nullif(p ->> 'sort', '')::integer, 100))
  on conflict (key) do update
    set category = excluded.category, name = excluded.name, description = excluded.description, unit = excluded.unit,
        price_tzs = excluded.price_tzs, price_usd = excluded.price_usd, level = excluded.level,
        included_users = excluded.included_users, feature_keys = excluded.feature_keys,
        playbook_id = excluded.playbook_id, requestable = excluded.requestable, public = excluded.public,
        active = excluded.active, sort = excluded.sort;
end;
$$;

-- LeMo Tech's own details, VAT and pricing rate.
create or replace function public.admin_save_billing_settings(p jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  update public.platform_billing_settings
     set legal_name   = coalesce(nullif(btrim(p ->> 'legal_name'), ''), legal_name),
         tin          = coalesce(btrim(p ->> 'tin'), tin),
         vrn          = coalesce(btrim(p ->> 'vrn'), vrn),
         address      = coalesce(btrim(p ->> 'address'), address),
         phone        = coalesce(btrim(p ->> 'phone'), phone),
         email        = coalesce(btrim(p ->> 'email'), email),
         bank_details = coalesce(btrim(p ->> 'bank_details'), bank_details),
         mobile_money = coalesce(btrim(p ->> 'mobile_money'), mobile_money),
         vat_rate     = coalesce(nullif(p ->> 'vat_rate', '')::numeric, vat_rate),
         usd_rate     = coalesce(nullif(p ->> 'usd_rate', '')::numeric, usd_rate),
         payment_days = coalesce(nullif(p ->> 'payment_days', '')::integer, payment_days),
         invoice_note = coalesce(btrim(p ->> 'invoice_note'), invoice_note),
         updated_at   = now()
   where id;
end;
$$;

-- A company's plan terms and account status.
create or replace function public.admin_set_company_billing(p_company uuid, p_currency text, p_cycle text, p_discount numeric,
                                                            p_founding boolean, p_status text, p_trial_ends date,
                                                            p_next_invoice date)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_old text;
begin
  perform public.require_platform_admin();
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'Company not found.' using errcode = '22023';
  end if;
  select status into v_old from public.company_billing where company_id = p_company;
  insert into public.company_billing (company_id, currency, cycle, discount_pct, founding, status, trial_ends_on, next_invoice_on)
  values (p_company, coalesce(p_currency, 'TZS'), coalesce(p_cycle, 'monthly'), coalesce(p_discount, 0), coalesce(p_founding, false),
          coalesce(p_status, 'trial'), p_trial_ends, p_next_invoice)
  on conflict (company_id) do update
    set currency = excluded.currency, cycle = excluded.cycle, discount_pct = excluded.discount_pct,
        founding = excluded.founding, status = excluded.status, trial_ends_on = excluded.trial_ends_on,
        next_invoice_on = excluded.next_invoice_on;
  if v_old is distinct from coalesce(p_status, 'trial') and p_status in ('grace', 'read_only', 'suspended') then
    perform public.notify_billing(p_company, 'urgent',
      case p_status when 'grace' then 'LeMoSp payment overdue'
                    when 'read_only' then 'LeMoSp account is read-only until payment'
                    else 'LeMoSp account suspended' end,
      'Open Plan & billing to see the invoice and how to pay. Your data is safe and can always be exported.',
      '/settings/billing', 'billing-status-' || p_company::text || '-' || p_status || '-' || to_char(now(), 'YYYYMMDD'));
  end if;
end;
$$;

-- Create an invoice from lines [{item_key?, description, quantity, unit_price}]. Linked requests are marked billed.
-- p_issue = true issues it at once (number, dates, notice to the company); otherwise it stays a draft.
create or replace function public.admin_create_invoice(p_company uuid, p_currency text, p_lines jsonb, p_period_start date default null,
                                                       p_period_end date default null, p_notes text default null,
                                                       p_request_ids uuid[] default '{}', p_issue boolean default false,
                                                       p_discount_pct numeric default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  l jsonb;
  n integer := 0;
  v_qty numeric;
  v_price numeric;
  v_desc text;
  v_key text;
  v_sub numeric := 0;
  v_disc_pct numeric;
  v_disc numeric;
  v_vat_rate numeric;
  v_vat numeric;
  v_dp integer;
begin
  perform public.require_platform_admin();
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'Company not found.' using errcode = '22023';
  end if;
  if p_currency not in ('TZS', 'USD') then
    raise exception 'Choose TZS or USD.' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one line.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 100 then
    raise exception 'An invoice can have at most 100 lines.' using errcode = '22023';
  end if;
  v_dp := case when p_currency = 'TZS' then 0 else 2 end;
  v_disc_pct := coalesce(p_discount_pct, (select discount_pct from public.company_billing where company_id = p_company), 0);
  if v_disc_pct < 0 or v_disc_pct > 100 then
    raise exception 'The discount must be between 0 and 100%%.' using errcode = '22023';
  end if;
  select vat_rate into v_vat_rate from public.platform_billing_settings where id;

  insert into public.platform_invoices (company_id, currency, period_start, period_end, notes, vat_rate, discount_pct)
  values (p_company, p_currency, p_period_start, p_period_end, nullif(btrim(coalesce(p_notes, '')), ''), coalesce(v_vat_rate, 0), v_disc_pct)
  returning id into v_id;

  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    v_key := nullif(l ->> 'item_key', '');
    if v_key is not null and not exists (select 1 from public.price_items where key = v_key) then
      raise exception 'Line %: unknown price book item.', n using errcode = '22023';
    end if;
    v_qty := coalesce(nullif(l ->> 'quantity', '')::numeric, 1);
    v_price := coalesce(nullif(l ->> 'unit_price', '')::numeric, public.item_price(v_key, p_currency));
    v_desc := coalesce(nullif(btrim(l ->> 'description'), ''), (select name from public.price_items where key = v_key));
    if v_qty <= 0 or v_price is null or v_price < 0 or v_desc is null then
      raise exception 'Line %: give a description, a quantity above 0 and a price.', n using errcode = '22023';
    end if;
    insert into public.platform_invoice_lines (invoice_id, company_id, item_key, description, quantity, unit_price, amount, sort)
    values (v_id, p_company, v_key, left(v_desc, 300), v_qty, round(v_price, v_dp), round(v_qty * v_price, v_dp), n);
    v_sub := v_sub + round(v_qty * v_price, v_dp);
  end loop;

  v_disc := round(v_sub * v_disc_pct / 100, v_dp);
  v_vat := round((v_sub - v_disc) * coalesce(v_vat_rate, 0) / 100, v_dp);
  update public.platform_invoices
     set subtotal = v_sub, discount = v_disc, vat = v_vat, total = v_sub - v_disc + v_vat
   where id = v_id;

  if cardinality(coalesce(p_request_ids, '{}')) > 0 then
    update public.service_requests set invoice_id = v_id
     where id = any (p_request_ids) and company_id = p_company and invoice_id is null;
  end if;
  if p_issue then
    perform public.admin_issue_invoice(v_id);
  end if;
  return v_id;
end;
$$;

-- Issue a draft: number, dates and a notice to management and finance.
create or replace function public.admin_issue_invoice(p_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  inv public.platform_invoices;
  v_no integer;
  v_days integer;
  v_number text;
begin
  perform public.require_platform_admin();
  select * into inv from public.platform_invoices where id = p_id for update;
  if inv.id is null then
    raise exception 'Invoice not found.' using errcode = '22023';
  end if;
  if inv.status <> 'draft' then
    raise exception 'Only a draft can be issued.' using errcode = '22023';
  end if;
  update public.platform_billing_settings set next_invoice_no = next_invoice_no + 1 where id
    returning next_invoice_no - 1, payment_days into v_no, v_days;
  v_number := 'LMS-' || to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY') || '-' || lpad(v_no::text, 4, '0');
  perform set_config('ims.status_change', 'on', true);
  update public.platform_invoices
     set status = 'issued', number = v_number,
         issued_on = (now() at time zone 'Africa/Dar_es_Salaam')::date,
         due_on = (now() at time zone 'Africa/Dar_es_Salaam')::date + coalesce(v_days, 7)
   where id = p_id;
  perform public.notify_billing(inv.company_id, 'attention', 'New LeMoSp invoice ' || v_number,
    public.fmt_billing_money(inv.total, inv.currency) || ' · due '
      || to_char((now() at time zone 'Africa/Dar_es_Salaam')::date + coalesce(v_days, 7), 'DD Mon YYYY'),
    '/settings/billing', 'platform-invoice-' || p_id::text || '-issued');
  return v_number;
end;
$$;

-- Record a payment (full or part). Paid in full → status paid, and a "thank you" notice.
create or replace function public.admin_record_invoice_payment(p_id uuid, p_amount numeric, p_method text, p_ref text,
                                                               p_paid_on date default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  inv public.platform_invoices;
  v_paid numeric;
begin
  perform public.require_platform_admin();
  select * into inv from public.platform_invoices where id = p_id for update;
  if inv.id is null then
    raise exception 'Invoice not found.' using errcode = '22023';
  end if;
  if inv.status <> 'issued' then
    raise exception 'Payments can only be recorded on an issued, unpaid invoice.' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount received.' using errcode = '22023';
  end if;
  v_paid := inv.paid_amount + p_amount;
  if v_paid > inv.total then
    raise exception 'That is more than the amount still due (%).', public.fmt_billing_money(inv.total - inv.paid_amount, inv.currency)
      using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.platform_invoices
     set paid_amount = v_paid,
         paid_on = coalesce(p_paid_on, (now() at time zone 'Africa/Dar_es_Salaam')::date),
         paid_method = left(nullif(btrim(coalesce(p_method, '')), ''), 60),
         paid_ref = left(nullif(btrim(coalesce(p_ref, '')), ''), 120),
         status = case when v_paid >= inv.total then 'paid' else 'issued' end
   where id = p_id;
  if v_paid >= inv.total then
    perform public.notify_billing(inv.company_id, 'info', 'Payment received: ' || inv.number,
      'Thank you. ' || public.fmt_billing_money(inv.total, inv.currency) || ' paid in full.',
      '/settings/billing', 'platform-invoice-' || p_id::text || '-paid');
    -- A company that was behind is active again once nothing is overdue.
    if not exists (select 1 from public.platform_invoices
                    where company_id = inv.company_id and status = 'issued' and due_on < current_date) then
      update public.company_billing set status = 'active'
       where company_id = inv.company_id and status in ('grace', 'read_only', 'suspended');
    end if;
  end if;
end;
$$;

-- Cancel an invoice (drafts or issued, never paid ones). Linked requests can be billed again.
create or replace function public.admin_void_invoice(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  inv public.platform_invoices;
begin
  perform public.require_platform_admin();
  select * into inv from public.platform_invoices where id = p_id for update;
  if inv.id is null then
    raise exception 'Invoice not found.' using errcode = '22023';
  end if;
  if inv.status not in ('draft', 'issued') or inv.paid_amount > 0 then
    raise exception 'Only a draft or an unpaid invoice can be cancelled.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a short reason.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.platform_invoices set status = 'void', void_reason = left(btrim(p_reason), 300) where id = p_id;
  update public.service_requests set invoice_id = null where invoice_id = p_id;
  if inv.status = 'issued' then
    perform public.notify_billing(inv.company_id, 'info', 'Invoice cancelled: ' || inv.number, left(btrim(p_reason), 300),
      '/settings/billing', 'platform-invoice-' || p_id::text || '-void');
  end if;
end;
$$;

-- Requests across companies (waiting first).
create or replace function public.platform_service_requests(p_status text default null, p_company uuid default null)
returns table (id uuid, company_id uuid, company_name text, business_level text, item_key text, item_name text,
               category text, playbook_id text, quantity numeric, note text, status text, requested_by_name text,
               requested_by_role text, requested_at timestamptz, admin_note text, quoted_price numeric,
               decided_at timestamptz, invoice_id uuid, price_tzs numeric, price_usd numeric, unit text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return query
    select r.id, r.company_id, c.name, c.business_level::text, r.item_key, i.name, i.category, i.playbook_id,
           r.quantity, r.note, r.status,
           case when r.requested_by is null then null
                else coalesce(nullif(btrim(p.full_name), ''), p.email, 'Team member') end,
           (select ms.role::text from public.memberships ms where ms.company_id = r.company_id and ms.user_id = r.requested_by),
           r.requested_at, r.admin_note, r.quoted_price, r.decided_at, r.invoice_id, i.price_tzs, i.price_usd, i.unit
      from public.service_requests r
      join public.companies c on c.id = r.company_id
      join public.price_items i on i.key = r.item_key
      left join public.profiles p on p.id = r.requested_by
     where (p_status is null or r.status = p_status)
       and (p_company is null or r.company_id = p_company)
       and (p_company is not null or not c.is_demo)
     order by (r.status = 'requested') desc, coalesce(r.decided_at, r.requested_at) desc
     limit 500;
end;
$$;

-- Billing across companies: one row per company (demos left out).
create or replace function public.platform_billing_overview()
returns table (company_id uuid, company_name text, business_level text, members bigint, status text, currency text,
               cycle text, discount_pct numeric, founding boolean, trial_ends_on date, next_invoice_on date,
               open_invoices bigint, overdue_invoices bigint, balance numeric, paid_this_month numeric,
               waiting_requests bigint)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return query
    select c.id, c.name, c.business_level::text,
           (select count(*) from public.memberships m where m.company_id = c.id and m.active),
           coalesce(b.status, 'trial'), coalesce(b.currency, 'TZS'), coalesce(b.cycle, 'monthly'),
           coalesce(b.discount_pct, 0), coalesce(b.founding, false), b.trial_ends_on, b.next_invoice_on,
           (select count(*) from public.platform_invoices i where i.company_id = c.id and i.status = 'issued'),
           (select count(*) from public.platform_invoices i where i.company_id = c.id and i.status = 'issued' and i.due_on < current_date),
           coalesce((select sum(i.total - i.paid_amount) from public.platform_invoices i where i.company_id = c.id and i.status = 'issued'), 0),
           coalesce((select sum(i.paid_amount) from public.platform_invoices i
                      where i.company_id = c.id and i.status in ('issued', 'paid')
                        and i.paid_on >= date_trunc('month', current_date)::date), 0),
           (select count(*) from public.service_requests r where r.company_id = c.id and r.status = 'requested')
      from public.companies c
      left join public.company_billing b on b.company_id = c.id
     where not c.is_demo
     order by c.name;
end;
$$;

-- The public price page (also before signing in): active items marked public.
create or replace function public.public_price_list()
returns table (key text, category text, name text, description text, unit text, price_tzs numeric, price_usd numeric,
               level text, included_users integer, sort integer)
language sql stable security definer set search_path = ''
as $$
  select i.key, i.category, i.name, i.description, i.unit, i.price_tzs, i.price_usd, i.level::text, i.included_users, i.sort
    from public.price_items i
   where i.active and i.public
   order by i.sort, i.name;
$$;

-- ---------------------------------------------------------------------
-- 11. Starting price book (from the pricing proposal, excluding VAT;
--     TZS 2,500 = USD 1). Existing items are not changed.
-- ---------------------------------------------------------------------
insert into public.price_items (key, category, name, description, unit, price_tzs, price_usd, level, included_users,
                                feature_keys, playbook_id, requestable, public, sort) values
  -- Plans
  ('plan_small', 'plan', 'Small plan', '3 users, 1 branch, 1 store, 2 GB. Quotations, invoices, stock, purchase orders, deliveries, payments, mobile money, 18 reports.', 'month', 50000, 20, 'small', 3, '{}', null, false, true, 10),
  ('plan_medium', 'plan', 'Medium plan', '10 users, up to 3 stores, 10 GB. Adds CRM, tenders, contracts, supplier comparison, batches & expiry, supplier bills, multi-currency, driver app, insights.', 'month', 150000, 60, 'medium', 10, '{}', null, false, true, 20),
  ('plan_enterprise', 'plan', 'Enterprise plan', '25 users, 3 branches, unlimited stores, 50 GB, priority support. Adds approval steps, budgets, cash-flow forecast, purchase planning, fleet, head-office figures, scheduled reports.', 'month', 450000, 180, 'enterprise', 25, '{}', null, false, true, 30),
  -- Monthly extras
  ('extra_user_small', 'extra', 'Extra user (Small)', 'Each person above the 3 included users.', 'user_month', 10000, 4, 'small', null, '{}', null, true, true, 10),
  ('extra_user_medium', 'extra', 'Extra user (Medium)', 'Each person above the 10 included users.', 'user_month', 12500, 5, 'medium', null, '{}', null, true, true, 20),
  ('extra_user_enterprise', 'extra', 'Extra user (Enterprise)', 'Each person above the 25 included users.', 'user_month', 15000, 6, 'enterprise', null, '{}', null, true, true, 30),
  ('extra_driver', 'extra', 'Driver account', 'Driver app only, on any plan.', 'user_month', 5000, 2, null, null, '{}', null, true, true, 40),
  ('extra_branch', 'extra', 'Extra branch', 'Medium or Enterprise: each branch adds stores, people and head-office figures.', 'month', 50000, 20, null, null, '{}', null, true, true, 50),
  ('extra_store_small', 'extra', 'Extra store (Small)', 'A second store without moving to Medium.', 'month', 15000, 6, null, null, '{}', null, true, true, 60),
  ('extra_storage', 'extra', 'Extra storage, 10 GB', 'For receipt photos, documents and delivery proofs.', 'month', 15000, 6, null, null, '{}', null, true, true, 70),
  ('extra_company', 'extra', 'Second company in the same group', '50% of that company''s plan; each company keeps its own data.', 'month', null, null, null, null, '{}', null, true, false, 80),
  -- Add-on modules
  ('addon_importer', 'addon', 'Importer pack', 'Multiple currencies and landed cost.', 'month', 30000, 12, null, null, '{multi_currency,landed_cost}', null, true, true, 10),
  ('addon_procurement', 'addon', 'Procurement pack', 'Supplier quotations & comparison, supplier bills & payables, purchase requisitions.', 'month', 40000, 16, null, null, '{supplier_rfqs,supplier_bills,payables,requisitions}', null, true, true, 20),
  ('addon_stock', 'addon', 'Stock pack', 'Multiple stores, batches & expiry, stock transfers, reorder levels.', 'month', 40000, 16, null, null, '{multi_warehouse,batch_expiry,stock_transfers,reorder_levels}', null, true, true, 30),
  ('addon_crm', 'addon', 'CRM & tenders pack', 'CRM pipeline, tenders, contracts & framework prices, documents library.', 'month', 40000, 16, null, null, '{crm_pipeline,tenders,contracts,documents}', null, true, true, 40),
  ('addon_driver', 'addon', 'Driver app & proof of delivery', 'Signature, photo and location, even offline.', 'month', 20000, 8, null, null, '{driver_app}', null, true, true, 50),
  ('addon_insights', 'addon', 'Business insights', 'Win rates, supplier punctuality, slow movers.', 'month', 20000, 8, null, null, '{bi_insights}', null, true, true, 60),
  ('addon_approvals', 'addon', 'Approval steps', 'Multi-level approvals for companies with several managers.', 'month', 30000, 12, null, null, '{approvals,advanced_approvals}', null, true, true, 70),
  ('addon_budgets', 'addon', 'Budgets & cash flow', 'Budgets vs actual and the 13/26-week cash-flow forecast.', 'month', 40000, 16, null, null, '{budgets,cashflow_forecast}', null, true, true, 80),
  ('addon_planning', 'addon', 'Purchase planning', 'Reorder points from sales history and lead times.', 'month', 30000, 12, null, null, '{demand_forecast}', null, true, true, 90),
  ('addon_fleet', 'addon', 'Fleet & vehicles', 'Up to 5 vehicles: insurance, inspection, service and fuel log. Each extra vehicle TZS 5,000 / USD 2.', 'month', 30000, 12, null, null, '{fleet_tracking}', null, true, true, 100),
  ('addon_branches', 'addon', 'Branches & head-office figures', 'Includes 2 branches: consolidated sales, profit and stock per branch.', 'month', 60000, 24, null, null, '{branches,consolidated_reports}', null, true, true, 110),
  ('addon_scheduled_reports', 'addon', 'Scheduled reports', 'Reports emailed every day, week or month.', 'month', 15000, 6, null, null, '{scheduled_reports}', null, true, true, 120),
  ('addon_assistant', 'addon', 'AI business assistant', '300 questions a month (included in Enterprise up to 300).', 'month', 30000, 12, null, null, '{ai_assistant}', null, true, true, 130),
  ('addon_api', 'addon', 'Integrations & API', 'API keys and the data API for your own systems, with usage limits.', 'month', 100000, 40, null, null, '{integrations}', null, true, true, 140),
  -- Usage bundles
  ('usage_sms_1000', 'usage', 'SMS bundle, 1,000 messages', 'Reminders and notices by SMS; unused messages carry over for 12 months.', 'bundle', 35000, 14, null, null, '{}', null, true, true, 10),
  ('usage_sms_5000', 'usage', 'SMS bundle, 5,000 messages', 'Volume price.', 'bundle', 150000, 60, null, null, '{}', null, true, true, 20),
  ('usage_whatsapp_1000', 'usage', 'WhatsApp bundle, 1,000 messages', 'Reminders and invoices on WhatsApp.', 'bundle', 60000, 24, null, null, '{}', null, true, true, 30),
  ('usage_ai_500', 'usage', 'AI assistant, 500 more questions', 'Top-up pack for heavy use.', 'bundle', 25000, 10, null, null, '{}', null, true, true, 40),
  -- Setup and data
  ('setup_small', 'setup', 'Setup & onboarding (Small)', 'Company profile, logo, first users and one remote walkthrough.', 'once', 150000, 60, 'small', null, '{}', null, true, true, 10),
  ('setup_medium', 'setup', 'Setup & onboarding (Medium)', 'Roles, approval limits, stores, currencies, document settings, 2 remote sessions.', 'once', 500000, 200, 'medium', null, '{}', null, true, true, 20),
  ('setup_enterprise', 'setup', 'Setup & onboarding (Enterprise)', 'Branches, approval steps, scheduled reports, security policy, project kick-off.', 'once', 1500000, 600, 'enterprise', null, '{}', null, true, true, 30),
  ('data_import', 'setup', 'Data import', 'Clients, suppliers and products from your clean Excel (up to 2,000 rows).', 'once', 200000, 80, null, null, '{}', null, true, true, 40),
  ('data_import_extra', 'setup', 'Data import, each extra 1,000 rows', 'Checking and fixing larger lists.', 'once', 50000, 20, null, null, '{}', null, true, false, 50),
  ('opening_balances', 'setup', 'Opening stock & balances', 'Opening stock per store, unpaid invoices and supplier balances, checked with you.', 'once', 250000, 100, null, null, '{}', null, true, true, 60),
  ('migration', 'setup', 'Move from another system', 'From QuickBooks, Tally, Excel books or another POS. Quoted after seeing the old data (about TZS 600,000 to 1,500,000).', 'once', null, null, null, null, '{}', null, true, true, 70),
  ('own_domain', 'setup', 'Your own web address', 'For example app.yourcompany.co.tz: DNS and certificate set-up; the domain itself is paid by you.', 'once', 100000, 40, null, null, '{}', null, true, true, 80),
  ('doc_template', 'setup', 'Custom document template', 'A quotation, invoice, delivery note or purchase order in your own design.', 'once', 150000, 60, null, null, '{}', null, true, true, 90),
  ('doc_pack', 'setup', 'Branded document pack (5 templates)', 'All main documents in your house style.', 'once', 500000, 200, null, null, '{}', null, true, true, 100),
  -- Training
  ('training_remote', 'training', 'Training: remote session (2 hours)', 'Video call for up to 10 people.', 'once', 100000, 40, null, null, '{}', null, true, true, 10),
  ('training_half_day', 'training', 'Training: on-site, half day (Dar es Salaam)', 'Hands-on with phones and laptops at your office.', 'once', 300000, 120, null, null, '{}', null, true, true, 20),
  ('training_full_day', 'training', 'Training: on-site, full day (Dar es Salaam)', 'Usually needed for Enterprise launches.', 'day', 500000, 200, null, null, '{}', null, true, true, 30),
  ('training_upcountry', 'training', 'Training outside Dar es Salaam', 'Full-day rate plus transport, accommodation and TZS 150,000 a night. Quoted on request.', 'day', null, null, null, null, '{}', null, true, true, 40),
  -- Support
  ('support_priority', 'support', 'Priority support', 'Answer within 4 working hours, Saturday mornings, phone calls, a refresher session each quarter. Included in Enterprise.', 'month', 100000, 40, null, null, '{}', null, true, true, 10),
  ('support_premium', 'support', 'Premium support (SLA)', '1 hour for critical issues, 7 days a week, named contact, monthly review call, 99.5% availability target.', 'month', 300000, 120, null, null, '{}', null, true, true, 20),
  ('support_visit', 'support', 'On-site support visit (Dar es Salaam)', 'Up to 3 hours at your office.', 'visit', 150000, 60, null, null, '{}', null, true, true, 30),
  -- Other services
  ('custom_dev_hour', 'service', 'Custom development, per hour', 'New reports, fields or screens for your company, quoted in advance.', 'hour', 120000, 48, null, null, '{}', null, true, true, 10),
  ('custom_dev_day', 'service', 'Custom development, per day', 'Larger custom work, quoted in advance.', 'day', 800000, 320, null, null, '{}', null, true, true, 20),
  ('integration_standard', 'service', 'Standard integration', 'Accounting export, bank or payment link. From TZS 750,000, plus TZS 50,000 a month upkeep; quoted per integration.', 'once', null, null, null, null, '{}', null, true, true, 30),
  ('efd_vfd_setup', 'service', 'TRA EFD/VFD connection: setup', 'Connect your VFD/EFD provider and test fiscal receipts with TRA.', 'once', 500000, 200, null, null, '{}', null, true, true, 40),
  ('efd_vfd_monthly', 'service', 'TRA EFD/VFD connection: monthly, per branch', 'Monitoring, failed-receipt alerts and updates when TRA changes rules. Provider fees are separate.', 'month', 50000, 20, null, null, '{}', null, true, true, 50),
  ('dedicated_hosting_setup', 'service', 'Dedicated hosting: setup (Enterprise)', 'Your own database and web address, separate from other companies.', 'once', 2500000, 1000, null, null, '{}', null, true, false, 60),
  ('dedicated_hosting', 'service', 'Dedicated hosting: monthly', 'On top of the plan.', 'month', 750000, 300, null, null, '{}', null, true, false, 70),
  ('assisted_export', 'service', 'Assisted full export / handover', 'LeMo Tech prepares a checked export. Exporting yourself in Settings is always free.', 'once', 150000, 60, null, null, '{}', null, true, false, 80),
  ('backup_restore', 'service', 'Restore an earlier backup', 'The first restore each year is free.', 'once', 200000, 80, null, null, '{}', null, true, false, 90),
  ('reactivation', 'service', 'Account reactivation after archiving', 'Free if paid within 90 days of suspension.', 'once', 100000, 40, null, null, '{}', null, false, false, 100),
  -- Playbooks (step-by-step guides with PDFs; given on request)
  ('playbook_setup', 'playbook', 'Playbook: Set up LeMoSp, step by step', 'Company details, team and roles, products, clients and suppliers, security and going live.', 'once', 0, 0, null, null, '{}', 'setup', true, true, 10),
  ('playbook_order_to_cash', 'playbook', 'Playbook: From request to payment', 'RFQ, quotation, purchase order, goods received, delivery, invoice and payment, with real situations.', 'once', 30000, 12, null, null, '{}', 'order-to-cash', true, true, 20),
  ('playbook_getting_paid', 'playbook', 'Playbook: Getting paid on time', 'Credit, reminders, statements, mobile money and collecting what is owed.', 'once', 30000, 12, null, null, '{}', 'getting-paid', true, true, 30),
  ('playbook_stock', 'playbook', 'Playbook: Stock that adds up', 'Stores, counts, batches and expiry, transfers and reorder levels.', 'once', 30000, 12, null, null, '{}', 'stock', true, true, 40),
  ('playbook_analytics', 'playbook', 'Playbook: Numbers and decisions', 'Reports, profit, insights and what to do with them.', 'once', 30000, 12, null, null, '{}', 'analytics', true, true, 50),
  ('playbook_routines', 'playbook', 'Playbook: Daily, weekly and monthly routines', 'What each role checks and does, every day, week and month.', 'once', 30000, 12, null, null, '{}', 'routines', true, true, 60),
  ('playbook_security', 'playbook', 'Playbook: Security and safe working', 'Two-step verification, roles, devices, backups and what to do when something goes wrong.', 'once', 30000, 12, null, null, '{}', 'security', true, true, 70),
  ('playbook_enterprise', 'playbook', 'Playbook: Running a bigger business', 'Branches, approval steps, budgets, cash flow, purchase planning and fleet.', 'once', 50000, 20, null, null, '{}', 'enterprise', true, true, 80),
  ('playbook_connect', 'playbook', 'Playbook: Connect and automate', 'Business assistant, integrations, API keys and scheduled reports.', 'once', 50000, 20, null, null, '{}', 'connect', true, true, 90)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 12. Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.fmt_billing_money(numeric, text),
  public.item_price(text, text),
  public.notify_billing(uuid, text, text, text, text, text),
  public.has_playbook(uuid, text),
  public.company_playbooks(uuid),
  public.request_service(uuid, text, numeric, text),
  public.cancel_service_request(uuid),
  public.set_billing_details(uuid, text, text, text),
  public.admin_decide_request(uuid, text, text, numeric),
  public.admin_grant_item(uuid, text, numeric, text),
  public.admin_save_price_item(jsonb),
  public.admin_save_billing_settings(jsonb),
  public.admin_set_company_billing(uuid, text, text, numeric, boolean, text, date, date),
  public.admin_create_invoice(uuid, text, jsonb, date, date, text, uuid[], boolean, numeric),
  public.admin_issue_invoice(uuid),
  public.admin_record_invoice_payment(uuid, numeric, text, text, date),
  public.admin_void_invoice(uuid, text),
  public.platform_service_requests(text, uuid),
  public.platform_billing_overview(),
  public.public_price_list()
from public, anon;
grant execute on function
  public.has_playbook(uuid, text),
  public.company_playbooks(uuid),
  public.request_service(uuid, text, numeric, text),
  public.cancel_service_request(uuid),
  public.set_billing_details(uuid, text, text, text),
  public.admin_decide_request(uuid, text, text, numeric),
  public.admin_grant_item(uuid, text, numeric, text),
  public.admin_save_price_item(jsonb),
  public.admin_save_billing_settings(jsonb),
  public.admin_set_company_billing(uuid, text, text, numeric, boolean, text, date, date),
  public.admin_create_invoice(uuid, text, jsonb, date, date, text, uuid[], boolean, numeric),
  public.admin_issue_invoice(uuid),
  public.admin_record_invoice_payment(uuid, numeric, text, text, date),
  public.admin_void_invoice(uuid, text),
  public.platform_service_requests(text, uuid),
  public.platform_billing_overview()
to authenticated;
-- The price page is public, like the plans on the website.
grant execute on function public.public_price_list() to anon, authenticated;
