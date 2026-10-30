-- LeMo Demonstrator, step 1 of 2: the six demo logins for LeMoSp's kept demo company (one per role), on the LIVE
-- project (Leo's decision, 2026-10-30: a locked demo company inside each live app). Synthetic people only.
-- Run before demonstrator-company.sql, in the Supabase SQL editor (or the MCP). Safe to run again.
--
-- The password is the team's demo password for the kit "lemosp" in the LeMo Command Center (demonstrator_passwords);
-- it is never written here. Set it in the same transaction first:   select set_config('demo.password', '...', true);

do $$
declare
  pw text := current_setting('demo.password', true);
begin
  if coalesce(pw, '') = '' then raise exception 'Set demo.password first (the team demo password from the Command Center).'; end if;
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                          created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', a.email,
         extensions.crypt(pw, extensions.gen_salt('bf')), now(),
         jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'is_demo', true),
         jsonb_build_object('full_name', a.name), now(), now(), '', '', '', ''
    from (values ('demo.manager@lemo-demo.test', 'Neema Mushi (DEMO)'), ('demo.sales@lemo-demo.test', 'Baraka Mollel (DEMO)'),
                 ('demo.procurement@lemo-demo.test', 'Asha Komba (DEMO)'), ('demo.warehouse@lemo-demo.test', 'Juma Said (DEMO)'),
                 ('demo.driver@lemo-demo.test', 'Hamisi Ally (DEMO)'), ('demo.finance@lemo-demo.test', 'Grace Lyimo (DEMO)')) a(email, name)
   where not exists (select 1 from auth.users x where x.email = a.email);
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select x.id::text, x.id, jsonb_build_object('sub', x.id::text, 'email', x.email, 'email_verified', true), 'email', now(), now(), now()
    from auth.users x where x.email like 'demo.%@lemo-demo.test'
     and not exists (select 1 from auth.identities i where i.user_id = x.id and i.provider = 'email');
end $$;
