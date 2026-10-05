-- Tests for automatic backups inside the app (company_backups).
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;
create or replace function tests.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'email', p_email, 'role', 'authenticated',
                      'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint)))::text, false);
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

insert into auth.users (email) values ('boss.bk@g.test'), ('sales.bk@g.test'), ('other.bk@g.test'), ('fin.bk@g.test');
select id as boss from auth.users where email = 'boss.bk@g.test' \gset
select id as sales from auth.users where email = 'sales.bk@g.test' \gset
select id as fin from auth.users where email = 'fin.bk@g.test' \gset

select tests.login('boss.bk@g.test'); set role authenticated;
select public.create_company('Backup Co') as co \gset
reset role;
insert into public.memberships (company_id, user_id, role) values (:'co', :'sales', 'sales'), (:'co', :'fin', 'finance');
select tests.login('other.bk@g.test'); set role authenticated;
select public.create_company('Other Backup Co') as other \gset
reset role;
-- A demo company (created the way create_demo_company does it).
select set_config('ims.demo_create', 'on', false) as x \gset
insert into public.companies (name, is_demo, demo_expires_at) values ('Demo Backup Co', true, now() + interval '1 day')
returning id as demo \gset
select set_config('ims.demo_create', '', false) as x \gset

-- Some business data, including a secret-looking table, a child table
-- without company_id and a table that fails to read.
insert into public.clients (company_id, name) values (:'co', 'Alpha Mining'), (:'co', 'Beta Cement'), (:'other', 'Other Client');
select id as client_a from public.clients where name = 'Alpha Mining' \gset
select id as client_o from public.clients where name = 'Other Client' \gset
insert into public.products (company_id, name) values (:'co', 'Hydraulic oil 20L');
create table public.zz_bk_child (id serial primary key, client_id uuid references public.clients (id) on delete cascade, note text);
insert into public.zz_bk_child (client_id, note) values (:'client_a', 'mine'), (:'client_o', 'not mine');
create table public.zz_bk_tokens (id serial primary key, company_id uuid, api_token text);
insert into public.zz_bk_tokens (company_id, api_token) values (:'co', 'super-secret');
create table public.zz_bk_broken (id serial primary key, company_id text);  -- text vs uuid: reading it fails
insert into public.zz_bk_broken (company_id) values ('x');

-- ---- 1. What goes into a backup --------------------------------------------------
select tests.check((select count(*) = 0 from public.backup_table_plan() where table_name = 'companies'),
  'plan: the company row is stored separately, not as a table');
select tests.check((select skipped = 'excluded' from public.backup_table_plan() where table_name = 'audit_log')
                   and (select skipped = 'excluded' from public.backup_table_plan() where table_name = 'notifications')
                   and (select skipped = 'excluded' from public.backup_table_plan() where table_name = 'company_backup_data'),
  'plan: activity log, notifications and the backups themselves are excluded');
select tests.check(not exists (select 1 from public.backup_table_plan()
                                where table_name in ('app_secrets', 'push_subscriptions', 'notification_settings', 'profiles')),
  'plan: secrets, phone push keys and personal settings are never planned');
select tests.check((select skipped = 'holds secrets' from public.backup_table_plan() where table_name = 'zz_bk_tokens'),
  'plan: a table with a token column is skipped');
select tests.check((select parent_table = 'clients' and fk_column = 'client_id' from public.backup_table_plan()
                     where table_name = 'zz_bk_child'), 'plan: a child table without company_id is found through its parent');
select tests.check((select count(*) from public.backup_table_plan() where skipped is null and parent_table is null) >= 30,
  'plan: all business tables with company_id are included');

select public.take_company_backup(:'co', 'daily', null, '2026-10-05 03:00+03') as b1 \gset
select tests.check((select kind = 'daily' and local_day = '2026-10-05' and rows >= 5 and tables >= 30 and bytes > 1000
                           and checksum ~ '^[0-9a-f]{64}$' from public.company_backups where id = :'b1'),
  'take: header has kind, day, records, tables, size and a sha256 checksum');
select tests.check((select data #>> '{format}' = 'lemosp-backup' and (data #>> '{version}')::int = 1
                           and data #>> '{company,name}' = 'Backup Co'
                           and jsonb_array_length(data #> '{tables,clients}') = 2
                           and jsonb_array_length(data #> '{tables,products}') = 1
                           and data #> '{tables,memberships}' is not null
                     from public.company_backup_data where backup_id = :'b1'),
  'take: data has format, version, company and the company''s own rows only');
select tests.check((select jsonb_array_length(data #> '{tables,zz_bk_child}') = 1
                           and data #>> '{tables,zz_bk_child,0,note}' = 'mine'
                     from public.company_backup_data where backup_id = :'b1'), 'take: child rows of this company only');
select tests.check((select not (data -> 'tables' ? 'zz_bk_tokens') and not (data -> 'tables' ? 'audit_log')
                           and not (data -> 'tables' ? 'notifications') and data::text not like '%super-secret%'
                           and data #>> '{not_included,zz_bk_tokens}' = 'holds secrets'
                     from public.company_backup_data where backup_id = :'b1'), 'take: secrets and excluded tables are not in the data');
select tests.check((select array_length(warnings, 1) = 1 and warnings[1] like 'zz_bk_broken:%'
                     from public.company_backups where id = :'b1')
                   and (select not (data -> 'tables' ? 'zz_bk_broken') and jsonb_array_length(data -> 'warnings') = 1
                          from public.company_backup_data where backup_id = :'b1'),
  'take: a table that fails is left out with a warning, the backup still completes');
select tests.check((select checksum = encode(sha256(convert_to(d.data::text, 'UTF8')), 'hex') and bytes = octet_length(d.data::text)
                     from public.company_backups b join public.company_backup_data d on d.backup_id = b.id where b.id = :'b1'),
  'take: checksum and size match the stored copy');
select tests.check(public.take_company_backup(:'co', 'daily', null, '2026-10-05 22:00+03') is null
                   and (select count(*) from public.company_backups where company_id = :'co') = 1,
  'take: a second automatic copy on the same day is skipped');
select tests.blocked(format('select public.take_company_backup(%L, %L)', :'demo', 'manual'), 'take: demo companies are never backed up');
select tests.blocked(format('select public.take_company_backup(%L, %L)', :'co', 'yearly'), 'take: unknown kind refused');
select tests.check(public.backup_kind_for('2026-10-05') = 'daily' and public.backup_kind_for('2026-10-04') = 'weekly'
                   and public.backup_kind_for('2026-11-01') = 'monthly' and public.backup_kind_for('2026-10-01') = 'monthly',
  'kind: Sunday is weekly, the 1st is monthly (even on a Sunday), other days daily');

-- ---- 2. Who can see and read backups ------------------------------------------------
select tests.login('boss.bk@g.test'); set role authenticated;
select tests.check((select count(*) from public.company_backups where company_id = :'co') = 1, 'manager sees the backup list');
select tests.blocked('select data from public.company_backup_data limit 1', 'manager cannot read backup data directly');
select tests.blocked('select * from public.company_backup_state limit 1', 'manager cannot read the internal backup state');
select tests.blocked(format('insert into public.company_backups (company_id, kind, local_day, checksum) values (%L, %L, current_date, %L)',
                            :'co', 'manual', 'x'), 'manager cannot insert backup rows');
select tests.blocked(format('delete from public.company_backups where id = %L', :'b1'), 'manager cannot delete backups');
select tests.blocked(format('update public.company_backups set rows = 0 where id = %L', :'b1'), 'manager cannot edit backups');
select tests.blocked(format('select public.take_company_backup(%L, %L)', :'co', 'manual'), 'take_company_backup is internal');
select tests.blocked(format('select public.run_company_backups_at(now())'), 'run_company_backups_at is internal');
select tests.blocked(format('select public.prune_company_backups(%L)', :'co'), 'prune is internal');
select public.download_company_backup(:'b1') as dl \gset
select tests.check(:'dl'::jsonb #>> '{company,name}' = 'Backup Co'
                   and encode(sha256(convert_to(:'dl', 'UTF8')), 'hex') = (select checksum from public.company_backups where id = :'b1'),
  'manager downloads the backup; the file matches the checksum');
reset role;
select tests.check((select count(*) from public.audit_log where company_id = :'co' and entity = 'company_backups'
                     and action = 'download' and entity_id = :'b1' and actor_id = :'boss') = 1,
  'the download is written to the Activity log');

select tests.login('sales.bk@g.test'); set role authenticated;
select tests.check((select count(*) from public.company_backups) = 0, 'salesperson sees no backups');
select tests.blocked(format('select public.download_company_backup(%L)', :'b1'), 'salesperson cannot download');
select tests.blocked(format('select public.backup_now(%L)', :'co'), 'salesperson cannot back up');
select tests.blocked(format('select public.company_backup_status(%L)', :'co'), 'salesperson cannot see backup status');
reset role;
select tests.login('fin.bk@g.test'); set role authenticated;
select tests.check((select count(*) from public.company_backups) = 0, 'finance sees no backups');
reset role;
select tests.login('other.bk@g.test'); set role authenticated;
select tests.check((select count(*) from public.company_backups where company_id = :'co') = 0, 'another company''s manager sees nothing');
select tests.blocked(format('select public.download_company_backup(%L)', :'b1'), 'another company''s manager cannot download');
select tests.blocked(format('select public.backup_now(%L)', :'co'), 'another company''s manager cannot back up');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', false) as x \gset
set role anon;
select tests.blocked('select count(*) from public.company_backups', 'anonymous visitors cannot list backups');
select tests.blocked(format('select public.download_company_backup(%L)', :'b1'), 'anonymous visitors cannot download');
reset role;

-- Recent sign-in check (public.recent_auth, from the security update).
select tests.login('boss.bk@g.test');
select set_config('request.jwt.claims', (current_setting('request.jwt.claims')::jsonb - 'amr')::text, false) as x \gset
set role authenticated;
select tests.blocked(format('select public.download_company_backup(%L)', :'b1'), 'download needs a recent sign-in');
reset role;
select tests.login('boss.bk@g.test'); set role authenticated;
select tests.check(length(public.download_company_backup(:'b1')) > 1000, 'download works after a recent sign-in');
reset role;

-- ---- 3. Back up now -----------------------------------------------------------------
select tests.login('boss.bk@g.test'); set role authenticated;
select public.backup_now(:'co') as m1 \gset
select tests.check((select kind = 'manual' and created_by = :'boss' from public.company_backups where id = :'m1'),
  'back up now: a manual copy by the manager');
select public.backup_now(:'co') as m \gset
select public.backup_now(:'co') as m \gset
select public.backup_now(:'co') as m \gset
select public.backup_now(:'co') as m \gset
select tests.blocked(format('select public.backup_now(%L)', :'co'), 'back up now: at most 5 a day');
select tests.check((public.company_backup_status(:'co') ->> 'manual_today')::int = 5, 'status: manual copies today');
select tests.blocked(format('select public.backup_now(%L)', :'demo'), 'back up now: not for a demo (not a manager there)');
reset role;
select tests.check((select count(*) from public.audit_log where company_id = :'co' and entity = 'company_backups' and action = 'backup') = 5,
  'back up now is written to the Activity log');
select tests.check((select count(*) from public.company_backups where company_id = :'co' and kind = 'manual') = 5, 'five manual copies');

-- ---- 4. Retention ---------------------------------------------------------------------
delete from public.company_backups where company_id = :'co';
select tests.check((select count(*) from public.company_backup_data where company_id = :'co') = 0, 'deleting a backup removes its data');
select count(public.take_company_backup(:'co', 'daily', null, timestamptz '2026-09-01 03:00+03' + make_interval(days => g)))
  from generate_series(1, 10) g \gset r_
select tests.check((select count(*) from public.company_backups where company_id = :'co' and kind = 'daily') = 7
                   and (select min(local_day) from public.company_backups where company_id = :'co' and kind = 'daily') = '2026-09-05',
  'retention: the last 7 daily copies are kept');
select count(public.take_company_backup(:'co', 'weekly', null, timestamptz '2026-06-07 03:00+03' + make_interval(days => 7 * g)))
  from generate_series(0, 7) g \gset r_
select tests.check((select count(*) from public.company_backups where company_id = :'co' and kind = 'weekly') = 5,
  'retention: the last 5 weekly copies are kept');
select count(public.take_company_backup(:'co', 'monthly', null, timestamptz '2025-01-01 03:00+03' + make_interval(months => g)))
  from generate_series(0, 14) g \gset r_
select tests.check((select count(*) from public.company_backups where company_id = :'co' and kind = 'monthly') = 12,
  'retention: the last 12 monthly copies are kept');
select count(public.take_company_backup(:'co', 'manual', :'boss', now() - make_interval(mins => g))) from generate_series(1, 12) g \gset r_
select tests.check((select count(*) from public.company_backups where company_id = :'co' and kind = 'manual') = 10,
  'retention: the last 10 manual copies are kept');
select tests.check((select count(*) from public.company_backup_data d where d.company_id = :'co')
                   = (select count(*) from public.company_backups where company_id = :'co'), 'retention removes the data too');
select tests.check((select count(*) from public.company_backups where company_id = :'other') = 0, 'retention never touches other companies');

-- ---- 5. The scheduled run ------------------------------------------------------------------
delete from public.company_backups;
select tests.blocked('select public.claim_company_backup(''wrong'')', 'scheduled run: wrong secret refused (claim)');
select tests.blocked('select public.claim_company_backup(null)', 'scheduled run: no secret refused (claim)');
select tests.blocked(format('select public.take_claimed_backup(%L, %L)', 'wrong', :'co'), 'scheduled run: wrong secret refused (take)');
select tests.blocked('select public.check_overdue_backups(''wrong'')', 'scheduled run: wrong secret refused (overdue check)');
select public.set_outbox_secret('a-test-secret-that-is-long-enough') as msg \gset
set role anon;
select public.claim_company_backup('a-test-secret-that-is-long-enough') as claimed \gset
select tests.check(nullif(:'claimed', '') is null
                   or public.take_claimed_backup('a-test-secret-that-is-long-enough', nullif(:'claimed', '')::uuid) is not null,
  'scheduled run: claim and take work with the secret (as the server)');
select tests.check(public.check_overdue_backups('a-test-secret-that-is-long-enough') >= 0, 'scheduled run: overdue check works with the secret');
select tests.blocked('select public.run_company_backups(''a-test-secret-that-is-long-enough'')',
  'scheduled run: the all-in-one call is not open to the web server (it could time out and undo itself)');
select tests.blocked(format('select public.take_claimed_backup_at(%L, now())', :'co'), 'scheduled run: the internal steps are not callable');
reset role;
delete from public.company_backups;
delete from public.company_backup_state;
-- (each run is its own statement, so the checks after it see what it did)
select public.run_company_backups_at('2026-10-06 01:30+03') as n \gset
select tests.check(:n = 0 and (select count(*) from public.company_backups) = 0, 'scheduled run: nothing before 02:00 Tanzania time');
select public.run_company_backups_at('2026-10-06 02:05+03', 1) as n \gset
select tests.check(:n = 1 and (select count(*) from public.company_backups) = 1, 'scheduled run: a small batch at a time');
select public.run_company_backups_at('2026-10-06 02:10+03') as n \gset
select tests.check(:n = 1 and (select count(*) from public.company_backups where company_id in (:'co', :'other') and local_day = '2026-10-06') = 2,
  'scheduled run: the next run continues with the rest');
select tests.check((select kind from public.company_backups where company_id = :'co' and local_day = '2026-10-06') = 'daily',
  'scheduled run: Tuesday''s copy is a daily one');
select public.run_company_backups_at('2026-10-06 09:00+03') as n \gset
select tests.check(:n = 0 and (select count(*) from public.company_backups where company_id = :'co') = 1,
  'scheduled run: only one automatic copy per day');
select tests.check(not exists (select 1 from public.company_backups where company_id = :'demo'), 'scheduled run: demo companies are skipped');
select public.run_company_backups_at('2026-10-11 02:30+03') as n \gset
select tests.check(:n = 2 and (select kind from public.company_backups where company_id = :'co' and local_day = '2026-10-11') = 'weekly',
  'scheduled run: Sunday''s copy is a weekly one');
select public.run_company_backups_at('2026-10-12 03:00+03', 20, interval '0 seconds') as n \gset
select tests.check(:n = 1 and (select count(*) from public.company_backups where local_day = '2026-10-12') = 1,
  'scheduled run: stops after its time budget (always at least one company)');
-- A company whose backup fails is retried at most hourly, and other companies still get theirs.
create or replace function public.zz_bk_fail() returns trigger language plpgsql as $$
begin
  if new.company_id = current_setting('tests.fail_co', true)::uuid then raise exception 'disk full'; end if;
  return new;
end $$;
create trigger zz_bk_fail before insert on public.company_backups for each row execute function public.zz_bk_fail();
select set_config('tests.fail_co', :'co', false) as x \gset
select public.run_company_backups_at('2026-10-13 02:00+03') as n \gset
select tests.check(:n = 1
                   and not exists (select 1 from public.company_backups where company_id = :'co' and local_day = '2026-10-13')
                   and exists (select 1 from public.company_backups where company_id = :'other' and local_day = '2026-10-13')
                   and (select last_error like '%disk full%' from public.company_backup_state where company_id = :'co'),
  'scheduled run: one company failing does not stop the others; the error is kept');
select public.run_company_backups_at('2026-10-13 02:30+03') as n \gset
select tests.check(:n = 0 and (select last_attempt_at = '2026-10-13 02:00+03' from public.company_backup_state where company_id = :'co'),
  'scheduled run: a failing company is not retried within the hour');
drop trigger zz_bk_fail on public.company_backups;
drop function public.zz_bk_fail();
select public.run_company_backups_at('2026-10-13 03:05+03') as n \gset
select tests.check(:n = 1 and (select last_error is null from public.company_backup_state where company_id = :'co')
                   and exists (select 1 from public.company_backups where company_id = :'co' and local_day = '2026-10-13'),
  'scheduled run: retried an hour later and the error is cleared');

-- A backup stopped by the time limit cannot be caught inside the database, but the claim was saved
-- separately: the attempt and a "did not finish" note stay, and other companies go first next time.
update public.company_backup_state set last_attempt_at = '2026-10-13 00:00+03', last_error = null where company_id = :'co';
select public.claim_company_backup_at('2026-10-14 02:00+03') as claimed \gset
select tests.check(:'claimed' = :'co', 'claim: picks the company waiting longest');
create or replace function public.zz_bk_slow() returns trigger language plpgsql as $$
begin perform pg_sleep(3); return new; end $$;
create trigger zz_bk_slow before insert on public.company_backups for each row execute function public.zz_bk_slow();
\set ON_ERROR_STOP off
set statement_timeout = '300ms';
\echo '(expected: the next statement is cancelled by the time limit)'
select public.take_claimed_backup_at(:'co', '2026-10-14 02:00+03');
reset statement_timeout;
\set ON_ERROR_STOP on
drop trigger zz_bk_slow on public.company_backups;
drop function public.zz_bk_slow();
select tests.check(not exists (select 1 from public.company_backups where company_id = :'co' and local_day = '2026-10-14')
                   and (select last_attempt_at = '2026-10-14 02:00+03' and last_error like 'Started but did not finish%'
                          from public.company_backup_state where company_id = :'co'),
  'timeout: the attempt and a "did not finish" note are kept');
select public.claim_company_backup_at('2026-10-14 02:05+03') as claimed \gset
select tests.check(:'claimed' = :'other', 'timeout: the next run moves on to another company');
select public.take_claimed_backup_at(:'other', '2026-10-14 02:05+03') as b \gset
select tests.check(:'b' <> '' and (select last_error is null from public.company_backup_state where company_id = :'other'),
  'timeout: the other company is backed up');
select tests.check(public.claim_company_backup_at('2026-10-14 02:10+03') is null, 'timeout: the stopped company waits an hour before a retry');
select tests.check(public.claim_company_backup_at('2026-10-14 01:00+03') is null, 'claim: nothing before 02:00');

-- ---- 6. Overdue alerts and status -------------------------------------------------------------
update public.companies set created_at = '2026-09-01' where id in (:'co', :'other');
delete from public.notifications where kind = 'backup_overdue';
-- before 02:00: no copies, but the overdue check still runs
select public.run_company_backups_at('2026-10-15 01:00+03') as n \gset
select tests.check((select count(*) from public.notifications where company_id = :'co' and kind = 'backup_overdue') = 0,
  'overdue: no alert while the last copy is less than 2 days old');
select public.run_company_backups_at('2026-10-16 01:00+03') as n \gset
select tests.check((select count(*) from public.notifications where company_id = :'co' and kind = 'backup_overdue') = 1
                   and (select user_id = :'boss' and severity = 'attention' and link = '/settings/backups'
                          from public.notifications where company_id = :'co' and kind = 'backup_overdue'),
  'overdue: managers (only) are told when the last copy is more than 2 days old');
select tests.check((select last_error like 'Started but did not finish%' from public.company_backup_state where company_id = :'co'),
  'overdue: this includes a company whose backup keeps timing out');
select public.run_company_backups_at('2026-10-16 01:30+03') as n \gset
select tests.check((select count(*) from public.notifications where company_id = :'co' and kind = 'backup_overdue') = 1,
  'overdue: at most one alert a day');
select tests.check(not exists (select 1 from public.notifications where company_id = :'demo' and kind = 'backup_overdue'),
  'overdue: never for demo companies');
select tests.login('boss.bk@g.test'); set role authenticated;
select tests.check((public.company_backup_status(:'co') ->> 'last_auto_at') is not null
                   and (public.company_backup_status(:'co') ->> 'overdue')::boolean
                     =((select max(taken_at) from public.company_backups where company_id = :'co' and kind <> 'manual') < now() - interval '2 days'),
  'status: shows the last automatic copy and whether it is overdue');
reset role;

-- Deleting a company removes its backups.
delete from public.companies where id = :'other';
select tests.check(not exists (select 1 from public.company_backups where company_id = :'other')
                   and not exists (select 1 from public.company_backup_data where company_id = :'other'),
  'deleting a company deletes its backups');

-- Clean up the test-only tables so later test files see the normal schema.
drop table public.zz_bk_child, public.zz_bk_tokens, public.zz_bk_broken;
delete from public.app_secrets where name = 'outbox';
