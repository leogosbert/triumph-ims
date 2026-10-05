-- Tests for Security plus: "confirm it is you" (recent sign-in) checks, sign-in history,
-- new-device alerts and the security health check.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;
-- Signs in as p_email; the last password/code check was p_age seconds ago (null = no amr claim at all).
create or replace function tests.login_amr(p_email text, p_aal text, p_age integer, p_method text default 'password')
returns void language plpgsql security definer as $$
begin
  perform set_config('request.jwt.claims',
    (jsonb_build_object('sub', (select id from auth.users where email = p_email),
                        'email', p_email, 'role', 'authenticated', 'aal', p_aal)
     || case when p_age is null then '{}'::jsonb
             else jsonb_build_object('amr', jsonb_build_array(
                    jsonb_build_object('method', p_method, 'timestamp', extract(epoch from now())::bigint - p_age)))
        end)::text, false);
end $$;
create or replace function tests.set_claims(p_claims jsonb) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', p_claims::text, false);
end $$;
create or replace function tests.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAILED: %', p_label; end if;
  raise notice 'pass: %', p_label;
end $$;
create or replace function tests.blocked(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAILED (was allowed): %', p_label;
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'pass: % (blocked: %)', p_label, sqlerrm;
end $$;
-- Must fail with the "confirm it is you" error (errcode 28000) specifically.
create or replace function tests.needs_confirm(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAILED (was allowed): %', p_label;
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  if sqlstate <> '28000' or sqlerrm <> 'Please confirm it is you first.' then
    raise exception 'FAILED (wrong error % %): %', sqlstate, sqlerrm, p_label;
  end if;
  raise notice 'pass: % (asks to confirm)', p_label;
end $$;
grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (email) values ('boss.sp@s.test'), ('boss2.sp@s.test'), ('clerk.sp@s.test'), ('stranger.sp@s.test');
select id as boss from auth.users where email = 'boss.sp@s.test' \gset
select id as boss2 from auth.users where email = 'boss2.sp@s.test' \gset
select id as clerk from auth.users where email = 'clerk.sp@s.test' \gset
select id as stranger from auth.users where email = 'stranger.sp@s.test' \gset

select tests.login_amr('boss.sp@s.test', 'aal1', 5); set role authenticated;
select public.create_company('Step Up Co') as co \gset
reset role;
insert into public.memberships (company_id, user_id, role) values (:'co', :'clerk', 'sales'), (:'co', :'boss2', 'management');
select id as clerk_m from public.memberships where company_id = :'co' and user_id = :'clerk' \gset
select tests.login_amr('stranger.sp@s.test', 'aal1', 5); set role authenticated;
select public.create_company('Elsewhere Co') as other_co \gset
reset role;

-- ---- recent_auth reads the sign-in token ---------------------------------------
set role authenticated;
select tests.login_amr('boss.sp@s.test', 'aal1', 60);
select tests.check(public.recent_auth(10), 'a password sign-in 1 minute ago is recent');
select tests.check(public.recent_auth(), 'the default window is 10 minutes');
select tests.login_amr('boss.sp@s.test', 'aal1', 11 * 60);
select tests.check(not public.recent_auth(10), 'a sign-in 11 minutes ago is not recent');
select tests.check(public.recent_auth(15), 'but it is within a 15-minute window');
select tests.login_amr('boss.sp@s.test', 'aal1', null);
select tests.check(not public.recent_auth(10), 'a token without amr is not recent');
select tests.login_amr('boss.sp@s.test', 'aal2', 30, 'totp');
select tests.check(not public.recent_auth(10), 'an authenticator code alone does not count (anyone with the session could add their own)');
select tests.login_amr('boss.sp@s.test', 'aal2', 30, 'mfa/phone');
select tests.check(not public.recent_auth(10), 'nor does a phone code');
select tests.login_amr('boss.sp@s.test', 'aal2', 30, 'mfa/webauthn');
select tests.check(not public.recent_auth(10), 'nor a security key');
select tests.login_amr('boss.sp@s.test', 'aal1', 30, 'otp');
select tests.check(public.recent_auth(10), 'an email code counts');
select tests.login_amr('boss.sp@s.test', 'aal1', 30, 'magiclink');
select tests.check(public.recent_auth(10), 'an email sign-in link counts');
select tests.login_amr('boss.sp@s.test', 'aal1', 30, 'recovery');
select tests.check(public.recent_auth(10), 'a password-reset link counts');
select tests.login_amr('boss.sp@s.test', 'aal1', 30, 'anonymous');
select tests.check(not public.recent_auth(10), 'a guest (anonymous) sign-in never counts');
select tests.login_amr('boss.sp@s.test', 'aal1', 30, 'token_refresh');
select tests.check(not public.recent_auth(10), 'refreshing the token does not count as signing in');
select tests.set_claims(jsonb_build_object('sub', :'boss', 'role', 'authenticated', 'amr', jsonb_build_array('password')));
select tests.check(not public.recent_auth(10), 'an amr without timestamps is not recent');
select tests.set_claims(jsonb_build_object('sub', :'boss', 'role', 'authenticated', 'amr', 'password'));
select tests.check(not public.recent_auth(10), 'a malformed amr is not recent');
select tests.set_claims(jsonb_build_object('sub', :'boss', 'role', 'authenticated', 'amr', jsonb_build_array(
  jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 3600),
  jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 120))));
select tests.check(public.recent_auth(10), 'the newest of several sign-in methods is used');
select tests.check(public.step_up_ok(:'co'), 'step_up_ok follows the recent sign-in');
select tests.set_claims(jsonb_build_object('sub', :'boss', 'role', 'authenticated', 'aal', 'aal2', 'amr', jsonb_build_array(
  jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 30),
  jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 3600))));
select tests.check(not public.recent_auth(10), 'a new authenticator code on an old password sign-in is not enough');
select tests.check(not public.step_up_ok(:'co'), 'so step_up_ok refuses it too');
select tests.set_claims(jsonb_build_object('sub', :'boss', 'role', 'authenticated', 'aal', 'aal2', 'amr', jsonb_build_array(
  jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 20),
  jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 30))));
select tests.check(public.recent_auth(10), 'password then code (the confirm box for two-step users) passes');
reset role;
select tests.check(not has_function_privilege('authenticated', 'public.require_step_up(uuid)', 'execute'),
  'the raising helper is internal only');
select tests.check(not has_function_privilege('anon', 'public.recent_auth(integer)', 'execute'), 'visitors cannot call recent_auth');

-- ---- Changing a member's role or access -----------------------------------------
select tests.login_amr('boss.sp@s.test', 'aal1', 30 * 60); set role authenticated;
select tests.needs_confirm(format('select public.update_membership(%L, %L, true)', :'clerk_m', 'procurement'),
  'changing a role needs a recent sign-in');
select tests.needs_confirm(format('select public.update_membership(%L, %L, false)', :'clerk_m', 'sales'),
  'switching someone off needs a recent sign-in');
reset role;
select tests.check((select role = 'sales' and active from public.memberships where id = :'clerk_m'), 'nothing changed');
select tests.login_amr('boss.sp@s.test', 'aal1', null); set role authenticated;
select tests.needs_confirm(format('select public.update_membership(%L, %L, true)', :'clerk_m', 'procurement'),
  'a token without amr cannot change roles');
reset role;
select tests.login_amr('boss.sp@s.test', 'aal1', 20); set role authenticated;
select public.update_membership(:'clerk_m', 'procurement', true);
reset role;
select tests.check((select role = 'procurement' from public.memberships where id = :'clerk_m'), 'after confirming, the role changes');
select tests.login_amr('clerk.sp@s.test', 'aal1', 5); set role authenticated;
select tests.blocked(format('select public.update_membership(%L, %L, true)', :'clerk_m', 'management'),
  'a fresh sign-in does not let a non-manager change roles');
reset role;

-- ---- Company sign-in security -----------------------------------------------------
select tests.login_amr('boss.sp@s.test', 'aal1', 30 * 60); set role authenticated;
select tests.needs_confirm(format('select public.set_company_security(%L, false, 30)', :'co'), 'changing sign-in security needs a recent sign-in');
select tests.blocked(format('select public.set_company_security(%L, false, 7)', :'co'), 'invalid values are still refused first');
reset role;
select tests.login_amr('boss.sp@s.test', 'aal1', 60); set role authenticated;
select public.set_company_security(:'co', false, 30);
reset role;
select tests.check((select idle_timeout_minutes = 30 from public.companies where id = :'co'), 'after confirming, security settings are saved');
select tests.login_amr('clerk.sp@s.test', 'aal1', 5); set role authenticated;
select tests.blocked(format('select public.set_company_security(%L, false, 0)', :'co'), 'a fresh sign-in does not make sales a manager');
reset role;

-- ---- Resetting someone's two-step verification ------------------------------------
insert into auth.mfa_factors (user_id) values (:'clerk');
select tests.login_amr('boss.sp@s.test', 'aal1', 30 * 60); set role authenticated;
select tests.needs_confirm(format('select public.reset_member_mfa(%L)', :'clerk_m'), 'resetting two-step needs a recent sign-in');
reset role;
select tests.check((select count(*) = 1 from auth.mfa_factors where user_id = :'clerk'), 'the authenticator was kept');
select tests.login_amr('boss.sp@s.test', 'aal1', 60); set role authenticated;
select public.reset_member_mfa(:'clerk_m');
reset role;
select tests.check((select count(*) = 0 from auth.mfa_factors where user_id = :'clerk'), 'after confirming, the reset works');

-- ---- Bank details ---------------------------------------------------------------------
select tests.login_amr('boss.sp@s.test', 'aal1', 30 * 60); set role authenticated;
select tests.needs_confirm(format('update public.companies set bank_details = %L where id = %L', 'NMB 123', :'co'),
  'changing bank details needs a recent sign-in');
update public.companies set phone = '+255 700 111 222', bank_details = bank_details where id = :'co';
select tests.check((select phone = '+255 700 111 222' from public.companies where id = :'co'),
  'other company details can be saved without confirming');
reset role;
select tests.login_amr('boss.sp@s.test', 'aal1', 60); set role authenticated;
update public.companies set bank_details = 'NMB Bank, A/C 123' where id = :'co';
reset role;
select tests.check((select bank_details = 'NMB Bank, A/C 123' from public.companies where id = :'co'), 'after confirming, bank details change');
reset role;
select tests.login_amr('boss.sp@s.test', 'aal1', 30 * 60); set role authenticated;
update public.companies set bank_details = E' NMB Bank,\r\nA/C 123 ' where id = :'co';
select tests.check(true, 'spaces and line breaks alone are not treated as a change');
select tests.needs_confirm(format('update public.companies set bank_details = %L where id = %L', 'NMB Bank, A/C 999', :'co'),
  'but a different account number is');
select tests.needs_confirm(format('update public.companies set bank_details = null where id = %L', :'co'),
  'and so is removing the bank details');
reset role;
select set_config('request.jwt.claims', '', false);
update public.companies set bank_details = 'Maintenance' where id = :'co';
select tests.check((select bank_details = 'Maintenance' from public.companies where id = :'co'), 'database maintenance (no user) is not blocked');

-- Other text printed on documents where someone could write "pay to account X"
select tests.login_amr('boss.sp@s.test', 'aal1', 30 * 60); set role authenticated;
select tests.needs_confirm(format('update public.companies set document_footer = %L where id = %L', 'Pay to A/C 999', :'co'),
  'changing the document footer needs a recent sign-in');
select tests.needs_confirm(format('update public.companies set quote_terms = %L where id = %L', 'Pay to A/C 999', :'co'),
  'changing quotation terms needs a recent sign-in');
select tests.needs_confirm(format('update public.companies set po_terms = %L where id = %L', 'Pay to A/C 999', :'co'),
  'changing purchase order terms needs a recent sign-in');
select tests.needs_confirm(format('update public.companies set invoice_terms = %L where id = %L', 'Pay to A/C 999', :'co'),
  'changing invoice terms needs a recent sign-in');
update public.companies set document_footer = document_footer, invoice_terms = invoice_terms, name = 'Step Up Co' where id = :'co';
select tests.check(true, 'saving the same document text again is not a change');
reset role;
select tests.login_amr('boss.sp@s.test', 'aal1', 60); set role authenticated;
update public.companies set invoice_terms = 'Net 30. Bank: NMB', po_terms = 'Deliver to Geita' where id = :'co';
reset role;
select tests.check((select invoice_terms = 'Net 30. Bank: NMB' and po_terms = 'Deliver to Geita' from public.companies where id = :'co'),
  'after confirming, document text changes');
select tests.login_amr('boss.sp@s.test', 'aal1', 30 * 60); set role authenticated;
update public.companies set invoice_terms = E'Net 30.\r\n  Bank: NMB ' where id = :'co';
select tests.check(true, 'spaces and line breaks in document text are not a change');
reset role;

-- ---- Demo companies are exempt ----------------------------------------------------------
insert into auth.users (is_anonymous) values (true) returning id as guest \gset
select tests.set_claims(jsonb_build_object('sub', :'guest', 'role', 'authenticated', 'is_anonymous', true,
  'amr', jsonb_build_array(jsonb_build_object('method', 'anonymous', 'timestamp', extract(epoch from now())::bigint - 7200))));
set role authenticated;
select public.create_demo_company() as demo \gset
select tests.check(public.step_up_ok(:'demo'), 'the demo company never asks to confirm');
select public.set_company_security(:'demo', false, 15);
select tests.check((select idle_timeout_minutes = 15 from public.companies where id = :'demo'), 'demo guests can still try security settings');
update public.companies set bank_details = 'Demo bank' where id = :'demo';
select tests.check((select bank_details = 'Demo bank' from public.companies where id = :'demo'), 'demo guests can edit demo bank details');
select public.end_demo();
reset role;

-- A real account in a demo company is still asked (only password-less guests are exempt)
select tests.login_amr('boss2.sp@s.test', 'aal1', 30 * 60); set role authenticated;
select public.create_demo_company() as real_demo \gset
select tests.check(not public.step_up_ok(:'real_demo'), 'a real account that started a demo must still confirm');
select tests.needs_confirm(format('update public.companies set bank_details = %L where id = %L', 'X', :'real_demo'),
  'and the database asks it to');
reset role;
insert into auth.users (is_anonymous) values (true) returning id as guest2 \gset
select tests.set_claims(jsonb_build_object('sub', :'guest2', 'role', 'authenticated', 'is_anonymous', true));
set role authenticated;
select tests.check(not public.step_up_ok(:'real_demo'), 'a guest is not exempt in someone else''s demo company');
select tests.check(not public.step_up_ok(:'co'), 'or in a real company');
reset role;
select tests.set_claims(jsonb_build_object('sub', :'guest', 'role', 'authenticated', 'is_anonymous', true));
set role authenticated;
select tests.check(public.record_security_event('sign_in', 'Chrome on Android', '41.59.x.x', null) is null,
  'guests leave no sign-in history');
reset role;
select tests.check((select count(*) = 0 from public.security_events where user_id = :'guest'), 'nothing was stored for the guest');

-- ---- Sign-in history and new devices ------------------------------------------------------
select tests.login_amr('clerk.sp@s.test', 'aal1', 5); set role authenticated;
select tests.check(public.record_security_event('sign_in', 'Chrome on Android', '41.59.x.x', :'co', repeat('a', 64)) = 'sign_in',
  'the first device is learnt quietly');
select tests.check(public.record_security_event('sign_in', 'Chrome on Android', '41.59.x.x', :'co', repeat('a', 64)) = 'sign_in',
  'the same device again is a normal sign-in');
select tests.check((select count(*) = 0 from public.notifications where user_id = auth.uid() and kind = 'security'),
  'no alert for a known device');
select tests.check(public.record_security_event('sign_in', 'Safari on iPhone', '196.249.x.x', :'co', repeat('b', 64)) = 'sign_in_new_device',
  'a new device is recognised');
select tests.check((select count(*) = 1 from public.notifications
                    where user_id = auth.uid() and kind = 'security' and severity = 'attention'
                      and title = 'New sign-in to your LeMoSp account'
                      and body like 'Safari on iPhone%If this wasn''t you, change your password and sign out of all devices.'
                      and link = '/account#security'),
  'the person gets an alert that goes to phone and email');
select tests.check(public.record_security_event('sign_in_new_device', 'Safari on iPhone', null, :'co', repeat('b', 64)) = 'sign_in',
  'only the database decides that a device is new');
select tests.check(public.record_security_event('sign_in', 'Firefox on Windows', null, :'co') = 'sign_in',
  'without a device id it is recorded as a plain sign-in');
select tests.check((select count(*) = 2 from public.known_devices), 'the person sees their two known devices');
select tests.check(public.record_security_event('export', '<script>Edge</script> on Windows', '1.2.3.4; drop', :'other_co') = 'export',
  'other kinds are recorded');
select tests.check((select device = 'scriptEdge/script on Windows' and ip_hint is null and company_id = :'co'::uuid
                    from public.security_events where user_id = auth.uid() and kind = 'export'),
  'device text is cleaned, bad addresses dropped, and a company they do not work for is replaced by their own');
select tests.blocked('select public.record_security_event(''hacked'', null, null, null)', 'unknown kinds are refused');
select tests.blocked(format('insert into public.security_events (user_id, kind) values (%L, %L)', :'clerk', 'sign_in'),
  'events cannot be written directly');
select tests.blocked(format('insert into public.known_devices (user_id, device_key) values (%L, %L)', :'clerk', repeat('c', 64)),
  'devices cannot be added directly');
select tests.blocked('delete from public.security_events where user_id = auth.uid()', 'the person cannot delete their history');
select tests.blocked('update public.security_events set kind = ''reauth'' where user_id = auth.uid()', 'or edit it');
select tests.blocked('delete from public.known_devices where user_id = auth.uid()', 'or remove devices directly');
reset role;
select tests.check((select count(*) = 6 from public.security_events where user_id = :'clerk'), 'history cannot be deleted or edited by the person');
select tests.check((select count(*) = 1 from public.security_events where user_id = :'clerk' and kind = 'sign_in_new_device'),
  'the new-device sign-in is in the history');

-- Who can read it
select tests.login_amr('stranger.sp@s.test', 'aal1', 5); set role authenticated;
select tests.check((select count(*) = 0 from public.security_events where user_id = :'clerk'), 'outsiders see none of it');
select tests.check((select count(*) = 0 from public.known_devices where user_id = :'clerk'), 'or of the devices');
reset role;
select tests.login_amr('boss.sp@s.test', 'aal1', 5); set role authenticated;
select public.record_security_event('sign_in', 'Chrome on Windows', '41.59.x.x', :'co', repeat('d', 64));
select tests.check((select count(*) = 6 from public.security_events where user_id = :'clerk'), 'management sees the team''s sign-ins');
select tests.check((select count(*) = 0 from public.known_devices where user_id = :'clerk'), 'but not their device list');
reset role;
select tests.login_amr('clerk.sp@s.test', 'aal1', 5); set role authenticated;
select tests.check((select count(*) = 0 from public.security_events where user_id = :'boss'), 'sales cannot see management''s sign-ins');
reset role;
-- A company that requires two-step: a password-only manager session sees no team history.
update public.companies set require_mfa = true where id = :'co';
select tests.login_amr('boss.sp@s.test', 'aal1', 5); set role authenticated;
select tests.check((select count(*) = 0 from public.security_events where user_id = :'clerk'),
  'team history follows the company''s two-step rule');
select tests.check((select count(*) >= 1 from public.security_events where user_id = auth.uid()), 'own history is always visible');
reset role;
update public.companies set require_mfa = false where id = :'co';

-- Limits
select tests.login_amr('clerk.sp@s.test', 'aal1', 5); set role authenticated;
select count(public.record_security_event('reauth', 'Chrome on Android', null, :'co')) from generate_series(1, 70);
reset role;
select tests.check((select count(*) = 60 from public.security_events where user_id = :'clerk' and kind in ('reauth', 'export')),
  'at most 60 other events per hour');
select tests.login_amr('clerk.sp@s.test', 'aal1', 5); set role authenticated;
select tests.check(public.record_security_event('sign_in', 'Safari on iPhone', null, :'co', repeat('b', 64)) = 'sign_in',
  'a flood of other events never hides a sign-in');
select count(public.record_security_event('sign_in', 'Safari on iPhone', null, :'co', repeat('b', 64))) from generate_series(1, 40);
reset role;
select tests.check((select count(*) = 30 from public.security_events where user_id = :'clerk' and kind like 'sign_in%'),
  'at most 30 sign-ins per hour');

-- At most 5 new-device alerts a day; the sign-ins are still recorded
select tests.login_amr('stranger.sp@s.test', 'aal1', 5); set role authenticated;
select public.record_security_event('sign_in', 'Chrome on Linux', null, null, repeat('0', 64));
select count(public.record_security_event('sign_in', 'Chrome on Linux', null, null, md5(g::text) || md5(g::text)))
  from generate_series(1, 7) g;
select tests.check((select count(*) = 7 from public.security_events where user_id = auth.uid() and kind = 'sign_in_new_device'),
  'every new-device sign-in is recorded');
select tests.check((select count(*) = 5 from public.notifications where user_id = auth.uid() and kind = 'security'),
  'but only 5 alerts are sent in a day');
reset role;

-- Old history is cleared after 180 days
insert into public.security_events (user_id, kind, created_at) values (:'boss', 'sign_in', now() - interval '181 days');
insert into public.known_devices (user_id, device_key, last_seen) values (:'boss', repeat('e', 64), now() - interval '400 days');
select tests.login_amr('boss.sp@s.test', 'aal1', 5); set role authenticated;
select public.record_security_event('reauth', 'Chrome on Windows', null, :'co');
reset role;
select tests.check((select count(*) = 0 from public.security_events where user_id = :'boss' and created_at < now() - interval '180 days'),
  'history older than 180 days is removed');
select tests.check((select count(*) = 0 from public.known_devices where user_id = :'boss' and device_key = repeat('e', 64)),
  'devices unused for a year are forgotten');

-- Visitors
set role anon;
select tests.blocked('select public.record_security_event(''sign_in'', null, null, null)', 'visitors cannot record events');
select tests.blocked('select count(*) from public.security_events', 'visitors cannot read history');
reset role;
select tests.set_claims(jsonb_build_object('role', 'authenticated'));
set role authenticated;
select tests.blocked('select public.record_security_event(''sign_in'', null, null, null)', 'a token without a user cannot record');
reset role;

-- ---- Security health check ------------------------------------------------------------------
update auth.users set last_sign_in_at = now() - interval '1 day' where id in (:'boss', :'boss2');
update auth.users set last_sign_in_at = now() - interval '90 days' where id = :'clerk';
select tests.login_amr('clerk.sp@s.test', 'aal1', 5); set role authenticated;
select tests.blocked(format('select * from public.company_security_health(%L)', :'co'), 'only management sees the health check');
reset role;
select tests.login_amr('stranger.sp@s.test', 'aal1', 5); set role authenticated;
select tests.blocked(format('select * from public.company_security_health(%L)', :'co'), 'other companies cannot see it');
reset role;
set role anon;
select tests.blocked(format('select * from public.company_security_health(%L)', :'co'), 'visitors cannot see it');
reset role;

select tests.login_amr('boss.sp@s.test', 'aal1', 5); set role authenticated;
create temporary table h as select * from public.company_security_health(:'co');
select tests.check((select count(*) = 6 from h), 'six checks are returned');
select tests.check((select status = 'warn' from h where item = 'two_step_required'), 'two-step not required: needs attention');
select tests.check((select status = 'bad' and value = 0 and total = 3 from h where item = 'two_step_coverage'),
  'nobody has two-step: shown as a problem with the count');
select tests.check((select status = 'ok' and value = 30 from h where item = 'idle_sign_out'), 'automatic sign-out is set');
select tests.check((select status = 'ok' and value = 2 from h where item = 'managers'), 'two managers is good');
select tests.check((select status = 'warn' from h where item = 'backup'), 'no automatic backup in the last 2 days shows a warning');
select tests.check((select status = 'warn' and value = 1 and names = array['clerk.sp@s.test'] from h where item = 'inactive_members'),
  'a member who has not signed in for 60+ days is listed');
drop table h;
reset role;

insert into auth.mfa_factors (user_id) values (:'boss'), (:'boss2');
update public.memberships set active = false where company_id = :'co' and user_id = :'boss2';
select tests.login_amr('boss.sp@s.test', 'aal2', 5); set role authenticated;
select public.set_company_security(:'co', true, 30);
create temporary table h as select * from public.company_security_health(:'co');
select tests.check((select status = 'ok' from h where item = 'two_step_required'), 'two-step required: good');
select tests.check((select status = 'warn' and value = 1 and total = 2 from h where item = 'two_step_coverage'), 'half the team with two-step: needs attention');
select tests.check((select status = 'warn' and value = 1 from h where item = 'managers'), 'a single manager: add a second one');
drop table h;
reset role;

select tests.login_amr('stranger.sp@s.test', 'aal1', 5); set role authenticated;
select tests.check((select status = 'ok' and value = 0 from public.company_security_health(:'other_co') where item = 'inactive_members'),
  'a new member is not counted as inactive');
reset role;

select tests.check(true, 'Security plus: all checks done');
