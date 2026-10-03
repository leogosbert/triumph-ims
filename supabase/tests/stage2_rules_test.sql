-- Tests for the Stage 2 (master data) rules.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated;
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
grant execute on all functions in schema tests to authenticated;

insert into auth.users (email, raw_user_meta_data) values
  ('m2@acme.test', '{"full_name":"Mia Manager"}'),
  ('s2@acme.test', '{"full_name":"Sam Sales"}'),
  ('p2@acme.test', '{"full_name":"Pat Procurement"}'),
  ('f2@acme.test', '{"full_name":"Fay Finance"}'),
  ('d2@acme.test', '{"full_name":"Dan Driver"}'),
  ('x2@other.test', '{"full_name":"Xena Outsider"}');

-- ---- Set up a company with one person per role ----------------------
select tests.login('m2@acme.test');
set role authenticated;
select public.create_company('Acme Supplies') as cid \gset
select public.invite_member(:'cid', 's2@acme.test', 'sales');
select public.invite_member(:'cid', 'p2@acme.test', 'procurement');
select public.invite_member(:'cid', 'f2@acme.test', 'finance');
select public.invite_member(:'cid', 'd2@acme.test', 'driver');
reset role;
select tests.login('s2@acme.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('p2@acme.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('f2@acme.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('d2@acme.test'); set role authenticated; select public.accept_invitation((select id from public.my_invitations())); reset role;
select tests.login('x2@other.test'); set role authenticated; select public.create_company('Other Co') as other \gset
insert into public.suppliers (company_id, name) values (:'other', 'Other Supplier') returning id as other_supplier \gset
reset role;

-- ---- Clients ----------------------------------------------------------
select tests.login('m2@acme.test'); set role authenticated;
insert into public.clients (company_id, name, industry) values (:'cid', 'Geita Gold Mine', 'Mining') returning id as client1 \gset
insert into public.clients (company_id, code, name) values (:'cid', 'C-0002', 'Imported Code Ltd');
insert into public.clients (company_id, name) values (:'cid', 'Third Client');
select tests.check((select code from public.clients where id = :'client1') = 'C-0001', 'first client gets code C-0001');
select tests.check((select code from public.clients where name = 'Third Client') = 'C-0003', 'automatic code skips a code already used');
select tests.blocked(format('insert into public.clients (company_id, code, name) values (%L, %L, %L)', :'cid', 'C-0001', 'Dup'), 'client codes are unique');
select public.create_company('Mia Second Co') as cid2 \gset
select tests.blocked(format('update public.clients set company_id = %L where id = %L', :'cid2', :'client1'), 'a record cannot move to another company');
reset role;

select tests.login('s2@acme.test'); set role authenticated;
insert into public.clients (company_id, name) values (:'cid', 'Sales Added Client');
select tests.check(true, 'sales can add a client');
select tests.blocked(format('insert into public.clients (company_id, name, credit_limit) values (%L, %L, 1000)', :'cid', 'Credit Try'), 'sales cannot set a credit limit on a new client');
select tests.blocked(format('update public.clients set credit_limit = 5000 where id = %L', :'client1'), 'sales cannot change a credit limit');
insert into public.client_contacts (company_id, client_id, kind, name, email) values (:'cid', :'client1', 'purchasing', 'Jane Buyer', 'jane@ggm.test');
select tests.check((select count(*) from public.client_contacts where client_id = :'client1') = 1, 'sales can add a client contact');
select tests.blocked(format('insert into public.client_contacts (company_id, client_id, kind) values (%L, %L, %L)', :'cid', :'client1', 'other'), 'a contact needs a name, email or phone');
reset role;

select tests.login('f2@acme.test'); set role authenticated;
update public.clients set credit_limit = 100000000 where id = :'client1';
select tests.check((select credit_limit from public.clients where id = :'client1') = 100000000, 'finance can set a credit limit');
reset role;

select tests.login('d2@acme.test'); set role authenticated;
select tests.check((select count(*) from public.clients) = 4, 'driver can see clients (for deliveries)');
select tests.blocked(format('insert into public.clients (company_id, name) values (%L, %L)', :'cid', 'Driver Client'), 'driver cannot add clients');
update public.clients set name = 'Renamed by driver' where id = :'client1';
reset role;
select tests.check((select name from public.clients where id = :'client1') = 'Geita Gold Mine', 'driver cannot edit clients');

-- ---- Suppliers --------------------------------------------------------
select tests.login('p2@acme.test'); set role authenticated;
insert into public.suppliers (company_id, name, country) values (:'cid', 'Lubes Tanzania Ltd', 'Tanzania') returning id as sup1 \gset
select tests.check((select code from public.suppliers where id = :'sup1') = 'S-0001', 'first supplier gets code S-0001');
reset role;

select tests.login('s2@acme.test'); set role authenticated;
select tests.check((select count(*) from public.suppliers) = 0, 'sales cannot see suppliers');
select tests.blocked(format('insert into public.suppliers (company_id, name) values (%L, %L)', :'cid', 'Sales Supplier'), 'sales cannot add suppliers');
reset role;

select tests.login('f2@acme.test'); set role authenticated;
select tests.check((select count(*) from public.suppliers) = 1, 'finance can see suppliers');
select tests.blocked(format('insert into public.suppliers (company_id, name) values (%L, %L)', :'cid', 'Fin Supplier'), 'finance cannot add suppliers');
reset role;

-- ---- Products and costs -----------------------------------------------
select tests.login('s2@acme.test'); set role authenticated;
insert into public.products (company_id, name, unit, selling_price) values (:'cid', 'Hydraulic oil VG68', 'drum', 1890000) returning id as prod1 \gset
select tests.check((select sku from public.products where id = :'prod1') = 'P-00001', 'first product gets SKU P-00001');
select tests.blocked(format('insert into public.product_costs (product_id, company_id, last_cost) values (%L, %L, 1)', :'prod1', :'cid'), 'sales cannot set product costs');
reset role;

select tests.login('p2@acme.test'); set role authenticated;
insert into public.product_costs (product_id, company_id, main_supplier_id, last_cost) values (:'prod1', :'cid', :'sup1', 1540000);
select tests.check((select last_cost from public.product_costs where product_id = :'prod1') = 1540000, 'procurement can set product cost');
select tests.blocked(format('update public.product_costs set main_supplier_id = %L where product_id = %L', :'other_supplier', :'prod1'), 'cannot link another company''s supplier');
reset role;

select tests.login('s2@acme.test'); set role authenticated;
select tests.check((select count(*) from public.product_costs) = 0, 'sales cannot see costs');
select tests.check((select count(*) from public.products) = 1, 'sales can see products');
reset role;
select tests.login('d2@acme.test'); set role authenticated;
select tests.check((select count(*) from public.product_costs) = 0, 'driver cannot see costs');
select tests.blocked(format('insert into public.products (company_id, name) values (%L, %L)', :'cid', 'Driver Product'), 'driver cannot add products');
reset role;

select tests.login('x2@other.test'); set role authenticated;
select tests.check((select count(*) from public.clients) = 0, 'outsider sees no clients');
select tests.check((select count(*) from public.products) = 0, 'outsider sees no products');
select tests.blocked(format('insert into public.clients (company_id, name) values (%L, %L)', :'cid', 'Sneaky'), 'outsider cannot add clients to another company');
reset role;

-- ---- Import ---------------------------------------------------------------
select tests.login('s2@acme.test'); set role authenticated;
select tests.blocked(format('select public.import_master_data(%L, ''[]'', ''[]'', ''[]'')', :'cid'), 'only management can import');
reset role;

select tests.login('m2@acme.test'); set role authenticated;
select public.import_master_data(:'cid',
  '[{"code":"S-0100","name":"Bearings Direct","country":"South Africa","currency":"ZAR","lead_time_days":21,"bank_details_received":true}]',
  '[{"code":"C-0100","name":"Mbeya Cement","industry":"Cement","credit_limit":50000000,
     "contacts":[{"kind":"purchasing","name":"Buyer One","email":"b1@mc.test"},{"kind":"finance","name":"","email":"","phone":""}]}]',
  '[{"sku":"BRG-6312","name":"Bearing 6312","unit":"pcs","selling_price":95000,"last_cost":61000,"main_supplier":"bearings direct"},
    {"sku":"FLT-001","name":"Oil filter","unit":"pcs","main_supplier":"Nobody Ltd"}]') as r1 \gset
select tests.check((:'r1'::jsonb ->> 'suppliers_added')::int = 1 and (:'r1'::jsonb ->> 'clients_added')::int = 1
                   and (:'r1'::jsonb ->> 'products_added')::int = 2, 'import adds suppliers, clients and products');
select tests.check(:'r1'::jsonb -> 'unmatched_suppliers' = '["Nobody Ltd"]'::jsonb, 'import reports suppliers it could not match');
select tests.check((select s.name from public.product_costs pc join public.suppliers s on s.id = pc.main_supplier_id
                    join public.products p on p.id = pc.product_id where p.sku = 'BRG-6312') = 'Bearings Direct',
                   'import links product to supplier by name');
select tests.check((select count(*) from public.client_contacts cc join public.clients c on c.id = cc.client_id where c.code = 'C-0100') = 1,
                   'import adds contacts and skips empty ones');
select public.import_master_data(:'cid', '[]',
  '[{"code":"C-0100","name":"Mbeya Cement Ltd","contacts":[{"kind":"purchasing","name":"Buyer Two"}]}]',
  '[{"sku":"BRG-6312","name":"Bearing 6312 C3","unit":"pcs","selling_price":99000}]') as r2 \gset
select tests.check((:'r2'::jsonb ->> 'clients_updated')::int = 1 and (:'r2'::jsonb ->> 'products_updated')::int = 1, 're-import updates instead of duplicating');
select tests.check((select cc.name from public.client_contacts cc join public.clients c on c.id = cc.client_id where c.code = 'C-0100') = 'Buyer Two', 're-import updates the contact');
select tests.check((select last_cost from public.product_costs pc join public.products p on p.id = pc.product_id where p.sku = 'BRG-6312') = 61000, 're-import without a cost keeps the old cost');
select tests.blocked(format('select public.import_master_data(%L, ''[]'', %L, ''[]'')', :'cid', '[{"code":"C-0200","name":"Bad","currency":"tsh"}]'), 'import is all-or-nothing on bad data');
select tests.check((select count(*) from public.clients where code = 'C-0200') = 0, 'nothing saved from a failed import');
select tests.check((select count(*) from public.audit_log where entity = 'clients') >= 5, 'client changes are in the activity log');
reset role;

\echo 'ALL STAGE 2 TESTS PASSED'
