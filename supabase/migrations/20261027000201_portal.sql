-- =====================================================================
-- Client and supplier portal: a company's clients and suppliers sign in
-- on /portal with their email (a link or a 6-digit code, no password)
-- and see only their own company's records with our branding.
--
-- Clients: quotations (accept or decline online with name, position and
--   a typed or drawn signature), orders and deliveries (status, proof of
--   delivery), invoices and statements (PDF), documents we share
--   (certificates, SDS) and a message box that lands in our Inbox.
-- Suppliers: answer our supplier RFQs online (prices, lead time,
--   validity, files), see and confirm our purchase orders, send delivery
--   notes and invoices (finance checks them and turns invoices into
--   supplier bills), and keep their details up to date. New bank details
--   are never applied directly: management approves them first.
--
-- Separate identity. Portal people are NOT company members and have no
-- Supabase Auth account. They are rows in portal_users (one per company
-- and client or supplier), signed in with portal_sessions. The portal
-- pages call the portal_* functions below on the server with the
-- service role key; each function checks the session (long random
-- token, only its SHA-256 is kept, expires after 12 idle hours or 7
-- days) and the chosen portal account, and only ever reads or changes
-- that account's own client or supplier. The main app's tables, rules
-- and roles are unchanged: nobody signed in to the app gets a portal
-- session, and no portal session reaches the app's tables directly.
--
--   portal_users            who may sign in, for which client or supplier
--   portal_login_codes      sign-in links and codes (hashes, 15 minutes)
--   portal_sessions         signed-in portal browsers (hashes)
--   portal_rate_hits        rate limit of sign-in and messages
--   portal_quote_decisions  online acceptance or decline, with signature
--   portal_shared_documents documents from the library shown on the portal
--   portal_files            files a client or supplier sent us (bucket "portal")
--   portal_submissions      supplier delivery notes and invoices to check
--   supplier_bank_details   bank details: requested, approved, superseded
--   portal_threads          the Inbox conversation of each portal person
--
-- Every portal action is written to the Activity log (audit_log, action
-- portal_*). Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Feature rows (Settings, then Features)
-- ---------------------------------------------------------------------
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('client_portal', 'Client portal',
 'Your clients sign in with their email to see their quotations, orders, deliveries, invoices and statements, accept a quotation online with a signature, download documents you share and send you messages that land in your Inbox.',
 'Sales', 'medium', 'live', 'Companies with regular corporate clients who ask for documents, order status and statements.',
 'Fewer calls and emails asking "where is my order?", quotations accepted the same day, and every document in one place for the client.',
 '[{"title": "Invite a contact", "body": "Open a client, then Client portal, and invite a contact by email. They sign in with a link or a code sent to that email; no password."},
   {"title": "What they see", "body": "Only their own quotations (once sent), orders, deliveries, invoices, statements and the documents you share with them, with your logo and colours."},
   {"title": "Stay in control", "body": "Accepted quotations, messages and downloads are in the Activity log. Remove access at any time from the client page."}]'::jsonb,
 '/portal-admin', 136),
('supplier_portal', 'Supplier portal',
 'Your suppliers sign in with their email to answer your supplier RFQs online, confirm your purchase orders, send delivery notes and invoices, and keep their company documents up to date. New bank details wait for management approval.',
 'Procurement', 'medium', 'live', 'Companies that buy from several suppliers and compare quotations.',
 'Supplier prices arrive in the comparison table without retyping, orders are confirmed online and invoices reach finance with the purchase order attached.',
 '[{"title": "Invite a supplier contact", "body": "Open a supplier, then Supplier portal, and invite the sales contact by email."},
   {"title": "Send RFQs through the portal", "body": "On a supplier RFQ press Send via portal: the invited suppliers get an email and answer online. Their prices appear in the comparison."},
   {"title": "Check what they send", "body": "Invoices and delivery notes from suppliers wait in Portal for finance to check; an invoice becomes a supplier bill with one tap. Bank detail changes need a manager''s approval."}]'::jsonb,
 '/portal-admin', 246)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. The Inbox gets a third channel: messages from the portal
-- ---------------------------------------------------------------------
do $$
begin
  alter table public.inbox_conversations drop constraint if exists inbox_conversations_channel_check;
  alter table public.inbox_conversations add constraint inbox_conversations_channel_check
    check (channel in ('email', 'whatsapp', 'portal'));
  alter table public.inbox_messages drop constraint if exists inbox_messages_channel_check;
  alter table public.inbox_messages add constraint inbox_messages_channel_check
    check (channel in ('email', 'whatsapp', 'portal'));
exception when undefined_table then
  raise notice 'Run the inbox update (20261026000200_inbox.sql) first, then this one again, so portal messages reach the Inbox.';
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Status functions split in two, so the portal can use them too.
--    The checks a team member passes stay in the public function; the
--    change itself is the same code for the app and for the portal.
-- ---------------------------------------------------------------------
-- The client's answer to a quotation (internal; same rules as before).
create or replace function public.apply_quotation_outcome(p_id uuid, p_accepted boolean, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  q public.quotations;
begin
  select * into q from public.quotations where id = p_id;
  if q.id is null then
    raise exception 'Quotation not found.' using errcode = '42501';
  end if;
  if q.status not in ('approved', 'sent') then
    raise exception 'Only an approved or sent quotation can be accepted or rejected.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.quotations
     set status = case when p_accepted then 'accepted' else 'rejected' end,
         decided_at = now(), outcome_reason = nullif(btrim(p_reason), ''),
         sent_at = coalesce(sent_at, now())
   where id = p_id;
  if q.rfq_id is not null then
    if p_accepted then
      update public.rfqs set status = 'won' where id = q.rfq_id;
    elsif not exists (select 1 from public.quotations where rfq_id = q.rfq_id and id <> p_id
                      and status in ('draft', 'pending_approval', 'approved', 'sent', 'accepted')) then
      update public.rfqs set status = 'lost' where id = q.rfq_id;
    end if;
  end if;
  perform set_config('ims.status_change', 'off', true);
end;
$$;

create or replace function public.record_quotation_outcome(p_id uuid, p_accepted boolean, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  q public.quotations;
begin
  select * into q from public.quotations where id = p_id;
  if q.id is null or not public.has_role(q.company_id, array['management', 'sales']::public.app_role[]) then
    raise exception 'Quotation not found.' using errcode = '42501';
  end if;
  perform public.apply_quotation_outcome(p_id, p_accepted, p_reason);
end;
$$;

-- The supplier confirmed a purchase order (internal; same rules as before).
create or replace function public.apply_po_confirmation(p_id uuid, p_supplier_ref text, p_expected date)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_id;
  if po.id is null then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;
  if po.status not in ('approved', 'sent') then raise exception 'Only an approved or sent purchase order can be confirmed.' using errcode = '22023'; end if;
  perform set_config('ims.status_change', 'on', true);
  update public.purchase_orders
     set status = 'confirmed', confirmed_at = now(), sent_at = coalesce(sent_at, now()),
         supplier_ref = coalesce(nullif(btrim(p_supplier_ref), ''), supplier_ref),
         expected_date = coalesce(p_expected, expected_date)
   where id = p_id;
  perform set_config('ims.status_change', 'off', true);

  -- Latest confirmed price becomes the product's last cost (in base currency).
  insert into public.product_costs (product_id, company_id, main_supplier_id, last_cost)
  select l.product_id, po.company_id, po.supplier_id, round(l.unit_price * po.exchange_rate, 2)
    from public.po_lines l where l.po_id = p_id and l.product_id is not null
  on conflict (product_id) do update
    set last_cost = excluded.last_cost,
        main_supplier_id = coalesce(public.product_costs.main_supplier_id, excluded.main_supplier_id);
end;
$$;

create or replace function public.confirm_purchase_order(p_id uuid, p_supplier_ref text, p_expected date)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_id;
  if po.id is null or not public.has_role(po.company_id, array['management', 'procurement']::public.app_role[]) then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;
  perform public.apply_po_confirmation(p_id, p_supplier_ref, p_expected);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------
create or replace function public.portal_digest(p text)
returns text language sql immutable set search_path = ''
as $$ select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex'); $$;

-- 64 random hex characters (two random UUIDs: 244 random bits).
create or replace function public.portal_new_token()
returns text language sql volatile set search_path = ''
as $$ select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''); $$;

-- A random 6-digit code (from the random part of a UUID).
create or replace function public.portal_new_code()
returns text language sql volatile set search_path = ''
as $$ select lpad(((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))::bit(48)::bigint) % 1000000)::text, 6, '0'); $$;

create or replace function public.portal_email(p text)
returns text language sql immutable set search_path = ''
as $$
  select case when v ~ '^[^@\s<>"(),;:]+@[^@\s<>"(),;:]+\.[^@\s<>"(),;:]+$' and char_length(v) <= 200 then v end
    from (select lower(btrim(coalesce(p, ''))) as v) x;
$$;

create or replace function public.portal_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Africa/Dar_es_Salaam')::date; $$;

-- Who in our team reads the portal records.
create or replace function public.portal_staff_roles()
returns public.app_role[] language sql immutable set search_path = ''
as $$ select array['management', 'sales', 'procurement', 'finance']::public.app_role[]; $$;

-- ---------------------------------------------------------------------
-- 4. Tables
-- ---------------------------------------------------------------------
create table if not exists public.portal_users (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  party            text not null check (party in ('client', 'supplier')),
  client_id        uuid,
  supplier_id      uuid,
  contact_id       uuid references public.client_contacts (id) on delete set null,
  name             text not null check (char_length(btrim(name)) between 2 and 120),
  email            text not null check (email = lower(btrim(email)) and char_length(email) between 5 and 200 and email like '%@%.%'),
  phone            text check (phone is null or char_length(phone) <= 40),
  position         text check (position is null or char_length(position) <= 120),
  status           text not null default 'active' check (status in ('active', 'revoked')),
  invited_by       uuid references auth.users (id) on delete set null,
  invited_at       timestamptz not null default now(),
  revoked_by       uuid references auth.users (id) on delete set null,
  revoked_at       timestamptz,
  last_sign_in_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, company_id),
  check ((party = 'client' and client_id is not null and supplier_id is null)
      or (party = 'supplier' and supplier_id is not null and client_id is null)),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade,
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id) on delete cascade
);
create unique index if not exists portal_users_one_key
  on public.portal_users (company_id, email, coalesce(client_id, supplier_id));
create index if not exists portal_users_email_idx on public.portal_users (email) where status = 'active';
create index if not exists portal_users_client_idx on public.portal_users (client_id) where client_id is not null;
create index if not exists portal_users_supplier_idx on public.portal_users (supplier_id) where supplier_id is not null;

-- Secrets: no company_id and hash columns, so never in a company backup.
create table if not exists public.portal_login_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  code_hash   text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists portal_login_codes_email_idx on public.portal_login_codes (email, created_at desc);

create table if not exists public.portal_sessions (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  ip            text check (ip is null or char_length(ip) <= 64),
  user_agent    text check (user_agent is null or char_length(user_agent) <= 300)
);
create index if not exists portal_sessions_email_idx on public.portal_sessions (email);

create table if not exists public.portal_rate_hits (
  id          bigint generated always as identity primary key,
  bucket      text not null check (char_length(bucket) between 2 and 40),
  key_hash    text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at  timestamptz not null default now()
);
create index if not exists portal_rate_hits_idx on public.portal_rate_hits (bucket, key_hash, created_at);

create table if not exists public.portal_quote_decisions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  quotation_id     uuid not null,
  portal_user_id   uuid not null,
  decision         text not null check (decision in ('accepted', 'declined')),
  signer_name      text not null check (char_length(btrim(signer_name)) between 2 and 120),
  signer_position  text check (signer_position is null or char_length(signer_position) <= 120),
  signature_kind   text check (signature_kind is null or signature_kind in ('typed', 'drawn')),
  signature_text   text check (signature_text is null or char_length(signature_text) <= 120),
  signature_image  text check (signature_image is null or (signature_image like 'data:image/png;base64,%' and char_length(signature_image) <= 300000)),
  reason           text check (reason is null or char_length(reason) <= 1000),
  client_po_ref    text check (client_po_ref is null or char_length(client_po_ref) <= 120),
  signed_ip        text check (signed_ip is null or char_length(signed_ip) <= 64),
  user_agent       text check (user_agent is null or char_length(user_agent) <= 300),
  created_at       timestamptz not null default now(),
  unique (id, company_id),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id) on delete cascade,
  foreign key (portal_user_id, company_id) references public.portal_users (id, company_id) on delete cascade
);
create index if not exists portal_quote_decisions_quote_idx on public.portal_quote_decisions (quotation_id);

create table if not exists public.portal_shared_documents (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  document_id  uuid not null,
  client_id    uuid,
  supplier_id  uuid,
  shared_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  check ((client_id is null) <> (supplier_id is null)),
  foreign key (document_id, company_id) references public.documents (id, company_id) on delete cascade,
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade,
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id) on delete cascade
);
create unique index if not exists portal_shared_documents_key
  on public.portal_shared_documents (document_id, coalesce(client_id, supplier_id));
create index if not exists portal_shared_documents_party_idx on public.portal_shared_documents (company_id, client_id, supplier_id);

create table if not exists public.portal_submissions (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  supplier_id          uuid not null,
  portal_user_id       uuid,
  kind                 text not null check (kind in ('invoice', 'delivery_note')),
  po_id                uuid,
  supplier_invoice_no  text check (supplier_invoice_no is null or char_length(supplier_invoice_no) <= 80),
  reference            text check (reference is null or char_length(reference) <= 120),
  doc_date             date not null,
  due_date             date,
  currency             text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  subtotal             numeric(18, 2) not null default 0 check (subtotal >= 0),
  vat_amount           numeric(18, 2) not null default 0 check (vat_amount >= 0),
  total                numeric(18, 2) generated always as (subtotal + vat_amount) stored,
  notes                text check (notes is null or char_length(notes) <= 2000),
  status               text not null default 'submitted' check (status in ('submitted', 'billed', 'accepted', 'rejected')),
  bill_id              uuid,
  review_note          text check (review_note is null or char_length(review_note) <= 1000),
  reviewed_by          uuid references auth.users (id) on delete set null,
  reviewed_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (id, company_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id) on delete cascade,
  foreign key (portal_user_id, company_id) references public.portal_users (id, company_id) on delete set null (portal_user_id),
  foreign key (po_id, company_id) references public.purchase_orders (id, company_id) on delete set null (po_id),
  foreign key (bill_id, company_id) references public.supplier_bills (id, company_id) on delete set null (bill_id)
);
create index if not exists portal_submissions_company_idx on public.portal_submissions (company_id, status, created_at desc);
create index if not exists portal_submissions_supplier_idx on public.portal_submissions (supplier_id);

create table if not exists public.supplier_bank_details (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  supplier_id      uuid not null,
  bank_name        text not null check (char_length(btrim(bank_name)) between 2 and 120),
  account_name     text not null check (char_length(btrim(account_name)) between 2 and 160),
  account_number   text not null check (account_number ~ '^[0-9A-Za-z -]{4,40}$'),
  branch           text check (branch is null or char_length(branch) <= 120),
  swift_code       text check (swift_code is null or swift_code ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  currency         text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'superseded', 'withdrawn')),
  requested_by     uuid,
  requested_at     timestamptz not null default now(),
  decided_by       uuid references auth.users (id) on delete set null,
  decided_at       timestamptz,
  decision_note    text check (decision_note is null or char_length(decision_note) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, company_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id) on delete cascade,
  foreign key (requested_by, company_id) references public.portal_users (id, company_id) on delete set null (requested_by)
);
create unique index if not exists supplier_bank_details_one_pending on public.supplier_bank_details (supplier_id) where status = 'pending';
create unique index if not exists supplier_bank_details_one_current on public.supplier_bank_details (supplier_id) where status = 'approved';

create table if not exists public.portal_files (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  portal_user_id    uuid,
  client_id         uuid,
  supplier_id       uuid,
  purpose           text not null check (purpose in ('rfq_quote', 'delivery_note', 'invoice', 'licence', 'tin_certificate',
                                                     'bank_letter', 'company_document', 'message')),
  srfq_supplier_id  uuid,
  submission_id     uuid,
  bank_detail_id    uuid,
  title             text check (title is null or char_length(title) <= 200),
  reference         text check (reference is null or char_length(reference) <= 120),
  expires_on        date,
  file_name         text not null check (char_length(file_name) between 1 and 200),
  content_type      text check (content_type is null or char_length(content_type) <= 120),
  size_bytes        bigint check (size_bytes is null or size_bytes between 0 and 15728640),
  storage_path      text not null check (char_length(storage_path) <= 400),
  stored_at         timestamptz,
  created_at        timestamptz not null default now(),
  unique (id, company_id),
  check ((client_id is null) <> (supplier_id is null)),
  foreign key (portal_user_id, company_id) references public.portal_users (id, company_id) on delete set null (portal_user_id),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete cascade,
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id) on delete cascade,
  foreign key (srfq_supplier_id, company_id) references public.supplier_rfq_suppliers (id, company_id) on delete set null (srfq_supplier_id),
  foreign key (submission_id, company_id) references public.portal_submissions (id, company_id) on delete set null (submission_id),
  foreign key (bank_detail_id, company_id) references public.supplier_bank_details (id, company_id) on delete set null (bank_detail_id)
);
create index if not exists portal_files_party_idx on public.portal_files (company_id, client_id, supplier_id);
create index if not exists portal_files_srfq_idx on public.portal_files (srfq_supplier_id) where srfq_supplier_id is not null;
create index if not exists portal_files_submission_idx on public.portal_files (submission_id) where submission_id is not null;

create table if not exists public.portal_threads (
  portal_user_id   uuid primary key,
  company_id       uuid not null references public.companies (id) on delete cascade,
  conversation_id  uuid not null unique,
  created_at       timestamptz not null default now(),
  foreign key (portal_user_id, company_id) references public.portal_users (id, company_id) on delete cascade,
  foreign key (conversation_id, company_id) references public.inbox_conversations (id, company_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- 5. Row-level security: our team reads; every change is a function.
--    Portal sign-in tables: nobody but the server (service role).
-- ---------------------------------------------------------------------
alter table public.portal_users            enable row level security;
alter table public.portal_login_codes      enable row level security;
alter table public.portal_sessions         enable row level security;
alter table public.portal_rate_hits        enable row level security;
alter table public.portal_quote_decisions  enable row level security;
alter table public.portal_shared_documents enable row level security;
alter table public.portal_submissions      enable row level security;
alter table public.supplier_bank_details   enable row level security;
alter table public.portal_files            enable row level security;
alter table public.portal_threads          enable row level security;

revoke all on public.portal_users, public.portal_login_codes, public.portal_sessions, public.portal_rate_hits,
              public.portal_quote_decisions, public.portal_shared_documents, public.portal_submissions,
              public.supplier_bank_details, public.portal_files, public.portal_threads
  from public, anon, authenticated;
grant all on public.portal_users, public.portal_login_codes, public.portal_sessions, public.portal_rate_hits,
             public.portal_quote_decisions, public.portal_shared_documents, public.portal_submissions,
             public.supplier_bank_details, public.portal_files, public.portal_threads
  to service_role;
grant select on public.portal_users, public.portal_quote_decisions, public.portal_shared_documents, public.portal_submissions,
                public.supplier_bank_details, public.portal_files, public.portal_threads
  to authenticated;

drop policy if exists portal_users_select on public.portal_users;
create policy portal_users_select on public.portal_users for select to authenticated
  using (public.has_role(company_id, public.portal_staff_roles()));
drop policy if exists portal_quote_decisions_select on public.portal_quote_decisions;
create policy portal_quote_decisions_select on public.portal_quote_decisions for select to authenticated
  using (public.has_role(company_id, array['management', 'sales', 'finance']::public.app_role[]));
drop policy if exists portal_shared_documents_select on public.portal_shared_documents;
create policy portal_shared_documents_select on public.portal_shared_documents for select to authenticated
  using (public.has_role(company_id, public.portal_staff_roles()));
drop policy if exists portal_submissions_select on public.portal_submissions;
create policy portal_submissions_select on public.portal_submissions for select to authenticated
  using (public.has_role(company_id, array['management', 'procurement', 'finance', 'warehouse']::public.app_role[]));
-- Bank details: management and finance only.
drop policy if exists supplier_bank_details_select on public.supplier_bank_details;
create policy supplier_bank_details_select on public.supplier_bank_details for select to authenticated
  using (public.has_role(company_id, array['management', 'finance']::public.app_role[]));
drop policy if exists portal_files_select on public.portal_files;
create policy portal_files_select on public.portal_files for select to authenticated
  using (case when purpose = 'bank_letter'
              then public.has_role(company_id, array['management', 'finance']::public.app_role[])
              else public.has_role(company_id, array['management', 'sales', 'procurement', 'finance', 'warehouse']::public.app_role[]) end);
drop policy if exists portal_threads_select on public.portal_threads;
create policy portal_threads_select on public.portal_threads for select to authenticated
  using (public.has_role(company_id, public.portal_staff_roles()));

do $$
declare
  t text;
begin
  foreach t in array array['portal_users', 'portal_submissions', 'supplier_bank_details'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['portal_users', 'portal_quote_decisions', 'portal_shared_documents', 'portal_submissions',
                           'supplier_bank_details', 'portal_files', 'portal_threads'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
  end loop;
  -- The Activity log records who invited, removed, shared, approved and checked.
  foreach t in array array['portal_users', 'portal_shared_documents', 'portal_submissions', 'supplier_bank_details'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Storage: private bucket "portal", files at <company>/<client or supplier>/<file>.
--    Only the portal server (service role) adds files; our team reads them.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('portal', 'portal', false) on conflict (id) do nothing;
do $$
begin
  update storage.buckets
     set public = false,
         file_size_limit = 15728640,
         allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
                                    'application/msword',
                                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                    'application/vnd.ms-excel',
                                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
   where id = 'portal';
exception when undefined_column then
  raise notice 'Storage limits not set (older storage version).';
end;
$$;

create or replace function public.can_use_portal_file(p_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_name not like '%..%' and exists (
    select 1 from public.portal_files f
     where f.storage_path = p_name
       and f.company_id::text = (storage.foldername(p_name))[1]
       and case when f.purpose = 'bank_letter'
                then public.has_role(f.company_id, array['management', 'finance']::public.app_role[])
                else public.has_role(f.company_id, array['management', 'sales', 'procurement', 'finance', 'warehouse']::public.app_role[]) end);
$$;

drop policy if exists portal_files_read on storage.objects;
create policy portal_files_read on storage.objects for select to authenticated
  using (bucket_id = 'portal' and public.can_use_portal_file(name));

-- Closed companies: portal files go with the logo and delivery photos.
create or replace function public.add_portal_cleanup()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.bucket = 'branding'
     and exists (select 1 from storage.objects o where o.bucket_id = 'portal' and left(o.name, length(new.prefix)) = new.prefix) then
    insert into public.storage_cleanup (bucket, prefix, company_ref)
    values ('portal', new.prefix, new.company_ref)
    on conflict (bucket, prefix) do nothing;
    begin
      delete from storage.objects where bucket_id = 'portal' and name like new.prefix || '%';
    exception when others then
      raise notice 'portal files for % left in storage: %', new.company_ref, sqlerrm;
    end;
  end if;
  return null;
end;
$$;
do $$
begin
  drop trigger if exists storage_cleanup_portal on public.storage_cleanup;
  create trigger storage_cleanup_portal after insert on public.storage_cleanup
    for each row execute function public.add_portal_cleanup();
exception when undefined_table then
  raise notice 'Run the deletion update first, then this one again, so portal files are cleaned up with closed companies.';
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Rate limits, sessions and the portal account (internal)
-- ---------------------------------------------------------------------
create or replace function public.portal_hits(p_bucket text, p_key text, p_window interval)
returns integer language sql stable security definer set search_path = ''
as $$
  select count(*)::integer from public.portal_rate_hits
   where bucket = p_bucket and key_hash = public.portal_digest(p_key) and created_at > now() - p_window;
$$;

create or replace function public.portal_hit(p_bucket text, p_key text)
returns void language sql volatile security definer set search_path = ''
as $$ insert into public.portal_rate_hits (bucket, key_hash) values (p_bucket, public.portal_digest(p_key)); $$;

-- The client or supplier behind a portal account is still active, and the company has the portal switched on.
create or replace function public.portal_account_ok(u public.portal_users)
returns boolean language sql stable security definer set search_path = ''
as $$
  select u.id is not null and u.status = 'active'
     and public.feature_on(u.company_id, case when u.party = 'client' then 'client_portal' else 'supplier_portal' end)
     and exists (select 1 from public.companies c where c.id = u.company_id and c.closing_after is null)
     and case when u.party = 'client'
              then exists (select 1 from public.clients c where c.id = u.client_id and c.active)
              else exists (select 1 from public.suppliers s where s.id = u.supplier_id and s.active) end;
$$;

-- The email of a live session (and it is kept alive), or null.
create or replace function public.portal_session_email(p_session text)
returns text language plpgsql volatile security definer set search_path = ''
as $$
declare
  s public.portal_sessions;
begin
  if p_session is null or p_session !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into s from public.portal_sessions where token_hash = public.portal_digest(p_session);
  if s.id is null or s.revoked_at is not null or s.expires_at <= now() or s.last_seen_at < now() - interval '12 hours' then
    return null;
  end if;
  if s.last_seen_at < now() - interval '1 minute' then
    update public.portal_sessions set last_seen_at = now() where id = s.id;
  end if;
  return s.email;
end;
$$;

-- The signed-in portal account, or an error. Every portal function starts here.
create or replace function public.portal_account(p_session text, p_account uuid)
returns public.portal_users language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_email text := public.portal_session_email(p_session);
  u       public.portal_users;
begin
  if v_email is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;
  select * into u from public.portal_users where id = p_account and email = v_email;
  if u.id is null or not public.portal_account_ok(u) then
    raise exception 'This portal access is not available.' using errcode = '42501';
  end if;
  return u;
end;
$$;

-- Activity log entry for something a portal person did.
create or replace function public.portal_log(u public.portal_users, p_action text, p_entity text, p_entity_id text, p_details jsonb)
returns void language sql volatile security definer set search_path = ''
as $$
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (u.company_id, null, 'portal_' || p_action, coalesce(p_entity, 'portal_users'), coalesce(p_entity_id, u.id::text),
          coalesce(p_details, '{}'::jsonb) || jsonb_build_object('portal_user_id', u.id, 'portal_email', u.email,
                                                                 'portal_name', u.name, 'party', u.party,
                                                                 'party_id', coalesce(u.client_id, u.supplier_id)));
$$;

-- Tell the right people in our team.
create or replace function public.portal_notify(u public.portal_users, p_roles public.app_role[], p_title text, p_body text,
                                                p_link text, p_key text, p_severity text default 'attention')
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform public.notify_roles(u.company_id, p_roles, null, 'portal', p_severity, p_title, p_body, p_link, p_key);
exception when others then
  raise warning 'Portal notification failed: %', sqlerrm;
end;
$$;

create or replace function public.portal_party_name(u public.portal_users)
returns text language sql stable security definer set search_path = ''
as $$
  select case when u.party = 'client' then (select name from public.clients where id = u.client_id)
              else (select name from public.suppliers where id = u.supplier_id) end;
$$;

-- ---------------------------------------------------------------------
-- 8. Signing in (portal server only: service role)
-- ---------------------------------------------------------------------
-- Step 1: someone typed their email. When it has portal access, a link and a
-- code are made; the server emails them (the token and code are returned once,
-- only their hashes are kept). Returns {status: sent | none | invalid | limited}.
create or replace function public.portal_request_login(p_email text, p_ip text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_email     text := public.portal_email(p_email);
  v_ip        text := coalesce(nullif(left(btrim(coalesce(p_ip, '')), 64), ''), 'unknown');
  v_token     text;
  v_code      text;
  v_companies jsonb;
begin
  -- Housekeeping.
  delete from public.portal_rate_hits where created_at < now() - interval '2 days';
  delete from public.portal_login_codes where expires_at < now() - interval '1 day';
  delete from public.portal_sessions where expires_at < now() - interval '1 day' or last_seen_at < now() - interval '8 days';

  if v_email is null then
    return jsonb_build_object('status', 'invalid');
  end if;
  if public.portal_hits('request_ip', v_ip, interval '15 minutes') >= 20
     or public.portal_hits('request_email', v_email, interval '15 minutes') >= 5
     or public.portal_hits('request_email', v_email, interval '1 day') >= 20 then
    return jsonb_build_object('status', 'limited');
  end if;
  perform public.portal_hit('request_ip', v_ip);
  perform public.portal_hit('request_email', v_email);

  select jsonb_agg(distinct c.name) into v_companies
    from public.portal_users u join public.companies c on c.id = u.company_id
   where u.email = v_email and public.portal_account_ok(u);
  if v_companies is null then
    return jsonb_build_object('status', 'none');
  end if;

  v_token := public.portal_new_token();
  v_code := public.portal_new_code();
  insert into public.portal_login_codes (email, token_hash, code_hash, expires_at)
  values (v_email, public.portal_digest(v_token), public.portal_digest(public.portal_digest(v_token) || ':' || v_code),
          now() + interval '15 minutes');
  return jsonb_build_object('status', 'sent', 'email', v_email, 'token', v_token, 'code', v_code,
                            'expires_minutes', 15, 'companies', v_companies);
end;
$$;

-- Step 2: the link was opened (p_token) or the code typed (p_email + p_code).
-- Returns {status: ok, session, expires_at} or {status: bad | limited | none}.
create or replace function public.portal_verify_login(p_email text, p_code text, p_token text, p_ip text, p_agent text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_ip      text := coalesce(nullif(left(btrim(coalesce(p_ip, '')), 64), ''), 'unknown');
  v_email   text := public.portal_email(p_email);
  v_code    text := regexp_replace(coalesce(p_code, ''), '\s', '', 'g');
  l         public.portal_login_codes;
  v_session text;
  v_exp     timestamptz := now() + interval '7 days';
  u         public.portal_users;
  v_n       integer := 0;
begin
  if public.portal_hits('verify_fail_ip', v_ip, interval '15 minutes') >= 30 then
    return jsonb_build_object('status', 'limited');
  end if;

  if nullif(p_token, '') is not null then
    if p_token ~ '^[0-9a-f]{64}$' then
      select * into l from public.portal_login_codes
       where token_hash = public.portal_digest(p_token) and used_at is null and expires_at > now() and attempts < 5;
    end if;
  else
    if v_email is null or v_code !~ '^[0-9]{6}$' then
      return jsonb_build_object('status', 'bad');
    end if;
    if public.portal_hits('verify_fail_email', v_email, interval '15 minutes') >= 10 then
      return jsonb_build_object('status', 'limited');
    end if;
    select * into l from public.portal_login_codes c
     where c.email = v_email and c.used_at is null and c.expires_at > now() and c.attempts < 5
       and c.code_hash = public.portal_digest(c.token_hash || ':' || v_code)
     order by c.created_at desc limit 1;
    if l.id is null then
      update public.portal_login_codes set attempts = attempts + 1
       where email = v_email and used_at is null and expires_at > now();
      perform public.portal_hit('verify_fail_email', v_email);
    end if;
  end if;

  if l.id is null then
    perform public.portal_hit('verify_fail_ip', v_ip);
    return jsonb_build_object('status', 'bad');
  end if;

  update public.portal_login_codes set used_at = now() where id = l.id;
  v_session := public.portal_new_token();
  for u in select * from public.portal_users where email = l.email and status = 'active' order by created_at loop
    if public.portal_account_ok(u) then
      v_n := v_n + 1;
      update public.portal_users set last_sign_in_at = now() where id = u.id;
      perform public.portal_log(u, 'sign_in', 'portal_users', u.id::text,
                                jsonb_build_object('ip', v_ip, 'method', case when nullif(p_token, '') is not null then 'link' else 'code' end));
    end if;
  end loop;
  if v_n = 0 then
    return jsonb_build_object('status', 'none');
  end if;
  insert into public.portal_sessions (email, token_hash, expires_at, ip, user_agent)
  values (l.email, public.portal_digest(v_session), v_exp, v_ip, nullif(left(coalesce(p_agent, ''), 300), ''));
  return jsonb_build_object('status', 'ok', 'session', v_session, 'expires_at', v_exp, 'accounts', v_n);
end;
$$;

create or replace function public.portal_sign_out(p_session text)
returns void language plpgsql volatile security definer set search_path = ''
as $$
begin
  if p_session ~ '^[0-9a-f]{64}$' then
    update public.portal_sessions set revoked_at = now()
     where token_hash = public.portal_digest(p_session) and revoked_at is null;
  end if;
end;
$$;

-- The accounts this session may open (one email can be a contact of several companies).
create or replace function public.portal_accounts(p_session text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_email text := public.portal_session_email(p_session);
begin
  if v_email is null then
    raise exception 'Please sign in again.' using errcode = '28000';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', u.id, 'party', u.party, 'name', u.name, 'email', u.email,
             'company_id', c.id, 'company', c.name, 'logo_path', c.logo_path,
             'primary_color', c.primary_color, 'accent_color', c.accent_color,
             'party_name', public.portal_party_name(u)) order by c.name, u.party)
      from public.portal_users u join public.companies c on c.id = u.company_id
     where u.email = v_email and public.portal_account_ok(u)), '[]'::jsonb);
end;
$$;

-- The frame of every portal page: our company (branding), who is signed in, and what is waiting.
create or replace function public.portal_me(p_session text, p_account uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u       public.portal_users := public.portal_account(p_session, p_account);
  c       public.companies;
  v_today date := public.portal_today();
  v_counts jsonb;
begin
  select * into c from public.companies where id = u.company_id;
  if u.party = 'client' then
    v_counts := jsonb_build_object(
      'quotations_to_answer', (select count(*) from public.quotations q
                                where q.company_id = u.company_id and q.client_id = u.client_id and q.status = 'sent'
                                  and (q.valid_until is null or q.valid_until >= v_today)),
      'open_orders', (select count(*) from public.quotations q
                       where q.company_id = u.company_id and q.client_id = u.client_id and q.status = 'accepted'
                         and coalesce((public.order_progress_of(q.id, false) ->> 'status'), 'in_progress') = 'in_progress'),
      'unpaid_invoices', (select count(*) from public.invoices i
                           where i.company_id = u.company_id and i.client_id = u.client_id and i.status in ('issued', 'partly_paid')),
      'overdue_invoices', (select count(*) from public.invoices i
                            where i.company_id = u.company_id and i.client_id = u.client_id and i.status in ('issued', 'partly_paid')
                              and i.due_date < v_today),
      'deliveries_on_the_way', (select count(*) from public.deliveries d
                                 where d.company_id = u.company_id and d.client_id = u.client_id and d.status = 'dispatched'),
      'documents', (select count(*) from public.portal_shared_documents s join public.documents d on d.id = s.document_id
                     where s.company_id = u.company_id and s.client_id = u.client_id and d.archived_at is null and d.file_path is not null));
  else
    v_counts := jsonb_build_object(
      'rfqs_to_answer', (select count(*) from public.supplier_rfq_suppliers rs join public.supplier_rfqs r on r.id = rs.srfq_id
                          where rs.company_id = u.company_id and rs.supplier_id = u.supplier_id and r.status = 'open' and rs.status = 'invited'),
      'orders_to_confirm', (select count(*) from public.purchase_orders po
                             where po.company_id = u.company_id and po.supplier_id = u.supplier_id and po.status = 'sent'),
      'open_orders', (select count(*) from public.purchase_orders po
                       where po.company_id = u.company_id and po.supplier_id = u.supplier_id and po.status in ('confirmed', 'partially_received')),
      'submissions_waiting', (select count(*) from public.portal_submissions s
                               where s.company_id = u.company_id and s.supplier_id = u.supplier_id and s.status = 'submitted'),
      'bank_change_pending', exists (select 1 from public.supplier_bank_details b where b.supplier_id = u.supplier_id and b.status = 'pending'),
      'documents', (select count(*) from public.portal_shared_documents s join public.documents d on d.id = s.document_id
                     where s.company_id = u.company_id and s.supplier_id = u.supplier_id and d.archived_at is null and d.file_path is not null));
  end if;
  return jsonb_build_object(
    'account', jsonb_build_object('id', u.id, 'party', u.party, 'name', u.name, 'email', u.email, 'position', u.position,
                                  'party_id', coalesce(u.client_id, u.supplier_id), 'party_name', public.portal_party_name(u)),
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'legal_name', c.legal_name, 'logo_path', c.logo_path,
                                  'primary_color', c.primary_color, 'accent_color', c.accent_color, 'phone', c.phone,
                                  'email', c.email, 'address', c.address, 'website', c.website, 'base_currency', c.base_currency),
    'counts', v_counts);
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Client portal
-- ---------------------------------------------------------------------
create or replace function public.portal_quote_no(q public.quotations)
returns text language sql immutable set search_path = ''
as $$ select case when q.revision > 0 then q.number || '-R' || q.revision else q.number end; $$;

-- An order's progress for the client: the stages and the count only. The names of our team members
-- who own a stage (owner, owner_id, assigned, can_assign) stay inside the app.
create or replace function public.portal_stage(p jsonb)
returns jsonb language sql immutable set search_path = ''
as $$ select case when p is null or jsonb_typeof(p) <> 'object' then null
                  else jsonb_build_object('key', p ->> 'key', 'label', p ->> 'label', 'done', coalesce((p ->> 'done')::boolean, false)) end; $$;

create or replace function public.portal_progress(p_quote uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when x.p is null then null else
    jsonb_build_object('status', x.p ->> 'status', 'done', x.p -> 'done', 'total', x.p -> 'total', 'percent', x.p -> 'percent',
                       'current', public.portal_stage(x.p -> 'current'), 'next', public.portal_stage(x.p -> 'next'),
                       'stages', coalesce((select jsonb_agg(public.portal_stage(st) order by n)
                                             from jsonb_array_elements(x.p -> 'stages') with ordinality as e(st, n)), '[]'::jsonb))
  end
  from (select public.order_progress_of(p_quote, false) as p) x;
$$;

create or replace function public.portal_quotations(p_session text, p_account uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u       public.portal_users := public.portal_account(p_session, p_account);
  v_today date := public.portal_today();
begin
  if u.party <> 'client' then raise exception 'Not available for suppliers.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.d desc, x.c desc) from (
      select q.issue_date as d, q.created_at as c,
             jsonb_build_object('id', q.id, 'number', public.portal_quote_no(q), 'status', q.status, 'issue_date', q.issue_date,
                                'valid_until', q.valid_until, 'currency', q.currency, 'total', q.total, 'client_ref', q.client_ref,
                                'expired', q.status = 'sent' and q.valid_until < v_today,
                                'decided_at', q.decided_at) as j
        from public.quotations q
       where q.company_id = u.company_id and q.client_id = u.client_id and q.status in ('sent', 'accepted', 'rejected')
       order by q.issue_date desc, q.created_at desc limit 200) x), '[]'::jsonb);
end;
$$;

create or replace function public.portal_quotation(p_session text, p_account uuid, p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u       public.portal_users := public.portal_account(p_session, p_account);
  q       public.quotations;
  v_today date := public.portal_today();
begin
  select * into q from public.quotations
   where id = p_id and company_id = u.company_id and client_id = u.client_id and status in ('sent', 'accepted', 'rejected')
     and u.party = 'client';
  if q.id is null then raise exception 'Quotation not found.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', q.id, 'number', public.portal_quote_no(q), 'status', q.status, 'issue_date', q.issue_date, 'valid_until', q.valid_until,
    'currency', q.currency, 'client_ref', q.client_ref, 'contact_name', q.contact_name, 'delivery_time', q.delivery_time,
    'payment_terms', q.payment_terms, 'incoterms', q.incoterms, 'vat_rate', q.vat_rate, 'subtotal', q.subtotal,
    'discount_total', q.discount_total, 'vat_amount', q.vat_amount, 'total', q.total, 'notes', q.notes, 'terms', q.terms,
    'expired', q.status = 'sent' and q.valid_until < v_today,
    'can_decide', q.status = 'sent' and (q.valid_until is null or q.valid_until >= v_today),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'description', l.description, 'quantity', l.quantity,
                                                          'unit', l.unit, 'unit_price', l.unit_price, 'discount_pct', l.discount_pct,
                                                          'line_total', l.line_total) order by l.line_no, l.id)
                         from public.quotation_lines l where l.quotation_id = q.id), '[]'::jsonb),
    'decision', (select jsonb_build_object('decision', d.decision, 'signer_name', d.signer_name, 'signer_position', d.signer_position,
                                           'signature_kind', d.signature_kind, 'signature_text', d.signature_text,
                                           'signature_image', d.signature_image, 'reason', d.reason, 'client_po_ref', d.client_po_ref,
                                           'created_at', d.created_at)
                   from public.portal_quote_decisions d where d.quotation_id = q.id order by d.created_at desc limit 1));
end;
$$;

-- Accept or decline online. p: {decision: accept | decline, name, position, signature_kind: typed | drawn,
-- signature_text, signature_image (data:image/png;base64,...), reason, po_ref, ip, agent}.
-- The quotation moves to accepted or rejected through the same status code the app uses.
create or replace function public.portal_decide_quotation(p_session text, p_account uuid, p_id uuid, p jsonb)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare
  u        public.portal_users := public.portal_account(p_session, p_account);
  q        public.quotations;
  v_accept boolean;
  v_name   text := nullif(btrim(coalesce(p ->> 'name', '')), '');
  v_pos    text := nullif(btrim(coalesce(p ->> 'position', '')), '');
  v_kind   text := nullif(p ->> 'signature_kind', '');
  v_text   text := nullif(btrim(coalesce(p ->> 'signature_text', '')), '');
  v_image  text := nullif(p ->> 'signature_image', '');
  v_reason text := nullif(btrim(coalesce(p ->> 'reason', '')), '');
  v_po     text := nullif(btrim(coalesce(p ->> 'po_ref', '')), '');
  v_id     uuid;
  v_no     text;
  v_party  text;
begin
  if u.party <> 'client' then raise exception 'Not available for suppliers.' using errcode = '42501'; end if;
  select * into q from public.quotations
   where id = p_id and company_id = u.company_id and client_id = u.client_id for update;
  if q.id is null or q.status not in ('sent', 'accepted', 'rejected') then
    raise exception 'Quotation not found.' using errcode = '42501';
  end if;
  if q.status <> 'sent' then
    raise exception 'This quotation was already answered. Please contact us to change it.' using errcode = '22023';
  end if;
  if p ->> 'decision' not in ('accept', 'decline') or p ->> 'decision' is null then
    raise exception 'Choose accept or decline.' using errcode = '22023';
  end if;
  v_accept := p ->> 'decision' = 'accept';
  if v_name is null or char_length(v_name) not between 2 and 120 then
    raise exception 'Enter your full name.' using errcode = '22023';
  end if;
  if v_pos is not null and char_length(v_pos) > 120 then
    raise exception 'The position is too long.' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 1000 then
    raise exception 'The comment is too long.' using errcode = '22023';
  end if;
  if v_po is not null and char_length(v_po) > 120 then
    raise exception 'The order reference is too long.' using errcode = '22023';
  end if;
  if v_accept then
    if q.valid_until is not null and q.valid_until < public.portal_today() then
      raise exception 'This quotation has expired. Ask us for an updated one.' using errcode = '22023';
    end if;
    if v_pos is null then
      raise exception 'Enter your position.' using errcode = '22023';
    end if;
    if v_kind = 'typed' then
      if v_text is null or char_length(v_text) not between 2 and 120 then
        raise exception 'Type your name as your signature.' using errcode = '22023';
      end if;
      v_image := null;
    elsif v_kind = 'drawn' then
      if v_image is null or v_image !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' or char_length(v_image) > 300000 then
        raise exception 'Draw your signature in the box.' using errcode = '22023';
      end if;
      v_text := null;
    else
      raise exception 'Sign by typing your name or drawing your signature.' using errcode = '22023';
    end if;
  else
    v_kind := null;
    v_text := null;
    v_image := null;
  end if;

  insert into public.portal_quote_decisions (company_id, quotation_id, portal_user_id, decision, signer_name, signer_position,
                                             signature_kind, signature_text, signature_image, reason, client_po_ref,
                                             signed_ip, user_agent)
  values (u.company_id, q.id, u.id, case when v_accept then 'accepted' else 'declined' end, v_name, v_pos,
          v_kind, v_text, v_image, v_reason, v_po,
          nullif(left(coalesce(p ->> 'ip', ''), 64), ''), nullif(left(coalesce(p ->> 'agent', ''), 300), ''))
  returning id into v_id;

  perform public.apply_quotation_outcome(q.id, v_accept,
    case when v_accept
         then left('Accepted online by ' || v_name || coalesce(' (' || v_pos || ')', '') || coalesce('. Order ref: ' || v_po, '')
                   || coalesce('. ' || v_reason, ''), 1000)
         else left('Declined online by ' || v_name || coalesce(': ' || v_reason, ''), 1000) end);
  if v_accept and v_po is not null and q.client_ref is null then
    perform set_config('ims.status_change', 'on', true);
    update public.quotations set client_ref = v_po where id = q.id;
    perform set_config('ims.status_change', 'off', true);
  end if;

  v_no := public.portal_quote_no(q);
  v_party := public.portal_party_name(u);
  perform public.portal_notify(u, array['management', 'sales']::public.app_role[],
    case when v_accept then 'Quotation ' || v_no || ' accepted online' else 'Quotation ' || v_no || ' declined online' end,
    v_party || ': ' || v_name || coalesce(' (' || v_pos || ')', '') || coalesce(' — ' || v_reason, ''),
    '/quotations/' || q.id::text, 'portal-quote:' || v_id::text);
  perform public.portal_log(u, case when v_accept then 'quotation_accepted' else 'quotation_declined' end, 'quotations', q.id::text,
                            jsonb_build_object('number', v_no, 'signer', v_name, 'position', v_pos, 'signature', v_kind,
                                               'ip', nullif(left(coalesce(p ->> 'ip', ''), 64), '')));
  return v_id;
end;
$$;

create or replace function public.portal_orders(p_session text, p_account uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u public.portal_users := public.portal_account(p_session, p_account);
begin
  if u.party <> 'client' then raise exception 'Not available for suppliers.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(x.j order by x.d desc nulls last) from (
        select coalesce(q.decided_at, q.created_at) as d,
               jsonb_build_object('id', q.id, 'number', public.portal_quote_no(q), 'client_ref', q.client_ref, 'issue_date', q.issue_date,
                                  'decided_at', q.decided_at, 'currency', q.currency, 'total', q.total,
                                  'progress', public.portal_progress(q.id)) as j
          from public.quotations q
         where q.company_id = u.company_id and q.client_id = u.client_id and q.status = 'accepted'
         order by coalesce(q.decided_at, q.created_at) desc limit 100) x), '[]'::jsonb),
    'deliveries', coalesce((
      select jsonb_agg(x.j order by x.d desc) from (
        select d.created_at as d,
               jsonb_build_object('id', d.id, 'number', d.number, 'status', d.status, 'planned_date', d.planned_date,
                                  'dispatched_at', d.dispatched_at, 'delivered_at', d.delivered_at, 'delivery_site', d.delivery_site,
                                  'received_by_name', d.received_by_name, 'quotation_id', d.quotation_id) as j
          from public.deliveries d
         where d.company_id = u.company_id and d.client_id = u.client_id and d.status in ('dispatched', 'delivered', 'failed')
         order by d.created_at desc limit 100) x), '[]'::jsonb));
end;
$$;

create or replace function public.portal_order(p_session text, p_account uuid, p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u public.portal_users := public.portal_account(p_session, p_account);
  q public.quotations;
begin
  select * into q from public.quotations
   where id = p_id and company_id = u.company_id and client_id = u.client_id and status = 'accepted' and u.party = 'client';
  if q.id is null then raise exception 'Order not found.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', q.id, 'number', public.portal_quote_no(q), 'client_ref', q.client_ref, 'issue_date', q.issue_date, 'decided_at', q.decided_at,
    'currency', q.currency, 'total', q.total, 'delivery_time', q.delivery_time,
    'progress', public.portal_progress(q.id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'description', l.description, 'quantity', l.quantity,
                                                          'unit', l.unit) order by l.line_no, l.id)
                         from public.quotation_lines l where l.quotation_id = q.id), '[]'::jsonb),
    'deliveries', coalesce((select jsonb_agg(jsonb_build_object(
                                  'id', d.id, 'number', d.number, 'status', d.status, 'planned_date', d.planned_date,
                                  'dispatched_at', d.dispatched_at, 'delivered_at', d.delivered_at, 'delivery_site', d.delivery_site,
                                  'vehicle', case when d.status = 'dispatched' then d.vehicle end,
                                  'received_by_name', d.received_by_name, 'pod_notes', d.pod_notes,
                                  'failed_reason', case when d.status = 'failed' then d.failed_reason end,
                                  'has_signature', d.status = 'delivered' and d.signature_path is not null,
                                  'has_photo', d.status = 'delivered' and d.photo_path is not null,
                                  'lines', (select coalesce(jsonb_agg(jsonb_build_object('description', dl.description, 'quantity', dl.quantity, 'unit', dl.unit)
                                                                      order by dl.line_no, dl.id), '[]'::jsonb)
                                              from public.delivery_lines dl where dl.delivery_id = d.id))
                                  order by d.created_at)
                              from public.deliveries d
                             where d.quotation_id = q.id and d.company_id = u.company_id and d.client_id = u.client_id
                               and d.status not in ('draft', 'cancelled')), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'status', i.status, 'issue_date', i.issue_date,
                                                             'due_date', i.due_date, 'currency', i.currency, 'total', i.total,
                                                             'amount_paid', i.amount_paid) order by i.issue_date, i.created_at)
                            from public.invoices i
                           where i.quotation_id = q.id and i.company_id = u.company_id and i.client_id = u.client_id
                             and i.status in ('issued', 'partly_paid', 'paid')), '[]'::jsonb));
end;
$$;

create or replace function public.portal_invoices(p_session text, p_account uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u       public.portal_users := public.portal_account(p_session, p_account);
  v_today date := public.portal_today();
begin
  if u.party <> 'client' then raise exception 'Not available for suppliers.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'invoices', coalesce((
      select jsonb_agg(x.j order by x.d desc nulls last, x.c desc) from (
        select i.issue_date as d, i.created_at as c,
               jsonb_build_object('id', i.id, 'number', i.number, 'status', i.status, 'issue_date', i.issue_date, 'due_date', i.due_date,
                                  'currency', i.currency, 'total', i.total, 'amount_paid', i.amount_paid,
                                  'balance', greatest(i.total - i.amount_paid, 0), 'client_ref', i.client_ref,
                                  'days_overdue', case when i.status in ('issued', 'partly_paid') and i.due_date < v_today
                                                       then v_today - i.due_date else 0 end,
                                  'quotation_number', (select public.portal_quote_no(q) from public.quotations q where q.id = i.quotation_id)) as j
          from public.invoices i
         where i.company_id = u.company_id and i.client_id = u.client_id and i.status in ('issued', 'partly_paid', 'paid')
         order by i.issue_date desc nulls last, i.created_at desc limit 300) x), '[]'::jsonb),
    'owed', coalesce((
      select jsonb_agg(jsonb_build_object('currency', t.currency, 'balance', t.balance, 'overdue', t.overdue) order by t.currency)
        from (select i.currency, sum(greatest(i.total - i.amount_paid, 0)) as balance,
                     sum(case when i.due_date < v_today then greatest(i.total - i.amount_paid, 0) else 0 end) as overdue
                from public.invoices i
               where i.company_id = u.company_id and i.client_id = u.client_id and i.status in ('issued', 'partly_paid')
               group by i.currency) t), '[]'::jsonb));
end;
$$;

create or replace function public.portal_documents(p_session text, p_account uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u public.portal_users := public.portal_account(p_session, p_account);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'kind', d.kind, 'reference', d.reference,
                                        'issued_on', d.issued_on, 'expires_on', d.expires_on, 'file_name', d.file_name,
                                        'file_type', d.file_type, 'file_size', d.file_size, 'shared_at', s.created_at)
                     order by d.kind, d.title)
      from public.portal_shared_documents s
      join public.documents d on d.id = s.document_id and d.company_id = s.company_id
     where s.company_id = u.company_id
       and (s.client_id = u.client_id or s.supplier_id = u.supplier_id)
       and d.archived_at is null and d.file_path is not null), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Downloads: may this account open this record or file? Returns what the
--     server needs to build the PDF or fetch the file, and logs the download.
--     p_kind: quotation | invoice | delivery | statement | po | document |
--             pod_signature | pod_photo | file
-- ---------------------------------------------------------------------
create or replace function public.portal_open(p_session text, p_account uuid, p_kind text, p_id uuid, p_ip text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u      public.portal_users := public.portal_account(p_session, p_account);
  v_out  jsonb;
  v_name text;
begin
  if p_kind = 'quotation' and u.party = 'client' then
    select jsonb_build_object('id', q.id, 'name', public.portal_quote_no(q)) into v_out from public.quotations q
     where q.id = p_id and q.company_id = u.company_id and q.client_id = u.client_id and q.status in ('sent', 'accepted', 'rejected');
  elsif p_kind = 'invoice' and u.party = 'client' then
    select jsonb_build_object('id', i.id, 'name', i.number) into v_out from public.invoices i
     where i.id = p_id and i.company_id = u.company_id and i.client_id = u.client_id and i.status in ('issued', 'partly_paid', 'paid');
  elsif p_kind = 'delivery' and u.party = 'client' then
    select jsonb_build_object('id', d.id, 'name', d.number) into v_out from public.deliveries d
     where d.id = p_id and d.company_id = u.company_id and d.client_id = u.client_id and d.status in ('dispatched', 'delivered', 'failed');
  elsif p_kind in ('pod_signature', 'pod_photo') and u.party = 'client' then
    select jsonb_build_object('id', d.id, 'name', d.number, 'bucket', 'pod',
                              'path', case when p_kind = 'pod_signature' then d.signature_path else d.photo_path end)
      into v_out from public.deliveries d
     where d.id = p_id and d.company_id = u.company_id and d.client_id = u.client_id and d.status = 'delivered'
       and (case when p_kind = 'pod_signature' then d.signature_path else d.photo_path end) is not null;
  elsif p_kind = 'statement' and p_id = coalesce(u.client_id, u.supplier_id) then
    v_out := jsonb_build_object('id', p_id, 'name', 'statement');
  elsif p_kind = 'po' and u.party = 'supplier' then
    select jsonb_build_object('id', po.id, 'name', po.number) into v_out from public.purchase_orders po
     where po.id = p_id and po.company_id = u.company_id and po.supplier_id = u.supplier_id
       and po.status in ('sent', 'confirmed', 'partially_received', 'received', 'closed');
  elsif p_kind = 'document' then
    select jsonb_build_object('id', d.id, 'name', d.title, 'bucket', 'documents', 'path', d.file_path, 'file_name', d.file_name)
      into v_out
      from public.portal_shared_documents s join public.documents d on d.id = s.document_id and d.company_id = s.company_id
     where d.id = p_id and s.company_id = u.company_id and (s.client_id = u.client_id or s.supplier_id = u.supplier_id)
       and d.archived_at is null and d.file_path is not null
     limit 1;
  elsif p_kind = 'file' then
    select jsonb_build_object('id', f.id, 'name', f.file_name, 'bucket', 'portal', 'path', f.storage_path, 'file_name', f.file_name)
      into v_out from public.portal_files f
     where f.id = p_id and f.company_id = u.company_id and (f.client_id = u.client_id or f.supplier_id = u.supplier_id)
       and f.stored_at is not null;
  end if;
  if v_out is null then
    raise exception 'Not found.' using errcode = '42501';
  end if;
  v_name := v_out ->> 'name';
  perform public.portal_log(u, 'download', p_kind, p_id::text, jsonb_build_object('name', v_name, 'ip', nullif(left(coalesce(p_ip, ''), 64), '')));
  return v_out || jsonb_build_object('company_id', u.company_id, 'party', u.party, 'party_id', coalesce(u.client_id, u.supplier_id));
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Messages: one Inbox conversation per portal person (channel 'portal')
-- ---------------------------------------------------------------------
create or replace function public.portal_send_message(p_session text, p_account uuid, p_text text, p_subject text)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare
  u         public.portal_users := public.portal_account(p_session, p_account);
  v_text    text := btrim(coalesce(p_text, ''));
  v_subject text := nullif(left(btrim(coalesce(p_subject, '')), 300), '');
  v_conv    uuid;
  v_msg     uuid;
  v_party   text := public.portal_party_name(u);
  v_assign  uuid;
begin
  if v_text = '' then raise exception 'Write a message first.' using errcode = '22023'; end if;
  if char_length(v_text) > 5000 then raise exception 'The message is too long (5000 characters at most).' using errcode = '22023'; end if;
  if public.portal_hits('message', u.id::text, interval '1 hour') >= 30 then
    raise exception 'Too many messages in a short time. Please wait a little.' using errcode = '22023';
  end if;
  perform public.portal_hit('message', u.id::text);

  select t.conversation_id into v_conv from public.portal_threads t
    join public.inbox_conversations c on c.id = t.conversation_id
   where t.portal_user_id = u.id;
  if v_conv is null then
    delete from public.portal_threads where portal_user_id = u.id;
    insert into public.inbox_conversations (company_id, channel, subject, counterpart_address, counterpart_name, client_id, supplier_id)
    values (u.company_id, 'portal', coalesce(v_subject, 'Portal messages'), u.email,
            left(u.name || ' · ' || coalesce(v_party, ''), 200), u.client_id, u.supplier_id)
    returning id into v_conv;
    insert into public.portal_threads (portal_user_id, company_id, conversation_id) values (u.id, u.company_id, v_conv);
  end if;

  insert into public.inbox_messages (company_id, conversation_id, channel, direction, status, from_address, from_name,
                                     to_addresses, subject, body_text, provider)
  values (u.company_id, v_conv, 'portal', 'in', 'received', u.email, u.name, '{}', v_subject, v_text, 'portal')
  returning id into v_msg;
  update public.inbox_conversations
     set unread_count = unread_count + 1, message_count = message_count + 1, last_message_at = now(), last_direction = 'in',
         preview = left(btrim(regexp_replace(v_text, '\s+', ' ', 'g')), 200), status = 'open', closed_at = null, closed_by = null
   where id = v_conv
  returning assigned_to into v_assign;

  perform public.portal_notify(u,
    case when u.party = 'client' then array['management', 'sales']::public.app_role[]
         else array['management', 'procurement']::public.app_role[] end,
    'Portal message from ' || u.name || coalesce(' (' || v_party || ')', ''),
    coalesce(v_subject, left(v_text, 140)), '/inbox/' || v_conv::text, 'inbox:' || v_msg::text);
  if v_assign is not null then
    begin
      perform public.notify(u.company_id, v_assign, 'inbox_message', 'attention', 'Reply from ' || u.name,
                            coalesce(v_subject, left(v_text, 140)), '/inbox/' || v_conv::text, 'inbox:' || v_msg::text);
    exception when others then
      raise warning 'Inbox notification failed: %', sqlerrm;
    end;
  end if;
  perform public.portal_log(u, 'message', 'inbox_conversations', v_conv::text, jsonb_build_object('subject', v_subject));
  return v_msg;
end;
$$;

create or replace function public.portal_messages(p_session text, p_account uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u      public.portal_users := public.portal_account(p_session, p_account);
  v_conv uuid;
begin
  select conversation_id into v_conv from public.portal_threads where portal_user_id = u.id and company_id = u.company_id;
  if v_conv is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.c) from (
      select m.created_at as c,
             jsonb_build_object('id', m.id, 'direction', m.direction, 'from_name', case when m.direction = 'in' then m.from_name end,
                                'subject', m.subject, 'text', m.body_text, 'created_at', m.created_at) as j
        from public.inbox_messages m
       where m.conversation_id = v_conv and m.company_id = u.company_id and m.status <> 'failed'
       order by m.created_at desc limit 200) x), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 12. Supplier portal
-- ---------------------------------------------------------------------
create or replace function public.portal_rfqs(p_session text, p_account uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u public.portal_users := public.portal_account(p_session, p_account);
begin
  if u.party <> 'supplier' then raise exception 'Not available for clients.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.o, x.c desc) from (
      select case when r.status = 'open' then 0 else 1 end as o, r.created_at as c,
             jsonb_build_object('id', rs.id, 'number', r.number, 'title', r.title, 'due_on', r.due_on,
                                'delivery_location', r.delivery_location, 'rfq_status', r.status, 'status', rs.status,
                                'received_on', rs.received_on, 'valid_until', rs.valid_until, 'currency', rs.currency,
                                'awarded_to_you', r.status = 'awarded' and r.awarded_supplier_id = u.supplier_id,
                                'lines', (select count(*) from public.supplier_rfq_lines l where l.srfq_id = r.id)) as j
        from public.supplier_rfq_suppliers rs join public.supplier_rfqs r on r.id = rs.srfq_id and r.company_id = rs.company_id
       where rs.company_id = u.company_id and rs.supplier_id = u.supplier_id
       order by case when r.status = 'open' then 0 else 1 end, r.created_at desc limit 200) x), '[]'::jsonb);
end;
$$;

create or replace function public.portal_rfq(p_session text, p_account uuid, p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u  public.portal_users := public.portal_account(p_session, p_account);
  rs public.supplier_rfq_suppliers;
  r  public.supplier_rfqs;
begin
  select * into rs from public.supplier_rfq_suppliers
   where id = p_id and company_id = u.company_id and supplier_id = u.supplier_id and u.party = 'supplier';
  if rs.id is null then raise exception 'Request not found.' using errcode = '42501'; end if;
  select * into r from public.supplier_rfqs where id = rs.srfq_id;
  return jsonb_build_object(
    'id', rs.id, 'number', r.number, 'title', r.title, 'due_on', r.due_on, 'delivery_location', r.delivery_location,
    'notes', r.notes, 'rfq_status', r.status, 'status', rs.status, 'can_answer', r.status = 'open',
    'awarded_to_you', r.status = 'awarded' and r.awarded_supplier_id = u.supplier_id,
    'currency', rs.currency, 'lead_time_days', rs.lead_time_days, 'payment_terms', rs.payment_terms, 'incoterms', rs.incoterms,
    'freight', rs.freight, 'valid_until', rs.valid_until, 'supplier_ref', rs.supplier_ref, 'answer_notes', rs.notes,
    'received_on', rs.received_on,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'line_no', l.line_no, 'description', l.description,
                                                          'quantity', l.quantity, 'unit', l.unit,
                                                          'unit_price', ql.unit_price, 'notes', ql.notes) order by l.line_no, l.id)
                         from public.supplier_rfq_lines l
                         left join public.supplier_quote_lines ql on ql.srfq_line_id = l.id and ql.srfq_supplier_id = rs.id
                        where l.srfq_id = r.id), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'created_at', f.created_at) order by f.created_at)
                         from public.portal_files f where f.srfq_supplier_id = rs.id and f.stored_at is not null), '[]'::jsonb));
end;
$$;

-- Answer a supplier RFQ. p: {decline: bool, currency, lead_time_days, valid_until, payment_terms, incoterms,
-- freight, supplier_ref, notes, lines: [{line_id, unit_price, notes}]}. Lands in supplier_rfq_suppliers and
-- supplier_quote_lines, exactly where procurement types quotes in by hand, so the comparison shows it.
create or replace function public.portal_answer_rfq(p_session text, p_account uuid, p_id uuid, p jsonb)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  u         public.portal_users := public.portal_account(p_session, p_account);
  rs        public.supplier_rfq_suppliers;
  r         public.supplier_rfqs;
  c         public.companies;
  v_cur     text := upper(coalesce(nullif(btrim(p ->> 'currency'), ''), ''));
  v_rate    numeric;
  v_lead    integer;
  v_valid   date;
  v_freight numeric := 0;
  v_terms   text := nullif(left(btrim(coalesce(p ->> 'payment_terms', '')), 200), '');
  v_inco    text := nullif(left(btrim(coalesce(p ->> 'incoterms', '')), 40), '');
  v_ref     text := nullif(left(btrim(coalesce(p ->> 'supplier_ref', '')), 120), '');
  v_notes   text := nullif(btrim(coalesce(p ->> 'notes', '')), '');
  e         jsonb;
  v_price   numeric;
  v_priced  integer := 0;
  v_party   text := public.portal_party_name(u);
begin
  select * into rs from public.supplier_rfq_suppliers
   where id = p_id and company_id = u.company_id and supplier_id = u.supplier_id and u.party = 'supplier' for update;
  if rs.id is null then raise exception 'Request not found.' using errcode = '42501'; end if;
  select * into r from public.supplier_rfqs where id = rs.srfq_id;
  if r.status <> 'open' then
    raise exception 'This request is closed. Please contact us.' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'The notes are too long.' using errcode = '22023';
  end if;

  if coalesce((p ->> 'decline')::boolean, false) then
    update public.supplier_rfq_suppliers
       set status = 'declined', notes = coalesce(v_notes, notes), received_on = public.portal_today()
     where id = rs.id;
    perform public.portal_notify(u, array['management', 'procurement']::public.app_role[],
      coalesce(v_party, 'A supplier') || ' cannot quote ' || r.number, coalesce(v_notes, 'Declined through the supplier portal.'),
      '/supplier-rfqs/' || r.id::text, 'portal-srfq:' || rs.id::text || ':declined');
    perform public.portal_log(u, 'rfq_declined', 'supplier_rfqs', r.id::text, jsonb_build_object('number', r.number));
    return;
  end if;

  if v_cur = '' then v_cur := rs.currency; end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'Choose a currency such as TZS or USD.' using errcode = '22023'; end if;
  if nullif(p ->> 'lead_time_days', '') is not null then
    if (p ->> 'lead_time_days') !~ '^\d{1,3}$' or (p ->> 'lead_time_days')::integer > 730 then
      raise exception 'Lead time is in days (0 to 730).' using errcode = '22023';
    end if;
    v_lead := (p ->> 'lead_time_days')::integer;
  end if;
  if nullif(p ->> 'valid_until', '') is not null then
    begin
      v_valid := (p ->> 'valid_until')::date;
    exception when others then
      raise exception 'Enter the date your prices are valid until.' using errcode = '22023';
    end;
    if v_valid < public.portal_today() then
      raise exception 'The validity date is in the past.' using errcode = '22023';
    end if;
  end if;
  if nullif(p ->> 'freight', '') is not null then
    if (p ->> 'freight') !~ '^\d{1,15}(\.\d{1,2})?$' then raise exception 'Enter freight as a number.' using errcode = '22023'; end if;
    v_freight := (p ->> 'freight')::numeric;
  end if;

  for e in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) limit 500 loop
    if not exists (select 1 from public.supplier_rfq_lines l where l.id = (e ->> 'line_id')::uuid and l.srfq_id = r.id) then
      raise exception 'A line does not belong to this request.' using errcode = '42501';
    end if;
    v_price := null;
    if nullif(btrim(coalesce(e ->> 'unit_price', '')), '') is not null then
      if btrim(e ->> 'unit_price') !~ '^\d{1,15}(\.\d{1,2})?$' then
        raise exception 'Enter prices as numbers (for example 12500 or 12.50).' using errcode = '22023';
      end if;
      v_price := btrim(e ->> 'unit_price')::numeric;
      v_priced := v_priced + 1;
    end if;
    if char_length(coalesce(e ->> 'notes', '')) > 500 then
      raise exception 'A line note is too long.' using errcode = '22023';
    end if;
    insert into public.supplier_quote_lines (company_id, srfq_supplier_id, srfq_line_id, unit_price, notes)
    values (u.company_id, rs.id, (e ->> 'line_id')::uuid, v_price, nullif(btrim(coalesce(e ->> 'notes', '')), ''))
    on conflict (srfq_supplier_id, srfq_line_id) do update set unit_price = excluded.unit_price, notes = excluded.notes;
  end loop;
  if v_priced = 0 then
    raise exception 'Enter a price for at least one line, or choose that you cannot quote.' using errcode = '22023';
  end if;

  select * into c from public.companies where id = u.company_id;
  v_rate := case when v_cur = rs.currency then rs.exchange_rate
                 when v_cur = c.base_currency then 1
                 else coalesce((select x.rate from public.exchange_rates x where x.company_id = u.company_id and x.currency = v_cur), 1) end;
  update public.supplier_rfq_suppliers
     set status = 'quoted', currency = v_cur, exchange_rate = v_rate, lead_time_days = v_lead, payment_terms = v_terms,
         incoterms = v_inco, freight = v_freight, valid_until = v_valid, supplier_ref = v_ref, notes = v_notes,
         received_on = public.portal_today()
   where id = rs.id;
  perform public.portal_notify(u, array['management', 'procurement']::public.app_role[],
    coalesce(v_party, 'A supplier') || ' quoted ' || r.number || ' online',
    v_priced || ' line(s) priced in ' || v_cur || coalesce(', lead time ' || v_lead || ' days', '') || '. Compare the offers.',
    '/supplier-rfqs/' || r.id::text, 'portal-srfq:' || rs.id::text || ':' || extract(epoch from now())::bigint);
  perform public.portal_log(u, 'rfq_quoted', 'supplier_rfqs', r.id::text,
                            jsonb_build_object('number', r.number, 'currency', v_cur, 'lines_priced', v_priced));
end;
$$;

create or replace function public.portal_purchase_orders(p_session text, p_account uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u public.portal_users := public.portal_account(p_session, p_account);
begin
  if u.party <> 'supplier' then raise exception 'Not available for clients.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.o, x.d desc) from (
      select case when po.status = 'sent' then 0 else 1 end as o, po.order_date as d,
             jsonb_build_object('id', po.id, 'number', po.number, 'status', po.status, 'order_date', po.order_date,
                                'expected_date', po.expected_date, 'currency', po.currency, 'total', po.total,
                                'supplier_ref', po.supplier_ref, 'confirmed_at', po.confirmed_at) as j
        from public.purchase_orders po
       where po.company_id = u.company_id and po.supplier_id = u.supplier_id
         and po.status in ('sent', 'confirmed', 'partially_received', 'received', 'closed')
       order by case when po.status = 'sent' then 0 else 1 end, po.order_date desc limit 200) x), '[]'::jsonb);
end;
$$;

create or replace function public.portal_purchase_order(p_session text, p_account uuid, p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u  public.portal_users := public.portal_account(p_session, p_account);
  po public.purchase_orders;
begin
  select * into po from public.purchase_orders
   where id = p_id and company_id = u.company_id and supplier_id = u.supplier_id and u.party = 'supplier'
     and status in ('sent', 'confirmed', 'partially_received', 'received', 'closed');
  if po.id is null then raise exception 'Purchase order not found.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'id', po.id, 'number', po.number, 'status', po.status, 'order_date', po.order_date, 'expected_date', po.expected_date,
    'currency', po.currency, 'delivery_location', po.delivery_location, 'payment_terms', po.payment_terms, 'incoterms', po.incoterms,
    'supplier_ref', po.supplier_ref, 'shipping_instructions', po.shipping_instructions, 'terms', po.terms,
    'freight', po.freight, 'vat_rate', po.vat_rate, 'subtotal', po.subtotal, 'vat_amount', po.vat_amount, 'total', po.total,
    'confirmed_at', po.confirmed_at, 'can_confirm', po.status = 'sent',
    'lines', coalesce((select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'description', l.description, 'quantity', l.quantity,
                                                          'unit', l.unit, 'unit_price', l.unit_price, 'line_total', l.line_total,
                                                          'received_qty', l.received_qty) order by l.line_no, l.id)
                         from public.po_lines l where l.po_id = po.id), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'status', s.status,
                                                                'supplier_invoice_no', s.supplier_invoice_no, 'total', s.total,
                                                                'currency', s.currency, 'created_at', s.created_at) order by s.created_at)
                               from public.portal_submissions s where s.po_id = po.id and s.supplier_id = u.supplier_id), '[]'::jsonb));
end;
$$;

-- The supplier confirms our purchase order (same status code as the app's Confirm button).
create or replace function public.portal_confirm_po(p_session text, p_account uuid, p_id uuid, p_supplier_ref text, p_expected date)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  u  public.portal_users := public.portal_account(p_session, p_account);
  po public.purchase_orders;
begin
  select * into po from public.purchase_orders
   where id = p_id and company_id = u.company_id and supplier_id = u.supplier_id and u.party = 'supplier' for update;
  if po.id is null or po.status not in ('sent', 'confirmed', 'partially_received', 'received', 'closed') then
    raise exception 'Purchase order not found.' using errcode = '42501';
  end if;
  if po.status <> 'sent' then
    raise exception 'This purchase order is already confirmed.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_supplier_ref, '')) > 120 then
    raise exception 'Your reference is too long.' using errcode = '22023';
  end if;
  if p_expected is not null and p_expected < po.order_date then
    raise exception 'The delivery date is before the order date.' using errcode = '22023';
  end if;
  perform public.apply_po_confirmation(po.id, p_supplier_ref, p_expected);
  perform public.portal_notify(u, array['management', 'procurement']::public.app_role[],
    po.number || ' confirmed by ' || coalesce(public.portal_party_name(u), 'the supplier'),
    'Confirmed online' || coalesce(' · their ref ' || nullif(btrim(p_supplier_ref), ''), '') || coalesce(' · delivery ' || to_char(p_expected, 'DD Mon YYYY'), ''),
    '/purchase-orders/' || po.id::text, 'portal-po:' || po.id::text || ':confirmed');
  perform public.portal_log(u, 'po_confirmed', 'purchase_orders', po.id::text,
                            jsonb_build_object('number', po.number, 'supplier_ref', p_supplier_ref, 'expected', p_expected));
end;
$$;

-- A delivery note or an invoice from the supplier. p: {kind, po_id, supplier_invoice_no, reference, doc_date,
-- due_date, currency, subtotal, vat_amount, notes}. Finance checks invoices and turns them into supplier bills.
create or replace function public.portal_submit_document(p_session text, p_account uuid, p jsonb)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare
  u       public.portal_users := public.portal_account(p_session, p_account);
  po      public.purchase_orders;
  v_kind  text := p ->> 'kind';
  v_inv   text := nullif(left(btrim(coalesce(p ->> 'supplier_invoice_no', '')), 80), '');
  v_ref   text := nullif(left(btrim(coalesce(p ->> 'reference', '')), 120), '');
  v_notes text := nullif(btrim(coalesce(p ->> 'notes', '')), '');
  v_date  date;
  v_due   date;
  v_cur   text := upper(coalesce(nullif(btrim(p ->> 'currency'), ''), ''));
  v_sub   numeric := 0;
  v_vat   numeric := 0;
  v_id    uuid;
  v_party text := public.portal_party_name(u);
begin
  if u.party <> 'supplier' then raise exception 'Not available for clients.' using errcode = '42501'; end if;
  if v_kind is null or v_kind not in ('invoice', 'delivery_note') then
    raise exception 'Choose invoice or delivery note.' using errcode = '22023';
  end if;
  if public.portal_hits('submission', u.id::text, interval '1 hour') >= 30 then
    raise exception 'Too many documents in a short time. Please wait a little.' using errcode = '22023';
  end if;
  perform public.portal_hit('submission', u.id::text);
  if nullif(p ->> 'po_id', '') is not null then
    select * into po from public.purchase_orders
     where id = (p ->> 'po_id')::uuid and company_id = u.company_id and supplier_id = u.supplier_id
       and status in ('sent', 'confirmed', 'partially_received', 'received', 'closed');
    if po.id is null then raise exception 'Purchase order not found.' using errcode = '42501'; end if;
  end if;
  begin
    v_date := coalesce(nullif(p ->> 'doc_date', '')::date, public.portal_today());
    v_due := nullif(p ->> 'due_date', '')::date;
  exception when others then
    raise exception 'Check the dates.' using errcode = '22023';
  end;
  if v_date > public.portal_today() + 1 then raise exception 'The document date is in the future.' using errcode = '22023'; end if;
  if v_due is not null and v_due < v_date then raise exception 'The due date is before the invoice date.' using errcode = '22023'; end if;
  if v_notes is not null and char_length(v_notes) > 2000 then raise exception 'The notes are too long.' using errcode = '22023'; end if;
  if v_cur = '' then v_cur := coalesce(po.currency, (select currency from public.suppliers where id = u.supplier_id)); end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'Choose a currency such as TZS or USD.' using errcode = '22023'; end if;

  if v_kind = 'invoice' then
    if v_inv is null then raise exception 'Enter your invoice number.' using errcode = '22023'; end if;
    if coalesce(p ->> 'subtotal', '') !~ '^\d{1,15}(\.\d{1,2})?$' or coalesce(nullif(p ->> 'vat_amount', ''), '0') !~ '^\d{1,15}(\.\d{1,2})?$' then
      raise exception 'Enter the amounts as numbers.' using errcode = '22023';
    end if;
    v_sub := (p ->> 'subtotal')::numeric;
    v_vat := coalesce(nullif(p ->> 'vat_amount', ''), '0')::numeric;
    if v_sub + v_vat <= 0 then raise exception 'Enter the invoice amount.' using errcode = '22023'; end if;
    if exists (select 1 from public.portal_submissions s
                where s.supplier_id = u.supplier_id and s.kind = 'invoice' and s.status <> 'rejected'
                  and lower(s.supplier_invoice_no) = lower(v_inv))
       or exists (select 1 from public.supplier_bills b
                   where b.supplier_id = u.supplier_id and b.status <> 'cancelled' and lower(b.supplier_invoice_no) = lower(v_inv)) then
      raise exception 'Invoice % was already sent.', v_inv using errcode = '23505';
    end if;
  end if;

  insert into public.portal_submissions (company_id, supplier_id, portal_user_id, kind, po_id, supplier_invoice_no, reference,
                                         doc_date, due_date, currency, subtotal, vat_amount, notes)
  values (u.company_id, u.supplier_id, u.id, v_kind, po.id, v_inv, v_ref, v_date, v_due, v_cur, v_sub, v_vat, v_notes)
  returning id into v_id;

  if v_kind = 'invoice' then
    perform public.portal_notify(u, array['management', 'finance']::public.app_role[],
      'Supplier invoice ' || v_inv || ' from ' || coalesce(v_party, 'a supplier') || ' to check',
      public.fmt_money(v_sub + v_vat, v_cur) || coalesce(' for ' || po.number, '') || '. Check it and turn it into a bill.',
      '/portal-admin/submissions/' || v_id::text, 'portal-sub:' || v_id::text);
  else
    perform public.portal_notify(u, array['management', 'procurement', 'warehouse']::public.app_role[],
      'Delivery note from ' || coalesce(v_party, 'a supplier') || coalesce(' for ' || po.number, ''),
      coalesce(v_ref, 'Sent through the supplier portal.'),
      '/portal-admin/submissions/' || v_id::text, 'portal-sub:' || v_id::text);
  end if;
  perform public.portal_log(u, 'submitted_' || v_kind, 'portal_submissions', v_id::text,
                            jsonb_build_object('po', po.number, 'invoice_no', v_inv, 'total', v_sub + v_vat, 'currency', v_cur));
  return v_id;
end;
$$;

create or replace function public.portal_submissions_list(p_session text, p_account uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u public.portal_users := public.portal_account(p_session, p_account);
begin
  if u.party <> 'supplier' then raise exception 'Not available for clients.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(x.j order by x.c desc) from (
      select s.created_at as c,
             jsonb_build_object('id', s.id, 'kind', s.kind, 'status', s.status, 'po_number', po.number,
                                'supplier_invoice_no', s.supplier_invoice_no, 'reference', s.reference, 'doc_date', s.doc_date,
                                'due_date', s.due_date, 'currency', s.currency, 'total', s.total, 'review_note', s.review_note,
                                'reviewed_at', s.reviewed_at, 'created_at', s.created_at,
                                'files', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name) order by f.created_at), '[]'::jsonb)
                                            from public.portal_files f where f.submission_id = s.id and f.stored_at is not null)) as j
        from public.portal_submissions s left join public.purchase_orders po on po.id = s.po_id
       where s.company_id = u.company_id and s.supplier_id = u.supplier_id
       order by s.created_at desc limit 200) x), '[]'::jsonb);
end;
$$;

create or replace function public.portal_mask(p text)
returns text language sql immutable set search_path = ''
as $$ select case when p is null then null when char_length(p) <= 4 then p else repeat('•', 4) || right(p, 4) end; $$;

create or replace function public.portal_supplier_profile(p_session text, p_account uuid)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u public.portal_users := public.portal_account(p_session, p_account);
  s public.suppliers;
  b public.supplier_bank_details;
  p public.supplier_bank_details;
  l public.supplier_bank_details;
begin
  if u.party <> 'supplier' then raise exception 'Not available for clients.' using errcode = '42501'; end if;
  select * into s from public.suppliers where id = u.supplier_id;
  select * into b from public.supplier_bank_details where supplier_id = s.id and status = 'approved';
  select * into p from public.supplier_bank_details where supplier_id = s.id and status = 'pending';
  select * into l from public.supplier_bank_details where supplier_id = s.id and status in ('approved', 'rejected')
   order by decided_at desc nulls last limit 1;
  return jsonb_build_object(
    'name', s.name, 'tax_no', s.tax_no, 'email', s.email, 'phone', s.phone, 'city', s.city, 'country', s.country,
    'certificates', s.certificates, 'currency', s.currency,
    'bank', case when b.id is not null then jsonb_build_object('bank_name', b.bank_name, 'account_name', b.account_name,
                                                               'account_number', public.portal_mask(b.account_number), 'branch', b.branch,
                                                               'swift_code', b.swift_code, 'currency', b.currency, 'approved_at', b.decided_at) end,
    'pending', case when p.id is not null then jsonb_build_object('id', p.id, 'bank_name', p.bank_name, 'account_name', p.account_name,
                                                                  'account_number', public.portal_mask(p.account_number),
                                                                  'currency', p.currency, 'requested_at', p.requested_at) end,
    'last_decision', case when l.id is not null then jsonb_build_object('status', l.status, 'note', l.decision_note, 'decided_at', l.decided_at) end,
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'purpose', f.purpose, 'title', f.title, 'reference', f.reference,
                                                          'expires_on', f.expires_on, 'file_name', f.file_name, 'created_at', f.created_at)
                                        order by f.created_at desc)
                         from public.portal_files f
                        where f.supplier_id = s.id and f.company_id = u.company_id and f.stored_at is not null
                          and f.purpose in ('licence', 'tin_certificate', 'company_document', 'bank_letter')), '[]'::jsonb));
end;
$$;

-- The supplier keeps its details up to date (applied at once; our team is told what changed).
-- p: {tax_no, phone, city, country, certificates}. Bank details are NOT here: see portal_request_bank_change.
create or replace function public.portal_update_supplier(p_session text, p_account uuid, p jsonb)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  u       public.portal_users := public.portal_account(p_session, p_account);
  s       public.suppliers;
  v_tin   text;
  v_phone text;
  v_city  text;
  v_cty   text;
  v_cert  text;
  v_diff  jsonb := '{}'::jsonb;
begin
  if u.party <> 'supplier' then raise exception 'Not available for clients.' using errcode = '42501'; end if;
  select * into s from public.suppliers where id = u.supplier_id for update;
  v_tin := case when p ? 'tax_no' then nullif(btrim(p ->> 'tax_no'), '') else s.tax_no end;
  v_phone := case when p ? 'phone' then nullif(btrim(p ->> 'phone'), '') else s.phone end;
  v_city := case when p ? 'city' then nullif(btrim(p ->> 'city'), '') else s.city end;
  v_cty := case when p ? 'country' then nullif(btrim(p ->> 'country'), '') else s.country end;
  v_cert := case when p ? 'certificates' then nullif(btrim(p ->> 'certificates'), '') else s.certificates end;
  if char_length(coalesce(v_tin, '')) > 40 or char_length(coalesce(v_phone, '')) > 60 or char_length(coalesce(v_city, '')) > 80
     or char_length(coalesce(v_cty, '')) > 80 or char_length(coalesce(v_cert, '')) > 1000 then
    raise exception 'One of the fields is too long.' using errcode = '22023';
  end if;
  if v_tin is distinct from s.tax_no then v_diff := v_diff || jsonb_build_object('tax_no', jsonb_build_object('from', s.tax_no, 'to', v_tin)); end if;
  if v_phone is distinct from s.phone then v_diff := v_diff || jsonb_build_object('phone', jsonb_build_object('from', s.phone, 'to', v_phone)); end if;
  if v_city is distinct from s.city then v_diff := v_diff || jsonb_build_object('city', jsonb_build_object('from', s.city, 'to', v_city)); end if;
  if v_cty is distinct from s.country then v_diff := v_diff || jsonb_build_object('country', jsonb_build_object('from', s.country, 'to', v_cty)); end if;
  if v_cert is distinct from s.certificates then v_diff := v_diff || jsonb_build_object('certificates', jsonb_build_object('from', s.certificates, 'to', v_cert)); end if;
  if v_diff = '{}'::jsonb then return; end if;
  update public.suppliers set tax_no = v_tin, phone = v_phone, city = v_city, country = v_cty, certificates = v_cert where id = s.id;
  perform public.portal_notify(u, array['management', 'procurement']::public.app_role[],
    s.name || ' updated its details on the portal',
    'Changed: ' || (select string_agg(k, ', ') from jsonb_object_keys(v_diff) k),
    '/suppliers/' || s.id::text, 'portal-supplier:' || s.id::text || ':' || extract(epoch from now())::bigint);
  perform public.portal_log(u, 'supplier_details', 'suppliers', s.id::text, v_diff);
end;
$$;

-- New bank details: kept as a request until management approves. Never applied directly.
-- p: {bank_name, account_name, account_number, branch, swift_code, currency}
create or replace function public.portal_request_bank_change(p_session text, p_account uuid, p jsonb)
returns uuid language plpgsql volatile security definer set search_path = ''
as $$
declare
  u      public.portal_users := public.portal_account(p_session, p_account);
  v_bank text := nullif(btrim(coalesce(p ->> 'bank_name', '')), '');
  v_name text := nullif(btrim(coalesce(p ->> 'account_name', '')), '');
  v_no   text := nullif(btrim(coalesce(p ->> 'account_number', '')), '');
  v_br   text := nullif(btrim(coalesce(p ->> 'branch', '')), '');
  v_sw   text := nullif(upper(regexp_replace(coalesce(p ->> 'swift_code', ''), '\s', '', 'g')), '');
  v_cur  text := upper(coalesce(nullif(btrim(p ->> 'currency'), ''), 'TZS'));
  v_id   uuid;
  v_party text := public.portal_party_name(u);
begin
  if u.party <> 'supplier' then raise exception 'Not available for clients.' using errcode = '42501'; end if;
  if v_bank is null or char_length(v_bank) not between 2 and 120 then raise exception 'Enter the bank name.' using errcode = '22023'; end if;
  if v_name is null or char_length(v_name) not between 2 and 160 then raise exception 'Enter the account name.' using errcode = '22023'; end if;
  if v_no is null or v_no !~ '^[0-9A-Za-z -]{4,40}$' then raise exception 'Enter the account number (letters, numbers and spaces).' using errcode = '22023'; end if;
  if v_br is not null and char_length(v_br) > 120 then raise exception 'The branch name is too long.' using errcode = '22023'; end if;
  if v_sw is not null and v_sw !~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$' then raise exception 'A SWIFT code has 8 or 11 letters and numbers.' using errcode = '22023'; end if;
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'Choose a currency such as TZS or USD.' using errcode = '22023'; end if;
  if public.portal_hits('bank_change', u.supplier_id::text, interval '1 day') >= 5 then
    raise exception 'Too many bank detail changes today. Please contact us.' using errcode = '22023';
  end if;
  perform public.portal_hit('bank_change', u.supplier_id::text);

  update public.supplier_bank_details set status = 'withdrawn' where supplier_id = u.supplier_id and status = 'pending';
  insert into public.supplier_bank_details (company_id, supplier_id, bank_name, account_name, account_number, branch, swift_code,
                                            currency, requested_by)
  values (u.company_id, u.supplier_id, v_bank, v_name, v_no, v_br, v_sw, v_cur, u.id)
  returning id into v_id;
  perform public.portal_notify(u, array['management', 'finance']::public.app_role[],
    'New bank details from ' || coalesce(v_party, 'a supplier') || ' need approval',
    'Requested by ' || u.name || ' (' || u.email || '). Call the supplier on a number you already have to confirm before approving.',
    '/portal-admin/bank/' || v_id::text, 'portal-bank:' || v_id::text, 'critical');
  perform public.portal_log(u, 'bank_change_requested', 'supplier_bank_details', v_id::text,
                            jsonb_build_object('bank', v_bank, 'account', public.portal_mask(v_no), 'currency', v_cur));
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 13. Files from the portal: the server asks for a place, uploads, then confirms.
--     p: {purpose, file_name, content_type, size, srfq_supplier_id, submission_id,
--         bank_detail_id, title, reference, expires_on}
-- ---------------------------------------------------------------------
create or replace function public.portal_file_begin(p_session text, p_account uuid, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  u       public.portal_users := public.portal_account(p_session, p_account);
  v_purp  text := p ->> 'purpose';
  v_name  text := left(coalesce(nullif(btrim(regexp_replace(coalesce(p ->> 'file_name', ''), '[/\\[:cntrl:]]', '_', 'g')), ''), 'file'), 200);
  v_type  text := nullif(left(coalesce(p ->> 'content_type', ''), 120), '');
  v_size  bigint;
  v_rs    uuid := nullif(p ->> 'srfq_supplier_id', '')::uuid;
  v_sub   uuid := nullif(p ->> 'submission_id', '')::uuid;
  v_bank  uuid := nullif(p ->> 'bank_detail_id', '')::uuid;
  v_id    uuid := gen_random_uuid();
  v_path  text;
  v_exp   date;
begin
  if v_purp is null or v_purp not in ('rfq_quote', 'delivery_note', 'invoice', 'licence', 'tin_certificate', 'bank_letter', 'company_document') then
    raise exception 'Unknown kind of file.' using errcode = '22023';
  end if;
  if u.party = 'client' then
    raise exception 'Send files with a message instead.' using errcode = '22023';
  end if;
  if coalesce(p ->> 'size', '') !~ '^\d{1,9}$' or (p ->> 'size')::bigint > 15728640 then
    raise exception 'Files can be up to 15 MB.' using errcode = '22023';
  end if;
  v_size := (p ->> 'size')::bigint;
  if v_type is null or v_type not in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'application/msword',
                                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                                      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
    raise exception 'Send a PDF, a photo (JPG or PNG), Word or Excel file.' using errcode = '22023';
  end if;
  if public.portal_hits('file', u.id::text, interval '1 hour') >= 60 then
    raise exception 'Too many files in a short time. Please wait a little.' using errcode = '22023';
  end if;
  perform public.portal_hit('file', u.id::text);
  if v_purp = 'rfq_quote' and not exists (
       select 1 from public.supplier_rfq_suppliers rs join public.supplier_rfqs r on r.id = rs.srfq_id
        where rs.id = v_rs and rs.supplier_id = u.supplier_id and rs.company_id = u.company_id and r.status = 'open') then
    raise exception 'Request not found.' using errcode = '42501';
  end if;
  if v_purp in ('delivery_note', 'invoice') and not exists (
       select 1 from public.portal_submissions s
        where s.id = v_sub and s.supplier_id = u.supplier_id and s.company_id = u.company_id and s.status = 'submitted') then
    raise exception 'Document not found.' using errcode = '42501';
  end if;
  if v_purp = 'bank_letter' and not exists (
       select 1 from public.supplier_bank_details b
        where b.id = v_bank and b.supplier_id = u.supplier_id and b.company_id = u.company_id and b.status = 'pending') then
    raise exception 'Bank change request not found.' using errcode = '42501';
  end if;
  if v_purp <> 'rfq_quote' then v_rs := null; end if;
  if v_purp not in ('delivery_note', 'invoice') then v_sub := null; end if;
  if v_purp <> 'bank_letter' then v_bank := null; end if;
  begin
    v_exp := nullif(p ->> 'expires_on', '')::date;
  exception when others then
    raise exception 'Check the expiry date.' using errcode = '22023';
  end;
  v_path := u.company_id::text || '/' || u.supplier_id::text || '/' || v_id::text || '-' ||
            left(regexp_replace(regexp_replace(v_name, '[^A-Za-z0-9._-]+', '_', 'g'), '\.{2,}', '.', 'g'), 120);
  insert into public.portal_files (id, company_id, portal_user_id, supplier_id, purpose, srfq_supplier_id, submission_id, bank_detail_id,
                                   title, reference, expires_on, file_name, content_type, size_bytes, storage_path)
  values (v_id, u.company_id, u.id, u.supplier_id, v_purp, v_rs, v_sub, v_bank,
          nullif(left(btrim(coalesce(p ->> 'title', '')), 200), ''), nullif(left(btrim(coalesce(p ->> 'reference', '')), 120), ''),
          v_exp, v_name, v_type, v_size, v_path);
  return jsonb_build_object('id', v_id, 'bucket', 'portal', 'path', v_path);
end;
$$;

-- The server uploaded the file: it is now visible to our team (and to the supplier).
create or replace function public.portal_file_done(p_session text, p_account uuid, p_file uuid)
returns void language plpgsql volatile security definer set search_path = ''
as $$
declare
  u public.portal_users := public.portal_account(p_session, p_account);
  f public.portal_files;
begin
  select * into f from public.portal_files where id = p_file and portal_user_id = u.id and company_id = u.company_id;
  if f.id is null then raise exception 'File not found.' using errcode = '42501'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'portal' and o.name = f.storage_path) then
    raise exception 'The file did not arrive. Please try again.' using errcode = '22023';
  end if;
  update public.portal_files set stored_at = coalesce(stored_at, now()) where id = f.id;
  perform public.portal_log(u, 'file_uploaded', 'portal_files', f.id::text, jsonb_build_object('purpose', f.purpose, 'file_name', f.file_name));
  if f.purpose in ('licence', 'tin_certificate', 'company_document') then
    perform public.portal_notify(u, array['management', 'procurement']::public.app_role[],
      coalesce(public.portal_party_name(u), 'A supplier') || ' sent a company document',
      coalesce(f.title, f.file_name) || coalesce(' · expires ' || to_char(f.expires_on, 'DD Mon YYYY'), ''),
      '/suppliers/' || u.supplier_id::text || '#portal', 'portal-file:' || f.id::text);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 14. Our team (signed in to the app)
-- ---------------------------------------------------------------------
-- Management invites a client or supplier contact. Returns the portal account id.
create or replace function public.portal_invite(p_company uuid, p_party text, p_party_id uuid, p_email text, p_name text,
                                                p_position text, p_phone text, p_contact uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := public.portal_email(p_email);
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_id    uuid;
begin
  if not public.has_role(p_company, array['management']::public.app_role[]) then
    raise exception 'Only management can invite people to the portal.' using errcode = '42501';
  end if;
  if p_party is null or p_party not in ('client', 'supplier') then
    raise exception 'Unknown portal.' using errcode = '22023';
  end if;
  if not public.feature_on(p_company, case when p_party = 'client' then 'client_portal' else 'supplier_portal' end) then
    raise exception 'Switch on the % portal first (Settings → Features).', p_party using errcode = '22023';
  end if;
  if p_party = 'client' and not exists (select 1 from public.clients where id = p_party_id and company_id = p_company and active) then
    raise exception 'Client not found.' using errcode = '42501';
  end if;
  if p_party = 'supplier' and not exists (select 1 from public.suppliers where id = p_party_id and company_id = p_company and active) then
    raise exception 'Supplier not found.' using errcode = '42501';
  end if;
  if p_contact is not null and (p_party <> 'client' or not exists (
       select 1 from public.client_contacts where id = p_contact and client_id = p_party_id and company_id = p_company)) then
    raise exception 'Contact not found.' using errcode = '42501';
  end if;
  if v_email is null then raise exception 'Enter a valid email address.' using errcode = '22023'; end if;
  if v_name is null or char_length(v_name) not between 2 and 120 then raise exception 'Enter the person''s name.' using errcode = '22023'; end if;
  if char_length(coalesce(p_position, '')) > 120 or char_length(coalesce(p_phone, '')) > 40 then
    raise exception 'The position or phone is too long.' using errcode = '22023';
  end if;
  -- Team members use the app itself, not the portal.
  if exists (select 1 from public.memberships m join public.profiles pr on pr.id = m.user_id
              where m.company_id = p_company and m.active and lower(pr.email) = v_email) then
    raise exception 'This email belongs to someone in your team.' using errcode = '22023';
  end if;

  select id into v_id from public.portal_users
   where company_id = p_company and email = v_email and coalesce(client_id, supplier_id) = p_party_id;
  if v_id is not null then
    update public.portal_users
       set status = 'active', name = v_name, position = nullif(btrim(coalesce(p_position, '')), ''),
           phone = nullif(btrim(coalesce(p_phone, '')), ''), contact_id = coalesce(p_contact, contact_id),
           invited_by = auth.uid(), invited_at = now(), revoked_at = null, revoked_by = null
     where id = v_id;
    return v_id;
  end if;
  insert into public.portal_users (company_id, party, client_id, supplier_id, contact_id, name, email, phone, position, invited_by)
  values (p_company, p_party, case when p_party = 'client' then p_party_id end, case when p_party = 'supplier' then p_party_id end,
          p_contact, v_name, v_email, nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_position, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- Management removes access. It stops at once: every portal call checks the account.
create or replace function public.portal_revoke(p_portal_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  u public.portal_users;
begin
  select * into u from public.portal_users where id = p_portal_user for update;
  if u.id is null or not public.has_role(u.company_id, array['management']::public.app_role[]) then
    raise exception 'Portal access not found.' using errcode = '42501';
  end if;
  if u.status = 'revoked' then return; end if;
  update public.portal_users set status = 'revoked', revoked_at = now(), revoked_by = auth.uid() where id = u.id;
  -- Signed out everywhere when this email has no other portal access left.
  if not exists (select 1 from public.portal_users o where o.email = u.email and o.status = 'active') then
    update public.portal_sessions set revoked_at = now() where email = u.email and revoked_at is null;
  end if;
end;
$$;

-- Show (or stop showing) a library document on a client's or supplier's portal.
create or replace function public.portal_share_document(p_document uuid, p_party text, p_party_id uuid, p_share boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  d public.documents;
begin
  select * into d from public.documents where id = p_document;
  if d.id is null or not public.has_role(d.company_id,
       case when p_party = 'client' then array['management', 'sales']::public.app_role[]
            else array['management', 'procurement']::public.app_role[] end) then
    raise exception 'Document not found.' using errcode = '42501';
  end if;
  if p_party = 'client' and not exists (select 1 from public.clients where id = p_party_id and company_id = d.company_id) then
    raise exception 'Client not found.' using errcode = '42501';
  end if;
  if p_party = 'supplier' and not exists (select 1 from public.suppliers where id = p_party_id and company_id = d.company_id) then
    raise exception 'Supplier not found.' using errcode = '42501';
  end if;
  if p_party is null or p_party not in ('client', 'supplier') then
    raise exception 'Unknown portal.' using errcode = '22023';
  end if;
  if coalesce(p_share, false) then
    if d.archived_at is not null or d.file_path is null then
      raise exception 'Only a document with its file can be shared.' using errcode = '22023';
    end if;
    insert into public.portal_shared_documents (company_id, document_id, client_id, supplier_id)
    values (d.company_id, d.id, case when p_party = 'client' then p_party_id end, case when p_party = 'supplier' then p_party_id end)
    on conflict do nothing;
  else
    delete from public.portal_shared_documents
     where document_id = d.id and coalesce(client_id, supplier_id) = p_party_id;
  end if;
end;
$$;

-- Management approves or rejects new bank details. Approved details replace the old ones.
-- Returns {supplier_id, supplier, status, emails} so the server can tell the supplier.
create or replace function public.portal_decide_bank_change(p_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  b      public.supplier_bank_details;
  v_name text;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  select * into b from public.supplier_bank_details where id = p_id for update;
  if b.id is null or not public.has_role(b.company_id, array['management']::public.app_role[]) then
    raise exception 'Only management can approve bank details.' using errcode = '42501';
  end if;
  if b.status <> 'pending' then
    raise exception 'This request was already decided.' using errcode = '22023';
  end if;
  if not coalesce(p_approve, false) and v_note is null then
    raise exception 'Say why the bank details are rejected.' using errcode = '22023';
  end if;
  select name into v_name from public.suppliers where id = b.supplier_id;
  if coalesce(p_approve, false) then
    update public.supplier_bank_details set status = 'superseded' where supplier_id = b.supplier_id and status = 'approved';
    update public.supplier_bank_details set status = 'approved', decided_by = auth.uid(), decided_at = now(), decision_note = v_note where id = b.id;
    update public.suppliers set bank_details_received = true where id = b.supplier_id and not bank_details_received;
  else
    update public.supplier_bank_details set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = v_note where id = b.id;
  end if;
  begin
    perform public.notify_roles(b.company_id, array['management', 'finance']::public.app_role[], auth.uid(), 'portal', 'attention',
      case when p_approve then 'New bank details approved for ' else 'Bank details rejected for ' end || coalesce(v_name, 'a supplier'),
      case when p_approve then 'Pay this supplier to the new account from now on.' else coalesce(v_note, '') end,
      '/portal-admin/bank/' || b.id::text, 'portal-bank:' || b.id::text || ':decided');
  exception when others then
    raise warning 'Portal notification failed: %', sqlerrm;
  end;
  return jsonb_build_object('supplier_id', b.supplier_id, 'supplier', v_name,
                            'status', case when p_approve then 'approved' else 'rejected' end, 'note', v_note,
                            'emails', coalesce((select jsonb_agg(distinct pu.email) from public.portal_users pu
                                                 where pu.supplier_id = b.supplier_id and pu.status = 'active'), '[]'::jsonb));
end;
$$;

-- Finance checks a supplier's document: 'bill' turns an invoice into a supplier bill,
-- 'accept' marks it checked, 'reject' sends it back with a reason.
create or replace function public.portal_review_submission(p_id uuid, p_action text, p_note text, p_due date)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s      public.portal_submissions;
  po     public.purchase_orders;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_bill uuid;
  v_rate numeric := 1;
  c      public.companies;
begin
  select * into s from public.portal_submissions where id = p_id for update;
  if s.id is null or not public.has_role(s.company_id,
       case when p_action = 'bill' then array['management', 'finance']::public.app_role[]
            else array['management', 'finance', 'procurement']::public.app_role[] end) then
    raise exception 'Document not found.' using errcode = '42501';
  end if;
  if s.status <> 'submitted' then raise exception 'This document was already checked.' using errcode = '22023'; end if;
  if p_action = 'reject' then
    if v_note is null then raise exception 'Say why it is sent back.' using errcode = '22023'; end if;
    update public.portal_submissions set status = 'rejected', review_note = v_note, reviewed_by = auth.uid(), reviewed_at = now() where id = s.id;
    return null;
  elsif p_action = 'accept' then
    update public.portal_submissions set status = 'accepted', review_note = v_note, reviewed_by = auth.uid(), reviewed_at = now() where id = s.id;
    return null;
  elsif p_action <> 'bill' then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  if s.kind <> 'invoice' then raise exception 'Only an invoice becomes a bill.' using errcode = '22023'; end if;
  select * into c from public.companies where id = s.company_id;
  if s.po_id is not null then
    select * into po from public.purchase_orders where id = s.po_id;
  end if;
  v_rate := case when s.currency = c.base_currency then 1
                 when po.id is not null and po.currency = s.currency then po.exchange_rate
                 else coalesce((select x.rate from public.exchange_rates x where x.company_id = s.company_id and x.currency = s.currency), 1) end;
  insert into public.supplier_bills (company_id, supplier_id, po_id, supplier_invoice_no, bill_date, due_date, currency, exchange_rate,
                                     subtotal, vat_amount, notes, created_by)
  values (s.company_id, s.supplier_id, s.po_id, s.supplier_invoice_no, s.doc_date, coalesce(p_due, s.due_date), s.currency, v_rate,
          s.subtotal, s.vat_amount, left('From the supplier portal' || coalesce('. ' || s.notes, '') || coalesce('. ' || v_note, ''), 2000),
          auth.uid())
  returning id into v_bill;
  update public.portal_submissions set status = 'billed', bill_id = v_bill, review_note = v_note, reviewed_by = auth.uid(), reviewed_at = now()
   where id = s.id;
  return v_bill;
end;
$$;

-- "Send via portal" on a supplier RFQ: the suppliers asked, with their portal contacts to email.
-- Logged in the Activity log; returns [{srfq_supplier_id, supplier, recipients: [{name, email}]}].
create or replace function public.portal_rfq_send_list(p_srfq uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  r     public.supplier_rfqs;
  v_out jsonb;
begin
  select * into r from public.supplier_rfqs where id = p_srfq;
  if r.id is null or not public.has_role(r.company_id, array['management', 'procurement']::public.app_role[]) then
    raise exception 'Request not found.' using errcode = '42501';
  end if;
  if r.status <> 'open' then raise exception 'This request is closed.' using errcode = '22023'; end if;
  if not public.feature_on(r.company_id, 'supplier_portal') then
    raise exception 'Switch on the supplier portal first (Settings → Features).' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('srfq_supplier_id', rs.id, 'supplier', s.name, 'status', rs.status,
                                               'recipients', (select coalesce(jsonb_agg(jsonb_build_object('name', pu.name, 'email', pu.email) order by pu.name), '[]'::jsonb)
                                                                from public.portal_users pu
                                                               where pu.supplier_id = rs.supplier_id and pu.company_id = r.company_id and pu.status = 'active'))
                            order by s.name), '[]'::jsonb)
    into v_out
    from public.supplier_rfq_suppliers rs join public.suppliers s on s.id = rs.supplier_id
   where rs.srfq_id = r.id and rs.status = 'invited';
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (r.company_id, auth.uid(), 'portal_rfq_sent', 'supplier_rfqs', r.id::text,
          jsonb_build_object('number', r.number,
                             'recipients', (select coalesce(jsonb_agg(e -> 'email'), '[]'::jsonb)
                                              from jsonb_array_elements(v_out) x, jsonb_array_elements(x -> 'recipients') e)));
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------
-- 15. Grants
-- ---------------------------------------------------------------------
revoke execute on function
  public.apply_quotation_outcome(uuid, boolean, text), public.record_quotation_outcome(uuid, boolean, text),
  public.apply_po_confirmation(uuid, text, date), public.confirm_purchase_order(uuid, text, date),
  public.portal_digest(text), public.portal_new_token(), public.portal_new_code(), public.portal_email(text), public.portal_today(),
  public.portal_staff_roles(), public.can_use_portal_file(text), public.add_portal_cleanup(),
  public.portal_hits(text, text, interval), public.portal_hit(text, text), public.portal_account_ok(public.portal_users),
  public.portal_session_email(text), public.portal_account(text, uuid),
  public.portal_log(public.portal_users, text, text, text, jsonb),
  public.portal_notify(public.portal_users, public.app_role[], text, text, text, text, text),
  public.portal_party_name(public.portal_users), public.portal_quote_no(public.quotations), public.portal_mask(text),
  public.portal_stage(jsonb), public.portal_progress(uuid),
  public.portal_request_login(text, text), public.portal_verify_login(text, text, text, text, text), public.portal_sign_out(text),
  public.portal_accounts(text), public.portal_me(text, uuid),
  public.portal_quotations(text, uuid), public.portal_quotation(text, uuid, uuid), public.portal_decide_quotation(text, uuid, uuid, jsonb),
  public.portal_orders(text, uuid), public.portal_order(text, uuid, uuid), public.portal_invoices(text, uuid),
  public.portal_documents(text, uuid), public.portal_open(text, uuid, text, uuid, text),
  public.portal_send_message(text, uuid, text, text), public.portal_messages(text, uuid),
  public.portal_rfqs(text, uuid), public.portal_rfq(text, uuid, uuid), public.portal_answer_rfq(text, uuid, uuid, jsonb),
  public.portal_purchase_orders(text, uuid), public.portal_purchase_order(text, uuid, uuid),
  public.portal_confirm_po(text, uuid, uuid, text, date), public.portal_submit_document(text, uuid, jsonb),
  public.portal_submissions_list(text, uuid), public.portal_supplier_profile(text, uuid), public.portal_update_supplier(text, uuid, jsonb),
  public.portal_request_bank_change(text, uuid, jsonb), public.portal_file_begin(text, uuid, jsonb), public.portal_file_done(text, uuid, uuid),
  public.portal_invite(uuid, text, uuid, text, text, text, text, uuid), public.portal_revoke(uuid),
  public.portal_share_document(uuid, text, uuid, boolean), public.portal_decide_bank_change(uuid, boolean, text),
  public.portal_review_submission(uuid, text, text, date), public.portal_rfq_send_list(uuid)
from public, anon, authenticated;

-- The app's status buttons (as before) and our team's portal tools.
grant execute on function
  public.record_quotation_outcome(uuid, boolean, text), public.confirm_purchase_order(uuid, text, date),
  public.portal_staff_roles(), public.can_use_portal_file(text),
  public.portal_invite(uuid, text, uuid, text, text, text, text, uuid), public.portal_revoke(uuid),
  public.portal_share_document(uuid, text, uuid, boolean), public.portal_decide_bank_change(uuid, boolean, text),
  public.portal_review_submission(uuid, text, text, date), public.portal_rfq_send_list(uuid)
to authenticated;

-- The portal pages, on the server only (service role key). Visitors and signed-in app users cannot call them.
grant execute on function
  public.portal_request_login(text, text), public.portal_verify_login(text, text, text, text, text), public.portal_sign_out(text),
  public.portal_accounts(text), public.portal_me(text, uuid),
  public.portal_quotations(text, uuid), public.portal_quotation(text, uuid, uuid), public.portal_decide_quotation(text, uuid, uuid, jsonb),
  public.portal_orders(text, uuid), public.portal_order(text, uuid, uuid), public.portal_invoices(text, uuid),
  public.portal_documents(text, uuid), public.portal_open(text, uuid, text, uuid, text),
  public.portal_send_message(text, uuid, text, text), public.portal_messages(text, uuid),
  public.portal_rfqs(text, uuid), public.portal_rfq(text, uuid, uuid), public.portal_answer_rfq(text, uuid, uuid, jsonb),
  public.portal_purchase_orders(text, uuid), public.portal_purchase_order(text, uuid, uuid),
  public.portal_confirm_po(text, uuid, uuid, text, date), public.portal_submit_document(text, uuid, jsonb),
  public.portal_submissions_list(text, uuid), public.portal_supplier_profile(text, uuid), public.portal_update_supplier(text, uuid, jsonb),
  public.portal_request_bank_change(text, uuid, jsonb), public.portal_file_begin(text, uuid, jsonb), public.portal_file_done(text, uuid, uuid)
to service_role;

notify pgrst, 'reload schema';
