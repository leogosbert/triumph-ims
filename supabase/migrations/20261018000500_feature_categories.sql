-- =====================================================================
-- LeMoSp  ·  Feature categories (LeMoSp ADMIN)
--
-- The feature catalogue (Stage 11, public.features) is grouped into
-- categories that LeMo Tech manages: add, rename, describe, reorder and
-- remove categories, and move features between them. A feature's
-- category is its existing "module" text, so the company app keeps
-- working unchanged.
--
-- For each client company, LeMo Tech can now see which features are on
-- and switch a whole category on, off or back to the level default.
-- These are app settings only, never the company's business data.
--
-- Safe to run more than once. Needs Stage 11.
-- =====================================================================

create table if not exists public.feature_categories (
  name         text primary key check (char_length(name) between 2 and 60 and name = btrim(name)),
  description  text check (description is null or char_length(description) <= 300),
  sort         integer not null default 100 check (sort between 0 and 100000),
  created_at   timestamptz not null default now()
);
alter table public.feature_categories enable row level security;
drop policy if exists feature_categories_select on public.feature_categories;
create policy feature_categories_select on public.feature_categories for select to authenticated using (true);
-- Changes only through the admin functions below.
revoke all on public.feature_categories from anon, authenticated;
grant select on public.feature_categories to authenticated;

-- Seed: the standard categories, then any module a feature already uses.
insert into public.feature_categories (name, description, sort)
values
  ('Overview',       'The dashboard and the first screens people see.', 10),
  ('Sales',          'Customers, requests, quotations and the sales pipeline.', 20),
  ('Purchasing',     'Suppliers, purchase orders and supplier bills.', 30),
  ('Procurement',    'Supplier quotations, tenders and purchase requests.', 40),
  ('Inventory',      'Products, stock, stores and transfers.', 50),
  ('Logistics',      'Deliveries, drivers and vehicles.', 60),
  ('Finance',        'Invoices, payments, expenses and money reports.', 70),
  ('Analytics',      'Reports, insights and forecasts.', 80),
  ('Administration', 'Team, security, data and company settings.', 90),
  ('Improvement',    'Suggestions and growth.', 100)
on conflict (name) do nothing;
insert into public.feature_categories (name, sort)
select distinct f.module, 900 from public.features f
 where f.module is not null and char_length(btrim(f.module)) between 2 and 60 and f.module = btrim(f.module)
on conflict (name) do nothing;

-- A feature saved with a category that does not exist yet creates it, so
-- later catalogue updates never fail or leave a feature without a group.
create or replace function public.feature_category_ensure()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.module := coalesce(nullif(btrim(new.module), ''), 'Other');
  if char_length(new.module) between 2 and 60 then
    insert into public.feature_categories (name, sort) values (new.module, 900) on conflict (name) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists features_category_ensure on public.features;
create trigger features_category_ensure before insert or update of module on public.features
  for each row execute function public.feature_category_ensure();

-- ---------------------------------------------------------------------
-- Admin: categories
-- ---------------------------------------------------------------------
-- p_old_name null = new category; otherwise edit (and rename) it.
-- Renaming moves every feature in it to the new name.
create or replace function public.admin_save_feature_category(p_old_name text, p_name text, p_description text, p_sort integer)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
begin
  perform public.require_platform_admin();
  if char_length(v_name) not between 2 and 60 then
    raise exception 'Give the category a name (2–60 letters).' using errcode = '22023';
  end if;
  if v_desc is not null and char_length(v_desc) > 300 then
    raise exception 'The description is too long (300 letters at most).' using errcode = '22023';
  end if;
  if p_sort is null or p_sort not between 0 and 100000 then
    raise exception 'Sort must be a whole number.' using errcode = '22023';
  end if;

  if p_old_name is null then
    if exists (select 1 from public.feature_categories where lower(name) = lower(v_name)) then
      raise exception 'A category with that name already exists.' using errcode = '23505';
    end if;
    insert into public.feature_categories (name, description, sort) values (v_name, v_desc, p_sort);
    return v_name;
  end if;

  if not exists (select 1 from public.feature_categories where name = p_old_name) then
    raise exception 'Category not found.' using errcode = '22023';
  end if;
  if v_name <> p_old_name then
    if exists (select 1 from public.feature_categories where lower(name) = lower(v_name) and name <> p_old_name) then
      raise exception 'A category with that name already exists.' using errcode = '23505';
    end if;
    insert into public.feature_categories (name, description, sort, created_at)
    select v_name, v_desc, p_sort, created_at from public.feature_categories where name = p_old_name;
    update public.features set module = v_name where module = p_old_name;
    delete from public.feature_categories where name = p_old_name;
  else
    update public.feature_categories set description = v_desc, sort = p_sort where name = p_old_name;
  end if;
  return v_name;
end;
$$;

-- Remove a category. Its features move to p_move_to first (required when it has any).
create or replace function public.admin_delete_feature_category(p_name text, p_move_to text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  perform public.require_platform_admin();
  if not exists (select 1 from public.feature_categories where name = p_name) then
    raise exception 'Category not found.' using errcode = '22023';
  end if;
  select count(*) into v_count from public.features where module = p_name;
  if v_count > 0 then
    if p_move_to is null or p_move_to = p_name
       or not exists (select 1 from public.feature_categories where name = p_move_to) then
      raise exception 'Choose another category for the % feature(s) in this one.', v_count using errcode = '22023';
    end if;
    update public.features set module = p_move_to where module = p_name;
  end if;
  delete from public.feature_categories where name = p_name;
  return v_count;
end;
$$;

-- Put a feature in a category (adding it to one removes it from the other).
create or replace function public.admin_set_feature_category(p_key text, p_category text)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  if not exists (select 1 from public.feature_categories where name = p_category) then
    raise exception 'Category not found.' using errcode = '22023';
  end if;
  update public.features set module = p_category where key = p_key;
  if not found then
    raise exception 'Unknown feature.' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Admin: one company's features
-- ---------------------------------------------------------------------
-- Which features are on for a company and why (app settings only).
create or replace function public.admin_company_features(p_company uuid)
returns table (key text, enabled boolean, source text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_platform_admin();
  if not exists (select 1 from public.companies c where c.id = p_company) then
    raise exception 'Company not found.' using errcode = '22023';
  end if;
  return query select m.key, m.enabled, m.source from public.feature_map_internal(p_company) m;
end;
$$;

-- Switch every live feature of one category on (true), off (false) or back
-- to the level default (null) for a company. Core features are left alone.
create or replace function public.admin_set_company_category(p_company uuid, p_category text, p_enabled boolean)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  f record;
  v_count integer := 0;
begin
  perform public.require_platform_admin();
  if not exists (select 1 from public.companies c where c.id = p_company) then
    raise exception 'Company not found.' using errcode = '22023';
  end if;
  for f in
    select key from public.features
     where module = p_category and status = 'live' and active and not core
     order by sort, key
  loop
    perform public.apply_company_feature(p_company, f.key, p_enabled, 'admin');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
revoke execute on function
  public.feature_category_ensure(),
  public.admin_save_feature_category(text, text, text, integer),
  public.admin_delete_feature_category(text, text),
  public.admin_set_feature_category(text, text),
  public.admin_company_features(uuid),
  public.admin_set_company_category(uuid, text, boolean)
from public, anon, authenticated;

grant execute on function
  public.admin_save_feature_category(text, text, text, integer),
  public.admin_delete_feature_category(text, text),
  public.admin_set_feature_category(text, text),
  public.admin_company_features(uuid),
  public.admin_set_company_category(uuid, text, boolean)
to authenticated;
