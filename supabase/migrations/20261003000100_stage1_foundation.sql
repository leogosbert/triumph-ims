-- =====================================================================
-- TRIUMPH IMS  ·  Stage 1: foundation
-- Companies (tenants), user profiles, memberships and roles,
-- invitations, activity (audit) log, and row-level security.
--
-- Every business table added in later stages carries a company_id and
-- uses the same is_member()/has_role() checks, so each company only ever
-- sees its own data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.app_role as enum (
  'management', 'sales', 'procurement', 'warehouse', 'driver', 'finance'
);

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table public.companies (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(btrim(name)) between 2 and 120),
  legal_name         text,
  tin                text,
  vrn                text,
  registration_no    text,
  address            text,
  phone              text,
  email              text,
  website            text,
  base_currency      text not null default 'TZS' check (base_currency ~ '^[A-Z]{3}$'),
  second_currency    text default 'USD' check (second_currency is null or second_currency ~ '^[A-Z]{3}$'),
  primary_color      text not null default '#1C4C9B' check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  accent_color       text not null default '#123A7A' check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_path          text,
  bank_details       text,
  document_footer    text,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.memberships (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.app_role not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (company_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id) where active;

create table public.invitations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  email        text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role         public.app_role not null,
  invited_by   uuid references auth.users (id) on delete set null,
  accepted_by  uuid references auth.users (id) on delete set null,
  accepted_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);
create unique index invitations_open_unique
  on public.invitations (company_id, email)
  where accepted_at is null and revoked_at is null;
create index invitations_email_idx on public.invitations (email)
  where accepted_at is null and revoked_at is null;

create table public.audit_log (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_company_time_idx on public.audit_log (company_id, created_at desc);

-- ---------------------------------------------------------------------
-- Permission helpers (used by every policy, now and in later stages)
-- ---------------------------------------------------------------------
create or replace function public.is_member(p_company uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company and m.user_id = auth.uid() and m.active
  );
$$;

create or replace function public.has_role(p_company uuid, p_roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.company_id = p_company and m.user_id = auth.uid() and m.active
      and m.role = any (p_roles)
  );
$$;

create or replace function public.is_manager(p_company uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select public.has_role(p_company, array['management']::public.app_role[]);
$$;

create or replace function public.shares_company_with(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.company_id = mine.company_id
    where mine.user_id = auth.uid() and mine.active and theirs.user_id = p_user
  );
$$;

-- ---------------------------------------------------------------------
-- Housekeeping triggers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger companies_touch   before update on public.companies   for each row execute function public.touch_updated_at();
create trigger profiles_touch    before update on public.profiles    for each row execute function public.touch_updated_at();
create trigger memberships_touch before update on public.memberships for each row execute function public.touch_updated_at();

-- A profile row is created for every new sign-up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''), lower(new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Activity log: every insert/update/delete on audited tables is recorded
-- with who did it and exactly which fields changed. Nobody can edit or
-- delete log rows through the app.
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

create trigger companies_audit   after insert or update on public.companies             for each row execute function public.audit_row();
create trigger memberships_audit after insert or update or delete on public.memberships for each row execute function public.audit_row();
create trigger invitations_audit after insert or update or delete on public.invitations for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------
alter table public.companies   enable row level security;
alter table public.profiles    enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_log   enable row level security;

-- Companies: members can read; only management can edit. New companies
-- are created through create_company() so the creator becomes manager.
create policy companies_select on public.companies
  for select to authenticated using (public.is_member(id));
create policy companies_update on public.companies
  for update to authenticated
  using (public.is_manager(id)) with check (public.is_manager(id));

-- Profiles: you can read yourself and colleagues; edit only yourself.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_company_with(id));
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Memberships: colleagues are visible; changes only through functions.
create policy memberships_select on public.memberships
  for select to authenticated
  using (user_id = auth.uid() or public.is_member(company_id));

-- Invitations: management sees their company's invitations.
create policy invitations_select on public.invitations
  for select to authenticated using (public.is_manager(company_id));

-- Activity log: management only, read-only.
create policy audit_log_select on public.audit_log
  for select to authenticated using (public.is_manager(company_id));

-- Profiles' email is kept from auth and not edited by users.
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone) on public.profiles to authenticated;

-- Companies: id, creator and timestamps cannot be changed by users.
revoke update on public.companies from authenticated, anon;
grant update (name, legal_name, tin, vrn, registration_no, address, phone, email, website,
              base_currency, second_currency, primary_color, accent_color, logo_path,
              bank_details, document_footer)
  on public.companies to authenticated;

revoke insert, update, delete on public.memberships, public.invitations, public.audit_log from authenticated, anon;
revoke insert, delete on public.companies, public.profiles from authenticated, anon;

-- ---------------------------------------------------------------------
-- Actions (called from the app with supabase.rpc)
-- ---------------------------------------------------------------------

-- Create a company; the caller becomes its first manager.
create or replace function public.create_company(p_name text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  insert into public.companies (name, created_by) values (btrim(p_name), auth.uid())
  returning id into v_id;
  insert into public.memberships (company_id, user_id, role) values (v_id, auth.uid(), 'management');
  return v_id;
end;
$$;

-- Invite someone by email with a role (management only).
create or replace function public.invite_member(p_company uuid, p_email text, p_role public.app_role)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can invite people.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email address does not look right.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.memberships m join public.profiles p on p.id = m.user_id
    where m.company_id = p_company and p.email = v_email and m.active
  ) then
    raise exception 'This person is already in the team.' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.invitations i
    where i.company_id = p_company and i.email = v_email
      and i.accepted_at is null and i.revoked_at is null
  ) then
    raise exception 'An invitation for this email is already waiting.' using errcode = '23505';
  end if;

  insert into public.invitations (company_id, email, role, invited_by)
  values (p_company, v_email, p_role, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.revoke_invitation(p_invitation uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.invitations
  where id = p_invitation and accepted_at is null and revoked_at is null;
  if v_company is null or not public.is_manager(v_company) then
    raise exception 'Invitation not found.' using errcode = '42501';
  end if;
  update public.invitations set revoked_at = now() where id = p_invitation;
end;
$$;

-- Invitations waiting for the signed-in user's email address.
create or replace function public.my_invitations()
returns table (id uuid, company_id uuid, company_name text, role public.app_role, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.company_id, c.name, i.role, i.created_at
  from public.invitations i
  join public.companies c on c.id = i.company_id
  where i.email = lower(auth.jwt() ->> 'email')
    and i.accepted_at is null and i.revoked_at is null
  order by i.created_at desc;
$$;

create or replace function public.accept_invitation(p_invitation uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations
  where id = p_invitation and accepted_at is null and revoked_at is null
    and email = lower(auth.jwt() ->> 'email');
  if v_inv.id is null then
    raise exception 'Invitation not found or no longer valid.' using errcode = '42501';
  end if;

  insert into public.memberships (company_id, user_id, role, active)
  values (v_inv.company_id, auth.uid(), v_inv.role, true)
  on conflict (company_id, user_id) do update set role = excluded.role, active = true;

  update public.invitations set accepted_at = now(), accepted_by = auth.uid() where id = v_inv.id;
  return v_inv.company_id;
end;
$$;

-- Change a colleague's role or switch them on/off (management only).
-- A company must always keep at least one active manager.
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

  if v_m.role = 'management' and v_m.active and (p_role <> 'management' or not p_active) then
    if (select count(*) from public.memberships
        where company_id = v_m.company_id and role = 'management' and active) <= 1 then
      raise exception 'The company needs at least one active manager.' using errcode = '23514';
    end if;
  end if;

  update public.memberships set role = p_role, active = p_active where id = p_membership;
end;
$$;

revoke execute on function
  public.create_company(text),
  public.invite_member(uuid, text, public.app_role),
  public.revoke_invitation(uuid),
  public.my_invitations(),
  public.accept_invitation(uuid),
  public.update_membership(uuid, public.app_role, boolean)
from public, anon;

grant execute on function
  public.create_company(text),
  public.invite_member(uuid, text, public.app_role),
  public.revoke_invitation(uuid),
  public.my_invitations(),
  public.accept_invitation(uuid),
  public.update_membership(uuid, public.app_role, boolean)
to authenticated;

-- ---------------------------------------------------------------------
-- File storage for logos. Files live under "<company id>/..." and only
-- that company's management can upload or replace them. Logos are
-- public so they can appear on quotations and invoices.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;

create policy branding_manage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'branding'
    and exists (select 1 from public.memberships m
                where m.user_id = auth.uid() and m.active and m.role = 'management'
                  and m.company_id::text = (storage.foldername(name))[1])
  );

create policy branding_manage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'branding'
    and exists (select 1 from public.memberships m
                where m.user_id = auth.uid() and m.active and m.role = 'management'
                  and m.company_id::text = (storage.foldername(name))[1])
  );

create policy branding_manage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'branding'
    and exists (select 1 from public.memberships m
                where m.user_id = auth.uid() and m.active and m.role = 'management'
                  and m.company_id::text = (storage.foldername(name))[1])
  );

-- Needed so management can replace (remove) an old logo file.
create policy branding_member_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'branding'
    and exists (select 1 from public.memberships m
                where m.user_id = auth.uid() and m.active
                  and m.company_id::text = (storage.foldername(name))[1])
  );
