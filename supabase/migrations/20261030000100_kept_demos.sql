-- =====================================================================
-- LeMoSp  ·  Kept demo companies for the LeMo Demonstrator
--
-- The LeMo Demonstrator (LeMo Command Center) shows one made-up company
-- on several devices at once, each signed in as a different person. It
-- is a demo company (sample data, never billed, no emails or pushes)
-- that is KEPT: demo_expires_at is empty, so the scheduled purge never
-- removes it. Only LeMo Tech makes one (scripts/demo/demonstrator-company.sql).
--
--   * A kept demo may have several members (still never a guest); an
--     ordinary demo keeps its single user.
--   * Nobody can end, restart or replace a kept demo from the app (Exit
--     demo, Start over, Switch scale): delete_demo_company leaves it.
--     LeMo Tech removes one by giving it an expiry; the purge then takes it.
-- Safe to run more than once.
-- =====================================================================

-- A demo without an expiry is now allowed: it is a kept demo. Ordinary demos are only ever made by
-- create_demo_company, which always gives them their 48 hours.
alter table public.companies drop constraint if exists companies_demo_expiry;

create or replace function public.guard_demo_membership()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_demo boolean;
  v_kept boolean;
begin
  select is_demo, is_demo and demo_expires_at is null into v_demo, v_kept from public.companies where id = new.company_id;
  if exists (select 1 from auth.users where id = new.user_id and is_anonymous) and not coalesce(v_demo, false) then
    raise exception 'Guest users cannot join a company. Create an account first.' using errcode = '42501';
  end if;
  if coalesce(v_kept, false) then
    if exists (select 1 from auth.users where id = new.user_id and is_anonymous) then
      raise exception 'Guest users cannot join this demo company.' using errcode = '42501';
    end if;
  elsif coalesce(v_demo, false) then
    if exists (select 1 from public.memberships where company_id = new.company_id and user_id <> new.user_id) then
      raise exception 'A demo company has a single user.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.delete_demo_company(p_company uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  -- Never touches a real company, nor a kept demo (one without an expiry).
  if not exists (select 1 from public.companies where id = p_company and is_demo and demo_expires_at is not null) then
    return false;
  end if;
  perform set_config('ims.status_change', 'on', true);
  perform set_config('ims.allow_line_copy', 'on', true);
  begin
    delete from storage.objects
     where bucket_id in ('branding', 'pod', 'receipts', 'documents') and name like p_company::text || '/%';
  exception when others then
    raise notice 'Demo files for % left in storage: %', p_company, sqlerrm;
  end;
  delete from public.companies where id = p_company and is_demo and demo_expires_at is not null;
  perform set_config('ims.status_change', 'off', true);
  perform set_config('ims.allow_line_copy', 'off', true);
  return true;
end;
$$;

create or replace function public.end_demo()
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_n int := 0;
begin
  if auth.uid() is null then
    raise exception 'Please sign in first.' using errcode = '42501';
  end if;
  for r in select m.company_id from public.memberships m join public.companies c on c.id = m.company_id
            where m.user_id = auth.uid() and c.is_demo loop
    if public.delete_demo_company(r.company_id) then
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n = 0 then
    if exists (select 1 from public.memberships m join public.companies c on c.id = m.company_id
                where m.user_id = auth.uid() and c.is_demo and c.demo_expires_at is null) then
      raise exception 'This demo company is kept for the LeMo Demonstrator. Ask LeMo Tech to remove it.' using errcode = '42501';
    end if;
    raise exception 'You have no demo company.' using errcode = '22023';
  end if;
end;
$$;
