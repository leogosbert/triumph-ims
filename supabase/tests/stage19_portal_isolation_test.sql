-- Tests that a portal person only ever reaches their own client's or supplier's records:
-- one email that is a contact of two companies, sessions that cannot borrow accounts,
-- and that no portal function can be called from the browser (anon) or by app users.
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

-- ---- 1. Every portal function: security definer, empty search path, server only -------------------
select tests.check(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'portal\_%' or p.proname in ('apply_quotation_outcome', 'apply_po_confirmation', 'can_use_portal_file', 'add_portal_cleanup'))
       and not coalesce('search_path=""' = any (p.proconfig), false)),
  'every portal function runs with an empty search path');
select tests.check(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'portal\_%' and p.prokind = 'f' and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
       and not p.prosecdef),
  'every portal function written in PL/pgSQL is security definer');
select tests.check(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'portal\_%'
       and has_function_privilege('anon', p.oid, 'execute')),
  'visitors (anon key in the browser) can call no portal function');
select tests.check(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'portal\_%'
       and p.proargnames[1] = 'p_session'
       and has_function_privilege('authenticated', p.oid, 'execute')),
  'app users can call no session-based portal function');
select tests.check((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname like 'portal\_%' and p.proargnames[1] = 'p_session'
                       and has_function_privilege('service_role', p.oid, 'execute')) >= 25,
  'the portal server (service role) can call the portal functions');
select tests.check(not has_function_privilege('authenticated', 'public.portal_account(text, uuid)', 'execute')
                   and not has_function_privilege('anon', 'public.portal_account(text, uuid)', 'execute')
                   and not has_function_privilege('authenticated', 'public.portal_log(public.portal_users, text, text, text, jsonb)', 'execute'),
  'the internal helpers are not callable on their own');
select tests.check(not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname in ('portal_users', 'portal_login_codes', 'portal_sessions', 'portal_rate_hits', 'portal_quote_decisions',
                         'portal_shared_documents', 'portal_submissions', 'supplier_bank_details', 'portal_files', 'portal_threads')
       and not c.relrowsecurity),
  'every portal table has row-level security');
select tests.check(not exists (
    select 1 from public.backup_table_plan() p
     where p.table_name in ('portal_login_codes', 'portal_sessions', 'portal_rate_hits') and p.skipped is null),
  'sign-in codes and sessions are never in a company backup');

-- ---- 2. One email, two companies --------------------------------------------------------------------
insert into auth.users (email) values ('boss1.pi@p.test'), ('boss2.pi@p.test');
select tests.login('boss1.pi@p.test'); set role authenticated;
select public.create_company('Iso One') as co1 \gset
reset role;
select tests.login('boss2.pi@p.test'); set role authenticated;
select public.create_company('Iso Two') as co2 \gset
reset role;
insert into public.clients (company_id, name) values (:'co1', 'Gold Mine (of One)') returning id as c1 \gset
insert into public.clients (company_id, name) values (:'co2', 'Gold Mine (of Two)') returning id as c2 \gset
insert into public.suppliers (company_id, name) values (:'co2', 'Gold Mine Supplies') returning id as s2 \gset
insert into public.quotations (company_id, client_id) values (:'co1', :'c1') returning id as q1 \gset
insert into public.quotations (company_id, client_id) values (:'co2', :'c2') returning id as q2 \gset
select set_config('ims.status_change', 'on', false) as x \gset
update public.quotations set status = 'sent' where id in (:'q1', :'q2');
select set_config('ims.status_change', '', false) as x \gset
insert into public.purchase_orders (company_id, supplier_id) values (:'co2', :'s2') returning id as po2 \gset
select set_config('ims.status_change', 'on', false) as x \gset
update public.purchase_orders set status = 'sent' where id = :'po2';
select set_config('ims.status_change', '', false) as x \gset

select tests.login('boss1.pi@p.test'); set role authenticated;
select public.portal_invite(:'co1', 'client', :'c1', 'joy@goldmine.test', 'Joy', 'Buyer', null, null) as a1 \gset
select tests.blocked(format('select public.portal_invite(%L, %L, %L, %L, %L, null, null, null)', :'co2', 'client', :'c2', 'joy@goldmine.test', 'Joy'),
  'a manager of one company cannot invite into another');
reset role;
select tests.login('boss2.pi@p.test'); set role authenticated;
select public.portal_invite(:'co2', 'client', :'c2', 'joy@goldmine.test', 'Joy', 'Buyer', null, null) as a2 \gset
select public.portal_invite(:'co2', 'supplier', :'s2', 'joy@goldmine.test', 'Joy', 'Sales', null, null) as a3 \gset
select public.portal_invite(:'co2', 'client', :'c2', 'kim@goldmine.test', 'Kim', 'Finance', null, null) as kim \gset
reset role;

set role service_role;
select public.portal_request_login('joy@goldmine.test', '10.2.0.1') as r \gset
select tests.check((:'r'::jsonb -> 'companies') @> '["Iso One", "Iso Two"]'::jsonb, 'the sign-in email names both companies');
select public.portal_verify_login(null, null, :'r'::jsonb ->> 'token', '10.2.0.1', 'x') ->> 'session' as s_joy \gset
select public.portal_request_login('kim@goldmine.test', '10.2.0.2') as r \gset
select public.portal_verify_login(null, null, :'r'::jsonb ->> 'token', '10.2.0.2', 'x') ->> 'session' as s_kim \gset
select tests.check(jsonb_array_length(public.portal_accounts(:'s_joy')) = 3, 'one sign-in, three portal accounts to choose from');
select tests.check((select count(*) from jsonb_array_elements(public.portal_quotations(:'s_joy', :'a1')) e where e ->> 'id' = :'q1') = 1
                   and (select count(*) from jsonb_array_elements(public.portal_quotations(:'s_joy', :'a1')) e where e ->> 'id' = :'q2') = 0,
  'as a contact of Iso One, Joy sees Iso One''s quotation only');
select tests.check((select count(*) from jsonb_array_elements(public.portal_quotations(:'s_joy', :'a2')) e where e ->> 'id' = :'q2') = 1
                   and (select count(*) from jsonb_array_elements(public.portal_quotations(:'s_joy', :'a2')) e where e ->> 'id' = :'q1') = 0,
  'as a contact of Iso Two, Iso Two''s only');
select tests.blocked(format('select public.portal_quotation(%L, %L, %L)', :'s_joy', :'a1', :'q2'), 'through Iso One''s account, Iso Two''s quotation stays hidden');
select tests.blocked(format('select public.portal_decide_quotation(%L, %L, %L, %L)', :'s_joy', :'a1', :'q2', '{"decision":"decline","name":"Joy"}'),
  'and cannot be answered');
select tests.check(jsonb_array_length(public.portal_purchase_orders(:'s_joy', :'a3')) = 1, 'as a supplier contact she sees the purchase order to her company');
select tests.blocked(format('select public.portal_purchase_orders(%L, %L)', :'s_joy', :'a2'), 'but not through her client account');
select tests.check((public.portal_me(:'s_joy', :'a1') #>> '{company,name}') = 'Iso One' and (public.portal_me(:'s_joy', :'a2') #>> '{company,name}') = 'Iso Two',
  'each account shows its own company''s branding');
select tests.blocked(format('select public.portal_me(%L, %L)', :'s_kim', :'a2'), 'Kim''s session cannot open Joy''s account in the same client');
select tests.blocked(format('select public.portal_quotations(%L, %L)', :'s_joy', :'kim'), 'Joy''s session cannot open Kim''s account');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_joy', :'a1', 'statement', :'c2'), 'no statement of another company''s client');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_joy', :'a1', 'quotation', :'q2'), 'no PDF of another company''s quotation');
select tests.blocked(format('select public.portal_open(%L, %L, %L, %L, null)', :'s_joy', :'a1', 'nonsense', :'q1'), 'unknown downloads are refused');
reset role;

-- Removing Joy from one company leaves the others.
select tests.login('boss1.pi@p.test'); set role authenticated;
select public.portal_revoke(:'a1');
reset role;
set role service_role;
select tests.check(jsonb_array_length(public.portal_accounts(:'s_joy')) = 2, 'removed by Iso One: two accounts left, still signed in');
select tests.blocked(format('select public.portal_me(%L, %L)', :'s_joy', :'a1'), 'Iso One''s account is closed at once');
select public.portal_sign_out(:'s_joy');
select tests.blocked(format('select public.portal_accounts(%L)', :'s_joy'), 'signed out: the session no longer works');
reset role;
select tests.check(exists (select 1 from public.audit_log where company_id = :'co2' and action = 'portal_sign_in' and details ->> 'portal_email' = 'joy@goldmine.test')
                   and not exists (select 1 from public.audit_log where company_id = :'co1' and action like 'portal_%' and entity_id in (:'a2', :'a3')),
  'each company''s Activity log holds only its own portal accounts');
