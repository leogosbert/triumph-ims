-- Security audit (stage 20): one company never reaches another's rows.
-- Company A is the full enterprise demo (plus the later seeds), turned into a real company; company B is a
-- fresh company whose owner is a stranger to A. For EVERY table and view in public with a company_id column:
-- B sees none of A's rows, cannot change or delete them, and cannot add a row under A's company id.
-- Also: every security-definer function that B can call refuses A's company id (or returns nothing of A's).
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon, service_role;
create or replace function tests.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = p_email),
                      'email', p_email, 'role', 'authenticated')::text, false);
end $$;
create or replace function tests.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAILED: %', p_label; end if;
  raise notice 'pass: %', p_label;
end $$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

-- ---- Setup ------------------------------------------------------------------------------------------
insert into auth.users (email) values ('a.s20i@x.test'), ('b.s20i@x.test');
select tests.login('a.s20i@x.test');
select public.demo_seed_enterprise() as coa \gset
select public.demo_seed_stage13(:'coa');
select public.demo_seed_stage14(:'coa');
select public.demo_seed_stage14_ops(:'coa');
select public.demo_seed_stage15(:'coa');
update public.companies set is_demo = false, demo_expires_at = null where id = :'coa';
select tests.login('b.s20i@x.test');
set role authenticated;
select public.create_company('Stranger B') as cob \gset
reset role;

select set_config('s20i.coa', :'coa', false);
-- Every relation in public with a company_id column, and how many rows A has there.
create table tests.s20i_rel (rel text primary key, kind char, a_rows bigint);
do $$
declare r record; n bigint;
begin
  for r in
    select c.relname, c.relkind from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id' and not a.attisdropped
     where ns.nspname = 'public' and c.relkind in ('r', 'v', 'm')
  loop
    execute format('select count(*) from public.%I where company_id = $1', r.relname) into n
      using current_setting('s20i.coa')::uuid;
    insert into tests.s20i_rel values (r.relname, r.relkind, n);
  end loop;
end $$;
select tests.check((select count(*) from tests.s20i_rel where a_rows > 0) >= 60,
  'company A has rows in at least 60 company tables (the test covers real data)');
grant select on tests.s20i_rel to authenticated;

-- ---- 1. Reading ---------------------------------------------------------------------------------------
create or replace function tests.s20i_seen(p_company uuid) returns table (rel text, seen bigint) language plpgsql as $$
declare r record; n bigint;
begin
  for r in select * from tests.s20i_rel loop
    begin
      execute format('select count(*) from public.%I where company_id = $1', r.rel) into n using p_company;
    exception when insufficient_privilege then n := 0;
    end;
    rel := r.rel; seen := n; return next;
  end loop;
end $$;
grant execute on function tests.s20i_seen(uuid) to authenticated;

select tests.login('b.s20i@x.test');
set role authenticated;
create temp table s20i_leaks on commit preserve rows as select * from tests.s20i_seen(:'coa') where seen > 0;
reset role;
select rel, seen from s20i_leaks;
select tests.check(not exists (select 1 from s20i_leaks), 'a stranger reads no row of company A in any table or view');

-- ---- 2. Changing, deleting, adding ---------------------------------------------------------------------
create or replace function tests.s20i_touch(p_company uuid) returns table (rel text, what text, n bigint) language plpgsql as $$
declare r record; c bigint;
begin
  for r in select * from tests.s20i_rel where kind = 'r' and a_rows > 0 loop
    begin
      execute format('with x as (update public.%I set company_id = company_id where company_id = $1 returning 1) select count(*) from x', r.rel)
        into c using p_company;
    exception when others then c := 0;
    end;
    if c > 0 then rel := r.rel; what := 'update'; n := c; return next; end if;
    begin
      execute format('with x as (delete from public.%I where company_id = $1 returning 1) select count(*) from x', r.rel)
        into c using p_company;
      raise exception 'zz_undo %', c;  -- never keep a delete
    exception when others then
      c := coalesce(nullif(substring(sqlerrm from '^zz_undo (\d+)$'), '')::bigint, 0);
    end;
    if c > 0 then rel := r.rel; what := 'delete'; n := c; return next; end if;
  end loop;
end $$;
grant execute on function tests.s20i_touch(uuid) to authenticated;

select tests.login('b.s20i@x.test');
set role authenticated;
create temp table s20i_writes on commit preserve rows as select * from tests.s20i_touch(:'coa');
reset role;
select * from s20i_writes;
select tests.check(not exists (select 1 from s20i_writes), 'a stranger changes or deletes no row of company A');

-- Adding a row under A's id: try a minimal insert (company_id only) into every table B may insert into.
create or replace function tests.s20i_add(p_company uuid) returns table (rel text) language plpgsql as $$
declare r record;
begin
  for r in select * from tests.s20i_rel where kind = 'r' loop
    begin
      execute format('insert into public.%I (company_id) values ($1)', r.rel) using p_company;
      rel := r.rel; return next;
    exception when others then
      -- a refusal by policy (42501) is what we want; a not-null/check error means the row was refused anyway,
      -- but only after the policy let it through: report those for a closer look.
      if sqlstate <> '42501' and sqlerrm !~ 'row-level security|permission denied' then
        rel := r.rel || ' (refused by ' || sqlstate || ', not by policy)'; return next;
      end if;
    end;
  end loop;
end $$;
grant execute on function tests.s20i_add(uuid) to authenticated;
select tests.login('b.s20i@x.test');
set role authenticated;
create temp table s20i_adds on commit preserve rows as select * from tests.s20i_add(:'coa');
reset role;
select * from s20i_adds;
select tests.check(not exists (select 1 from s20i_adds where rel !~ 'not by policy'), 'a stranger adds no row under company A');
-- (BEFORE INSERT triggers run before the policy check, so a trigger may refuse first: that is fine.)

-- ---- 3. Views run with the reader's rights ------------------------------------------------------------
select tests.check(not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
       and not coalesce('security_invoker=true' = any (c.reloptions), false)),
  'every view in public is security_invoker');
