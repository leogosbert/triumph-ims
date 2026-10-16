-- Tests for checking backups and putting a backup back (restore).
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;
-- Signed in just now with a password; p_aal for two-step (platform admins need aal2).
create or replace function tests.login_rs(p_email text, p_aal text default 'aal1', p_age_s integer default 0) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'email', p_email, 'role', 'authenticated', 'aal', p_aal,
                      'amr', json_build_array(json_build_object('method', 'password',
                                                                'timestamp', extract(epoch from now())::bigint - p_age_s)))::text, false);
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

insert into auth.users (email) values ('boss.rs@g.test'), ('sales.rs@g.test'), ('admin.rs@g.test'), ('other.rs@g.test'),
                                      ('late.rs@g.test'), ('leaver.rs@g.test');
select id as boss from auth.users where email = 'boss.rs@g.test' \gset
select id as sales from auth.users where email = 'sales.rs@g.test' \gset
select id as admin from auth.users where email = 'admin.rs@g.test' \gset
select id as late from auth.users where email = 'late.rs@g.test' \gset
select id as leaver from auth.users where email = 'leaver.rs@g.test' \gset
insert into public.platform_admins (user_id) values (:'admin');

select tests.login_rs('boss.rs@g.test'); set role authenticated;
select public.create_company('Restore Co') as co \gset
reset role;
select tests.login_rs('other.rs@g.test'); set role authenticated;
select public.create_company('Other Restore Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role) values (:'co', :'sales', 'sales');

-- The day of the backup: two clients, a product with stock in a store.
insert into public.clients (company_id, name, created_by) values (:'co', 'Alpha Mining', :'boss') returning id as alpha \gset
insert into public.clients (company_id, name, created_by) values (:'co', 'Beta Cement', :'leaver') returning id as beta \gset
insert into public.clients (company_id, name) values (:'other', 'Other Client') returning id as oclient \gset
insert into public.products (company_id, name) values (:'co', 'Hydraulic oil 20L') returning id as oil \gset
select id as main from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
select tests.login_rs('boss.rs@g.test'); set role authenticated;
select public.adjust_stock(:'co', :'oil', :'main', 10, 'B1', null, 'Opening balance');
reset role;

select public.take_company_backup(:'co', 'manual', :'boss', '2026-10-01 10:00+03') as b1 \gset

-- ---- 1. Checking a copy -------------------------------------------------------------
select public.verify_company_backup_at(:'b1') as v1 \gset
select tests.check(:'v1'::boolean
                   and (select verify_ok and verified_at is not null and verify_note is null
                          from public.company_backups where id = :'b1'), 'check: a fresh copy passes');
select tests.check(not (select data -> 'tables' ? 'backup_restore_requests' from public.company_backup_data where backup_id = :'b1'),
  'check: restore requests are never inside a backup');

select public.take_company_backup(:'co', 'manual', :'boss', '2026-10-01 11:00+03') as bad \gset
update public.company_backup_data set data = jsonb_set(data, '{tables,clients,0,name}', '"Changed"') where backup_id = :'bad';
select public.verify_company_backup_at(:'bad') as v2 \gset
select tests.check(not :'v2'::boolean
                   and (select verify_note like '%checksum%' from public.company_backups where id = :'bad'),
  'check: a changed copy fails (checksum)');
select tests.check((select count(*) from public.notifications where company_id = :'co' and kind = 'backup_check_failed') >= 1
                   and (select count(*) from public.platform_notifications where kind = 'backup_check_failed'
                         and ref_company = :'co') = 1,
  'check: a failed copy tells the managers and LeMo Tech');
select public.verify_company_backup_at(:'bad') as x \gset
select tests.check((select count(*) from public.platform_notifications where kind = 'backup_check_failed'
                     and ref_company = :'co') = 1, 'check: told only once per copy');

-- A copy with records of another company, and with a record count that does not match.
select public.take_company_backup(:'co', 'manual', :'boss', '2026-10-01 12:00+03') as bad2 \gset
update public.company_backup_data
   set data = jsonb_set(jsonb_set(data, '{tables,clients,0,company_id}', to_jsonb(:'other'::text)), '{counts,products}', '5')
 where backup_id = :'bad2';
update public.company_backups b set checksum = encode(sha256(convert_to(d.data::text, 'UTF8')), 'hex')
  from public.company_backup_data d where d.backup_id = b.id and b.id = :'bad2';
select public.verify_company_backup_at(:'bad2') as v3 \gset
select tests.check(not :'v3'::boolean
                   and (select verify_note like '%clients: has records of another company%'
                               and verify_note like '%products: the number of records does not match%'
                          from public.company_backups where id = :'bad2'),
  'check: other company''s records and wrong counts are caught');

-- Scheduled checking.
select tests.blocked('select public.verify_next_backup(''wrong'')', 'scheduled check: wrong secret refused');
-- Other test files leave backups too: count those as checked, so the next pick is ours.
update public.company_backups set verified_at = case when id = :'b1' then null else now() end;
select public.verify_next_backup_at(now()) as vn \gset
select tests.check(:'vn' <> ''
                   and (select verified_at is not null from public.company_backups where id = :'b1'),
  'scheduled check: copies never checked are checked');
select tests.check((select count(*) from public.company_backups where verified_at is null) = 0
                   or public.verify_next_backup_at(now()) is not null, 'scheduled check: picks the next one');
update public.company_backups set verified_at = now() - interval '8 days' where id = :'b1';
select public.verify_next_backup_at(now()) as x \gset
select tests.check((select verified_at > now() - interval '1 minute' from public.company_backups where id = :'b1'),
  'scheduled check: copies are checked again after 7 days');

-- ---- 2. What happens after the backup --------------------------------------------------
update public.clients set name = 'Alpha Mining (renamed)' where id = :'alpha';
delete from public.clients where id = :'beta';
insert into public.clients (company_id, name) values (:'co', 'Gamma Gold') returning id as gamma \gset
insert into public.products (company_id, name) values (:'co', 'Grease 18kg') returning id as grease \gset
select tests.login_rs('boss.rs@g.test'); set role authenticated;
select public.adjust_stock(:'co', :'grease', :'main', 4, 'G1', null, 'Opening balance');
select public.adjust_stock(:'co', :'oil', :'main', -3, 'B1', null, 'count');
reset role;
insert into public.memberships (company_id, user_id, role) values (:'co', :'late', 'finance');
delete from auth.users where id = :'leaver';   -- Beta Cement's creator leaves after the backup
-- A notification about the new client (points at a record the restore removes).
insert into public.notifications (company_id, user_id, kind, title, link)
values (:'co', :'boss', 'test', 'New client Gamma', '/clients/' || :'gamma');

-- ---- 3. Preview and request (managers) ---------------------------------------------------
select tests.login_rs('sales.rs@g.test'); set role authenticated;
select tests.blocked(format('select public.backup_restore_preview(%L)', :'b1'), 'preview: salesperson refused');
select tests.blocked(format('select public.request_backup_restore(%L)', :'b1'), 'request: salesperson refused');
select tests.check((select count(*) from public.backup_restore_requests) = 0, 'requests: salesperson sees none');
reset role;

select tests.login_rs('boss.rs@g.test'); set role authenticated;
select public.backup_restore_preview(:'b1') as pv \gset
select tests.check((select (e ->> 'in_backup')::int = 2 and (e ->> 'now')::int = 2 and not (e ->> 'kept')::boolean
                      from jsonb_array_elements(:'pv'::jsonb -> 'tables') e where e ->> 'table' = 'clients')
                   and (select (e ->> 'in_backup')::int = 1 and (e ->> 'now')::int = 2
                          from jsonb_array_elements(:'pv'::jsonb -> 'tables') e where e ->> 'table' = 'products')
                   and (select (e ->> 'kept')::boolean
                          from jsonb_array_elements(:'pv'::jsonb -> 'tables') e where e ->> 'table' = 'memberships'),
  'preview: records in the copy and now, per area; the team is kept');
select tests.blocked(format('select public.request_backup_restore(%L)', :'bad'), 'request: a copy that failed its check is refused');
reset role;
select tests.login_rs('boss.rs@g.test', 'aal1', 3600); set role authenticated;
select tests.blocked(format('select public.request_backup_restore(%L)', :'b1'), 'request: needs a recent sign-in');
reset role;
select tests.login_rs('boss.rs@g.test'); set role authenticated;
select public.request_backup_restore(:'b1', 'We deleted Beta Cement by mistake') as req \gset
select tests.blocked(format('select public.request_backup_restore(%L)', :'b1'), 'request: only one open request at a time');
select tests.check((select status = 'requested' and note = 'We deleted Beta Cement by mistake'
                      from public.backup_restore_requests where id = :'req'), 'request: the manager sees the request');
select tests.blocked(format('select public.restore_company_backup(%L, %L)', :'req', 'Restore Co'), 'restore: a manager cannot restore');
select tests.blocked(format('select public.restore_company_backup_sql(%L)', :'req'), 'restore: the SQL-editor version is owner-only');
select tests.blocked(format('select public.restore_company_backup_at(%L, null)', :'b1'), 'restore: internal function is not callable');
select tests.blocked('select public.platform_backup_health()', 'health: managers cannot see all companies');
reset role;
select tests.check((select count(*) from public.platform_notifications where kind = 'backup_restore'
                     and dedupe_key = 'restore-request:' || :'req') = 1, 'request: LeMo Tech is told');
select tests.check((select count(*) from public.audit_log where company_id = :'co' and action = 'restore_requested') = 1,
  'request: written to the Activity log');

select tests.login_rs('other.rs@g.test'); set role authenticated;
select tests.check((select count(*) from public.backup_restore_requests) = 0, 'requests: another company sees none');
select tests.blocked(format('select public.cancel_backup_restore(%L)', :'req'), 'cancel: another company refused');
reset role;

-- The copy named by an open request is never cleaned up.
select count(public.take_company_backup(:'co', 'manual', :'boss', '2026-10-02 10:00+03'::timestamptz + make_interval(mins => i))) as x
  from generate_series(1, 11) i \gset
select tests.check(exists (select 1 from public.company_backups where id = :'b1'), 'clean-up: keeps the copy of an open request');

-- ---- 4. Restore (LeMo Tech) ---------------------------------------------------------------
select tests.login_rs('admin.rs@g.test', 'aal1'); set role authenticated;
select tests.blocked(format('select public.restore_company_backup(%L, %L)', :'req', 'Restore Co'), 'restore: admin without two-step refused');
reset role;
select tests.login_rs('admin.rs@g.test', 'aal2', 3600); set role authenticated;
select tests.blocked(format('select public.restore_company_backup(%L, %L)', :'req', 'Restore Co'), 'restore: needs a recent sign-in');
reset role;
select tests.login_rs('admin.rs@g.test', 'aal2'); set role authenticated;
select tests.blocked(format('select public.restore_company_backup(%L, %L)', :'req', 'Restore'), 'restore: the company name must match');
select tests.check((select jsonb_array_length(public.platform_backup_health() -> 'requests') >= 1
                           and jsonb_array_length(public.platform_backup_health() -> 'companies') >= 2),
  'health: admin sees every company and the requests');
select public.restore_company_backup(:'req', 'Restore Co') as res \gset
reset role;
select tests.check(:'res'::jsonb ->> 'error' is null and :'res'::jsonb ->> 'safety_backup_id' is not null,
  'restore: done, with a safety copy');
select tests.check((select string_agg(name, ',' order by name) from public.clients where company_id = :'co') = 'Alpha Mining,Beta Cement',
  'restore: clients are back as they were (rename undone, deleted back, new one gone)');
select tests.check((select created_by is null from public.clients where id = :'beta'),
  'restore: a link to a person who left is cleared');
select tests.check((select count(*) from public.products where company_id = :'co') = 1
                   and not exists (select 1 from public.stock_movements where product_id = :'grease'),
  'restore: the product added later and its stock are gone');
select tests.check((select sum(quantity) from public.stock_on_hand where product_id = :'oil') = 10, 'restore: stock is back to 10');
select tests.check(exists (select 1 from public.memberships where company_id = :'co' and user_id = :'late'),
  'restore: the team stays as it is now');
select tests.check((select link is null or link like '/clients/%' from public.notifications where title = 'New client Gamma'),
  'restore: notifications stay (they hold a text link, not a database link)');
select tests.check((select count(*) from public.clients where company_id = :'other') = 1, 'restore: other companies untouched');
select tests.check((select status = 'done' and safety_backup_id is not null and handled_by = :'admin'
                      from public.backup_restore_requests where id = :'req'), 'restore: request marked done');
select tests.check((select note like 'Safety copy taken before restoring the backup of%'
                           and (select jsonb_array_length(data #> '{tables,clients}') from public.company_backup_data
                                 where backup_id = s.id) = 2
                      from public.company_backups s
                     where s.id = (select safety_backup_id from public.backup_restore_requests where id = :'req')),
  'restore: the safety copy holds the data as it was just before');
select tests.check((select count(*) from public.audit_log where company_id = :'co' and action = 'restore') = 1
                   and (select count(*) from public.notifications where company_id = :'co' and kind = 'backup_restored') >= 1,
  'restore: Activity log and a notice to managers');
-- Triggers work again after the restore.
select tests.login_rs('boss.rs@g.test'); set role authenticated;
select tests.blocked(format('insert into public.stock_movements (company_id, product_id, warehouse_id, quantity, kind) values (%L, %L, %L, 5, %L)',
                            :'co', :'oil', :'main', 'adjustment'), 'restore: stock still cannot be typed in directly afterwards');
reset role;

-- ---- 5. Undo a restore with its safety copy (SQL editor version) ----------------------------
select safety_backup_id as safety from public.backup_restore_requests where id = :'req' \gset
select tests.login_rs('boss.rs@g.test'); set role authenticated;
select public.request_backup_restore(:'safety') as req2 \gset
reset role;
select public.restore_company_backup_sql(:'req2') as res2 \gset
select tests.check((select string_agg(name, ',' order by name) from public.clients where company_id = :'co') = 'Alpha Mining (renamed),Gamma Gold'
                   and (select sum(quantity) from public.stock_on_hand where product_id = :'oil') = 7,
  'undo: restoring the safety copy brings the newer data back');

-- ---- 6. A failed restore changes nothing ------------------------------------------------------
-- (The first copy has been cleaned up by now: its request is done.)
select public.take_company_backup(:'co', 'manual', :'boss') as b1 \gset
select tests.login_rs('boss.rs@g.test'); set role authenticated;
select public.request_backup_restore(:'b1') as req3 \gset
select public.cancel_backup_restore(:'req3');
select tests.check((select status = 'cancelled' from public.backup_restore_requests where id = :'req3'), 'cancel: the manager can cancel');
select public.request_backup_restore(:'b1') as req4 \gset
reset role;
update public.company_backup_data set data = jsonb_set(data, '{tables,clients,0,name}', '"Tampered"') where backup_id = :'b1';
select public.restore_company_backup_sql(:'req4') as res4 \gset
select tests.check(:'res4'::jsonb ->> 'error' like '%failed its check%'
                   and (select status = 'failed' from public.backup_restore_requests where id = :'req4')
                   and (select string_agg(name, ',' order by name) from public.clients where company_id = :'co') = 'Alpha Mining (renamed),Gamma Gold',
  'failed restore: refused, marked failed, nothing changed');
select tests.blocked(format('select public.restore_company_backup_sql(%L)', :'req4'), 'a handled request cannot be run again');

-- ---- 7. Grants ---------------------------------------------------------------------------------
set role anon;
select tests.blocked(format('select public.backup_restore_preview(%L)', :'b1'), 'anon: no preview');
select tests.blocked('select public.platform_backup_health()', 'anon: no health');
select tests.blocked('select count(*) from public.backup_restore_requests', 'anon: no requests');
reset role;

-- Clean up so later test files start from a known state.
delete from public.platform_admins where user_id = :'admin';
