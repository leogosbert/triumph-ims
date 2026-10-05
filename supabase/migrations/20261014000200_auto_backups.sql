-- =====================================================================
-- Automatic backups inside the app (one copy per company).
--
-- Every company (not demo companies) gets an automatic copy of all its
-- business records once a day, early in the morning (Tanzania time):
--   * a normal day's copy is a 'daily' one, Sunday's is 'weekly' and the
--     1st of the month's is 'monthly' (one copy a day, never two);
--   * managers can also press "Back up now" ('manual', up to 5 a day);
--   * kept: the last 7 daily, 5 weekly, 12 monthly and 10 manual copies.
--
-- Design:
--   company_backups      what managers can see: date, kind, size, records,
--                        checksum. No business data in this table.
--   company_backup_data  the copy itself (one jsonb per backup). RLS on and
--                        NO policy, all privileges revoked: nobody reads it
--                        directly. A separate table is cleaner than
--                        column privileges (select * keeps working on the
--                        list, and the data never travels with it).
--                        The only way out is download_company_backup(),
--                        which checks the manager, (when available) a
--                        recent sign-in, and writes the Activity log.
--   company_backup_state last attempt / error per company (internal), used
--                        to retry at most hourly and to send the
--                        "backup did not run" alert once a day.
--
-- The scheduled job (/api/outbox every 5 minutes), right after the alerts,
-- calls claim_company_backup + take_claimed_backup for a few companies and
-- then check_overdue_backups: separate short calls, each saved on its own,
-- so a time-out on one big company never undoes the rest.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.company_backups (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  kind        text not null check (kind in ('daily', 'weekly', 'monthly', 'manual')),
  taken_at    timestamptz not null default now(),
  local_day   date not null,
  tables      integer not null default 0,
  rows        integer not null default 0,
  bytes       integer not null default 0,
  checksum    text not null,
  warnings    text[] not null default '{}',
  created_by  uuid references auth.users (id) on delete set null
);
create index if not exists company_backups_company_idx on public.company_backups (company_id, taken_at desc);
-- At most one automatic copy per company per (Tanzania) day, even if two runs overlap.
create unique index if not exists company_backups_one_auto_per_day
  on public.company_backups (company_id, local_day) where kind <> 'manual';

create table if not exists public.company_backup_data (
  backup_id   uuid primary key references public.company_backups (id) on delete cascade,
  company_id  uuid not null references public.companies (id) on delete cascade,
  data        jsonb not null
);

create table if not exists public.company_backup_state (
  company_id          uuid primary key references public.companies (id) on delete cascade,
  last_attempt_at     timestamptz,
  last_error          text,
  overdue_notified_on date
);

alter table public.company_backups      enable row level security;
alter table public.company_backup_data  enable row level security;
alter table public.company_backup_state enable row level security;

drop policy if exists company_backups_select on public.company_backups;
create policy company_backups_select on public.company_backups
  for select to authenticated using (public.is_manager(company_id));
-- company_backup_data and company_backup_state: no policies on purpose.

revoke all on public.company_backups, public.company_backup_data, public.company_backup_state from public, anon, authenticated;
grant select on public.company_backups to authenticated;

-- ---------------------------------------------------------------------
-- Which tables go into a backup
-- ---------------------------------------------------------------------
-- Every table in schema public with a company_id column, plus "child"
-- tables without company_id that point (one foreign key column) at such a
-- table. Today every child table (quotation lines, invoice lines, ...) has
-- its own company_id; the child rule is there for future tables.
--
-- Never included (explicit list):
--   company_backups, company_backup_data, company_backup_state  the backups themselves
--   app_secrets, push_subscriptions                               secrets / phone push keys
--   notification_settings, notifications                         personal alerts, re-created by the app
--   audit_log                                                     the Activity log: append-only, cannot be
--                                                                 edited by users, and grows without limit;
--                                                                 the nightly whole-system copy keeps it
--   security_events, demo_starts                                  sign-in / demo tracking (platform data)
-- Also never included: any table with a column whose name says it holds a
-- secret (token, secret, password, hash, api_key, private_key, p256dh ...).
create or replace function public.backup_excluded_tables()
returns text[] language sql immutable set search_path = ''
as $$
  select array['company_backups', 'company_backup_data', 'company_backup_state', 'app_secrets', 'push_subscriptions',
               'notification_settings', 'notifications', 'audit_log', 'security_events', 'demo_starts'];
$$;

create or replace function public.backup_table_plan()
returns table (table_name text, parent_table text, fk_column text, parent_column text, skipped text)
language sql stable security definer set search_path = ''
as $$
  with t as (
    select c.oid, c.relname::text as name,
           exists (select 1 from pg_catalog.pg_attribute a
                    where a.attrelid = c.oid and a.attname = 'company_id' and a.attnum > 0 and not a.attisdropped) as has_company,
           exists (select 1 from pg_catalog.pg_attribute a
                    where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
                      and a.attname ~* '(^|_)(token|tokens|secret|secrets|password|passwd|hash|api_?key|private_?key|p256dh|otp)(_|$)') as has_secret
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
       and c.relname <> 'companies'
  ),
  child as (
    -- one-column foreign keys from a table without company_id to a company table
    select distinct on (t.name) t.name, p.relname::text as parent, a.attname::text as fk, pa.attname::text as pcol
      from t
      join pg_catalog.pg_constraint k on k.conrelid = t.oid and k.contype = 'f' and array_length(k.conkey, 1) = 1
      join pg_catalog.pg_class p on p.oid = k.confrelid
      join pg_catalog.pg_namespace pn on pn.oid = p.relnamespace and pn.nspname = 'public'
      join pg_catalog.pg_attribute a on a.attrelid = t.oid and a.attnum = k.conkey[1]
      join pg_catalog.pg_attribute pa on pa.attrelid = p.oid and pa.attnum = k.confkey[1]
     where not t.has_company
       and (p.relname = 'companies'
            or exists (select 1 from pg_catalog.pg_attribute x
                        where x.attrelid = p.oid and x.attname = 'company_id' and x.attnum > 0 and not x.attisdropped))
     order by t.name, (p.relname = 'companies') desc, p.relname
  )
  select t.name,
         ch.parent,
         ch.fk,
         ch.pcol,
         case when t.name = any (public.backup_excluded_tables()) then 'excluded'
              when t.has_secret then 'holds secrets' end
    from t
    left join child ch on ch.name = t.name
   where t.has_company or ch.name is not null
   order by t.name;
$$;

-- ---------------------------------------------------------------------
-- Taking one backup (internal)
-- ---------------------------------------------------------------------
create or replace function public.backup_kind_for(p_day date)
returns text language sql immutable set search_path = ''
as $$
  select case when extract(day from p_day) = 1 then 'monthly'
              when extract(isodow from p_day) = 7 then 'weekly'
              else 'daily' end;
$$;

-- Keeps the last 7 daily, 5 weekly, 12 monthly and 10 manual copies.
create or replace function public.prune_company_backups(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from public.company_backups b
   using (select id, kind, row_number() over (partition by kind order by taken_at desc, id) as rn
            from public.company_backups where company_id = p_company) r
   where b.id = r.id
     and r.rn > case r.kind when 'daily' then 7 when 'weekly' then 5 when 'monthly' then 12 else 10 end;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Builds the copy and stores it. Returns the backup id, or null when an
-- automatic copy for that day already exists. A table that fails is left
-- out with a warning; the rest of the backup goes on.
create or replace function public.take_company_backup(p_company uuid, p_kind text, p_actor uuid default null,
                                                      p_at timestamptz default now())
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  co        public.companies;
  p         record;
  v_day     date := (p_at at time zone 'Africa/Dar_es_Salaam')::date;
  v_tables  jsonb := '{}'::jsonb;
  v_counts  jsonb := '{}'::jsonb;
  v_rows    jsonb;
  v_n       integer;
  v_total   integer := 0;
  v_ntables integer := 0;
  v_warn    text[] := '{}';
  v_skipped jsonb := '{}'::jsonb;
  v_data    jsonb;
  v_text    text;
  v_id      uuid;
begin
  if p_kind is null or p_kind not in ('daily', 'weekly', 'monthly', 'manual') then
    raise exception 'Unknown backup kind.' using errcode = '22023';
  end if;
  select * into co from public.companies where id = p_company;
  if co.id is null then
    raise exception 'Company not found.' using errcode = 'P0002';
  end if;
  if co.is_demo then
    raise exception 'Demo companies are not backed up.' using errcode = '22023';
  end if;
  if p_kind <> 'manual' and exists (select 1 from public.company_backups
                                     where company_id = p_company and kind <> 'manual' and local_day = v_day) then
    return null;
  end if;

  for p in select * from public.backup_table_plan() loop
    if p.skipped is not null then
      v_skipped := v_skipped || jsonb_build_object(p.table_name, p.skipped);
      continue;
    end if;
    begin
      if p.parent_table is null then
        execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb), count(*)::int from public.%I x where x.company_id = $1',
                       p.table_name)
           into v_rows, v_n using p_company;
      elsif p.parent_table = 'companies' then
        execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb), count(*)::int from public.%I x where x.%I = $1',
                       p.table_name, p.fk_column)
           into v_rows, v_n using p_company;
      else
        execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb), count(*)::int from public.%I x
                         where x.%I in (select y.%I from public.%I y where y.company_id = $1)',
                       p.table_name, p.fk_column, p.parent_column, p.parent_table)
           into v_rows, v_n using p_company;
      end if;
      v_tables := v_tables || jsonb_build_object(p.table_name, v_rows);
      v_counts := v_counts || jsonb_build_object(p.table_name, v_n);
      v_total := v_total + v_n;
      v_ntables := v_ntables + 1;
    exception when others then
      v_warn := v_warn || format('%s: %s', p.table_name, left(sqlerrm, 200));
    end;
  end loop;

  v_data := jsonb_build_object(
    'format', 'lemosp-backup',
    'version', 1,
    'kind', p_kind,
    'taken_at', p_at,
    'company', to_jsonb(co),
    'counts', v_counts,
    'not_included', v_skipped,
    'warnings', to_jsonb(v_warn),
    'tables', v_tables);
  v_text := v_data::text;

  insert into public.company_backups (company_id, kind, taken_at, local_day, tables, rows, bytes, checksum, warnings, created_by)
  values (p_company, p_kind, p_at, v_day, v_ntables, v_total, octet_length(v_text),
          encode(sha256(convert_to(v_text, 'UTF8')), 'hex'), v_warn, p_actor)
  on conflict (company_id, local_day) where kind <> 'manual' do nothing
  returning id into v_id;
  if v_id is null then
    return null;  -- another run took today's copy at the same moment
  end if;
  insert into public.company_backup_data (backup_id, company_id, data) values (v_id, p_company, v_data);

  perform public.prune_company_backups(p_company);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Scheduled backups, in short separate steps.
--
-- The server's scheduled job runs with a short time limit (Supabase stops
-- a call after a few seconds). A call stopped that way cannot be caught
-- inside the database: everything it did is undone. So the work is split
-- into separate calls, each saved on its own:
--   1. claim_company_backup(secret)        picks the next company and notes
--                                          the attempt (saved even if step 2
--                                          is stopped);
--   2. take_claimed_backup(secret, co)     takes that one company's copy;
--   3. check_overdue_backups(secret)       once-a-day alert to managers when
--                                          the last automatic copy is more
--                                          than 2 days old (whatever the
--                                          reason: errors, time-outs, no job).
-- The *_at versions are internal and take the time, so they can be tested.
-- ---------------------------------------------------------------------
create or replace function public.claim_company_backup_at(p_now timestamptz)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Africa/Dar_es_Salaam';
  v_day   date := (p_now at time zone 'Africa/Dar_es_Salaam')::date;
  v_id    uuid;
begin
  -- Today's automatic copy, from 02:00 Tanzania time (or the first run after it).
  if v_local::time < time '02:00' then
    return null;
  end if;
  select co.id into v_id
    from public.companies co
    left join public.company_backup_state s on s.company_id = co.id
   where not co.is_demo
     and not exists (select 1 from public.company_backups b
                      where b.company_id = co.id and b.kind <> 'manual' and b.local_day = v_day)
     and (s.last_attempt_at is null or s.last_attempt_at < p_now - interval '1 hour')
   -- companies that failed or were tried recently go last, so one problem company never blocks the others
   order by (s.last_error is not null), s.last_attempt_at asc nulls first,
            (select max(b.taken_at) from public.company_backups b where b.company_id = co.id and b.kind <> 'manual')
              asc nulls first,
            co.created_at
   limit 1
   for no key update of co skip locked;  -- does not block new records that point at the company
  if v_id is null then
    return null;
  end if;
  -- Marked "not finished" until step 2 succeeds: if step 2 is stopped, this note stays.
  insert into public.company_backup_state (company_id, last_attempt_at, last_error)
  values (v_id, p_now, 'Started but did not finish (stopped or timed out).')
  on conflict (company_id) do update set last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error;
  return v_id;
end;
$$;

create or replace function public.take_claimed_backup_at(p_company uuid, p_now timestamptz)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_day date := (p_now at time zone 'Africa/Dar_es_Salaam')::date;
  v_id  uuid;
begin
  if p_company is null or not exists (select 1 from public.companies where id = p_company and not is_demo) then
    return null;
  end if;
  begin
    v_id := public.take_company_backup(p_company, public.backup_kind_for(v_day), null, p_now);
    update public.company_backup_state set last_error = null where company_id = p_company;
  exception when others then
    update public.company_backup_state set last_error = left(sqlerrm, 500) where company_id = p_company;
    raise warning 'Backup failed for company %: %', p_company, sqlerrm;
    return null;
  end;
  return v_id;
end;
$$;

create or replace function public.check_overdue_backups_at(p_now timestamptz)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  c     record;
  v_day date := (p_now at time zone 'Africa/Dar_es_Salaam')::date;
  v_n   integer := 0;
begin
  for c in
    select co.id
      from public.companies co
      left join public.company_backup_state s on s.company_id = co.id
     where not co.is_demo
       and co.created_at < p_now - interval '2 days'
       and s.overdue_notified_on is distinct from v_day
       and coalesce((select max(b.taken_at) from public.company_backups b
                      where b.company_id = co.id and b.kind <> 'manual'), co.created_at) < p_now - interval '2 days'
     limit 50
  loop
    perform public.notify_roles(c.id, array['management']::public.app_role[], null, 'backup_overdue', 'attention',
      'Automatic backup did not run',
      'Your data has not been backed up automatically for more than 2 days. Press "Back up now" under Settings → Backups, and tell LeMo Tech support so we can fix it.',
      '/settings/backups', 'backup-overdue:' || v_day::text);
    insert into public.company_backup_state (company_id, overdue_notified_on) values (c.id, v_day)
    on conflict (company_id) do update set overdue_notified_on = excluded.overdue_notified_on;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- All three steps in one call (internal). Used by the tests and by the
-- optional in-database schedule (pg_cron, see GO-LIVE.md), which has no
-- short time limit.
create or replace function public.run_company_backups_at(p_now timestamptz, p_limit integer default 20,
                                                         p_budget interval default interval '1.5 seconds')
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_start timestamptz := clock_timestamp();
  v_done  integer := 0;
  v_co    uuid;
begin
  for i in 1 .. greatest(coalesce(p_limit, 20), 1) loop
    exit when i > 1 and clock_timestamp() - v_start > p_budget;
    v_co := public.claim_company_backup_at(p_now);
    exit when v_co is null;
    if public.take_claimed_backup_at(v_co, p_now) is not null then
      v_done := v_done + 1;
    end if;
  end loop;
  begin
    perform public.check_overdue_backups_at(p_now);
  exception when others then
    raise warning 'Backup overdue check failed: %', sqlerrm;
  end;
  return v_done;
end;
$$;

-- The three steps for the server's scheduled job (/api/outbox), protected
-- by the same secret as run_all_alerts.
create or replace function public.claim_company_backup(p_secret text)
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return public.claim_company_backup_at(now());
end;
$$;

create or replace function public.take_claimed_backup(p_secret text, p_company uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return public.take_claimed_backup_at(p_company, now());
end;
$$;

create or replace function public.check_overdue_backups(p_secret text)
returns integer language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return public.check_overdue_backups_at(now());
end;
$$;

-- Kept for compatibility: everything in one call. No longer callable from
-- the web server (one long call could be stopped by the time limit and undo
-- itself); only the database owner can run it.
create or replace function public.run_company_backups(p_secret text)
returns integer language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return public.run_company_backups_at(now());
end;
$$;

-- ---------------------------------------------------------------------
-- For managers
-- ---------------------------------------------------------------------
-- "Back up now": up to 5 a day per company.
create or replace function public.backup_now(p_company uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_demo boolean;
  v_day  date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_id   uuid;
  b      public.company_backups;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can back up the company''s data.' using errcode = '42501';
  end if;
  select is_demo into v_demo from public.companies where id = p_company for no key update;
  if coalesce(v_demo, false) then
    raise exception 'Demo companies are not backed up.' using errcode = '22023';
  end if;
  if (select count(*) from public.company_backups
       where company_id = p_company and kind = 'manual' and local_day = v_day) >= 5 then
    raise exception 'You can back up by hand 5 times a day. Automatic backups continue as normal.' using errcode = '22023';
  end if;
  v_id := public.take_company_backup(p_company, 'manual', auth.uid(), now());
  select * into b from public.company_backups where id = v_id;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (p_company, auth.uid(), 'backup', 'company_backups', v_id::text,
          jsonb_build_object('kind', 'manual', 'rows', b.rows, 'bytes', b.bytes));
  return v_id;
end;
$$;

-- The only way to read a copy. Manager of that company; if the app has a
-- "recent sign-in" check (public.recent_auth(minutes)), it must pass too.
-- Every download is written to the Activity log.
create or replace function public.download_company_backup(p_backup uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  b        public.company_backups;
  v_recent boolean;
  v_text   text;
begin
  select * into b from public.company_backups where id = p_backup;
  if b.id is null or not public.is_manager(b.company_id) then
    raise exception 'Backup not found.' using errcode = '42501';
  end if;
  if to_regprocedure('public.recent_auth(integer)') is not null then
    execute 'select public.recent_auth($1)' into v_recent using 10;
    if not coalesce(v_recent, false) then
      raise exception 'Please confirm it is you first.' using errcode = '28000', hint = 'reauth';
    end if;
  end if;
  select d.data::text into v_text from public.company_backup_data d where d.backup_id = p_backup;
  if v_text is null then
    raise exception 'Backup not found.' using errcode = 'P0002';
  end if;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (b.company_id, auth.uid(), 'download', 'company_backups', b.id::text,
          jsonb_build_object('kind', b.kind, 'taken_at', b.taken_at, 'bytes', b.bytes));
  return v_text;
end;
$$;

-- Status for the Backups page and the dashboard (managers only).
create or replace function public.company_backup_status(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_day  date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_last timestamptz;
  v_created timestamptz;
  v_demo boolean;
  s      public.company_backup_state;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can see backups.' using errcode = '42501';
  end if;
  select created_at, is_demo into v_created, v_demo from public.companies where id = p_company;
  select max(taken_at) into v_last from public.company_backups where company_id = p_company and kind <> 'manual';
  select * into s from public.company_backup_state where company_id = p_company;
  return jsonb_build_object(
    'last_auto_at', v_last,
    'last_any_at', (select max(taken_at) from public.company_backups where company_id = p_company),
    'overdue', not coalesce(v_demo, false)
               and coalesce(v_last, v_created) < now() - interval '2 days',
    'last_attempt_failed', s.last_error is not null,
    'last_attempt_at', s.last_attempt_at,
    'manual_today', (select count(*) from public.company_backups
                      where company_id = p_company and kind = 'manual' and local_day = v_day),
    'manual_limit', 5,
    'is_demo', coalesce(v_demo, false));
end;
$$;

-- ---------------------------------------------------------------------
-- Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
revoke execute on function
  public.backup_excluded_tables(),
  public.backup_table_plan(),
  public.backup_kind_for(date),
  public.prune_company_backups(uuid),
  public.take_company_backup(uuid, text, uuid, timestamptz),
  public.run_company_backups_at(timestamptz, integer, interval),
  public.run_company_backups(text),
  public.claim_company_backup_at(timestamptz),
  public.take_claimed_backup_at(uuid, timestamptz),
  public.check_overdue_backups_at(timestamptz),
  public.claim_company_backup(text),
  public.take_claimed_backup(text, uuid),
  public.check_overdue_backups(text),
  public.backup_now(uuid),
  public.download_company_backup(uuid),
  public.company_backup_status(uuid)
from public, anon, authenticated;

grant execute on function
  public.backup_now(uuid),
  public.download_company_backup(uuid),
  public.company_backup_status(uuid)
to authenticated;

-- The server calls these with the shared secret (like run_all_alerts).
-- run_company_backups(text) stays owner-only (see above).
grant execute on function
  public.claim_company_backup(text),
  public.take_claimed_backup(text, uuid),
  public.check_overdue_backups(text)
to anon, authenticated;

notify pgrst, 'reload schema';
