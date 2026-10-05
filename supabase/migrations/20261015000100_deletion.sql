-- =====================================================================
-- LeMoSp · Deleting your account and closing a company (v1.13)
--
-- 1. Delete my account (any signed-in real user, never demo guests)
--      request_account_deletion()  needs a recent sign-in ("confirm it is
--                                  you"). The account is deleted after 7
--                                  days. Straight away: every membership is
--                                  suspended (can be undone), phone push
--                                  subscriptions are removed and an email is
--                                  queued. The app then signs the person out
--                                  on every device.
--      cancel_account_deletion()   "Keep my account" during the 7 days:
--                                  memberships come back.
--    Refused while the person is the ONLY active manager of a company that
--    has other active members (make someone else manager first), or the only
--    member of a company (close the company, or close it in the same step).
--
-- 2. Close a company (management, not demo companies)
--      request_company_closure()   needs a recent sign-in. All the company's
--                                  data is deleted after 30 days. Straight
--                                  away: members who are not management lose
--                                  access (suspended, can be undone); every
--                                  member is told.
--      cancel_company_closure()    managers, during the 30 days.
--
-- 3. The final step runs from the scheduled job (/api/outbox), in short
--    separate calls protected by the outbox secret, like the backups:
--      claim_due_deletion(secret)              picks one due deletion and
--                                              notes the attempt;
--      finish_deletion(secret, kind, id)       does it.
--    Account: profile anonymised ("Deleted user"), personal rows deleted
--    (phone push, alert settings, devices, sign-in history, notifications),
--    memberships removed, email removed from invitations, and the sign-in
--    account anonymised and blocked (no email, phone, password, sign-in
--    methods, sessions or authenticator). Business records (quotations,
--    invoices, deliveries, Activity log …) stay exactly as they were and now
--    point at "Deleted user".
--    Company: everything deleted (files, records, backups, the company);
--    only an anonymous company_closures row (no name) is kept for counting.
--
-- Suspension uses the existing memberships.active flag (which is_member /
-- has_role / notifications already read), plus a marker column saying WHY,
-- so "Keep my account" / "Cancel closure" restore exactly what was switched
-- off. A trigger keeps a marked membership switched off whatever else tries
-- to switch it on (team page, invitations).
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columns and tables
-- ---------------------------------------------------------------------
alter table public.memberships
  add column if not exists suspended_for_deletion_at timestamptz,
  add column if not exists suspended_for_closure_at  timestamptz;

-- Set only by the functions below (companies has column-level update grants; this is not one).
alter table public.companies add column if not exists closing_after timestamptz;

create table if not exists public.account_deletions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null,          -- no foreign key: this row outlives the account
  name_hint        text,                   -- first letter of the name only (platform list)
  requested_at     timestamptz not null default now(),
  delete_after     timestamptz not null,
  status           text not null default 'scheduled',
  reason           text,
  cancelled_at     timestamptz,
  done_at          timestamptz,
  last_attempt_at  timestamptz,
  last_error       text
);
alter table public.account_deletions drop constraint if exists account_deletions_status_check;
alter table public.account_deletions add constraint account_deletions_status_check
  check (status in ('scheduled', 'cancelled', 'done'));
alter table public.account_deletions drop constraint if exists account_deletions_reason_check;
alter table public.account_deletions add constraint account_deletions_reason_check
  check (reason is null or char_length(reason) <= 500);
create unique index if not exists account_deletions_one_scheduled on public.account_deletions (user_id) where status = 'scheduled';
create index if not exists account_deletions_due_idx on public.account_deletions (delete_after) where status = 'scheduled';
create index if not exists account_deletions_user_idx on public.account_deletions (user_id, requested_at desc);

create table if not exists public.company_closures (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null,      -- no foreign key: kept (without the name) after the company is deleted
  company_name         text,
  requested_by         uuid references auth.users (id) on delete set null,
  account_deletion_id  uuid references public.account_deletions (id) on delete set null,
  requested_at         timestamptz not null default now(),
  delete_after         timestamptz not null,
  status               text not null default 'scheduled',
  cancelled_at         timestamptz,
  done_at              timestamptz,
  last_attempt_at      timestamptz,
  last_error           text
);
alter table public.company_closures drop constraint if exists company_closures_status_check;
alter table public.company_closures add constraint company_closures_status_check
  check (status in ('scheduled', 'cancelled', 'done'));
create unique index if not exists company_closures_one_scheduled on public.company_closures (company_id) where status = 'scheduled';
create index if not exists company_closures_due_idx on public.company_closures (delete_after) where status = 'scheduled';
create index if not exists company_closures_company_idx on public.company_closures (company_id, requested_at desc);

-- Only the functions below read or change these tables.
alter table public.account_deletions enable row level security;
alter table public.company_closures  enable row level security;
revoke all on public.account_deletions, public.company_closures from public, anon, authenticated;

-- Emails to one person that do not belong to a company (e.g. "your account will be deleted").
-- Sent by the scheduled job (claim_account_emails); sent rows are removed after 7 days.
create table if not exists public.account_emails (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  email       text not null,
  subject     text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists account_emails_unsent_idx on public.account_emails (created_at) where sent_at is null;
alter table public.account_emails enable row level security;
revoke all on public.account_emails from public, anon, authenticated;

-- Files of a closed company still to be removed from storage (logos, signatures, photos).
-- Newer Supabase refuses deleting storage files from SQL, so a platform admin removes them
-- from the admin app (Admin → Deletions → Remove files), allowed only for these folders.
-- (company_ref, not company_id: this row is platform bookkeeping, not company data.)
create table if not exists public.storage_cleanup (
  id           uuid primary key default gen_random_uuid(),
  bucket       text not null,
  prefix       text not null check (prefix ~ '^[0-9a-f-]{36}/$'),
  company_ref  uuid not null,
  created_at   timestamptz not null default now(),
  done_at      timestamptz,
  unique (bucket, prefix)
);
alter table public.storage_cleanup enable row level security;
revoke all on public.storage_cleanup from public, anon, authenticated;

-- The closure row is platform bookkeeping, never part of a company's backup.
create or replace function public.backup_excluded_tables()
returns text[] language sql immutable set search_path = ''
as $$
  select array['company_backups', 'company_backup_data', 'company_backup_state', 'app_secrets', 'push_subscriptions',
               'notification_settings', 'notifications', 'audit_log', 'security_events', 'demo_starts',
               'company_closures'];
$$;

-- ---------------------------------------------------------------------
-- Activity log: same as Stage 1, plus a "quiet" switch used only inside the
-- deletion steps (transaction-local), so removing a person or a company does
-- not write thousands of "created by → empty" lines, or copy an old email
-- address into the log while it is being removed.
-- ---------------------------------------------------------------------
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_row     jsonb;
  v_company uuid;
  v_details jsonb := '{}'::jsonb;
  k         text;
begin
  if current_setting('ims.quiet_audit', true) = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);

  -- companies has no company_id column: its own id is the company.
  v_company := coalesce((v_row ->> 'company_id')::uuid, (v_row ->> 'id')::uuid);

  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(v_new) loop
      if k not in ('updated_at', 'created_at') and (v_new -> k) is distinct from (v_old -> k) then
        v_details := v_details || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k));
      end if;
    end loop;
    if v_details = '{}'::jsonb then
      return new;  -- nothing meaningful changed
    end if;
  elsif tg_op = 'INSERT' then
    v_details := v_new - 'created_at' - 'updated_at';
  else
    v_details := v_old - 'created_at' - 'updated_at';
  end if;

  -- When a whole company is deleted its log goes with it.
  if tg_op = 'DELETE' and tg_table_name = 'companies' then
    return old;
  end if;
  if not exists (select 1 from public.companies c where c.id = v_company) then
    return coalesce(new, old);
  end if;

  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (v_company, auth.uid(), lower(tg_op), tg_table_name, v_row ->> 'id', v_details);

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------
-- Suspended memberships stay switched off
-- ---------------------------------------------------------------------
create or replace function public.guard_suspended_membership()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and exists (select 1 from public.account_deletions d
                                   where d.user_id = new.user_id and d.status = 'scheduled') then
    raise exception 'This account is scheduled for deletion. Sign in and choose Keep my account first.' using errcode = '42501';
  end if;
  if new.active then
    if exists (select 1 from public.account_deletions d where d.user_id = new.user_id and d.status = 'scheduled') then
      new.suspended_for_deletion_at := coalesce(new.suspended_for_deletion_at, now());
    end if;
    if new.role <> 'management'
       and exists (select 1 from public.company_closures cc where cc.company_id = new.company_id and cc.status = 'scheduled') then
      new.suspended_for_closure_at := coalesce(new.suspended_for_closure_at, now());
    end if;
  end if;
  if new.suspended_for_deletion_at is not null or new.suspended_for_closure_at is not null then
    new.active := false;
  end if;
  return new;
end;
$$;
drop trigger if exists memberships_guard_suspended on public.memberships;
create trigger memberships_guard_suspended before insert or update on public.memberships
  for each row execute function public.guard_suspended_membership();

-- ---------------------------------------------------------------------
-- Helpers (internal)
-- ---------------------------------------------------------------------
create or replace function public.deletion_day(p_at timestamptz)
returns text language sql stable set search_path = ''
as $$
  select to_char(p_at at time zone 'Africa/Dar_es_Salaam', 'FMDD Mon YYYY');
$$;

-- What stops the signed-in person from deleting their account, per company (real companies
-- they are an active member of, not already closing):
--   kind 'sole_manager'  the only active manager, and there are other active members
--   kind 'only_member'   nobody else is active there (a manager there must close the company)
-- role_manager only COUNTS managers (to block); the right to close the company comes from
-- is_manager (which applies the company's two-step policy).
drop function if exists public.account_deletion_blockers(uuid);
create or replace function public.account_deletion_blockers()
returns table (company_id uuid, company_name text, kind text, can_close boolean, role_manager boolean)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name,
         case when not exists (select 1 from public.memberships o
                                where o.company_id = c.id and o.user_id <> m.user_id and o.active)
              then 'only_member' else 'sole_manager' end,
         public.is_manager(c.id),
         m.role = 'management'
    from public.memberships m
    join public.companies c on c.id = m.company_id
   where m.user_id = auth.uid() and m.active and not c.is_demo and c.closing_after is null
     and (
       not exists (select 1 from public.memberships o where o.company_id = c.id and o.user_id <> m.user_id and o.active)
       or (m.role = 'management'
           and not exists (select 1 from public.memberships o
                            where o.company_id = c.id and o.user_id <> m.user_id and o.active and o.role = 'management'))
     )
   order by c.name;
$$;

-- Schedule a company's closure (internal: callers check who may do it).
create or replace function public.schedule_company_closure(p_company uuid, p_actor uuid, p_deletion uuid)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare
  co      public.companies;
  v_after timestamptz := now() + interval '30 days';
  v_id    uuid;
  v_day   text;
begin
  select * into co from public.companies where id = p_company for update;
  if co.id is null then
    raise exception 'Company not found.' using errcode = 'P0002';
  end if;
  if co.is_demo then
    raise exception 'Demo companies delete themselves. Use Exit demo instead.' using errcode = '22023';
  end if;
  if co.closing_after is not null
     or exists (select 1 from public.company_closures where company_id = p_company and status = 'scheduled') then
    raise exception 'This company is already scheduled to close.' using errcode = '23505';
  end if;
  v_day := public.deletion_day(v_after);

  insert into public.company_closures (company_id, company_name, requested_by, account_deletion_id, delete_after)
  values (p_company, co.name, p_actor, p_deletion, v_after)
  returning id into v_id;
  update public.companies set closing_after = v_after where id = p_company;

  -- Everyone is told while they still have access (notify needs an active member).
  perform public.notify_roles(p_company, array['management']::public.app_role[], null, 'company_closure', 'critical',
    co.name || ' will be closed',
    'All of ' || co.name || '''s data will be deleted on ' || v_day
      || '. Until then you can cancel the closure or download a final backup.',
    '/', 'closure:' || v_id::text);
  perform public.notify_roles(p_company, array['sales', 'procurement', 'warehouse', 'driver', 'finance']::public.app_role[], null,
    'company_closure', 'critical',
    co.name || ' will be closed',
    co.name || ' is closing its LeMoSp account. Your access has ended and all its data will be deleted on ' || v_day
      || '. Questions? Ask your manager.',
    '/', 'closure:' || v_id::text);

  -- Members who are not management lose access now (undone by cancel_company_closure).
  update public.memberships
     set suspended_for_closure_at = now(), active = false
   where company_id = p_company and role <> 'management' and suspended_for_closure_at is null
     and (active or suspended_for_deletion_at is not null);

  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (p_company, p_actor, 'close_requested', 'companies', p_company::text, jsonb_build_object('delete_after', v_after));
  return v_after;
end;
$$;

-- Undo a scheduled closure (internal).
create or replace function public.unschedule_company_closure(p_company uuid, p_actor uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
  cc     public.company_closures;
begin
  -- Locked: the deletion job takes the same row, so a cancel can never meet a deletion half way.
  select * into cc from public.company_closures where company_id = p_company and status = 'scheduled' for update;
  if cc.id is null then
    raise exception 'This company is not scheduled to close.' using errcode = 'P0002';
  end if;
  if cc.delete_after <= now() then
    raise exception 'It is too late to cancel: the company is being deleted.' using errcode = '55000';
  end if;
  update public.company_closures set status = 'cancelled', cancelled_at = now() where id = cc.id;
  update public.companies set closing_after = null where id = p_company returning name into v_name;
  update public.memberships
     set suspended_for_closure_at = null, active = (suspended_for_deletion_at is null)
   where company_id = p_company and suspended_for_closure_at is not null;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (p_company, p_actor, 'close_cancelled', 'companies', p_company::text, '{}'::jsonb);
  perform public.notify_roles(p_company, array['management', 'sales', 'procurement', 'warehouse', 'driver', 'finance']::public.app_role[],
    p_actor, 'company_closure', 'attention', 'Closure cancelled: ' || coalesce(v_name, ''),
    coalesce(v_name, 'The company') || ' is staying on LeMoSp. Everything continues as before.', '/', null);
end;
$$;

-- ---------------------------------------------------------------------
-- 1. Delete my account
-- ---------------------------------------------------------------------

-- The signed-in person's scheduled deletion (null when none). Used by the app on every
-- sign-in to show "Your account is scheduled for deletion" instead of the app.
create or replace function public.my_account_deletion()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('requested_at', d.requested_at, 'delete_after', d.delete_after)
    from public.account_deletions d
   where d.user_id = auth.uid() and d.status = 'scheduled'
   limit 1;
$$;

-- For the "Delete my account" page: what is in the way, if anything.
create or replace function public.account_deletion_check()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'guest', public.is_anonymous_user(),
    'platform_admin', exists (select 1 from public.platform_admins a where a.user_id = auth.uid()),
    'scheduled', public.my_account_deletion(),
    'two_step_needed', public.session_aal() <> 'aal2'
                       and exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified'),
    'blockers', coalesce((select jsonb_agg(jsonb_build_object('company_id', b.company_id, 'company_name', b.company_name,
                                                              'kind', b.kind, 'is_manager', b.role_manager,
                                                              'can_close', b.can_close))
                            from public.account_deletion_blockers() b), '[]'::jsonb));
end;
$$;

create or replace function public.request_account_deletion(p_reason text default null, p_close_companies boolean default false)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_after   timestamptz := now() + interval '7 days';
  v_id      uuid;
  v_name    text;
  v_email   text;
  b         record;
  r         record;
begin
  if v_user is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  if public.is_anonymous_user() then
    raise exception 'Demo guests have no account to delete. The demo deletes itself.' using errcode = '42501';
  end if;
  if exists (select 1 from public.platform_admins a where a.user_id = v_user) then
    raise exception 'Platform admins must first be removed from the platform team list.' using errcode = '42501';
  end if;
  if not public.recent_auth(10) then
    raise exception 'Please confirm it is you first.' using errcode = '28000';
  end if;
  -- Someone who uses two-step verification must have passed it in this session.
  if public.session_aal() <> 'aal2'
     and exists (select 1 from auth.mfa_factors f where f.user_id = v_user and f.status = 'verified') then
    raise exception 'Please sign in with your two-step verification code first.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('ims.account_deletion:' || v_user::text));
  -- Their companies are locked while we check who else manages them, so two managers asking
  -- at the same moment cannot leave a company without a manager.
  perform 1 from public.companies c
   where c.id in (select m.company_id from public.memberships m where m.user_id = v_user and m.active)
   order by c.id
   for update;
  if exists (select 1 from public.account_deletions where user_id = v_user and status = 'scheduled') then
    raise exception 'Your account is already scheduled for deletion.' using errcode = '23505';
  end if;
  if (select count(*) from public.account_deletions
       where user_id = v_user and requested_at > now() - interval '1 day') >= 5 then
    raise exception 'You have done this many times today. Please try again tomorrow.' using errcode = '54000';
  end if;

  for b in select * from public.account_deletion_blockers() loop
    if b.kind = 'sole_manager' then
      raise exception 'You are the only manager of %. Make someone else a manager first (Settings → Team & roles), then try again.',
        b.company_name using errcode = '23514';
    elsif b.role_manager and not coalesce(p_close_companies, false) then
      raise exception 'You are the only person in %. Close the company first, or choose to close it together with your account.',
        b.company_name using errcode = '23514';
    elsif b.role_manager and not (b.can_close and public.mfa_satisfied(b.company_id)) then
      raise exception 'To close %, sign in with two-step verification first.', b.company_name using errcode = '42501';
    end if;
  end loop;

  select upper(left(btrim(coalesce(nullif(btrim(p.full_name), ''), p.email, '')), 1)) into v_name
    from public.profiles p where p.id = v_user;

  insert into public.account_deletions (user_id, name_hint, delete_after, reason)
  values (v_user, nullif(v_name, ''), v_after, nullif(left(btrim(coalesce(p_reason, '')), 500), ''))
  returning id into v_id;

  -- Companies where they are the only person: closed in the same step (30 days, cancelled with "Keep my account").
  for b in select * from public.account_deletion_blockers() where kind = 'only_member' and role_manager loop
    perform public.schedule_company_closure(b.company_id, v_user, v_id);
  end loop;

  -- Their demo company, if any, goes now.
  for r in select m.company_id from public.memberships m join public.companies c on c.id = m.company_id
            where m.user_id = v_user and c.is_demo loop
    perform public.delete_demo_company(r.company_id);
  end loop;

  -- The email (sent by the scheduled job; no company needed, not switched off by alert settings).
  select lower(coalesce(nullif(btrim(u.email), ''), p.email)) into v_email
    from auth.users u left join public.profiles p on p.id = u.id where u.id = v_user;
  if v_email is not null then
    insert into public.account_emails (user_id, email, subject, body)
    values (v_user, v_email, 'Your LeMoSp account will be deleted',
            'Your LeMoSp account will be deleted on ' || public.deletion_day(v_after)
              || '. Changed your mind? Sign in before then and choose Keep my account.');
  end if;

  -- Access ends now everywhere (undone by cancel_account_deletion).
  update public.memberships
     set suspended_for_deletion_at = now(), active = false
   where user_id = v_user and suspended_for_deletion_at is null
     and (active or suspended_for_closure_at is not null);
  delete from public.push_subscriptions where user_id = v_user;

  return v_after;
end;
$$;

create or replace function public.cancel_account_deletion()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  d      public.account_deletions;
  c      record;
begin
  if v_user is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  select * into d from public.account_deletions where user_id = v_user and status = 'scheduled' for update;
  if d.id is null then
    raise exception 'Your account is not scheduled for deletion.' using errcode = 'P0002';
  end if;
  if d.delete_after <= now() then
    raise exception 'It is too late to cancel: your account is being deleted.' using errcode = '55000';
  end if;
  update public.account_deletions set status = 'cancelled', cancelled_at = now(), reason = null where id = d.id;
  update public.memberships
     set suspended_for_deletion_at = null, active = (suspended_for_closure_at is null)
   where user_id = v_user and suspended_for_deletion_at is not null;
  -- Companies closed in the same step stay open too.
  for c in select company_id from public.company_closures
            where account_deletion_id = d.id and status = 'scheduled' and delete_after > now() loop
    perform public.unschedule_company_closure(c.company_id, v_user);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Close a company
-- ---------------------------------------------------------------------
create or replace function public.request_company_closure(p_company uuid)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare
  v_demo boolean;
begin
  if auth.uid() is null or not public.is_manager(p_company) then
    raise exception 'Only management can close the company.' using errcode = '42501';
  end if;
  select is_demo into v_demo from public.companies where id = p_company;
  if coalesce(v_demo, false) or public.is_anonymous_user() then
    raise exception 'Demo companies delete themselves. Use Exit demo instead.' using errcode = '22023';
  end if;
  if not public.recent_auth(10) then
    raise exception 'Please confirm it is you first.' using errcode = '28000';
  end if;
  if (select count(*) from public.company_closures
       where company_id = p_company and requested_at > now() - interval '1 day') >= 5 then
    raise exception 'You have done this many times today. Please try again tomorrow.' using errcode = '54000';
  end if;
  return public.schedule_company_closure(p_company, auth.uid(), null);
end;
$$;

create or replace function public.cancel_company_closure(p_company uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_manager(p_company) then
    raise exception 'Only management can cancel the closure.' using errcode = '42501';
  end if;
  perform public.unschedule_company_closure(p_company, auth.uid());
end;
$$;

-- ---------------------------------------------------------------------
-- 3. The final step (internal)
-- ---------------------------------------------------------------------

-- Removes a person for good. Their sign-in account is anonymised and blocked rather than
-- deleted: deleting it would make the database empty "created by", "driver", "approved by"…
-- on business records, and the record rules (e.g. "only management can change the driver
-- after dispatch") rightly refuse that. So every business record stays exactly as it was and
-- points at a person called "Deleted user" with no email, phone, password or way to sign in.
-- The email address becomes free: they can sign up again later as a new person.
create or replace function public.delete_account_now(p_user uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_email     text;
  v_companies uuid[];
  v_invited   uuid[];
  v_anon      text := 'deleted-' || p_user::text || '@deleted.invalid';
  v_set       text;
  v_t         text;
  v_json      text;
  c           uuid;
begin
  select lower(coalesce(p.email, u.email)) into v_email
    from auth.users u left join public.profiles p on p.id = u.id where u.id = p_user;
  if v_email is null then
    select lower(email) into v_email from public.profiles where id = p_user;
  end if;

  select coalesce(array_agg(distinct m.company_id), '{}') into v_companies
    from public.memberships m join public.companies co on co.id = m.company_id
   where m.user_id = p_user and not co.is_demo;
  select coalesce(array_agg(distinct i.company_id), '{}') into v_invited
    from public.invitations i where i.accepted_by = p_user or (v_email is not null and i.email = v_email);

  -- Demo company, if any.
  for c in select m.company_id from public.memberships m join public.companies co on co.id = m.company_id
            where m.user_id = p_user and co.is_demo loop
    perform public.delete_demo_company(c);
  end loop;

  perform set_config('ims.quiet_audit', 'on', true);

  -- One line in each company's Activity log, without personal details.
  foreach c in array v_companies loop
    insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
    values (c, null, 'account_deleted', 'memberships', null,
            jsonb_build_object('note', 'A team member''s LeMoSp account was deleted.'));
  end loop;

  -- Personal rows.
  delete from public.push_subscriptions    where user_id = p_user;
  delete from public.notification_settings where user_id = p_user;
  delete from public.known_devices         where user_id = p_user;
  delete from public.security_events       where user_id = p_user;
  delete from public.notifications         where user_id = p_user;
  delete from public.platform_admins       where user_id = p_user;
  delete from public.memberships           where user_id = p_user;
  delete from public.account_emails        where user_id = p_user;

  -- Their email address in team invitations (and in those lines of the Activity log).
  if v_email is not null then
    update public.invitations set revoked_at = coalesce(revoked_at, now())
     where email = v_email and accepted_at is null and revoked_at is null;
    update public.invitations set email = 'deleted-' || replace(id::text, '-', '') || '@deleted.invalid'
     where email = v_email or accepted_by = p_user;
    -- As it is written inside the log's JSON (an address with " or \ is escaped there).
    v_json := trim('"' from to_jsonb(v_email)::text);
    update public.audit_log
       set details = replace(details::text, v_json, 'deleted user')::jsonb
     where company_id = any (v_invited || v_companies) and entity in ('invitations', 'memberships')
       and strpos(details::text, v_json) > 0;
  end if;

  update public.profiles set full_name = 'Deleted user', email = null, phone = null where id = p_user;

  -- The sign-in account: anonymised and blocked (only the columns this Supabase version has).
  select string_agg(format('%I = %s', a.attname,
           case a.attname
             when 'email' then quote_literal(v_anon)
             when 'phone' then 'null'
             when 'raw_user_meta_data' then quote_literal('{}') || '::jsonb'
             when 'raw_app_meta_data' then quote_literal('{}') || '::jsonb'
             when 'banned_until' then 'now() + interval ''100 years'''
             when 'deleted_at' then 'now()'
             when 'email_confirmed_at' then 'null'
             when 'phone_confirmed_at' then 'null'
             when 'last_sign_in_at' then 'null'
             else quote_literal('')   -- encrypted_password and the one-time codes
           end), ', ')
    into v_set
    from pg_catalog.pg_attribute a
   where a.attrelid = 'auth.users'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname in ('email', 'phone', 'encrypted_password', 'raw_user_meta_data', 'raw_app_meta_data', 'banned_until',
                       'deleted_at', 'email_confirmed_at', 'phone_confirmed_at', 'last_sign_in_at',
                       'email_change', 'phone_change', 'confirmation_token', 'recovery_token', 'email_change_token_new',
                       'email_change_token_current', 'phone_change_token', 'reauthentication_token');
  if v_set is not null then
    execute format('update auth.users set %s where id = $1', v_set) using p_user;
  end if;
  -- Ways to sign in, open sessions, authenticator apps and one-time codes.
  foreach v_t in array array['identities', 'sessions', 'refresh_tokens', 'mfa_factors', 'one_time_tokens', 'flow_state'] loop
    if to_regclass('auth.' || v_t) is not null then
      execute format('delete from auth.%I where user_id::text = $1', v_t) using p_user::text;
    end if;
  end loop;
  -- Supabase's own sign-in log (it holds the email address).
  if to_regclass('auth.audit_log_entries') is not null then
    execute 'delete from auth.audit_log_entries where payload ->> ''actor_id'' = $1' using p_user::text;
  end if;

  perform set_config('ims.quiet_audit', 'off', true);
  return 'anonymised';
end;
$$;

-- Deletes a company with everything in it, a slice at a time. Returns true when it is all gone.
--
-- Supabase stops a call from the web server after a few seconds and a stopped call undoes
-- everything it did, so a big company cannot be deleted in one go. Each call deletes rows in
-- batches until p_budget is used up and keeps what it did; the next call carries on.
-- Tables are found the way the backups find them (every table with company_id, and child
-- tables through their parent). A batch refused by a foreign key (rows another table still
-- points at) is simply tried again after the other tables. When no rows are left: the files
-- (as the demo clean-up does), then the company row itself (backups go with it).
create or replace function public.delete_company_step(p_company uuid, p_budget interval default interval '1.5 seconds')
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  v_start    timestamptz := clock_timestamp();
  p          record;
  v_n        integer;
  v_progress boolean;
  v_left     text;
  v_sql      text;
begin
  if not exists (select 1 from public.companies where id = p_company) then
    return true;
  end if;
  perform set_config('ims.quiet_audit', 'on', true);
  perform set_config('ims.status_change', 'on', true);
  perform set_config('ims.allow_line_copy', 'on', true);

  loop
    v_progress := false;
    v_left := null;
    -- Child tables (without company_id) first, then the rest; the closure bookkeeping is kept.
    for p in select * from public.backup_table_plan()
              where table_name not in ('company_closures', 'security_events')  -- sign-in history stays with each person
              order by (parent_table is null), table_name loop
      if p.parent_table is null then
        v_sql := format('delete from public.%I where ctid = any (array(select ctid from public.%I where company_id::text = $1 limit 2000))',
                        p.table_name, p.table_name);
      elsif p.parent_table = 'companies' then
        v_sql := format('delete from public.%I where ctid = any (array(select ctid from public.%I where %I::text = $1 limit 2000))',
                        p.table_name, p.table_name, p.fk_column);
      else
        v_sql := format('delete from public.%I where ctid = any (array(select x.ctid from public.%I x where x.%I in '
                        || '(select y.%I from public.%I y where y.company_id::text = $1) limit 2000))',
                        p.table_name, p.table_name, p.fk_column, p.parent_column, p.parent_table);
      end if;
      begin
        execute v_sql using p_company::text;
        get diagnostics v_n = row_count;
        if v_n > 0 then
          v_progress := true;
          if v_n = 2000 then
            v_left := p.table_name;  -- more to do here
          end if;
        end if;
      exception when foreign_key_violation then
        v_left := p.table_name;      -- another table still points at these rows: later
      end;
      if clock_timestamp() - v_start > p_budget then
        return false;               -- time is up: what was deleted is kept, the next call carries on
      end if;
    end loop;
    exit when v_left is null;
    if not v_progress then
      raise exception 'Some records could not be deleted (%).', v_left;
    end if;
  end loop;

  -- Logo, signatures and delivery photos. Noted first; then tried directly (older Supabase
  -- allows it). Newer Supabase refuses: a platform admin removes them from the admin app.
  insert into public.storage_cleanup (bucket, prefix, company_ref)
  select b, p_company::text || '/', p_company from unnest(array['branding', 'pod']) b
  on conflict (bucket, prefix) do nothing;
  begin
    delete from storage.objects
     where bucket_id in ('branding', 'pod') and name like p_company::text || '/%';
  exception when others then
    raise notice 'Files for % left in storage: %', p_company, sqlerrm;
  end;
  update public.storage_cleanup s set done_at = now()
   where s.company_ref = p_company and s.done_at is null
     and not exists (select 1 from storage.objects o where o.bucket_id = s.bucket and left(o.name, length(s.prefix)) = s.prefix);
  -- Whatever is left hangs off the company with ON DELETE CASCADE (backups too).
  delete from public.companies where id = p_company;

  perform set_config('ims.quiet_audit', 'off', true);
  perform set_config('ims.status_change', 'off', true);
  perform set_config('ims.allow_line_copy', 'off', true);
  return true;
end;
$$;

-- Picks the next due deletion and notes the attempt (saved even if the next step is stopped).
create or replace function public.claim_due_deletion_at(p_now timestamptz)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Housekeeping: cancelled requests are forgotten after 90 days (the closed company's name too).
  update public.company_closures set company_name = null
   where status = 'cancelled' and company_name is not null and coalesce(cancelled_at, requested_at) < p_now - interval '90 days';
  delete from public.account_deletions
   where status = 'cancelled' and coalesce(cancelled_at, requested_at) < p_now - interval '90 days';

  select id into v_id from public.account_deletions
   where status = 'scheduled' and delete_after <= p_now
     and (last_attempt_at is null or last_attempt_at < p_now - interval '1 hour')
   order by (last_error is not null), delete_after
   limit 1 for update skip locked;
  if v_id is not null then
    update public.account_deletions
       set last_attempt_at = p_now, last_error = 'Started but did not finish (stopped or timed out).'
     where id = v_id;
    return jsonb_build_object('kind', 'account', 'id', v_id);
  end if;
  select id into v_id from public.company_closures
   where status = 'scheduled' and delete_after <= p_now
     and (last_attempt_at is null or last_attempt_at < p_now - interval '1 hour')
   order by (last_error is not null), delete_after
   limit 1 for update skip locked;
  if v_id is not null then
    update public.company_closures
       set last_attempt_at = p_now, last_error = 'Started but did not finish (stopped or timed out).'
     where id = v_id;
    return jsonb_build_object('kind', 'company', 'id', v_id);
  end if;
  return null;
end;
$$;

-- Does one claimed deletion. True when done; on an error the reason is kept and it is retried
-- later. A big company may need several calls (false until the last one).
create or replace function public.finish_deletion_at(p_kind text, p_id uuid, p_now timestamptz,
                                                     p_budget interval default interval '1.5 seconds')
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  d  public.account_deletions;
  cc public.company_closures;
begin
  if p_kind = 'account' then
    select * into d from public.account_deletions
     where id = p_id and status = 'scheduled' and delete_after <= p_now for update;
    if d.id is null then
      return false;
    end if;
    begin
      perform public.delete_account_now(d.user_id);
      update public.account_deletions
         set status = 'done', done_at = p_now, reason = null, last_error = null
       where id = d.id;
    exception when others then
      update public.account_deletions set last_error = left(sqlerrm, 500) where id = d.id;
      raise warning 'Account deletion % failed: %', d.id, sqlerrm;
      return false;
    end;
    return true;
  elsif p_kind = 'company' then
    select * into cc from public.company_closures
     where id = p_id and status = 'scheduled' and delete_after <= p_now for update;
    if cc.id is null then
      return false;
    end if;
    begin
      -- From the first step on nobody, management included, has access any more.
      update public.memberships
         set suspended_for_closure_at = coalesce(suspended_for_closure_at, p_now), active = false
       where company_id = cc.company_id and (active or suspended_for_closure_at is null);
      if not public.delete_company_step(cc.company_id, p_budget) then
        -- Part done (big company): what was deleted is kept; the next call carries on straight away.
        update public.company_closures set last_attempt_at = null, last_error = null where id = cc.id;
        return false;
      end if;
      update public.company_closures
         set status = 'done', done_at = p_now, company_name = null, requested_by = null, last_error = null
       where id = cc.id;
    exception when others then
      update public.company_closures set last_error = left(sqlerrm, 500) where id = cc.id;
      raise warning 'Company closure % failed: %', cc.id, sqlerrm;
      return false;
    end;
    return true;
  end if;
  return false;
end;
$$;

-- Both steps in one call, a few at a time (tests, and the optional in-database schedule).
create or replace function public.run_due_deletions_at(p_now timestamptz, p_limit integer default 50,
                                                       p_budget interval default interval '1.5 seconds')
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_job  jsonb;
  v_done integer := 0;
begin
  for i in 1 .. greatest(coalesce(p_limit, 50), 1) loop
    v_job := public.claim_due_deletion_at(p_now);
    exit when v_job is null;
    if public.finish_deletion_at(v_job ->> 'kind', (v_job ->> 'id')::uuid, p_now, p_budget) then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;

-- For the server's scheduled job (/api/outbox), protected by the outbox secret.
create or replace function public.claim_due_deletion(p_secret text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return public.claim_due_deletion_at(now());
end;
$$;

create or replace function public.finish_deletion(p_secret text, p_kind text, p_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return public.finish_deletion_at(p_kind, p_id, now());
end;
$$;

-- ---------------------------------------------------------------------
-- Team page: switching someone off is final
-- ---------------------------------------------------------------------
-- Same as Security plus (management only, recent sign-in, at least one active manager), plus:
--   * the company row is locked while managers are counted (two changes at the same moment
--     cannot leave the company without a manager; request_account_deletion locks it too);
--   * switching someone off also removes the "suspended for deletion / closure" marks, so
--     "Keep my account" or "Cancel closure" later does not switch them back on.
create or replace function public.update_membership(p_membership uuid, p_role public.app_role, p_active boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_m public.memberships;
begin
  select * into v_m from public.memberships where id = p_membership;
  if v_m.id is null or not public.is_manager(v_m.company_id) then
    raise exception 'Team member not found.' using errcode = '42501';
  end if;
  perform public.require_step_up(v_m.company_id);
  perform 1 from public.companies where id = v_m.company_id for update;

  if v_m.role = 'management' and v_m.active and (p_role <> 'management' or not p_active) then
    if (select count(*) from public.memberships
        where company_id = v_m.company_id and role = 'management' and active) <= 1 then
      raise exception 'The company needs at least one active manager.' using errcode = '23514';
    end if;
  end if;

  update public.memberships
     set role = p_role, active = p_active,
         suspended_for_deletion_at = case when p_active then suspended_for_deletion_at end,
         suspended_for_closure_at  = case when p_active then suspended_for_closure_at end
   where id = p_membership;
end;
$$;

-- ---------------------------------------------------------------------
-- Emails without a company (scheduled job, outbox secret)
-- ---------------------------------------------------------------------
create or replace function public.claim_account_emails(p_secret text, p_limit integer default 50)
returns table (id uuid, email text, subject text, body text)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.account_emails e where e.sent_at < now() - interval '7 days';
  -- Too old to be worth sending (the job was off for days): dropped.
  delete from public.account_emails e where e.sent_at is null and e.created_at < now() - interval '3 days';
  return query
  with picked as (
    select e.id from public.account_emails e
     where e.sent_at is null
     order by e.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
     for update skip locked
  )
  update public.account_emails e set sent_at = now()
    from picked where e.id = picked.id
  returning e.id, e.email, e.subject, e.body;
end;
$$;

-- ---------------------------------------------------------------------
-- Files of closed companies: platform admins remove them (Admin → Deletions)
-- ---------------------------------------------------------------------
-- True for a platform admin (two-step session) and a file inside a folder still listed in
-- storage_cleanup. Used by the two storage rules below (listing and deleting only).
create or replace function public.storage_cleanup_allowed(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_platform_admin()
     and exists (select 1 from public.storage_cleanup s
                  where s.done_at is null and s.bucket = p_bucket
                    and left(coalesce(p_name, ''), length(s.prefix)) = s.prefix);
$$;

drop policy if exists storage_cleanup_select on storage.objects;
create policy storage_cleanup_select on storage.objects for select to authenticated
  using (public.storage_cleanup_allowed(bucket_id, name));
drop policy if exists storage_cleanup_delete on storage.objects;
create policy storage_cleanup_delete on storage.objects for delete to authenticated
  using (public.storage_cleanup_allowed(bucket_id, name));

-- The folders still to clear (platform admins).
create or replace function public.platform_storage_cleanup()
returns table (id uuid, bucket text, prefix text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return query
    select s.id, s.bucket, s.prefix, s.created_at from public.storage_cleanup s
     where s.done_at is null order by s.created_at;
end;
$$;

-- After removing a folder's files: marks it done, only when no file is left in it.
create or replace function public.mark_storage_cleanup_done(p_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  s public.storage_cleanup;
begin
  perform public.require_platform_admin();
  select * into s from public.storage_cleanup where id = p_id for update;
  if s.id is null then
    raise exception 'Folder not found.' using errcode = 'P0002';
  end if;
  if s.done_at is not null then
    return true;
  end if;
  if exists (select 1 from storage.objects o where o.bucket_id = s.bucket and left(o.name, length(s.prefix)) = s.prefix) then
    raise exception 'Some files are still there. Press Remove files again.' using errcode = '55000';
  end if;
  update public.storage_cleanup set done_at = now() where id = p_id;
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- Platform admin: read-only, minimal list (no emails, no full names)
-- ---------------------------------------------------------------------
create or replace function public.platform_deletions(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 200), 500));
begin
  perform public.require_platform_admin();
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'accounts_scheduled', (select count(*) from public.account_deletions where status = 'scheduled'),
      'accounts_done',      (select count(*) from public.account_deletions where status = 'done'),
      'accounts_cancelled', (select count(*) from public.account_deletions where status = 'cancelled'),
      'companies_scheduled', (select count(*) from public.company_closures where status = 'scheduled'),
      'companies_done',      (select count(*) from public.company_closures where status = 'done'),
      'companies_cancelled', (select count(*) from public.company_closures where status = 'cancelled'),
      'file_folders_left',   (select count(*) from public.storage_cleanup where done_at is null)),
    'accounts', coalesce((select jsonb_agg(x order by x.requested_at desc) from (
        select coalesce(d.name_hint, '') || '…' as label, d.requested_at, d.delete_after, d.status, d.done_at,
               (d.status = 'scheduled' and d.last_error is not null and d.delete_after < now()) as stuck
          from public.account_deletions d order by d.requested_at desc limit v_limit) x), '[]'::jsonb),
    'companies', coalesce((select jsonb_agg(x order by x.requested_at desc) from (
        select cc.company_name as label, cc.requested_at, cc.delete_after, cc.status, cc.done_at,
               (cc.status = 'scheduled' and cc.last_error is not null and cc.delete_after < now()) as stuck
          from public.company_closures cc order by cc.requested_at desc limit v_limit) x), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------
-- Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
-- (audit_row and backup_excluded_tables keep the privileges they already had.)
revoke execute on function
  public.guard_suspended_membership(),
  public.deletion_day(timestamptz),
  public.account_deletion_blockers(),
  public.schedule_company_closure(uuid, uuid, uuid),
  public.unschedule_company_closure(uuid, uuid),
  public.my_account_deletion(),
  public.account_deletion_check(),
  public.request_account_deletion(text, boolean),
  public.cancel_account_deletion(),
  public.request_company_closure(uuid),
  public.cancel_company_closure(uuid),
  public.delete_account_now(uuid),
  public.delete_company_step(uuid, interval),
  public.claim_due_deletion_at(timestamptz),
  public.finish_deletion_at(text, uuid, timestamptz, interval),
  public.run_due_deletions_at(timestamptz, integer, interval),
  public.claim_due_deletion(text),
  public.finish_deletion(text, text, uuid),
  public.platform_deletions(integer),
  public.claim_account_emails(text, integer),
  public.storage_cleanup_allowed(text, text),
  public.platform_storage_cleanup(),
  public.mark_storage_cleanup_done(uuid)
from public, anon, authenticated;
revoke execute on function public.update_membership(uuid, public.app_role, boolean) from public, anon;
grant execute on function public.update_membership(uuid, public.app_role, boolean) to authenticated;

grant execute on function
  public.my_account_deletion(),
  public.account_deletion_check(),
  public.request_account_deletion(text, boolean),
  public.cancel_account_deletion(),
  public.request_company_closure(uuid),
  public.cancel_company_closure(uuid),
  public.platform_deletions(integer),
  public.storage_cleanup_allowed(text, text),
  public.platform_storage_cleanup(),
  public.mark_storage_cleanup_done(uuid)
to authenticated;

-- The server calls these with the shared secret (like the backups).
grant execute on function
  public.claim_due_deletion(text),
  public.finish_deletion(text, text, uuid),
  public.claim_account_emails(text, integer)
to anon, authenticated;

notify pgrst, 'reload schema';
