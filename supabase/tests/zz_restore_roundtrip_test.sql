-- Runs last: every company the earlier tests built (quotations, orders, stock, invoices,
-- payments, projects, ...) is backed up and put straight back. The records must come back
-- exactly the same, with every link intact.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

do $$
declare
  c       record;
  v_b1    uuid;
  v_b2    uuid;
  v_res   jsonb;
  v_diff  text;
  v_n     integer := 0;
begin
  for c in select id, name from public.companies where not is_demo order by created_at loop
    v_b1 := public.take_company_backup(c.id, 'manual', null, now());
    v_res := public.restore_company_backup_at(v_b1, null);
    v_b2 := public.take_company_backup(c.id, 'manual', null, now());
    select string_agg(t, ', ') into v_diff
      from (select k as t
              from public.company_backup_data d1, public.company_backup_data d2,
                   jsonb_object_keys(d1.data -> 'tables') k
             where d1.backup_id = v_b1 and d2.backup_id = v_b2
               and (select coalesce(jsonb_agg(e order by e::text), '[]') from jsonb_array_elements(d1.data -> 'tables' -> k) e)
                   is distinct from
                   (select coalesce(jsonb_agg(e order by e::text), '[]') from jsonb_array_elements(d2.data -> 'tables' -> k) e)) x;
    if v_diff is not null then
      raise exception 'FAILED: round trip changed records of % in: %', c.name, v_diff;
    end if;
    if v_res -> 'fixed' <> '{}'::jsonb then
      raise exception 'FAILED: round trip of % had to fix links: %', c.name, v_res -> 'fixed';
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n < 5 then
    raise exception 'FAILED: expected the earlier tests to leave companies to restore (found %)', v_n;
  end if;
  raise notice 'pass: round trip: % companies backed up and restored with identical records', v_n;
end $$;
