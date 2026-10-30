-- LeMo Demonstrator, step 2 of 2: LeMoSp's kept demo company "Mwanga Supplies Ltd (DEMO)", shown on several devices at
-- once by the LeMo Demonstrator. Needs the kept-demo database update (20261030000100_kept_demos.sql) and the six demo
-- logins (demonstrator-accounts.sql). Safe to run again: it does nothing once the company exists.
--
-- The demo manager builds the usual Medium demo (create_demo_company: made-up clients, suppliers, products, quotations,
-- orders, deliveries and invoices, all through the normal workflow functions). It is then KEPT (no expiry, so the
-- scheduled purge leaves it and nobody can end it from the app), renamed, and the five other demo logins join it, one
-- per role. Only these six logins are members; a client is added only when they ask. To remove it later, give it an
-- expiry:  update public.companies set demo_expires_at = now() where id = '<id>';  and the purge takes it.

do $$
declare
  v_manager uuid := (select id from auth.users where email = 'demo.manager@lemo-demo.test');
  v_company uuid;
begin
  if v_manager is null then raise exception 'Run demonstrator-accounts.sql first.'; end if;
  if exists (select 1 from public.memberships m join public.companies c on c.id = m.company_id
              where m.user_id = v_manager and c.is_demo and c.demo_expires_at is null) then
    raise notice 'The Demonstrator company already exists. Nothing to do.';
    return;
  end if;

  -- As the demo manager, exactly as "Try the demo" does in the app.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_manager, 'role', 'authenticated', 'email', 'demo.manager@lemo-demo.test')::text, true);
  perform set_config('role', 'authenticated', true);
  perform public.create_demo_company('medium');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  select c.id into v_company from public.memberships m join public.companies c on c.id = m.company_id
   where m.user_id = v_manager and c.is_demo order by c.created_at desc limit 1;
  update public.companies
     set demo_expires_at = null, name = 'Mwanga Supplies Ltd (DEMO)', legal_name = 'Mwanga Supplies Limited (DEMO)'
   where id = v_company;

  insert into public.memberships (company_id, user_id, role)
  select v_company, u.id, r.role::public.app_role
    from (values ('demo.sales@lemo-demo.test', 'sales'), ('demo.procurement@lemo-demo.test', 'procurement'),
                 ('demo.warehouse@lemo-demo.test', 'warehouse'), ('demo.driver@lemo-demo.test', 'driver'),
                 ('demo.finance@lemo-demo.test', 'finance')) r(email, role)
    join auth.users u on u.email = r.email
  on conflict (company_id, user_id) do nothing;
  raise notice 'Demonstrator company ready: Mwanga Supplies Ltd (DEMO) %', v_company;
end $$;
