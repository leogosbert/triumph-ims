-- =====================================================================
-- Multiple roles per person: small teams where one person does sales
-- and finance, or runs the store and drives.
--
--   memberships.extra_roles   roles a person has on top of their main
--                             role (memberships.role, still shown as
--                             "their role"). Empty for everyone at first,
--                             so nothing changes until management adds one.
--   invitations.extra_roles   extra roles given with an invitation; they
--                             are copied to the membership on joining.
--
-- public.has_role is true when the main role OR an extra role matches
-- (two-step policy unchanged), so every rule built on has_role,
-- is_manager and the *_roles() lists follows automatically. The few
-- functions that read memberships.role themselves are redefined below
-- from their latest version with only the role test changed.
--
--   set_member_roles(membership, main role, extra roles)
--                             management only (recent password), keeps at
--                             least one active manager.
--   invite_member(company, email, role, extra roles)
--                             same as invite_member(company, email, role)
--                             plus extra roles.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------
alter table public.memberships add column if not exists extra_roles public.app_role[] not null default '{}';
alter table public.invitations add column if not exists extra_roles public.app_role[] not null default '{}';

-- ---------------------------------------------------------------------
-- 2. The role check every rule uses
-- ---------------------------------------------------------------------
create or replace function public.has_role(p_company uuid, p_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company and m.user_id = auth.uid() and m.active
      and (m.role = any (p_roles) or m.extra_roles && p_roles)
  ) and public.mfa_satisfied(p_company);
$$;

-- Everyone in the company with one of the roles (main or extra), except p_exclude.
create or replace function public.notify_roles(p_company uuid, p_roles public.app_role[], p_exclude uuid, p_kind text,
                                               p_severity text, p_title text, p_body text, p_link text, p_key text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m record;
begin
  for m in select user_id from public.memberships
            where company_id = p_company and active and (role = any (p_roles) or extra_roles && p_roles)
              and user_id is distinct from p_exclude loop
    perform public.notify(p_company, m.user_id, p_kind, p_severity, p_title, p_body, p_link, p_key);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Management sets a person's main role and extra roles
-- ---------------------------------------------------------------------
create or replace function public.set_member_roles(p_membership uuid, p_role public.app_role, p_extra public.app_role[])
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_m     public.memberships;
  v_extra public.app_role[];
begin
  select * into v_m from public.memberships where id = p_membership;
  if v_m.id is null or not public.is_manager(v_m.company_id) then
    raise exception 'Team member not found.' using errcode = '42501';
  end if;
  if p_role is null then
    raise exception 'Please choose a role.' using errcode = '22023';
  end if;
  perform public.require_step_up(v_m.company_id);
  -- Counted with the company row locked, like update_membership.
  perform 1 from public.companies where id = v_m.company_id for update;

  select coalesce(array_agg(distinct r order by r), '{}') into v_extra
    from unnest(coalesce(p_extra, '{}'::public.app_role[])) r
   where r is not null and r <> p_role;

  if v_m.active and (v_m.role = 'management' or 'management' = any (v_m.extra_roles))
     and p_role <> 'management' and not 'management' = any (v_extra) then
    if (select count(*) from public.memberships
        where company_id = v_m.company_id and active and (role = 'management' or 'management' = any (extra_roles))) <= 1 then
      raise exception 'The company needs at least one active manager.' using errcode = '23514';
    end if;
  end if;

  update public.memberships set role = p_role, extra_roles = v_extra where id = p_membership;
end;
$$;

-- Invite with extra roles: the usual invitation (same checks), then the extra roles on it.
create or replace function public.invite_member(p_company uuid, p_email text, p_role public.app_role, p_extra public.app_role[])
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  v_id := public.invite_member(p_company, p_email, p_role);
  update public.invitations
     set extra_roles = (select coalesce(array_agg(distinct r order by r), '{}')
                          from unnest(coalesce(p_extra, '{}'::public.app_role[])) r
                         where r is not null and r <> p_role)
   where id = v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Functions that read memberships.role themselves
-- ---------------------------------------------------------------------
-- update_membership: latest definition from 20261015000100_deletion.sql, role test now includes extra roles.
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

  -- Management through the main role or an extra role (multiple roles) counts the same.
  if (v_m.role = 'management' or 'management' = any (v_m.extra_roles)) and v_m.active
     and ((p_role <> 'management' and not 'management' = any (v_m.extra_roles)) or not p_active) then
    if (select count(*) from public.memberships
        where company_id = v_m.company_id and (role = 'management' or 'management' = any (extra_roles)) and active) <= 1 then
      raise exception 'The company needs at least one active manager.' using errcode = '23514';
    end if;
  end if;

  update public.memberships
     set role = p_role, active = p_active, extra_roles = array_remove(extra_roles, p_role),
         suspended_for_deletion_at = case when p_active then suspended_for_deletion_at end,
         suspended_for_closure_at  = case when p_active then suspended_for_closure_at end
   where id = p_membership;
end;
$$;

-- account_deletion_blockers: latest definition from 20261015000100_deletion.sql, role test now includes extra roles.
create or replace function public.account_deletion_blockers()
returns table (company_id uuid, company_name text, kind text, can_close boolean, role_manager boolean)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name,
         case when not exists (select 1 from public.memberships o
                                where o.company_id = c.id and o.user_id <> m.user_id and o.active)
              then 'only_member' else 'sole_manager' end,
         public.is_manager(c.id),
         (m.role = 'management' or 'management' = any (m.extra_roles))
    from public.memberships m
    join public.companies c on c.id = m.company_id
   where m.user_id = auth.uid() and m.active and not c.is_demo and c.closing_after is null
     and (
       not exists (select 1 from public.memberships o where o.company_id = c.id and o.user_id <> m.user_id and o.active)
       or ((m.role = 'management' or 'management' = any (m.extra_roles))
           and not exists (select 1 from public.memberships o
                            where o.company_id = c.id and o.user_id <> m.user_id and o.active and (o.role = 'management' or 'management' = any (o.extra_roles))))
     )
   order by c.name;
$$;

-- guard_suspended_membership: latest definition from 20261015000100_deletion.sql, role test now includes extra roles.
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
    if new.role <> 'management' and not 'management' = any (coalesce(new.extra_roles, '{}'))
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

-- schedule_company_closure: latest definition from 20261015000100_deletion.sql, role test now includes extra roles.
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
   where company_id = p_company and role <> 'management' and not 'management' = any (extra_roles)
     and suspended_for_closure_at is null
     and (active or suspended_for_deletion_at is not null);

  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (p_company, p_actor, 'close_requested', 'companies', p_company::text, jsonb_build_object('delete_after', v_after));
  return v_after;
end;
$$;

-- inbox_assign: latest definition from 20261026000200_inbox.sql, role test now includes extra roles.
create or replace function public.inbox_assign(p_conversation uuid, p_user uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  c public.inbox_conversations := public.inbox_conversation_for_update(p_conversation);
begin
  if p_user is not null and not exists (
       select 1 from public.memberships m
        where m.company_id = c.company_id and m.user_id = p_user and m.active
          and (m.role = any (public.inbox_roles()) or m.extra_roles && public.inbox_roles())) then
    raise exception 'That person cannot use the inbox.' using errcode = '22023';
  end if;
  if c.assigned_to is not distinct from p_user then return; end if;
  update public.inbox_conversations set assigned_to = p_user where id = c.id;
  if p_user is not null and p_user is distinct from auth.uid() then
    perform public.notify(c.company_id, p_user, 'inbox_assigned', 'info',
      'Conversation for you: ' || coalesce(c.counterpart_name, c.counterpart_address),
      coalesce(c.subject, c.preview, 'Open the conversation to reply.'),
      '/inbox/' || c.id::text, 'inbox-assigned:' || c.id::text || ':' || extract(epoch from now())::bigint::text);
  end if;
end;
$$;

-- meeting_schedule_series: latest definition from 20261026000400_meetings.sql, role test now includes extra roles.
create or replace function public.meeting_schedule_series(p_company uuid, p_days integer default 14)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  s       public.meeting_series;
  d       date;
  v_today date := public.meeting_today();
  v_n     integer := 0;
  v_id    uuid;
  v_pres  uuid;
  v_last  uuid;
  v_k     integer;
  v_people uuid[];
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  for s in select * from public.meeting_series where company_id = p_company and active loop
    for d in select g::date from generate_series(v_today, v_today + least(greatest(coalesce(p_days, 14), 0), 60), interval '1 day') g loop
      continue when not public.meeting_series_occurs(s, d);
      continue when exists (select 1 from public.meetings where series_id = s.id and meeting_date = d);
      v_pres := null;
      if s.presenter_mode = 'fixed' then
        v_pres := s.presenter_id;
      elsif s.presenter_mode = 'rotate' and cardinality(s.rotation) > 0 then
        select presenter_id into v_last from public.meetings
         where series_id = s.id and presenter_id is not null order by meeting_date desc limit 1;
        v_k := coalesce(array_position(s.rotation, v_last), 0);
        v_pres := s.rotation[(v_k % cardinality(s.rotation)) + 1];
      end if;
      select coalesce(array_agg(m.user_id), '{}') into v_people
        from public.memberships m
       where m.company_id = p_company and m.active
         and (s.audience = 'everyone' or (s.audience = 'roles' and (m.role = any (s.audience_roles) or m.extra_roles && s.audience_roles))
              or (s.audience = 'people' and m.user_id = any (s.audience_people)));
      begin
        v_id := public.meeting_insert(p_company,
          jsonb_build_object('title', s.title, 'purpose', s.purpose, 'kind', 'internal',
                             'starts_at', ((d + s.start_time) at time zone 'Africa/Dar_es_Salaam'),
                             'minutes', s.minutes, 'place', s.place, 'topics', to_jsonb(s.topics), 'chair_id', s.chair_id,
                             'presenter_id', v_pres, 'open_to_team', s.audience = 'everyone', 'record', s.record,
                             'language', s.language, 'attendees', to_jsonb(v_people)),
          s.id, s.created_by);
        v_n := v_n + 1;
      exception when unique_violation then
        null;  -- made at the same moment on another device
      end;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- accept_invitation: latest definition from 20261011000100_stage10_demo.sql, role test now includes extra roles.
create or replace function public.accept_invitation(p_invitation uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  if public.is_anonymous_user() then
    raise exception 'Create an account (or sign in) to accept an invitation.' using errcode = '42501';
  end if;
  select * into v_inv from public.invitations
  where id = p_invitation and accepted_at is null and revoked_at is null
    and email = lower(auth.jwt() ->> 'email');
  if v_inv.id is null then
    raise exception 'Invitation not found or no longer valid.' using errcode = '42501';
  end if;

  insert into public.memberships (company_id, user_id, role, extra_roles, active)
  values (v_inv.company_id, auth.uid(), v_inv.role, array_remove(coalesce(v_inv.extra_roles, '{}'), v_inv.role), true)
  on conflict (company_id, user_id) do update set role = excluded.role, extra_roles = excluded.extra_roles, active = true;

  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  return v_inv.company_id;
end;
$$;

-- calendar_items_for: latest definition from 20261026000400_meetings.sql, role test now includes extra roles.
create or replace function public.calendar_items_for(p_company uuid, p_user uuid, p_from date, p_to date, p_kinds text[])
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_roles public.app_role[];
  v_mgr   boolean;
  v_to    date := least(p_to, p_from + 400);
  k       text[] := coalesce(p_kinds, array['meeting', 'action', 'entry', 'delivery', 'supplies', 'quotation', 'invoice', 'compliance', 'leave', 'follow_up']);
  res     jsonb := '[]'::jsonb;
begin
  -- The main role and any extra roles (multiple roles).
  select array_prepend(role, extra_roles) into v_roles from public.memberships where company_id = p_company and user_id = p_user and active;
  if v_roles is null or p_from is null or v_to is null or v_to < p_from then
    return '[]'::jsonb;
  end if;
  v_mgr := 'management' = any (v_roles);
  if 'meeting' = any (k) then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'm-' || m.id, 'date', m.meeting_date,
             'time', to_char(m.starts_at at time zone 'Africa/Dar_es_Salaam', 'HH24:MI') || '-'
                     || to_char((m.starts_at + make_interval(mins => m.minutes)) at time zone 'Africa/Dar_es_Salaam', 'HH24:MI'),
             'kind', 'meeting', 'title', m.title || case when m.status = 'cancelled' then ' (cancelled)' else '' end,
             'notes', concat_ws(' · ', m.place, case m.video_provider when 'external' then 'Online (their link)' when 'none' then null else 'Video in the app' end),
             'href', '/meetings/' || m.id))
      from public.meetings m
     where m.company_id = p_company and m.meeting_date between p_from and v_to and m.status <> 'cancelled'
       and (v_mgr or m.open_to_team or m.created_by = p_user or m.chair_id = p_user or m.presenter_id = p_user
            or exists (select 1 from public.meeting_attendees a where a.meeting_id = m.id and a.user_id = p_user))), '[]');
  end if;
  if 'action' = any (k) then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'a-' || p.id, 'date', p.due_on, 'kind', 'action',
             'title', 'Action: ' || left(p.body, 120) || coalesce(' (' || nullif(btrim(pr.full_name), '') || ')', ''),
             'notes', 'From ' || m.title, 'href', '/meetings/actions'))
      from public.meeting_points p join public.meetings m on m.id = p.meeting_id left join public.profiles pr on pr.id = p.owner_id
     where p.company_id = p_company and p.approved and p.kind = 'action' and p.status in ('open', 'in_progress')
       and p.due_on between p_from and v_to and (v_mgr or p.owner_id = p_user)), '[]');
  end if;
  if 'entry' = any (k) then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'c-' || e.id, 'date', e.starts_on, 'end', e.ends_on,
             'time', to_char(e.at_time, 'HH24:MI'), 'kind', e.kind, 'title', e.title, 'notes', e.notes,
             'href', case when e.meeting_id is not null then '/meetings/' || e.meeting_id else '/calendar?entry=' || e.id end, 'entry_id', e.id))
      from public.calendar_entries e
     where e.company_id = p_company and e.starts_on <= v_to and coalesce(e.ends_on, e.starts_on) >= p_from
       and (not e.private or e.owner_id = p_user or e.created_by = p_user or v_mgr)), '[]');
  end if;
  if 'delivery' = any (k) and v_roles && array['management', 'sales', 'warehouse', 'finance', 'driver']::public.app_role[] then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'd-' || d.id, 'date', d.planned_date, 'kind', 'delivery',
             'title', 'Deliver ' || coalesce(d.number, '') || coalesce(' to ' || c.name, ''), 'notes', d.delivery_site, 'href', '/deliveries/' || d.id))
      from public.deliveries d left join public.clients c on c.id = d.client_id
     where d.company_id = p_company and d.planned_date between p_from and v_to and d.status in ('draft', 'dispatched')
       and (v_roles && array['management', 'sales', 'warehouse', 'finance']::public.app_role[] or d.driver_id = p_user)), '[]');
  end if;
  if 'supplies' = any (k) and v_roles && array['management', 'procurement', 'finance', 'warehouse']::public.app_role[] then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'o-' || po.id, 'date', po.expected_date, 'kind', 'supplies',
             'title', coalesce(po.number, 'Order') || coalesce(' from ' || s.name, '') || ' arriving', 'href', '/purchase-orders/' || po.id))
      from public.purchase_orders po left join public.suppliers s on s.id = po.supplier_id
     where po.company_id = p_company and po.expected_date between p_from and v_to
       and po.status in ('approved', 'sent', 'confirmed', 'partially_received')), '[]');
  end if;
  if 'quotation' = any (k) and v_roles && array['management', 'sales', 'procurement', 'finance']::public.app_role[] then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'q-' || q.id, 'date', q.valid_until, 'kind', 'quotation',
             'title', coalesce(q.number, 'Quotation') || coalesce(' · ' || c.name, '') || ' valid until', 'href', '/quotations/' || q.id))
      from public.quotations q left join public.clients c on c.id = q.client_id
     where q.company_id = p_company and q.valid_until between p_from and v_to and q.status in ('approved', 'sent')), '[]');
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'r-' || r.id, 'date', r.due_on, 'kind', 'quotation',
             'title', 'Quote due: ' || coalesce(r.title, r.number, '') || coalesce(' · ' || c.name, ''), 'href', '/rfqs/' || r.id))
      from public.rfqs r left join public.clients c on c.id = r.client_id
     where r.company_id = p_company and r.due_on between p_from and v_to and r.status in ('new', 'quoting')), '[]');
  end if;
  if 'invoice' = any (k) and v_roles && array['management', 'finance', 'sales']::public.app_role[] then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'i-' || i.id, 'date', i.due_date, 'kind', 'invoice',
             'title', coalesce(i.number, 'Invoice') || coalesce(' · ' || c.name, '') || ' due', 'href', '/invoices/' || i.id))
      from public.invoices i left join public.clients c on c.id = i.client_id
     where i.company_id = p_company and i.due_date between p_from and v_to and i.status in ('issued', 'partly_paid')), '[]');
  end if;
  if 'compliance' = any (k) and not v_roles <@ array['driver']::public.app_role[] then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'f-' || d.id, 'date', d.due_on, 'kind', 'compliance',
             'title', 'File: ' || i.name, 'notes', public.compliance_period_label(d.period_start, d.period_end), 'href', '/compliance/calendar'))
      from public.compliance_deadlines d join public.compliance_items i on i.id = d.item_id
     where d.company_id = p_company and d.status = 'open' and i.status <> 'not_applicable' and d.due_on between p_from and v_to), '[]');
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'l-' || l.id, 'date', l.expires_on, 'kind', 'compliance',
             'title', 'Licence expires: ' || l.name, 'notes', l.authority, 'href', '/compliance/licences/' || l.id))
      from public.licences l
     where l.company_id = p_company and l.status in ('active', 'expired') and l.expires_on between p_from and v_to), '[]');
  end if;
  if 'leave' = any (k) then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'v-' || l.id, 'date', l.starts_on, 'end', l.ends_on, 'kind', 'leave',
             'title', e.full_name || ' on leave', 'href', '/hr/leave'))
      from public.leave_requests l join public.employees e on e.id = l.employee_id
     where l.company_id = p_company and l.status = 'approved' and l.starts_on <= v_to and l.ends_on >= p_from
       and (v_roles && array['management', 'finance']::public.app_role[] or e.user_id = p_user)), '[]');
  end if;
  if 'follow_up' = any (k) and v_roles && array['management', 'sales']::public.app_role[] then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'p-' || o.id, 'date', o.next_on, 'kind', 'follow_up',
             'title', 'Follow up: ' || o.title, 'notes', o.next_action, 'href', '/crm/' || o.id))
      from public.opportunities o
     where o.company_id = p_company and o.stage not in ('won', 'lost') and o.next_on between p_from and v_to), '[]');
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'u-' || f.id, 'date', f.next_on, 'kind', 'follow_up',
             'title', 'Follow up ' || coalesce(q.number, i.number, ''), 'notes', f.note,
             'href', case when f.quotation_id is not null then '/quotations/' || f.quotation_id else '/invoices/' || f.invoice_id end))
      from public.followups f left join public.quotations q on q.id = f.quotation_id left join public.invoices i on i.id = f.invoice_id
     where f.company_id = p_company and f.next_on between p_from and v_to), '[]');
  end if;
  return res;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Who may call the new functions (the redefined ones keep their grants)
-- ---------------------------------------------------------------------
revoke execute on function public.set_member_roles(uuid, public.app_role, public.app_role[]) from public, anon;
revoke execute on function public.invite_member(uuid, text, public.app_role, public.app_role[]) from public, anon;
grant execute on function public.set_member_roles(uuid, public.app_role, public.app_role[]) to authenticated;
grant execute on function public.invite_member(uuid, text, public.app_role, public.app_role[]) to authenticated;
