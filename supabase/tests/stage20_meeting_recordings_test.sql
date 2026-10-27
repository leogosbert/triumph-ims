-- Tests for meeting recordings (v1.25): who records, uploads and plays them, the private storage rules, the
-- retention setting (management only), expiry and "Delete now", the guest page's recording notice, ending a
-- meeting closing its recording, and the paragraph minutes.
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

insert into auth.users (email) values ('boss.rec@m.test'), ('sales.rec@m.test'), ('store.rec@m.test'), ('fin.rec@m.test'),
                                      ('other.rec@m.test');
select id as boss from auth.users where email = 'boss.rec@m.test' \gset
select id as sales from auth.users where email = 'sales.rec@m.test' \gset
select id as store from auth.users where email = 'store.rec@m.test' \gset
select id as fin from auth.users where email = 'fin.rec@m.test' \gset
select id as outsider from auth.users where email = 'other.rec@m.test' \gset

select tests.login('boss.rec@m.test'); set role authenticated;
select public.create_company('Recording Supply Co') as co \gset
reset role;
select tests.login('other.rec@m.test'); set role authenticated;
select public.create_company('Other Recording Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
values (:'co', :'sales', 'sales'), (:'co', :'store', 'warehouse'), (:'co', :'fin', 'finance');

select tests.check((select bool_and(relrowsecurity) from pg_class
                     where relnamespace = 'public'::regnamespace
                       and relname in ('meeting_settings', 'meeting_recordings', 'meeting_recording_parts')
                    having count(*) = 3), 'row-level security is on for the 3 recording tables');
select tests.check(exists (select 1 from storage.buckets where id = 'meeting-recordings' and not public),
  'the meeting-recordings bucket exists and is private');

-- A private sales meeting with the store keeper (finance is not invited).
select tests.login('sales.rec@m.test'); set role authenticated;
select public.meeting_create(:'co', jsonb_build_object('title', 'Geita delivery review', 'starts_at', now() + interval '5 minutes',
  'open_to_team', false, 'attendees', jsonb_build_array(:'store'))) as mt \gset
select public.meeting_add_guest(:'mt', '{"name":"Asha Buyer","org":"Geita Gold Mine"}') as guest \gset
select public.meeting_guest_link(:'guest', 3) as gtoken \gset
select tests.blocked(format('select public.meeting_recording_start(%L, %L)', :'mt', 'audio/webm;codecs=opus'),
  'a planned meeting cannot be recorded before it starts');
select public.meeting_start(:'mt', true);
select tests.blocked(format('select public.meeting_recording_start(%L, %L)', :'mt', 'video/webm'), 'only audio is recorded');
select public.meeting_recording_start(:'mt', 'audio/webm;codecs=opus', 'mixed') as rec \gset
select tests.check((select status = 'recording' and started_by = :'sales' and language = 'mixed'
                           and storage_path = :'co' || '/' || :'mt' || '/' || :'rec' || '/'
                           and expires_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'
                      from public.meeting_recordings where id = :'rec'),
  'the organiser starts a recording: its folder is company/meeting/recording and it expires after 30 days by default');
reset role;

select tests.login('store.rec@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_recording_start(%L, %L)', :'mt', 'audio/webm'), 'an attendee cannot start a recording');
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'meeting-recordings',
  :'co' || '/' || :'mt' || '/' || :'rec' || '/0000.webm'), 'an attendee cannot upload into the recording');
reset role;

-- Uploading pieces.
select tests.login('sales.rec@m.test'); set role authenticated;
insert into storage.objects (bucket_id, name) values ('meeting-recordings', :'co' || '/' || :'mt' || '/' || :'rec' || '/0000.webm');
insert into storage.objects (bucket_id, name) values ('meeting-recordings', :'co' || '/' || :'mt' || '/' || :'rec' || '/0001.webm');
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'meeting-recordings',
  :'co' || '/' || :'mt' || '/' || :'rec' || '/../x/0002.webm'), 'no file outside the recording''s folder');
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'meeting-recordings',
  :'other' || '/' || :'mt' || '/' || :'rec' || '/0002.webm'), 'no file under another company');
select public.meeting_recording_add_part(:'rec', 0, :'co' || '/' || :'mt' || '/' || :'rec' || '/0000.webm', 120000, 30000);
select public.meeting_recording_add_part(:'rec', 1, :'co' || '/' || :'mt' || '/' || :'rec' || '/0001.webm', 110000, 30000);
select public.meeting_recording_add_part(:'rec', 1, :'co' || '/' || :'mt' || '/' || :'rec' || '/0001.webm', 110000, 30000);
select tests.blocked(format('select public.meeting_recording_add_part(%L, 2, %L, 1000, 1000)', :'rec',
  :'co' || '/' || :'mt' || '/' || :'rec' || '/0002.webm'), 'a piece must be uploaded before it is added');
select tests.check((select parts = 2 and size_bytes = 230000 and duration_seconds = 60 and last_part_at is not null
                      from public.meeting_recordings where id = :'rec'),
  'pieces add up (the same piece twice counts once)');
reset role;

-- Who can play it.
select tests.login('store.rec@m.test'); set role authenticated;
select tests.check((select count(*) from public.meeting_recordings where id = :'rec') = 1
                   and (select count(*) from public.meeting_recording_parts where recording_id = :'rec') = 2
                   and (select count(*) from storage.objects where bucket_id = 'meeting-recordings' and name like :'co' || '/%') = 2,
  'a member who attends the meeting can see and play the recording');
select tests.blocked(format('select public.meeting_recording_delete(%L)', :'rec'), 'an attendee cannot delete the recording');
reset role;
select tests.login('boss.rec@m.test'); set role authenticated;
select tests.check((select count(*) from public.meeting_recordings where id = :'rec') = 1
                   and (select count(*) from storage.objects where bucket_id = 'meeting-recordings' and name like :'co' || '/%') = 2,
  'management can play every recording');
reset role;
select tests.login('fin.rec@m.test'); set role authenticated;
select tests.check((select count(*) from public.meeting_recordings where id = :'rec') = 0
                   and (select count(*) from public.meeting_recording_parts where recording_id = :'rec') = 0
                   and (select count(*) from storage.objects where bucket_id = 'meeting-recordings') = 0,
  'a member who cannot see the meeting cannot see or play its recording');
reset role;
select tests.login('other.rec@m.test'); set role authenticated;
select tests.check((select count(*) from public.meeting_recordings) = 0
                   and (select count(*) from storage.objects where bucket_id = 'meeting-recordings') = 0,
  'another company sees no recording and no file');
reset role;
select set_config('request.jwt.claims', '', false);
set role anon;
select tests.blocked('select count(*) from public.meeting_recordings', 'a guest (no account) cannot list recordings');
-- (On Supabase the anon key can query storage, but no rule lets it see this bucket; in the local stub it has no grant.)
create or replace function pg_temp.anon_files() returns bigint language plpgsql as $f$
begin
  return (select count(*) from storage.objects where bucket_id = 'meeting-recordings');
exception when insufficient_privilege then
  return 0;
end $f$;
select tests.check(pg_temp.anon_files() = 0, 'a guest (no account) sees no recording file');
select tests.blocked(format('select public.meeting_recordings_expire(10)'), 'a guest cannot run the expiry');
reset role;

-- The guest page says the meeting is being recorded.
set role service_role;
select tests.check((public.meeting_guest_view(:'gtoken') ->> 'recording')::boolean and (public.meeting_guest_view(:'gtoken') ->> 'record')::boolean,
  'the guest page shows that the meeting is being recorded');
reset role;

-- Retention: management only.
select tests.login('sales.rec@m.test'); set role authenticated;
select tests.check(public.meeting_recording_days(:'co') = 30, 'recordings are kept 30 days unless management changes it');
select tests.blocked(format('select public.meeting_set_recording_days(%L, 7)', :'co'), 'only management sets how long recordings are kept');
select tests.blocked(format('insert into public.meeting_settings (company_id, recording_days) values (%L, 7)', :'co'),
  'the setting is not written directly');
reset role;
select tests.login('boss.rec@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_set_recording_days(%L, 5)', :'co'), 'only 7, 30, 90, 365 days or keep');
select tests.blocked(format('select public.meeting_set_recording_days(%L, 7)', :'other'), 'not for another company');
select public.meeting_set_recording_days(:'co', 0) \gset x_
select tests.check((select expires_at is null from public.meeting_recordings where id = :'rec'), 'keep: the recording no longer expires');
select public.meeting_set_recording_days(:'co', 7) \gset x_
select tests.check((select recording_days = 7 from public.meeting_settings where company_id = :'co')
                   and (select expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour'
                          from public.meeting_recordings where id = :'rec'),
  'management sets 7 days: existing recordings follow');
reset role;
select tests.login('store.rec@m.test'); set role authenticated;
select tests.check((select recording_days from public.meeting_settings where company_id = :'co') = 7, 'members can read the setting');
reset role;

-- Stopping, a second recording, and expiry.
select tests.login('sales.rec@m.test'); set role authenticated;
select public.meeting_recording_stop(:'rec');
select tests.check((select status = 'done' and ended_at is not null from public.meeting_recordings where id = :'rec'), 'the recording stops');
select tests.blocked(format('select public.meeting_recording_add_part(%L, 5, %L, 1000, 1000)', :'rec',
  :'co' || '/' || :'mt' || '/' || :'rec' || '/0001.webm'), 'nothing is added after it stopped');
select public.meeting_recording_start(:'mt', 'audio/mp4', 'sw') as rec2 \gset
insert into storage.objects (bucket_id, name) values ('meeting-recordings', :'co' || '/' || :'mt' || '/' || :'rec2' || '/0000.mp4');
select public.meeting_recording_add_part(:'rec2', 0, :'co' || '/' || :'mt' || '/' || :'rec2' || '/0000.mp4', 50000, 20000);
select tests.blocked(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'meeting-recordings',
  :'co' || '/' || :'mt' || '/' || :'rec' || '/0002.webm'), 'a stopped recording takes no more files');
reset role;
select tests.login('boss.rec@m.test'); set role authenticated;
select tests.blocked(format('select public.meeting_recording_start(%L, %L)', :'mt', 'audio/webm'), 'only one recording at a time');
select tests.blocked('select * from public.meeting_recordings_expire(10)', 'members cannot run the expiry');
reset role;

-- The first recording is past its date, the second is not.
update public.meeting_recordings set expires_at = now() - interval '1 minute' where id = :'rec';
update public.meeting_recordings set transcript = '[00:00:01] Juma: Tutapeleka mafuta Geita Ijumaa.', transcript_status = 'ready' where id = :'rec';
set role service_role;
create temp table expired_out as select * from public.meeting_recordings_expire(100);
reset role;
select tests.check((select count(*) from expired_out) = 2 and (select bool_and(recording_id = :'rec') from expired_out)
                   and (select deleted_at is not null and delete_reason = 'expired' and purged_at is null
                               and transcript <> '' from public.meeting_recordings where id = :'rec')
                   and (select deleted_at is null and status = 'recording' from public.meeting_recordings where id = :'rec2'),
  'expiry marks and returns only the expired recording''s files (the written transcript stays)');
select tests.login('store.rec@m.test'); set role authenticated;
select tests.check((select count(*) from storage.objects where bucket_id = 'meeting-recordings' and name like '%/' || :'rec' || '/%') = 0
                   and (select count(*) from public.meeting_recording_parts where recording_id = :'rec') = 0,
  'an expired recording can no longer be played');
reset role;
set role service_role;
select tests.check(public.meeting_recordings_mark_purged(array[:'rec']::uuid[]) = 0, 'not cleared while its files are still in storage');
reset role;
-- (the job removes the files through the Storage API)
delete from storage.objects where bucket_id = 'meeting-recordings' and name like '%/' || :'rec' || '/%';
set role service_role;
select public.meeting_recordings_mark_purged(array[:'rec']::uuid[]) as purged \gset
select tests.check(:'purged' = '1'
                   and (select purged_at is not null from public.meeting_recordings where id = :'rec')
                   and (select count(*) from public.meeting_recordings_expire(100)) = 0,
  'once the files are removed the recording is cleared and not returned again');
reset role;

-- Summaries of an expired recording still work from its transcript; the guest notice ends with the recording.
select tests.login('sales.rec@m.test'); set role authenticated;
select public.meeting_recording_save_summary(:'rec', 'The team agreed to deliver the oil to Geita on Friday.', 'Timekubaliana kupeleka mafuta Geita Ijumaa.');
select tests.check((select summary_status = 'ready' and summary_sw <> '' from public.meeting_recordings where id = :'rec'),
  'an expired recording can still be summarised from its transcript');

-- Delete now.
select public.meeting_recording_delete(:'rec2') as paths \gset
select tests.check(:'paths' = '{' || :'co' || '/' || :'mt' || '/' || :'rec2' || '/0000.mp4}', 'Delete now returns the files to remove');
select tests.check((select deleted_at is not null and delete_reason = 'manual' and status = 'done' and deleted_by = :'sales'
                      from public.meeting_recordings where id = :'rec2'), 'Delete now marks it deleted');
select tests.check(not public.meeting_recording_purged(:'rec2'), 'not cleared while the file is there');
delete from storage.objects where bucket_id = 'meeting-recordings' and name like '%/' || :'rec2' || '/%';
select tests.check(public.meeting_recording_purged(:'rec2'), 'the organiser removes the files and the recording is cleared');
select tests.blocked(format('select public.meeting_recording_save_transcript(%L, %L)', :'rec2', 'x'), 'a deleted recording takes no transcript');
reset role;
set role service_role;
select tests.check(not (public.meeting_guest_view(:'gtoken') ->> 'recording')::boolean, 'the guest page stops showing Recording');
reset role;

-- Ending the meeting closes a recording still running.
select tests.login('sales.rec@m.test'); set role authenticated;
select public.meeting_recording_start(:'mt', 'audio/webm', 'en') as rec3 \gset
select public.meeting_end(:'mt');
select tests.check((select status = 'done' and ended_at is not null from public.meeting_recordings where id = :'rec3'),
  'ending the meeting closes its recording');
select tests.blocked(format('select public.meeting_recording_start(%L, %L)', :'mt', 'audio/webm'), 'a held meeting is not recorded');

-- Paragraph minutes are kept.
select public.meeting_save_minutes(:'mt', jsonb_build_object('by', 'ai',
  'summary', 'The team met to review the Geita delivery.',
  'sections', jsonb_build_array(jsonb_build_object('title', 'Geita delivery', 'topic', 'Deliveries', 'discussion', 'Juma explained the truck is ready.',
                                                   'decisions', 'Deliver on Friday because the client asked.'),
                                jsonb_build_object('title', 'x')),
  'risks', jsonb_build_array('Fuel price may rise.'), 'next_meeting', 'Meet again on Monday.', 'summary_sw', 'Timekubaliana kupeleka Ijumaa.',
  'points', jsonb_build_array(jsonb_build_object('kind', 'action', 'body', 'Deliver the oil to Geita', 'owner_id', :'store')))) \gset x_
select tests.check((select minutes_summary ->> 'format' = '2' and jsonb_array_length(minutes_summary -> 'sections') = 1
                           and minutes_summary -> 'sections' -> 0 ->> 'decisions' like 'Deliver on Friday%'
                           and minutes_summary ->> 'summary_sw' <> '' and minutes_summary ->> 'next_meeting' <> ''
                           and jsonb_array_length(minutes_summary -> 'risks') = 1
                      from public.meetings where id = :'mt'),
  'the minutes keep the opening summary, one section per agenda item, risks, next meeting and the Kiswahili summary');
reset role;

-- Backups and the activity log.
select tests.check((select count(*) from public.backup_table_plan()
                     where table_name in ('meeting_settings', 'meeting_recordings', 'meeting_recording_parts') and skipped is null) = 3,
  'backups include the recording rows, transcripts and the setting (the audio files stay in storage)');
select tests.check(exists (select 1 from public.audit_log where entity = 'meeting_settings' and company_id = :'co'),
  'changing how long recordings are kept is in the activity log');
