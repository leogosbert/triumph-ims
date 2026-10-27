-- =====================================================================
-- Online product catalogue: a public page and PDF per company
-- (/c/<slug>, /c/<slug>/pdf) with the company's branding, categories,
-- product photos, specifications and the data sheets management marks
-- as public. Visitors send an enquiry or a request for quotation.
--
--   catalogue_settings    per company: the address (slug), published or
--                         not, headline, introduction, which contact
--                         details to show, the WhatsApp number, the search
--                         description.
--   catalogue_products    per product: shown or not, price shown or not
--                         (never by default), photo, short description,
--                         order. Stock levels and costs are never shown.
--   catalogue_documents   data sheets, SDS, CoAs and certificates of a
--                         product that anyone may download.
--   catalogue_enquiries   what visitors sent: the request for quotation
--                         draft (products and quantities), who sent it,
--                         and the RFQ and Inbox conversation it became.
--   catalogue_hits        rate limit (who sent how many, as a hash; kept
--                         two days; never in backups).
--
-- The public pages read and write only through the functions marked
-- "public pages" below, called on the server with the service role key.
-- An enquiry lands in the Inbox with a notification to management and
-- sales; when the sender is a known client it also becomes a client RFQ
-- straight away, otherwise one tap makes the client and the RFQ.
--
-- Photos are in the public storage bucket "catalogue":
-- <company>/<product>/<file>; management adds and removes them.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Feature
-- ---------------------------------------------------------------------
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('online_catalogue', 'Online product catalogue',
 'A public catalogue page and PDF with your logo and colours, product categories, photos, specifications and downloadable data sheets that management marks as public. Prices only for products you choose; stock and costs never. Visitors send an enquiry or a request for quotation that lands in the Inbox as a client RFQ draft. Share it by WhatsApp, email or a QR code.',
 'Sales', 'small', 'live', 'Every supplier that wants buyers at mines, factories and contractors to see what it supplies.',
 'Buyers find your products and ask for quotations at any hour, and every request arrives in the app ready to price.',
 '[{"title": "Choose what to show", "body": "Open Products, then Online catalogue. Pick the products to show, add a photo and a short description, and mark the data sheets anyone may download."},
   {"title": "Publish and share", "body": "Choose the catalogue address, publish it, and share the link by WhatsApp or email, or print the QR code on your letterhead and stand."},
   {"title": "Answer requests", "body": "Requests for quotation arrive in the Inbox with a notification. A known client gets an RFQ at once; otherwise tap Make client and RFQ."}]'::jsonb,
 '/catalogue', 225)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
create table if not exists public.catalogue_settings (
  company_id       uuid primary key references public.companies (id) on delete cascade,
  slug             text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$' and slug !~ '--'),
  published        boolean not null default false,
  headline         text check (headline is null or char_length(headline) <= 160),
  intro            text check (intro is null or char_length(intro) <= 1500),
  seo_description  text check (seo_description is null or char_length(seo_description) <= 300),
  show_phone       boolean not null default true,
  show_email       boolean not null default true,
  show_address     boolean not null default true,
  whatsapp         text check (whatsapp is null or whatsapp ~ '^[0-9]{9,15}$'),
  published_at     timestamptz,
  updated_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.catalogue_products (
  product_id  uuid primary key,
  company_id  uuid not null references public.companies (id) on delete cascade,
  public      boolean not null default false,
  show_price  boolean not null default false,
  summary     text check (summary is null or char_length(summary) <= 600),
  photo_path  text check (photo_path is null or char_length(photo_path) <= 400),
  sort        integer not null default 1000,
  updated_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  foreign key (product_id, company_id) references public.products (id, company_id) on delete cascade
);
create index if not exists catalogue_products_company_idx on public.catalogue_products (company_id, public, sort);

create table if not exists public.catalogue_documents (
  document_id  uuid primary key,
  company_id   uuid not null references public.companies (id) on delete cascade,
  public       boolean not null default true,
  updated_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (document_id, company_id) references public.documents (id, company_id) on delete cascade
);
create index if not exists catalogue_documents_company_idx on public.catalogue_documents (company_id);

create table if not exists public.catalogue_enquiries (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  kind             text not null check (kind in ('enquiry', 'quote')),
  name             text not null check (char_length(name) between 2 and 120),
  company_name     text check (company_name is null or char_length(company_name) <= 160),
  email            text check (email is null or char_length(email) <= 200),
  phone            text check (phone is null or char_length(phone) <= 20),
  message          text check (message is null or char_length(message) <= 2000),
  lines            jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 30),
  status           text not null default 'new' check (status in ('new', 'converted', 'closed')),
  client_id        uuid,
  rfq_id           uuid,
  conversation_id  uuid,
  handled_by       uuid references auth.users (id) on delete set null,
  handled_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, company_id),
  check (email is not null or phone is not null),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete set null (client_id),
  foreign key (rfq_id, company_id) references public.rfqs (id, company_id) on delete set null (rfq_id),
  foreign key (conversation_id, company_id) references public.inbox_conversations (id, company_id) on delete set null (conversation_id)
);
create index if not exists catalogue_enquiries_company_idx on public.catalogue_enquiries (company_id, status, created_at desc);
create index if not exists catalogue_enquiries_client_idx on public.catalogue_enquiries (client_id) where client_id is not null;
create index if not exists catalogue_enquiries_rfq_idx on public.catalogue_enquiries (rfq_id) where rfq_id is not null;
create index if not exists catalogue_enquiries_conv_idx on public.catalogue_enquiries (conversation_id) where conversation_id is not null;

create table if not exists public.catalogue_hits (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  sender_hash  text not null check (char_length(sender_hash) between 16 and 128),
  created_at   timestamptz not null default now()
);
create index if not exists catalogue_hits_idx on public.catalogue_hits (company_id, sender_hash, created_at);

-- ---------------------------------------------------------------------
-- 3. Storage: public bucket "catalogue" for product photos
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('catalogue', 'catalogue', true) on conflict (id) do nothing;
do $$
begin
  update storage.buckets
     set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
   where id = 'catalogue';
exception when undefined_column then
  raise notice 'Storage limits not set (older storage version).';
end;
$$;

-- Management of the company adds and removes photos of its own products: <company>/<product>/<file>.
create or replace function public.can_edit_catalogue_file(p_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_name not like '%..%' and exists (
    select 1 from public.products p
     where p.company_id::text = (storage.foldername(p_name))[1]
       and p.id::text = (storage.foldername(p_name))[2]
       and public.is_manager(p.company_id));
$$;

drop policy if exists catalogue_files_insert on storage.objects;
create policy catalogue_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'catalogue' and public.can_edit_catalogue_file(name));
drop policy if exists catalogue_files_update on storage.objects;
create policy catalogue_files_update on storage.objects for update to authenticated
  using (bucket_id = 'catalogue' and public.can_edit_catalogue_file(name))
  with check (bucket_id = 'catalogue' and public.can_edit_catalogue_file(name));
drop policy if exists catalogue_files_delete on storage.objects;
create policy catalogue_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'catalogue' and public.can_edit_catalogue_file(name));
drop policy if exists catalogue_files_select on storage.objects;
create policy catalogue_files_select on storage.objects for select to authenticated
  using (bucket_id = 'catalogue' and public.can_edit_catalogue_file(name));

-- Closed companies: catalogue photos are cleaned up with the logo.
create or replace function public.add_catalogue_cleanup()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.bucket = 'branding'
     and exists (select 1 from storage.objects o where o.bucket_id = 'catalogue' and left(o.name, length(new.prefix)) = new.prefix) then
    insert into public.storage_cleanup (bucket, prefix, company_ref)
    values ('catalogue', new.prefix, new.company_ref)
    on conflict (bucket, prefix) do nothing;
    begin
      delete from storage.objects where bucket_id = 'catalogue' and name like new.prefix || '%';
    exception when others then
      raise notice 'catalogue files for % left in storage: %', new.company_ref, sqlerrm;
    end;
  end if;
  return null;
end;
$$;
do $$
begin
  drop trigger if exists storage_cleanup_catalogue on public.storage_cleanup;
  create trigger storage_cleanup_catalogue after insert on public.storage_cleanup
    for each row execute function public.add_catalogue_cleanup();
exception when undefined_table then
  raise notice 'Run the deletion update first, then this one again, so catalogue photos are cleaned up with closed companies.';
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Settings (management)
-- ---------------------------------------------------------------------
-- "TRIUMPH General Suppliers Ltd" -> "triumph-general-suppliers-ltd" (2-40 characters).
create or replace function public.catalogue_slug_of(p text)
returns text language sql immutable set search_path = ''
as $$
  select nullif(btrim(left(btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g'), '-'), 40), '-'), '');
$$;

create or replace function public.catalogue_save_settings(p_company uuid, p jsonb)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_slug text := lower(btrim(coalesce(p ->> 'slug', '')));
  v_wa   text := nullif(public.inbox_phone_of(p ->> 'whatsapp'), '');
  v_pub  boolean := coalesce((p ->> 'published')::boolean, false);
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can change the online catalogue.' using errcode = '42501';
  end if;
  if not public.feature_on(p_company, 'online_catalogue') then
    raise exception 'Switch on the online catalogue first (Settings, then Features).' using errcode = '22023';
  end if;
  if v_slug = '' then
    v_slug := public.catalogue_slug_of((select name from public.companies where id = p_company));
  end if;
  if v_slug is null or v_slug !~ '^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$' or v_slug ~ '--' then
    raise exception 'The address may use small letters, numbers and single dashes (3 to 40 characters).' using errcode = '22023';
  end if;
  if v_slug in ('admin', 'api', 'login', 'app', 'pdf', 'new', 'www', 'lemosp', 'support', 'help') then
    raise exception 'That address is reserved. Choose another one.' using errcode = '22023';
  end if;
  if exists (select 1 from public.catalogue_settings where slug = v_slug and company_id <> p_company) then
    raise exception 'That address is already used by another company.' using errcode = '23505';
  end if;
  if v_wa is not null and length(v_wa) not between 9 and 15 then
    raise exception 'Enter the WhatsApp number with its country code, e.g. 255712345678.' using errcode = '22023';
  end if;
  insert into public.catalogue_settings (company_id, slug, published, headline, intro, seo_description, show_phone, show_email,
                                         show_address, whatsapp, published_at, updated_by)
  values (p_company, v_slug, v_pub,
          nullif(left(btrim(coalesce(p ->> 'headline', '')), 160), ''),
          nullif(left(btrim(coalesce(p ->> 'intro', '')), 1500), ''),
          nullif(left(btrim(coalesce(p ->> 'seo_description', '')), 300), ''),
          coalesce((p ->> 'show_phone')::boolean, true),
          coalesce((p ->> 'show_email')::boolean, true),
          coalesce((p ->> 'show_address')::boolean, true),
          v_wa, case when v_pub then now() end, auth.uid())
  on conflict (company_id) do update
     set slug = excluded.slug,
         published = excluded.published,
         headline = excluded.headline,
         intro = excluded.intro,
         seo_description = excluded.seo_description,
         show_phone = excluded.show_phone,
         show_email = excluded.show_email,
         show_address = excluded.show_address,
         whatsapp = excluded.whatsapp,
         published_at = case when excluded.published and not public.catalogue_settings.published then now()
                             else public.catalogue_settings.published_at end,
         updated_by = excluded.updated_by;
  return v_slug;
end;
$$;

-- Show or hide one product; p keys: public, show_price, summary, sort.
create or replace function public.catalogue_set_product(p_product uuid, p jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_co uuid;
begin
  select company_id into v_co from public.products where id = p_product;
  if v_co is null or not public.is_manager(v_co) then
    raise exception 'Only management decides what the online catalogue shows.' using errcode = '42501';
  end if;
  insert into public.catalogue_products (product_id, company_id, public, show_price, summary, sort, updated_by)
  values (p_product, v_co, coalesce((p ->> 'public')::boolean, false), coalesce((p ->> 'show_price')::boolean, false),
          nullif(left(btrim(coalesce(p ->> 'summary', '')), 600), ''),
          case when (p ->> 'sort') ~ '^-?\d{1,6}$' then (p ->> 'sort')::integer else 1000 end, auth.uid())
  on conflict (product_id) do update
     set public = case when p ? 'public' then excluded.public else public.catalogue_products.public end,
         show_price = case when p ? 'show_price' then excluded.show_price else public.catalogue_products.show_price end,
         summary = case when p ? 'summary' then excluded.summary else public.catalogue_products.summary end,
         sort = case when p ? 'sort' then excluded.sort else public.catalogue_products.sort end,
         updated_by = excluded.updated_by;
end;
$$;

-- Show or hide every active product of a category at once (null: every active product).
create or replace function public.catalogue_set_category(p_company uuid, p_category text, p_public boolean)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management decides what the online catalogue shows.' using errcode = '42501';
  end if;
  insert into public.catalogue_products as cp (product_id, company_id, public, updated_by)
  select p.id, p.company_id, coalesce(p_public, false), auth.uid()
    from public.products p
   where p.company_id = p_company and p.active
     and (p_category is null or coalesce(p.category, '') = p_category)
  on conflict (product_id) do update set public = excluded.public, updated_by = excluded.updated_by;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- The photo was uploaded to catalogue/<company>/<product>/<file> (null: no photo).
create or replace function public.catalogue_set_photo(p_product uuid, p_path text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_co uuid;
begin
  select company_id into v_co from public.products where id = p_product;
  if v_co is null or not public.is_manager(v_co) then
    raise exception 'Only management changes catalogue photos.' using errcode = '42501';
  end if;
  if p_path is not null and (p_path not like v_co::text || '/' || p_product::text || '/%' or p_path like '%..%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'catalogue' and o.name = p_path)) then
    raise exception 'The photo was not found. Please upload it again.' using errcode = '22023';
  end if;
  insert into public.catalogue_products (product_id, company_id, photo_path, updated_by)
  values (p_product, v_co, p_path, auth.uid())
  on conflict (product_id) do update set photo_path = excluded.photo_path, updated_by = excluded.updated_by;
end;
$$;

-- A data sheet, SDS, CoA or certificate of a product that anyone may download (false: private again).
create or replace function public.catalogue_set_document(p_document uuid, p_public boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  d record;
begin
  select id, company_id, kind, product_id, file_path, archived_at into d from public.documents where id = p_document;
  if d.id is null or not public.is_manager(d.company_id) then
    raise exception 'Only management decides which papers are public.' using errcode = '42501';
  end if;
  if coalesce(p_public, false) then
    if d.product_id is null or d.kind not in ('datasheet', 'sds', 'coa', 'certificate') then
      raise exception 'Only data sheets, SDS, CoAs and certificates linked to a product can be public.' using errcode = '22023';
    end if;
    if d.file_path is null or d.archived_at is not null then
      raise exception 'Upload the file first.' using errcode = '22023';
    end if;
    insert into public.catalogue_documents (document_id, company_id, public, updated_by)
    values (d.id, d.company_id, true, auth.uid())
    on conflict (document_id) do update set public = true, updated_by = excluded.updated_by;
  else
    delete from public.catalogue_documents where document_id = d.id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Public pages (service role only)
-- ---------------------------------------------------------------------
create or replace function public.catalogue_company_of(p_slug text)
returns uuid language sql stable security definer set search_path = ''
as $$
  select s.company_id from public.catalogue_settings s join public.companies c on c.id = s.company_id
   where p_slug ~ '^[a-z0-9-]{3,40}$' and s.slug = p_slug and s.published and c.closing_after is null
     and not coalesce(c.is_demo, false) and public.feature_on(c.id, 'online_catalogue');
$$;

-- What the public page shows. Null when there is no published catalogue at that address.
-- Never stock levels, costs or private papers; a price only where the product is switched to show it.
create or replace function public.catalogue_public(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_co uuid := public.catalogue_company_of(p_slug);
  s    public.catalogue_settings;
  c    public.companies;
begin
  if v_co is null then
    return null;
  end if;
  select * into s from public.catalogue_settings where company_id = v_co;
  select * into c from public.companies where id = v_co;
  return jsonb_build_object(
    'slug', s.slug,
    'company', jsonb_build_object(
      'name', c.name, 'legal_name', c.legal_name, 'logo_path', c.logo_path, 'primary_color', c.primary_color,
      'accent_color', c.accent_color, 'website', c.website, 'currency', c.base_currency,
      'phone', case when s.show_phone then c.phone end,
      'email', case when s.show_email then c.email end,
      'address', case when s.show_address then c.address end,
      'whatsapp', s.whatsapp),
    'headline', s.headline, 'intro', s.intro, 'seo_description', s.seo_description, 'updated_at', s.updated_at,
    'products', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'sku', p.sku, 'name', p.name, 'category', p.category, 'subcategory', p.subcategory, 'brand', p.brand,
        'manufacturer', p.manufacturer, 'part_no', p.mfr_part_no, 'specification', p.specification, 'unit', p.unit,
        'pack_size', p.pack_size, 'hazardous', p.hazardous, 'un_number', p.un_number, 'country_of_origin', p.country_of_origin,
        'summary', cp.summary, 'photo_path', cp.photo_path,
        'price', case when cp.show_price then p.selling_price end,
        'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'kind', d.kind, 'file_type', d.file_type)
                                                order by d.kind, d.title)
                                 from public.catalogue_documents cd join public.documents d on d.id = cd.document_id
                                where cd.company_id = v_co and cd.public and d.product_id = p.id and d.archived_at is null
                                  and d.file_path is not null), '[]'::jsonb))
        order by coalesce(nullif(p.category, ''), 'zzz'), cp.sort, p.name)
        from public.catalogue_products cp join public.products p on p.id = cp.product_id
       where cp.company_id = v_co and cp.public and p.active), '[]'::jsonb));
end;
$$;

-- A public data sheet: where its file is (null when it is not public).
create or replace function public.catalogue_public_document(p_slug text, p_document uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('file_path', d.file_path, 'file_name', d.file_name, 'file_type', d.file_type, 'title', d.title)
    from public.catalogue_documents cd
    join public.documents d on d.id = cd.document_id
    join public.catalogue_products cp on cp.product_id = d.product_id and cp.public
    join public.products p on p.id = d.product_id and p.active
   where cd.document_id = p_document and cd.public and d.archived_at is null and d.file_path is not null
     and cd.company_id = public.catalogue_company_of(p_slug);
$$;

-- A visitor's enquiry or request for quotation. p keys: kind (enquiry | quote), name, company, email, phone,
-- message, lines [{product_id, quantity}]. p_sender: a hash of who sent it (rate limit: 3 an hour, 30 a day
-- per company). Returns {status: received | limited | invalid | closed, error, enquiry_id}.
create or replace function public.catalogue_enquiry(p_slug text, p jsonb, p_sender text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_co     uuid := public.catalogue_company_of(p_slug);
  v_kind   text := case when p ->> 'kind' = 'quote' then 'quote' else 'enquiry' end;
  v_name   text := left(btrim(regexp_replace(coalesce(p ->> 'name', ''), '[[:cntrl:]]', ' ', 'g')), 120);
  v_org    text := nullif(left(btrim(regexp_replace(coalesce(p ->> 'company', ''), '[[:cntrl:]]', ' ', 'g')), 160), '');
  v_email  text := public.inbox_email_of(nullif(btrim(coalesce(p ->> 'email', '')), ''));
  v_phone  text := public.inbox_phone_of(nullif(btrim(coalesce(p ->> 'phone', '')), ''));
  v_msg    text := nullif(left(btrim(coalesce(p ->> 'message', '')), 2000), '');
  v_lines  jsonb := '[]'::jsonb;
  l        jsonb;
  v_prod   record;
  v_qty    numeric;
  v_party  record;
  v_id     uuid;
  v_conv   uuid;
  v_rfq    uuid;
  v_chan   text;
  v_addr   text;
  v_body   text;
  v_subj   text;
  v_msgid  uuid;
  v_n      integer := 0;
begin
  if v_co is null then
    return jsonb_build_object('status', 'closed');
  end if;
  if p_sender is null or char_length(p_sender) not between 16 and 128 then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.catalogue_hits where created_at < now() - interval '2 days';
  if (select count(*) from public.catalogue_hits where company_id = v_co and sender_hash = p_sender and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.catalogue_hits where company_id = v_co and created_at > now() - interval '1 day') >= 30 then
    return jsonb_build_object('status', 'limited');
  end if;
  insert into public.catalogue_hits (company_id, sender_hash) values (v_co, p_sender);
  begin
    if char_length(v_name) < 2 then
      raise exception 'Enter your name.' using errcode = '22023';
    end if;
    if nullif(btrim(coalesce(p ->> 'email', '')), '') is not null and v_email is null then
      raise exception 'Enter a valid email address.' using errcode = '22023';
    end if;
    if v_phone is not null and length(v_phone) not between 9 and 15 then
      raise exception 'Enter a valid phone number.' using errcode = '22023';
    end if;
    if v_email is null and v_phone is null then
      raise exception 'Enter your email address or phone number so we can answer.' using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(p -> 'lines', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p -> 'lines', '[]'::jsonb)) > 30 then
      raise exception 'Choose at most 30 products.' using errcode = '22023';
    end if;
    for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) loop
      begin
        v_qty := nullif(btrim(coalesce(l ->> 'quantity', '')), '')::numeric;
      exception when others then
        raise exception 'Quantities must be numbers.' using errcode = '22023';
      end;
      if v_qty is null then v_qty := 1; end if;
      if v_qty <= 0 or v_qty > 10000000 then
        raise exception 'Quantities must be more than zero.' using errcode = '22023';
      end if;
      select pr.id, pr.name, pr.sku, pr.unit into v_prod
        from public.products pr join public.catalogue_products cp on cp.product_id = pr.id and cp.public
       where (l ->> 'product_id') ~ '^[0-9a-f-]{36}$' and pr.id = (l ->> 'product_id')::uuid and pr.company_id = v_co and pr.active;
      if v_prod.id is null then
        raise exception 'A product in the request is no longer in the catalogue. Reload the page.' using errcode = '22023';
      end if;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('product_id', v_prod.id, 'name', v_prod.name, 'sku', v_prod.sku,
                                                                 'quantity', v_qty, 'unit', v_prod.unit));
    end loop;
    if v_kind = 'quote' and jsonb_array_length(v_lines) = 0 then
      raise exception 'Add at least one product to the request for quotation.' using errcode = '22023';
    end if;
    if v_kind = 'enquiry' and v_msg is null and jsonb_array_length(v_lines) = 0 then
      raise exception 'Write your question.' using errcode = '22023';
    end if;
  exception when sqlstate '22023' then
    return jsonb_build_object('status', 'invalid', 'error', sqlerrm);
  end;

  -- A known client (by email or phone): the RFQ is made at once.
  select * into v_party from public.inbox_match_party(v_co, case when v_email is not null then 'email' else 'whatsapp' end,
                                                      coalesce(v_email, v_phone));
  if v_party.client_id is null and v_email is not null and v_phone is not null then
    select * into v_party from public.inbox_match_party(v_co, 'whatsapp', v_phone);
  end if;

  insert into public.catalogue_enquiries (company_id, kind, name, company_name, email, phone, message, lines, client_id)
  values (v_co, v_kind, v_name, v_org, v_email, v_phone, v_msg, v_lines, v_party.client_id)
  returning id into v_id;

  -- The Inbox: one conversation with the sender, by email when given, otherwise by WhatsApp.
  v_chan := case when v_email is not null then 'email' else 'whatsapp' end;
  v_addr := coalesce(v_email, v_phone);
  v_subj := case when v_kind = 'quote' then 'Request for quotation from the online catalogue' else 'Enquiry from the online catalogue' end;
  v_body := concat_ws(E'\n',
              v_subj || '.',
              'From: ' || v_name || coalesce(' (' || v_org || ')', ''),
              case when v_email is not null then 'Email: ' || v_email end,
              case when v_phone is not null then 'Phone: +' || v_phone end,
              case when jsonb_array_length(v_lines) > 0 then E'\nProducts:' end,
              (select string_agg('- ' || (x ->> 'name') || coalesce(' (' || nullif(x ->> 'sku', '') || ')', '') || ': '
                                 || rtrim(rtrim(to_char((x ->> 'quantity')::numeric, 'FM999999990.999'), '0'), '.') || ' ' || (x ->> 'unit'), E'\n')
                 from jsonb_array_elements(v_lines) x),
              case when v_msg is not null then E'\nMessage:\n' || v_msg end);
  begin
    insert into public.inbox_conversations (company_id, channel, subject, counterpart_address, counterpart_name, client_id, supplier_id,
                                            message_count, unread_count, preview, last_direction)
    values (v_co, v_chan, v_subj, v_addr, left(v_name || coalesce(' · ' || v_org, ''), 200), v_party.client_id,
            case when v_party.client_id is null then v_party.supplier_id end, 1, 1,
            left(regexp_replace(v_body, '\s+', ' ', 'g'), 200), 'in')
    returning id into v_conv;
    insert into public.inbox_messages (company_id, conversation_id, channel, direction, status, from_address, from_name,
                                       subject, body_text, provider, provider_message_id)
    values (v_co, v_conv, v_chan, 'in', 'received', v_addr, v_name, v_subj, v_body, 'catalogue', v_id::text)
    returning id into v_msgid;
  exception when others then
    raise warning 'Catalogue enquiry % not put in the Inbox: %', v_id, sqlerrm;
    v_conv := null;
  end;

  if v_party.client_id is not null and jsonb_array_length(v_lines) > 0 then
    insert into public.rfqs (company_id, client_id, title, contact_name, received_via, notes)
    values (v_co, v_party.client_id, left(v_subj, 200), left(v_name, 120), 'other',
            left('From the online catalogue.' || coalesce(E'\n' || v_msg, ''), 2000))
    returning id into v_rfq;
    for l in select * from jsonb_array_elements(v_lines) loop
      v_n := v_n + 1;
      insert into public.rfq_lines (company_id, rfq_id, line_no, product_id, description, quantity, unit)
      values (v_co, v_rfq, v_n, (l ->> 'product_id')::uuid, l ->> 'name', (l ->> 'quantity')::numeric, l ->> 'unit');
    end loop;
  end if;
  update public.catalogue_enquiries
     set conversation_id = v_conv, rfq_id = v_rfq, status = case when v_rfq is not null then 'converted' else 'new' end
   where id = v_id;

  begin
    perform public.notify_roles(v_co, public.crm_roles(), null, 'catalogue_enquiry', 'attention',
      case when v_kind = 'quote' then 'Request for quotation: ' else 'Catalogue enquiry: ' end || v_name || coalesce(' (' || v_org || ')', ''),
      case when v_rfq is not null then 'Client RFQ ready to price' when jsonb_array_length(v_lines) > 0
           then jsonb_array_length(v_lines) || ' product(s) · make the client and RFQ' else left(coalesce(v_msg, ''), 160) end,
      '/catalogue/enquiries/' || v_id, 'catalogue-enquiry:' || v_id);
  exception when others then
    raise warning 'Catalogue notification failed: %', sqlerrm;
  end;
  return jsonb_build_object('status', 'received', 'enquiry_id', v_id);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Enquiries in the app (management and sales)
-- ---------------------------------------------------------------------
-- Make the RFQ from an enquiry: for the chosen client, or a new client made from the sender's details.
create or replace function public.catalogue_enquiry_convert(p_enquiry uuid, p_client uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  e       public.catalogue_enquiries;
  v_cl    uuid;
  v_rfq   uuid;
  l       jsonb;
  v_n     integer := 0;
begin
  select * into e from public.catalogue_enquiries where id = p_enquiry for update;
  if e.id is null or not public.has_role(e.company_id, public.crm_roles()) then
    raise exception 'Enquiry not found.' using errcode = '42501';
  end if;
  if e.rfq_id is not null then
    return e.rfq_id;
  end if;
  if p_client is not null then
    if not exists (select 1 from public.clients where id = p_client and company_id = e.company_id) then
      raise exception 'Client not found.' using errcode = '22023';
    end if;
    v_cl := p_client;
  else
    v_cl := e.client_id;
  end if;
  if v_cl is null then
    insert into public.clients (company_id, name, notes)
    values (e.company_id, left(coalesce(e.company_name, e.name), 200), 'Added from an online catalogue enquiry.')
    returning id into v_cl;
    insert into public.client_contacts (company_id, client_id, kind, name, email, phone)
    values (e.company_id, v_cl, 'purchasing', e.name, e.email, case when e.phone is not null then '+' || e.phone end);
  end if;
  insert into public.rfqs (company_id, client_id, title, contact_name, received_via, notes)
  values (e.company_id, v_cl, case when e.kind = 'quote' then 'Request for quotation from the online catalogue'
                                   else 'Enquiry from the online catalogue' end,
          left(e.name, 120), 'other', left('From the online catalogue.' || coalesce(E'\n' || e.message, ''), 2000))
  returning id into v_rfq;
  for l in select * from jsonb_array_elements(e.lines) loop
    v_n := v_n + 1;
    insert into public.rfq_lines (company_id, rfq_id, line_no, product_id, description, quantity, unit)
    values (e.company_id, v_rfq, v_n,
            case when exists (select 1 from public.products where id = (l ->> 'product_id')::uuid and company_id = e.company_id)
                 then (l ->> 'product_id')::uuid end,
            l ->> 'name', (l ->> 'quantity')::numeric, coalesce(l ->> 'unit', 'pcs'));
  end loop;
  update public.catalogue_enquiries
     set client_id = v_cl, rfq_id = v_rfq, status = 'converted', handled_by = auth.uid(), handled_at = now()
   where id = e.id;
  if e.conversation_id is not null then
    update public.inbox_conversations set client_id = v_cl, supplier_id = null
     where id = e.conversation_id and client_id is null;
  end if;
  return v_rfq;
end;
$$;

create or replace function public.catalogue_enquiry_close(p_enquiry uuid, p_closed boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  e public.catalogue_enquiries;
begin
  select * into e from public.catalogue_enquiries where id = p_enquiry for update;
  if e.id is null or not public.has_role(e.company_id, public.crm_roles()) then
    raise exception 'Enquiry not found.' using errcode = '42501';
  end if;
  update public.catalogue_enquiries
     set status = case when p_closed then 'closed' when rfq_id is not null then 'converted' else 'new' end,
         handled_by = auth.uid(), handled_at = now()
   where id = e.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Triggers, row-level security and grants
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['catalogue_settings', 'catalogue_products', 'catalogue_enquiries'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['catalogue_products', 'catalogue_documents', 'catalogue_enquiries'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
  end loop;
  foreach t in array array['catalogue_settings', 'catalogue_products', 'catalogue_documents', 'catalogue_enquiries', 'catalogue_hits'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  foreach t in array array['catalogue_settings', 'catalogue_products', 'catalogue_documents', 'catalogue_enquiries'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end;
$$;

-- Everyone in the team sees what is public (to share the link); management changes it.
drop policy if exists catalogue_settings_select on public.catalogue_settings;
create policy catalogue_settings_select on public.catalogue_settings for select to authenticated using (public.is_member(company_id));
drop policy if exists catalogue_products_select on public.catalogue_products;
create policy catalogue_products_select on public.catalogue_products for select to authenticated using (public.is_member(company_id));
drop policy if exists catalogue_documents_select on public.catalogue_documents;
create policy catalogue_documents_select on public.catalogue_documents for select to authenticated
  using (public.has_role(company_id, public.document_roles()));
-- Enquiries: the people who answer clients.
drop policy if exists catalogue_enquiries_select on public.catalogue_enquiries;
create policy catalogue_enquiries_select on public.catalogue_enquiries for select to authenticated
  using (public.has_role(company_id, public.crm_roles()));
-- catalogue_hits: no policy, nobody but the service role.

revoke execute on function
  public.can_edit_catalogue_file(text), public.add_catalogue_cleanup(), public.catalogue_slug_of(text),
  public.catalogue_save_settings(uuid, jsonb), public.catalogue_set_product(uuid, jsonb), public.catalogue_set_category(uuid, text, boolean),
  public.catalogue_set_photo(uuid, text), public.catalogue_set_document(uuid, boolean), public.catalogue_company_of(text),
  public.catalogue_public(text), public.catalogue_public_document(text, uuid), public.catalogue_enquiry(text, jsonb, text),
  public.catalogue_enquiry_convert(uuid, uuid), public.catalogue_enquiry_close(uuid, boolean)
from public, anon, authenticated;

grant execute on function
  public.can_edit_catalogue_file(text), public.catalogue_slug_of(text), public.catalogue_save_settings(uuid, jsonb),
  public.catalogue_set_product(uuid, jsonb), public.catalogue_set_category(uuid, text, boolean), public.catalogue_set_photo(uuid, text),
  public.catalogue_set_document(uuid, boolean), public.catalogue_enquiry_convert(uuid, uuid), public.catalogue_enquiry_close(uuid, boolean)
to authenticated;

-- Only the public pages (server side, service role key).
grant execute on function
  public.catalogue_public(text), public.catalogue_public_document(text, uuid), public.catalogue_enquiry(text, jsonb, text)
to service_role;

notify pgrst, 'reload schema';
