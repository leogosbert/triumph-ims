-- Tests for order progress (status, progress bar, next stage, who is responsible).
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;
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
grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (email) values ('boss.op@g.test'), ('sales.op@g.test'), ('driver.op@g.test'), ('fin.op@g.test'), ('other.op@g.test');
select id as boss from auth.users where email = 'boss.op@g.test' \gset
select id as sales from auth.users where email = 'sales.op@g.test' \gset
select id as driver from auth.users where email = 'driver.op@g.test' \gset
select id as fin from auth.users where email = 'fin.op@g.test' \gset
select id as outsider from auth.users where email = 'other.op@g.test' \gset
update public.profiles set full_name = 'Sara Sales' where id = :'sales';
update public.profiles set full_name = 'Dan Driver' where id = :'driver';

select tests.login('boss.op@g.test'); set role authenticated;
select public.create_company('Progress Co') as co \gset
reset role;
select tests.login('other.op@g.test'); set role authenticated;
select public.create_company('Other Progress Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
values (:'co', :'sales', 'sales'), (:'co', :'driver', 'driver'), (:'co', :'fin', 'finance');
insert into public.clients (company_id, name) values (:'co', 'Geita Mine') returning id as client \gset
insert into public.clients (company_id, name) values (:'other', 'Other Client') returning id as oclient \gset
insert into public.suppliers (company_id, name) values (:'co', 'Lubes Ltd') returning id as sup \gset
select id as main from public.warehouses where company_id = :'co' order by created_at limit 1 \gset

select tests.login('sales.op@g.test'); set role authenticated;
select public.create_quotation(:'co', :'client', null) as q \gset
reset role;
select tests.login('other.op@g.test'); set role authenticated;
select public.create_quotation(:'other', :'oclient', null) as oq \gset
reset role;

-- ---- 1. A new quotation ----------------------------------------------------------
select tests.login('sales.op@g.test'); set role authenticated;
select public.order_progress(:'q') as p \gset
select tests.check((:'p'::jsonb ->> 'status') = 'in_progress' and (:'p'::jsonb ->> 'done')::int = 1
                   and (:'p'::jsonb ->> 'total')::int = 7 and (:'p'::jsonb #>> '{next,key}') = 'approved'
                   and (:'p'::jsonb #>> '{current,key}') = 'quoted',
  'new order: 1 of 7 stages, now Quoted, next Approved (no purchasing stage yet)');
select tests.check((select bool_and(e -> 'owner' = 'null'::jsonb and e -> 'owner_id' = 'null'::jsonb)
                      from jsonb_array_elements(:'p'::jsonb -> 'stages') e)
                   and not (:'p'::jsonb ->> 'can_assign')::boolean,
  'not a manager: nobody responsible is shown');
select tests.check((select count(*) from public.order_stage_owners) = 0, 'not a manager: cannot read who is responsible');
select tests.blocked(format('select public.set_order_stage_owner(%L, %L, %L)', :'q', 'delivered', :'driver'),
  'not a manager: cannot choose who is responsible');
select tests.blocked(format('select public.order_progress(%L)', :'oq'), 'another company''s order is refused');
select tests.check(not (public.orders_progress(array[:'q', :'oq']::uuid[]) ? :'oq')
                   and (public.orders_progress(array[:'q', :'oq']::uuid[]) ? :'q'),
  'list: other companies'' orders are left out');
reset role;

select tests.login('boss.op@g.test'); set role authenticated;
select public.order_progress(:'q') as p \gset
select tests.check((:'p'::jsonb ->> 'can_assign')::boolean
                   and (select e ->> 'owner' = 'Sara Sales' and not (e ->> 'assigned')::boolean
                          from jsonb_array_elements(:'p'::jsonb -> 'stages') e where e ->> 'key' = 'quoted'),
  'manager: sees who is responsible (by default whoever made the quotation)');
reset role;

-- ---- 2. Through the stages ------------------------------------------------------------
select set_config('ims.status_change', 'on', false) as x \gset
update public.quotations set status = 'approved', approved_by = :'boss' where id = :'q';
update public.quotations set status = 'sent' where id = :'q';
update public.quotations set status = 'accepted' where id = :'q';
select public.order_progress_of(:'q', true) as p \gset
select tests.check((:'p'::jsonb ->> 'done')::int = 4 and (:'p'::jsonb #>> '{next,key}') = 'delivered'
                   and (:'p'::jsonb ->> 'percent')::int = 57,
  'won: 4 of 7, next Delivered, 57%');

insert into public.purchase_orders (company_id, number, supplier_id, quotation_id, status, created_by)
values (:'co', 'PO-OP-1', :'sup', :'q', 'sent', :'boss') returning id as po \gset
select public.order_progress_of(:'q', true) as p \gset
select tests.check((:'p'::jsonb ->> 'total')::int = 8 and (:'p'::jsonb #>> '{next,key}') = 'bought',
  'with a purchase order: the Goods bought stage appears and comes next');
update public.purchase_orders set status = 'received' where id = :'po';

insert into public.deliveries (company_id, number, client_id, quotation_id, warehouse_id, driver_id, status, created_by)
values (:'co', 'DN-OP-1', :'client', :'q', :'main', :'driver', 'dispatched', :'sales') returning id as dn \gset
select public.order_progress_of(:'q', true) as p \gset
select tests.check((:'p'::jsonb #>> '{next,key}') = 'delivered' and (:'p'::jsonb #>> '{next,owner}') = 'Dan Driver',
  'on the road: next Delivered, responsible is the driver');
update public.deliveries set status = 'delivered' where id = :'dn';

insert into public.invoices (company_id, client_id, quotation_id, status, created_by, total)
values (:'co', :'client', :'q', 'draft', :'fin', 100) returning id as inv \gset
update public.invoices set status = 'issued' where id = :'inv';
select public.order_progress_of(:'q', true) as p \gset
select tests.check((:'p'::jsonb ->> 'done')::int = 7 and (:'p'::jsonb #>> '{next,key}') = 'paid'
                   and (:'p'::jsonb #>> '{current,key}') = 'invoiced',
  'invoiced: next Paid');
update public.invoices set status = 'paid', amount_paid = 100 where id = :'inv';
select public.order_progress_of(:'q', true) as p \gset
select tests.check((:'p'::jsonb ->> 'status') = 'completed' and (:'p'::jsonb ->> 'percent')::int = 100
                   and (:'p'::jsonb -> 'next') = 'null'::jsonb,
  'paid: completed, 100%, nothing next');
select set_config('ims.status_change', '', false) as x \gset

-- ---- 3. Managers choose who is responsible --------------------------------------------
select tests.login('boss.op@g.test'); set role authenticated;
select public.set_order_stage_owner(:'q', 'paid', :'driver');
select public.order_progress(:'q') as p \gset
select tests.check((select e ->> 'owner' = 'Dan Driver' and (e ->> 'assigned')::boolean
                      from jsonb_array_elements(:'p'::jsonb -> 'stages') e where e ->> 'key' = 'paid'),
  'manager: chosen person is shown for that stage');
select tests.check((select count(*) from public.order_stage_owners where quotation_id = :'q') = 1, 'manager: can read the choices');
select tests.blocked(format('select public.set_order_stage_owner(%L, %L, %L)', :'q', 'paid', :'outsider'),
  'manager: only people in the team can be chosen');
select tests.blocked(format('select public.set_order_stage_owner(%L, %L, %L)', :'q', 'lunch', :'driver'), 'manager: unknown stage refused');
select tests.blocked(format('select public.set_order_stage_owner(%L, %L, %L)', :'oq', 'paid', :'driver'),
  'manager: cannot choose on another company''s order');
select public.set_order_stage_owner(:'q', 'paid', null);
select tests.check((select count(*) from public.order_stage_owners where quotation_id = :'q') = 0, 'manager: back to the default');
reset role;
select tests.check((select count(*) from public.audit_log where company_id = :'co' and entity = 'order_stage') = 2,
  'choices are written to the Activity log');

select tests.login('driver.op@g.test'); set role authenticated;
select public.order_progress(:'q') as p \gset
select tests.check((select bool_and(e -> 'owner' = 'null'::jsonb) from jsonb_array_elements(:'p'::jsonb -> 'stages') e),
  'the person responsible does not see names either');
reset role;

-- ---- 4. Closed orders --------------------------------------------------------------------
select tests.login('sales.op@g.test'); set role authenticated;
select public.create_quotation(:'co', :'client', null) as q2 \gset
reset role;
select set_config('ims.status_change', 'on', false) as x \gset
update public.quotations set status = 'cancelled' where id = :'q2';
select set_config('ims.status_change', '', false) as x \gset
select tests.check((public.order_progress_of(:'q2', false) ->> 'status') = 'cancelled'
                   and (public.order_progress_of(:'q2', false) -> 'next') = 'null'::jsonb,
  'cancelled order: no next stage');

set role anon;
select tests.blocked(format('select public.order_progress(%L)', :'q'), 'anon: no order progress');
select tests.blocked('select count(*) from public.order_stage_owners', 'anon: no owners');
reset role;
