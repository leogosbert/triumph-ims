-- =====================================================================
-- LeMoSp  ·  Stage 14 (part 1): CRM, tenders, contracts, documents
--
--   CRM             opportunities (OPP-) from first contact to won/lost,
--                   with a pipeline by stage; calls, visits, meetings and
--                   messages logged on an opportunity or a client; important
--                   dates (birthdays, renewals) with reminders. A quotation
--                   linked to an opportunity moves it to won or lost when the
--                   client answers.
--   Tenders         tenders and bids (TND-) with closing date and time, bid
--                   security, a preparation checklist and the result.
--   Contracts       client contracts (CTR-) with validity and agreed prices
--                   per product; draft quotations can take the contract
--                   prices in one step; alerts before a contract ends.
--   Documents       a library of certificates, licences, SDS, CoAs, contracts
--                   and tender papers (private "documents" storage bucket),
--                   linked to a product, supplier, client, tender or
--                   contract, with alerts before they expire.
--
-- Also: alerts, test-data reset, demos, the feature catalogue (CRM, tenders,
-- contracts, documents and bank reconciliation go live) and storage clean-up
-- for closed and demo companies.
--
-- Safe to run more than once. Run the Stage 13 update first.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Numbering: OPP-, TND-, CTR-
-- ---------------------------------------------------------------------
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
                when 'opportunities' then 'OPP-'
                when 'tenders' then 'TND-'
                when 'contracts' then 'CTR-'
                when 'stock_transfers' then 'TRF-'
                when 'requisitions' then 'REQ-'
                else 'DOC-' end || v_year || '-';
  new.number := public.next_code(new.company_id, tg_table_name || '-' || v_year, v_prefix, 4);
  return new;
end;
$$;

-- Who may work on sales follow-up (CRM, tenders, contracts).
create or replace function public.crm_roles()
returns public.app_role[] language sql immutable set search_path = ''
as $$ select array['management', 'sales']::public.app_role[]; $$;

-- ---------------------------------------------------------------------
-- 2. Opportunities (the sales pipeline)
-- ---------------------------------------------------------------------
create table if not exists public.opportunities (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  number          text not null default '',
  title           text not null check (char_length(btrim(title)) between 2 and 200),
  client_id       uuid,
  -- A prospect that is not a client yet.
  prospect_name   text check (prospect_name is null or char_length(prospect_name) <= 200),
  contact_name    text check (contact_name is null or char_length(contact_name) <= 120),
  contact_phone   text check (contact_phone is null or char_length(contact_phone) <= 40),
  contact_email   text check (contact_email is null or char_length(contact_email) <= 200),
  source          text not null default 'other'
                  check (source in ('referral', 'walk_in', 'phone', 'whatsapp', 'website', 'tender', 'visit',
                                    'existing_client', 'social_media', 'other')),
  stage           text not null default 'lead'
                  check (stage in ('lead', 'qualified', 'quoted', 'negotiation', 'won', 'lost')),
  value           numeric(18, 2) not null default 0 check (value >= 0),
  currency        text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  probability     integer not null default 10 check (probability between 0 and 100),
  expected_close  date,
  owner_id        uuid references auth.users (id) on delete set null,
  quotation_id    uuid,
  next_action     text check (next_action is null or char_length(next_action) <= 300),
  next_on         date,
  lost_reason     text,
  notes           text check (notes is null or char_length(notes) <= 2000),
  closed_at       timestamptz,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  check (client_id is not null or coalesce(btrim(prospect_name), '') <> ''),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id) on delete set null (quotation_id)
);
create index if not exists opportunities_company_stage_idx on public.opportunities (company_id, stage, expected_close);
create index if not exists opportunities_client_idx on public.opportunities (client_id) where client_id is not null;
create index if not exists opportunities_owner_idx on public.opportunities (owner_id, stage);
create index if not exists opportunities_quotation_idx on public.opportunities (quotation_id) where quotation_id is not null;

create or replace function public.stage_probability(p_stage text)
returns integer language sql immutable set search_path = ''
as $$
  select case p_stage when 'lead' then 10 when 'qualified' then 25 when 'quoted' then 50
                      when 'negotiation' then 75 when 'won' then 100 else 0 end;
$$;

create or replace function public.prepare_opportunity()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.owner_id := coalesce(new.owner_id, auth.uid());
    if current_setting('ims.status_change', true) is distinct from 'on' then
      if new.stage in ('won', 'lost') then new.stage := 'lead'; end if;
      new.closed_at := null;
      new.lost_reason := null;
    end if;
    new.probability := public.stage_probability(new.stage);
  elsif current_setting('ims.status_change', true) is distinct from 'on' then
    if (new.stage, new.closed_at, new.lost_reason, new.number, new.created_by)
       is distinct from (old.stage, old.closed_at, old.lost_reason, old.number, old.created_by) then
      raise exception 'Use the buttons in the app to move the opportunity.' using errcode = '42501';
    end if;
  end if;
  new.title := btrim(new.title);
  new.prospect_name := nullif(btrim(new.prospect_name), '');
  new.contact_name := nullif(btrim(new.contact_name), '');
  new.contact_phone := nullif(btrim(new.contact_phone), '');
  new.contact_email := nullif(lower(btrim(new.contact_email)), '');
  new.next_action := nullif(btrim(new.next_action), '');
  new.notes := nullif(btrim(new.notes), '');
  if new.owner_id is not null and not public.is_active_member(new.company_id, new.owner_id) then
    raise exception 'The owner must be someone in the team.' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Move an opportunity along the pipeline (or reopen it).
create or replace function public.set_opportunity_stage(p_id uuid, p_stage text, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  o public.opportunities;
begin
  select * into o from public.opportunities where id = p_id for update;
  if o.id is null or not public.has_role(o.company_id, public.crm_roles()) then
    raise exception 'Opportunity not found.' using errcode = '42501';
  end if;
  if p_stage not in ('lead', 'qualified', 'quoted', 'negotiation', 'won', 'lost') then
    raise exception 'Unknown stage.' using errcode = '22023';
  end if;
  if p_stage = 'lost' and coalesce(btrim(p_reason), '') = '' then
    raise exception 'Say why the opportunity was lost (price, time, competitor...).' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.opportunities
     set stage = p_stage,
         probability = public.stage_probability(p_stage),
         closed_at = case when p_stage in ('won', 'lost') then coalesce(o.closed_at, now()) end,
         lost_reason = case when p_stage = 'lost' then left(btrim(p_reason), 500) end,
         next_on = case when p_stage in ('won', 'lost') then null else o.next_on end
   where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- A prospect becomes a client (the opportunity keeps its history).
create or replace function public.convert_opportunity_client(p_id uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  o public.opportunities;
  v_client uuid;
begin
  select * into o from public.opportunities where id = p_id for update;
  if o.id is null or not public.has_role(o.company_id, public.crm_roles()) then
    raise exception 'Opportunity not found.' using errcode = '42501';
  end if;
  if o.client_id is not null then
    return o.client_id;
  end if;
  select id into v_client from public.clients
   where company_id = o.company_id and lower(btrim(name)) = lower(o.prospect_name) limit 1;
  if v_client is null then
    insert into public.clients (company_id, name, created_by)
    values (o.company_id, o.prospect_name, auth.uid())
    returning id into v_client;
    if coalesce(o.contact_name, o.contact_phone, o.contact_email) is not null then
      insert into public.client_contacts (company_id, client_id, kind, name, email, phone)
      values (o.company_id, v_client, 'purchasing', o.contact_name, o.contact_email, o.contact_phone);
    end if;
  end if;
  update public.opportunities set client_id = v_client where id = p_id;
  return v_client;
end;
$$;

-- Link a quotation to an opportunity: the opportunity becomes "quoted" and takes the value.
create or replace function public.link_opportunity_quotation(p_id uuid, p_quotation uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  o public.opportunities;
  q public.quotations;
begin
  select * into o from public.opportunities where id = p_id for update;
  if o.id is null or not public.has_role(o.company_id, public.crm_roles()) then
    raise exception 'Opportunity not found.' using errcode = '42501';
  end if;
  select * into q from public.quotations where id = p_quotation and company_id = o.company_id;
  if q.id is null then raise exception 'Quotation not found.' using errcode = '22023'; end if;
  if o.client_id is not null and o.client_id <> q.client_id then
    raise exception 'The quotation is for another client.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.opportunities
     set quotation_id = q.id,
         client_id = q.client_id,
         value = case when q.total > 0 then q.subtotal else o.value end,
         currency = case when q.total > 0 then q.currency else o.currency end,
         stage = case when o.stage in ('lead', 'qualified') then 'quoted' else o.stage end,
         probability = public.stage_probability(case when o.stage in ('lead', 'qualified') then 'quoted' else o.stage end)
   where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- When the client answers a linked quotation, the opportunity is won or lost.
create or replace function public.sync_opportunity_from_quotation()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_flag text := current_setting('ims.status_change', true);
begin
  if new.status is distinct from old.status and new.status in ('accepted', 'rejected', 'sent') then
    perform set_config('ims.status_change', 'on', true);
    if new.status = 'sent' then
      update public.opportunities
         set value = new.subtotal, currency = new.currency
       where quotation_id = new.id and stage not in ('won', 'lost');
    else
      update public.opportunities
         set stage = case when new.status = 'accepted' then 'won' else 'lost' end,
             probability = case when new.status = 'accepted' then 100 else 0 end,
             closed_at = now(),
             value = case when new.status = 'accepted' then new.subtotal else value end,
             lost_reason = case when new.status = 'rejected' then coalesce(new.outcome_reason, 'Quotation rejected') end,
             next_on = null
       where quotation_id = new.id and stage not in ('won', 'lost');
    end if;
    perform set_config('ims.status_change', coalesce(nullif(v_flag, ''), 'off'), true);
  end if;
  -- A revision replaces the quotation: follow the new one.
  if new.status = 'superseded' and old.status is distinct from 'superseded' then
    perform set_config('ims.status_change', 'on', true);
    update public.opportunities o
       set quotation_id = r.id
      from public.quotations r
     where o.quotation_id = new.id and r.company_id = new.company_id and r.number = new.number
       and r.revision = (select max(x.revision) from public.quotations x where x.company_id = new.company_id and x.number = new.number);
    perform set_config('ims.status_change', coalesce(nullif(v_flag, ''), 'off'), true);
  end if;
  return null;
end;
$$;
drop trigger if exists quotations_sync_opportunity on public.quotations;
create trigger quotations_sync_opportunity after update of status on public.quotations
  for each row execute function public.sync_opportunity_from_quotation();

-- ---------------------------------------------------------------------
-- 3. Activities (calls, visits, meetings, messages) and important dates
-- ---------------------------------------------------------------------
create table if not exists public.crm_activities (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  opportunity_id  uuid,
  client_id       uuid,
  kind            text not null default 'call'
                  check (kind in ('call', 'visit', 'meeting', 'whatsapp', 'sms', 'email', 'note')),
  happened_on     date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  summary         text not null check (char_length(btrim(summary)) between 2 and 2000),
  location        text check (location is null or char_length(location) <= 200),
  next_action     text check (next_action is null or char_length(next_action) <= 300),
  next_on         date,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  check (num_nonnulls(opportunity_id, client_id) >= 1),
  foreign key (opportunity_id, company_id) references public.opportunities (id, company_id) on delete cascade,
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade
);
create index if not exists crm_activities_opp_idx on public.crm_activities (opportunity_id, happened_on desc) where opportunity_id is not null;
create index if not exists crm_activities_client_idx on public.crm_activities (client_id, happened_on desc) where client_id is not null;
create index if not exists crm_activities_company_idx on public.crm_activities (company_id, happened_on desc);

create or replace function public.prepare_crm_activity()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_client uuid;
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  new.summary := btrim(new.summary);
  new.location := nullif(btrim(new.location), '');
  new.next_action := nullif(btrim(new.next_action), '');
  if new.happened_on > (now() at time zone 'Africa/Dar_es_Salaam')::date + 1 then
    raise exception 'The date of the call or visit cannot be in the future.' using errcode = '22023';
  end if;
  -- On an opportunity of a known client, the activity also shows on the client.
  if new.opportunity_id is not null and new.client_id is null then
    select client_id into v_client from public.opportunities where id = new.opportunity_id;
    new.client_id := v_client;
  end if;
  return new;
end;
$$;

-- The next step agreed in a call or visit becomes the opportunity's next step.
create or replace function public.after_crm_activity()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.opportunity_id is not null and (new.next_on is not null or new.next_action is not null) then
    update public.opportunities
       set next_on = coalesce(new.next_on, next_on),
           next_action = coalesce(new.next_action, next_action)
     where id = new.opportunity_id and stage not in ('won', 'lost');
  end if;
  -- The person's open reminders for this opportunity are dealt with.
  if new.opportunity_id is not null then
    update public.notifications
       set read_at = now()
     where user_id = auth.uid() and company_id = new.company_id and read_at is null
       and kind = 'crm_followup' and link like '/crm/' || new.opportunity_id || '%';
  end if;
  return null;
end;
$$;

create table if not exists public.important_dates (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  client_id    uuid not null,
  title        text not null check (char_length(btrim(title)) between 2 and 200),
  kind         text not null default 'other'
               check (kind in ('birthday', 'anniversary', 'renewal', 'licence', 'holiday', 'other')),
  the_date     date not null,
  yearly       boolean not null default false,
  remind_days  integer not null default 3 check (remind_days between 0 and 90),
  notes        text check (notes is null or char_length(notes) <= 1000),
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade
);
create index if not exists important_dates_client_idx on public.important_dates (client_id);
create index if not exists important_dates_company_idx on public.important_dates (company_id, the_date);

-- Next time a date comes round (this year or next for yearly dates; once otherwise).
create or replace function public.next_occurrence(p_date date, p_yearly boolean, p_today date)
returns date language plpgsql immutable set search_path = ''
as $$
declare
  v date;
begin
  if not p_yearly then return p_date; end if;
  -- 29 February falls on 28 February in other years.
  v := make_date(extract(year from p_today)::int, extract(month from p_date)::int,
                 least(extract(day from p_date)::int,
                       extract(day from (make_date(extract(year from p_today)::int, extract(month from p_date)::int, 1)
                                         + interval '1 month - 1 day'))::int));
  if v < p_today then
    v := make_date(extract(year from p_today)::int + 1, extract(month from p_date)::int,
                   least(extract(day from p_date)::int,
                         extract(day from (make_date(extract(year from p_today)::int + 1, extract(month from p_date)::int, 1)
                                           + interval '1 month - 1 day'))::int));
  end if;
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Tenders
-- ---------------------------------------------------------------------
create table if not exists public.tenders (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  number               text not null default '',
  title                text not null check (char_length(btrim(title)) between 2 and 300),
  client_id            uuid,
  buyer_name           text check (buyer_name is null or char_length(buyer_name) <= 200),
  reference            text check (reference is null or char_length(reference) <= 120),
  category             text check (category is null or char_length(category) <= 120),
  published_on         date,
  site_visit_at        timestamptz,
  clarification_by     date,
  closing_at           timestamptz not null,
  submission           text check (submission is null or char_length(submission) <= 300),
  bid_security         numeric(18, 2) check (bid_security is null or bid_security >= 0),
  estimated_value      numeric(18, 2) check (estimated_value is null or estimated_value >= 0),
  our_price            numeric(18, 2) check (our_price is null or our_price >= 0),
  winning_price        numeric(18, 2) check (winning_price is null or winning_price >= 0),
  winner               text check (winner is null or char_length(winner) <= 200),
  currency             text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  status               text not null default 'preparing'
                       check (status in ('preparing', 'submitted', 'won', 'lost', 'no_bid', 'cancelled')),
  result_note          text,
  submitted_at         timestamptz,
  decided_at           timestamptz,
  owner_id             uuid references auth.users (id) on delete set null,
  opportunity_id       uuid,
  quotation_id         uuid,
  notes                text check (notes is null or char_length(notes) <= 2000),
  created_by           uuid default auth.uid() references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  check (client_id is not null or coalesce(btrim(buyer_name), '') <> ''),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (opportunity_id, company_id) references public.opportunities (id, company_id) on delete set null (opportunity_id),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id) on delete set null (quotation_id)
);
create index if not exists tenders_company_status_idx on public.tenders (company_id, status, closing_at);

create table if not exists public.tender_tasks (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  tender_id   uuid not null,
  title       text not null check (char_length(btrim(title)) between 2 and 200),
  due_on      date,
  assigned_to uuid references auth.users (id) on delete set null,
  done_at     timestamptz,
  done_by     uuid references auth.users (id) on delete set null,
  sort        integer not null default 0,
  created_at  timestamptz not null default now(),
  foreign key (tender_id, company_id) references public.tenders (id, company_id) on delete cascade
);
create index if not exists tender_tasks_tender_idx on public.tender_tasks (tender_id, sort);

-- The usual papers for a bid in Tanzania; editable per tender.
create or replace function public.default_tender_tasks()
returns text[] language sql immutable set search_path = ''
as $$
  select array['Buy / download the tender document', 'Business licence and certificate of incorporation',
               'TIN and VAT certificates', 'Tax clearance certificate', 'Bid security (bank guarantee or insurance bond)',
               'Price schedule signed and stamped', 'Technical proposal / product datasheets',
               'Power of attorney for the signatory', 'Submit (online or sealed envelope) and keep the receipt'];
$$;

create or replace function public.prepare_tender()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.owner_id := coalesce(new.owner_id, auth.uid());
    if current_setting('ims.status_change', true) is distinct from 'on' then
      new.status := 'preparing';
      new.submitted_at := null;
      new.decided_at := null;
    end if;
  elsif current_setting('ims.status_change', true) is distinct from 'on' then
    if (new.status, new.submitted_at, new.decided_at, new.number, new.created_by)
       is distinct from (old.status, old.submitted_at, old.decided_at, old.number, old.created_by) then
      raise exception 'Use the buttons in the app to change the tender status.' using errcode = '42501';
    end if;
  end if;
  new.title := btrim(new.title);
  new.buyer_name := nullif(btrim(new.buyer_name), '');
  new.reference := nullif(btrim(new.reference), '');
  if new.owner_id is not null and not public.is_active_member(new.company_id, new.owner_id) then
    raise exception 'The person responsible must be someone in the team.' using errcode = '22023';
  end if;
  return new;
end;
$$;

create or replace function public.add_tender_tasks()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.tender_tasks (company_id, tender_id, title, sort)
  select new.company_id, new.id, t.title, t.n * 10
    from unnest(public.default_tender_tasks()) with ordinality as t(title, n);
  return null;
end;
$$;

create or replace function public.set_tender_status(p_id uuid, p_status text, p_note text, p_winning_price numeric, p_winner text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  t public.tenders;
begin
  select * into t from public.tenders where id = p_id for update;
  if t.id is null or not public.has_role(t.company_id, public.crm_roles()) then
    raise exception 'Tender not found.' using errcode = '42501';
  end if;
  if p_status not in ('preparing', 'submitted', 'won', 'lost', 'no_bid', 'cancelled') then
    raise exception 'Unknown tender status.' using errcode = '22023';
  end if;
  if p_status = 'submitted' and t.our_price is null then
    raise exception 'Enter our bid price before marking the tender as submitted.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.tenders
     set status = p_status,
         submitted_at = case when p_status = 'preparing' then null
                             when p_status = 'submitted' then coalesce(t.submitted_at, now()) else t.submitted_at end,
         decided_at = case when p_status in ('won', 'lost', 'no_bid', 'cancelled') then now() end,
         result_note = case when p_status = 'preparing' then null else coalesce(nullif(btrim(p_note), ''), t.result_note) end,
         winning_price = coalesce(p_winning_price, t.winning_price),
         winner = coalesce(nullif(btrim(p_winner), ''), t.winner)
   where id = p_id;
  if t.opportunity_id is not null and p_status in ('won', 'lost') then
    update public.opportunities
       set stage = p_status, probability = public.stage_probability(p_status), closed_at = now(), next_on = null,
           lost_reason = case when p_status = 'lost' then coalesce(nullif(btrim(p_note), ''), 'Tender lost') end
     where id = t.opportunity_id and stage not in ('won', 'lost');
  end if;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

create or replace function public.set_tender_task_done(p_task uuid, p_done boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.tender_tasks where id = p_task;
  if v_company is null or not public.has_role(v_company, public.crm_roles()) then
    raise exception 'Task not found.' using errcode = '42501';
  end if;
  update public.tender_tasks
     set done_at = case when p_done then coalesce(done_at, now()) end,
         done_by = case when p_done then coalesce(done_by, auth.uid()) end
   where id = p_task;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Contracts and contract prices
-- ---------------------------------------------------------------------
create table if not exists public.contracts (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  number         text not null default '',
  client_id      uuid not null,
  title          text not null check (char_length(btrim(title)) between 2 and 200),
  reference      text check (reference is null or char_length(reference) <= 120),
  kind           text not null default 'framework' check (kind in ('framework', 'supply', 'service', 'other')),
  start_date     date not null,
  end_date       date not null,
  currency       text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  value_cap      numeric(18, 2) check (value_cap is null or value_cap >= 0),
  payment_terms  text,
  remind_days    integer not null default 30 check (remind_days between 0 and 180),
  notes          text check (notes is null or char_length(notes) <= 2000),
  cancelled_at   timestamptz,
  cancelled_reason text,
  tender_id      uuid,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, number),
  unique (id, company_id),
  check (end_date >= start_date),
  foreign key (client_id, company_id) references public.clients (id, company_id),
  foreign key (tender_id, company_id) references public.tenders (id, company_id) on delete set null (tender_id)
);
create index if not exists contracts_company_end_idx on public.contracts (company_id, end_date);
create index if not exists contracts_client_idx on public.contracts (client_id);

create table if not exists public.contract_prices (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  contract_id  uuid not null,
  product_id   uuid not null,
  unit_price   numeric(18, 2) not null check (unit_price >= 0),
  notes        text check (notes is null or char_length(notes) <= 300),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (contract_id, product_id),
  foreign key (contract_id, company_id) references public.contracts (id, company_id) on delete cascade,
  foreign key (product_id, company_id) references public.products (id, company_id)
);
create index if not exists contract_prices_product_idx on public.contract_prices (product_id);

create or replace function public.prepare_contract()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    if current_setting('ims.status_change', true) is distinct from 'on' then
      new.cancelled_at := null;
      new.cancelled_reason := null;
    end if;
  elsif current_setting('ims.status_change', true) is distinct from 'on' then
    if (new.cancelled_at, new.cancelled_reason, new.number, new.created_by)
       is distinct from (old.cancelled_at, old.cancelled_reason, old.number, old.created_by) then
      raise exception 'Use the buttons in the app to end the contract.' using errcode = '42501';
    end if;
    if old.cancelled_at is not null then
      raise exception 'This contract was ended early and can no longer be changed.' using errcode = '42501';
    end if;
  end if;
  new.title := btrim(new.title);
  new.reference := nullif(btrim(new.reference), '');
  return new;
end;
$$;

-- Prices cannot be changed on a contract that was ended early.
create or replace function public.guard_contract_prices()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.contracts where id = coalesce(new.contract_id, old.contract_id) and cancelled_at is not null) then
    raise exception 'This contract was ended early and can no longer be changed.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.cancel_contract(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  c public.contracts;
begin
  select * into c from public.contracts where id = p_id for update;
  if c.id is null or not public.has_role(c.company_id, public.crm_roles()) then
    raise exception 'Contract not found.' using errcode = '42501';
  end if;
  if c.cancelled_at is not null then return; end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Give a reason for ending the contract early.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.contracts set cancelled_at = now(), cancelled_reason = left(btrim(p_reason), 500) where id = p_id;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

-- Contract prices that apply to a client today, per product (the newest contract wins).
create or replace function public.client_contract_prices(p_client uuid, p_currency text)
returns table (product_id uuid, unit_price numeric, contract_id uuid, contract_number text, end_date date)
language sql stable security definer set search_path = ''
as $$
  select distinct on (cp.product_id) cp.product_id, cp.unit_price, c.id, c.number, c.end_date
    from public.contract_prices cp
    join public.contracts c on c.id = cp.contract_id
   where c.client_id = p_client
     and public.is_member(c.company_id)
     and c.cancelled_at is null
     and (now() at time zone 'Africa/Dar_es_Salaam')::date between c.start_date and c.end_date
     and (p_currency is null or c.currency = p_currency)
   order by cp.product_id, c.start_date desc, c.created_at desc;
$$;

-- Put the contract prices on a draft quotation's matching lines.
create or replace function public.apply_contract_prices(p_quotation uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  q public.quotations;
  v_n integer;
begin
  select * into q from public.quotations where id = p_quotation;
  if q.id is null or not public.has_role(q.company_id, array['management', 'sales']::public.app_role[]) then
    raise exception 'Quotation not found.' using errcode = '42501';
  end if;
  if q.status <> 'draft' then
    raise exception 'Only draft quotations can be changed. Create a revision instead.' using errcode = '22023';
  end if;
  update public.quotation_lines l
     set unit_price = p.unit_price, discount_pct = 0
    from public.client_contract_prices(q.client_id, q.currency) p
   where l.quotation_id = q.id and l.product_id = p.product_id
     and (l.unit_price, l.discount_pct) is distinct from (p.unit_price, 0::numeric);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Documents library
-- ---------------------------------------------------------------------
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 2 and 200),
  kind          text not null default 'other'
                check (kind in ('certificate', 'licence', 'sds', 'coa', 'datasheet', 'contract', 'tender',
                                'insurance', 'tax', 'company', 'other')),
  reference     text check (reference is null or char_length(reference) <= 120),
  issued_on     date,
  expires_on    date,
  remind_days   integer not null default 30 check (remind_days between 0 and 180),
  product_id    uuid,
  supplier_id   uuid,
  client_id     uuid,
  tender_id     uuid,
  contract_id   uuid,
  file_path     text,
  file_name     text check (file_name is null or char_length(file_name) <= 200),
  file_type     text,
  file_size     integer,
  notes         text check (notes is null or char_length(notes) <= 1000),
  archived_at   timestamptz,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, company_id),
  foreign key (product_id, company_id) references public.products (id, company_id) on delete set null (product_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id) on delete set null (supplier_id),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete set null (client_id),
  foreign key (tender_id, company_id) references public.tenders (id, company_id) on delete set null (tender_id),
  foreign key (contract_id, company_id) references public.contracts (id, company_id) on delete set null (contract_id)
);
create index if not exists documents_company_idx on public.documents (company_id, kind, expires_on);
create index if not exists documents_product_idx on public.documents (product_id) where product_id is not null;
create index if not exists documents_supplier_idx on public.documents (supplier_id) where supplier_id is not null;
create index if not exists documents_client_idx on public.documents (client_id) where client_id is not null;
create index if not exists documents_tender_idx on public.documents (tender_id) where tender_id is not null;
create index if not exists documents_contract_idx on public.documents (contract_id) where contract_id is not null;

-- Everyone except drivers works with the documents library.
create or replace function public.document_roles()
returns public.app_role[] language sql immutable set search_path = ''
as $$ select array['management', 'sales', 'procurement', 'warehouse', 'finance']::public.app_role[]; $$;

create or replace function public.prepare_document()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  new.title := btrim(new.title);
  new.reference := nullif(btrim(new.reference), '');
  if new.expires_on is not null and new.issued_on is not null and new.expires_on < new.issued_on then
    raise exception 'The expiry date is before the issue date.' using errcode = '22023';
  end if;
  -- The file must be this document's own, already uploaded: documents/<company>/<document>/<file>.
  if new.file_path is not null and (tg_op = 'INSERT' or new.file_path is distinct from old.file_path) then
    if new.file_path not like new.company_id::text || '/' || new.id::text || '/%'
       or new.file_path like '%..%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = new.file_path) then
      raise exception 'The file was not found. Please upload it again.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
do $$
begin
  update storage.buckets
     set file_size_limit = 20971520,
         allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
                                    'application/msword',
                                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                    'application/vnd.ms-excel',
                                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
   where id = 'documents';
exception when undefined_column then
  raise notice 'Storage limits not set (older storage version).';
end;
$$;

create or replace function public.can_use_document(p_name text, p_adding boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.documents d
     where d.company_id::text = (storage.foldername(p_name))[1]
       and d.id::text = (storage.foldername(p_name))[2]
       and (not p_adding or d.archived_at is null)
       and public.has_role(d.company_id, public.document_roles()));
$$;

drop policy if exists documents_insert on storage.objects;
create policy documents_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.can_use_document(name, true));
drop policy if exists documents_select on storage.objects;
create policy documents_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.can_use_document(name, false));

-- Closed companies: receipt photos and library files go with the logo and delivery photos.
create or replace function public.add_receipts_cleanup()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  b text;
begin
  if new.bucket = 'branding' then
    foreach b in array array['receipts', 'documents'] loop
      insert into public.storage_cleanup (bucket, prefix, company_ref)
      values (b, new.prefix, new.company_ref)
      on conflict (bucket, prefix) do nothing;
      begin
        delete from storage.objects where bucket_id = b and name like new.prefix || '%';
      exception when others then
        raise notice '% files for % left in storage: %', b, new.company_ref, sqlerrm;
      end;
    end loop;
  end if;
  return null;
end;
$$;

create or replace function public.delete_demo_company(p_company uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.companies where id = p_company and is_demo) then
    return false;  -- never touches a real company
  end if;
  perform set_config('ims.status_change', 'on', true);
  perform set_config('ims.allow_line_copy', 'on', true);
  begin
    delete from storage.objects
     where bucket_id in ('branding', 'pod', 'receipts', 'documents') and name like p_company::text || '/%';
  exception when others then
    raise notice 'Demo files for % left in storage: %', p_company, sqlerrm;
  end;
  delete from public.companies where id = p_company and is_demo;
  perform set_config('ims.status_change', 'off', true);
  perform set_config('ims.allow_line_copy', 'off', true);
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Triggers, row-level security and grants for the new tables
-- ---------------------------------------------------------------------
drop trigger if exists opportunities_number on public.opportunities;
create trigger opportunities_number before insert on public.opportunities for each row execute function public.assign_doc_number();
drop trigger if exists opportunities_prepare on public.opportunities;
create trigger opportunities_prepare before insert or update on public.opportunities for each row execute function public.prepare_opportunity();
drop trigger if exists crm_activities_prepare on public.crm_activities;
create trigger crm_activities_prepare before insert on public.crm_activities for each row execute function public.prepare_crm_activity();
drop trigger if exists crm_activities_after on public.crm_activities;
create trigger crm_activities_after after insert on public.crm_activities for each row execute function public.after_crm_activity();
drop trigger if exists tenders_number on public.tenders;
create trigger tenders_number before insert on public.tenders for each row execute function public.assign_doc_number();
drop trigger if exists tenders_prepare on public.tenders;
create trigger tenders_prepare before insert or update on public.tenders for each row execute function public.prepare_tender();
drop trigger if exists tenders_tasks on public.tenders;
create trigger tenders_tasks after insert on public.tenders for each row execute function public.add_tender_tasks();
drop trigger if exists contracts_number on public.contracts;
create trigger contracts_number before insert on public.contracts for each row execute function public.assign_doc_number();
drop trigger if exists contracts_prepare on public.contracts;
create trigger contracts_prepare before insert or update on public.contracts for each row execute function public.prepare_contract();
drop trigger if exists contract_prices_guard on public.contract_prices;
create trigger contract_prices_guard before insert or update or delete on public.contract_prices
  for each row execute function public.guard_contract_prices();
drop trigger if exists documents_prepare on public.documents;
create trigger documents_prepare before insert or update on public.documents for each row execute function public.prepare_document();

do $$
declare
  t text;
begin
  foreach t in array array['opportunities', 'important_dates', 'tenders', 'contracts', 'contract_prices', 'documents'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['opportunities', 'crm_activities', 'important_dates', 'tenders', 'tender_tasks', 'contracts',
                           'contract_prices', 'documents'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end;
$$;

-- Opportunities, activities, important dates, tenders and contracts: management and sales.
-- Finance may read contracts (prices on invoices).
drop policy if exists opportunities_select on public.opportunities;
create policy opportunities_select on public.opportunities for select to authenticated
  using (public.has_role(company_id, public.crm_roles()));
drop policy if exists opportunities_insert on public.opportunities;
create policy opportunities_insert on public.opportunities for insert to authenticated
  with check (public.has_role(company_id, public.crm_roles()));
drop policy if exists opportunities_update on public.opportunities;
create policy opportunities_update on public.opportunities for update to authenticated
  using (public.has_role(company_id, public.crm_roles())) with check (public.has_role(company_id, public.crm_roles()));
grant insert (company_id, title, client_id, prospect_name, contact_name, contact_phone, contact_email, source, stage, value,
              currency, expected_close, owner_id, next_action, next_on, notes)
  on public.opportunities to authenticated;
grant update (title, client_id, prospect_name, contact_name, contact_phone, contact_email, source, value, currency,
              expected_close, owner_id, next_action, next_on, notes)
  on public.opportunities to authenticated;

drop policy if exists crm_activities_select on public.crm_activities;
create policy crm_activities_select on public.crm_activities for select to authenticated
  using (public.has_role(company_id, public.crm_roles()));
drop policy if exists crm_activities_insert on public.crm_activities;
create policy crm_activities_insert on public.crm_activities for insert to authenticated
  with check (public.has_role(company_id, public.crm_roles()));
-- Only the person who logged it fixes a typo (and only the text).
drop policy if exists crm_activities_update on public.crm_activities;
create policy crm_activities_update on public.crm_activities for update to authenticated
  using (created_by = auth.uid() and public.has_role(company_id, public.crm_roles()))
  with check (created_by = auth.uid() and public.has_role(company_id, public.crm_roles()));
grant insert (company_id, opportunity_id, client_id, kind, happened_on, summary, location, next_action, next_on)
  on public.crm_activities to authenticated;
grant update (summary, location) on public.crm_activities to authenticated;

drop policy if exists important_dates_select on public.important_dates;
create policy important_dates_select on public.important_dates for select to authenticated
  using (public.has_role(company_id, public.crm_roles()));
drop policy if exists important_dates_insert on public.important_dates;
create policy important_dates_insert on public.important_dates for insert to authenticated
  with check (public.has_role(company_id, public.crm_roles()));
drop policy if exists important_dates_update on public.important_dates;
create policy important_dates_update on public.important_dates for update to authenticated
  using (public.has_role(company_id, public.crm_roles())) with check (public.has_role(company_id, public.crm_roles()));
drop policy if exists important_dates_delete on public.important_dates;
create policy important_dates_delete on public.important_dates for delete to authenticated
  using (public.has_role(company_id, public.crm_roles()));
grant insert (company_id, client_id, title, kind, the_date, yearly, remind_days, notes) on public.important_dates to authenticated;
grant update (title, kind, the_date, yearly, remind_days, notes) on public.important_dates to authenticated;
grant delete on public.important_dates to authenticated;

drop policy if exists tenders_select on public.tenders;
create policy tenders_select on public.tenders for select to authenticated
  using (public.has_role(company_id, public.crm_roles()));
drop policy if exists tenders_insert on public.tenders;
create policy tenders_insert on public.tenders for insert to authenticated
  with check (public.has_role(company_id, public.crm_roles()));
drop policy if exists tenders_update on public.tenders;
create policy tenders_update on public.tenders for update to authenticated
  using (public.has_role(company_id, public.crm_roles())) with check (public.has_role(company_id, public.crm_roles()));
grant insert (company_id, title, client_id, buyer_name, reference, category, published_on, site_visit_at, clarification_by,
              closing_at, submission, bid_security, estimated_value, our_price, currency, owner_id, opportunity_id,
              quotation_id, notes)
  on public.tenders to authenticated;
grant update (title, client_id, buyer_name, reference, category, published_on, site_visit_at, clarification_by,
              closing_at, submission, bid_security, estimated_value, our_price, currency, owner_id, opportunity_id,
              quotation_id, notes)
  on public.tenders to authenticated;

drop policy if exists tender_tasks_select on public.tender_tasks;
create policy tender_tasks_select on public.tender_tasks for select to authenticated
  using (public.has_role(company_id, public.crm_roles()));
drop policy if exists tender_tasks_insert on public.tender_tasks;
create policy tender_tasks_insert on public.tender_tasks for insert to authenticated
  with check (public.has_role(company_id, public.crm_roles()));
drop policy if exists tender_tasks_update on public.tender_tasks;
create policy tender_tasks_update on public.tender_tasks for update to authenticated
  using (public.has_role(company_id, public.crm_roles())) with check (public.has_role(company_id, public.crm_roles()));
drop policy if exists tender_tasks_delete on public.tender_tasks;
create policy tender_tasks_delete on public.tender_tasks for delete to authenticated
  using (public.has_role(company_id, public.crm_roles()));
grant insert (company_id, tender_id, title, due_on, assigned_to, sort) on public.tender_tasks to authenticated;
grant update (title, due_on, assigned_to, sort) on public.tender_tasks to authenticated;
grant delete on public.tender_tasks to authenticated;

drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'finance']::public.app_role[]));
drop policy if exists contracts_insert on public.contracts;
create policy contracts_insert on public.contracts for insert to authenticated
  with check (public.has_role(company_id, public.crm_roles()));
drop policy if exists contracts_update on public.contracts;
create policy contracts_update on public.contracts for update to authenticated
  using (public.has_role(company_id, public.crm_roles())) with check (public.has_role(company_id, public.crm_roles()));
grant insert (company_id, client_id, title, reference, kind, start_date, end_date, currency, value_cap, payment_terms,
              remind_days, notes, tender_id)
  on public.contracts to authenticated;
grant update (title, reference, kind, start_date, end_date, value_cap, payment_terms, remind_days, notes, tender_id)
  on public.contracts to authenticated;

drop policy if exists contract_prices_select on public.contract_prices;
create policy contract_prices_select on public.contract_prices for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'finance']::public.app_role[]));
drop policy if exists contract_prices_insert on public.contract_prices;
create policy contract_prices_insert on public.contract_prices for insert to authenticated
  with check (public.has_role(company_id, public.crm_roles()));
drop policy if exists contract_prices_update on public.contract_prices;
create policy contract_prices_update on public.contract_prices for update to authenticated
  using (public.has_role(company_id, public.crm_roles())) with check (public.has_role(company_id, public.crm_roles()));
drop policy if exists contract_prices_delete on public.contract_prices;
create policy contract_prices_delete on public.contract_prices for delete to authenticated
  using (public.has_role(company_id, public.crm_roles()));
grant insert (company_id, contract_id, product_id, unit_price, notes) on public.contract_prices to authenticated;
grant update (unit_price, notes) on public.contract_prices to authenticated;
grant delete on public.contract_prices to authenticated;

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (public.has_role(company_id, public.document_roles()));
drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (public.has_role(company_id, public.document_roles()));
drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents for update to authenticated
  using (public.has_role(company_id, public.document_roles())) with check (public.has_role(company_id, public.document_roles()));
grant insert (company_id, title, kind, reference, issued_on, expires_on, remind_days, product_id, supplier_id, client_id,
              tender_id, contract_id, file_path, file_name, file_type, file_size, notes)
  on public.documents to authenticated;
grant update (title, kind, reference, issued_on, expires_on, remind_days, product_id, supplier_id, client_id, tender_id,
              contract_id, file_path, file_name, file_type, file_size, notes, archived_at)
  on public.documents to authenticated;

-- ---------------------------------------------------------------------
-- 8. Time-based alerts (as in Stage 13, plus CRM follow-ups, tenders,
--    contracts, documents and important dates)
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
  v_days int;
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

  -- Quotations sent to the client without an answer: follow up every N days.
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

  -- Opportunities whose next step is due (owner; management when the owner has left).
  for r in select o.id, o.number, o.title, o.next_on, o.next_action, o.owner_id,
                  coalesce(c.name, o.prospect_name) as party
             from public.opportunities o left join public.clients c on c.id = o.client_id
            where o.company_id = p_company and o.stage not in ('won', 'lost') and o.next_on <= v_today loop
    if public.is_active_member(p_company, r.owner_id) then
      perform public.notify(p_company, r.owner_id, 'crm_followup',
        case when r.next_on < v_today - 7 then 'critical' else 'attention' end,
        'Follow up: ' || r.party, coalesce(r.next_action, r.title) || ' · ' || r.number || ' · planned ' || to_char(r.next_on, 'DD Mon'),
        '/crm/' || r.id, 'crm-fu-' || r.id || '-' || r.next_on);
    else
      perform public.notify_roles(p_company, array['management']::public.app_role[], null, 'crm_followup', 'attention',
        'Follow up: ' || r.party, coalesce(r.next_action, r.title) || ' · ' || r.number || ' · planned ' || to_char(r.next_on, 'DD Mon'),
        '/crm/' || r.id, 'crm-fu-' || r.id || '-' || r.next_on);
    end if;
  end loop;

  -- Tenders closing within 7 days, 2 days and today (still being prepared).
  for r in select t.id, t.number, t.title, t.closing_at, t.owner_id, coalesce(c.name, t.buyer_name) as buyer,
                  ((t.closing_at at time zone 'Africa/Dar_es_Salaam')::date - v_today) as days_left,
                  (select count(*) from public.tender_tasks k where k.tender_id = t.id and k.done_at is null) as open_tasks
             from public.tenders t left join public.clients c on c.id = t.client_id
            where t.company_id = p_company and t.status = 'preparing'
              and t.closing_at >= now() - interval '1 day'
              and (t.closing_at at time zone 'Africa/Dar_es_Salaam')::date <= v_today + 7 loop
    v_band := case when r.days_left <= 0 then 0 when r.days_left <= 2 then 2 else 7 end;
    perform public.notify(p_company, r.owner_id, 'tender_closing', case when v_band <= 2 then 'critical' else 'attention' end,
      case when v_band = 0 then 'Tender closes today: ' else 'Tender closing: ' end || r.buyer,
      r.title || ' · closes ' || to_char(r.closing_at at time zone 'Africa/Dar_es_Salaam', 'DD Mon HH24:MI')
        || case when r.open_tasks > 0 then ' · ' || r.open_tasks || ' steps left' else '' end,
      '/tenders/' || r.id, 'tnd-' || r.id || '-' || v_band);
    perform public.notify_roles(p_company, array['management']::public.app_role[], r.owner_id, 'tender_closing',
      case when v_band <= 2 then 'critical' else 'attention' end,
      case when v_band = 0 then 'Tender closes today: ' else 'Tender closing: ' end || r.buyer,
      r.title || ' · closes ' || to_char(r.closing_at at time zone 'Africa/Dar_es_Salaam', 'DD Mon HH24:MI')
        || case when r.open_tasks > 0 then ' · ' || r.open_tasks || ' steps left' else '' end,
      '/tenders/' || r.id, 'tnd-' || r.id || '-' || v_band);
  end loop;

  -- Contracts ending within their reminder period, and on the last day.
  for r in select k.id, k.number, k.title, k.end_date, k.remind_days, k.created_by, c.name as client
             from public.contracts k join public.clients c on c.id = k.client_id
            where k.company_id = p_company and k.cancelled_at is null
              and k.end_date between v_today and v_today + k.remind_days loop
    v_band := case when r.end_date = v_today then 0 when r.end_date <= v_today + 7 then 7 else r.remind_days end;
    perform public.notify_roles(p_company, array['management', 'sales']::public.app_role[], null, 'contract_ending',
      case when v_band <= 7 then 'critical' else 'attention' end,
      case when v_band = 0 then 'Contract ends today: ' else 'Contract ending: ' end || r.client,
      r.number || ' · ' || r.title || ' · ends ' || to_char(r.end_date, 'DD Mon YYYY') || ' · time to renew',
      '/contracts/' || r.id, 'ctr-' || r.id || '-' || r.end_date || '-' || v_band);
  end loop;

  -- Library documents expiring within their reminder period, and once expired.
  for r in select d.id, d.title, d.kind, d.expires_on, d.remind_days
             from public.documents d
            where d.company_id = p_company and d.archived_at is null and d.expires_on is not null
              and d.expires_on <= v_today + d.remind_days and d.expires_on >= v_today - 1 loop
    v_band := case when r.expires_on < v_today then -1 when r.expires_on <= v_today + 7 then 7 else r.remind_days end;
    perform public.notify_roles(p_company, array['management', 'procurement']::public.app_role[], null, 'document_expiry',
      case when v_band <= 7 then 'critical' else 'attention' end,
      case when v_band = -1 then 'Document expired: ' else 'Document expiring: ' end || r.title,
      'Expires ' || to_char(r.expires_on, 'DD Mon YYYY') || ' · renew it and upload the new copy',
      '/documents/' || r.id, 'doc-' || r.id || '-' || r.expires_on || '-' || v_band);
  end loop;

  -- Important client dates (birthdays, renewals...) coming up.
  for r in select d.id, d.title, d.client_id, d.created_by, c.name as client,
                  public.next_occurrence(d.the_date, d.yearly, v_today) as on_day, d.remind_days
             from public.important_dates d join public.clients c on c.id = d.client_id
            where d.company_id = p_company loop
    v_days := r.on_day - v_today;
    if v_days between 0 and r.remind_days then
      if public.is_active_member(p_company, r.created_by) then
        perform public.notify(p_company, r.created_by, 'important_date', 'info',
          case when v_days = 0 then 'Today: ' else 'Coming up: ' end || r.title || ' · ' || r.client,
          to_char(r.on_day, 'DD Mon YYYY'), '/clients/' || r.client_id || '#dates', 'date-' || r.id || '-' || r.on_day);
      else
        perform public.notify_roles(p_company, public.crm_roles(), null, 'important_date', 'info',
          case when v_days = 0 then 'Today: ' else 'Coming up: ' end || r.title || ' · ' || r.client,
          to_char(r.on_day, 'DD Mon YYYY'), '/clients/' || r.client_id || '#dates', 'date-' || r.id || '-' || r.on_day);
      end if;
    end if;
  end loop;

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

  -- Client invoices due within N days (company setting, 0 = off).
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

  -- Overdue client invoices: first day late, then every N days; paused while a promise has not passed.
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
-- 9. Clearing test data before go-live also clears the pipeline and tenders
--    (contracts, documents and important dates are kept, like master data)
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
  delete from public.crm_activities    where company_id = p_company;
  delete from public.tenders           where company_id = p_company;
  delete from public.opportunities     where company_id = p_company;
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
                    'followups', 'opportunities', 'crm_activities', 'tenders', 'tender_tasks');
  delete from public.code_counters
   where company_id = p_company
     and kind ~ '^(rfqs|quotations|supplier_rfqs|purchase_orders|goods_receipts|deliveries|invoices|payments|supplier_bills|supplier_payments|expenses|opportunities|tenders)-';
  update public.companies set alerts_checked_at = null where id = p_company;

  perform set_config('ims.status_change', 'off', true);
  perform set_config('ims.allow_line_copy', 'off', true);
  return 'Test transactions cleared for ' || v_name || '. Master data, contracts, documents, team and settings were kept.';
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Feature catalogue: CRM, tenders, contracts, documents and bank
--     reconciliation are live
-- ---------------------------------------------------------------------
update public.features set status = 'live', route = '/crm',
       description = 'Track opportunities from first contact to order, with calls, visits, follow-ups and important client dates.',
       tutorial = '[{"title":"Add an opportunity","body":"Tap + Opportunity: who it is for, what they need and roughly how much."},{"title":"Log every call and visit","body":"Write what was said and the next step with a date: the app reminds you."},{"title":"Move it along","body":"From lead to quoted to won. Link the quotation and the opportunity is won or lost when the client answers."}]'
 where key = 'crm_pipeline';
update public.features set status = 'live', route = '/tenders',
       tutorial = '[{"title":"Record the tender","body":"Buyer, reference, closing date and time, and bid security."},{"title":"Prepare the bid","body":"Tick off the checklist of papers and upload them to the tender."},{"title":"Record the result","body":"Submitted, won or lost, with the winning price, so you learn for the next one."}]'
 where key = 'tenders';
update public.features set status = 'live', route = '/contracts',
       tutorial = '[{"title":"Add the contract","body":"Client, dates and the agreed price for each product."},{"title":"Quote at contract prices","body":"On a draft quotation for that client, tap Use contract prices."},{"title":"Renew in time","body":"You are reminded before the contract ends."}]'
 where key = 'contracts';
update public.features set status = 'live', route = '/documents',
       tutorial = '[{"title":"Upload a document","body":"Certificates, licences, SDS, CoAs and tender papers, as PDF or photo."},{"title":"Link it","body":"Attach it to a product, supplier, client, tender or contract."},{"title":"Never miss an expiry","body":"Add the expiry date: the app reminds you before it runs out."}]'
 where key = 'documents';
update public.features set status = 'live', route = '/reconcile',
       description = 'Tick bank and mobile-money payments as checked against the statement, by hand or by pasting the statement.',
       tutorial = '[{"title":"Open Check payments","body":"Choose the month and the payment method."},{"title":"Paste the statement","body":"Payments and expenses whose reference appears in it are ticked."},{"title":"Find the rest","body":"What is left unticked is missing from the statement or recorded wrongly."}]'
 where key = 'bank_reconciliation';

-- ---------------------------------------------------------------------
-- 11. Demos: a pipeline, activities, a tender, a contract, documents, dates
-- ---------------------------------------------------------------------
create or replace function public.demo_seed_stage14(p_company uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_level public.business_level;
  v_x numeric;
  v_owner uuid;
  v_sales uuid;
  c1 uuid;
  c2 uuid;
  q record;
  o uuid;
  t uuid;
  k uuid;
  p record;
  v_n int := 0;
begin
  select business_level into v_level from public.companies where id = p_company and is_demo;
  if v_level is null then return; end if;
  v_x := case v_level when 'small' then 1 when 'medium' then 4 else 15 end;
  select user_id into v_owner from public.memberships where company_id = p_company and role = 'management' and active
   order by created_at limit 1;
  select coalesce((select user_id from public.memberships where company_id = p_company and role = 'sales' and active
                    order by created_at limit 1), v_owner) into v_sales;
  select id into c1 from public.clients where company_id = p_company order by created_at limit 1;
  select id into c2 from public.clients where company_id = p_company order by created_at offset 1 limit 1;
  c2 := coalesce(c2, c1);
  if c1 is null then return; end if;

  perform set_config('ims.status_change', 'on', true);
  -- The pipeline: prospects, a quoted deal, a won and a lost one.
  insert into public.opportunities (company_id, title, prospect_name, contact_name, contact_phone, source, stage, value,
                                    expected_close, owner_id, next_action, next_on, created_by, probability, client_id)
  values (p_company, 'Hydraulic oil for the new crushing plant', 'Mwanza Stone Quarry Ltd', 'Eng. Baraka Mollel', '0754 210 330',
          'referral', 'lead', 18000000 * v_x, v_today + 45, v_sales, 'Call to arrange a site visit', v_today, v_sales, 10, null),
         (p_company, 'Safety boots and helmets for 120 workers', 'Kilombero Sugar Outgrowers', 'Mama Rehema', '0715 448 902',
          'visit', 'qualified', 9500000 * v_x, v_today + 20, v_sales, 'Send samples and price list', v_today + 2, v_sales, 25, null),
         (p_company, 'Annual lubricants supply', null, null, null,
          'existing_client', 'negotiation', 42000000 * v_x, v_today + 10, v_owner, 'Meet the procurement manager on price', v_today - 1, v_owner, 75, c1);
  insert into public.opportunities (company_id, title, client_id, source, stage, value, expected_close, owner_id, closed_at,
                                    lost_reason, created_by, probability)
  values (p_company, 'Bearings for conveyor upgrade', c2, 'phone', 'won', 6400000 * v_x, v_today - 12, v_sales, now() - interval '12 days',
          null, v_sales, 100),
         (p_company, 'Welding consumables', c2, 'whatsapp', 'lost', 3100000 * v_x, v_today - 25, v_sales, now() - interval '25 days',
          'Competitor 8% cheaper; we could not match the delivery time', v_sales, 0);
  -- The oldest quotation waiting for an answer belongs to an opportunity.
  select id, client_id, subtotal, currency into q from public.quotations
   where company_id = p_company and status = 'sent' order by sent_at nulls last limit 1;
  if q.id is not null then
    insert into public.opportunities (company_id, title, client_id, source, stage, value, currency, expected_close, owner_id,
                                      quotation_id, next_action, next_on, created_by, probability)
    values (p_company, 'Quoted order', q.client_id, 'existing_client', 'quoted', q.subtotal, q.currency, v_today + 14, v_sales,
            q.id, 'Ask if the quotation was approved', v_today + 3, v_sales, 50)
    returning id into o;
  end if;
  perform set_config('ims.status_change', 'off', true);
  update public.opportunities set created_at = now() - interval '20 days' where company_id = p_company;

  -- Calls, visits and messages.
  select id into o from public.opportunities where company_id = p_company and stage = 'negotiation' limit 1;
  insert into public.crm_activities (company_id, opportunity_id, client_id, kind, happened_on, summary, location, created_by, next_action, next_on)
  values (p_company, o, c1, 'visit', v_today - 6, 'Visited the plant with the maintenance manager. They use about 40 drums a month and want one supplier for the year.',
          'Factory, Mikocheni', v_owner, null, null),
         (p_company, o, c1, 'email', v_today - 3, 'Sent the annual price proposal with delivery every two weeks.', null, v_owner,
          'Meet the procurement manager on price', v_today - 1);
  select id into o from public.opportunities where company_id = p_company and stage = 'qualified' limit 1;
  insert into public.crm_activities (company_id, opportunity_id, kind, happened_on, summary, created_by)
  values (p_company, o, 'whatsapp', v_today - 1, 'Mama Rehema asked for sizes 40 to 45 and a sample helmet.', v_sales);
  insert into public.crm_activities (company_id, client_id, kind, happened_on, summary, created_by)
  values (p_company, c2, 'call', v_today - 4, 'Courtesy call after the bearings delivery: all fitted, happy with the service.', v_sales);
  update public.crm_activities set created_at = (happened_on + time '11:00') at time zone 'Africa/Dar_es_Salaam'
   where company_id = p_company;

  insert into public.important_dates (company_id, client_id, title, kind, the_date, yearly, remind_days, created_by)
  values (p_company, c1, 'Procurement manager''s birthday', 'birthday', v_today + 4, true, 5, v_sales),
         (p_company, c2, 'Annual supplier registration renewal', 'renewal', v_today + 25, true, 30, v_owner);

  -- A tender being prepared and one won earlier.
  insert into public.tenders (company_id, title, buyer_name, reference, category, published_on, closing_at, submission,
                              bid_security, estimated_value, our_price, currency, owner_id, created_by)
  values (p_company, 'Supply of lubricants and greases for 2027', 'Tanzania Ports Authority', 'AE/016/2026-27/HQ/G/45',
          'Goods', v_today - 10, ((v_today + 5) + time '10:00') at time zone 'Africa/Dar_es_Salaam', 'NeST online system',
          2000000 * v_x, 250000000 * v_x, null, 'TZS', v_owner, v_owner)
  returning id into t;
  update public.tender_tasks set done_at = now() - interval '5 days', done_by = v_owner
   where tender_id = t and sort <= 40;
  perform set_config('ims.status_change', 'on', true);
  insert into public.tenders (company_id, title, client_id, reference, category, published_on, closing_at, submission,
                              our_price, winning_price, winner, currency, status, submitted_at, decided_at, result_note,
                              owner_id, created_by)
  values (p_company, 'Framework supply of bearings and seals', c1, 'PT/2026/011', 'Goods', v_today - 120,
          ((v_today - 90) + time '12:00') at time zone 'Africa/Dar_es_Salaam', 'Sealed envelope', 85000000 * v_x, 85000000 * v_x,
          'Us', 'TZS', 'won', now() - interval '91 days', now() - interval '70 days', 'Lowest evaluated bidder', v_owner, v_owner)
  returning id into t;
  perform set_config('ims.status_change', 'off', true);
  update public.tender_tasks set done_at = now() - interval '92 days', done_by = v_owner where tender_id = t;

  -- The won tender became a one-year framework contract with prices.
  insert into public.contracts (company_id, client_id, title, reference, kind, start_date, end_date, currency, value_cap,
                                payment_terms, remind_days, tender_id, created_by)
  values (p_company, c1, 'Framework agreement: bearings and seals', 'PT/2026/011', 'framework', v_today - 60, v_today + 20,
          'TZS', 85000000 * v_x, '30 days after invoice', 30, t, v_owner)
  returning id into k;
  for p in select id, selling_price from public.products where company_id = p_company and active and selling_price > 0
            order by created_at limit 4 loop
    insert into public.contract_prices (company_id, contract_id, product_id, unit_price)
    values (p_company, k, p.id, round(p.selling_price * 0.93, -2));
    v_n := v_n + 1;
  end loop;

  -- Documents (records only: the demo has no files).
  insert into public.documents (company_id, title, kind, reference, issued_on, expires_on, remind_days, created_by)
  values (p_company, 'Business licence', 'licence', 'BL-' || to_char(v_today, 'YYYY') || '-0042', v_today - 340, v_today + 25, 30, v_owner),
         (p_company, 'Tax clearance certificate', 'tax', 'TCC/2026/7781', v_today - 100, v_today + 265, 30, v_owner),
         (p_company, 'Fire safety certificate', 'certificate', 'FRS-4410', v_today - 380, v_today - 15, 30, v_owner);
  insert into public.documents (company_id, title, kind, supplier_id, issued_on, expires_on, remind_days, created_by)
  select p_company, 'ISO 9001 certificate · ' || s.name, 'certificate', s.id, v_today - 200, v_today + 165, 60, v_owner
    from public.suppliers s where s.company_id = p_company order by s.created_at limit 1;
  insert into public.documents (company_id, title, kind, tender_id, created_by)
  select p_company, 'Tender document and bill of quantities', 'tender', x.id, v_owner
    from public.tenders x where x.company_id = p_company and x.status = 'preparing';
  insert into public.documents (company_id, title, kind, contract_id, client_id, issued_on, expires_on, remind_days, created_by)
  values (p_company, 'Signed framework agreement', 'contract', k, c1, v_today - 60, v_today + 20, 30, v_owner);
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

  perform pg_advisory_xact_lock(hashtext('ims.create_demo_company'));
  if (select count(*) from public.demo_starts where created_at > now() - interval '1 hour') >= 150 then
    raise exception 'Too many demos have been started in the last hour. Please try again a little later.'
      using errcode = '54000';
  end if;
  if (select count(*) from public.demo_starts where user_id = v_user and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'You have restarted the demo many times in the last hour. Please try again a little later.'
      using errcode = '54000';
  end if;

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
  perform public.demo_seed_stage14(v_id);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 12. Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
revoke execute on function
  public.assign_doc_number(),
  public.crm_roles(),
  public.document_roles(),
  public.stage_probability(text),
  public.prepare_opportunity(),
  public.set_opportunity_stage(uuid, text, text),
  public.convert_opportunity_client(uuid),
  public.link_opportunity_quotation(uuid, uuid),
  public.sync_opportunity_from_quotation(),
  public.prepare_crm_activity(),
  public.after_crm_activity(),
  public.next_occurrence(date, boolean, date),
  public.default_tender_tasks(),
  public.prepare_tender(),
  public.add_tender_tasks(),
  public.set_tender_status(uuid, text, text, numeric, text),
  public.set_tender_task_done(uuid, boolean),
  public.prepare_contract(),
  public.guard_contract_prices(),
  public.cancel_contract(uuid, text),
  public.client_contract_prices(uuid, text),
  public.apply_contract_prices(uuid),
  public.prepare_document(),
  public.can_use_document(text, boolean),
  public.add_receipts_cleanup(),
  public.delete_demo_company(uuid),
  public.run_company_alerts(uuid),
  public.reset_company_transactions(uuid, text),
  public.demo_seed_stage14(uuid),
  public.create_demo_company(public.business_level)
from public, anon;
revoke execute on function
  public.prepare_opportunity(),
  public.sync_opportunity_from_quotation(),
  public.prepare_crm_activity(),
  public.after_crm_activity(),
  public.prepare_tender(),
  public.add_tender_tasks(),
  public.prepare_contract(),
  public.guard_contract_prices(),
  public.prepare_document(),
  public.add_receipts_cleanup(),
  public.delete_demo_company(uuid),
  public.run_company_alerts(uuid),
  public.reset_company_transactions(uuid, text),
  public.demo_seed_stage14(uuid)
from authenticated;
grant execute on function
  public.crm_roles(),
  public.document_roles(),
  public.stage_probability(text),
  public.set_opportunity_stage(uuid, text, text),
  public.convert_opportunity_client(uuid),
  public.link_opportunity_quotation(uuid, uuid),
  public.next_occurrence(date, boolean, date),
  public.default_tender_tasks(),
  public.set_tender_status(uuid, text, text, numeric, text),
  public.set_tender_task_done(uuid, boolean),
  public.cancel_contract(uuid, text),
  public.client_contract_prices(uuid, text),
  public.apply_contract_prices(uuid),
  public.can_use_document(text, boolean),
  public.create_demo_company(public.business_level)
to authenticated;
