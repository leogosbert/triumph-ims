-- =====================================================================
-- Shared inbox: client and supplier emails and WhatsApp messages in the app.
--
--   inbox_settings       per company: the email address that brings mail to
--                        this company (e.g. triumph-k3x9@abc.resend.app, the
--                        company's own Gmail read over IMAP, or later
--                        info@ourdomain.co.tz) and the WhatsApp Business
--                        phone number id.
--   inbox_conversations  one thread with one person: email or WhatsApp, open
--                        or closed, who handles it, unread count, linked to
--                        the client or supplier when the address or phone
--                        is known.
--   inbox_messages       each message in or out (text and cleaned HTML).
--   inbox_attachments    files that came with an email, kept in the private
--                        "inbox" storage bucket: <company>/<conversation>/<file>.
--
-- How messages arrive: the webhooks /api/inbound/email and
-- /api/inbound/whatsapp check the provider's signature, and the mailbox job
-- (/api/inbound/mailbox, every 5 minutes) reads the company mailbox over IMAP;
-- all call inbox_record_inbound() with the service role key. Nobody else can.
--
-- Who sees what: management, sales, procurement and finance read the inbox
-- of their company and reply. Warehouse and drivers do not. Every change
-- (reply, close, reopen, assign, read) goes through a function below.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. The feature row (Settings, then Features)
-- ---------------------------------------------------------------------
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('inbox', 'Inbox (email and WhatsApp)',
 'Emails and WhatsApp messages from clients and suppliers arrive in the app with a notification, linked to the client or supplier, and you reply by email or WhatsApp from the same screen.',
 'Sales', 'small', 'live', 'Every company that talks to clients and suppliers by email or WhatsApp.',
 'No missed enquiry, everyone sees the same conversation, and replies are kept with the client.',
 '[{"title": "Connect the mailbox", "body": "Open Inbox, then Set up. Enter the company email and its app password, or use the forwarding address shown."},
   {"title": "Answer from the app", "body": "New messages show a notification. Open the conversation, write the reply and choose email or WhatsApp."},
   {"title": "Keep it tidy", "body": "Assign a conversation to a colleague, link it to the client or supplier, and close it when it is done."}]'::jsonb,
 '/inbox', 135)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------
create or replace function public.inbox_roles()
returns public.app_role[] language sql immutable set search_path = ''
as $$ select array['management', 'sales', 'procurement', 'finance']::public.app_role[]; $$;

-- "Asha Mrema <Asha@Client.co.tz>" -> asha@client.co.tz (null when it is not an address).
create or replace function public.inbox_email_of(p text)
returns text language sql immutable set search_path = ''
as $$
  select case when v ~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' then v end
    from (select lower(btrim(coalesce(substring(p from '<([^<>]+)>'), p))) as v) x;
$$;

-- Phone numbers as digits with the country code: 0712 345 678 -> 255712345678.
create or replace function public.inbox_phone_of(p text)
returns text language sql immutable set search_path = ''
as $$
  select case
           when d = '' then null
           when length(d) = 10 and d like '0%' then '255' || substr(d, 2)
           when length(d) = 9 and d ~ '^[67]' then '255' || d
           else d
         end
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

-- Does a free-text field ("a@b.co, c@d.co" or "0712..., 0754...") hold this address or phone?
create or replace function public.inbox_field_has(p_field text, p_value text, p_phone boolean)
returns boolean language sql immutable set search_path = ''
as $$
  select p_value is not null and p_field is not null and exists (
    select 1 from regexp_split_to_table(p_field, '[,;/]+|\s{2,}') part
     where case when p_phone then public.inbox_phone_of(part) = p_value and length(p_value) >= 9
                else public.inbox_email_of(part) = p_value end);
$$;

-- "Re: Fwd: Price of valves" -> "price of valves" (to keep replies in one conversation).
create or replace function public.inbox_subject_key(p text)
returns text language sql immutable set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(p, '')),
                              '^(\s*(re|fw|fwd|aw|sv|wg|jibu|tr)\s*(\[\d+\])?\s*:\s*)+', '', 'g'));
$$;

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
create table if not exists public.inbox_settings (
  company_id                uuid primary key references public.companies (id) on delete cascade,
  inbound_address           text check (inbound_address is null or
                                        (inbound_address ~ '^[a-z0-9._-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' and char_length(inbound_address) <= 120)),
  whatsapp_phone_number_id  text check (whatsapp_phone_number_id is null or whatsapp_phone_number_id ~ '^[0-9]{5,30}$'),
  whatsapp_display_phone    text check (whatsapp_display_phone is null or char_length(whatsapp_display_phone) <= 40),
  reply_name                text check (reply_name is null or char_length(reply_name) <= 80),
  signature                 text check (signature is null or char_length(signature) <= 1000),
  updated_by                uuid references auth.users (id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
-- Company-mailbox mode (IMAP): where the last check stopped. Written only by the server job.
alter table public.inbox_settings add column if not exists mailbox_uidvalidity bigint;
alter table public.inbox_settings add column if not exists mailbox_last_uid bigint;
alter table public.inbox_settings add column if not exists mailbox_checked_at timestamptz;
alter table public.inbox_settings add column if not exists mailbox_error text;
create unique index if not exists inbox_settings_address_key on public.inbox_settings (inbound_address) where inbound_address is not null;
create unique index if not exists inbox_settings_wa_key on public.inbox_settings (whatsapp_phone_number_id) where whatsapp_phone_number_id is not null;

create table if not exists public.inbox_conversations (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  -- Short code put in the reply-to address (alias+<ref>@domain) so replies find their conversation.
  ref                  text not null default substr(md5(gen_random_uuid()::text), 1, 10) check (ref ~ '^[a-z0-9]{6,16}$'),
  channel              text not null check (channel in ('email', 'whatsapp')),
  subject              text check (subject is null or char_length(subject) <= 300),
  counterpart_address  text not null check (char_length(counterpart_address) between 3 and 200),
  counterpart_name     text check (counterpart_name is null or char_length(counterpart_name) <= 200),
  client_id            uuid,
  supplier_id          uuid,
  status               text not null default 'open' check (status in ('open', 'closed')),
  assigned_to          uuid references auth.users (id) on delete set null,
  unread_count         integer not null default 0 check (unread_count >= 0),
  message_count        integer not null default 0 check (message_count >= 0),
  preview              text check (preview is null or char_length(preview) <= 200),
  last_direction       text check (last_direction is null or last_direction in ('in', 'out')),
  last_message_at      timestamptz not null default now(),
  closed_at            timestamptz,
  closed_by            uuid references auth.users (id) on delete set null,
  created_by           uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, company_id),
  unique (company_id, ref),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete set null (client_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id) on delete set null (supplier_id)
);
create index if not exists inbox_conversations_list_idx on public.inbox_conversations (company_id, status, last_message_at desc);
create index if not exists inbox_conversations_counterpart_idx on public.inbox_conversations (company_id, channel, counterpart_address);
create index if not exists inbox_conversations_client_idx on public.inbox_conversations (client_id) where client_id is not null;
create index if not exists inbox_conversations_supplier_idx on public.inbox_conversations (supplier_id) where supplier_id is not null;
create index if not exists inbox_conversations_assigned_idx on public.inbox_conversations (assigned_to) where assigned_to is not null;

create table if not exists public.inbox_messages (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  conversation_id      uuid not null,
  channel              text not null check (channel in ('email', 'whatsapp')),
  direction            text not null check (direction in ('in', 'out')),
  status               text not null default 'received' check (status in ('received', 'sent', 'manual', 'failed')),
  from_address         text check (from_address is null or char_length(from_address) <= 200),
  from_name            text check (from_name is null or char_length(from_name) <= 200),
  to_addresses         text[] not null default '{}',
  cc_addresses         text[] not null default '{}',
  subject              text check (subject is null or char_length(subject) <= 300),
  body_text            text check (body_text is null or char_length(body_text) <= 200000),
  -- Cleaned by the webhook; the app still shows it only inside a sandboxed frame.
  body_html            text check (body_html is null or char_length(body_html) <= 500000),
  provider             text not null default 'app' check (provider ~ '^[a-z0-9_-]{2,30}$'),
  provider_message_id  text check (provider_message_id is null or char_length(provider_message_id) <= 300),
  email_message_id     text check (email_message_id is null or char_length(email_message_id) <= 300),
  in_reply_to          text check (in_reply_to is null or char_length(in_reply_to) <= 300),
  reference_ids        text[] not null default '{}',
  error                text check (error is null or char_length(error) <= 500),
  sent_by              uuid references auth.users (id) on delete set null,
  created_at           timestamptz not null default now(),
  unique (id, company_id),
  foreign key (conversation_id, company_id) references public.inbox_conversations (id, company_id) on delete cascade
);
create index if not exists inbox_messages_conversation_idx on public.inbox_messages (conversation_id, created_at);
create unique index if not exists inbox_messages_provider_key
  on public.inbox_messages (company_id, provider, provider_message_id) where provider_message_id is not null;
create index if not exists inbox_messages_email_id_idx
  on public.inbox_messages (company_id, email_message_id) where email_message_id is not null;

create table if not exists public.inbox_attachments (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies (id) on delete cascade,
  message_id              uuid not null,
  conversation_id         uuid not null,
  file_name               text not null check (char_length(file_name) between 1 and 200),
  content_type            text check (content_type is null or char_length(content_type) <= 120),
  size_bytes              bigint check (size_bytes is null or size_bytes >= 0),
  storage_path            text check (storage_path is null or char_length(storage_path) <= 400),
  provider_attachment_id  text check (provider_attachment_id is null or char_length(provider_attachment_id) <= 300),
  created_at              timestamptz not null default now(),
  foreign key (message_id, company_id) references public.inbox_messages (id, company_id) on delete cascade,
  foreign key (conversation_id, company_id) references public.inbox_conversations (id, company_id) on delete cascade
);
create index if not exists inbox_attachments_message_idx on public.inbox_attachments (message_id);
create index if not exists inbox_attachments_conversation_idx on public.inbox_attachments (conversation_id);

-- ---------------------------------------------------------------------
-- 3. Row-level security and grants: read only; every change is a function.
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['inbox_settings', 'inbox_conversations', 'inbox_messages', 'inbox_attachments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_role(company_id, public.inbox_roles()))', t, t);
  end loop;
  foreach t in array array['inbox_settings', 'inbox_conversations'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['inbox_conversations', 'inbox_messages', 'inbox_attachments'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Storage: private bucket "inbox", files at <company>/<conversation>/<file>.
--    Only the webhook (service role) adds files; inbox roles read them.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('inbox', 'inbox', false) on conflict (id) do nothing;
do $$
begin
  update storage.buckets set public = false, file_size_limit = 15728640 where id = 'inbox';
exception when undefined_column then
  raise notice 'Storage limits not set (older storage version).';
end;
$$;

create or replace function public.can_use_inbox_file(p_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_name not like '%..%' and exists (
    select 1 from public.inbox_conversations c
     where c.company_id::text = (storage.foldername(p_name))[1]
       and c.id::text = (storage.foldername(p_name))[2]
       and public.has_role(c.company_id, public.inbox_roles()));
$$;

drop policy if exists inbox_files_select on storage.objects;
create policy inbox_files_select on storage.objects for select to authenticated
  using (bucket_id = 'inbox' and public.can_use_inbox_file(name));

-- Closed companies: inbox files are cleaned up with the logo and delivery photos.
create or replace function public.add_inbox_cleanup()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  -- Only noted when the company has inbox files (most companies never connect the inbox).
  if new.bucket = 'branding'
     and exists (select 1 from storage.objects o where o.bucket_id = 'inbox' and left(o.name, length(new.prefix)) = new.prefix) then
    insert into public.storage_cleanup (bucket, prefix, company_ref)
    values ('inbox', new.prefix, new.company_ref)
    on conflict (bucket, prefix) do nothing;
    begin
      delete from storage.objects where bucket_id = 'inbox' and name like new.prefix || '%';
    exception when others then
      raise notice 'inbox files for % left in storage: %', new.company_ref, sqlerrm;
    end;
  end if;
  return null;
end;
$$;
do $$
begin
  drop trigger if exists storage_cleanup_inbox on public.storage_cleanup;
  create trigger storage_cleanup_inbox after insert on public.storage_cleanup
    for each row execute function public.add_inbox_cleanup();
exception when undefined_table then
  raise notice 'Run the deletion update first, then this one again, so inbox files are cleaned up with closed companies.';
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Matching an address or phone to a client or supplier of the company
-- ---------------------------------------------------------------------
create or replace function public.inbox_match_party(p_company uuid, p_channel text, p_address text)
returns table (client_id uuid, supplier_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_phone boolean := p_channel = 'whatsapp';
  v_client uuid;
  v_supplier uuid;
begin
  select cc.client_id into v_client
    from public.client_contacts cc join public.clients c on c.id = cc.client_id
   where cc.company_id = p_company and c.active
     and public.inbox_field_has(case when v_phone then cc.phone else cc.email end, p_address, v_phone)
   order by c.created_at, c.id limit 1;
  if v_client is null then
    select s.id into v_supplier from public.suppliers s
     where s.company_id = p_company and s.active
       and public.inbox_field_has(case when v_phone then s.phone else s.email end, p_address, v_phone)
     order by s.created_at, s.id limit 1;
  end if;
  return query select v_client, v_supplier;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Recording a message that arrived (webhooks only: service role)
--
-- p_msg keys:
--   channel             'email' | 'whatsapp'
--   provider            'resend' | 'whatsapp' | 'generic' ...
--   provider_message_id the provider's id (dedupe)
--   from, from_name     sender address (email) or phone (WhatsApp) and name
--   to, cc              arrays of addresses (email: used to find the company)
--   phone_number_id     WhatsApp: the business number that received it
--   subject, text, html (html already cleaned)
--   message_id, in_reply_to, references (array)   email threading headers
--   attachments         [{file_name, content_type, size, provider_attachment_id}]
-- Returns {status: recorded | duplicate | no_company | ignored, company_id,
--          conversation_id, message_id, attachments: [{id, file_name, provider_attachment_id}]}
-- ---------------------------------------------------------------------
create or replace function public.inbox_record_inbound(p_msg jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_channel  text := p_msg ->> 'channel';
  v_provider text := lower(coalesce(nullif(p_msg ->> 'provider', ''), v_channel));
  v_pid      text := nullif(left(btrim(coalesce(p_msg ->> 'provider_message_id', '')), 300), '');
  v_mid      text := nullif(left(btrim(coalesce(p_msg ->> 'message_id', '')), 300), '');
  v_irt      text := nullif(left(btrim(coalesce(p_msg ->> 'in_reply_to', '')), 300), '');
  v_refs     text[];
  v_to       text[];
  v_cc       text[];
  v_from     text;
  v_name     text := nullif(left(btrim(coalesce(p_msg ->> 'from_name', '')), 200), '');
  v_subject  text := nullif(left(btrim(coalesce(p_msg ->> 'subject', '')), 300), '');
  v_text     text := left(coalesce(p_msg ->> 'text', ''), 200000);
  v_html     text := nullif(left(coalesce(p_msg ->> 'html', ''), 500000), '');
  v_co       uuid;
  v_tag      text;
  v_conv     public.inbox_conversations;
  v_msg      uuid;
  v_party    record;
  v_preview  text;
  v_att      jsonb := '[]'::jsonb;
  a          jsonb;
  v_aid      uuid;
  v_addr     text;
  v_existing record;
begin
  if v_channel is null or v_channel not in ('email', 'whatsapp') then
    raise exception 'Unknown channel.' using errcode = '22023';
  end if;
  if v_provider !~ '^[a-z0-9_-]{2,30}$' then
    raise exception 'Unknown provider.' using errcode = '22023';
  end if;
  select coalesce(array_agg(x), '{}') into v_refs
    from (select left(btrim(e), 300) x from jsonb_array_elements_text(coalesce(p_msg -> 'references', '[]')) e
           where btrim(e) <> '' limit 50) r;
  select coalesce(array_agg(x), '{}') into v_to
    from (select left(btrim(e), 200) x from jsonb_array_elements_text(coalesce(p_msg -> 'to', '[]')) e
           where btrim(e) <> '' limit 50) r;
  select coalesce(array_agg(x), '{}') into v_cc
    from (select left(btrim(e), 200) x from jsonb_array_elements_text(coalesce(p_msg -> 'cc', '[]')) e
           where btrim(e) <> '' limit 50) r;

  -- The company: by the business WhatsApp number, or by the address the email was sent to
  -- (alias@domain or alias+<conversation ref>@domain).
  if v_channel = 'whatsapp' then
    v_from := public.inbox_phone_of(p_msg ->> 'from');
    select s.company_id into v_co from public.inbox_settings s
     where s.whatsapp_phone_number_id = nullif(btrim(coalesce(p_msg ->> 'phone_number_id', '')), '');
  else
    v_from := public.inbox_email_of(p_msg ->> 'from');
    foreach v_addr in array v_to || v_cc || array(select jsonb_array_elements_text(coalesce(p_msg -> 'delivered_to', '[]'))) loop
      v_addr := public.inbox_email_of(v_addr);
      continue when v_addr is null;
      select s.company_id into v_co from public.inbox_settings s
       where s.inbound_address = regexp_replace(v_addr, '\+[^@]*@', '@');
      if v_co is not null then
        v_tag := substring(v_addr from '^[^@+]+\+([a-z0-9]{6,16})@');
        exit;
      end if;
    end loop;
  end if;
  if v_co is null then
    return jsonb_build_object('status', 'no_company');
  end if;
  if v_from is null or char_length(v_from) < 3 then
    return jsonb_build_object('status', 'ignored', 'reason', 'no sender');
  end if;
  -- Mail we sent ourselves (e.g. a copy to the inbox address) is not a new message.
  if exists (select 1 from public.inbox_settings s where s.company_id = v_co and s.inbound_address = v_from) then
    return jsonb_build_object('status', 'ignored', 'reason', 'own address');
  end if;

  -- One message at a time per provider id (the provider may retry while we work).
  perform pg_advisory_xact_lock(hashtextextended(v_co::text || ':' || v_provider || ':' || coalesce(v_pid, v_mid, ''), 0));
  select m.id, m.conversation_id into v_existing from public.inbox_messages m
   where m.company_id = v_co and m.direction = 'in'
     and ((v_pid is not null and m.provider = v_provider and m.provider_message_id = v_pid)
          or (v_mid is not null and m.email_message_id = v_mid))
   limit 1;
  if v_existing.id is not null then
    return jsonb_build_object('status', 'duplicate', 'company_id', v_co,
                              'conversation_id', v_existing.conversation_id, 'message_id', v_existing.id);
  end if;

  -- The conversation: the reply-to code, then the email thread, then the same person.
  if v_tag is not null then
    select * into v_conv from public.inbox_conversations c
     where c.company_id = v_co and c.ref = v_tag and c.channel = v_channel;
  end if;
  if v_conv.id is null and v_channel = 'email' and (v_irt is not null or cardinality(v_refs) > 0) then
    select c.* into v_conv from public.inbox_messages m
      join public.inbox_conversations c on c.id = m.conversation_id
     where m.company_id = v_co and m.email_message_id is not null
       and (m.email_message_id = v_irt or m.email_message_id = any (v_refs))
     order by m.created_at desc limit 1;
  end if;
  if v_conv.id is null and v_channel = 'email' then
    select * into v_conv from public.inbox_conversations c
     where c.company_id = v_co and c.channel = 'email' and c.counterpart_address = v_from
       and public.inbox_subject_key(c.subject) = public.inbox_subject_key(v_subject)
       and c.last_message_at > now() - interval '60 days'
     order by c.last_message_at desc limit 1;
  end if;
  if v_conv.id is null and v_channel = 'whatsapp' then
    select * into v_conv from public.inbox_conversations c
     where c.company_id = v_co and c.channel = 'whatsapp' and c.counterpart_address = v_from
     order by c.last_message_at desc limit 1;
  end if;
  if v_conv.id is null then
    select * into v_party from public.inbox_match_party(v_co, v_channel, v_from);
    insert into public.inbox_conversations (company_id, channel, subject, counterpart_address, counterpart_name, client_id, supplier_id)
    values (v_co, v_channel, v_subject, v_from, v_name, v_party.client_id, v_party.supplier_id)
    returning * into v_conv;
  elsif v_conv.client_id is null and v_conv.supplier_id is null then
    select * into v_party from public.inbox_match_party(v_co, v_channel, v_conv.counterpart_address);
    if v_party.client_id is not null or v_party.supplier_id is not null then
      update public.inbox_conversations set client_id = v_party.client_id, supplier_id = v_party.supplier_id
       where id = v_conv.id;
    end if;
  end if;

  insert into public.inbox_messages (company_id, conversation_id, channel, direction, status, from_address, from_name,
                                     to_addresses, cc_addresses, subject, body_text, body_html, provider,
                                     provider_message_id, email_message_id, in_reply_to, reference_ids)
  values (v_co, v_conv.id, v_channel, 'in', 'received', v_from, v_name, v_to, v_cc, v_subject, v_text, v_html, v_provider,
          v_pid, v_mid, v_irt, v_refs)
  returning id into v_msg;

  for a in select * from jsonb_array_elements(coalesce(p_msg -> 'attachments', '[]')) limit 20 loop
    insert into public.inbox_attachments (company_id, message_id, conversation_id, file_name, content_type, size_bytes, provider_attachment_id)
    values (v_co, v_msg, v_conv.id,
            left(coalesce(nullif(btrim(regexp_replace(a ->> 'file_name', '[/\\[:cntrl:]]', '_', 'g')), ''), 'attachment'), 200),
            nullif(left(a ->> 'content_type', 120), ''),
            case when (a ->> 'size') ~ '^\d{1,12}$' then (a ->> 'size')::bigint end,
            nullif(left(a ->> 'provider_attachment_id', 300), ''))
    returning id into v_aid;
    v_att := v_att || jsonb_build_array(jsonb_build_object('id', v_aid, 'file_name', a ->> 'file_name',
                                                           'provider_attachment_id', a ->> 'provider_attachment_id'));
  end loop;

  v_preview := left(btrim(regexp_replace(coalesce(nullif(v_text, ''), v_subject, ''), '\s+', ' ', 'g')), 200);
  update public.inbox_conversations
     set unread_count = unread_count + 1,
         message_count = message_count + 1,
         last_message_at = now(),
         last_direction = 'in',
         preview = v_preview,
         status = 'open',
         closed_at = null,
         closed_by = null,
         counterpart_name = coalesce(counterpart_name, v_name),
         subject = coalesce(subject, v_subject)
   where id = v_conv.id;

  -- Management and sales are told at once; so is the person handling it.
  begin
    perform public.notify_roles(v_co, array['management', 'sales']::public.app_role[], v_conv.assigned_to, 'inbox_message', 'attention',
      case when v_channel = 'email' then 'New email from ' else 'New WhatsApp from ' end || coalesce(v_name, v_from),
      coalesce(v_subject, 'Open the inbox to read and reply.'),
      '/inbox/' || v_conv.id::text, 'inbox:' || v_msg::text);
    if v_conv.assigned_to is not null then
      perform public.notify(v_co, v_conv.assigned_to, 'inbox_message', 'attention',
        'Reply from ' || coalesce(v_name, v_from), coalesce(v_subject, 'Open the conversation to read it.'),
        '/inbox/' || v_conv.id::text, 'inbox:' || v_msg::text);
    end if;
  exception when others then
    raise warning 'Inbox notification failed: %', sqlerrm;
  end;

  return jsonb_build_object('status', 'recorded', 'company_id', v_co, 'conversation_id', v_conv.id,
                            'message_id', v_msg, 'attachments', v_att);
end;
$$;

-- The webhook uploaded a file to inbox/<company>/<conversation>/<file>: remember where.
create or replace function public.inbox_attachment_stored(p_attachment uuid, p_path text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.inbox_attachments;
begin
  select * into a from public.inbox_attachments where id = p_attachment for update;
  if a.id is null then
    raise exception 'Attachment not found.' using errcode = 'P0002';
  end if;
  if p_path not like a.company_id::text || '/' || a.conversation_id::text || '/%' or p_path like '%..%'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'inbox' and o.name = p_path) then
    raise exception 'The file was not found in the inbox folder of this conversation.' using errcode = '22023';
  end if;
  update public.inbox_attachments set storage_path = p_path where id = p_attachment;
end;
$$;

-- The mailbox job (service role) notes how far it read the company mailbox, or why it could not.
create or replace function public.inbox_mailbox_state(p_company uuid, p_uidvalidity bigint, p_last_uid bigint, p_error text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.inbox_settings
     set mailbox_uidvalidity = coalesce(p_uidvalidity, mailbox_uidvalidity),
         mailbox_last_uid = case when p_uidvalidity is not null then p_last_uid else mailbox_last_uid end,
         mailbox_checked_at = now(),
         mailbox_error = nullif(left(coalesce(p_error, ''), 300), '')
   where company_id = p_company;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. What people do in the app
-- ---------------------------------------------------------------------
create or replace function public.inbox_conversation_for_update(p_conversation uuid)
returns public.inbox_conversations language plpgsql security definer set search_path = ''
as $$
declare
  c public.inbox_conversations;
begin
  select * into c from public.inbox_conversations where id = p_conversation for update;
  if c.id is null or not public.has_role(c.company_id, public.inbox_roles()) then
    raise exception 'Conversation not found.' using errcode = '42501';
  end if;
  return c;
end;
$$;

-- Close or reopen.
create or replace function public.inbox_set_status(p_conversation uuid, p_status text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  c public.inbox_conversations := public.inbox_conversation_for_update(p_conversation);
begin
  if p_status not in ('open', 'closed') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  if c.status = p_status then return; end if;
  update public.inbox_conversations
     set status = p_status,
         closed_at = case when p_status = 'closed' then now() end,
         closed_by = case when p_status = 'closed' then auth.uid() end,
         unread_count = case when p_status = 'closed' then 0 else unread_count end
   where id = c.id;
end;
$$;

-- Give the conversation to someone who can use the inbox (null: nobody).
create or replace function public.inbox_assign(p_conversation uuid, p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  c public.inbox_conversations := public.inbox_conversation_for_update(p_conversation);
begin
  if p_user is not null and not exists (
       select 1 from public.memberships m
        where m.company_id = c.company_id and m.user_id = p_user and m.active and m.role = any (public.inbox_roles())) then
    raise exception 'That person cannot use the inbox.' using errcode = '22023';
  end if;
  if c.assigned_to is not distinct from p_user then return; end if;
  update public.inbox_conversations set assigned_to = p_user where id = c.id;
  if p_user is not null and p_user is distinct from auth.uid() then
    perform public.notify(c.company_id, p_user, 'inbox_assigned', 'info',
      'Conversation for you: ' || coalesce(c.counterpart_name, c.counterpart_address),
      coalesce(c.subject, c.preview, 'Open the conversation to reply.'),
      '/inbox/' || c.id::text, 'inbox-assigned:' || c.id::text || ':' || extract(epoch from now())::bigint::text);
  end if;
end;
$$;

create or replace function public.inbox_mark_read(p_conversation uuid, p_read boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  c public.inbox_conversations := public.inbox_conversation_for_update(p_conversation);
begin
  update public.inbox_conversations
     set unread_count = case when p_read then 0 else greatest(unread_count, 1) end
   where id = c.id and unread_count is distinct from (case when p_read then 0 else greatest(unread_count, 1) end);
end;
$$;

-- Link (or unlink) the client or supplier by hand.
create or replace function public.inbox_link(p_conversation uuid, p_client uuid, p_supplier uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  c public.inbox_conversations := public.inbox_conversation_for_update(p_conversation);
begin
  if p_client is not null and p_supplier is not null then
    raise exception 'Link a client or a supplier, not both.' using errcode = '22023';
  end if;
  if p_client is not null and not exists (select 1 from public.clients where id = p_client and company_id = c.company_id) then
    raise exception 'Client not found.' using errcode = '22023';
  end if;
  if p_supplier is not null and not exists (select 1 from public.suppliers where id = p_supplier and company_id = c.company_id) then
    raise exception 'Supplier not found.' using errcode = '22023';
  end if;
  update public.inbox_conversations set client_id = p_client, supplier_id = p_supplier where id = c.id;
end;
$$;

-- Start a new conversation (an email or WhatsApp to a client or supplier).
create or replace function public.inbox_start_conversation(p_company uuid, p_channel text, p_address text, p_name text,
                                                           p_subject text, p_client uuid, p_supplier uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_addr text;
  v_id   uuid;
  v_party record;
begin
  if not public.has_role(p_company, public.inbox_roles()) then
    raise exception 'You cannot use the inbox.' using errcode = '42501';
  end if;
  if p_channel not in ('email', 'whatsapp') then
    raise exception 'Unknown channel.' using errcode = '22023';
  end if;
  v_addr := case when p_channel = 'email' then public.inbox_email_of(p_address) else public.inbox_phone_of(p_address) end;
  if v_addr is null or (p_channel = 'whatsapp' and length(v_addr) not between 9 and 15) then
    raise exception 'Enter a valid %.', case when p_channel = 'email' then 'email address' else 'phone number' end using errcode = '22023';
  end if;
  if p_client is not null and p_supplier is not null then
    raise exception 'Link a client or a supplier, not both.' using errcode = '22023';
  end if;
  if p_client is not null and not exists (select 1 from public.clients where id = p_client and company_id = p_company) then
    raise exception 'Client not found.' using errcode = '22023';
  end if;
  if p_supplier is not null and not exists (select 1 from public.suppliers where id = p_supplier and company_id = p_company) then
    raise exception 'Supplier not found.' using errcode = '22023';
  end if;
  if p_client is null and p_supplier is null then
    select * into v_party from public.inbox_match_party(p_company, p_channel, v_addr);
  end if;
  insert into public.inbox_conversations (company_id, channel, subject, counterpart_address, counterpart_name,
                                          client_id, supplier_id, assigned_to, created_by, message_count)
  values (p_company, p_channel, nullif(left(btrim(coalesce(p_subject, '')), 300), ''), v_addr,
          nullif(left(btrim(coalesce(p_name, '')), 200), ''),
          coalesce(p_client, v_party.client_id), case when p_client is null then coalesce(p_supplier, v_party.supplier_id) end,
          auth.uid(), auth.uid(), 0)
  returning id into v_id;
  return v_id;
end;
$$;

-- A reply that the app sent (or that someone sent by hand from WhatsApp on their phone).
-- p_msg keys: status (sent | manual | failed), text, html, subject, from, to, cc, provider,
--             provider_message_id, message_id, in_reply_to, references, error
create or replace function public.inbox_record_outbound(p_conversation uuid, p_msg jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  c        public.inbox_conversations := public.inbox_conversation_for_update(p_conversation);
  v_status text := coalesce(p_msg ->> 'status', 'sent');
  v_text   text := btrim(coalesce(p_msg ->> 'text', ''));
  v_id     uuid;
  v_to     text[];
  v_cc     text[];
  v_refs   text[];
  v_me     text;
begin
  if v_status not in ('sent', 'manual', 'failed') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  if v_text = '' then
    raise exception 'Write a message first.' using errcode = '22023';
  end if;
  if char_length(v_text) > 50000 then
    raise exception 'The message is too long.' using errcode = '22023';
  end if;
  select coalesce(array_agg(left(btrim(e), 200)), '{}') into v_to
    from jsonb_array_elements_text(coalesce(p_msg -> 'to', '[]')) e where btrim(e) <> '';
  select coalesce(array_agg(left(btrim(e), 200)), '{}') into v_cc
    from jsonb_array_elements_text(coalesce(p_msg -> 'cc', '[]')) e where btrim(e) <> '';
  select coalesce(array_agg(left(btrim(e), 300)), '{}') into v_refs
    from (select e from jsonb_array_elements_text(coalesce(p_msg -> 'references', '[]')) e where btrim(e) <> '' limit 50) r;
  if cardinality(v_to) = 0 then v_to := array[c.counterpart_address]; end if;
  if cardinality(v_to) + cardinality(v_cc) > 20 then
    raise exception 'Too many recipients.' using errcode = '22023';
  end if;
  v_me := nullif(btrim(coalesce(p_msg ->> 'from', '')), '');
  if v_me is null then
    select case when c.channel = 'email' then s.inbound_address else s.whatsapp_display_phone end into v_me
      from public.inbox_settings s where s.company_id = c.company_id;
  end if;

  insert into public.inbox_messages (company_id, conversation_id, channel, direction, status, from_address, to_addresses,
                                     cc_addresses, subject, body_text, body_html, provider, provider_message_id,
                                     email_message_id, in_reply_to, reference_ids, error, sent_by)
  values (c.company_id, c.id, c.channel, 'out', v_status, left(v_me, 200), v_to, v_cc,
          nullif(left(btrim(coalesce(p_msg ->> 'subject', '')), 300), ''), v_text,
          nullif(left(coalesce(p_msg ->> 'html', ''), 500000), ''),
          case when coalesce(p_msg ->> 'provider', '') ~ '^[a-z0-9_-]{2,30}$' then p_msg ->> 'provider' else 'app' end,
          nullif(left(btrim(coalesce(p_msg ->> 'provider_message_id', '')), 300), ''),
          nullif(left(btrim(coalesce(p_msg ->> 'message_id', '')), 300), ''),
          nullif(left(btrim(coalesce(p_msg ->> 'in_reply_to', '')), 300), ''),
          v_refs, nullif(left(coalesce(p_msg ->> 'error', ''), 500), ''), auth.uid())
  returning id into v_id;

  if v_status <> 'failed' then
    update public.inbox_conversations
       set message_count = message_count + 1,
           last_message_at = now(),
           last_direction = 'out',
           preview = left(btrim(regexp_replace(v_text, '\s+', ' ', 'g')), 200),
           unread_count = 0,
           assigned_to = coalesce(assigned_to, auth.uid()),
           subject = coalesce(subject, nullif(left(btrim(coalesce(p_msg ->> 'subject', '')), 300), ''))
     where id = c.id;
  end if;
  return v_id;
end;
$$;

-- Management sets the inbound address and the WhatsApp number of the company.
create or replace function public.inbox_save_settings(p_company uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_addr  text := nullif(lower(btrim(coalesce(p_settings ->> 'inbound_address', ''))), '');
  v_wa    text := nullif(regexp_replace(coalesce(p_settings ->> 'whatsapp_phone_number_id', ''), '\s', '', 'g'), '');
begin
  if not public.has_role(p_company, array['management']::public.app_role[]) then
    raise exception 'Only management can change the inbox settings.' using errcode = '42501';
  end if;
  if v_addr is not null and (v_addr !~ '^[a-z0-9._-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$' or char_length(v_addr) > 120) then
    raise exception 'The inbox address must look like name@domain.co.tz (letters, numbers, dots and dashes; no +).' using errcode = '22023';
  end if;
  if v_addr is not null and exists (select 1 from public.inbox_settings where inbound_address = v_addr and company_id <> p_company) then
    raise exception 'That inbox address is already used by another company.' using errcode = '23505';
  end if;
  if v_wa is not null and v_wa !~ '^[0-9]{5,30}$' then
    raise exception 'The WhatsApp phone number ID is the long number Meta shows (digits only).' using errcode = '22023';
  end if;
  if v_wa is not null and exists (select 1 from public.inbox_settings where whatsapp_phone_number_id = v_wa and company_id <> p_company) then
    raise exception 'That WhatsApp number is already used by another company.' using errcode = '23505';
  end if;
  insert into public.inbox_settings (company_id, inbound_address, whatsapp_phone_number_id, whatsapp_display_phone,
                                     reply_name, signature, updated_by)
  values (p_company, v_addr, v_wa,
          nullif(left(btrim(coalesce(p_settings ->> 'whatsapp_display_phone', '')), 40), ''),
          nullif(left(btrim(coalesce(p_settings ->> 'reply_name', '')), 80), ''),
          nullif(left(btrim(coalesce(p_settings ->> 'signature', '')), 1000), ''),
          auth.uid())
  on conflict (company_id) do update
     set inbound_address = excluded.inbound_address,
         whatsapp_phone_number_id = excluded.whatsapp_phone_number_id,
         whatsapp_display_phone = excluded.whatsapp_display_phone,
         reply_name = excluded.reply_name,
         signature = excluded.signature,
         updated_by = excluded.updated_by;
end;
$$;

-- For the menu badge: open conversations with unread messages (0 for people without the inbox).
create or replace function public.inbox_unread_count(p_company uuid)
returns integer language sql stable security definer set search_path = ''
as $$
  select case when public.has_role(p_company, public.inbox_roles())
              then (select count(*)::integer from public.inbox_conversations c
                     where c.company_id = p_company and c.status = 'open' and c.unread_count > 0)
              else 0 end;
$$;

-- ---------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.inbox_roles(), public.inbox_email_of(text), public.inbox_phone_of(text), public.inbox_field_has(text, text, boolean),
  public.inbox_subject_key(text), public.can_use_inbox_file(text), public.add_inbox_cleanup(),
  public.inbox_match_party(uuid, text, text), public.inbox_record_inbound(jsonb), public.inbox_attachment_stored(uuid, text),
  public.inbox_mailbox_state(uuid, bigint, bigint, text), public.inbox_conversation_for_update(uuid), public.inbox_set_status(uuid, text), public.inbox_assign(uuid, uuid),
  public.inbox_mark_read(uuid, boolean), public.inbox_link(uuid, uuid, uuid),
  public.inbox_start_conversation(uuid, text, text, text, text, uuid, uuid), public.inbox_record_outbound(uuid, jsonb),
  public.inbox_save_settings(uuid, jsonb), public.inbox_unread_count(uuid)
from public, anon, authenticated;

-- Used inside the security rules and the screens.
grant execute on function
  public.inbox_roles(), public.can_use_inbox_file(text),
  public.inbox_set_status(uuid, text), public.inbox_assign(uuid, uuid), public.inbox_mark_read(uuid, boolean),
  public.inbox_link(uuid, uuid, uuid), public.inbox_start_conversation(uuid, text, text, text, text, uuid, uuid),
  public.inbox_record_outbound(uuid, jsonb), public.inbox_save_settings(uuid, jsonb), public.inbox_unread_count(uuid)
to authenticated;

-- Only the webhooks (server side, service role key) record what arrives.
grant execute on function
  public.inbox_record_inbound(jsonb), public.inbox_attachment_stored(uuid, text),
  public.inbox_mailbox_state(uuid, bigint, bigint, text)
to service_role;

notify pgrst, 'reload schema';
