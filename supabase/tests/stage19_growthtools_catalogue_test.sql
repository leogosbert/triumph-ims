-- Tests for the online product catalogue: settings, what is public, the public page data, enquiries
-- (validation, rate limit, Inbox, RFQ) and converting an enquiry.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon, service_role;
create or replace function tests.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'email', p_email, 'role', 'authenticated')::text, false);
end $$;
create or replace function tests.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAILED: %', p_label; end if;
  raise notice 'pass: %', p_label;
end $$;
create or replace function tests.blocked(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAILED (was allowed): %', p_label;
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'pass: % (blocked: %)', p_label, sqlerrm;
end $$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

insert into auth.users (email) values ('boss.oc@g.test'), ('sales.oc@g.test'), ('wh.oc@g.test'), ('other.oc@g.test');
select id as boss from auth.users where email = 'boss.oc@g.test' \gset
select id as sales from auth.users where email = 'sales.oc@g.test' \gset
select id as wh from auth.users where email = 'wh.oc@g.test' \gset
select id as outsider from auth.users where email = 'other.oc@g.test' \gset

select tests.login('boss.oc@g.test'); set role authenticated;
select public.create_company('Catalogue Supplies Ltd') as co \gset
reset role;
select tests.login('other.oc@g.test'); set role authenticated;
select public.create_company('Other Catalogue Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role) values (:'co', :'sales', 'sales'), (:'co', :'wh', 'warehouse');
update public.companies set phone = '+255 712 000 111', email = 'sales@catalogue.test', address = 'Plot 5, Dar es Salaam' where id = :'co';
insert into public.products (company_id, name, category, selling_price, specification) values
  (:'co', 'Sulphuric acid 98%', 'Chemicals', 450000, '25 L jerrycan') returning id as acid \gset
insert into public.products (company_id, name, category, selling_price) values
  (:'co', 'Gear oil 220', 'Lubricants', 980000) returning id as oil \gset
insert into public.products (company_id, name, category, selling_price) values
  (:'co', 'Secret item', 'Lubricants', 10) returning id as secret \gset
insert into public.product_costs (product_id, company_id, last_cost) values (:'oil', :'co', 700000);
insert into public.products (company_id, name) values (:'other', 'Other product') returning id as oprod \gset
insert into public.clients (company_id, name) values (:'co', 'Mbeya Cement') returning id as client \gset
insert into public.client_contacts (company_id, client_id, name, email) values (:'co', :'client', 'Juma', 'juma@mbeyacement.test');
insert into public.documents (company_id, title, kind, product_id) values (:'co', 'Gear oil 220 data sheet', 'datasheet', :'oil') returning id as tds \gset
insert into storage.objects (bucket_id, name) values ('documents', :'co' || '/' || :'tds' || '/tds.pdf');
update public.documents set file_path = :'co' || '/' || :'tds' || '/tds.pdf', file_name = 'tds.pdf', file_type = 'application/pdf' where id = :'tds';
insert into public.documents (company_id, title, kind, product_id) values (:'co', 'Gear oil contract', 'contract', :'oil') returning id as contract \gset

-- ---- 1. Settings ------------------------------------------------------------------------------------
select tests.check((select default_level = 'small' and route = '/catalogue' from public.features where key = 'online_catalogue'),
  'online catalogue: a small feature');
select tests.check(public.catalogue_slug_of('TRIUMPH General Suppliers Ltd.') = 'triumph-general-suppliers-ltd', 'address from the company name');
select tests.login('sales.oc@g.test'); set role authenticated;
select tests.blocked(format('select public.catalogue_save_settings(%L, %L)', :'co', '{"published": true}'), 'only management sets up the catalogue');
select tests.blocked(format('select public.catalogue_set_product(%L, %L)', :'oil', '{"public": true}'), 'only management chooses the products');
reset role;
select tests.login('boss.oc@g.test'); set role authenticated;
select public.catalogue_save_settings(:'co', '{"published": false, "headline": "Chemicals and lubricants for industry", "whatsapp": "0712 000 111"}') as slug \gset
select tests.check(:'slug' = 'catalogue-supplies-ltd' and (select whatsapp = '255712000111' and not published
                     from public.catalogue_settings where company_id = :'co'), 'a default address and the WhatsApp number with the country code');
select tests.blocked(format('select public.catalogue_save_settings(%L, %L)', :'co', '{"slug": "Bad Slug!"}'), 'address letters are checked');
select tests.blocked(format('select public.catalogue_save_settings(%L, %L)', :'co', '{"slug": "admin"}'), 'reserved addresses are refused');
reset role;
select tests.login('other.oc@g.test'); set role authenticated;
select tests.blocked(format('select public.catalogue_save_settings(%L, %L)', :'other', '{"slug": "catalogue-supplies-ltd"}'),
  'another company cannot take the same address');
reset role;

-- ---- 2. Not published yet: nothing public ---------------------------------------------------------------
set role service_role;
select tests.check(public.catalogue_public('catalogue-supplies-ltd') is null, 'an unpublished catalogue is not shown');
select tests.check((public.catalogue_enquiry('catalogue-supplies-ltd', '{"name": "A"}', repeat('a', 64)) ->> 'status') = 'closed',
  'and takes no enquiries');
reset role;

select tests.login('boss.oc@g.test'); set role authenticated;
select public.catalogue_save_settings(:'co', '{"slug": "catalogue-supplies", "published": true, "show_phone": false, "whatsapp": "255712000111"}') as s2 \gset
select public.catalogue_set_product(:'acid', '{"public": true, "summary": "Technical grade"}');
select public.catalogue_set_product(:'oil', '{"public": true, "show_price": true}');
select tests.check(public.catalogue_set_category(:'co', 'Chemicals', true) = 1, 'a whole category can be shown at once');
select tests.blocked(format('select public.catalogue_set_product(%L, %L)', :'oprod', '{"public": true}'), 'another company''s product is refused');
select public.catalogue_set_document(:'tds', true);
select tests.blocked(format('select public.catalogue_set_document(%L, true)', :'contract'), 'a contract cannot be made public');
select tests.blocked(format('select public.catalogue_set_photo(%L, %L)', :'oil', :'co' || '/' || :'oil' || '/x.jpg'), 'a photo must be uploaded first');
reset role;
insert into storage.objects (bucket_id, name) values ('catalogue', :'co' || '/' || :'oil' || '/photo.jpg');
select tests.login('boss.oc@g.test'); set role authenticated;
select public.catalogue_set_photo(:'oil', :'co' || '/' || :'oil' || '/photo.jpg');
select tests.check(public.can_edit_catalogue_file(:'co' || '/' || :'oil' || '/photo.jpg'), 'management may change photos of its products');
reset role;
select tests.login('sales.oc@g.test'); set role authenticated;
select tests.check(not public.can_edit_catalogue_file(:'co' || '/' || :'oil' || '/photo.jpg'), 'sales may not');
select tests.check((select count(*) from public.catalogue_products where public) = 2, 'the team sees what is public');
reset role;

-- ---- 3. The public page ----------------------------------------------------------------------------------------
set role service_role;
select public.catalogue_public('catalogue-supplies') as pub \gset
reset role;
select tests.check(jsonb_array_length(:'pub'::jsonb -> 'products') = 2, 'only the public products are shown');
select tests.check((select x -> 'price' = 'null'::jsonb from jsonb_array_elements(:'pub'::jsonb -> 'products') x where x ->> 'name' = 'Sulphuric acid 98%')
                   and (select (x ->> 'price')::numeric = 980000 from jsonb_array_elements(:'pub'::jsonb -> 'products') x where x ->> 'name' = 'Gear oil 220'),
  'a price only where the product is switched to show it');
select tests.check(position('700000' in :'pub') = 0 and position('Secret' in :'pub') = 0 and position('stock' in lower(:'pub')) = 0,
  'no costs, hidden products or stock');
select tests.check((:'pub'::jsonb #> '{company,phone}') = 'null'::jsonb and (:'pub'::jsonb #>> '{company,email}') = 'sales@catalogue.test'
                   and (:'pub'::jsonb #>> '{company,whatsapp}') = '255712000111',
  'contact details as chosen (phone hidden)');
select tests.check((select jsonb_array_length(x -> 'documents') = 1 and x ->> 'photo_path' like '%/photo.jpg'
                      from jsonb_array_elements(:'pub'::jsonb -> 'products') x where x ->> 'name' = 'Gear oil 220'),
  'the public data sheet and the photo');
set role service_role;
select tests.check((public.catalogue_public_document('catalogue-supplies', :'tds') ->> 'file_name') = 'tds.pdf', 'a public data sheet can be downloaded');
select tests.check(public.catalogue_public_document('catalogue-supplies', :'contract') is null, 'a private paper cannot');
select tests.check(public.catalogue_public_document('other-slug', :'tds') is null, 'not through another address');
reset role;

-- Only the server (service role) reads the public functions.
select tests.login('sales.oc@g.test'); set role authenticated;
select tests.blocked('select public.catalogue_public(''catalogue-supplies'')', 'the app cannot call the public functions');
reset role;
set role anon;
select tests.blocked('select public.catalogue_enquiry(''catalogue-supplies'', ''{}'', ''x'')', 'visitors cannot call the functions directly');
select tests.blocked('select * from public.catalogue_products', 'visitors cannot read the tables');
reset role;

-- ---- 4. Enquiries ----------------------------------------------------------------------------------------------------
set role service_role;
select tests.check((public.catalogue_enquiry('catalogue-supplies', '{"kind": "quote", "name": "Juma", "email": "bad-address"}', repeat('b', 64)) ->> 'status') = 'invalid',
  'a bad email address is refused');
select tests.check((public.catalogue_enquiry('catalogue-supplies', '{"kind": "quote", "name": "Juma", "email": "juma@mbeyacement.test"}', repeat('b', 64)) ->> 'error')
                   like 'Add at least one product%', 'a request for quotation needs a product');
select tests.check((public.catalogue_enquiry('catalogue-supplies', jsonb_build_object('kind', 'quote', 'name', 'Juma', 'email', 'juma@mbeyacement.test',
                     'lines', jsonb_build_array(jsonb_build_object('product_id', :'secret', 'quantity', 2))), repeat('c', 64)) ->> 'status') = 'invalid',
  'a hidden product cannot be asked for');
select public.catalogue_enquiry('catalogue-supplies', '{"kind": "quote", "name": "Juma"}', repeat('b', 64)) as x \gset
select tests.check((public.catalogue_enquiry('catalogue-supplies', '{"kind": "quote", "name": "Juma"}', repeat('b', 64)) ->> 'status') = 'limited',
  'three tries an hour from the same sender, then limited');
-- A known client: the RFQ is made at once.
select public.catalogue_enquiry('catalogue-supplies', jsonb_build_object('kind', 'quote', 'name', 'Juma', 'company', 'Mbeya Cement',
  'email', 'Juma@MbeyaCement.test', 'message', 'Delivery to Mbeya please',
  'lines', jsonb_build_array(jsonb_build_object('product_id', :'oil', 'quantity', '10'), jsonb_build_object('product_id', :'acid', 'quantity', 4))),
  repeat('d', 64)) as e1 \gset
reset role;
select (:'e1'::jsonb ->> 'enquiry_id') as enq1 \gset
select tests.check((:'e1'::jsonb ->> 'status') = 'received', 'a valid request is received');
select tests.check((select status = 'converted' and client_id = :'client' and rfq_id is not null and conversation_id is not null
                           and jsonb_array_length(lines) = 2 and email = 'juma@mbeyacement.test'
                      from public.catalogue_enquiries where id = :'enq1'), 'a known client: the client RFQ is made at once');
select tests.check((select r.client_id = :'client' and r.status = 'new' and r.received_via = 'other'
                           and (select count(*) from public.rfq_lines l where l.rfq_id = r.id) = 2
                      from public.rfqs r where r.id = (select rfq_id from public.catalogue_enquiries where id = :'enq1')),
  'the RFQ has both products');
select tests.check((select c.channel = 'email' and c.client_id = :'client' and c.unread_count = 1
                           and (select m.body_text like '%Gear oil 220%: 10 pcs%' and m.provider = 'catalogue'
                                  from public.inbox_messages m where m.conversation_id = c.id)
                      from public.inbox_conversations c where c.id = (select conversation_id from public.catalogue_enquiries where id = :'enq1')),
  'it lands in the Inbox, linked to the client');
select tests.check((select count(*) from public.notifications where kind = 'catalogue_enquiry' and company_id = :'co') = 2
                   and (select count(*) from public.notifications where kind = 'catalogue_enquiry' and user_id = :'wh') = 0,
  'management and sales are told');

-- Someone new, by phone only.
set role service_role;
select public.catalogue_enquiry('catalogue-supplies', jsonb_build_object('kind', 'quote', 'name', 'Neema', 'company', 'Tanga Mining',
  'phone', '0754 111 222', 'lines', jsonb_build_array(jsonb_build_object('product_id', :'acid', 'quantity', 20))), repeat('e', 64)) as e2 \gset
reset role;
select (:'e2'::jsonb ->> 'enquiry_id') as enq2 \gset
select tests.check((select status = 'new' and client_id is null and rfq_id is null and phone = '255754111222'
                      from public.catalogue_enquiries where id = :'enq2'), 'someone new: kept as a draft');
select tests.check((select channel = 'whatsapp' and counterpart_address = '255754111222' from public.inbox_conversations
                     where id = (select conversation_id from public.catalogue_enquiries where id = :'enq2')),
  'phone only: the conversation is on WhatsApp');

select tests.login('wh.oc@g.test'); set role authenticated;
select tests.check((select count(*) from public.catalogue_enquiries) = 0, 'warehouse does not see enquiries');
select tests.blocked(format('select public.catalogue_enquiry_convert(%L, null)', :'enq2'), 'warehouse cannot convert');
reset role;
select tests.login('sales.oc@g.test'); set role authenticated;
select public.catalogue_enquiry_convert(:'enq2', null) as rfq2 \gset
select tests.check((select c.name = 'Tanga Mining' and (select cc.phone = '+255754111222' from public.client_contacts cc where cc.client_id = c.id)
                      from public.clients c where c.id = (select client_id from public.rfqs where id = :'rfq2')),
  'Make client and RFQ: the client with the contact, and the RFQ');
select tests.check((select status = 'converted' and handled_by = :'sales' from public.catalogue_enquiries where id = :'enq2'), 'the enquiry is converted');
select tests.check(public.catalogue_enquiry_convert(:'enq2', null) = :'rfq2'::uuid, 'a second tap opens the same RFQ');
select public.catalogue_enquiry_close(:'enq2', true);
select tests.check((select status from public.catalogue_enquiries where id = :'enq2') = 'closed', 'closed');
select tests.blocked('select count(*) from public.catalogue_hits', 'nobody in the app reads the rate-limit rows');
reset role;

-- Switched off or unpublished: the page closes.
select tests.login('boss.oc@g.test'); set role authenticated;
select public.set_company_feature(:'co', 'online_catalogue', false);
reset role;
set role service_role;
select tests.check(public.catalogue_public('catalogue-supplies') is null, 'feature switched off: the page is closed');
reset role;
select tests.login('boss.oc@g.test'); set role authenticated;
select public.set_company_feature(:'co', 'online_catalogue', true);
reset role;
