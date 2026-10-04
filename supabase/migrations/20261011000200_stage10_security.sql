-- =====================================================================
-- LeMoSp · Stage 10b: sign-in security policies per company
--   • require_mfa: everyone must use two-step verification (an authenticator
--     app code). Enforced IN THE DATABASE: without a two-step session
--     (JWT claim aal = 'aal2') a member cannot read or change any of that
--     company's data, even with a stolen password.
--   • idle_timeout_minutes: the app signs people out after this many
--     minutes without activity (0 = off).
-- Changed only through set_company_security() (management only).
-- =====================================================================

alter table public.companies
  add column if not exists require_mfa boolean not null default false,
  add column if not exists idle_timeout_minutes integer not null default 0;

alter table public.companies drop constraint if exists companies_idle_timeout_check;
alter table public.companies add constraint companies_idle_timeout_check
  check (idle_timeout_minutes in (0, 15, 30, 60, 120, 240, 480));

-- The session's assurance level from the sign-in token ('aal1' = password only).
create or replace function public.session_aal()
returns text language sql stable set search_path = ''
as $$
  select coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1');
$$;

-- True when the company does not demand two-step, or this session has passed it.
create or replace function public.mfa_satisfied(p_company uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.session_aal() = 'aal2'
      or not exists (select 1 from public.companies c where c.id = p_company and c.require_mfa);
$$;

-- Membership checks used by every security rule now include the two-step policy.
create or replace function public.is_member(p_company uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company and m.user_id = auth.uid() and m.active
  ) and public.mfa_satisfied(p_company);
$$;

create or replace function public.has_role(p_company uuid, p_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company and m.user_id = auth.uid() and m.active
      and m.role = any (p_roles)
  ) and public.mfa_satisfied(p_company);
$$;

-- Lets the app tell a signed-in person which of their companies demand two-step
-- (they cannot read those companies' rows until they have passed it).
create or replace function public.my_security_requirements()
returns table (company_id uuid, company_name text, require_mfa boolean, idle_timeout_minutes integer)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.name, c.require_mfa, c.idle_timeout_minutes
  from public.memberships m
  join public.companies c on c.id = m.company_id
  where m.user_id = auth.uid() and m.active;
$$;

-- Management sets the company's sign-in policy.
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
  update public.companies
     set require_mfa = coalesce(p_require_mfa, false),
         idle_timeout_minutes = p_idle_minutes
   where id = p_company;
end;
$$;

revoke execute on function public.session_aal() from public, anon;
revoke execute on function public.mfa_satisfied(uuid) from public, anon;
revoke execute on function public.my_security_requirements() from public, anon;
revoke execute on function public.set_company_security(uuid, boolean, integer) from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.has_role(uuid, public.app_role[]) from public, anon;
grant execute on function public.session_aal() to authenticated;
grant execute on function public.mfa_satisfied(uuid) to authenticated;
grant execute on function public.my_security_requirements() to authenticated;
grant execute on function public.set_company_security(uuid, boolean, integer) to authenticated;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.has_role(uuid, public.app_role[]) to authenticated;

-- =====================================================================
-- Close the remaining ways around the two-step policy (security review)
-- =====================================================================

-- A person's own settings (phone notifications, alert emails): if ANY of their
-- companies requires two-step, changing them needs a two-step session.
create or replace function public.user_mfa_ok()
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.session_aal() = 'aal2'
      or not exists (
        select 1 from public.memberships m join public.companies c on c.id = m.company_id
        where m.user_id = auth.uid() and m.active and c.require_mfa
      );
$$;
revoke execute on function public.user_mfa_ok() from public, anon;
grant execute on function public.user_mfa_ok() to authenticated;

drop policy if exists notification_settings_own on public.notification_settings;
create policy notification_settings_own on public.notification_settings for all to authenticated
  using (user_id = auth.uid() and public.user_mfa_ok())
  with check (user_id = auth.uid() and public.user_mfa_ok());
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid() and public.user_mfa_ok())
  with check (user_id = auth.uid() and public.user_mfa_ok());

-- Colleagues' names, emails and phones also need the two-step session.
create or replace function public.shares_company_with(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.company_id = mine.company_id
    where mine.user_id = auth.uid() and mine.active and theirs.user_id = p_user
      and public.mfa_satisfied(mine.company_id)
  );
$$;
revoke execute on function public.shares_company_with(uuid) from public, anon;
grant execute on function public.shares_company_with(uuid) to authenticated;

-- A storage folder name as a company id (null if it is not one).
create or replace function public.folder_company(p_folder text)
returns uuid language plpgsql immutable set search_path = ''
as $$
begin
  return p_folder::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;
revoke execute on function public.folder_company(text) from public, anon;
grant execute on function public.folder_company(text) to authenticated;

-- Is this storage folder (a company id) a demo company?
create or replace function public.folder_is_demo(p_folder text)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
begin
  return exists (select 1 from public.companies where id = p_folder::uuid and is_demo);
exception when invalid_text_representation then
  return false;
end;
$$;
revoke execute on function public.folder_is_demo(text) from public, anon;
grant execute on function public.folder_is_demo(text) to authenticated;

-- Company logo files: go through has_role / is_member (so the two-step policy applies),
-- and no uploads at all from demo companies (no anonymous file hosting).
drop policy if exists branding_manage_insert on storage.objects;
drop policy if exists branding_manage_update on storage.objects;
drop policy if exists branding_manage_delete on storage.objects;
drop policy if exists branding_member_select on storage.objects;
create policy branding_manage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and public.has_role(public.folder_company((storage.foldername(name))[1]), array['management']::public.app_role[])
    and not public.folder_is_demo((storage.foldername(name))[1])
  );
create policy branding_manage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'branding'
    and public.has_role(public.folder_company((storage.foldername(name))[1]), array['management']::public.app_role[])
    and not public.folder_is_demo((storage.foldername(name))[1])
  );
create policy branding_manage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'branding'
    and public.has_role(public.folder_company((storage.foldername(name))[1]), array['management']::public.app_role[])
  );
create policy branding_member_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'branding'
    and public.is_member(public.folder_company((storage.foldername(name))[1]))
  );

-- Proof-of-delivery photos: none from demo companies.
drop policy if exists pod_insert on storage.objects;
create policy pod_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pod'
    and not public.folder_is_demo((storage.foldername(name))[1])
    and exists (select 1 from public.deliveries d
                where d.company_id::text = (storage.foldername(name))[1]
                  and d.id::text = (storage.foldername(name))[2]
                  and (d.driver_id = auth.uid()
                       or public.has_role(d.company_id, array['management', 'warehouse']::public.app_role[])))
  );

-- Logos: pictures only (no SVG, which can carry scripts).
do $$
begin
  update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'] where id = 'branding';
exception when undefined_column then
  raise notice 'Storage limits not set (older storage version).';
end $$;

-- =====================================================================
-- Management view of who has two-step on, and a reset for lost phones
-- =====================================================================
create or replace function public.team_mfa_status(p_company uuid)
returns table (membership_id uuid, user_id uuid, full_name text, email text, role public.app_role, has_mfa boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can see this.' using errcode = '42501';
  end if;
  return query
    select m.id, m.user_id, p.full_name, p.email, m.role,
           exists (select 1 from auth.mfa_factors f where f.user_id = m.user_id and f.status = 'verified')
    from public.memberships m
    left join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and m.active
    order by p.full_name nulls last, p.email;
end;
$$;

-- A member lost their phone: management removes their authenticator so they can set up a new one.
-- Only for people whose every company is one the caller manages (a manager cannot weaken
-- someone's sign-in for a company they don't run), never for yourself.
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
  delete from auth.mfa_factors where user_id = v_user;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (v_company, auth.uid(), 'update', 'memberships', p_membership::text, jsonb_build_object('two_step', 'reset by management'));
end;
$$;

revoke execute on function public.team_mfa_status(uuid) from public, anon;
revoke execute on function public.reset_member_mfa(uuid) from public, anon;
grant execute on function public.team_mfa_status(uuid) to authenticated;
grant execute on function public.reset_member_mfa(uuid) to authenticated;
