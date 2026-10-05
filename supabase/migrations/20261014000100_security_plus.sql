-- =====================================================================
-- LeMoSp · Security plus (v1.13)
--   1. "Confirm it is you" (step-up): sensitive actions need a password /
--      two-step sign-in from the last 10 minutes. Read from the sign-in
--      token's `amr` claim (Supabase: [{"method":"password","timestamp":<unix s>}, …]).
--      Enforced HERE, inside the functions, for: changing a member's role or
--      access, changing the company's sign-in security, resetting someone's
--      two-step verification, and changing the company's bank details.
--      Demo companies are exempt (guests have no password to confirm).
--   2. Sign-in history (security_events) and known devices, with an alert
--      to the person when their account is used on a new device.
--   3. A security health check for management.
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Recent sign-in ("step-up")
-- ---------------------------------------------------------------------

-- True when this session proved who it is with something the account OWNER controls
-- (password, email code / magic link, password-reset link) within the last p_minutes.
-- No claim = not recent. Authenticator codes ('totp', 'mfa/*') deliberately do NOT
-- count: someone holding the session of a person without two-step could enrol their
-- own authenticator, verify it and pass. "Confirm it's you" always re-enters the
-- password first (then the code), so two-step users still pass.
create or replace function public.recent_auth(p_minutes integer default 10)
returns boolean language sql stable set search_path = ''
as $$
  select coalesce((
    select max((e ->> 'timestamp')::bigint)
    from jsonb_array_elements(
           case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
    where jsonb_typeof(e) = 'object'
      and e ->> 'method' in ('password', 'otp', 'magiclink', 'recovery')
      and (e ->> 'timestamp') ~ '^[0-9]{1,12}$'
  ) >= extract(epoch from now()) - greatest(coalesce(p_minutes, 10), 1) * 60, false);
$$;

-- Step-up is satisfied for this company: a recent sign-in, or a demo GUEST (anonymous,
-- no password to confirm) working in their own demo company. A real account that
-- started a demo is still asked.
create or replace function public.step_up_ok(p_company uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.recent_auth(10)
      or (public.is_anonymous_user()
          and exists (select 1 from public.companies c
                        join public.memberships m on m.company_id = c.id
                       where c.id = p_company and c.is_demo
                         and m.user_id = auth.uid() and m.active));
$$;

-- Raises the error the app recognises (errcode 28000) and shows the "confirm it is you" box for.
create or replace function public.require_step_up(p_company uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.step_up_ok(p_company) then
    raise exception 'Please confirm it is you first.' using errcode = '28000';
  end if;
end;
$$;

-- Change a colleague's role or switch them on/off (management only).
-- Same as Stage 1, plus the recent sign-in check.
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

  if v_m.role = 'management' and v_m.active and (p_role <> 'management' or not p_active) then
    if (select count(*) from public.memberships
        where company_id = v_m.company_id and role = 'management' and active) <= 1 then
      raise exception 'The company needs at least one active manager.' using errcode = '23514';
    end if;
  end if;

  update public.memberships set role = p_role, active = p_active where id = p_membership;
end;
$$;

-- Management sets the company's sign-in policy. Same as Stage 10, plus the recent sign-in check.
create or replace function public.set_company_security(p_company uuid, p_require_mfa boolean, p_idle_minutes integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_demo boolean;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can change sign-in security.' using errcode = '42501';
  end if;
  if p_idle_minutes is null or p_idle_minutes not in (0, 15, 30, 60, 120, 240, 480) then
    raise exception 'Choose an automatic sign-out time from the list.' using errcode = '22023';
  end if;
  select is_demo into v_demo from public.companies where id = p_company;
  if coalesce(p_require_mfa, false) and coalesce(v_demo, false) then
    raise exception 'Two-step verification cannot be required in the demo.' using errcode = '42501';
  end if;
  if coalesce(p_require_mfa, false) and public.session_aal() <> 'aal2' then
    raise exception 'Turn on two-step verification for yourself first (Your account → Security), then sign in with it.' using errcode = '42501';
  end if;
  perform public.require_step_up(p_company);
  update public.companies
     set require_mfa = coalesce(p_require_mfa, false),
         idle_timeout_minutes = p_idle_minutes
   where id = p_company;
end;
$$;

-- Lost phone: management removes a member's authenticator. Same as Stage 10, plus the recent sign-in check.
create or replace function public.reset_member_mfa(p_membership uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid;
  v_company uuid;
begin
  select user_id, company_id into v_user, v_company from public.memberships where id = p_membership;
  if v_user is null or not public.is_manager(v_company) then
    raise exception 'Only management can reset two-step verification.' using errcode = '42501';
  end if;
  if v_user = auth.uid() then
    raise exception 'You cannot reset your own two-step verification here. Ask another manager.' using errcode = '42501';
  end if;
  if exists (select 1 from public.memberships m
             where m.user_id = v_user and m.active and not public.is_manager(m.company_id)) then
    raise exception 'This person also works in another company, so only that company''s management can reset their two-step verification.' using errcode = '42501';
  end if;
  perform public.require_step_up(v_company);
  delete from auth.mfa_factors where user_id = v_user;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (v_company, auth.uid(), 'update', 'memberships', p_membership::text, jsonb_build_object('two_step', 'reset by management'));
end;
$$;

-- Text printed on quotations, purchase orders and invoices where someone could write
-- "pay to account X" (bank details, document footer, quotation / PO / invoice terms):
-- changing it (a classic fraud) needs a recent sign-in. Database maintenance (no
-- signed-in user) is not affected.
create or replace function public.norm_doc_text(p text)
returns text language sql immutable set search_path = ''
as $$
  -- Spaces and line breaks do not count as a change (forms send line breaks differently).
  select btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
$$;

create or replace function public.guard_bank_details()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and (
       public.norm_doc_text(new.bank_details)    is distinct from public.norm_doc_text(old.bank_details)
    or public.norm_doc_text(new.document_footer) is distinct from public.norm_doc_text(old.document_footer)
    or public.norm_doc_text(new.quote_terms)     is distinct from public.norm_doc_text(old.quote_terms)
    or public.norm_doc_text(new.po_terms)        is distinct from public.norm_doc_text(old.po_terms)
    or public.norm_doc_text(new.invoice_terms)   is distinct from public.norm_doc_text(old.invoice_terms)) then
    perform public.require_step_up(old.id);
  end if;
  return new;
end;
$$;
drop trigger if exists companies_bank_details_guard on public.companies;
create trigger companies_bank_details_guard
  before update of bank_details, document_footer, quote_terms, po_terms, invoice_terms on public.companies
  for each row execute function public.guard_bank_details();

-- ---------------------------------------------------------------------
-- 2. Sign-in history and known devices
-- ---------------------------------------------------------------------
create table if not exists public.security_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  company_id  uuid references public.companies (id) on delete set null,
  kind        text not null,
  device      text,
  ip_hint     text,
  created_at  timestamptz not null default now()
);
alter table public.security_events drop constraint if exists security_events_kind_check;
alter table public.security_events add constraint security_events_kind_check
  check (kind in ('sign_in', 'sign_in_new_device', 'sign_out_everywhere', 'password_changed',
                  'two_step_on', 'two_step_off', 'reauth', 'export'));
create index if not exists security_events_user_idx on public.security_events (user_id, created_at desc);
create index if not exists security_events_company_idx on public.security_events (company_id, created_at desc);

-- Devices a person has signed in from: a hash of a random id kept in a cookie
-- on that browser plus "browser on system". Nothing else about the device.
create table if not exists public.known_devices (
  user_id     uuid not null references auth.users (id) on delete cascade,
  device_key  text not null check (device_key ~ '^[0-9a-f]{64}$'),
  device      text,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (user_id, device_key)
);

alter table public.security_events enable row level security;
alter table public.known_devices enable row level security;

drop policy if exists security_events_select on public.security_events;
create policy security_events_select on public.security_events for select to authenticated
  using (user_id = auth.uid() or (company_id is not null and public.is_manager(company_id)));
drop policy if exists known_devices_select on public.known_devices;
create policy known_devices_select on public.known_devices for select to authenticated
  using (user_id = auth.uid());

revoke all on public.security_events, public.known_devices from anon, authenticated;
grant select on public.security_events, public.known_devices to authenticated;

-- Records a security event for the signed-in person only. For 'sign_in' with a
-- device key, the database decides whether the device is new: then the event is
-- 'sign_in_new_device' and the person gets an alert (in the app, by phone and email).
-- Returns the kind recorded, or null when nothing was recorded (guest, too many).
create or replace function public.record_security_event(p_kind text, p_device text, p_ip_hint text, p_company uuid,
                                                        p_device_key text default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_kind text := p_kind;
  v_signin boolean;
  v_device text := nullif(left(btrim(regexp_replace(coalesce(p_device, ''), '[[:cntrl:]<>"]', '', 'g')), 60), '');
  v_ip text := case when p_ip_hint ~ '^[0-9A-Fa-f:.x]{1,40}$' then p_ip_hint end;
  v_company uuid;
  v_recent integer;
  v_had_devices boolean;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  if v_kind is null or v_kind not in ('sign_in', 'sign_in_new_device', 'sign_out_everywhere', 'password_changed',
                                      'two_step_on', 'two_step_off', 'reauth', 'export') then
    raise exception 'Unknown security event.' using errcode = '22023';
  end if;
  -- Demo guests: nothing to protect, nothing kept.
  if public.is_anonymous_user() then
    return null;
  end if;
  -- Only the database decides that a device is new.
  if v_kind = 'sign_in_new_device' then
    v_kind := 'sign_in';
  end if;
  v_signin := v_kind = 'sign_in';

  -- Limits, counted separately so other events can never crowd out sign-ins.
  select count(*) into v_recent from public.security_events
   where user_id = v_user and created_at > now() - interval '1 hour'
     and (kind in ('sign_in', 'sign_in_new_device')) = v_signin;
  if v_recent >= (case when v_signin then 30 else 60 end) then
    return null;
  end if;

  -- The company it is shown under: the one given (if the person works there), else their first.
  if p_company is not null then
    select m.company_id into v_company from public.memberships m
     where m.user_id = v_user and m.active and m.company_id = p_company;
  end if;
  if v_company is null then
    select m.company_id into v_company from public.memberships m
     where m.user_id = v_user and m.active order by m.created_at limit 1;
  end if;

  if v_signin and p_device_key ~ '^[0-9a-f]{64}$' then
    select exists (select 1 from public.known_devices where user_id = v_user) into v_had_devices;
    update public.known_devices set last_seen = now(), device = coalesce(v_device, device)
     where user_id = v_user and device_key = p_device_key;
    if not found then
      insert into public.known_devices (user_id, device_key, device) values (v_user, p_device_key, v_device)
      on conflict do nothing;
      -- The very first device after this feature starts is learnt quietly.
      if v_had_devices then
        v_kind := 'sign_in_new_device';
      end if;
    end if;
  end if;

  insert into public.security_events (user_id, company_id, kind, device, ip_hint)
  values (v_user, v_company, v_kind, v_device, v_ip)
  returning id into v_id;

  -- At most 5 new-device alerts per person per day (the sign-ins are still recorded).
  if v_kind = 'sign_in_new_device' and v_company is not null
     and (select count(*) from public.notifications n
           where n.user_id = v_user and n.kind = 'security' and n.dedupe_key like 'newdevice:%'
             and n.created_at > now() - interval '1 day') < 5 then
    perform public.notify(v_company, v_user, 'security', 'attention', 'New sign-in to your LeMoSp account',
      coalesce(v_device, 'Unknown device') || ' · '
        || to_char(now() at time zone 'Africa/Dar_es_Salaam', 'DD Mon YYYY HH24:MI') || ' (EAT)'
        || coalesce(' · ' || v_ip, '')
        || '. If this wasn''t you, change your password and sign out of all devices.',
      '/account#security', 'newdevice:' || v_id::text);
  end if;

  -- Housekeeping: history is kept for 180 days; devices unused for a year are forgotten.
  delete from public.security_events where user_id = v_user and created_at < now() - interval '180 days';
  delete from public.known_devices where user_id = v_user and last_seen < now() - interval '365 days';
  return v_kind;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Security health check (management)
-- status: 'ok' | 'warn' | 'bad' | null (not known here)
-- ---------------------------------------------------------------------
create or replace function public.company_security_health(p_company uuid)
returns table (item text, status text, value integer, total integer, names text[])
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_c public.companies;
  v_members integer;
  v_with integer;
  v_managers integer;
  v_inactive text[];
  v_last_backup timestamptz;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can see this.' using errcode = '42501';
  end if;
  select * into v_c from public.companies where id = p_company;

  select count(*),
         count(*) filter (where exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified')),
         count(*) filter (where m.role = 'management')
    into v_members, v_with, v_managers
    from public.memberships m where m.company_id = p_company and m.active;

  select coalesce(array_agg(coalesce(nullif(btrim(p.full_name), ''), p.email, '?') order by p.full_name), '{}')
    into v_inactive
    from public.memberships m
    join auth.users u on u.id = m.user_id
    left join public.profiles p on p.id = m.user_id
   where m.company_id = p_company and m.active
     and coalesce(u.last_sign_in_at, m.created_at) < now() - interval '60 days';

  item := 'two_step_required'; status := case when v_c.require_mfa then 'ok' else 'warn' end;
  value := null; total := null; names := null; return next;

  item := 'two_step_coverage';
  status := case when v_with >= v_members then 'ok' when v_with * 2 >= v_members then 'warn' else 'bad' end;
  value := v_with; total := v_members; return next;

  item := 'idle_sign_out'; status := case when coalesce(v_c.idle_timeout_minutes, 0) > 0 then 'ok' else 'warn' end;
  value := v_c.idle_timeout_minutes; total := null; return next;

  item := 'managers'; status := case when v_managers between 2 and 3 then 'ok' else 'warn' end;
  value := v_managers; total := v_members; return next;

  -- Automatic backups (when the backups update has been run; checked at run time).
  if to_regclass('public.company_backups') is not null then
    execute 'select max(taken_at) from public.company_backups where company_id = $1 and kind <> ''manual'''
      into v_last_backup using p_company;
    item := 'backup';
    status := case when v_last_backup >= now() - interval '2 days' then 'ok' else 'warn' end;
  else
    item := 'backup'; status := null;
  end if;
  value := null; total := null; names := null; return next;

  item := 'inactive_members'; status := case when cardinality(v_inactive) = 0 then 'ok' else 'warn' end;
  value := cardinality(v_inactive); total := v_members; names := v_inactive; return next;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
revoke execute on function
  public.recent_auth(integer),
  public.step_up_ok(uuid),
  public.require_step_up(uuid),
  public.update_membership(uuid, public.app_role, boolean),
  public.set_company_security(uuid, boolean, integer),
  public.reset_member_mfa(uuid),
  public.guard_bank_details(),
  public.norm_doc_text(text),
  public.record_security_event(text, text, text, uuid, text),
  public.company_security_health(uuid)
from public, anon;
revoke execute on function public.require_step_up(uuid), public.guard_bank_details(), public.norm_doc_text(text)
  from authenticated;

grant execute on function
  public.recent_auth(integer),
  public.step_up_ok(uuid),
  public.update_membership(uuid, public.app_role, boolean),
  public.set_company_security(uuid, boolean, integer),
  public.reset_member_mfa(uuid),
  public.record_security_event(text, text, text, uuid, text),
  public.company_security_health(uuid)
to authenticated;

notify pgrst, 'reload schema';
