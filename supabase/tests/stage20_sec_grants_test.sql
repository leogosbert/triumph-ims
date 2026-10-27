-- Security audit (stage 20): database-wide hygiene that every future migration must keep.
--  * the browser key (anon) can call only the two functions meant for the public internet;
--    the scheduled jobs' functions (outbox, backups, account deletion) are for the server (service role);
--  * every security-definer function has an empty search path; every table has RLS;
--  * no policy reads memberships directly (two-step is enforced only through is_member / has_role);
--  * no write policy is simply `true`; every view runs with the reader's rights;
--  * document numbers are unique per company.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon, service_role;
create or replace function tests.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAILED: %', p_label; end if;
  raise notice 'pass: %', p_label;
end $$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

-- What anon can call today (printed for the record).
select 'anon can call: ' || p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
   and p.proname not in ('api_read', 'public_price_list') order by 1;

-- ---- 1. The browser key ---------------------------------------------------------------------------
select tests.check(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
       and p.proname not in ('api_read', 'public_price_list')),
  'anon (the public browser key) can call only api_read and public_price_list');
select tests.check(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in ('take_claimed_backup', 'claim_company_backup', 'finish_deletion', 'claim_due_deletion')
       and has_function_privilege('authenticated', p.oid, 'execute')),
  'signed-in users cannot call the backup / deletion job functions either');
-- (Every form of each: claim_outbox also has a one-company form, 20261028000500_polish_fixes.sql.)
select tests.check((select count(distinct p.proname) = 12 and bool_and(has_function_privilege('service_role', p.oid, 'execute'))
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public'
                       and p.proname in ('run_all_alerts', 'claim_outbox', 'drop_push_endpoints', 'claim_company_backup', 'take_claimed_backup',
                                         'check_overdue_backups', 'claim_due_deletion', 'finish_deletion', 'claim_account_emails',
                                         'run_platform_daily_summary', 'claim_platform_outbox', 'verify_next_backup')),
  'the server (service role) can still run every scheduled job');
select tests.check(not exists (
    select 1 from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public'),
  'anon has no table rights at all');

-- ---- 2. Functions ---------------------------------------------------------------------------------
select tests.check(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and not coalesce('search_path=""' = any (p.proconfig), false)),
  'every security-definer function has an empty search path');

-- ---- 3. Tables and policies -----------------------------------------------------------------------
select tests.check(not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  'every table has row-level security');
select tests.check(not exists (
    select 1 from pg_policies where schemaname in ('public', 'storage')
       and (coalesce(qual, '') ~ '\mmemberships\M' or coalesce(with_check, '') ~ '\mmemberships\M')),
  'no policy reads memberships directly (two-step goes through is_member / has_role)');
select tests.check(not exists (
    select 1 from pg_policies where schemaname in ('public', 'storage') and cmd <> 'SELECT'
       and (coalesce(qual, '') ~ '^\(?true\)?$' or coalesce(with_check, '') ~ '^\(?true\)?$')),
  'no insert / update / delete policy is simply true');
select tests.check(not exists (
    select 1 from pg_policies where schemaname in ('public', 'storage') and 'anon' = any (roles)),
  'no policy is written for anon');
select tests.check(not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and not coalesce('security_invoker=true' = any (c.reloptions), false)),
  'every view is security_invoker');

-- ---- 4. Document numbers are unique per company ---------------------------------------------------
select 'number without a unique key: ' || c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'number' and not a.attisdropped
 where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'employee_certificates'
   and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indisunique and a.attnum = any (i.indkey::int2[]))
 order by 1;
select tests.check(not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'number' and not a.attisdropped
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname <> 'employee_certificates'   -- the certificate's own number, written by people
       and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indisunique and a.attnum = any (i.indkey::int2[]))),
  'every document number (job, project, asset, hire, contract, HSE, NCR...) is unique per company');

-- ---- 5. Dates are Dar es Salaam dates, not the server's UTC date ----------------------------------
select 'uses current_date: ' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosrc ~* '\mcurrent_date\M' order by 1;
select tests.check(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosrc ~* '\mcurrent_date\M'),
  'no function uses current_date (UTC on Supabase; Tanzania is 3 hours ahead)');
select tests.check(not exists (
    select 1 from information_schema.columns where table_schema = 'public' and column_default ~* 'current_date'),
  'no column defaults to current_date');
