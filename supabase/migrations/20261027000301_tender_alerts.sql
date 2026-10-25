-- =====================================================================
-- Tender alerts: tender notices found for the company, read, matched
-- against what it sells, scored bid / consider / no bid with the reasons,
-- sent as a daily digest, and turned into a tender record with one tap.
--
--   tender_alert_settings  per company: keywords to look for and to skip,
--                          product categories and buyers to favour, the
--                          lowest score for the digest, digest on/off,
--                          whether tender emails in the Inbox are picked up.
--   tender_sources         public web pages (or RSS feeds) with tender
--                          adverts, read by the scheduled job
--                          (netlify/functions/growth-tools-cron.mts calls
--                          /api/outbox/growth-tools). Robots rules are
--                          respected and each page is read at most every
--                          interval_hours (default once a day).
--   tender_notices         one notice: from an email in the Inbox (picked
--                          up automatically when it looks like a tender, or
--                          by hand), from a web source, or pasted in. The
--                          fields read from it (title, buyer, reference,
--                          closing date, documents asked for), the score
--                          and the reasons, and what was done with it.
--
-- Notice status: new (waiting to be read) -> matched (read and scored)
--                -> converted (a tender record was made) | dismissed.
--                A matched notice whose closing date passed becomes expired.
--
-- Who: management and sales (the tender roles) read and act on notices
-- and keep the keywords; management keeps the web sources. The scheduled
-- job (service role key) reads sources and emails, and sends the digest.
--
-- No NeST (nest.go.tz) API is used: no public API for tender alerts was
-- verified. NeST and PPRA alert emails come in through the Inbox, and any
-- public page the company is allowed to read can be added as a source.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Feature
-- ---------------------------------------------------------------------
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('tender_alerts', 'Tender alerts',
 'Tender notices from NeST and PPRA alert emails, mine and factory procurement emails, public tender pages and pasted adverts are read for you, matched against your products and keywords, and scored bid or no bid with the reasons: fit, time to the closing date, papers missing from your compliance checklist and past results with the buyer. A daily digest goes to sales and management, and one tap turns a notice into a tender.',
 'Sales', 'medium', 'live', 'Suppliers who bid for government, mining, oil & gas, sugar, cement and factory tenders.',
 'No tender missed, less time reading adverts that do not fit, and the papers ready before the closing date.',
 '[{"title": "Say what you sell", "body": "Open Tenders, then Tender alerts, then Settings. Add keywords such as lubricants, valves or sulphuric acid; your product categories are used too."},
   {"title": "Bring the notices in", "body": "Forward NeST, PPRA and client tender emails to the inbox address, add public tender pages as sources, or paste an advert."},
   {"title": "Decide quickly", "body": "Each notice shows a score with the reasons and the papers you still need. Tap Make tender to start the bid with its checklist."}]'::jsonb,
 '/tenders/alerts', 372)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
create table if not exists public.tender_alert_settings (
  company_id        uuid primary key references public.companies (id) on delete cascade,
  keywords          text[] not null default '{}' check (cardinality(keywords) <= 60),
  exclude_keywords  text[] not null default '{}' check (cardinality(exclude_keywords) <= 40),
  categories        text[] not null default '{}' check (cardinality(categories) <= 40),
  buyers            text[] not null default '{}' check (cardinality(buyers) <= 40),
  min_score         integer not null default 40 check (min_score between 0 and 100),
  digest_on         boolean not null default true,
  inbox_pick        boolean not null default true,
  last_digest_on    date,
  ai_day            date,
  ai_count          integer not null default 0 check (ai_count >= 0),
  updated_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.tender_sources (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  name             text not null check (char_length(btrim(name)) between 2 and 120),
  url              text not null check (char_length(url) <= 500 and url ~ '^https?://[a-zA-Z0-9.-]+(:[0-9]{2,5})?(/[^[:space:]]*)?$'),
  kind             text not null default 'page' check (kind in ('page', 'rss')),
  active           boolean not null default true,
  interval_hours   integer not null default 24 check (interval_hours between 6 and 168),
  last_fetched_at  timestamptz,
  last_status      text check (last_status is null or last_status in ('ok', 'blocked', 'failed', 'empty')),
  last_error       text check (last_error is null or char_length(last_error) <= 300),
  last_found       integer check (last_found is null or last_found >= 0),
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, url)
);

create table if not exists public.tender_notices (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  source              text not null check (source in ('email', 'web', 'paste')),
  source_id           uuid,
  inbox_message_id    uuid,
  url                 text check (url is null or (char_length(url) <= 600 and url ~ '^https?://')),
  fingerprint         text check (fingerprint is null or char_length(fingerprint) <= 80),
  title               text check (title is null or char_length(title) <= 300),
  buyer               text check (buyer is null or char_length(buyer) <= 200),
  reference           text check (reference is null or char_length(reference) <= 120),
  category            text check (category is null or char_length(category) <= 120),
  location            text check (location is null or char_length(location) <= 160),
  summary             text check (summary is null or char_length(summary) <= 2000),
  published_on        date,
  closing_at          timestamptz,
  documents_required  text[] not null default '{}' check (cardinality(documents_required) <= 30),
  bid_security        text check (bid_security is null or char_length(bid_security) <= 200),
  raw_text            text check (raw_text is null or char_length(raw_text) <= 20000),
  extracted_by        text check (extracted_by is null or extracted_by in ('ai', 'rules', 'person')),
  extracted_at        timestamptz,
  score               integer check (score is null or score between 0 and 100),
  decision            text check (decision is null or decision in ('bid', 'consider', 'no_bid')),
  reasons             jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array' and pg_column_size(reasons) <= 20000),
  matched             jsonb not null default '[]'::jsonb check (jsonb_typeof(matched) = 'array' and pg_column_size(matched) <= 8000),
  status              text not null default 'new' check (status in ('new', 'matched', 'converted', 'dismissed', 'expired')),
  tender_id           uuid,
  duplicate_of        uuid references public.tender_notices (id) on delete set null,
  dismissed_reason    text check (dismissed_reason is null or char_length(dismissed_reason) <= 300),
  decided_by          uuid references auth.users (id) on delete set null,
  decided_at          timestamptz,
  notified_at         timestamptz,
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (id, company_id),
  foreign key (source_id, company_id) references public.tender_sources (id, company_id) on delete set null (source_id),
  foreign key (inbox_message_id, company_id) references public.inbox_messages (id, company_id) on delete set null (inbox_message_id),
  foreign key (tender_id, company_id) references public.tenders (id, company_id) on delete set null (tender_id)
);
create unique index if not exists tender_notices_fingerprint_key on public.tender_notices (company_id, fingerprint)
  where fingerprint is not null and duplicate_of is null;
create index if not exists tender_notices_list_idx on public.tender_notices (company_id, status, created_at desc);
create index if not exists tender_notices_closing_idx on public.tender_notices (company_id, closing_at) where status = 'matched';
create index if not exists tender_notices_message_idx on public.tender_notices (inbox_message_id) where inbox_message_id is not null;
create index if not exists tender_notices_source_idx on public.tender_notices (source_id) where source_id is not null;
create index if not exists tender_notices_tender_idx on public.tender_notices (tender_id) where tender_id is not null;
create index if not exists tender_notices_dup_idx on public.tender_notices (duplicate_of) where duplicate_of is not null;

-- ---------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------
-- The same tender seen twice (an email and the NeST page) has the same fingerprint.
create or replace function public.tender_fingerprint(p_reference text, p_title text, p_buyer text)
returns text language sql immutable set search_path = ''
as $$
  select case
           when nullif(btrim(coalesce(p_reference, '')), '') is not null
             then 'ref:' || md5(lower(regexp_replace(p_reference, '[^a-zA-Z0-9]+', '', 'g')))
           when nullif(btrim(coalesce(p_title, '')), '') is not null
             then 'txt:' || md5(lower(regexp_replace(coalesce(p_title, '') || '|' || coalesce(p_buyer, ''), '[^a-zA-Z0-9|]+', '', 'g')))
         end;
$$;

-- Does an email look like a tender notice? (NeST/PPRA alerts, invitations to bid, tender adverts.)
create or replace function public.tender_text_looks_like(p_subject text, p_text text)
returns boolean language sql immutable set search_path = ''
as $$
  select coalesce(p_subject, '') ~* '(tender|zabuni|invitation (for|to) (bid|tender)|bid (notice|invitation)|procurement notice|expression of interest|nest|ppra|\mitb\M|\meoi\M)'
      or left(coalesce(p_text, ''), 4000) ~* '(invitation (for|to) (bids|bid|tender)|tender (no|number|notice|ref)|zabuni|nest\.go\.tz|ppra|procurement method|bid security|tender security|closing date for (submission|bids))';
$$;

-- Clean a text array: trimmed, no blanks or repeats, each at most p_len characters, at most p_max items.
create or replace function public.tender_clean_list(p jsonb, p_max integer, p_len integer)
returns text[] language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(v order by n), '{}')
    from (select v, n
            from (select distinct on (lower(v)) v, n
                    from (select left(btrim(e), p_len) as v, n
                            from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end)
                                 with ordinality as x(e, n)) a
                   where v <> ''
                   order by lower(v), n) b
           order by n
           limit greatest(coalesce(p_max, 0), 0)) c;
$$;

-- ---------------------------------------------------------------------
-- 4. Rules on the rows
-- ---------------------------------------------------------------------
-- Nobody writes notices directly (no insert or update rights): only the functions below do.
create or replace function public.prepare_tender_notice()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.title := nullif(btrim(new.title), '');
  new.buyer := nullif(btrim(new.buyer), '');
  new.reference := nullif(btrim(new.reference), '');
  return new;
end;
$$;

-- When a source was last read is written only by the job (no rights on those columns).
create or replace function public.prepare_tender_source()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  new.url := btrim(new.url);
  -- A changed address is read again at the next run.
  if tg_op = 'UPDATE' and new.url is distinct from old.url then
    new.last_fetched_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tender_notices_prepare on public.tender_notices;
create trigger tender_notices_prepare before insert or update on public.tender_notices
  for each row execute function public.prepare_tender_notice();
drop trigger if exists tender_sources_prepare on public.tender_sources;
create trigger tender_sources_prepare before insert or update on public.tender_sources
  for each row execute function public.prepare_tender_source();

-- ---------------------------------------------------------------------
-- 5. Settings
-- ---------------------------------------------------------------------
create or replace function public.tender_save_settings(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_min integer := case when (p ->> 'min_score') ~ '^\d{1,3}$' then (p ->> 'min_score')::integer else 40 end;
begin
  if not public.has_role(p_company, public.crm_roles()) then
    raise exception 'Only management and sales can change tender alerts.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p, '{}'::jsonb)) <> 'object' then
    raise exception 'Settings must be an object.' using errcode = '22023';
  end if;
  if v_min not between 0 and 100 then
    raise exception 'The lowest score is a number from 0 to 100.' using errcode = '22023';
  end if;
  insert into public.tender_alert_settings (company_id, keywords, exclude_keywords, categories, buyers, min_score, digest_on, inbox_pick, updated_by)
  values (p_company,
          public.tender_clean_list(p -> 'keywords', 60, 60),
          public.tender_clean_list(p -> 'exclude_keywords', 40, 60),
          public.tender_clean_list(p -> 'categories', 40, 80),
          public.tender_clean_list(p -> 'buyers', 40, 120),
          v_min,
          coalesce((p ->> 'digest_on')::boolean, true),
          coalesce((p ->> 'inbox_pick')::boolean, true),
          auth.uid())
  on conflict (company_id) do update
     set keywords = excluded.keywords,
         exclude_keywords = excluded.exclude_keywords,
         categories = excluded.categories,
         buyers = excluded.buyers,
         min_score = excluded.min_score,
         digest_on = excluded.digest_on,
         inbox_pick = excluded.inbox_pick,
         updated_by = excluded.updated_by;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. What the matching needs to know about the company
--    (keywords, products, compliance papers, past tenders and clients)
-- ---------------------------------------------------------------------
create or replace function public.tender_context_internal(p_company uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'company', (select name from public.companies where id = p_company),
    'today', (now() at time zone 'Africa/Dar_es_Salaam')::date,
    'settings', coalesce((select jsonb_build_object('keywords', s.keywords, 'exclude_keywords', s.exclude_keywords,
                                                    'categories', s.categories, 'buyers', s.buyers, 'min_score', s.min_score)
                            from public.tender_alert_settings s where s.company_id = p_company),
                         jsonb_build_object('keywords', '[]'::jsonb, 'exclude_keywords', '[]'::jsonb, 'categories', '[]'::jsonb,
                                            'buyers', '[]'::jsonb, 'min_score', 40)),
    'product_categories', coalesce((select jsonb_agg(c order by n desc, c) from (
        select p.category as c, count(*) as n from public.products p
         where p.company_id = p_company and p.active and nullif(btrim(p.category), '') is not null
         group by p.category order by count(*) desc limit 40) x), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'category', category, 'brand', brand)) from (
        select p.name, p.category, p.brand from public.products p
         where p.company_id = p_company and p.active order by p.updated_at desc limit 400) x), '[]'::jsonb),
    'compliance', coalesce((select jsonb_object_agg(i.code, i.status) from public.compliance_items i
                             where i.company_id = p_company and i.code is not null), '{}'::jsonb),
    'licences', coalesce((select jsonb_agg(distinct l.catalogue_code) from public.licences l
                           where l.company_id = p_company and l.catalogue_code is not null and l.status = 'active'
                             and (l.expires_on is null or l.expires_on >= (now() at time zone 'Africa/Dar_es_Salaam')::date)), '[]'::jsonb),
    'buyers', coalesce((select jsonb_agg(jsonb_build_object('name', b, 'won', won, 'lost', lost, 'bids', bids)) from (
        select coalesce(c.name, t.buyer_name) as b,
               count(*) filter (where t.status = 'won') as won,
               count(*) filter (where t.status = 'lost') as lost,
               count(*) filter (where t.status in ('submitted', 'won', 'lost')) as bids
          from public.tenders t left join public.clients c on c.id = t.client_id
         where t.company_id = p_company
         group by coalesce(c.name, t.buyer_name) limit 300) x where b is not null), '[]'::jsonb),
    'clients', coalesce((select jsonb_agg(name) from (
        select c.name from public.clients c where c.company_id = p_company and c.active order by c.created_at desc limit 500) x), '[]'::jsonb));
$$;

create or replace function public.tender_context(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_role(p_company, public.crm_roles()) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  return public.tender_context_internal(p_company);
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Adding notices
-- ---------------------------------------------------------------------
-- Internal: insert one notice (status new or matched) unless the same tender is already there.
-- p keys: source, source_id, inbox_message_id, url, title, buyer, reference, category, location, summary,
--         published_on, closing_at, documents_required, bid_security, raw_text
-- Returns the new notice id, or null when it is a repeat.
create or replace function public.tender_notice_insert(p_company uuid, p jsonb, p_by uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_fp    text;
  v_id    uuid;
  v_close timestamptz;
  v_pub   date;
  v_url   text := nullif(left(btrim(coalesce(p ->> 'url', '')), 600), '');
begin
  begin
    v_close := nullif(p ->> 'closing_at', '')::timestamptz;
  exception when others then
    v_close := null;
  end;
  begin
    v_pub := nullif(p ->> 'published_on', '')::date;
  exception when others then
    v_pub := null;
  end;
  if v_url is not null and v_url !~ '^https?://' then v_url := null; end if;
  v_fp := case when (p ->> 'inbox_message_id') is not null and nullif(btrim(coalesce(p ->> 'reference', '')), '') is null
                    and nullif(btrim(coalesce(p ->> 'title', '')), '') is null
               then 'msg:' || (p ->> 'inbox_message_id')
               else public.tender_fingerprint(p ->> 'reference', p ->> 'title', p ->> 'buyer') end;
  if v_fp is null and v_url is not null then
    v_fp := 'url:' || md5(v_url);
  end if;
  if v_fp is not null and exists (select 1 from public.tender_notices where company_id = p_company and fingerprint = v_fp) then
    return null;
  end if;
  insert into public.tender_notices (company_id, source, source_id, inbox_message_id, url, fingerprint, title, buyer, reference,
                                     category, location, summary, published_on, closing_at, documents_required, bid_security,
                                     raw_text, status, created_by)
  values (p_company, p ->> 'source', nullif(p ->> 'source_id', '')::uuid, nullif(p ->> 'inbox_message_id', '')::uuid, v_url, v_fp,
          nullif(left(btrim(coalesce(p ->> 'title', '')), 300), ''),
          nullif(left(btrim(coalesce(p ->> 'buyer', '')), 200), ''),
          nullif(left(btrim(coalesce(p ->> 'reference', '')), 120), ''),
          nullif(left(btrim(coalesce(p ->> 'category', '')), 120), ''),
          nullif(left(btrim(coalesce(p ->> 'location', '')), 160), ''),
          nullif(left(btrim(coalesce(p ->> 'summary', '')), 2000), ''),
          v_pub, v_close,
          public.tender_clean_list(p -> 'documents_required', 30, 200),
          nullif(left(btrim(coalesce(p ->> 'bid_security', '')), 200), ''),
          nullif(left(coalesce(p ->> 'raw_text', ''), 20000), ''),
          'new', p_by)
  on conflict do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Someone pastes an advert (text, and optionally the link). Returns the notice id.
create or replace function public.tender_notice_add(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id   uuid;
  v_text text := btrim(coalesce(p ->> 'raw_text', ''));
begin
  if not public.has_role(p_company, public.crm_roles()) then
    raise exception 'Only management and sales can add tender notices.' using errcode = '42501';
  end if;
  if not public.feature_on(p_company, 'tender_alerts') then
    raise exception 'Switch on Tender alerts first (Settings, then Features).' using errcode = '22023';
  end if;
  if char_length(v_text) < 20 and nullif(btrim(coalesce(p ->> 'title', '')), '') is null then
    raise exception 'Paste the tender advert (at least a few lines) or type its title.' using errcode = '22023';
  end if;
  if char_length(v_text) > 20000 then
    raise exception 'The text is too long. Paste only the advert.' using errcode = '22023';
  end if;
  v_id := public.tender_notice_insert(p_company, jsonb_build_object('source', 'paste') || (p - 'source' - 'source_id' - 'inbox_message_id'), auth.uid());
  if v_id is null then
    raise exception 'This tender is already in your tender alerts.' using errcode = '23505';
  end if;
  return v_id;
end;
$$;

-- An email in the Inbox, by hand ("Read as a tender notice"). Returns the notice (the existing one when already made).
create or replace function public.tender_notice_from_inbox(p_message uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  m    record;
  v_id uuid;
begin
  select im.id, im.company_id, im.subject, im.body_text, im.direction into m from public.inbox_messages im where im.id = p_message;
  if m.id is null or not public.has_role(m.company_id, public.crm_roles())
     or not public.has_role(m.company_id, public.inbox_roles()) then
    raise exception 'Message not found.' using errcode = '42501';
  end if;
  if not public.feature_on(m.company_id, 'tender_alerts') then
    raise exception 'Switch on Tender alerts first (Settings, then Features).' using errcode = '22023';
  end if;
  select id into v_id from public.tender_notices where inbox_message_id = m.id order by created_at limit 1;
  if v_id is not null then return v_id; end if;
  v_id := public.tender_notice_insert(m.company_id,
            jsonb_build_object('source', 'email', 'inbox_message_id', m.id,
                               'raw_text', left(coalesce(nullif(m.subject, '') || E'\n\n', '') || coalesce(m.body_text, ''), 20000)),
            auth.uid());
  if v_id is null then
    select id into v_id from public.tender_notices where company_id = m.company_id and fingerprint = 'msg:' || m.id;
  end if;
  return v_id;
end;
$$;

-- Emails that look like tender notices are picked up as they arrive (never stops the Inbox).
create or replace function public.tender_pick_inbox_message()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.direction <> 'in' or new.channel <> 'email' then
    return null;
  end if;
  begin
    if public.feature_on(new.company_id, 'tender_alerts')
       and coalesce((select s.inbox_pick from public.tender_alert_settings s where s.company_id = new.company_id), true)
       and public.tender_text_looks_like(new.subject, new.body_text) then
      perform public.tender_notice_insert(new.company_id,
        jsonb_build_object('source', 'email', 'inbox_message_id', new.id,
                           'raw_text', left(coalesce(nullif(new.subject, '') || E'\n\n', '') || coalesce(new.body_text, ''), 20000)),
        null);
    end if;
  exception when others then
    raise warning 'Tender pick-up skipped for message %: %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists inbox_messages_tender_pick on public.inbox_messages;
create trigger inbox_messages_tender_pick after insert on public.inbox_messages
  for each row execute function public.tender_pick_inbox_message();

-- ---------------------------------------------------------------------
-- 8. Saving what was read and the score
-- ---------------------------------------------------------------------
-- Internal. p keys: title, buyer, reference, category, location, summary, published_on, closing_at,
-- documents_required, bid_security, extracted_by (ai | rules | person), score, decision, reasons, matched.
create or replace function public.tender_notice_apply(p_notice uuid, p jsonb, p_by uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  n       public.tender_notices;
  v_close timestamptz;
  v_pub   date;
  v_fp    text;
  v_dup   uuid;
  v_score integer := case when (p ->> 'score') ~ '^\d{1,3}$' then least((p ->> 'score')::integer, 100) end;
  v_dec   text := case when p ->> 'decision' in ('bid', 'consider', 'no_bid') then p ->> 'decision' end;
  v_by    text := case when p ->> 'extracted_by' in ('ai', 'rules', 'person') then p ->> 'extracted_by' else 'rules' end;
  v_status text;
begin
  select * into n from public.tender_notices where id = p_notice for update;
  if n.id is null then
    raise exception 'Notice not found.' using errcode = 'P0002';
  end if;
  if n.status in ('converted', 'dismissed') and v_by <> 'person' then
    return n.status;  -- already decided: a late reading changes nothing
  end if;
  begin
    v_close := nullif(p ->> 'closing_at', '')::timestamptz;
  exception when others then
    v_close := n.closing_at;
  end;
  begin
    v_pub := nullif(p ->> 'published_on', '')::date;
  exception when others then
    v_pub := n.published_on;
  end;
  v_fp := coalesce(public.tender_fingerprint(coalesce(nullif(btrim(coalesce(p ->> 'reference', '')), ''), n.reference),
                                             coalesce(nullif(btrim(coalesce(p ->> 'title', '')), ''), n.title),
                                             coalesce(nullif(btrim(coalesce(p ->> 'buyer', '')), ''), n.buyer)),
                   n.fingerprint);
  select id into v_dup from public.tender_notices
   where company_id = n.company_id and fingerprint = v_fp and id <> n.id and duplicate_of is null
   order by created_at limit 1;
  v_status := case when n.status = 'converted' then 'converted'
                   when v_dup is not null and n.status <> 'dismissed' then 'dismissed'
                   when n.status = 'dismissed' then 'dismissed'
                   when coalesce(v_close, n.closing_at) < now() then 'expired'
                   else 'matched' end;
  update public.tender_notices
     set title = coalesce(nullif(left(btrim(coalesce(p ->> 'title', '')), 300), ''), title),
         buyer = coalesce(nullif(left(btrim(coalesce(p ->> 'buyer', '')), 200), ''), buyer),
         reference = coalesce(nullif(left(btrim(coalesce(p ->> 'reference', '')), 120), ''), reference),
         category = coalesce(nullif(left(btrim(coalesce(p ->> 'category', '')), 120), ''), category),
         location = coalesce(nullif(left(btrim(coalesce(p ->> 'location', '')), 160), ''), location),
         summary = coalesce(nullif(left(btrim(coalesce(p ->> 'summary', '')), 2000), ''), summary),
         published_on = coalesce(v_pub, published_on),
         closing_at = coalesce(v_close, closing_at),
         documents_required = case when jsonb_typeof(p -> 'documents_required') = 'array'
                                   then public.tender_clean_list(p -> 'documents_required', 30, 200) else documents_required end,
         bid_security = coalesce(nullif(left(btrim(coalesce(p ->> 'bid_security', '')), 200), ''), bid_security),
         extracted_by = v_by,
         extracted_at = now(),
         score = coalesce(v_score, score),
         decision = coalesce(v_dec, decision),
         reasons = case when jsonb_typeof(p -> 'reasons') = 'array' and pg_column_size(p -> 'reasons') <= 20000 then p -> 'reasons' else reasons end,
         matched = case when jsonb_typeof(p -> 'matched') = 'array' and pg_column_size(p -> 'matched') <= 8000 then p -> 'matched' else matched end,
         fingerprint = case when v_dup is null then v_fp else fingerprint end,
         duplicate_of = v_dup,
         dismissed_reason = case when v_dup is not null and n.status not in ('dismissed', 'converted') then 'The same tender is already in the list.' else dismissed_reason end,
         status = v_status,
         decided_by = coalesce(decided_by, p_by)
   where id = n.id;
  return v_status;
end;
$$;

-- In the app: after reading with AI, or after a person corrected the fields.
create or replace function public.tender_notice_save(p_notice uuid, p jsonb)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.tender_notices where id = p_notice;
  if v_company is null or not public.has_role(v_company, public.crm_roles()) then
    raise exception 'Notice not found.' using errcode = '42501';
  end if;
  return public.tender_notice_apply(p_notice, p, null);
end;
$$;

create or replace function public.tender_notice_dismiss(p_notice uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  n public.tender_notices;
begin
  select * into n from public.tender_notices where id = p_notice for update;
  if n.id is null or not public.has_role(n.company_id, public.crm_roles()) then
    raise exception 'Notice not found.' using errcode = '42501';
  end if;
  if n.status = 'converted' then
    raise exception 'This notice is already a tender. Mark the tender as No bid instead.' using errcode = '22023';
  end if;
  update public.tender_notices
     set status = 'dismissed', dismissed_reason = nullif(left(btrim(coalesce(p_reason, '')), 300), ''),
         decided_by = auth.uid(), decided_at = now()
   where id = n.id;
end;
$$;

create or replace function public.tender_notice_restore(p_notice uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  n public.tender_notices;
begin
  select * into n from public.tender_notices where id = p_notice for update;
  if n.id is null or not public.has_role(n.company_id, public.crm_roles()) then
    raise exception 'Notice not found.' using errcode = '42501';
  end if;
  if n.status <> 'dismissed' then
    return;
  end if;
  update public.tender_notices
     set status = case when extracted_at is null then 'new' when closing_at < now() then 'expired' else 'matched' end,
         dismissed_reason = null, duplicate_of = null, decided_by = auth.uid(), decided_at = now(),
         fingerprint = case when exists (select 1 from public.tender_notices o where o.company_id = n.company_id
                                           and o.fingerprint = n.fingerprint and o.id <> n.id and o.duplicate_of is null)
                            then null else fingerprint end
   where id = n.id;
end;
$$;

-- One tap: the notice becomes a tender record (with the usual checklist and the papers the notice asks for).
-- p_client: the buyer as a client of the company (optional; otherwise the buyer's name is used).
-- p_closing_at: needed when the notice has no closing date.
create or replace function public.tender_notice_to_tender(p_notice uuid, p_client uuid, p_closing_at timestamptz)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  n       public.tender_notices;
  v_id    uuid;
  v_close timestamptz;
  v_doc   text;
  v_i     integer := 0;
  v_notes text;
begin
  select * into n from public.tender_notices where id = p_notice for update;
  if n.id is null or not public.has_role(n.company_id, public.crm_roles()) then
    raise exception 'Notice not found.' using errcode = '42501';
  end if;
  if n.status = 'converted' and n.tender_id is not null then
    return n.tender_id;
  end if;
  if p_client is not null and not exists (select 1 from public.clients where id = p_client and company_id = n.company_id) then
    raise exception 'Client not found.' using errcode = '22023';
  end if;
  v_close := coalesce(p_closing_at, n.closing_at);
  if v_close is null then
    raise exception 'Enter the closing date of the tender first.' using errcode = '22023';
  end if;
  if p_client is null and n.buyer is null then
    raise exception 'Choose the client or type the buyer''s name first.' using errcode = '22023';
  end if;
  v_notes := left(concat_ws(E'\n',
               'From tender alerts' || coalesce(' (score ' || n.score || ')', '') || '.',
               n.summary,
               case when n.url is not null then 'Advert: ' || n.url end,
               case when n.bid_security is not null then 'Bid security: ' || n.bid_security end), 2000);
  insert into public.tenders (company_id, title, client_id, buyer_name, reference, category, published_on, closing_at, notes, owner_id)
  values (n.company_id, left(coalesce(n.title, 'Tender ' || coalesce(n.reference, '')), 300), p_client,
          case when p_client is null then n.buyer end, n.reference, n.category, n.published_on, v_close, v_notes, auth.uid())
  returning id into v_id;
  -- Papers asked for in the notice that are not already on the usual checklist.
  foreach v_doc in array n.documents_required loop
    exit when v_i >= 10;
    continue when exists (select 1 from public.tender_tasks t where t.tender_id = v_id
                           and lower(t.title) like '%' || lower(left(v_doc, 30)) || '%');
    insert into public.tender_tasks (company_id, tender_id, title, sort)
    values (n.company_id, v_id, left(case when char_length(v_doc) < 2 then 'Paper: ' || v_doc else v_doc end, 200), 2000 + v_i);
    v_i := v_i + 1;
  end loop;
  update public.tender_notices
     set status = 'converted', tender_id = v_id, closing_at = v_close, decided_by = auth.uid(), decided_at = now()
   where id = n.id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. The scheduled job (service role key only)
-- ---------------------------------------------------------------------
-- Web sources due to be read now (feature on, active, not read within their interval).
create or replace function public.tender_sources_due(p_limit integer)
returns table (id uuid, company_id uuid, url text, kind text, name text)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.company_id, s.url, s.kind, s.name
    from public.tender_sources s
   where s.active and public.feature_on(s.company_id, 'tender_alerts')
     and (s.last_fetched_at is null or s.last_fetched_at < now() - make_interval(hours => s.interval_hours))
   order by s.last_fetched_at nulls first, s.created_at
   limit least(greatest(coalesce(p_limit, 5), 1), 50);
$$;

create or replace function public.tender_source_fetched(p_source uuid, p_status text, p_error text, p_found integer)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_status not in ('ok', 'blocked', 'failed', 'empty') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  update public.tender_sources
     set last_fetched_at = now(), last_status = p_status, last_error = nullif(left(coalesce(p_error, ''), 300), ''),
         last_found = greatest(coalesce(p_found, 0), 0)
   where id = p_source;
end;
$$;

-- One advert found on a web source. Returns the new notice id (null: seen before).
create or replace function public.tender_notice_ingest(p_source uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s public.tender_sources;
begin
  select * into s from public.tender_sources where id = p_source;
  if s.id is null or not public.feature_on(s.company_id, 'tender_alerts') then
    return null;
  end if;
  return public.tender_notice_insert(s.company_id,
           (p - 'source' - 'inbox_message_id') || jsonb_build_object('source', 'web', 'source_id', s.id), null);
end;
$$;

-- Notices waiting to be read (oldest first), for the job.
create or replace function public.tender_notices_waiting(p_limit integer)
returns table (id uuid, company_id uuid, source text, title text, raw_text text, url text)
language sql stable security definer set search_path = ''
as $$
  select n.id, n.company_id, n.source, n.title, n.raw_text, n.url
    from public.tender_notices n
   where n.status = 'new' and public.feature_on(n.company_id, 'tender_alerts')
   order by n.created_at
   limit least(greatest(coalesce(p_limit, 10), 1), 50);
$$;

-- The job saves what it read (same rules as in the app).
create or replace function public.tender_notice_save_job(p_notice uuid, p jsonb)
returns text language plpgsql security definer set search_path = ''
as $$
begin
  return public.tender_notice_apply(p_notice, p - 'extracted_by' || jsonb_build_object('extracted_by',
           case when p ->> 'extracted_by' = 'ai' then 'ai' else 'rules' end), null);
end;
$$;

-- Each company gets at most p_daily AI readings a day from the job. True = one taken.
create or replace function public.tender_ai_take(p_company uuid, p_daily integer)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_n     integer;
begin
  insert into public.tender_alert_settings as s (company_id, ai_day, ai_count) values (p_company, v_today, 1)
  on conflict (company_id) do update
     set ai_count = case when s.ai_day = v_today then s.ai_count + 1 else 1 end,
         ai_day = v_today
  returning ai_count into v_n;
  return v_n <= least(greatest(coalesce(p_daily, 40), 1), 200);
end;
$$;

-- The daily digest, from 07:00 Dar es Salaam time, once a day per company: the notices read since the
-- last digest that score at least the company's lowest score, to management and sales.
-- Matched notices whose closing date has passed become expired. Returns the notifications sent.
create or replace function public.tender_run_digest_at(p_at timestamptz)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_now   timestamp := coalesce(p_at, now()) at time zone 'Africa/Dar_es_Salaam';
  v_today date := (coalesce(p_at, now()) at time zone 'Africa/Dar_es_Salaam')::date;
  c       record;
  v_n     integer;
  v_best  record;
  v_before bigint;
  v_after  bigint;
  v_total integer := 0;
begin
  update public.tender_notices set status = 'expired' where status = 'matched' and closing_at < coalesce(p_at, now());
  if extract(hour from v_now) < 7 then
    return 0;
  end if;
  for c in select co.id, coalesce(s.min_score, 40) as min_score, coalesce(s.digest_on, true) as digest_on, s.last_digest_on
             from public.companies co left join public.tender_alert_settings s on s.company_id = co.id
            where public.feature_on(co.id, 'tender_alerts')
              and (s.last_digest_on is null or s.last_digest_on < v_today) loop
    begin
      select count(*) into v_n from public.tender_notices n
       where n.company_id = c.id and n.status = 'matched' and n.notified_at is null and coalesce(n.score, 0) >= c.min_score;
      if c.digest_on and v_n > 0 then
        select n.title, n.buyer, n.score, n.closing_at into v_best from public.tender_notices n
         where n.company_id = c.id and n.status = 'matched' and n.notified_at is null and coalesce(n.score, 0) >= c.min_score
         order by n.score desc nulls last, n.closing_at nulls last limit 1;
        select count(*) into v_before from public.notifications where company_id = c.id;
        perform public.notify_roles(c.id, public.crm_roles(), null, 'tender_digest', 'attention',
          case when v_n = 1 then '1 new tender matches what you sell' else v_n || ' new tenders match what you sell' end,
          left('Best: ' || coalesce(v_best.title, 'tender') || coalesce(' · ' || v_best.buyer, '') ||
               coalesce(' · score ' || v_best.score, '') ||
               coalesce(' · closes ' || to_char(v_best.closing_at at time zone 'Africa/Dar_es_Salaam', 'DD Mon'), ''), 500),
          '/tenders/alerts', 'tender-digest-' || c.id || '-' || v_today);
        select count(*) into v_after from public.notifications where company_id = c.id;
        v_total := v_total + (v_after - v_before);
      end if;
          update public.tender_notices set notified_at = coalesce(p_at, now())
       where company_id = c.id and status = 'matched' and notified_at is null;
          insert into public.tender_alert_settings as s (company_id, last_digest_on) values (c.id, v_today)
      on conflict (company_id) do update set last_digest_on = v_today;
    exception when others then
      raise warning 'Tender digest failed for %: %', c.id, sqlerrm;
    end;
  end loop;
  return v_total;
end;
$$;

create or replace function public.tender_run_digest()
returns integer language sql security definer set search_path = ''
as $$ select public.tender_run_digest_at(now()); $$;

-- Counts for the tenders page.
create or replace function public.tender_alert_summary(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_role(p_company, public.crm_roles()) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'waiting', (select count(*) from public.tender_notices where company_id = p_company and status = 'new'),
    'matched', (select count(*) from public.tender_notices where company_id = p_company and status = 'matched'),
    'bid', (select count(*) from public.tender_notices where company_id = p_company and status = 'matched' and decision = 'bid'),
    'closing_soon', (select count(*) from public.tender_notices where company_id = p_company and status = 'matched'
                       and closing_at between now() and now() + interval '3 days'),
    'sources', (select count(*) from public.tender_sources where company_id = p_company and active),
    'set_up', exists (select 1 from public.tender_alert_settings where company_id = p_company and cardinality(keywords) > 0));
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Triggers, row-level security and grants
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['tender_alert_settings', 'tender_sources', 'tender_notices'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  foreach t in array array['tender_sources', 'tender_notices'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
  end loop;
  foreach t in array array['tender_alert_settings', 'tender_sources'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end;
$$;
-- Notices: decisions only (not every reading) go to the activity log.
drop trigger if exists tender_notices_audit on public.tender_notices;
create trigger tender_notices_audit after update of status or delete on public.tender_notices
  for each row execute function public.audit_row();

drop policy if exists tender_alert_settings_select on public.tender_alert_settings;
create policy tender_alert_settings_select on public.tender_alert_settings for select to authenticated
  using (public.has_role(company_id, public.crm_roles()));

drop policy if exists tender_notices_select on public.tender_notices;
create policy tender_notices_select on public.tender_notices for select to authenticated
  using (public.has_role(company_id, public.crm_roles()));

-- Sources: management and sales read; management adds, changes and removes.
drop policy if exists tender_sources_select on public.tender_sources;
create policy tender_sources_select on public.tender_sources for select to authenticated
  using (public.has_role(company_id, public.crm_roles()));
drop policy if exists tender_sources_insert on public.tender_sources;
create policy tender_sources_insert on public.tender_sources for insert to authenticated
  with check (public.is_manager(company_id) and public.feature_enabled(company_id, 'tender_alerts'));
drop policy if exists tender_sources_update on public.tender_sources;
create policy tender_sources_update on public.tender_sources for update to authenticated
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));
drop policy if exists tender_sources_delete on public.tender_sources;
create policy tender_sources_delete on public.tender_sources for delete to authenticated using (public.is_manager(company_id));
grant insert (company_id, name, url, kind, active, interval_hours) on public.tender_sources to authenticated;
grant update (name, url, kind, active, interval_hours) on public.tender_sources to authenticated;
grant delete on public.tender_sources to authenticated;

revoke execute on function
  public.tender_fingerprint(text, text, text), public.tender_text_looks_like(text, text), public.tender_clean_list(jsonb, integer, integer),
  public.prepare_tender_notice(), public.prepare_tender_source(), public.tender_save_settings(uuid, jsonb),
  public.tender_context_internal(uuid), public.tender_context(uuid), public.tender_notice_insert(uuid, jsonb, uuid),
  public.tender_notice_add(uuid, jsonb), public.tender_notice_from_inbox(uuid), public.tender_pick_inbox_message(),
  public.tender_notice_apply(uuid, jsonb, uuid), public.tender_notice_save(uuid, jsonb), public.tender_notice_dismiss(uuid, text),
  public.tender_notice_restore(uuid), public.tender_notice_to_tender(uuid, uuid, timestamptz),
  public.tender_sources_due(integer), public.tender_source_fetched(uuid, text, text, integer), public.tender_notice_ingest(uuid, jsonb),
  public.tender_notices_waiting(integer), public.tender_notice_save_job(uuid, jsonb), public.tender_ai_take(uuid, integer),
  public.tender_run_digest_at(timestamptz), public.tender_run_digest(), public.tender_alert_summary(uuid)
from public, anon, authenticated;

-- The screens.
grant execute on function
  public.tender_save_settings(uuid, jsonb), public.tender_context(uuid), public.tender_notice_add(uuid, jsonb),
  public.tender_notice_from_inbox(uuid), public.tender_notice_save(uuid, jsonb), public.tender_notice_dismiss(uuid, text),
  public.tender_notice_restore(uuid), public.tender_notice_to_tender(uuid, uuid, timestamptz), public.tender_alert_summary(uuid)
to authenticated;

-- Only the scheduled job (server side, service role key).
grant execute on function
  public.tender_context_internal(uuid), public.tender_sources_due(integer), public.tender_source_fetched(uuid, text, text, integer),
  public.tender_notice_ingest(uuid, jsonb), public.tender_notices_waiting(integer), public.tender_notice_save_job(uuid, jsonb),
  public.tender_ai_take(uuid, integer), public.tender_run_digest_at(timestamptz), public.tender_run_digest()
to service_role;

notify pgrst, 'reload schema';
