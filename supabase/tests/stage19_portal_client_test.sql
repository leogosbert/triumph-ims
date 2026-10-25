-- Tests for the client portal: invitations, sign-in (link and code, rate limits, expiry),
-- quotations accepted or declined online, orders and deliveries, invoices, statements,
-- shared documents, messages into the Inbox, and removing access.
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

insert into auth.users (email) values ('boss.pc@p.test'), ('sales.pc@p.test'), ('fin.pc@p.test'), ('driver.pc@p.test'), ('other.pc@p.test');
insert into public.profiles (id, email, full_name)
select id, email, split_part(email, '@', 1) from auth.users where email like '%.pc@p.test'
on conflict (id) do update set email = excluded.email;
select id as boss from auth.users where email = 'boss.pc@p.test' \gset
select id as sales from auth.users where email = 'sales.pc@p.test' \gset
select id as fin from auth.users where email = 'fin.pc@p.test' \gset
select id as driver from auth.users where email = 'driver.pc@p.test' \gset

select tests.login('boss.pc@p.test'); set role authenticated;
select public.create_company('Portal Client Co') as co \gset
reset role;
select tests.login('other.pc@p.test'); set role authenticated;
select public.create_company('Other Portal Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
values (:'co', :'sales', 'sales'), (:'co', :'fin', 'finance'), (:'co', :'driver', 'driver');
insert into public.clients (company_id, name) values (:'co', 'Acme Mining') returning id as acme \gset
insert into public.clients (company_id, name) values (:'co', 'Beta Cement') returning id as beta \gset
insert into public.clients (company_id, name) values (:'other', 'Elsewhere Ltd') returning id as elsewhere \gset
insert into public.client_contacts (company_id, client_id, name, position, email)
values (:'co', :'acme', 'Asha Buyer', 'Procurement officer', 'asha@acme.test') returning id as asha_contact \gset
insert into public.warehouses (company_id, code, name) values (:'co', 'PC1', 'Portal store') returning id as store \gset

-- ---- 1. Invitations ------------------------------------------------------------------------
select tests.check(public.feature_on(:'co', 'client_portal') and public.feature_on(:'co', 'supplier_portal'),
  'a medium company has both portals switched on by default');
select tests.check((select default_level::text from public.features where key = 'client_portal') = 'medium'
                   and (select default_level::text from public.features where key = 'supplier_portal') = 'medium',
  'both portals belong to the medium level');

select tests.login('sales.pc@p.test'); set role authenticated;
select tests.blocked(format('select public.portal_invite(%L, %L, %L, %L, %L, null, null, null)', :'co', 'client', :'acme', 'asha@acme.test', 'Asha'),
  'sales cannot invite to the portal');
reset role;
select tests.login('boss.pc@p.test'); set role authenticated;
select tests.blocked(format('select public.portal_invite(%L, %L, %L, %L, %L, null, null, null)', :'co', 'client', :'elsewhere', 'x@else.test', 'X'),
  'a client of another company cannot be invited');
select tests.blocked(format('select public.portal_invite(%L, %L, %L, %L, %L, null, null, null)', :'co', 'client', :'acme', 'not-an-email', 'Asha'),
  'a wrong email is refused');
select tests.blocked(format('select public.portal_invite(%L, %L, %L, %L, %L, null, null, null)', :'co', 'client', :'acme', 'SALES.pc@p.test', 'Sam'),
  'a team member cannot be a portal contact');
select public.portal_invite(:'co', 'client', :'acme', '  Asha@Acme.TEST ', 'Asha Buyer', 'Procurement officer', '0754 000 111', :'asha_contact') as asha \gset
select public.portal_invite(:'co', 'client', :'beta', 'ben@beta.test', 'Ben Beta', 'Stores', null, null) as ben \gset
select tests.check(public.portal_invite(:'co', 'client', :'acme', 'asha@acme.test', 'Asha B.', 'Buyer', null, null) = :'asha',
  'inviting the same person again keeps one portal account');
reset role;
select tests.check((select email from public.portal_users where id = :'asha') = 'asha@acme.test', 'email kept in lower case');
select tests.check((select count(*) from public.audit_log where company_id = :'co' and entity = 'portal_users' and action = 'insert') = 2,
  'invitations are in the Activity log');

-- Only the portal server may call the portal functions.
set role anon;
select tests.blocked($$select public.portal_request_login('asha@acme.test', '1.1.1.1')$$, 'visitors cannot ask for a sign-in code directly');
reset role;
select tests.login('sales.pc@p.test'); set role authenticated;
select tests.blocked($$select public.portal_request_login('asha@acme.test', '1.1.1.1')$$, 'app users cannot ask for a portal sign-in code');
select tests.blocked($$select public.portal_verify_login('asha@acme.test', '123456', null, '1.1.1.1', 'x')$$, 'app users cannot verify portal codes');
select tests.blocked('select count(*) from public.portal_sessions', 'app users cannot read portal sessions');
select tests.blocked('select count(*) from public.portal_login_codes', 'app users cannot read portal sign-in codes');
reset role;

-- ---- 2. Signing in ---------------------------------------------------------------------------
set role service_role;
select tests.check(public.portal_request_login('nobody@acme.test', '10.0.0.1') ->> 'status' = 'none', 'unknown email: nothing is sent');
select tests.check(public.portal_request_login('rubbish', '10.0.0.1') ->> 'status' = 'invalid', 'not an email');
select public.portal_request_login('ASHA@acme.test', '10.0.0.1') as req \gset
select tests.check((:'req'::jsonb ->> 'status') = 'sent' and (:'req'::jsonb ->> 'token') ~ '^[0-9a-f]{64}$'
                   and (:'req'::jsonb ->> 'code') ~ '^[0-9]{6}$' and (:'req'::jsonb -> 'companies') = '["Portal Client Co"]'::jsonb,
  'known email: a 64-character link token and a 6-digit code');
select tests.check(not exists (select 1 from public.portal_login_codes where token_hash = :'req'::jsonb ->> 'token'
                                                                  or code_hash = :'req'::jsonb ->> 'code'),
  'only hashes of the token and the code are kept');
select tests.check(public.portal_verify_login('asha@acme.test', case when (:'req'::jsonb ->> 'code') = '000000' then '111111' else '000000' end,
                                              null, '10.0.0.1', 'test') ->> 'status' = 'bad', 'a wrong code is refused');
select tests.check((select attempts from public.portal_login_codes where email = 'asha@acme.test' order by created_at desc limit 1) = 1,
  'the wrong try is counted');
select public.portal_verify_login(' asha@acme.test ', :'req'::jsonb ->> 'code', null, '10.0.0.1', 'Phone browser') as v \gset
select tests.check((:'v'::jsonb ->> 'status') = 'ok' and (:'v'::jsonb ->> 'session') ~ '^[0-9a-f]{64}$', 'the right code signs in');
select :'v'::jsonb ->> 'session' as s_asha \gset
select tests.check(public.portal_verify_login('asha@acme.test', :'req'::jsonb ->> 'code', null, '10.0.0.1', 'x') ->> 'status' = 'bad',
  'a code works only once');
select tests.check(public.portal_verify_login(null, null, :'req'::jsonb ->> 'token', '10.0.0.1', 'x') ->> 'status' = 'bad',
  'the link of a used code does not work either');
select public.portal_request_login('asha@acme.test', '10.0.0.1') as req2 \gset
select tests.check(public.portal_verify_login(null, null, :'req2'::jsonb ->> 'token', '10.0.0.2', 'Laptop') ->> 'status' = 'ok',
  'the email link signs in');
select tests.check(public.portal_verify_login(null, null, :'req2'::jsonb ->> 'token', '10.0.0.2', 'Laptop') ->> 'status' = 'bad',
  'an email link works only once');
select tests.check(public.portal_verify_login(null, null, repeat('a', 64), '10.0.0.2', 'x') ->> 'status' = 'bad', 'a made-up link is refused');
select tests.check((select count(*) from public.audit_log where company_id = :'co' and action = 'portal_sign_in' and entity_id = :'asha') = 2,
  'each sign-in is in the Activity log');
-- Five requests in 15 minutes per email (two used above, plus three).
select public.portal_request_login('asha@acme.test', '10.0.0.3');
select public.portal_request_login('asha@acme.test', '10.0.0.3');
select public.portal_request_login('asha@acme.test', '10.0.0.3');
select tests.check(public.portal_request_login('asha@acme.test', '10.0.0.3') ->> 'status' = 'limited', 'the sixth request in 15 minutes waits');
-- Guessing codes: after 5 wrong tries a code is dead, and the email is locked after 10.
select public.portal_request_login('ben@beta.test', '10.0.0.4') as reqb \gset
do $$
declare i integer;
begin
  for i in 1..5 loop
    perform public.portal_verify_login('ben@beta.test', lpad(i::text, 6, '9'), null, '10.0.0.4', 'x');
  end loop;
end $$;
select tests.check(public.portal_verify_login('ben@beta.test', :'reqb'::jsonb ->> 'code', null, '10.0.0.4', 'x') ->> 'status' = 'bad',
  'after 5 wrong tries even the right code is refused');
do $$
declare i integer;
begin
  for i in 1..5 loop
    perform public.portal_verify_login('ben@beta.test', lpad(i::text, 6, '8'), null, '10.0.0.4', 'x');
  end loop;
end $$;
select tests.check(public.portal_verify_login('ben@beta.test', '123456', null, '10.0.0.5', 'x') ->> 'status' = 'limited',
  'ten wrong tries lock the email for 15 minutes');
delete from public.portal_rate_hits where bucket like 'verify_fail%';
select public.portal_request_login('ben@beta.test', '10.0.0.6') as reqb \gset
select public.portal_verify_login(null, null, :'reqb'::jsonb ->> 'token', '10.0.0.6', 'x') ->> 'session' as s_ben \gset

-- The session and its accounts.
select tests.check(jsonb_array_length(public.portal_accounts(:'s_asha')) = 1
                   and (public.portal_accounts(:'s_asha') -> 0 ->> 'id') = :'asha'
                   and (public.portal_accounts(:'s_asha') -> 0 ->> 'party_name') = 'Acme Mining',
  'Asha''s session lists her one portal account');
select public.portal_me(:'s_asha', :'asha') as me \gset
select tests.check((:'me'::jsonb #>> '{company,name}') = 'Portal Client Co' and (:'me'::jsonb #>> '{account,party}') = 'client'
                   and (:'me'::jsonb #>> '{company,primary_color}') ~ '^#',
  'the portal frame shows our company (with its colours) and the client');
select tests.blocked(format('select public.portal_me(%L, %L)', :'s_asha', :'ben'), 'Asha cannot open Ben''s account');
select tests.blocked(format('select public.portal_me(%L, %L)', repeat('b', 64), :'asha'), 'a made-up session is refused');
select tests.blocked(format('select public.portal_me(%L, %L)', 'short', :'asha'), 'a malformed session is refused');
reset role;

-- ---- 3. Quotations ----------------------------------------------------------------------------
insert into public.quotations (company_id, client_id, created_by, valid_until) values (:'co', :'acme', :'sales', current_date + 30) returning id as q1 \gset
insert into public.quotation_lines (company_id, quotation_id, description, quantity, unit, unit_price) values (:'co', :'q1', 'Drill bits', 10, 'pcs', 150000);
insert into public.quotations (company_id, client_id, created_by) values (:'co', :'acme', :'sales') returning id as q_draft \gset
insert into public.quotations (company_id, client_id, created_by) values (:'co', :'acme', :'sales') returning id as q_decline \gset
insert into public.quotations (company_id, client_id, created_by, valid_until) values (:'co', :'acme', :'sales', current_date - 1) returning id as q_old \gset
insert into public.quotations (company_id, client_id, created_by) values (:'co', :'beta', :'sales') returning id as q_beta \gset
select set_config('ims.status_change', 'on', false) as x \gset
update public.quotations set status = 'sent', sent_at = now() where id in (:'q1', :'q_decline', :'q_old', :'q_beta');
select set_config('ims.status_change', '', false) as x \gset

set role service_role;
select public.portal_quotations(:'s_asha', :'asha') as ql \gset
select tests.check(jsonb_array_length(:'ql'::jsonb) = 3
                   and not exists (select 1 from jsonb_array_elements(:'ql'::jsonb) e where e ->> 'id' in (:'q_draft', :'q_beta')),
  'Asha sees her sent quotations only (not drafts, not Beta''s)');
select tests.check((select (e ->> 'expired')::boolean from jsonb_array_elements(:'ql'::jsonb) e where e ->> 'id' = :'q_old'),
  'an out-of-date quotation is marked expired');
select tests.blocked(format('select public.portal_quotation(%L, %L, %L)', :'s_asha', :'asha', :'q_draft'), 'a draft quotation cannot be opened');
select tests.blocked(format('select public.portal_quotation(%L, %L, %L)', :'s_asha', :'asha', :'q_beta'), 'another client''s quotation cannot be opened');
select tests.check((public.portal_quotation(:'s_asha', :'asha', :'q1') ->> 'can_decide')::boolean
                   and jsonb_array_length(public.portal_quotation(:'s_asha', :'asha', :'q1') -> 'lines') = 1,
  'the quotation opens with its lines and can be answered');
select tests.blocked(format('select public.portal_decide_quotation(%L, %L, %L, %L)', :'s_asha', :'asha', :'q1',
                            '{"decision":"accept","name":"Asha Buyer","position":"Procurement officer"}'),
  'accepting needs a signature');
select tests.blocked(format('select public.portal_decide_quotation(%L, %L, %L, %L)', :'s_asha', :'asha', :'q1',
                            '{"decision":"accept","name":"Asha Buyer","signature_kind":"typed","signature_text":"Asha Buyer"}'),
  'accepting needs the position');
select tests.blocked(format('select public.portal_decide_quotation(%L, %L, %L, %L)', :'s_asha', :'asha', :'q1',
                            '{"decision":"accept","name":"Asha Buyer","position":"PO","signature_kind":"drawn","signature_image":"data:text/html;base64,PHNjcmlwdD4="}'),
  'a drawn signature must be a PNG image');
select tests.blocked(format('select public.portal_decide_quotation(%L, %L, %L, %L)', :'s_ben', :'ben', :'q1',
                            '{"decision":"accept","name":"Ben","position":"Stores","signature_kind":"typed","signature_text":"Ben"}'),
  'Ben cannot accept Acme''s quotation');
select tests.blocked(format('select public.portal_decide_quotation(%L, %L, %L, %L)', :'s_asha', :'asha', :'q_old',
                            '{"decision":"accept","name":"Asha Buyer","position":"PO","signature_kind":"typed","signature_text":"Asha Buyer"}'),
  'an expired quotation cannot be accepted');
select public.portal_decide_quotation(:'s_asha', :'asha', :'q1',
  '{"decision":"accept","name":"Asha Buyer","position":"Procurement officer","signature_kind":"drawn","signature_image":"data:image/png;base64,iVBORw0KGgo=","po_ref":"ACME-PO-77","ip":"10.0.0.1","agent":"Phone"}') as d1 \gset
reset role;
select tests.check((select status from public.quotations where id = :'q1') = 'accepted'
                   and (select outcome_reason from public.quotations where id = :'q1') like 'Accepted online by Asha Buyer (Procurement officer)%'
                   and (select client_ref from public.quotations where id = :'q1') = 'ACME-PO-77',
  'accepting moves the quotation to accepted, with who signed and their order reference');
select tests.check((select decision = 'accepted' and signature_kind = 'drawn' and signed_ip = '10.0.0.1' from public.portal_quote_decisions where id = :'d1'),
  'the signature and where it was signed are kept');
select tests.check(exists (select 1 from public.notifications where company_id = :'co' and user_id = :'sales' and title like 'Quotation%accepted online'),
  'sales is told at once');
select tests.check(exists (select 1 from public.audit_log where company_id = :'co' and action = 'portal_quotation_accepted' and entity_id = :'q1'),
  'the acceptance is in the Activity log');
set role service_role;
select tests.blocked(format('select public.portal_decide_quotation(%L, %L, %L, %L)', :'s_asha', :'asha', :'q1',
                            '{"decision":"decline","name":"Asha Buyer"}'),
  'an answered quotation cannot be answered again');
select public.portal_decide_quotation(:'s_asha', :'asha', :'q_decline', '{"decision":"decline","name":"Asha Buyer","reason":"Price too high"}');
reset role;
select tests.check((select status from public.quotations where id = :'q_decline') = 'rejected'
                   and (select outcome_reason from public.quotations where id = :'q_decline') = 'Declined online by Asha Buyer: Price too high',
  'declining moves the quotation to rejected with the reason');

-- The app's own status button still works for the team (and only for sales/management).
insert into public.quotations (company_id, client_id, created_by) values (:'co', :'beta', :'sales') returning id as q_app \gset
select set_config('ims.status_change', 'on', false) as x \gset
update public.quotations set status = 'sent' where id = :'q_app';
select set_config('ims.status_change', '', false) as x \gset
select tests.login('driver.pc@p.test'); set role authenticated;
select tests.blocked(format('select public.record_quotation_outcome(%L, true, null)', :'q_app'), 'drivers still cannot record a quotation outcome');
select tests.blocked(format('select public.apply_quotation_outcome(%L, true, null)', :'q_app'), 'nobody calls the internal outcome function directly');
reset role;
select tests.login('sales.pc@p.test'); set role authenticated;
select public.record_quotation_outcome(:'q_app', true, 'PO by phone');
reset role;
select tests.check((select status from public.quotations where id = :'q_app') = 'accepted', 'sales still records outcomes in the app');

-- ---- 4. Orders and deliveries -----------------------------------------------------------------
insert into public.deliveries (company_id, number, client_id, quotation_id, warehouse_id, driver_id, status, created_by, received_by_name, signature_path)
values (:'co', 'DN-PC-1', :'acme', :'q1', :'store', :'driver', 'dispatched', :'sales', null, null) returning id as dn1 \gset
insert into public.deliveries (company_id, number, client_id, quotation_id, warehouse_id, status, created_by)
values (:'co', 'DN-PC-2', :'acme', :'q1', :'store', 'draft', :'sales') returning id as dn_draft \gset
insert into public.deliveries (company_id, number, client_id, warehouse_id, status, created_by)
values (:'co', 'DN-PC-3', :'beta', :'store', 'dispatched', :'sales') returning id as dn_beta \gset
set role service_role;
select public.portal_orders(:'s_asha', :'asha') as o \gset
select tests.check(jsonb_array_length(:'o'::jsonb -> 'orders') = 1 and (:'o'::jsonb #>> '{orders,0,id}') = :'q1'
                   and (:'o'::jsonb #>> '{orders,0,progress,status}') = 'in_progress',
  'the accepted quotation is an order with its progress');
select tests.check(not exists (select 1 from jsonb_array_elements(:'o'::jsonb #> '{orders,0,progress,stages}') e where e ->> 'owner' is not null),
  'the portal never shows who in our team is responsible');
select tests.check(jsonb_array_length(:'o'::jsonb -> 'deliveries') = 1 and (:'o'::jsonb #>> '{deliveries,0,id}') = :'dn1',
  'deliveries on the way are shown; drafts and other clients'' are not');
select tests.check(jsonb_array_length(public.portal_order(:'s_asha', :'asha', :'q1') -> 'deliveries') = 1, 'the order lists its delivery');
select tests.blocked(format('select public.portal_order(%L, %L, %L)', :'s_ben', :'ben', :'q1'), 'Ben cannot open Acme''s order');
select tests.check(jsonb_array_length(public.portal_order(:'s_asha', :'asha', :'q1') #> '{progress,stages}') > 0
                   and public.portal_order(:'s_asha', :'asha', :'q1')::text !~ '"(owner|owner_id|assigned|can_assign)"',
  'the order shows its stages but not the names of our team');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_asha', :'asha', 'delivery', :'dn_beta'), 'Asha cannot download Beta''s delivery note');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_asha', :'asha', 'pod_signature', :'dn1'), 'no proof of delivery before delivery');
reset role;
select set_config('ims.status_change', 'on', false) as x \gset
update public.deliveries set status = 'delivered', delivered_at = now(), received_by_name = 'Juma Stores', signature_path = :'co' || '/' || :'dn1' || '/sig.png' where id = :'dn1';
select set_config('ims.status_change', '', false) as x \gset
set role service_role;
select tests.check((public.portal_order(:'s_asha', :'asha', :'q1') #>> '{deliveries,0,received_by_name}') = 'Juma Stores'
                   and (public.portal_order(:'s_asha', :'asha', :'q1') #>> '{deliveries,0,has_signature}')::boolean,
  'after delivery: who received it and the signature');
select tests.check((public.portal_open(:'s_asha', :'asha', 'pod_signature', :'dn1', '10.0.0.1') ->> 'bucket') = 'pod', 'the proof of delivery can be opened');
reset role;

-- ---- 5. Invoices and statements -------------------------------------------------------------
insert into public.invoices (company_id, client_id, quotation_id, status, created_by) values (:'co', :'acme', :'q1', 'draft', :'fin') returning id as inv1 \gset
insert into public.invoices (company_id, client_id, status, created_by) values (:'co', :'acme', 'draft', :'fin') returning id as inv_draft \gset
insert into public.invoices (company_id, client_id, status, created_by) values (:'co', :'beta', 'draft', :'fin') returning id as inv_beta \gset
select set_config('ims.status_change', 'on', false) as x \gset
update public.invoices set status = 'issued', number = 'INV-PC-1', issue_date = current_date, due_date = current_date + 30 where id = :'inv1';
update public.invoices set status = 'issued', number = 'INV-PC-2', issue_date = current_date where id = :'inv_beta';
select set_config('ims.status_change', '', false) as x \gset
set role service_role;
select public.portal_invoices(:'s_asha', :'asha') as inv \gset
select tests.check(jsonb_array_length(:'inv'::jsonb -> 'invoices') = 1 and (:'inv'::jsonb #>> '{invoices,0,id}') = :'inv1',
  'Asha sees her issued invoice only (no drafts, nothing of Beta)');
select tests.check((public.portal_open(:'s_asha', :'asha', 'invoice', :'inv1', '10.0.0.1') ->> 'company_id') = :'co', 'her invoice PDF can be opened');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_asha', :'asha', 'invoice', :'inv_beta'), 'Beta''s invoice cannot be opened');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_asha', :'asha', 'invoice', :'inv_draft'), 'a draft invoice cannot be opened');
select tests.check((public.portal_open(:'s_asha', :'asha', 'statement', :'acme', null) ->> 'party_id') = :'acme', 'her statement can be opened');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_asha', :'asha', 'statement', :'beta'), 'Beta''s statement cannot be opened');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_asha', :'asha', 'po', gen_random_uuid()), 'clients cannot open purchase orders');
select tests.blocked(format('select public.portal_rfqs(%L, %L)', :'s_asha', :'asha'), 'clients cannot use the supplier portal');
reset role;
select tests.check((select count(*) from public.audit_log where company_id = :'co' and action = 'portal_download') >= 3, 'downloads are in the Activity log');

-- ---- 6. Shared documents ---------------------------------------------------------------------
insert into public.documents (company_id, title, kind) values (:'co', 'ISO 9001 certificate', 'certificate') returning id as doc1 \gset
insert into storage.objects (bucket_id, name) values ('documents', :'co' || '/' || :'doc1' || '/iso.pdf');
update public.documents set file_path = :'co' || '/' || :'doc1' || '/iso.pdf', file_name = 'iso.pdf' where id = :'doc1';
insert into public.documents (company_id, title, kind) values (:'co', 'Draft SDS', 'sds') returning id as doc_nofile \gset
select tests.login('driver.pc@p.test'); set role authenticated;
select tests.blocked(format('select public.portal_share_document(%L, %L, %L, true)', :'doc1', 'client', :'acme'), 'drivers cannot share documents');
reset role;
select tests.login('sales.pc@p.test'); set role authenticated;
select tests.blocked(format('select public.portal_share_document(%L, %L, %L, true)', :'doc_nofile', 'client', :'acme'), 'a document without its file cannot be shared');
select tests.blocked(format('select public.portal_share_document(%L, %L, %L, true)', :'doc1', 'client', :'elsewhere'), 'cannot share with another company''s client');
select public.portal_share_document(:'doc1', 'client', :'acme', true);
select public.portal_share_document(:'doc1', 'client', :'acme', true);
reset role;
set role service_role;
select tests.check(jsonb_array_length(public.portal_documents(:'s_asha', :'asha')) = 1, 'the shared certificate is on Acme''s portal (once)');
select tests.check(jsonb_array_length(public.portal_documents(:'s_ben', :'ben')) = 0, 'not on Beta''s');
select tests.check((public.portal_open(:'s_asha', :'asha', 'document', :'doc1', null) ->> 'path') like '%/iso.pdf', 'the file can be downloaded');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_ben', :'ben', 'document', :'doc1'), 'Beta cannot download it');
reset role;
select tests.login('sales.pc@p.test'); set role authenticated;
select public.portal_share_document(:'doc1', 'client', :'acme', false);
reset role;
set role service_role;
select tests.check(jsonb_array_length(public.portal_documents(:'s_asha', :'asha')) = 0, 'stopped sharing: gone from the portal');
reset role;

-- ---- 7. Messages land in the Inbox --------------------------------------------------------------
set role service_role;
select tests.blocked(format('select public.portal_send_message(%L, %L, %L, null)', :'s_asha', :'asha', '   '), 'an empty message is refused');
select public.portal_send_message(:'s_asha', :'asha', 'When will the drill bits arrive?', 'Delivery date') as m1 \gset
select public.portal_send_message(:'s_asha', :'asha', 'Also please send the statement.', null);
select public.portal_send_message(:'s_ben', :'ben', 'Hello from Beta', null);
reset role;
select conversation_id as conv from public.portal_threads where portal_user_id = :'asha' \gset
select tests.check((select channel = 'portal' and client_id = :'acme' and unread_count = 2 and message_count = 2 and status = 'open'
                      from public.inbox_conversations where id = :'conv'),
  'messages arrive in one Inbox conversation (channel portal), linked to the client, unread');
select tests.check(exists (select 1 from public.notifications where user_id = :'sales' and link = '/inbox/' || :'conv'), 'sales is told about the message');
select tests.login('sales.pc@p.test'); set role authenticated;
select tests.check((select count(*) from public.inbox_messages where conversation_id = :'conv') = 2, 'sales reads it in the Inbox');
select public.inbox_record_outbound(:'conv', '{"status":"sent","text":"Friday morning.","provider":"portal"}');
reset role;
set role service_role;
select public.portal_messages(:'s_asha', :'asha') as msgs \gset
select tests.check(jsonb_array_length(:'msgs'::jsonb) = 3 and (:'msgs'::jsonb #>> '{2,direction}') = 'out' and (:'msgs'::jsonb #>> '{2,text}') = 'Friday morning.',
  'the reply from the Inbox shows on the portal');
select tests.check(jsonb_array_length(public.portal_messages(:'s_ben', :'ben')) = 1, 'Ben sees only his own conversation');
reset role;
select tests.login('driver.pc@p.test'); set role authenticated;
select tests.check((select count(*) from public.inbox_conversations where id = :'conv') = 0, 'drivers do not see portal messages');
select tests.check((select count(*) from public.portal_users) = 0, 'drivers do not see portal accounts');
reset role;

-- ---- 8. Direct table access ------------------------------------------------------------------------
select tests.login('boss.pc@p.test'); set role authenticated;
select tests.check((select count(*) from public.portal_users where company_id = :'co') = 2, 'management sees the portal accounts');
select tests.blocked(format('insert into public.portal_users (company_id, party, client_id, name, email) values (%L, %L, %L, %L, %L)', :'co', 'client', :'acme', 'Hack', 'h@h.test'),
  'portal accounts are only made through the invite');
select tests.blocked(format('update public.portal_users set status = %L where id = %L', 'active', :'asha'), 'portal accounts cannot be edited directly');
select tests.blocked(format('insert into public.portal_quote_decisions (company_id, quotation_id, portal_user_id, decision, signer_name) values (%L, %L, %L, %L, %L)', :'co', :'q_app', :'asha', 'accepted', 'Fake'),
  'acceptances cannot be written by hand');
reset role;
select tests.login('other.pc@p.test'); set role authenticated;
select tests.check((select count(*) from public.portal_users) = 0 and (select count(*) from public.portal_quote_decisions) = 0,
  'another company sees none of our portal records');
reset role;
set role anon;
select tests.blocked('select count(*) from public.portal_users', 'visitors cannot read portal accounts');
reset role;

-- ---- 9. Expiry, switching off and removing access ---------------------------------------------
update public.portal_sessions set last_seen_at = now() - interval '13 hours' where token_hash = public.portal_digest(:'s_ben');
set role service_role;
select tests.blocked(format('select public.portal_me(%L, %L)', :'s_ben', :'ben'), 'a session idle for 12 hours has expired');
reset role;
update public.portal_sessions set last_seen_at = now(), expires_at = now() - interval '1 minute' where token_hash = public.portal_digest(:'s_ben');
set role service_role;
select tests.blocked(format('select public.portal_me(%L, %L)', :'s_ben', :'ben'), 'a session older than 7 days has expired');
reset role;

select tests.login('boss.pc@p.test'); set role authenticated;
select public.set_company_feature(:'co', 'client_portal', false);
reset role;
set role service_role;
select tests.blocked(format('select public.portal_me(%L, %L)', :'s_asha', :'asha'), 'client portal switched off: no access');
select tests.check(public.portal_request_login('asha@acme.test', '10.9.9.9') ->> 'status' in ('none', 'limited'), 'and no sign-in code is sent');
reset role;
select tests.login('boss.pc@p.test'); set role authenticated;
select tests.blocked(format('select public.portal_invite(%L, %L, %L, %L, %L, null, null, null)', :'co', 'client', :'acme', 'new@acme.test', 'New'),
  'nobody can be invited while the portal is off');
select public.set_company_feature(:'co', 'client_portal', true);
reset role;
set role service_role;
select tests.check((public.portal_me(:'s_asha', :'asha') #>> '{account,id}') = :'asha', 'switched on again: access is back');
reset role;

select tests.login('sales.pc@p.test'); set role authenticated;
select tests.blocked(format('select public.portal_revoke(%L)', :'asha'), 'sales cannot remove portal access');
reset role;
select tests.login('boss.pc@p.test'); set role authenticated;
select public.portal_revoke(:'asha');
reset role;
select tests.check((select status = 'revoked' and revoked_by = :'boss' from public.portal_users where id = :'asha'), 'access removed, with who removed it');
select tests.check(not exists (select 1 from public.portal_sessions where email = 'asha@acme.test' and revoked_at is null),
  'Asha is signed out everywhere');
set role service_role;
select tests.blocked(format('select public.portal_quotations(%L, %L)', :'s_asha', :'asha'), 'a removed contact cannot see anything');
reset role;
select tests.login('boss.pc@p.test'); set role authenticated;
select tests.check(public.portal_invite(:'co', 'client', :'acme', 'asha@acme.test', 'Asha Buyer', 'Procurement officer', null, null) = :'asha',
  'invited again: the same account comes back (with its history)');
reset role;
select tests.check((select status from public.portal_users where id = :'asha') = 'active', 'active again');

-- Archived clients lose portal access.
update public.clients set active = false where id = :'beta';
set role service_role;
select tests.check(public.portal_request_login('ben@beta.test', '10.8.8.8') ->> 'status' in ('none', 'limited'), 'an archived client''s contact gets no code');
reset role;
update public.clients set active = true where id = :'beta';
