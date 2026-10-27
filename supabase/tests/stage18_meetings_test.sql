-- Tests for Meetings and the Calendar: who sees and organises meetings, regular meetings, guests and guest links,
-- holding the meeting, minutes, approving, actions, proposed updates for other departments, the client request
-- page, invitations, the calendar and its private feed, reminders, backups, clearing and closing a company.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon, service_role;
create or replace function tests.login(p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', (select id from auth.users where email = p_email),
                      'email', p_email, 'role', 'authenticated')::text, false);
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
grant execute on all functions in schema tests to authenticated, anon, service_role;

insert into auth.users (email) values ('boss.mt@m.test'), ('sales.mt@m.test'), ('driver.mt@m.test'), ('store.mt@m.test'),
                                      ('fin.mt@m.test'), ('proc.mt@m.test'), ('other.mt@m.test'), ('close.mt@m.test');
select id as boss from auth.users where email = 'boss.mt@m.test' \gset
select id as sales from auth.users where email = 'sales.mt@m.test' \gset
select id as driver from auth.users where email = 'driver.mt@m.test' \gset
select id as store from auth.users where email = 'store.mt@m.test' \gset
select id as fin from auth.users where email = 'fin.mt@m.test' \gset
select id as proc from auth.users where email = 'proc.mt@m.test' \gset
select id as outsider from auth.users where email = 'other.mt@m.test' \gset
update public.profiles set full_name = 'Baraka Boss' where id = :'boss';
update public.profiles set full_name = 'Sara Sales' where id = :'sales';

select tests.login('boss.mt@m.test'); set role authenticated;
select public.create_company('Meeting Supply Co') as co \gset
reset role;
select tests.login('other.mt@m.test'); set role authenticated;
select public.create_company('Other Meeting Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
values (:'co', :'sales', 'sales'), (:'co', :'driver', 'driver'), (:'co', :'store', 'warehouse'), (:'co', :'fin', 'finance'),
       (:'co', :'proc', 'procurement');
insert into public.clients (company_id, name) values (:'co', 'Geita Gold Mine') returning id as client \gset
insert into public.client_contacts (company_id, client_id, name, email) values (:'co', :'client', 'Asha Buyer', 'asha@ggm.test');
insert into public.suppliers (company_id, name, email) values (:'co', 'Valves Ltd', 'sales@valves.test') returning id as sup \gset
insert into public.clients (company_id, name) values (:'other', 'Other Client') returning id as oclient \gset

-- ---- 0. Features ----------------------------------------------------------------------------------
select tests.check((select count(*) from public.features
                     where key in ('meetings', 'calendar') and module = 'Administration' and default_level = 'small' and status = 'live') = 2
                   and (select route from public.features where key = 'meetings') = '/meetings'
                   and (select route from public.features where key = 'calendar') = '/calendar',
  'meetings and calendar features: Administration, small level, live');
select tests.check(public.feature_on(:'co', 'meetings') and public.feature_on(:'co', 'calendar'), 'both are on for a new company');
select tests.check((select bool_and(relrowsecurity) from pg_class
                     where relnamespace = 'public'::regnamespace
                       and relname in ('meeting_series', 'meetings', 'meeting_texts', 'meeting_attendees', 'meeting_agenda_items',
                                       'meeting_points', 'meeting_proposals', 'meeting_invitations', 'meeting_guest_links',
                                       'meeting_portal', 'meeting_portal_hits', 'calendar_entries', 'calendar_links')
                    having count(*) = 13), 'row-level security is on for all 13 tables');

-- ---- 1. Making a meeting ----------------------------------------------------------------------------
select tests.login('driver.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_create(%L, %L)', :'co',
  jsonb_build_object('title', 'Drivers', 'starts_at', now() + interval '1 day')), 'drivers do not organise meetings');
select tests.blocked(format('insert into public.meetings (company_id, title, starts_at, meeting_date) values (%L, %L, now(), current_date)',
  :'co', 'Direct'), 'meetings are only made through the function');
reset role;

select tests.login('sales.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_create(%L, %L)', :'co',
  jsonb_build_object('title', 'X', 'starts_at', now() + interval '1 day')), 'a title is needed');
select tests.blocked(format('select public.meeting_create(%L, %L)', :'co',
  jsonb_build_object('title', 'Bad topic', 'starts_at', now() + interval '1 day', 'topics', jsonb_build_array('Gossip'))), 'unknown topics are refused');
select tests.blocked(format('select public.meeting_create(%L, %L)', :'co',
  jsonb_build_object('title', 'Bad link', 'starts_at', now() + interval '1 day', 'external_link', 'http://zoom.test/j/1')), 'only https links');
select tests.blocked(format('select public.meeting_create(%L, %L)', :'co',
  jsonb_build_object('title', 'Their client', 'starts_at', now() + interval '1 day', 'client_id', :'oclient')), 'another company''s client is refused');
-- A private sales meeting with the store keeper.
select public.meeting_create(:'co', jsonb_build_object('title', 'Geita order review', 'kind', 'client', 'client_id', :'client',
  'starts_at', now() + interval '2 hours', 'minutes', 45, 'place', 'Office', 'topics', jsonb_build_array('Sales & clients', 'Stock'),
  'attendees', jsonb_build_array(:'store', :'outsider'))) as m_sales \gset
select tests.check((select open_to_team = false and video_provider = 'jitsi' and video_room ~ '^LeMoSp-[0-9a-f]{64}$' and created_by = :'sales'
                      and meeting_date = (starts_at at time zone 'Africa/Dar_es_Salaam')::date from public.meetings where id = :'m_sales'),
  'a client meeting is private, has a long random video room and its date in Dar es Salaam time');
select tests.check((select count(*) from public.meeting_attendees where meeting_id = :'m_sales') = 2,
  'organiser and the store keeper attend; a person from another company is not added');
reset role;
select tests.check(exists (select 1 from public.notifications where user_id = :'store' and kind = 'meeting_invited' and link = '/meetings/' || :'m_sales'),
  'the store keeper is told about the meeting');

select tests.login('fin.mt@m.test'); set role authenticated;
select tests.check(not exists (select 1 from public.meetings where id = :'m_sales'), 'finance does not see a private meeting they are not in');
select tests.blocked(format('select public.meeting_add_guest(%L, %L)', :'m_sales', '{"name":"Hacker"}'), 'finance cannot add guests to it');
reset role;
select tests.login('store.mt@m.test'); set role authenticated;
select tests.check(exists (select 1 from public.meetings where id = :'m_sales'), 'an attendee sees the meeting');
select tests.blocked(format('select public.meeting_cancel(%L, null)', :'m_sales'), 'an attendee cannot cancel it');
select public.meeting_respond(:'m_sales', true);
reset role;
select tests.login('boss.mt@m.test'); set role authenticated;
select tests.check(exists (select 1 from public.meetings where id = :'m_sales'), 'management sees every meeting');
reset role;
select tests.login('other.mt@m.test'); set role authenticated;
select tests.check(not exists (select 1 from public.meetings where company_id = :'co'), 'another company sees nothing');
reset role;

-- Editing.
select tests.login('sales.mt@m.test'); set role authenticated;
select public.meeting_update(:'m_sales', jsonb_build_object('title', 'Geita order review (moved)', 'starts_at', now() + interval '3 hours',
  'attendees', jsonb_build_array(:'store', :'fin')));
select tests.check((select title from public.meetings where id = :'m_sales') = 'Geita order review (moved)'
                   and (select count(*) from public.meetings where company_id = :'co') = 1
                   and (select count(*) from public.meeting_attendees where meeting_id = :'m_sales' and user_id = :'fin') = 1
                   and exists (select 1 from public.meeting_attendees where meeting_id = :'m_sales' and user_id = :'sales'),
  'changing a meeting: no extra meeting left behind; the staff list is replaced (the organiser stays)');
select tests.blocked(format('select public.meeting_update(%L, %L)', :'m_sales', '{"minutes": 2}'), 'edits are checked like a new meeting');
reset role;
select tests.check(not exists (select 1 from public.audit_log where entity = 'meetings' and action = 'delete' and company_id = :'co'),
  'the check row of an edit is not in the activity log');
select tests.login('sales.mt@m.test'); set role authenticated;
select tests.check(exists (select 1 from public.meetings where id = :'m_sales'), 'the organiser still sees it');
reset role;

-- ---- 2. Regular meetings -----------------------------------------------------------------------------
select tests.login('sales.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_save_series(%L, null, %L)', :'co', '{"title":"Weekly","frequency":"weekly","weekday":1}'),
  'only management sets regular meetings');
reset role;
select tests.login('boss.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_save_series(%L, null, %L)', :'co', '{"title":"Weekly","frequency":"weekly"}'),
  'a weekly meeting needs its weekday');
select tests.blocked(format('select public.meeting_save_series(%L, null, %L)', :'co',
  jsonb_build_object('title', 'Turns', 'frequency', 'daily', 'presenter_mode', 'rotate', 'rotation', jsonb_build_array(:'sales'))),
  'taking turns needs at least two people');
select public.meeting_save_series(:'co', null, jsonb_build_object('title', 'Morning briefing', 'frequency', 'daily', 'start_time', '08:00',
  'minutes', 15, 'topics', jsonb_build_array('Sales & clients', 'Deliveries'), 'chair_id', :'boss', 'presenter_mode', 'rotate',
  'rotation', jsonb_build_array(:'sales', :'store'))) as series \gset
select public.meeting_schedule_series(:'co', 6) as made \gset
select tests.check(:made between 5 and 7, 'six days ahead: one meeting a day except Sunday');
select tests.check(public.meeting_schedule_series(:'co', 6) = 0, 'scheduling again makes nothing twice');
select tests.check((select count(distinct presenter_id) from public.meetings where series_id = :'series') = 2
                   and (select bool_and(open_to_team and chair_id = :'boss') from public.meetings where series_id = :'series'),
  'presenters take turns; the briefing is open to the team and chaired');
select tests.check((select count(*) from public.meeting_attendees a join public.meetings m on m.id = a.meeting_id
                     where m.series_id = :'series' and m.meeting_date = (select min(meeting_date) from public.meetings where series_id = :'series')) = 6,
  'everyone in the company is invited');
select id as m_brief from public.meetings where series_id = :'series' order by meeting_date limit 1 \gset
select public.meeting_save_series(:'co', :'series', jsonb_build_object('title', 'Morning briefing', 'frequency', 'daily', 'active', false)) \gset x_
select tests.check(public.meeting_schedule_series(:'co', 20) = 0, 'a stopped regular meeting makes no new meetings');
reset role;
select tests.login('driver.mt@m.test'); set role authenticated;
select tests.check(exists (select 1 from public.meetings where id = :'m_brief'), 'a driver sees the team briefing');
reset role;

-- ---- 3. Guests and guest links -------------------------------------------------------------------------
select tests.login('sales.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_add_guest(%L, %L)', :'m_sales', '{"name":"Asha","email":"not-an-email"}'), 'guest emails are checked');
select public.meeting_add_guest(:'m_sales', '{"name":"Asha Buyer","email":"Asha@GGM.test","phone":"0754 111 222","org":"GGM"}') as guest \gset
select tests.check((select guest_email = 'asha@ggm.test' and guest_phone = '255754111222' and client_id = :'client' and role = 'guest'
                      from public.meeting_attendees where id = :'guest'), 'a guest: email in lower case, phone in full, the meeting''s client');
select public.meeting_guest_link(:'guest', 7) as gtoken \gset
select tests.check(:'gtoken' ~ '^[0-9a-f]{64}$', 'the guest link is 64 random hex characters');
select tests.blocked(format('select public.meeting_guest_link(%L, 7)', (select id from public.meeting_attendees where meeting_id = :'m_sales' and user_id = :'store')),
  'team members get no guest link');
select tests.blocked('select count(*) from public.meeting_guest_links', 'signed-in users cannot read guest links');
select tests.blocked(format('select public.meeting_guest_view(%L)', :'gtoken'), 'signed-in users cannot call the guest page function');
reset role;
select tests.check((select token_hash from public.meeting_guest_links where attendee_id = :'guest') = encode(sha256(convert_to(:'gtoken', 'UTF8')), 'hex')
                   and not exists (select 1 from public.meeting_guest_links where token_hash = :'gtoken'),
  'only the SHA-256 of the link is kept');
set role anon;
select tests.blocked(format('select public.meeting_guest_view(%L)', :'gtoken'), 'visitors cannot call the guest page function directly');
reset role;
set role service_role;
select public.meeting_guest_view(:'gtoken') as gview \gset
select tests.check((:'gview'::jsonb ->> 'company') = 'Meeting Supply Co' and (:'gview'::jsonb ->> 'title') = 'Geita order review (moved)'
                   and (:'gview'::jsonb ->> 'guest_name') = 'Asha Buyer' and not (:'gview'::jsonb ? 'purpose')
                   and not ((:'gview'::jsonb) ? 'transcript'), 'the guest page shows the title, time, our company and how to join');
select tests.check((:'gview'::jsonb ->> 'can_join')::boolean = false, 'a guest cannot join hours before the meeting');
select tests.check(public.meeting_guest_view(repeat('a', 64)) is null and public.meeting_guest_view('short') is null, 'a wrong link shows nothing');
select tests.check(public.meeting_guest_joined(:'gtoken'), 'the guest joins');
reset role;
select tests.check((select joined_at is not null and present from public.meeting_attendees where id = :'guest'), 'we see who joined');
select tests.login('sales.mt@m.test'); set role authenticated;
select public.meeting_guest_link(:'guest', 7) as gtoken2 \gset
reset role;
set role service_role;
select tests.check(public.meeting_guest_view(:'gtoken') is null and public.meeting_guest_view(:'gtoken2') is not null,
  'a new link switches the old one off');
reset role;
update public.meeting_guest_links set expires_at = now() - interval '1 minute' where attendee_id = :'guest' and revoked_at is null;
set role service_role;
select tests.check(public.meeting_guest_view(:'gtoken2') is null and not public.meeting_guest_joined(:'gtoken2'), 'an expired link shows nothing');
reset role;

-- ---- 4. Suggest topics ----------------------------------------------------------------------------------
insert into public.invoices (company_id, client_id, status, created_by, total, due_date)
values (:'co', :'client', 'draft', :'fin', 500000, current_date - 10) returning id as inv \gset
select set_config('ims.status_change', 'on', false) \gset x_
update public.invoices set status = 'issued' where id = :'inv';
select set_config('ims.status_change', 'off', false) \gset x_
insert into public.hse_incidents (company_id, occurred_at, site, kind, severity, title, description, reported_by)
values (:'co', now() - interval '2 days', 'Store', 'near_miss', 'low', 'Oil spill in store', 'Leaking drum', :'store') returning id as inc \gset
select tests.login('store.mt@m.test'); set role authenticated;
select public.meeting_agenda_candidates(:'co') as cand_store \gset
reset role;
select tests.login('boss.mt@m.test'); set role authenticated;
select public.meeting_agenda_candidates(:'co') as cand \gset
reset role;
select tests.check(exists (select 1 from jsonb_array_elements(:'cand'::jsonb) x where x ->> 'key' = 'receivables')
                   and exists (select 1 from jsonb_array_elements(:'cand'::jsonb) x where x ->> 'key' = 'incidents')
                   and exists (select 1 from jsonb_array_elements(:'cand'::jsonb) x where x ->> 'key' = 'open_floor'),
  'suggested topics come from the company''s data (money owed, incidents, open floor)');
select tests.check(not exists (select 1 from jsonb_array_elements(:'cand_store'::jsonb) x where x ->> 'key' in ('receivables', 'bills'))
                   and exists (select 1 from jsonb_array_elements(:'cand_store'::jsonb) x where x ->> 'key' = 'incidents'),
  'money items are only suggested to management and finance');
select tests.login('driver.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_agenda_candidates(%L)', :'co'), 'drivers get no suggestions');
reset role;
select tests.login('sales.mt@m.test'); set role authenticated;
select public.meeting_add_agenda(:'m_sales', jsonb_build_array(
  jsonb_build_object('title', 'Overdue invoice from Geita', 'topic', 'Money', 'source', 'suggested', 'source_ref', 'receivables'),
  jsonb_build_object('title', 'Next order of grease', 'topic', 'Sales & clients', 'owner_id', :'store', 'minutes', 10),
  jsonb_build_object('title', 'x'))) as added \gset
select tests.check(:added = 2, 'two agenda items added; a too-short one is skipped');
select tests.check(public.meeting_add_agenda(:'m_sales', jsonb_build_array(jsonb_build_object('title', 'Overdue invoice again', 'source_ref', 'receivables'))) = 0,
  'a suggestion already on the agenda is not added twice');
select id as ag2 from public.meeting_agenda_items where meeting_id = :'m_sales' and title = 'Next order of grease' \gset
select public.meeting_agenda_item(:'ag2', 'up');
select tests.check((select title from public.meeting_agenda_items where meeting_id = :'m_sales' order by sort limit 1) = 'Next order of grease',
  'agenda items can be moved up');
reset role;

-- ---- 5. Holding the meeting -----------------------------------------------------------------------------
select tests.login('store.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_start(%L, true)', :'m_sales'), 'an attendee cannot start the meeting');
select tests.blocked(format('select public.meeting_add_line(%L, %L, %L)', :'m_sales', 'typed', 'Too early'), 'no notes before it starts');
reset role;
select tests.login('sales.mt@m.test'); set role authenticated;
select public.meeting_start(:'m_sales', true);
select tests.check((select status = 'live' and announced_at is not null and started_at is not null from public.meetings where id = :'m_sales'),
  'the meeting is live and the recording notice was read');
reset role;
select tests.check((select count(*) from public.notifications where kind = 'meeting_started' and severity = 'critical'
                     and link = '/meetings/' || :'m_sales' || '/room' and user_id in (:'store', :'fin')) = 2,
  'the staff invited are called to join (pushed)');
set role service_role;
select tests.check((public.meeting_guest_view(:'gtoken2')) is null, 'still expired after the start');
reset role;
select tests.login('store.mt@m.test'); set role authenticated;
select public.meeting_joined(:'m_sales');
select public.meeting_add_line(:'m_sales', 'speech', 'Tutawasilisha mafuta Ijumaa', 'Juma');
select public.meeting_add_line(:'m_sales', 'typed', 'Grease stock is low', null);
reset role;
select tests.login('boss.mt@m.test'); set role authenticated;
select public.meeting_joined(:'m_sales');
reset role;
select tests.check((select joined_at is not null from public.meeting_attendees where meeting_id = :'m_sales' and user_id = :'store')
                   and (select role = 'member' and present from public.meeting_attendees where meeting_id = :'m_sales' and user_id = :'boss'),
  'who joined is recorded (management who drops in is added)');
select tests.check((select transcript ~ '^\[00:00:0\d\] Juma: Tutawasilisha mafuta Ijumaa' and notes like '%Grease stock is low%'
                      from public.meeting_texts where meeting_id = :'m_sales'), 'speech and typed lines are kept with who said them');
select tests.login('driver.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_add_line(%L, %L, %L)', :'m_sales', 'typed', 'Hi'), 'someone not in the meeting cannot add notes');
select tests.check(not exists (select 1 from public.meeting_texts where meeting_id = :'m_sales'), 'nor read the transcript');
reset role;
select tests.login('sales.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_save_minutes(%L, %L)', :'m_sales', '{}'), 'no minutes while the meeting is live');
select public.meeting_end(:'m_sales');
select tests.check((select status = 'held' and ended_at is not null from public.meetings where id = :'m_sales'), 'the meeting ended');
select public.meeting_minutes_state(:'m_sales', 'writing', null);
select tests.check((select minutes_status from public.meetings where id = :'m_sales') = 'writing', 'minutes being written');
select public.meeting_minutes_state(:'m_sales', 'failed', 'AI not reachable');
select tests.check((select minutes_status = 'failed' and minutes_error = 'AI not reachable' from public.meetings where id = :'m_sales'),
  'a failure is shown');
reset role;

-- ---- 6. Minutes -------------------------------------------------------------------------------------------
insert into public.quotations (company_id, client_id, status, created_by) values (:'co', :'client', 'draft', :'sales') returning id as quo \gset
select set_config('ims.status_change', 'on', false) \gset x_
update public.quotations set status = 'sent' where id = :'quo';
select set_config('ims.status_change', 'off', false) \gset x_
select tests.login('boss.mt@m.test'); set role authenticated;
select public.compliance_adopt(:'co', array['TRA_PAYE', 'BUSINESS_LICENCE'], true) \gset x_
reset role;
select id as citem from public.compliance_items where company_id = :'co' and code = 'BUSINESS_LICENCE' \gset

select tests.login('sales.mt@m.test'); set role authenticated;
select public.meeting_save_minutes(:'m_sales', jsonb_build_object(
  'by', 'ai', 'summary', 'We reviewed the Geita order.',
  'topics', jsonb_build_array(jsonb_build_object('topic', 'Sales & clients', 'points', jsonb_build_array('Order on track'))),
  'points', jsonb_build_array(
    jsonb_build_object('kind', 'decision', 'body', 'Deliver the hydraulic oil on Friday'),
    jsonb_build_object('kind', 'action', 'body', 'Prepare the delivery note', 'owner_id', :'store', 'due_on', to_char(current_date + 3, 'YYYY-MM-DD')),
    jsonb_build_object('kind', 'action', 'body', 'Call Asha about the invoice', 'owner_id', :'outsider', 'owner_name', 'Juma'),
    jsonb_build_object('kind', 'issue', 'body', 'Grease stock is low', 'severity', 'high', 'topic', 'Stock'),
    jsonb_build_object('kind', 'gossip', 'body', 'Ignored')),
  'proposals', jsonb_build_array(
    jsonb_build_object('target', 'calendar_entry', 'title', 'Delivery Friday', 'point', 0,
      'payload', jsonb_build_object('title', 'Deliver oil to Geita', 'kind', 'delivery', 'starts_on', to_char(current_date + 4, 'YYYY-MM-DD'),
                                   'phrase', 'tutawasilisha Ijumaa', 'owner_id', :'store')),
    jsonb_build_object('target', 'crm_note', 'title', 'CRM note', 'payload', jsonb_build_object('client_id', :'client', 'summary', 'Met Geita: order on track')),
    jsonb_build_object('target', 'followup', 'title', 'Invoice follow-up', 'payload',
      jsonb_build_object('invoice_id', :'inv', 'note', 'Asha will pay next week', 'next_on', to_char(current_date + 7, 'YYYY-MM-DD'))),
    jsonb_build_object('target', 'requisition', 'title', 'Buy grease', 'point', 3,
      'payload', jsonb_build_object('reason', 'Grease stock is low', 'lines', jsonb_build_array(jsonb_build_object('description', 'Grease 18kg', 'quantity', '20', 'unit', 'pail')))),
    jsonb_build_object('target', 'compliance_date', 'title', 'Licence date', 'payload', jsonb_build_object('item_id', :'citem', 'due_on', to_char(current_date + 30, 'YYYY-MM-DD'))),
    jsonb_build_object('target', 'next_meeting', 'title', 'Next meeting', 'payload', jsonb_build_object('starts_at', now() + interval '7 days')),
    jsonb_build_object('target', 'task', 'title', 'Task for finance', 'payload', jsonb_build_object('text', 'Send the statement to Geita', 'owner_id', :'fin', 'due_on', to_char(current_date + 6, 'YYYY-MM-DD'))),
    jsonb_build_object('target', 'corrective_action', 'title', 'Fix the leaking drum', 'payload',
      jsonb_build_object('source_kind', 'incident', 'source_id', :'inc', 'action', 'Replace the drum seals', 'owner_id', :'store')),
    jsonb_build_object('target', 'opportunity_stage', 'title', 'Bad one', 'payload', jsonb_build_object('opportunity_id', gen_random_uuid(), 'stage', 'won')),
    jsonb_build_object('target', 'calendar_entry', 'title', 'Bad date', 'payload', jsonb_build_object('title', 'Old', 'starts_on', '2001-01-01')),
    jsonb_build_object('target', 'delete_everything', 'title', 'Bad target', 'payload', '{}'::jsonb)),
  'follow_up', '[]'::jsonb)) as npoints \gset
select tests.check(:npoints = 4, 'four valid points saved; an unknown kind is skipped');
select tests.check((select count(*) from public.meeting_proposals where meeting_id = :'m_sales') = 8
                   and (select (minutes_summary ->> 'proposals')::int = 8 and minutes_status = 'ready' and minutes_by = 'ai'
                          from public.meetings where id = :'m_sales'),
  'eight proposed updates pass the checks; the three that do not are left out');
select tests.check((select owner_id is null and owner_name = 'Juma' from public.meeting_points where meeting_id = :'m_sales' and body like 'Call Asha%'),
  'an owner from another company is not set (the name is kept)');
select tests.check((select point_id = (select id from public.meeting_points where meeting_id = :'m_sales' and kind = 'issue')
                      from public.meeting_proposals where meeting_id = :'m_sales' and target = 'requisition'),
  'a proposal is linked to its point');
-- Saving again replaces the AI drafts, not points added by hand.
select public.meeting_save_point(:'m_sales', null, jsonb_build_object('kind', 'note', 'body', 'Asha liked the new packaging')) as manual_pt \gset
reset role;
select tests.login('sales.mt@m.test'); set role authenticated;
select tests.check((select count(*) from public.meeting_points where meeting_id = :'m_sales') = 5, 'a point added by hand');
reset role;
select tests.login('store.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_approve_minutes(%L)', :'m_sales'), 'an attendee cannot approve the minutes');
select tests.check(not exists (select 1 from public.meeting_proposals where meeting_id = :'m_sales'), 'an attendee does not see the proposed updates');
select tests.check(not exists (select 1 from public.meeting_points p where p.meeting_id = :'m_sales' and p.approved), 'nothing approved yet');
reset role;
select tests.login('sales.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_approve_minutes(%L)', :'m_sales'), 'the organiser (not chair) cannot approve the minutes');
select tests.blocked(format('select public.meeting_proposal_decide(%L, true, null)',
  (select id from public.meeting_proposals where meeting_id = :'m_sales' and target = 'crm_note')), 'only management decides proposed updates');
select tests.check((select count(*) from public.meeting_proposals where meeting_id = :'m_sales') = 8, 'the organiser sees the proposed updates');
reset role;
select tests.check(not exists (select 1 from public.crm_activities where company_id = :'co')
                   and not exists (select 1 from public.calendar_entries where company_id = :'co')
                   and not exists (select 1 from public.requisitions where company_id = :'co'),
  'nothing changes in other departments before approval');

select tests.login('boss.mt@m.test'); set role authenticated;
select public.meeting_approve_minutes(:'m_sales') as approved_actions \gset
select tests.check(:approved_actions = 1 and (select minutes_status = 'approved' and approved_by = :'boss' from public.meetings where id = :'m_sales')
                   and (select bool_and(approved) from public.meeting_points where meeting_id = :'m_sales'),
  'management approves the minutes');
select tests.blocked(format('select public.meeting_save_minutes(%L, %L)', :'m_sales', '{"summary":"again"}'), 'approved minutes are not written over');
select tests.blocked(format('select public.meeting_save_text(%L, %L, %L)', :'m_sales', 'x', 'y'), 'nor the notes changed');
reset role;
select tests.check(exists (select 1 from public.notifications where user_id = :'store' and kind = 'meeting_action' and link = '/meetings/actions')
                   and not exists (select 1 from public.notifications where user_id in (:'sales', :'boss') and kind = 'meeting_proposals'),
  'action owners are told; updates to review go to other managers only (not to sales, not to the one approving)');

-- My actions.
select tests.login('store.mt@m.test'); set role authenticated;
select id as act from public.meeting_points where meeting_id = :'m_sales' and kind = 'action' and owner_id = :'store' \gset
select tests.check((select count(*) from public.meeting_points where owner_id = :'store' and approved) = 1, 'the owner sees their action');
select tests.blocked(format('select public.meeting_set_point_status(%L, %L, null)', :'act', 'cancelled'), 'the owner cannot drop an action');
select public.meeting_set_point_status(:'act', 'in_progress', 'Started');
reset role;
select tests.login('fin.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_set_point_status(%L, %L, null)', :'act', 'done'), 'someone else cannot move another''s action');
reset role;

-- ---- 7. Proposed updates ------------------------------------------------------------------------------------
select tests.login('boss.mt@m.test'); set role authenticated;
select id as p_cal from public.meeting_proposals where meeting_id = :'m_sales' and target = 'calendar_entry' \gset
select id as p_crm from public.meeting_proposals where meeting_id = :'m_sales' and target = 'crm_note' \gset
select id as p_fu from public.meeting_proposals where meeting_id = :'m_sales' and target = 'followup' \gset
select id as p_req from public.meeting_proposals where meeting_id = :'m_sales' and target = 'requisition' \gset
select id as p_comp from public.meeting_proposals where meeting_id = :'m_sales' and target = 'compliance_date' \gset
select id as p_next from public.meeting_proposals where meeting_id = :'m_sales' and target = 'next_meeting' \gset
select id as p_task from public.meeting_proposals where meeting_id = :'m_sales' and target = 'task' \gset
select id as p_ca from public.meeting_proposals where meeting_id = :'m_sales' and target = 'corrective_action' \gset
select tests.blocked(format('select public.meeting_proposal_edit(%L, null, %L)', :'p_cal', '{"title":"x","starts_on":"2026-01-01"}'),
  'an edit is checked again');
select public.meeting_proposal_edit(:'p_cal', 'Delivery Saturday', jsonb_build_object('title', 'Deliver oil to Geita', 'kind', 'delivery',
  'starts_on', to_char(current_date + 5, 'YYYY-MM-DD'), 'at_time', '10:00', 'owner_id', :'store', 'phrase', 'tutawasilisha Jumamosi'));
select public.meeting_proposal_decide(:'p_cal', true, 'Agreed') as ref_cal \gset
select public.meeting_proposal_decide(:'p_crm', true, null) as ref_crm \gset
select public.meeting_proposal_decide(:'p_fu', true, null) as ref_fu \gset
select public.meeting_proposal_decide(:'p_req', true, null) as ref_req \gset
select public.meeting_proposal_decide(:'p_comp', true, null) as ref_comp \gset
select public.meeting_proposal_decide(:'p_next', true, null) as ref_next \gset
select public.meeting_proposal_decide(:'p_task', true, null) as ref_task \gset
select public.meeting_proposal_decide(:'p_ca', false, 'Already done') \gset x_
select tests.blocked(format('select public.meeting_proposal_decide(%L, true, null)', :'p_ca'), 'a decided update cannot be decided again');
reset role;
select tests.check((select starts_on = current_date + 5 and at_time = '10:00' and owner_id = :'store' and meeting_id = :'m_sales' and proposal_id = :'p_cal'
                      and notes like '%tutawasilisha Jumamosi%' from public.calendar_entries where id = split_part(:'ref_cal', ':', 2)::uuid),
  'approved: the date goes on the calendar, as edited, with what was said');
select tests.check((select kind = 'meeting' and client_id = :'client' and summary = 'Met Geita: order on track' and created_by = :'boss'
                      from public.crm_activities where id = split_part(:'ref_crm', ':', 2)::uuid), 'approved: a CRM note on the client');
select tests.check((select invoice_id = :'inv' and next_on = current_date + 7 from public.followups where id = split_part(:'ref_fu', ':', 2)::uuid),
  'approved: an invoice follow-up through log_followup');
select tests.check((select status <> 'draft' from public.requisitions where id = split_part(:'ref_req', ':', 2)::uuid)
                   and (select count(*) from public.requisition_lines where requisition_id = split_part(:'ref_req', ':', 2)::uuid) = 1,
  'approved: a purchase request with its line, sent through submit_requisition');
select tests.check((select due_on = current_date + 30 from public.compliance_items where id = :'citem'), 'approved: the compliance date moves');
select tests.check((select status = 'planned' and title = 'Geita order review (moved)' and client_id = :'client'
                      from public.meetings where id = split_part(:'ref_next', ':', 2)::uuid)
                   and (select count(*) from public.meeting_attendees where meeting_id = split_part(:'ref_next', ':', 2)::uuid and guest_name = 'Asha Buyer') = 1,
  'approved: the next meeting is planned with the same people and guests');
select tests.check((select kind = 'action' and approved and owner_id = :'fin' and source = 'proposal'
                      from public.meeting_points where id = split_part(:'ref_task', ':', 2)::uuid)
                   and exists (select 1 from public.notifications where user_id = :'fin' and kind = 'meeting_action'),
  'approved: a task becomes an action and its owner is told');
select tests.check((select status = 'rejected' and decision_note = 'Already done' and decided_by = :'boss' from public.meeting_proposals where id = :'p_ca')
                   and not exists (select 1 from public.corrective_actions where company_id = :'co'),
  'rejected: nothing changes and the reason is kept');
select tests.check((select count(*) from public.meeting_proposals where meeting_id = :'m_sales' and status = 'applied' and decided_by = :'boss' and decided_at is not null) = 7
                   and exists (select 1 from public.audit_log where entity = 'meeting_proposals' and action = 'update' and company_id = :'co'),
  'who approved and when is kept and in the activity log');
-- A proposal added by hand; applying one that no longer works leaves it pending.
select tests.login('boss.mt@m.test'); set role authenticated;
select public.meeting_proposal_add(:'m_sales', 'corrective_action', 'Train the store team',
  jsonb_build_object('source_kind', 'incident', 'source_id', :'inc', 'action', 'Train on spill kits', 'owner_id', :'store',
                    'due_on', to_char(current_date + 10, 'YYYY-MM-DD'))) as p_ca2 \gset
select public.meeting_proposal_decide(:'p_ca2', true, null) as ref_ca2 \gset
select public.meeting_proposal_add(:'m_sales', 'followup', 'Quote follow-up', jsonb_build_object('quotation_id', :'quo', 'note', 'Chase')) as p_fu2 \gset
reset role;
select tests.check((select owner_id = :'store' and action = 'Train on spill kits' from public.corrective_actions where id = split_part(:'ref_ca2', ':', 2)::uuid)
                   and exists (select 1 from public.notifications where user_id = :'store' and kind = 'corrective_action'),
  'approved: a corrective action for the incident, owner told');
select set_config('ims.status_change', 'on', false) \gset x_
update public.quotations set status = 'accepted' where id = :'quo';
select set_config('ims.status_change', 'off', false) \gset x_
select tests.login('boss.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_proposal_decide(%L, true, null)', :'p_fu2'), 'the module''s own rule still applies when approving');
select tests.check((select status from public.meeting_proposals where id = :'p_fu2') = 'pending', 'it stays pending');
reset role;

-- Last time's actions come back at the next meeting.
select split_part(:'ref_next', ':', 2) as m_next \gset
select tests.login('sales.mt@m.test'); set role authenticated;
select public.meeting_agenda_candidates(:'co') as cand2 \gset
select tests.check(exists (select 1 from jsonb_array_elements(:'cand2'::jsonb) x where x ->> 'key' = 'action:' || :'act' and x ->> 'source' = 'follow_up'),
  'open actions are suggested for the next meeting');
select public.meeting_start(:'m_next', false);
select public.meeting_end(:'m_next');
select public.meeting_save_minutes(:'m_next', jsonb_build_object('by', 'app', 'summary', 'Follow-up',
  'follow_up', jsonb_build_array(jsonb_build_object('point_id', :'act', 'status', 'done', 'note', 'Delivery note ready')),
  'points', jsonb_build_array(jsonb_build_object('kind', 'note', 'body', 'All good', 'carried_from', :'act')))) \gset x_
reset role;
select tests.login('boss.mt@m.test'); set role authenticated;
select public.meeting_approve_minutes(:'m_next') \gset x_
reset role;
select tests.check((select status = 'done' and done_note = 'Delivery note ready' from public.meeting_points where id = :'act'),
  'approving the next minutes closes last time''s action');

-- ---- 8. The client request page and invitations --------------------------------------------------------------
select tests.login('sales.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_portal_set(%L, true, false, null)', :'co'), 'only management makes the request link');
select tests.check(public.meeting_portal_link(:'co') is null, 'no request link yet');
reset role;
select tests.login('boss.mt@m.test'); set role authenticated;
select public.meeting_portal_set(:'co', true, false, 'Karibu') as ptoken \gset
select tests.check(:'ptoken' ~ '^[0-9a-f]{64}$' and public.meeting_portal_set(:'co', true, false, 'Karibu') = :'ptoken', 'one request link, kept');
reset role;
select tests.login('sales.mt@m.test'); set role authenticated;
select tests.check((public.meeting_portal_link(:'co') ->> 'token') = :'ptoken', 'organisers can share it');
select tests.blocked('select * from public.meeting_portal', 'the link is not readable from the table');
reset role;
set role anon;
select tests.blocked(format('select public.meeting_portal_request(%L, %L, %L)', :'ptoken', '{}', repeat('a', 32)), 'visitors cannot call it directly');
reset role;
set role service_role;
select tests.check((public.meeting_portal_info(:'ptoken') ->> 'company') = 'Meeting Supply Co'
                   and public.meeting_portal_info(repeat('0', 64)) is null, 'the request page shows our name only for the right link');
select tests.check((public.meeting_portal_request(:'ptoken',
  jsonb_build_object('name', 'Asha', 'email', 'asha@ggm.test', 'topic', 'Order', 'proposed_at', now() - interval '3 days'), repeat('b', 32)) ->> 'status') = 'invalid',
  'a date in the past is refused');
select tests.check((public.meeting_portal_request(:'ptoken', '{"name":"x"}', repeat('b', 32)) ->> 'error') = 'Enter your name.', 'the reason is given');
select tests.check((public.meeting_portal_request(:'ptoken', '{"name":"Again"}', repeat('b', 32)) ->> 'status') = 'invalid'
                   and (public.meeting_portal_request(:'ptoken', '{"name":"Again"}', repeat('b', 32)) ->> 'status') = 'limited',
  'wrong tries count towards the limit too');
select public.meeting_portal_request(:'ptoken', jsonb_build_object('name', 'Asha Buyer', 'company', 'GGM', 'email', 'asha@ggm.test',
  'topic', 'Next year''s lubricants', 'proposed_at', now() + interval '5 days', 'link', 'https://teams.microsoft.com/l/meetup-join/abc'), repeat('c', 32)) as preq \gset
select tests.check((:'preq'::jsonb ->> 'status') = 'received', 'a client asks for a meeting');
select tests.check((public.meeting_portal_request(:'ptoken', jsonb_build_object('name', 'Asha Buyer', 'email', 'asha@ggm.test',
  'topic', 'Second', 'proposed_at', now() + interval '6 days'), repeat('c', 32)) ->> 'status') = 'received', 'a second request');
select tests.check((public.meeting_portal_request(:'ptoken', '{}', repeat('c', 32)) ->> 'status') = 'invalid'
                   and (public.meeting_portal_request(:'ptoken', '{}', repeat('c', 32)) ->> 'status') = 'limited',
  'the same sender is limited to three tries an hour');
select tests.check((public.meeting_portal_request(repeat('d', 64), '{}', repeat('e', 32)) ->> 'status') = 'closed', 'a wrong link is closed');
reset role;
select (:'preq'::jsonb ->> 'invitation_id') as inv1 \gset
select tests.check((select client_id = :'client' and status = 'pending' and external_link like 'https://teams.%' from public.meeting_invitations where id = :'inv1')
                   and exists (select 1 from public.notifications where user_id = :'boss' and kind = 'meeting_request'),
  'the request is matched to the client by email and management is told');
select tests.login('sales.mt@m.test'); set role authenticated;
select tests.check(not exists (select 1 from public.meeting_invitations where id = :'inv1'), 'other staff do not see requests');
select tests.blocked(format('select public.meeting_decide_invitation(%L, true, null, null, null)', :'inv1'), 'only management answers requests');
reset role;
select tests.login('boss.mt@m.test'); set role authenticated;
select public.meeting_decide_invitation(:'inv1', true, 'See you then', null, array[:'sales']::uuid[]) as m_inv \gset
select tests.check((select kind = 'client' and video_provider = 'external' and external_link like 'https://teams.%' and invitation_id = :'inv1'
                      from public.meetings where id = :'m_inv')
                   and (select count(*) from public.meeting_attendees where meeting_id = :'m_inv' and guest_email = 'asha@ggm.test') = 1
                   and (select count(*) from public.meeting_attendees where meeting_id = :'m_inv' and user_id = :'sales') = 1,
  'accepted: on the calendar with their link, the client as a guest');
select id as inv2 from public.meeting_invitations where company_id = :'co' and topic = 'Second' \gset
select public.meeting_decide_invitation(:'inv2', false, 'We are closed that week', null, null) \gset x_
select tests.check((select status = 'declined' and reply = 'We are closed that week' from public.meeting_invitations where id = :'inv2'), 'declined with a reply');
select tests.blocked(format('select public.meeting_decide_invitation(%L, true, null, null, null)', :'inv2'), 'answered only once');
select public.meeting_portal_set(:'co', false, false, null) \gset x_
reset role;
set role service_role;
select tests.check(public.meeting_portal_info(:'ptoken') is null
                   and (public.meeting_portal_request(:'ptoken', '{}', repeat('f', 32)) ->> 'status') = 'closed', 'a switched-off request page is closed');
reset role;
-- A pasted invitation.
select tests.login('proc.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_add_invitation(%L, %L)', :'co', '{"title":"Supplier call","starts_at":"2030-01-01","link":"zoom"}'),
  'a pasted invitation needs the full link');
select public.meeting_add_invitation(:'co', jsonb_build_object('title', 'Valves price review', 'starts_at', now() + interval '2 days',
  'link', 'https://us02web.zoom.us/j/123456?pwd=x', 'organiser', 'Valves Ltd', 'organiser_email', 'sales@valves.test')) as m_paste \gset
select tests.check((select kind = 'supplier' and supplier_id = :'sup' and video_provider = 'external' and record = false from public.meetings where id = :'m_paste')
                   and (select status = 'accepted' and source = 'pasted' from public.meeting_invitations where meeting_id = :'m_paste'),
  'a pasted Zoom invitation goes on the calendar, matched to the supplier');
reset role;

-- ---- 9. Calendar ------------------------------------------------------------------------------------------------
select tests.login('sales.mt@m.test'); set role authenticated;
select public.calendar_add_entry(:'co', jsonb_build_object('title', 'Trade fair', 'kind', 'event', 'starts_on', to_char(current_date + 2, 'YYYY-MM-DD'),
  'ends_on', to_char(current_date + 3, 'YYYY-MM-DD'))) as entry \gset
select public.calendar_add_entry(:'co', jsonb_build_object('title', 'Dentist', 'starts_on', to_char(current_date + 1, 'YYYY-MM-DD'), 'private', true)) as private_entry \gset
select tests.blocked(format('select public.calendar_add_entry(%L, %L)', :'co', '{"title":"Bad","starts_on":"03/11/2026"}'), 'calendar dates are checked');
select public.calendar_items(:'co', current_date - 1, current_date + 40, null) as cal_sales \gset
reset role;
select tests.check(exists (select 1 from jsonb_array_elements(:'cal_sales'::jsonb) x where x ->> 'uid' = 'm-' || :'m_inv')
                   and exists (select 1 from jsonb_array_elements(:'cal_sales'::jsonb) x where x ->> 'uid' = 'c-' || :'entry')
                   and exists (select 1 from jsonb_array_elements(:'cal_sales'::jsonb) x where x ->> 'kind' = 'delivery' and x ->> 'title' = 'Deliver oil to Geita')
                   and not exists (select 1 from jsonb_array_elements(:'cal_sales'::jsonb) x where x ->> 'uid' = 'm-' || :'m_paste'),
  'the calendar shows my meetings, entries and dates from approved proposals, not others'' private meetings');
select tests.login('store.mt@m.test'); set role authenticated;
select public.calendar_items(:'co', current_date - 1, current_date + 40, null) as cal_store \gset
select tests.check(not exists (select 1 from jsonb_array_elements(:'cal_store'::jsonb) x where x ->> 'uid' = 'c-' || :'private_entry')
                   and not exists (select 1 from jsonb_array_elements(:'cal_store'::jsonb) x where x ->> 'kind' in ('invoice', 'follow_up')),
  'private entries stay private; the store keeper sees no invoice dates');
select tests.blocked(format('select public.calendar_remove_entry(%L)', :'entry'), 'someone else cannot remove an entry');
reset role;
select tests.login('fin.mt@m.test'); set role authenticated;
select public.calendar_items(:'co', current_date - 1, current_date + 40, array['action']) as cal_fin \gset
select tests.check(exists (select 1 from jsonb_array_elements(:'cal_fin'::jsonb) x where x ->> 'kind' = 'action')
                   and not exists (select 1 from jsonb_array_elements(:'cal_fin'::jsonb) x where x ->> 'kind' <> 'action'),
  'filters by kind: my actions');
reset role;
select tests.login('other.mt@m.test'); set role authenticated;
select tests.blocked(format('select public.calendar_items(%L, current_date, current_date + 10)', :'co'), 'another company cannot read our calendar');
reset role;
-- The private feed.
select tests.login('sales.mt@m.test'); set role authenticated;
select public.calendar_link(:'co', false, array['meeting', 'entry', 'bogus']) as feed \gset
select tests.check(:'feed' ~ '^[0-9a-f]{64}$' and public.calendar_link(:'co', false) = :'feed', 'one private feed link per person, kept');
select tests.check((select kinds = array['entry', 'meeting'] from public.calendar_links where user_id = :'sales'), 'unknown kinds are dropped');
select tests.blocked('select feed_token from public.calendar_links', 'the feed token cannot be read back from the table');
select tests.blocked(format('select public.calendar_feed(%L)', :'feed'), 'signed-in users cannot call the feed function');
reset role;
set role service_role;
select public.calendar_feed(:'feed') as feedjson \gset
select tests.check((:'feedjson'::jsonb ->> 'company') = 'Meeting Supply Co' and (:'feedjson'::jsonb ->> 'name') = 'Sara Sales'
                   and exists (select 1 from jsonb_array_elements(:'feedjson'::jsonb -> 'items') x where x ->> 'uid' = 'm-' || :'m_inv')
                   and not exists (select 1 from jsonb_array_elements(:'feedjson'::jsonb -> 'items') x where x ->> 'kind' in ('action', 'invoice')),
  'the feed holds that person''s chosen dates');
select tests.check(public.calendar_feed(repeat('0', 64)) is null and public.calendar_feed('nope') is null, 'a wrong feed link gives nothing');
reset role;
select tests.login('sales.mt@m.test'); set role authenticated;
select public.calendar_link(:'co', true) as feed2 \gset
reset role;
set role service_role;
select tests.check(public.calendar_feed(:'feed') is null and public.calendar_feed(:'feed2') is not null, 'a new feed link switches the old one off');
reset role;
update public.memberships set active = false where company_id = :'co' and user_id = :'sales';
set role service_role;
select tests.check(public.calendar_feed(:'feed2') is null, 'a person who left gets no feed');
reset role;
update public.memberships set active = true where company_id = :'co' and user_id = :'sales';

-- ---- 10. Reminders ------------------------------------------------------------------------------------------------
select tests.login('boss.mt@m.test'); set role authenticated;
select public.meeting_save_point(null, (select id from public.meeting_points where owner_id = :'fin' and source = 'proposal'),
  jsonb_build_object('kind', 'action', 'body', 'Send the statement to Geita', 'owner_id', :'fin', 'due_on', to_char(current_date - 1, 'YYYY-MM-DD'))) \gset x_
select public.meeting_create(:'co', jsonb_build_object('title', 'Quick stand-up', 'starts_at', now() + interval '2 hours',
  'attendees', jsonb_build_array(:'sales'))) \gset x_
select tests.blocked(format('select public.run_meeting_alerts(%L)', :'co'), 'reminders are run by the scheduler, not by users');
reset role;
select public.run_meeting_alerts(:'co') as sent \gset
select tests.check(:sent > 0
                   and exists (select 1 from public.notifications where user_id = :'fin' and kind = 'meeting_action_due' and severity = 'critical' and title like 'Action overdue:%')
                   and exists (select 1 from public.notifications where user_id = :'sales' and kind = 'meeting_soon'),
  'reminders: late actions (pushed) and meetings in the next day');
select tests.check(public.run_meeting_alerts(:'co') = 0, 'running again sends nothing twice');
select tests.check(exists (select 1 from public.notifications where user_id = :'store' and kind = 'calendar_entry')
                   or not exists (select 1 from public.calendar_entries where owner_id = :'store' and starts_on <= current_date + 1),
  'calendar dates with an owner are reminded the day before');
select tests.login('boss.mt@m.test'); set role authenticated;
select public.set_company_feature(:'co', 'meetings', false);
reset role;
select tests.check(public.run_meeting_alerts(:'co') = 0, 'no meeting reminders while the feature is off');
select tests.login('boss.mt@m.test'); set role authenticated;
select public.set_company_feature(:'co', 'meetings', null);
select public.meeting_summary(:'co') as summ \gset
reset role;
select tests.check((:'summ'::jsonb ->> 'is_manager')::boolean and (:'summ'::jsonb ->> 'proposals')::int = 1,
  'the summary counts what waits for management');
select tests.check(has_function_privilege('service_role', 'public.run_all_alerts(text)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.run_meeting_alerts(uuid)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.meeting_insert(uuid, jsonb, uuid, uuid)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.meeting_proposal_apply(public.meeting_proposals)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.calendar_items_for(uuid, uuid, date, date, text[])', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.meeting_portal_request(text, jsonb, text)', 'EXECUTE')
                   and has_function_privilege('service_role', 'public.meeting_portal_request(text, jsonb, text)', 'EXECUTE')
                   and has_function_privilege('service_role', 'public.calendar_feed(text)', 'EXECUTE')
                   and has_function_privilege('authenticated', 'public.meeting_create(uuid, jsonb)', 'EXECUTE'),
  'grants: internal functions are closed; the public pages use the service role');
select tests.check(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                                 and (p.proname like 'meeting\_%' or p.proname like 'calendar\_%' or p.proname = 'run_meeting_alerts')
                                 and not coalesce(array_to_string(p.proconfig, ',') like '%search_path=%', false)),
  'every meeting and calendar function has a fixed search path');
-- The scheduled job still runs the other alerts (compliance included) with the meeting reminders.
select tests.check(position('run_compliance_alerts' in pg_get_functiondef('public.run_all_alerts(text)'::regprocedure)) > 0
                   and position('run_meeting_alerts' in pg_get_functiondef('public.run_all_alerts(text)'::regprocedure)) > 0
                   and position('run_compliance_alerts' in pg_get_functiondef('public.refresh_alerts(uuid)'::regprocedure)) > 0
                   and position('run_meeting_alerts' in pg_get_functiondef('public.refresh_alerts(uuid)'::regprocedure)) > 0,
  'the alerts job keeps the compliance reminders and adds the meeting reminders');

-- ---- 11. Cancelling --------------------------------------------------------------------------------------------------
select tests.login('boss.mt@m.test'); set role authenticated;
select public.meeting_create(:'co', jsonb_build_object('title', 'To be cancelled', 'starts_at', now() + interval '4 days',
  'attendees', jsonb_build_array(:'fin'))) as m_cancel \gset
select public.meeting_add_guest(:'m_cancel', '{"name":"Visitor"}') as g_cancel \gset
select public.meeting_guest_link(:'g_cancel', 3) as gtoken3 \gset
select public.meeting_cancel(:'m_cancel', 'Client travelling');
reset role;
set role service_role;
select tests.check(public.meeting_guest_view(:'gtoken3') is null, 'a cancelled meeting''s guest links stop');
reset role;
select tests.check((select status = 'cancelled' and cancel_reason = 'Client travelling' from public.meetings where id = :'m_cancel')
                   and exists (select 1 from public.notifications where user_id = :'fin' and kind = 'meeting_cancelled'),
  'cancelled with a reason; attendees told');

-- ---- 12. Backups, clearing test transactions, closing a company ---------------------------------------------------------
select tests.check((select count(*) from public.backup_table_plan()
                     where table_name in ('meeting_series', 'meetings', 'meeting_texts', 'meeting_attendees', 'meeting_agenda_items',
                                          'meeting_points', 'meeting_proposals', 'meeting_invitations', 'calendar_entries') and skipped is null) = 9,
  'backups include the meetings, minutes, invitations and calendar');
select tests.check((select count(*) from public.backup_table_plan()
                     where table_name in ('meeting_guest_links', 'meeting_portal', 'meeting_portal_hits', 'calendar_links') and skipped is not null) = 4,
  'backups leave out the secret links and the rate-limit rows');
select count(*) as meetings_before from public.meetings where company_id = :'co' \gset
select public.reset_company_transactions(:'co', 'Meeting Supply Co') \gset x_
select tests.check((select count(*) from public.meetings where company_id = :'co') = :meetings_before
                   and (select count(*) from public.meeting_points where company_id = :'co') > 0
                   and (select count(*) from public.calendar_entries where company_id = :'co') > 0,
  'clearing test transactions keeps the meetings, their minutes and the calendar');

select tests.login('close.mt@m.test'); set role authenticated;
select public.create_company('Closing Meeting Co') as cl \gset
select public.meeting_create(:'cl', jsonb_build_object('title', 'Last meeting', 'starts_at', now() + interval '1 hour')) as cl_m \gset
select public.meeting_add_guest(:'cl_m', '{"name":"Guest"}') as cl_g \gset
select public.meeting_guest_link(:'cl_g', 3) \gset x_
select public.meeting_start(:'cl_m', true);
select public.meeting_add_line(:'cl_m', 'typed', 'Closing down');
select public.meeting_end(:'cl_m');
select public.meeting_save_minutes(:'cl_m', jsonb_build_object('by', 'app', 'points', jsonb_build_array(jsonb_build_object('kind', 'action', 'body', 'Close the books')),
  'proposals', jsonb_build_array(jsonb_build_object('target', 'calendar_entry', 'payload', jsonb_build_object('title', 'Final day', 'starts_on', to_char(current_date + 3, 'YYYY-MM-DD')))))) \gset x_
select public.meeting_portal_set(:'cl', true, false, null) \gset x_
select public.calendar_link(:'cl', false) \gset x_
select public.calendar_add_entry(:'cl', jsonb_build_object('title', 'Hand over keys', 'starts_on', to_char(current_date + 2, 'YYYY-MM-DD'))) \gset x_
reset role;
select count(public.delete_company_step(c, interval '1 hour')) from unnest(array[:'cl']::uuid[]) c \gset x_
select tests.check(not exists (select 1 from public.companies where id = :'cl')
                   and (select count(*) from public.meetings where company_id = :'cl') = 0
                   and (select count(*) from public.meeting_texts where company_id = :'cl') = 0
                   and (select count(*) from public.meeting_points where company_id = :'cl') = 0
                   and (select count(*) from public.meeting_proposals where company_id = :'cl') = 0
                   and (select count(*) from public.meeting_guest_links where company_id = :'cl') = 0
                   and (select count(*) from public.meeting_portal where company_id = :'cl') = 0
                   and (select count(*) from public.calendar_links where company_id = :'cl') = 0
                   and (select count(*) from public.calendar_entries where company_id = :'cl') = 0,
  'closing a company deletes its meetings, minutes, links and calendar');

-- Clean up the company that was closed (Meeting Supply Co stays for the restore round trip test).
delete from public.company_closures where company_id = :'cl';
