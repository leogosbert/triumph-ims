-- =====================================================================
-- Stronger backups: every copy is checked, and a copy can be put back.
--
-- Builds on 20261014000200_auto_backups.sql (run that first).
--
-- 1. Checking. Each copy is opened again by the scheduled job and checked:
--    the SHA-256 still matches, it belongs to the right company, the
--    number of records per table matches, and every record still fits its
--    table today (the real test that it can be put back). Every copy is
--    re-checked once a week. A failed check tells the company's managers
--    and LeMo Tech.
-- 2. Restore preview (managers): per area, how many records the copy has
--    and how many there are now.
-- 3. Restore request (managers, after confirming it is them): LeMo Tech is
--    told at once. One open request per company. The copy it names is kept
--    (not deleted by the clean-up) until the request is handled.
-- 4. Restore (LeMo Tech platform administrators only, after typing the
--    company name). In one transaction:
--      * the copy is checked again (a failed copy is never restored);
--      * a safety copy of the data as it is now is taken first, so a
--        restore can itself be undone by restoring the safety copy;
--      * the company's records are replaced by the ones in the copy;
--      * records that would now point at something missing (a person who
--        left, an item deleted later) are cleared or removed, then every
--        link is checked again; if anything is still wrong, nothing at all
--        is changed.
--    NOT put back (stay as they are now): the team and invitations, company
--    settings and switched-on features, LeMoSp billing and paid services,
--    and document number counters (numbers never go backwards).
--    Very large companies: run restore_company_backup_sql(request) in the
--    Supabase SQL editor (no time limit there).
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
alter table public.company_backups add column if not exists verified_at timestamptz;
alter table public.company_backups add column if not exists verify_ok   boolean;
alter table public.company_backups add column if not exists verify_note text;
alter table public.company_backups add column if not exists note        text;
create index if not exists company_backups_verify_idx on public.company_backups (verified_at nulls first, taken_at desc);

create table if not exists public.backup_restore_requests (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  backup_id        uuid references public.company_backups (id) on delete set null,
  backup_taken_at  timestamptz not null,
  note             text,
  status           text not null default 'requested' check (status in ('requested', 'done', 'cancelled', 'failed')),
  requested_by     uuid references auth.users (id) on delete set null,
  requested_at     timestamptz not null default now(),
  handled_by       uuid references auth.users (id) on delete set null,
  handled_at       timestamptz,
  safety_backup_id uuid references public.company_backups (id) on delete set null,
  result           jsonb
);
create unique index if not exists backup_restore_requests_one_open
  on public.backup_restore_requests (company_id) where status = 'requested';
create index if not exists backup_restore_requests_company_idx on public.backup_restore_requests (company_id, requested_at desc);

alter table public.backup_restore_requests enable row level security;
drop policy if exists backup_restore_requests_select on public.backup_restore_requests;
create policy backup_restore_requests_select on public.backup_restore_requests
  for select to authenticated using (public.is_manager(company_id) or public.is_platform_admin());
revoke all on public.backup_restore_requests from public, anon, authenticated;
grant select on public.backup_restore_requests to authenticated;

-- Restore requests are about the backups, not business records: never inside a backup.
create or replace function public.backup_excluded_tables()
returns text[] language sql immutable set search_path = ''
as $$
  select array['company_backups', 'company_backup_data', 'company_backup_state', 'app_secrets', 'push_subscriptions',
               'notification_settings', 'notifications', 'audit_log', 'security_events', 'demo_starts',
               'company_closures', 'backup_restore_requests'];
$$;

-- In a backup, but left as they are now when a copy is put back.
create or replace function public.restore_kept_tables()
returns text[] language sql immutable set search_path = ''
as $$
  select array['memberships', 'invitations',                                    -- the team: nobody who left comes back
               'company_features', 'company_profiles', 'company_growth_state',   -- company settings
               'company_recommendations',
               'company_billing', 'platform_invoices', 'platform_invoice_lines', -- LeMoSp billing and paid services
               'service_requests', 'assistant_usage',
               'code_counters'];                                                 -- document numbers never go backwards
$$;

-- Clean-up keeps a copy that an open restore request names.
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
     and r.rn > case r.kind when 'daily' then 7 when 'weekly' then 5 when 'monthly' then 12 else 10 end
     and not exists (select 1 from public.backup_restore_requests q
                      where q.backup_id = b.id and q.status = 'requested');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Checking a copy (internal)
-- ---------------------------------------------------------------------
-- Returns true when the copy is good, false when not (the reason is saved
-- in verify_note), null when the backup does not exist.
create or replace function public.verify_company_backup_at(p_backup uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  b        public.company_backups;
  v_data   jsonb;
  v_bad    text[] := '{}';
  v_info   text[] := '{}';
  v_key    text;
  v_rows   jsonb;
  v_n      integer;
  v_ok     boolean;
  v_name   text;
begin
  select * into b from public.company_backups where id = p_backup;
  if b.id is null then
    return null;
  end if;
  select d.data into v_data from public.company_backup_data d where d.backup_id = p_backup;
  if v_data is null then
    v_bad := v_bad || 'The copy itself is missing.'::text;
  else
    if encode(sha256(convert_to(v_data::text, 'UTF8')), 'hex') <> b.checksum then
      v_bad := v_bad || 'The checksum does not match: the copy has changed since it was taken.'::text;
    end if;
    if v_data ->> 'format' is distinct from 'lemosp-backup'
       or (v_data -> 'company' ->> 'id') is distinct from b.company_id::text then
      v_bad := v_bad || 'The copy does not belong to this company.'::text;
    end if;
    for v_key, v_rows in select * from jsonb_each(coalesce(v_data -> 'tables', '{}'::jsonb)) loop
      if jsonb_typeof(v_rows) is distinct from 'array'
         or jsonb_array_length(v_rows) is distinct from (v_data -> 'counts' ->> v_key)::integer then
        v_bad := v_bad || format('%s: the number of records does not match', v_key);
        continue;
      end if;
      if to_regclass(format('public.%I', v_key)) is null then
        v_info := v_info || format('%s: no longer in the app (skipped when restoring)', v_key);
        continue;
      end if;
      begin
        -- Every record must still fit the table as it is today.
        execute format('select count(*)::int from jsonb_populate_recordset(null::public.%I, $1)', v_key)
           into v_n using v_rows;
        if exists (select 1 from jsonb_array_elements(v_rows) e
                    where e ? 'company_id' and e ->> 'company_id' is distinct from b.company_id::text) then
          v_bad := v_bad || format('%s: has records of another company', v_key);
        end if;
      exception when others then
        v_bad := v_bad || format('%s: %s', v_key, left(sqlerrm, 200));
      end;
    end loop;
  end if;

  v_ok := cardinality(v_bad) = 0;
  update public.company_backups
     set verified_at = now(), verify_ok = v_ok,
         verify_note = nullif(left(array_to_string(v_bad || v_info, '; '), 1000), '')
   where id = p_backup;

  -- Tell the managers and LeMo Tech, once per copy.
  if not v_ok and b.verify_ok is distinct from false then
    begin
      select c.name into v_name from public.companies c where c.id = b.company_id;
      perform public.notify_roles(b.company_id, array['management']::public.app_role[], null, 'backup_check_failed',
        'attention', 'A backup failed its check',
        'One of your backups could not be checked. Your other backups are not affected. LeMo Tech has been told.',
        '/settings/backups/' || b.id::text, 'backup-check:' || b.id::text);
      perform public.platform_notify('backup_check_failed', 'Backup check failed: ' || coalesce(v_name, '?'),
        left(array_to_string(v_bad, '; '), 400), '/admin/backups', 'urgent', b.company_id,
        'backup-check:' || b.id::text);
    exception when others then
      raise warning 'Backup check notification failed: %', sqlerrm;
    end;
  end if;
  return v_ok;
end;
$$;

-- The next copy to check: never-checked copies first (newest first), then
-- copies last checked more than 7 days ago. Returns the backup id, or null.
create or replace function public.verify_next_backup_at(p_now timestamptz)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  select b.id into v_id
    from public.company_backups b
   where b.verified_at is null or b.verified_at < p_now - interval '7 days'
   order by (b.verified_at is null) desc, b.verified_at asc nulls first, b.taken_at desc
   limit 1
   for update skip locked;
  if v_id is null then
    return null;
  end if;
  perform public.verify_company_backup_at(v_id);
  return v_id;
end;
$$;

-- For the server's scheduled job (/api/outbox), with the outbox secret.
create or replace function public.verify_next_backup(p_secret text)
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return public.verify_next_backup_at(now());
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Restore preview (managers)
-- ---------------------------------------------------------------------
create or replace function public.backup_restore_preview(p_backup uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  b       public.company_backups;
  v_data  jsonb;
  p       record;
  v_now   integer;
  v_list  jsonb := '[]'::jsonb;
begin
  select * into b from public.company_backups where id = p_backup;
  if b.id is null or not (public.is_manager(b.company_id) or public.is_platform_admin()) then
    raise exception 'Backup not found.' using errcode = '42501';
  end if;
  select d.data into v_data from public.company_backup_data d where d.backup_id = p_backup;
  if v_data is null then
    raise exception 'Backup not found.' using errcode = 'P0002';
  end if;
  for p in select * from public.backup_table_plan()
            where skipped is null or (v_data -> 'tables') ? table_name loop
    v_now := null;
    if p.skipped is null then
      begin
        if p.parent_table is null then
          execute format('select count(*)::int from public.%I x where x.company_id = $1', p.table_name)
             into v_now using b.company_id;
        elsif p.parent_table = 'companies' then
          execute format('select count(*)::int from public.%I x where x.%I = $1', p.table_name, p.fk_column)
             into v_now using b.company_id;
        else
          execute format('select count(*)::int from public.%I x where x.%I in (select y.%I from public.%I y where y.company_id = $1)',
                         p.table_name, p.fk_column, p.parent_column, p.parent_table)
             into v_now using b.company_id;
        end if;
      exception when others then
        v_now := null;
      end;
    end if;
    v_list := v_list || jsonb_build_object(
      'table', p.table_name,
      'in_backup', coalesce((v_data -> 'counts' ->> p.table_name)::integer, 0),
      'now', v_now,
      'kept', p.table_name = any (public.restore_kept_tables()));
  end loop;
  return jsonb_build_object('backup_id', b.id, 'taken_at', b.taken_at, 'tables', v_list);
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Restore requests (managers)
-- ---------------------------------------------------------------------
create or replace function public.request_backup_restore(p_backup uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  b      public.company_backups;
  v_name text;
  v_id   uuid;
begin
  select * into b from public.company_backups where id = p_backup;
  if b.id is null or not public.is_manager(b.company_id) then
    raise exception 'Backup not found.' using errcode = '42501';
  end if;
  if not public.recent_auth(10) then
    raise exception 'Please confirm it is you first.' using errcode = '28000', hint = 'reauth';
  end if;
  if b.verify_ok is false then
    raise exception 'This backup failed its check and cannot be restored. Please choose another one.' using errcode = '22023';
  end if;
  if exists (select 1 from public.backup_restore_requests where company_id = b.company_id and status = 'requested') then
    raise exception 'A restore is already requested. Cancel it first to choose another backup.' using errcode = '23505';
  end if;
  insert into public.backup_restore_requests (company_id, backup_id, backup_taken_at, note, requested_by)
  values (b.company_id, b.id, b.taken_at, nullif(left(btrim(coalesce(p_note, '')), 500), ''), auth.uid())
  returning id into v_id;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (b.company_id, auth.uid(), 'restore_requested', 'company_backups', b.id::text,
          jsonb_build_object('taken_at', b.taken_at, 'request', v_id));
  select c.name into v_name from public.companies c where c.id = b.company_id;
  perform public.platform_notify('backup_restore', 'Restore requested: ' || coalesce(v_name, '?'),
    'Put back the backup of ' || to_char(b.taken_at at time zone 'Africa/Dar_es_Salaam', 'DD Mon YYYY HH24:MI')
      || coalesce('. Note: ' || nullif(left(btrim(coalesce(p_note, '')), 300), ''), '') || '.',
    '/admin/backups', 'urgent', b.company_id, 'restore-request:' || v_id::text);
  return v_id;
end;
$$;

create or replace function public.cancel_backup_restore(p_request uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  q public.backup_restore_requests;
begin
  select * into q from public.backup_restore_requests where id = p_request for update;
  if q.id is null or not public.is_manager(q.company_id) then
    raise exception 'Request not found.' using errcode = '42501';
  end if;
  if q.status <> 'requested' then
    raise exception 'This request has already been handled.' using errcode = '22023';
  end if;
  update public.backup_restore_requests set status = 'cancelled', handled_by = auth.uid(), handled_at = now()
   where id = p_request;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (q.company_id, auth.uid(), 'restore_cancelled', 'backup_restore_requests', q.id::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Restore (internal; LeMo Tech only through the functions further down)
-- ---------------------------------------------------------------------
-- Rows that point at something that no longer exists, for the foreign keys
-- touching the restored tables: the link columns that may be empty are
-- cleared, otherwise the row is removed. Repeated because a removal can
-- leave others. With p_fix false it only counts what is still wrong.
create or replace function public.restore_fix_links(p_tables text[], p_fix boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  k        record;
  v_n      integer;
  v_label  text;
  v_report jsonb := '{}'::jsonb;
  v_found  boolean;
begin
  for pass in 1 .. 6 loop
    v_found := false;
    for k in
      select c.relname::text as tbl, fn.nspname::text as rschema, f.relname::text as rtbl,
             string_agg(format('x.%I', a.attname), ', ' order by u.i) as cols,
             string_agg(format('x.%I is not null', a.attname), ' and ' order by u.i) as all_set,
             string_agg(format('r.%I = x.%I', fa.attname, a.attname), ' and ' order by u.i) as matches,
             string_agg(format('%I = null', a.attname), ', ' order by u.i) filter (where not a.attnotnull) as clear
        from pg_catalog.pg_constraint con
        join pg_catalog.pg_class c on c.oid = con.conrelid
        join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
        join pg_catalog.pg_class f on f.oid = con.confrelid
        join pg_catalog.pg_namespace fn on fn.oid = f.relnamespace
        cross join lateral unnest(con.conkey, con.confkey) with ordinality as u (k, fk, i)
        join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = u.k
        join pg_catalog.pg_attribute fa on fa.attrelid = f.oid and fa.attnum = u.fk
       where con.contype = 'f'
         and (c.relname = any (p_tables) or (fn.nspname = 'public' and f.relname = any (p_tables)))
       group by con.oid, c.relname, fn.nspname, f.relname
       order by c.relname, con.oid
    loop
      execute format('select count(*)::int from public.%I x where %s and not exists (select 1 from %I.%I r where %s)',
                     k.tbl, k.all_set, k.rschema, k.rtbl, k.matches) into v_n;
      continue when v_n = 0;
      v_found := true;
      v_label := k.tbl || ' (' || replace(k.cols, 'x.', '') || ')';
      if not p_fix then
        v_report := v_report || jsonb_build_object(v_label, v_n);
        continue;
      end if;
      if k.clear is null then
        execute format('delete from public.%I x where %s and not exists (select 1 from %I.%I r where %s)',
                       k.tbl, k.all_set, k.rschema, k.rtbl, k.matches);
        v_label := v_label || ' removed';
      else
        execute format('update public.%I x set %s where %s and not exists (select 1 from %I.%I r where %s)',
                       k.tbl, k.clear, k.all_set, k.rschema, k.rtbl, k.matches);
        v_label := v_label || ' cleared';
      end if;
      v_report := v_report || jsonb_build_object(v_label, coalesce((v_report ->> v_label)::int, 0) + v_n);
    end loop;
    exit when not v_found or not p_fix;
  end loop;
  return v_report;
end;
$$;

create or replace function public.restore_company_backup_at(p_backup uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  b         public.company_backups;
  v_data    jsonb;
  v_co      uuid;
  p         record;
  v_rows    jsonb;
  v_cols    text;
  v_n       integer;
  v_tables  text[] := '{}';
  v_deleted jsonb := '{}'::jsonb;
  v_added   jsonb := '{}'::jsonb;
  v_skipped text[] := '{}';
  v_fixed   jsonb;
  v_left    jsonb;
  v_safety  uuid;
  v_when    text;
begin
  select * into b from public.company_backups where id = p_backup;
  if b.id is null then
    raise exception 'Backup not found.' using errcode = 'P0002';
  end if;
  v_co := b.company_id;
  if public.verify_company_backup_at(p_backup) is not true then
    raise exception 'This backup failed its check and cannot be restored: %',
      (select verify_note from public.company_backups where id = p_backup) using errcode = '22023';
  end if;
  select d.data into v_data from public.company_backup_data d where d.backup_id = p_backup;
  v_when := to_char(b.taken_at at time zone 'Africa/Dar_es_Salaam', 'DD Mon YYYY HH24:MI');

  -- A safety copy of the data as it is now (so this restore can be undone).
  v_safety := public.take_company_backup(v_co, 'manual', p_actor, now());
  update public.company_backups set note = 'Safety copy taken before restoring the backup of ' || v_when
   where id = v_safety;

  -- The tables to put back: in the copy, still in the app, not secret, not kept as they are.
  for p in select * from public.backup_table_plan()
            where skipped is null and (v_data -> 'tables') ? table_name
              and not (table_name = any (public.restore_kept_tables())) loop
    v_tables := v_tables || p.table_name;
  end loop;
  select coalesce(array_agg(k), '{}') into v_skipped
    from jsonb_object_keys(v_data -> 'tables') k
   where not (k = any (v_tables)) and not (k = any (public.restore_kept_tables()));

  -- Triggers (status rules, stock totals, alerts, ...) and link checks are off for
  -- this transaction only: the records go back exactly as they were. Links are
  -- checked by hand below.
  perform set_config('session_replication_role', 'replica', true);

  -- Remove the current records (child tables first: nothing cascades while triggers are off).
  for p in select * from public.backup_table_plan() where table_name = any (v_tables)
            order by (parent_table is not null) desc, table_name loop
    if p.parent_table is null then
      execute format('delete from public.%I x where x.company_id = $1', p.table_name) using v_co;
    elsif p.parent_table = 'companies' then
      execute format('delete from public.%I x where x.%I = $1', p.table_name, p.fk_column) using v_co;
    else
      execute format('delete from public.%I x where x.%I in (select y.%I from public.%I y where y.company_id = $1)',
                     p.table_name, p.fk_column, p.parent_column, p.parent_table) using v_co;
    end if;
    get diagnostics v_n = row_count;
    v_deleted := v_deleted || jsonb_build_object(p.table_name, v_n);
  end loop;

  -- Put the copy's records back. Columns added since the copy get their defaults.
  foreach v_cols in array v_tables loop  -- v_cols holds the table name here
    v_rows := v_data -> 'tables' -> v_cols;
    if jsonb_array_length(v_rows) = 0 then
      v_added := v_added || jsonb_build_object(v_cols, 0);
      continue;
    end if;
    declare
      v_list text;
    begin
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_list
        from pg_catalog.pg_attribute a
       where a.attrelid = format('public.%I', v_cols)::regclass and a.attnum > 0 and not a.attisdropped
         and a.attgenerated = '' and (v_rows -> 0) ? a.attname::text;
      execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1)',
                     v_cols, v_list, v_list, v_cols) using v_rows;
      get diagnostics v_n = row_count;
      v_added := v_added || jsonb_build_object(v_cols, v_n);
    end;
  end loop;

  -- Links: clear or remove what points at something missing, then check again.
  v_fixed := public.restore_fix_links(v_tables, true);
  v_left := public.restore_fix_links(v_tables, false);
  perform set_config('session_replication_role', 'origin', true);
  if v_left <> '{}'::jsonb then
    raise exception 'The restore was stopped and nothing was changed: some records still point at something missing (%).', v_left
      using errcode = '23503';
  end if;

  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (v_co, p_actor, 'restore', 'company_backups', b.id::text,
          jsonb_build_object('taken_at', b.taken_at, 'safety_backup', v_safety, 'added', v_added, 'fixed', v_fixed));
  begin
    perform public.notify_roles(v_co, array['management']::public.app_role[], null, 'backup_restored', 'info',
      'Your data was restored',
      'Your records were put back to the backup of ' || v_when || '. A safety copy of the data as it was just before is under Settings → Backups.',
      '/settings/backups', 'backup-restored:' || b.id::text || ':' || v_safety::text);
  exception when others then
    raise warning 'Restore notification failed: %', sqlerrm;
  end;

  return jsonb_build_object('backup_id', b.id, 'taken_at', b.taken_at, 'safety_backup_id', v_safety,
                            'removed', v_deleted, 'added', v_added, 'fixed', v_fixed,
                            'not_restored', to_jsonb(v_skipped));
end;
$$;

-- Handles one request: restore, then mark it done. If the restore fails,
-- nothing is changed and the request is marked failed with the reason.
create or replace function public.handle_restore_request(p_request uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  q        public.backup_restore_requests;
  v_result jsonb;
begin
  select * into q from public.backup_restore_requests where id = p_request for update;
  if q.id is null then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if q.status <> 'requested' then
    raise exception 'This request has already been handled.' using errcode = '22023';
  end if;
  if q.backup_id is null then
    raise exception 'The backup of this request no longer exists.' using errcode = 'P0002';
  end if;
  begin
    v_result := public.restore_company_backup_at(q.backup_id, p_actor);
  exception when others then
    update public.backup_restore_requests
       set status = 'failed', handled_by = p_actor, handled_at = now(),
           result = jsonb_build_object('error', left(sqlerrm, 1000))
     where id = p_request;
    return jsonb_build_object('error', left(sqlerrm, 1000));
  end;
  update public.backup_restore_requests
     set status = 'done', handled_by = p_actor, handled_at = now(),
         safety_backup_id = (v_result ->> 'safety_backup_id')::uuid, result = v_result
   where id = p_request;
  return v_result;
end;
$$;

-- LeMo Tech, from the admin site: platform admin, a recent sign-in, and the
-- exact company name typed.
create or replace function public.restore_company_backup(p_request uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  perform public.require_platform_admin();
  if not public.recent_auth(10) then
    raise exception 'Please confirm it is you first.' using errcode = '28000', hint = 'reauth';
  end if;
  select c.name into v_name
    from public.backup_restore_requests q join public.companies c on c.id = q.company_id
   where q.id = p_request;
  if v_name is null then
    raise exception 'Request not found.' using errcode = 'P0002';
  end if;
  if btrim(coalesce(p_confirm, '')) is distinct from v_name then
    raise exception 'Type the company name exactly as shown to confirm.' using errcode = '22023';
  end if;
  return public.handle_restore_request(p_request, auth.uid());
end;
$$;

-- LeMo Tech, from the Supabase SQL editor (no time limit, for very large
-- companies): select public.restore_company_backup_sql('<request id>');
-- Only the database owner can run it.
create or replace function public.restore_company_backup_sql(p_request uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  return public.handle_restore_request(p_request, null);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Backup health of every company (LeMo Tech admin site)
-- ---------------------------------------------------------------------
create or replace function public.platform_backup_health()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return jsonb_build_object(
    'companies', coalesce((
      select jsonb_agg(x order by x.overdue desc, x.failed_checks desc, x.name)
        from (
          select co.id, co.name,
                 (select max(b.taken_at) from public.company_backups b
                   where b.company_id = co.id and b.kind <> 'manual') as last_auto_at,
                 (select count(*) from public.company_backups b where b.company_id = co.id)::int as copies,
                 (select coalesce(sum(b.bytes), 0) from public.company_backups b where b.company_id = co.id)::bigint as bytes,
                 (select count(*) from public.company_backups b
                   where b.company_id = co.id and b.verify_ok is false)::int as failed_checks,
                 (select max(b.verified_at) from public.company_backups b
                   where b.company_id = co.id and b.verify_ok) as last_check_at,
                 s.last_error, s.last_attempt_at,
                 coalesce((select max(b.taken_at) from public.company_backups b
                            where b.company_id = co.id and b.kind <> 'manual'), co.created_at)
                   < now() - interval '2 days' as overdue
            from public.companies co
            left join public.company_backup_state s on s.company_id = co.id
           where not co.is_demo
        ) x), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', q.id, 'company_id', q.company_id, 'company', c.name, 'backup_id', q.backup_id,
               'backup_taken_at', q.backup_taken_at, 'note', q.note, 'status', q.status,
               'requested_at', q.requested_at, 'handled_at', q.handled_at, 'result', q.result,
               'requested_by', (select u.email from auth.users u where u.id = q.requested_by))
             order by (q.status = 'requested') desc, q.requested_at desc)
        from public.backup_restore_requests q
        join public.companies c on c.id = q.company_id
       where q.status = 'requested' or q.requested_at > now() - interval '60 days'), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
revoke execute on function
  public.backup_excluded_tables(),
  public.restore_kept_tables(),
  public.prune_company_backups(uuid),
  public.verify_company_backup_at(uuid),
  public.verify_next_backup_at(timestamptz),
  public.verify_next_backup(text),
  public.backup_restore_preview(uuid),
  public.request_backup_restore(uuid, text),
  public.cancel_backup_restore(uuid),
  public.restore_fix_links(text[], boolean),
  public.restore_company_backup_at(uuid, uuid),
  public.handle_restore_request(uuid, uuid),
  public.restore_company_backup(uuid, text),
  public.restore_company_backup_sql(uuid),
  public.platform_backup_health()
from public, anon, authenticated;

grant execute on function
  public.backup_restore_preview(uuid),
  public.request_backup_restore(uuid, text),
  public.cancel_backup_restore(uuid),
  public.restore_company_backup(uuid, text),
  public.platform_backup_health()
to authenticated;

grant execute on function public.verify_next_backup(text) to anon, authenticated;

notify pgrst, 'reload schema';
