-- =====================================================================
-- LeMoSp · Notifications for the LeMoSp ADMIN app (platform team)
--
--   platform_notifications       one row per event, shared by every
--                                platform admin. Only platform admins (signed
--                                in with two-step verification) can read it.
--                                Never holds company business data (no amounts,
--                                no clients): company names at most, which
--                                admins already see in Admin → Companies.
--   platform_notification_reads  which admin has read which notification
--                                ("mark all read" = one row per unread item).
--   platform_admins.notify_email "Email me too" (off by default).
--
-- Created only by the internal function platform_notify(...), which no user
-- can call, from:
--   * a new company signing up (not demo companies);
--   * a company finishing setup / changing business level;
--   * new app feedback (suggestions marked "about the app", the ones shown in
--     Admin → Feedback; anonymous there, so anonymous here too);
--   * an account deletion scheduled, a company closure requested/cancelled
--     (no names or emails of people);
--   * a company's automatic backups overdue (once per company per day);
--   * many sign-ins from new devices across the platform in one hour;
--   * a daily summary at 08:00 Tanzania time (scheduled job).
-- The triggers never block what caused them: any error is swallowed.
--
-- Phone push: push_subscriptions gets an `app` column. Subscriptions made in
-- the LeMoSp ADMIN app are 'admin', the company app's are 'company' and, when
-- the admin screens run inside the company app's own address (no separate
-- admin address yet, same phone app), 'both'. Company alerts go to
-- 'company'/'both'; admin alerts go to 'admin'/'both' of platform admins.
-- The company site's scheduled job sends both (it has the private key):
--   claim_platform_outbox(secret, limit)   like claim_outbox
--   run_platform_daily_summary(secret)     the 08:00 summary (+ 180-day clean-up)
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.platform_notifications (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (char_length(kind) between 1 and 40),
  title          text not null check (char_length(title) between 1 and 200),
  body           text check (body is null or char_length(body) <= 500),
  link           text check (link is null or (link like '/%' and link not like '//%' and char_length(link) <= 300)),
  severity       text not null default 'info' check (severity in ('info', 'attention', 'urgent')),
  ref_company    uuid,                 -- no foreign key: the notice outlives a closed company
  created_at     timestamptz not null default now(),
  dedupe_key     text unique,
  dispatched_at  timestamptz           -- handed to the push/email job
);
create index if not exists platform_notifications_created_idx on public.platform_notifications (created_at desc);
create index if not exists platform_notifications_outbox_idx on public.platform_notifications (created_at)
  where dispatched_at is null;

create table if not exists public.platform_notification_reads (
  user_id          uuid not null references auth.users (id) on delete cascade,
  notification_id  uuid not null references public.platform_notifications (id) on delete cascade,
  read_at          timestamptz not null default now(),
  primary key (user_id, notification_id)
);
create index if not exists platform_notification_reads_notification_idx
  on public.platform_notification_reads (notification_id);

-- "Email me too" for each platform admin (only changed through the function below).
alter table public.platform_admins add column if not exists notify_email boolean not null default false;

-- Which app a phone subscription belongs to.
alter table public.push_subscriptions add column if not exists app text not null default 'company';
alter table public.push_subscriptions drop constraint if exists push_subscriptions_app_check;
alter table public.push_subscriptions add constraint push_subscriptions_app_check
  check (app in ('company', 'admin', 'both'));

-- Cheap platform-wide count for the "many new-device sign-ins" check.
create index if not exists security_events_newdevice_idx on public.security_events (created_at)
  where kind = 'sign_in_new_device';

alter table public.platform_notifications      enable row level security;
alter table public.platform_notification_reads enable row level security;

drop policy if exists platform_notifications_select on public.platform_notifications;
create policy platform_notifications_select on public.platform_notifications for select to authenticated
  using (public.is_platform_admin());
drop policy if exists platform_notification_reads_select on public.platform_notification_reads;
create policy platform_notification_reads_select on public.platform_notification_reads for select to authenticated
  using (user_id = auth.uid() and public.is_platform_admin());

-- Read only; every change goes through the functions below.
revoke all on public.platform_notifications, public.platform_notification_reads from public, anon, authenticated;
grant select on public.platform_notifications, public.platform_notification_reads to authenticated;

-- ---------------------------------------------------------------------
-- Creating a notification (internal: not callable by any user)
-- ---------------------------------------------------------------------
create or replace function public.platform_notify(p_kind text, p_title text, p_body text, p_link text, p_severity text,
                                                  p_ref_company uuid, p_dedupe_key text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.platform_notifications (kind, title, body, link, severity, ref_company, dedupe_key)
  values (left(coalesce(nullif(btrim(p_kind), ''), 'other'), 40),
          left(coalesce(nullif(btrim(p_title), ''), 'LeMoSp'), 200),
          nullif(left(btrim(coalesce(p_body, '')), 500), ''),
          case when p_link like '/%' and p_link not like '//%' then left(p_link, 300) end,
          case when p_severity in ('info', 'attention', 'urgent') then p_severity else 'info' end,
          p_ref_company,
          nullif(left(p_dedupe_key, 200), ''))
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.platform_level_label(p_level text)
returns text language sql immutable set search_path = ''
as $$
  select case p_level when 'small' then 'Small' when 'medium' then 'Medium' when 'enterprise' then 'Enterprise'
                      else coalesce(p_level, '') end;
$$;

-- ---------------------------------------------------------------------
-- Events (triggers). Each one swallows its own errors: a notification
-- problem must never stop a sign-up, a suggestion or a deletion request.
-- ---------------------------------------------------------------------

-- New company (not demo).
create or replace function public.pn_company_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  begin
    if not coalesce(new.is_demo, false) then
      perform public.platform_notify('company_signup', 'New company: ' || new.name,
        'A new company signed up on LeMoSp.', '/admin/companies/' || new.id::text, 'attention', new.id,
        'signup:' || new.id::text);
    end if;
  exception when others then
    raise warning 'Platform notification (new company) failed: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists companies_platform_notify_insert on public.companies;
create trigger companies_platform_notify_insert after insert on public.companies
  for each row execute function public.pn_company_insert();

-- Finished setup, or changed business level.
create or replace function public.pn_company_level()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  begin
    if coalesce(new.is_demo, false) then
      return null;
    end if;
    if not coalesce(old.onboarding_done, true) and coalesce(new.onboarding_done, false) then
      perform public.platform_notify('company_onboarded', new.name || ' finished setup',
        'Chose the ' || public.platform_level_label(new.business_level::text) || ' level.',
        '/admin/companies/' || new.id::text, 'info', new.id, 'onboarded:' || new.id::text);
    elsif old.business_level is distinct from new.business_level then
      perform public.platform_notify('company_level',
        new.name || ' moved to ' || public.platform_level_label(new.business_level::text),
        'Business level changed from ' || public.platform_level_label(old.business_level::text) || ' to '
          || public.platform_level_label(new.business_level::text) || '.',
        '/admin/companies/' || new.id::text, 'info', new.id,
        'level:' || new.id::text || ':' || new.business_level::text || ':'
          || to_char(now() at time zone 'Africa/Dar_es_Salaam', 'YYYY-MM-DD'));
    end if;
  exception when others then
    raise warning 'Platform notification (business level) failed: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists companies_platform_notify_level on public.companies;
create trigger companies_platform_notify_level after update of business_level, onboarding_done on public.companies
  for each row execute function public.pn_company_level();

-- New feedback about the app (what Admin → Feedback shows: no company, no author).
create or replace function public.pn_app_feedback()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  begin
    if new.about_app
       and not exists (select 1 from public.companies c where c.id = new.company_id and c.is_demo) then
      perform public.platform_notify('app_feedback', 'New app feedback: ' || new.title,
        initcap(replace(new.category, '_', ' ')) || ' · '
          || public.platform_level_label((select c.business_level::text from public.companies c where c.id = new.company_id))
          || ' level',
        '/admin/feedback', 'attention', null, 'feedback:' || new.id::text);
    end if;
  exception when others then
    raise warning 'Platform notification (feedback) failed: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists suggestions_platform_notify on public.suggestions;
create trigger suggestions_platform_notify after insert on public.suggestions
  for each row execute function public.pn_app_feedback();

-- An account deletion is scheduled (no name, no email).
create or replace function public.pn_account_deletion()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  begin
    if new.status = 'scheduled' then
      perform public.platform_notify('account_deletion', 'An account is scheduled for deletion',
        'It will be deleted on ' || public.deletion_day(new.delete_after) || ' unless the person cancels.',
        '/admin/deletions', 'info', null, 'acct-del:' || new.id::text);
    end if;
  exception when others then
    raise warning 'Platform notification (account deletion) failed: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists account_deletions_platform_notify on public.account_deletions;
create trigger account_deletions_platform_notify after insert on public.account_deletions
  for each row execute function public.pn_account_deletion();

-- A company closure is requested, or cancelled.
create or replace function public.pn_company_closure()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT' and new.status = 'scheduled' then
      perform public.platform_notify('company_closure', coalesce(new.company_name, 'A company') || ' asked to close',
        'All its data will be deleted on ' || public.deletion_day(new.delete_after) || ' unless management cancels.',
        '/admin/deletions', 'attention', new.company_id, 'closure:' || new.id::text);
    elsif tg_op = 'UPDATE' and old.status = 'scheduled' and new.status = 'cancelled' then
      perform public.platform_notify('company_closure_cancelled',
        'Closure cancelled: ' || coalesce(new.company_name, 'a company'),
        'The company is staying on LeMoSp.', '/admin/deletions', 'info', new.company_id,
        'closure-cancel:' || new.id::text);
    end if;
  exception when others then
    raise warning 'Platform notification (company closure) failed: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists company_closures_platform_notify on public.company_closures;
create trigger company_closures_platform_notify after insert or update of status on public.company_closures
  for each row execute function public.pn_company_closure();

-- Automatic backups overdue: check_overdue_backups writes overdue_notified_on once a day per company.
create or replace function public.pn_backup_overdue()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  begin
    if new.overdue_notified_on is not null
       and (tg_op = 'INSERT' or old.overdue_notified_on is distinct from new.overdue_notified_on) then
      select c.name into v_name from public.companies c where c.id = new.company_id and not c.is_demo;
      if v_name is not null then
        perform public.platform_notify('backup_overdue', 'Automatic backup overdue: ' || v_name,
          'No automatic backup for more than 2 days. Check the scheduled job (Netlify → Logs → Functions).',
          '/admin/companies/' || new.company_id::text, 'urgent', new.company_id,
          'backup-overdue:' || new.company_id::text || ':' || new.overdue_notified_on::text);
      end if;
    end if;
  exception when others then
    raise warning 'Platform notification (backup overdue) failed: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists company_backup_state_platform_notify on public.company_backup_state;
create trigger company_backup_state_platform_notify after insert or update of overdue_notified_on
  on public.company_backup_state
  for each row execute function public.pn_backup_overdue();

-- Many sign-ins from new devices across the whole platform within an hour (possible attack).
-- Counted only when such a sign-in happens, once the hour has not already been reported.
create or replace function public.pn_newdevice_burst()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_key text;
  v_n   integer;
begin
  begin
    if new.kind = 'sign_in_new_device' then
      v_key := 'newdevice-burst:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24');
      if not exists (select 1 from public.platform_notifications where dedupe_key = v_key) then
        select count(*) into v_n from public.security_events
         where kind = 'sign_in_new_device' and created_at > now() - interval '1 hour';
        if v_n >= 20 then
          perform public.platform_notify('security_burst', 'Many sign-ins from new devices',
            v_n || ' sign-ins from new devices across LeMoSp in the last hour. Check Supabase → Authentication → Logs.',
            '/admin', 'urgent', null, v_key);
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'Platform notification (new-device sign-ins) failed: %', sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists security_events_platform_notify on public.security_events;
create trigger security_events_platform_notify after insert on public.security_events
  for each row execute function public.pn_newdevice_burst();

-- ---------------------------------------------------------------------
-- Daily summary (08:00 Tanzania time) and 180-day clean-up
-- ---------------------------------------------------------------------
create or replace function public.platform_daily_summary_at(p_now timestamptz)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_local    timestamp := p_now at time zone 'Africa/Dar_es_Salaam';
  v_day      date := (p_now at time zone 'Africa/Dar_es_Salaam')::date;
  v_key      text;
  v_from     timestamptz;
  v_to       timestamptz;
  v_new      integer;
  v_active   integer;
  v_feedback integer;
  v_id       uuid;
begin
  delete from public.platform_notifications where created_at < p_now - interval '180 days';
  if v_local::time < time '08:00' then
    return null;
  end if;
  v_key := 'daily:' || v_day::text;
  if exists (select 1 from public.platform_notifications where dedupe_key = v_key) then
    return null;
  end if;
  v_from := (v_day - 1)::timestamp at time zone 'Africa/Dar_es_Salaam';
  v_to   := v_day::timestamp at time zone 'Africa/Dar_es_Salaam';
  select count(*) into v_new from public.companies
   where not is_demo and created_at >= v_from and created_at < v_to;
  select count(distinct a.company_id) into v_active
    from public.audit_log a join public.companies c on c.id = a.company_id and not c.is_demo
   where a.actor_id is not null and a.created_at >= v_from and a.created_at < v_to;
  select count(*) into v_feedback
    from public.suggestions s join public.companies c on c.id = s.company_id and not c.is_demo
   where s.about_app and s.created_at >= v_from and s.created_at < v_to;
  v_id := public.platform_notify('daily_summary', 'Daily summary',
    'Yesterday: ' || v_new || case when v_new = 1 then ' new company, ' else ' new companies, ' end
      || v_active || ' active, ' || v_feedback || case when v_feedback = 1 then ' feedback item.' else ' feedback items.' end,
    '/admin', 'info', null, v_key);
  return v_id;
end;
$$;

create or replace function public.run_platform_daily_summary(p_secret text)
returns uuid language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  return public.platform_daily_summary_at(now());
end;
$$;

-- ---------------------------------------------------------------------
-- Outbox: push (and optional email) to every platform admin
-- ---------------------------------------------------------------------
create or replace function public.claim_platform_outbox(p_secret text, p_limit integer)
returns table (
  notification_id uuid, user_id uuid, email text, full_name text, title text, body text, link text,
  severity text, created_at timestamptz, want_email boolean, subscriptions jsonb
)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  -- Too old to be worth a phone alert (the job was off): just mark them handled.
  update public.platform_notifications n set dispatched_at = now()
   where n.dispatched_at is null and n.created_at <= now() - interval '2 days';
  return query
  with picked as (
    select n.id from public.platform_notifications n
     where n.dispatched_at is null
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 100), 500))
     for update skip locked
  ), marked as (
    update public.platform_notifications n set dispatched_at = now() from picked where n.id = picked.id
    returning n.*
  ), admins as (
    select a.user_id, a.notify_email, pr.email, pr.full_name,
           coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                       from public.push_subscriptions s
                      where s.user_id = a.user_id and s.app in ('admin', 'both')), '[]'::jsonb) as subs
      from public.platform_admins a
      left join public.profiles pr on pr.id = a.user_id
  )
  select m.id, ad.user_id, ad.email, ad.full_name, m.title, m.body, m.link, m.severity, m.created_at,
         (ad.notify_email and ad.email is not null), ad.subs
    from marked m
   cross join admins ad
   where jsonb_array_length(ad.subs) > 0 or (ad.notify_email and ad.email is not null)
   order by m.created_at;
end;
$$;

-- Company alerts: as Stage 10, but never to phones subscribed only in the LeMoSp ADMIN app.
create or replace function public.claim_outbox(p_secret text, p_limit integer)
returns table (
  notification_id uuid, user_id uuid, email text, full_name text, company_name text, title text, body text,
  link text, severity text, created_at timestamptz, want_email boolean, want_push boolean, subscriptions jsonb
)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  update public.notifications n set dispatched_at = now()
   where n.dispatched_at is null and n.severity <> 'info'
     and n.company_id in (select co.id from public.companies co where co.is_demo);
  return query
  with picked as (
    select n.id from public.notifications n
     where n.dispatched_at is null and n.severity <> 'info' and n.created_at > now() - interval '2 days'
       and not exists (select 1 from public.companies d where d.id = n.company_id and d.is_demo)
     order by n.created_at
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
     for update skip locked
  ), marked as (
    update public.notifications n set dispatched_at = now() from picked where n.id = picked.id
    returning n.*
  )
  select m.id, m.user_id, pr.email, pr.full_name, co.name, m.title, m.body, m.link, m.severity, m.created_at,
         coalesce(ns.email_alerts, true), coalesce(ns.push_alerts, true),
         coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                     from public.push_subscriptions s
                    where s.user_id = m.user_id and s.app in ('company', 'both')), '[]'::jsonb)
    from marked m
    join public.companies co on co.id = m.company_id
    left join public.profiles pr on pr.id = m.user_id
    left join public.notification_settings ns on ns.user_id = m.user_id;
end;
$$;

-- ---------------------------------------------------------------------
-- For platform admins (the LeMoSp ADMIN app)
-- ---------------------------------------------------------------------
create or replace function public.platform_notification_feed(p_limit integer default 100)
returns table (id uuid, kind text, title text, body text, link text, severity text, ref_company uuid,
               created_at timestamptz, read_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_platform_admin();
  return query
    select n.id, n.kind, n.title, n.body, n.link, n.severity, n.ref_company, n.created_at, r.read_at
      from public.platform_notifications n
      left join public.platform_notification_reads r on r.notification_id = n.id and r.user_id = auth.uid()
     where n.created_at > now() - interval '180 days'
     order by n.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 300));
end;
$$;

-- The bell: 0 for anyone who is not a verified platform admin.
create or replace function public.platform_unread_count()
returns integer language sql stable security definer set search_path = ''
as $$
  select case when not public.is_platform_admin() then 0 else
    (select count(*)::integer from public.platform_notifications n
      where n.created_at > now() - interval '180 days'
        and not exists (select 1 from public.platform_notification_reads r
                         where r.notification_id = n.id and r.user_id = auth.uid())) end;
$$;

-- Tap on a notification: marks it read and returns where to go.
create or replace function public.open_platform_notification(p_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_link text;
begin
  perform public.require_platform_admin();
  select n.link into v_link from public.platform_notifications n where n.id = p_id;
  if not found then
    return null;
  end if;
  insert into public.platform_notification_reads (user_id, notification_id) values (auth.uid(), p_id)
  on conflict do nothing;
  return coalesce(v_link, '/admin/notifications');
end;
$$;

create or replace function public.read_all_platform_notifications()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v integer;
begin
  perform public.require_platform_admin();
  insert into public.platform_notification_reads (user_id, notification_id)
  select auth.uid(), n.id from public.platform_notifications n
   where n.created_at > now() - interval '180 days'
  on conflict do nothing;
  get diagnostics v = row_count;
  return v;
end;
$$;

create or replace function public.my_platform_notify_email()
returns boolean language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return (select a.notify_email from public.platform_admins a where a.user_id = auth.uid());
end;
$$;

create or replace function public.set_platform_notify_email(p_on boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  update public.platform_admins set notify_email = coalesce(p_on, false) where user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
revoke execute on function
  public.platform_notify(text, text, text, text, text, uuid, text),
  public.platform_level_label(text),
  public.pn_company_insert(),
  public.pn_company_level(),
  public.pn_app_feedback(),
  public.pn_account_deletion(),
  public.pn_company_closure(),
  public.pn_backup_overdue(),
  public.pn_newdevice_burst(),
  public.platform_daily_summary_at(timestamptz),
  public.run_platform_daily_summary(text),
  public.claim_platform_outbox(text, integer),
  public.claim_outbox(text, integer),
  public.platform_notification_feed(integer),
  public.platform_unread_count(),
  public.open_platform_notification(uuid),
  public.read_all_platform_notifications(),
  public.my_platform_notify_email(),
  public.set_platform_notify_email(boolean)
from public, anon, authenticated;

-- Platform admins (each function checks is_platform_admin itself).
grant execute on function
  public.platform_notification_feed(integer),
  public.platform_unread_count(),
  public.open_platform_notification(uuid),
  public.read_all_platform_notifications(),
  public.my_platform_notify_email(),
  public.set_platform_notify_email(boolean)
to authenticated;

-- The company site's scheduled job, with the outbox secret.
grant execute on function
  public.run_platform_daily_summary(text),
  public.claim_platform_outbox(text, integer),
  public.claim_outbox(text, integer)
to anon, authenticated;

notify pgrst, 'reload schema';
