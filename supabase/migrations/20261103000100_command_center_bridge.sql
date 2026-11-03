-- =====================================================================
-- LeMo Command Center bridge (contract 1).
--
-- The LeMo Command Center runs the platform side of every LeMo app from
-- one place. For LeMoSp it lists the businesses that use the app, changes
-- a business's level, switches features on or off per business and adds
-- or edits features in the catalogue. The LeMoSp ADMIN screens keep
-- working; this is a second door to the same rules.
--
-- How it is reached: lemo_control.handle(request) lives in its own schema,
-- which the app's API does not expose, and only the database owner may
-- run it. The Command Center calls it through the Supabase management API
-- with the token it already holds for health and usage checks. No new key
-- is created and nothing changes for LeMoSp users.
--
-- What it can see: business names, levels, kinds, user counts and dates,
-- and the feature catalogue. Never quotes, invoices, stock or people's
-- details.
--
-- Every change goes through the same functions the ADMIN screens use and
-- is written to the business's activity history, naming the Command
-- Center person who made it.
--
-- Safe to run more than once.
-- =====================================================================

create schema if not exists lemo_control;
revoke all on schema lemo_control from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema lemo_control from anon, authenticated'; end if;
end $$;

create or replace function lemo_control.handle(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_action text := coalesce(p->>'action', '');
  v_by     text := left(coalesce(nullif(btrim(p->>'by'), ''), 'LeMo Command Center'), 120);
  v_reason text := left(btrim(coalesce(p->>'reason', '')), 300);
  v_id     uuid;
  v_key    text;
  v_level  text;
  v_status text;
  v_name   text;
  v_old    public.features;
  v_result jsonb;
begin
  if jsonb_typeof(p) is distinct from 'object' then
    raise exception 'The request must be a JSON object.' using errcode = '22023';
  end if;
  if p ? 'id' then
    begin
      v_id := (p->>'id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Unknown business.' using errcode = '22023';
    end;
  end if;

  -- What this app offers the Command Center.
  if v_action = 'info' then
    return jsonb_build_object(
      'contract', 1,
      'app', 'LeMoSp',
      'tenant_word', 'business',
      'plan_word', 'level',
      'plans', jsonb_build_array(
        jsonb_build_object('key', 'small', 'name', 'Small'),
        jsonb_build_object('key', 'medium', 'name', 'Medium'),
        jsonb_build_object('key', 'enterprise', 'name', 'Enterprise')),
      'statuses', jsonb_build_array('live', 'planned'),
      'categories', coalesce((select jsonb_agg(c.name order by c.sort, c.name) from public.feature_categories c), '[]'::jsonb),
      'can', jsonb_build_array('tenants', 'tenant', 'features', 'set_plan', 'set_feature', 'save_feature'));

  -- The businesses using LeMoSp.
  elsif v_action = 'tenants' then
    v_name := nullif(btrim(coalesce(p->>'search', '')), '');
    select coalesce(jsonb_agg(t order by t.demo, t.name), '[]'::jsonb) into v_result
      from (
        select c.id, c.name, c.business_level::text as plan, c.business_type as kind, c.is_demo as demo,
               c.created_at,
               (select count(*) from public.memberships m where m.company_id = c.id and m.active) as users,
               (select count(*) from public.memberships m join auth.users u on u.id = m.user_id
                 where m.company_id = c.id and m.active and u.last_sign_in_at > now() - interval '30 days') as active_users,
               (select max(u.last_sign_in_at) from public.memberships m join auth.users u on u.id = m.user_id
                 where m.company_id = c.id and m.active) as last_active,
               (select count(*) from public.company_features cf where cf.company_id = c.id) as overrides
          from public.companies c
         where v_name is null or c.name ilike '%' || replace(replace(v_name, '%', ''), '_', '') || '%'
         order by c.is_demo, c.name
         limit 500
      ) t;
    return jsonb_build_object('rows', v_result);

  -- One business and how each feature stands for it.
  elsif v_action = 'tenant' then
    select jsonb_build_object('id', c.id, 'name', c.name, 'plan', c.business_level::text, 'kind', c.business_type,
                              'demo', c.is_demo, 'created_at', c.created_at, 'level_changed_at', c.level_changed_at,
                              'users', (select count(*) from public.memberships m where m.company_id = c.id and m.active))
      into v_result
      from public.companies c where c.id = v_id;
    if v_result is null then
      raise exception 'Unknown business.' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'tenant', v_result,
      'features', coalesce((
        select jsonb_agg(jsonb_build_object('key', m.key, 'name', m.name, 'category', m.module, 'status', m.status,
                                            'default_plan', m.default_level::text, 'core', f.core, 'active', f.active,
                                            'enabled', m.enabled, 'source', m.source) order by m.module, m.sort, m.key)
          from public.feature_map_internal(v_id) m join public.features f on f.key = m.key), '[]'::jsonb));

  -- The feature catalogue.
  elsif v_action = 'features' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'key', f.key, 'name', f.name, 'description', f.description, 'category', f.module, 'status', f.status,
             'default_plan', f.default_level::text, 'core', f.core, 'active', f.active, 'sort', f.sort,
             'audience', f.audience, 'benefits', f.benefits, 'route', f.route,
             'switched_on', (select count(*) from public.company_features cf where cf.feature_key = f.key and cf.enabled),
             'switched_off', (select count(*) from public.company_features cf where cf.feature_key = f.key and not cf.enabled))
             order by f.module, f.sort, f.key), '[]'::jsonb)
      into v_result from public.features f;
    return jsonb_build_object('rows', v_result);

  -- Change a business's level. No data is removed.
  elsif v_action = 'set_plan' then
    v_level := p->>'plan';
    if v_level is null or v_level not in ('small', 'medium', 'enterprise') then
      raise exception 'Choose small, medium or enterprise.' using errcode = '22023';
    end if;
    if char_length(v_reason) < 5 then
      raise exception 'Say why the level changes (a few words).' using errcode = '22023';
    end if;
    select business_level::text into v_status from public.companies where id = v_id;
    if not found then
      raise exception 'Unknown business.' using errcode = '22023';
    end if;
    perform public.apply_business_level(v_id, v_level::public.business_level, null);
    insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
    values (v_id, null, 'update', 'companies', v_id::text,
            jsonb_build_object('business_level', jsonb_build_object('from', v_status, 'to', v_level),
                               'by', v_by || ' (LeMo Command Center)', 'reason', v_reason));
    return jsonb_build_object('ok', true, 'from', v_status, 'to', v_level);

  -- Switch one feature on, off, or back to what the level gives (enabled = null).
  elsif v_action = 'set_feature' then
    v_key := p->>'key';
    if char_length(v_reason) < 5 then
      raise exception 'Say why this feature changes (a few words).' using errcode = '22023';
    end if;
    if not exists (select 1 from public.companies where id = v_id) then
      raise exception 'Unknown business.' using errcode = '22023';
    end if;
    if jsonb_typeof(p->'enabled') not in ('boolean', 'null') and p ? 'enabled' then
      raise exception 'Choose on, off or the level default.' using errcode = '22023';
    end if;
    perform public.apply_company_feature(v_id, v_key, (p->>'enabled')::boolean, 'admin');
    insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
    values (v_id, null, 'update', 'company_features', v_key,
            jsonb_build_object('by', v_by || ' (LeMo Command Center)', 'reason', v_reason,
                               'choice', coalesce(p->>'enabled', 'level default')));
    return jsonb_build_object('ok', true, 'enabled', public.feature_on(v_id, v_key));

  -- Add a feature to the catalogue, or edit one. A new feature starts as
  -- planned: it shows on the roadmap but cannot be switched on until it is
  -- built and marked live.
  elsif v_action = 'save_feature' then
    v_key := lower(btrim(coalesce(p->>'key', '')));
    v_name := btrim(coalesce(p->>'name', ''));
    v_level := coalesce(p->>'default_plan', 'medium');
    v_status := coalesce(p->>'status', 'planned');
    if v_key !~ '^[a-z][a-z0-9_]{1,49}$' then
      raise exception 'The feature key must be 2-50 small letters, digits or _, starting with a letter.' using errcode = '22023';
    end if;
    if char_length(v_name) not between 2 and 80 then
      raise exception 'Give the feature a name (2-80 letters).' using errcode = '22023';
    end if;
    if char_length(coalesce(p->>'description', '')) > 600 then
      raise exception 'The description is too long (600 letters at most).' using errcode = '22023';
    end if;
    if v_level not in ('small', 'medium', 'enterprise') then
      raise exception 'Choose the level that gets it by default.' using errcode = '22023';
    end if;
    if v_status not in ('live', 'planned') then
      raise exception 'Choose live or planned.' using errcode = '22023';
    end if;
    select * into v_old from public.features where key = v_key;
    if v_old.key is null then
      if v_status = 'live' then
        raise exception 'A new feature starts as planned. Mark it live once it is built.' using errcode = '22023';
      end if;
      insert into public.features (key, name, description, module, default_level, status, audience, benefits, sort, active)
      values (v_key, v_name, nullif(btrim(coalesce(p->>'description', '')), ''),
              coalesce(nullif(btrim(coalesce(p->>'category', '')), ''), 'Other'), v_level::public.business_level, 'planned',
              nullif(left(btrim(coalesce(p->>'audience', '')), 300), ''), nullif(left(btrim(coalesce(p->>'benefits', '')), 600), ''),
              coalesce((select max(sort) + 10 from public.features), 10), coalesce((p->>'active')::boolean, true));
    else
      if v_old.core and v_level <> 'small' then
        raise exception '"%" is part of every level; its default level stays Small.', v_old.name using errcode = '22023';
      end if;
      update public.features
         set name = v_name,
             description = nullif(btrim(coalesce(p->>'description', '')), ''),
             module = coalesce(nullif(btrim(coalesce(p->>'category', '')), ''), module),
             default_level = v_level::public.business_level,
             status = v_status,
             audience = case when p ? 'audience' then nullif(left(btrim(coalesce(p->>'audience', '')), 300), '') else audience end,
             benefits = case when p ? 'benefits' then nullif(left(btrim(coalesce(p->>'benefits', '')), 600), '') else benefits end,
             active = coalesce((p->>'active')::boolean, active)
       where key = v_key;
    end if;
    return jsonb_build_object('ok', true, 'key', v_key, 'created', v_old.key is null);

  else
    raise exception 'Unknown action "%".', left(v_action, 40) using errcode = '22023';
  end if;
end;
$$;

revoke execute on function lemo_control.handle(jsonb) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function lemo_control.handle(jsonb) from anon, authenticated, service_role';
  end if;
end $$;
comment on function lemo_control.handle(jsonb) is
  'LeMo Command Center bridge, contract 1. Run only by the database owner through the Supabase management API.';
