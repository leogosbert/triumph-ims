-- =====================================================================
-- Meeting recordings and paragraph minutes (v1.25).
--
--   meeting_settings          per company: how long recordings are kept
--                             ("Delete meeting recordings after" 7, 30, 90
--                             days, 1 year, or keep = 0). Default 30 days.
--                             Only management changes it.
--   meeting_recordings        one audio recording of a meeting (one
--                             continuous stream from the organiser's phone or
--                             laptop): who started it, when, how long, how
--                             big, the folder in storage, when it expires, its
--                             transcript (server-side speech to text when the
--                             live speech capture was not used) and its
--                             summary.
--   meeting_recording_parts   the pieces the browser uploads every few
--                             seconds (one stream, played back in order).
--
-- Storage: a PRIVATE bucket "meeting-recordings", files under
--   <company>/<meeting>/<recording>/<seq>.<ext>
-- Members who can see the meeting can play it (signed links); only the person
-- recording uploads to it, and only while it is recording; files are deleted
-- after the recording is marked deleted (Delete now, or expired).
--
-- Expiry: netlify/functions/meeting-recordings-cron.mts (service role) calls
-- meeting_recordings_expire(), removes the returned files through the Storage
-- API, then meeting_recordings_mark_purged().
--
-- Also here:
--   * meeting_save_minutes keeps the new paragraph minutes (opening summary,
--     one section per agenda item, risks, next meeting, Kiswahili summary).
--   * meeting_guest_view tells the guest page when the meeting is recorded.
--   * Ending a meeting closes its recordings.
--
-- Safe to run more than once. Needs the v1.23 meetings SQL first.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.meeting_settings (
  company_id      uuid primary key references public.companies (id) on delete cascade,
  recording_days  integer not null default 30 check (recording_days in (0, 7, 30, 90, 365)),
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now()
);

create table if not exists public.meeting_recordings (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  meeting_id         uuid not null,
  started_by         uuid references auth.users (id) on delete set null,
  started_at         timestamptz not null default now(),
  ended_at           timestamptz,
  last_part_at       timestamptz,
  status             text not null default 'recording' check (status in ('recording', 'done')),
  duration_seconds   integer not null default 0 check (duration_seconds >= 0),
  size_bytes         bigint not null default 0 check (size_bytes >= 0),
  parts              integer not null default 0 check (parts >= 0),
  mime               text not null check (mime ~ '^audio/(webm|mp4|ogg|mpeg|aac|x-m4a)(;[ a-z0-9=.,"-]*)?$' and char_length(mime) <= 80),
  storage_path       text not null check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/$'),
  language           text not null default 'sw' check (language in ('sw', 'en', 'mixed')),
  expires_at         timestamptz,
  deleted_at         timestamptz,
  deleted_by         uuid references auth.users (id) on delete set null,
  delete_reason      text check (delete_reason is null or delete_reason in ('manual', 'expired')),
  purged_at          timestamptz,
  transcript         text not null default '' check (char_length(transcript) <= 400000),
  transcript_status  text not null default 'none' check (transcript_status in ('none', 'writing', 'ready', 'failed')),
  transcript_error   text check (transcript_error is null or char_length(transcript_error) <= 500),
  transcript_requested_at timestamptz,
  summary            text not null default '' check (char_length(summary) <= 20000),
  summary_sw         text not null default '' check (char_length(summary_sw) <= 10000),
  summary_status     text not null default 'none' check (summary_status in ('none', 'writing', 'ready', 'failed')),
  summary_error      text check (summary_error is null or char_length(summary_error) <= 500),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, company_id),
  foreign key (meeting_id, company_id) references public.meetings (id, company_id) on delete cascade
);
create index if not exists meeting_recordings_meeting_idx on public.meeting_recordings (meeting_id, started_at);
create index if not exists meeting_recordings_expiry_idx on public.meeting_recordings (expires_at) where deleted_at is null;
create index if not exists meeting_recordings_purge_idx on public.meeting_recordings (deleted_at) where deleted_at is not null and purged_at is null;
-- One recording at a time per meeting.
create unique index if not exists meeting_recordings_one_live on public.meeting_recordings (meeting_id) where status = 'recording';

create table if not exists public.meeting_recording_parts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  recording_id  uuid not null,
  seq           integer not null check (seq between 0 and 100000),
  storage_path  text not null unique check (char_length(storage_path) <= 200),
  size_bytes    integer not null check (size_bytes between 1 and 26214400),
  duration_ms   integer not null default 0 check (duration_ms between 0 and 3600000),
  created_at    timestamptz not null default now(),
  unique (recording_id, seq),
  foreign key (recording_id, company_id) references public.meeting_recordings (id, company_id) on delete cascade
);

do $$
declare
  t text;
begin
  foreach t in array array['meeting_settings', 'meeting_recordings', 'meeting_recording_parts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  foreach t in array array['meeting_settings', 'meeting_recordings'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['meeting_settings', 'meeting_recordings', 'meeting_recording_parts'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
  end loop;
  -- The retention setting is in the activity log; the recordings are not (they change every few seconds while recording).
  drop trigger if exists meeting_settings_audit on public.meeting_settings;
  create trigger meeting_settings_audit after insert or update or delete on public.meeting_settings
    for each row execute function public.audit_row();
end $$;

grant select on public.meeting_settings, public.meeting_recordings, public.meeting_recording_parts to authenticated;

drop policy if exists meeting_settings_select on public.meeting_settings;
create policy meeting_settings_select on public.meeting_settings for select to authenticated using (public.is_member(company_id));
drop policy if exists meeting_recordings_select on public.meeting_recordings;
create policy meeting_recordings_select on public.meeting_recordings for select to authenticated
  using (public.meeting_visible(company_id, meeting_id));
drop policy if exists meeting_recording_parts_select on public.meeting_recording_parts;
create policy meeting_recording_parts_select on public.meeting_recording_parts for select to authenticated
  using (exists (select 1 from public.meeting_recordings r
                  where r.id = recording_id and r.deleted_at is null and public.meeting_visible(r.company_id, r.meeting_id)));

-- ---------------------------------------------------------------------
-- 2. The private storage bucket and its rules
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('meeting-recordings', 'meeting-recordings', false) on conflict (id) do nothing;
do $$
begin
  update storage.buckets
     set public = false, file_size_limit = 26214400,
         allowed_mime_types = array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a']
   where id = 'meeting-recordings';
exception when undefined_column then
  update storage.buckets set public = false where id = 'meeting-recordings';
  raise notice 'Storage limits not set (older storage version).';
end;
$$;

-- p_action: 'read' (members who see the meeting, until the recording is deleted), 'write' (the person recording,
-- while it records), 'delete' (whoever manages the meeting, once the recording is marked deleted).
create or replace function public.meeting_recording_file_ok(p_name text, p_action text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(p_name, '') !~ '\.\.' and coalesce(p_name, '') ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{4,6}\.(webm|mp4|m4a|ogg|mp3|aac)$'
     and exists (
       select 1 from public.meeting_recordings r
        where r.company_id::text = (storage.foldername(p_name))[1]
          and r.meeting_id::text = (storage.foldername(p_name))[2]
          and r.id::text = (storage.foldername(p_name))[3]
          and case p_action
                -- (a deleted recording's files stay visible to whoever manages the meeting, so they can be removed)
                when 'read' then (r.deleted_at is null and public.meeting_visible(r.company_id, r.meeting_id))
                              or (r.deleted_at is not null and public.meeting_can_manage(r.meeting_id))
                when 'write' then r.deleted_at is null and r.status = 'recording' and r.started_by = auth.uid()
                                  and public.meeting_can_manage(r.meeting_id)
                when 'delete' then r.deleted_at is not null and public.meeting_can_manage(r.meeting_id)
                else false
              end);
$$;

drop policy if exists meeting_recordings_files_select on storage.objects;
create policy meeting_recordings_files_select on storage.objects for select to authenticated
  using (bucket_id = 'meeting-recordings' and public.meeting_recording_file_ok(name, 'read'));
drop policy if exists meeting_recordings_files_insert on storage.objects;
create policy meeting_recordings_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'meeting-recordings' and public.meeting_recording_file_ok(name, 'write'));
drop policy if exists meeting_recordings_files_delete on storage.objects;
create policy meeting_recordings_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'meeting-recordings' and public.meeting_recording_file_ok(name, 'delete'));

-- Closed companies: recordings are removed with the logo and the other files.
create or replace function public.add_meeting_recordings_cleanup()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.bucket = 'branding'
     and exists (select 1 from storage.objects o where o.bucket_id = 'meeting-recordings' and left(o.name, length(new.prefix)) = new.prefix) then
    insert into public.storage_cleanup (bucket, prefix, company_ref)
    values ('meeting-recordings', new.prefix, new.company_ref)
    on conflict (bucket, prefix) do nothing;
    begin
      delete from storage.objects where bucket_id = 'meeting-recordings' and name like new.prefix || '%';
    exception when others then
      raise notice 'meeting recordings for % left in storage: %', new.company_ref, sqlerrm;
    end;
  end if;
  return null;
end;
$$;
do $$
begin
  drop trigger if exists storage_cleanup_meeting_recordings on public.storage_cleanup;
  create trigger storage_cleanup_meeting_recordings after insert on public.storage_cleanup
    for each row execute function public.add_meeting_recordings_cleanup();
exception when undefined_table then
  raise notice 'Run the v1.14 deletion update first, then this one again, so recordings are cleaned up with closed companies.';
end;
$$;

-- ---------------------------------------------------------------------
-- 3. How long recordings are kept (management)
-- ---------------------------------------------------------------------
create or replace function public.meeting_recording_days(p_company uuid)
returns integer language sql stable security definer set search_path = ''
as $$ select coalesce((select recording_days from public.meeting_settings where company_id = p_company), 30); $$;

-- 0 = keep. Recordings already made follow the new setting, but none is deleted sooner than a day from now.
create or replace function public.meeting_set_recording_days(p_company uuid, p_days integer)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management sets how long recordings are kept.' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (0, 7, 30, 90, 365) then
    raise exception 'Choose 7, 30 or 90 days, 1 year, or keep.' using errcode = '22023';
  end if;
  insert into public.meeting_settings (company_id, recording_days, updated_by)
  values (p_company, p_days, auth.uid())
  on conflict (company_id) do update set recording_days = excluded.recording_days, updated_by = excluded.updated_by;
  update public.meeting_recordings
     set expires_at = case when p_days = 0 then null
                           else greatest(started_at + make_interval(days => p_days), now() + interval '1 day') end
   where company_id = p_company and deleted_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Recording (the organiser, the chair or management, while the meeting is live)
-- ---------------------------------------------------------------------
create or replace function public.meeting_recording_start(p_meeting uuid, p_mime text, p_language text default 'sw')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  m      public.meetings;
  r      public.meeting_recordings;
  v_id   uuid := gen_random_uuid();
  v_days integer;
  v_mime text := lower(btrim(coalesce(p_mime, '')));
begin
  select * into m from public.meetings where id = p_meeting for update;
  if m.id is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Only the organiser, the chair or management can record this meeting.' using errcode = '42501';
  end if;
  if m.status <> 'live' then
    raise exception 'Start the meeting first, then record.' using errcode = '22023';
  end if;
  if v_mime !~ '^audio/(webm|mp4|ogg|mpeg|aac|x-m4a)(;[ a-z0-9=.,"-]*)?$' or char_length(v_mime) > 80 then
    raise exception 'This kind of audio cannot be recorded.' using errcode = '22023';
  end if;
  select * into r from public.meeting_recordings where meeting_id = p_meeting and status = 'recording';
  if r.id is not null then
    -- The same person again (the page was reloaded): a new stream starts, the old one is closed.
    if r.started_by = auth.uid() or coalesce(r.last_part_at, r.started_at) < now() - interval '2 minutes' then
      update public.meeting_recordings set status = 'done', ended_at = coalesce(last_part_at, now()) where id = r.id;
    else
      raise exception 'Someone else is already recording this meeting.' using errcode = '22023';
    end if;
  end if;
  v_days := public.meeting_recording_days(m.company_id);
  insert into public.meeting_recordings (id, company_id, meeting_id, started_by, mime, storage_path, language, expires_at)
  values (v_id, m.company_id, p_meeting, auth.uid(), v_mime,
          m.company_id::text || '/' || p_meeting::text || '/' || v_id::text || '/',
          case when p_language in ('sw', 'en', 'mixed') then p_language else 'sw' end,
          case when v_days = 0 then null else now() + make_interval(days => v_days) end);
  return v_id;
end;
$$;

-- A piece was uploaded (the file must be in the recording's folder already).
create or replace function public.meeting_recording_add_part(p_recording uuid, p_seq integer, p_path text, p_bytes integer, p_ms integer)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.meeting_recordings;
begin
  select * into r from public.meeting_recordings where id = p_recording for update;
  if r.id is null or r.started_by is distinct from auth.uid() or not public.meeting_can_manage(r.meeting_id) then
    raise exception 'Recording not found.' using errcode = '42501';
  end if;
  if r.status <> 'recording' or r.deleted_at is not null then
    raise exception 'This recording has stopped.' using errcode = '22023';
  end if;
  if p_seq is null or p_seq not between 0 and 100000 or p_bytes is null or p_bytes not between 1 and 26214400 then
    raise exception 'The piece is not valid.' using errcode = '22023';
  end if;
  if p_path is null or left(p_path, length(r.storage_path)) <> r.storage_path or p_path ~ '\.\.'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'meeting-recordings' and o.name = p_path) then
    raise exception 'The piece was not found in the recording''s folder.' using errcode = '22023';
  end if;
  insert into public.meeting_recording_parts (company_id, recording_id, seq, storage_path, size_bytes, duration_ms)
  values (r.company_id, r.id, p_seq, p_path, p_bytes, least(greatest(coalesce(p_ms, 0), 0), 3600000))
  on conflict (recording_id, seq) do nothing;
  if found then
    update public.meeting_recordings
       set parts = parts + 1, size_bytes = size_bytes + p_bytes, last_part_at = now(),
           duration_seconds = duration_seconds + least(greatest(coalesce(p_ms, 0), 0), 3600000) / 1000
     where id = r.id;
  end if;
end;
$$;

create or replace function public.meeting_recording_stop(p_recording uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.meeting_recordings;
begin
  select * into r from public.meeting_recordings where id = p_recording for update;
  if r.id is null or not public.meeting_can_manage(r.meeting_id) then
    raise exception 'Recording not found.' using errcode = '42501';
  end if;
  update public.meeting_recordings set status = 'done', ended_at = coalesce(ended_at, now()) where id = p_recording and status = 'recording';
end;
$$;

-- Ending (or cancelling) a meeting closes its recording.
create or replace function public.meeting_close_recordings()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status is distinct from old.status and old.status = 'live' then
    update public.meeting_recordings set status = 'done', ended_at = coalesce(ended_at, now())
     where meeting_id = new.id and status = 'recording';
  end if;
  return null;
end;
$$;
drop trigger if exists meetings_close_recordings on public.meetings;
create trigger meetings_close_recordings after update of status on public.meetings
  for each row execute function public.meeting_close_recordings();

-- "Delete now": the recording is marked deleted (it can no longer be played) and its files are returned for the
-- app to remove from storage. The transcript and summary go too.
create or replace function public.meeting_recording_delete(p_recording uuid)
returns text[] language plpgsql security definer set search_path = ''
as $$
declare
  r public.meeting_recordings;
begin
  select * into r from public.meeting_recordings where id = p_recording for update;
  if r.id is null or not public.meeting_can_manage(r.meeting_id) then
    raise exception 'Only the organiser, the chair or management can delete this recording.' using errcode = '42501';
  end if;
  if r.deleted_at is null then
    update public.meeting_recordings
       set deleted_at = now(), deleted_by = auth.uid(), delete_reason = 'manual', status = 'done', ended_at = coalesce(ended_at, now()),
           transcript = '', summary = '', summary_sw = ''
     where id = p_recording;
  end if;
  return coalesce((select array_agg(storage_path order by seq) from public.meeting_recording_parts where recording_id = p_recording), '{}');
end;
$$;

-- After the files were removed: true once no file is left in the folder.
create or replace function public.meeting_recording_purged(p_recording uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  r public.meeting_recordings;
begin
  select * into r from public.meeting_recordings where id = p_recording for update;
  if r.id is null or not public.meeting_can_manage(r.meeting_id) then
    raise exception 'Recording not found.' using errcode = '42501';
  end if;
  if r.deleted_at is null then return false; end if;
  if exists (select 1 from storage.objects o where o.bucket_id = 'meeting-recordings' and left(o.name, length(r.storage_path)) = r.storage_path) then
    return false;
  end if;
  update public.meeting_recordings set purged_at = coalesce(purged_at, now()) where id = p_recording;
  delete from public.meeting_recording_parts where recording_id = p_recording;
  return true;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Expiry (scheduled job, service role only)
-- ---------------------------------------------------------------------
-- Closes recordings nobody has added to for 30 minutes, marks the expired ones deleted (the audio goes; the written
-- transcript and summary stay with the meeting, like the minutes), and returns the files of
-- every deleted recording not yet cleared from storage (expired now, earlier, or "Delete now" whose files stayed).
create or replace function public.meeting_recordings_expire(p_limit integer default 500)
returns table (recording_id uuid, path text)
language plpgsql security definer set search_path = ''
as $$
begin
  update public.meeting_recordings
     set status = 'done', ended_at = coalesce(last_part_at, started_at)
   where status = 'recording' and coalesce(last_part_at, started_at) < now() - interval '30 minutes';
  update public.meeting_recordings
     set deleted_at = now(), delete_reason = 'expired', status = 'done', ended_at = coalesce(ended_at, now())
   where deleted_at is null and expires_at is not null and expires_at <= now();
  return query
    select p.recording_id, p.storage_path
      from public.meeting_recording_parts p
      join public.meeting_recordings r on r.id = p.recording_id
     where r.deleted_at is not null and r.purged_at is null
     order by r.deleted_at, p.seq
     limit least(greatest(coalesce(p_limit, 500), 1), 2000);
end;
$$;

-- After the job removed the files: recordings with no file left are marked cleared.
create or replace function public.meeting_recordings_mark_purged(p_ids uuid[])
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_n integer;
begin
  with done as (
    update public.meeting_recordings r set purged_at = now()
     where r.id = any (coalesce(p_ids, '{}')) and r.deleted_at is not null and r.purged_at is null
       and not exists (select 1 from storage.objects o where o.bucket_id = 'meeting-recordings' and left(o.name, length(r.storage_path)) = r.storage_path)
    returning r.id)
  select count(*) into v_n from done;
  delete from public.meeting_recording_parts p
   where p.recording_id = any (coalesce(p_ids, '{}'))
     and exists (select 1 from public.meeting_recordings r where r.id = p.recording_id and r.purged_at is not null);
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Transcript and summary of a recording (whoever manages the meeting)
-- ---------------------------------------------------------------------
create or replace function public.meeting_recording_state(p_recording uuid, p_what text, p_state text, p_error text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.meeting_recordings;
begin
  select * into r from public.meeting_recordings where id = p_recording for update;
  if r.id is null or not public.meeting_can_manage(r.meeting_id) then
    raise exception 'Recording not found.' using errcode = '42501';
  end if;
  -- An expired recording keeps its transcript, so it can still be summarised.
  if r.deleted_at is not null and (p_what = 'transcript' or r.delete_reason = 'manual') then
    raise exception 'This recording was deleted.' using errcode = '22023';
  end if;
  if p_what not in ('transcript', 'summary') or p_state not in ('writing', 'failed') then
    raise exception 'Unknown state.' using errcode = '22023';
  end if;
  if p_what = 'transcript' then
    update public.meeting_recordings
       set transcript_status = case when p_state = 'failed' and transcript <> '' then 'ready' else p_state end,
           transcript_error = case when p_state = 'failed' then left(coalesce(p_error, 'The recording could not be written down.'), 500) end,
           transcript_requested_at = case when p_state = 'writing' then now() else transcript_requested_at end
     where id = p_recording;
  else
    update public.meeting_recordings
       set summary_status = case when p_state = 'failed' and summary <> '' then 'ready' else p_state end,
           summary_error = case when p_state = 'failed' then left(coalesce(p_error, 'The summary could not be written.'), 500) end
     where id = p_recording;
  end if;
end;
$$;

create or replace function public.meeting_recording_save_transcript(p_recording uuid, p_text text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.meeting_recordings;
begin
  select * into r from public.meeting_recordings where id = p_recording for update;
  if r.id is null or not public.meeting_can_manage(r.meeting_id) then
    raise exception 'Recording not found.' using errcode = '42501';
  end if;
  if r.deleted_at is not null then
    raise exception 'This recording was deleted.' using errcode = '22023';
  end if;
  update public.meeting_recordings
     set transcript = left(coalesce(p_text, ''), 400000), transcript_status = 'ready', transcript_error = null
   where id = p_recording;
end;
$$;

create or replace function public.meeting_recording_save_summary(p_recording uuid, p_summary text, p_summary_sw text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  r public.meeting_recordings;
begin
  select * into r from public.meeting_recordings where id = p_recording for update;
  if r.id is null or not public.meeting_can_manage(r.meeting_id) then
    raise exception 'Recording not found.' using errcode = '42501';
  end if;
  if r.deleted_at is not null and r.delete_reason = 'manual' then
    raise exception 'This recording was deleted.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_summary, ''))) < 2 then
    raise exception 'The summary is empty.' using errcode = '22023';
  end if;
  update public.meeting_recordings
     set summary = left(btrim(p_summary), 20000), summary_sw = left(btrim(coalesce(p_summary_sw, '')), 10000),
         summary_status = 'ready', summary_error = null
   where id = p_recording;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Paragraph minutes: meeting_save_minutes also keeps
--      sections [{title, topic, discussion, decisions}], risks[], next_meeting, summary_sw
--    (everything else as in v1.23).
-- ---------------------------------------------------------------------
create or replace function public.meeting_save_minutes(p_meeting uuid, p jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  m        public.meetings;
  it       jsonb;
  v_ids    uuid[] := '{}';
  v_id     uuid;
  v_n      integer := 0;
  v_by     text := case when p ->> 'by' in ('ai', 'app', 'manual') then p ->> 'by' else 'app' end;
  v_src    text;
  v_own    uuid;
  v_due    date;
  v_kind   text;
  v_body   text;
  v_k      integer;
  v_clean  jsonb;
  v_point  uuid;
  v_cl     uuid;
  v_su     uuid;
  v_from   uuid;
  v_sec    jsonb := '[]';
begin
  select * into m from public.meetings where id = p_meeting for update;
  if m.id is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.status <> 'held' or m.minutes_status = 'approved' then
    raise exception 'The minutes can be written once the meeting has ended, until they are approved.' using errcode = '22023';
  end if;
  if p is null or jsonb_typeof(p) <> 'object' or pg_column_size(p) > 400000 then
    raise exception 'The minutes are not valid.' using errcode = '22023';
  end if;
  v_src := case when v_by = 'ai' then 'ai' when v_by = 'app' then 'app' else 'manual' end;
  delete from public.meeting_proposals where meeting_id = p_meeting and status = 'pending' and source in ('ai', 'app');
  delete from public.meeting_points where meeting_id = p_meeting and not approved and source in ('ai', 'app');

  for it in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'points') = 'array' then p -> 'points' else '[]' end) limit 150 loop
    v_kind := it ->> 'kind';
    v_body := btrim(coalesce(it ->> 'body', ''));
    if v_kind not in ('issue', 'decision', 'action', 'note') or char_length(v_body) not between 2 and 1000 then
      v_ids := v_ids || null::uuid;
      continue;
    end if;
    v_own := case when (it ->> 'owner_id') ~ '^[0-9a-f-]{36}$' and public.is_active_member(m.company_id, (it ->> 'owner_id')::uuid)
                  then (it ->> 'owner_id')::uuid end;
    v_due := case when (it ->> 'due_on') ~ '^\d{4}-\d{2}-\d{2}$' then (it ->> 'due_on')::date end;
    if v_due is not null and (v_due < m.meeting_date - 30 or v_due > m.meeting_date + 730) then v_due := null; end if;
    v_cl := case when (it ->> 'client_id') ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.clients where id = (it ->> 'client_id')::uuid and company_id = m.company_id)
                 then (it ->> 'client_id')::uuid end;
    v_su := case when (it ->> 'supplier_id') ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.suppliers where id = (it ->> 'supplier_id')::uuid and company_id = m.company_id)
                 then (it ->> 'supplier_id')::uuid end;
    v_from := case when (it ->> 'carried_from') ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.meeting_points where id = (it ->> 'carried_from')::uuid and company_id = m.company_id)
                   then (it ->> 'carried_from')::uuid end;
    v_n := v_n + 1;
    insert into public.meeting_points (company_id, meeting_id, kind, body, raised_by, owner_id, owner_name, due_on, severity, topic,
                                       client_id, supplier_id, carried_from, source, sort,
                                       status)
    values (m.company_id, p_meeting, v_kind, left(v_body, 1000), nullif(left(btrim(coalesce(it ->> 'raised_by', '')), 120), ''),
            v_own, nullif(left(btrim(coalesce(it ->> 'owner_name', '')), 120), ''),
            case when v_kind = 'action' or v_kind = 'issue' then v_due end,
            case when it ->> 'severity' in ('low', 'medium', 'high') then it ->> 'severity' end,
            case when it ->> 'topic' = any (public.meeting_topics()) then it ->> 'topic' end,
            coalesce(v_cl, m.client_id), coalesce(v_su, m.supplier_id), v_from, v_src, v_n * 10,
            case when it ->> 'status' = 'done' and v_kind = 'issue' then 'done' else 'open' end)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  v_k := 0;
  for it in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'proposals') = 'array' then p -> 'proposals' else '[]' end) limit 50 loop
    begin
      v_clean := public.meeting_proposal_clean(m.company_id, it ->> 'target', it -> 'payload');
    exception when others then
      continue;  -- a proposal that does not check out is left out; the minutes still save
    end;
    v_point := case when (it ->> 'point') ~ '^\d{1,3}$' and (it ->> 'point')::int < cardinality(v_ids) then v_ids[(it ->> 'point')::int + 1] end;
    insert into public.meeting_proposals (company_id, meeting_id, point_id, target, title, payload, source)
    values (m.company_id, p_meeting, v_point, it ->> 'target',
            left(coalesce(nullif(btrim(coalesce(it ->> 'title', '')), ''), it ->> 'target'), 300), v_clean, v_src);
    v_k := v_k + 1;
  end loop;

  -- One section per agenda item: what was discussed, what was decided and why (plain text, lengths capped).
  for it in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'sections') = 'array' then p -> 'sections' else '[]' end) limit 30 loop
    continue when jsonb_typeof(it) <> 'object' or char_length(btrim(coalesce(it ->> 'title', ''))) < 2;
    v_sec := v_sec || jsonb_build_array(jsonb_build_object(
      'title', left(btrim(it ->> 'title'), 200),
      'topic', case when it ->> 'topic' = any (public.meeting_topics()) then it ->> 'topic' else '' end,
      'discussion', left(coalesce(it ->> 'discussion', ''), 6000),
      'decisions', left(coalesce(it ->> 'decisions', ''), 4000)));
  end loop;

  update public.meetings
     set minutes_status = 'ready', minutes_by = v_by, minutes_error = null,
         minutes_summary = jsonb_build_object(
           'format', 2,
           'summary', left(coalesce(p ->> 'summary', ''), 6000),
           'sections', v_sec,
           'topics', coalesce(case when jsonb_typeof(p -> 'topics') = 'array' then p -> 'topics' end, '[]'),
           'risks', coalesce(case when jsonb_typeof(p -> 'risks') = 'array' then p -> 'risks' end, '[]'),
           'next_meeting', left(coalesce(p ->> 'next_meeting', ''), 3000),
           'summary_sw', left(coalesce(p ->> 'summary_sw', ''), 6000),
           'suggestions', coalesce(case when jsonb_typeof(p -> 'suggestions') = 'array' then p -> 'suggestions' end, '[]'),
           'unclear', coalesce(case when jsonb_typeof(p -> 'unclear') = 'array' then p -> 'unclear' end, '[]'),
           'language_note', left(coalesce(p ->> 'language_note', ''), 300),
           'follow_up', coalesce(case when jsonb_typeof(p -> 'follow_up') = 'array' then p -> 'follow_up' end, '[]'),
           'proposals', v_k)
   where id = p_meeting;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. The guest page: as in v1.23, plus whether the meeting is recorded and is being recorded now.
-- ---------------------------------------------------------------------
create or replace function public.meeting_guest_view(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  g public.meeting_guest_links;
  m public.meetings;
  a public.meeting_attendees;
  c public.companies;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into g from public.meeting_guest_links where token_hash = public.meeting_token_digest(p_token);
  if g.id is null or g.revoked_at is not null or g.expires_at < now() then
    return null;
  end if;
  select * into m from public.meetings where id = g.meeting_id;
  select * into a from public.meeting_attendees where id = g.attendee_id;
  select * into c from public.companies where id = g.company_id;
  if m.id is null or a.id is null or m.status = 'cancelled' then
    return null;
  end if;
  update public.meeting_guest_links set last_used_at = now() where id = g.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return jsonb_build_object('meeting_id', m.id, 'attendee_id', a.id, 'company_id', c.id, 'company', c.name, 'logo_path', c.logo_path,
                            'title', m.title, 'starts_at', m.starts_at, 'minutes', m.minutes, 'status', m.status,
                            'video_provider', m.video_provider, 'video_room', m.video_room, 'video_url', m.video_url,
                            'external_link', m.external_link, 'guest_name', a.guest_name,
                            'record', m.record,
                            'recording', exists (select 1 from public.meeting_recordings r
                                                  where r.meeting_id = m.id and r.status = 'recording' and r.deleted_at is null
                                                    and coalesce(r.last_part_at, r.started_at) > now() - interval '2 minutes'),
                            'can_join', m.status = 'live' or (m.status = 'planned' and now() >= m.starts_at - interval '15 minutes'));
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Who may call the functions
-- ---------------------------------------------------------------------
revoke execute on function
  public.meeting_recording_file_ok(text, text), public.add_meeting_recordings_cleanup(), public.meeting_recording_days(uuid),
  public.meeting_set_recording_days(uuid, integer), public.meeting_recording_start(uuid, text, text),
  public.meeting_recording_add_part(uuid, integer, text, integer, integer), public.meeting_recording_stop(uuid),
  public.meeting_close_recordings(), public.meeting_recording_delete(uuid), public.meeting_recording_purged(uuid),
  public.meeting_recordings_expire(integer), public.meeting_recordings_mark_purged(uuid[]),
  public.meeting_recording_state(uuid, text, text, text), public.meeting_recording_save_transcript(uuid, text),
  public.meeting_recording_save_summary(uuid, text, text), public.meeting_save_minutes(uuid, jsonb), public.meeting_guest_view(text)
from public, anon, authenticated;

grant execute on function
  public.meeting_recording_file_ok(text, text), public.meeting_recording_days(uuid), public.meeting_set_recording_days(uuid, integer),
  public.meeting_recording_start(uuid, text, text), public.meeting_recording_add_part(uuid, integer, text, integer, integer),
  public.meeting_recording_stop(uuid), public.meeting_recording_delete(uuid), public.meeting_recording_purged(uuid),
  public.meeting_recording_state(uuid, text, text, text), public.meeting_recording_save_transcript(uuid, text),
  public.meeting_recording_save_summary(uuid, text, text), public.meeting_save_minutes(uuid, jsonb)
to authenticated;

-- The scheduled cleanup and the public guest page (server side, service role key).
grant execute on function
  public.meeting_recordings_expire(integer), public.meeting_recordings_mark_purged(uuid[]), public.meeting_guest_view(text),
  public.meeting_recording_file_ok(text, text)
to service_role;

notify pgrst, 'reload schema';
