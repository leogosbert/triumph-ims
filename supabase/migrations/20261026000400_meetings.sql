-- =====================================================================
-- Meetings and Calendar.
--
--   meeting_series        regular meetings: how often (daily, weekly, every
--                         two weeks, monthly, once), weekday, chair, presenter
--                         (chosen / fixed / taking turns), topics, audience.
--   meetings              one meeting: time, place, chair, presenter, video
--                         room (Daily.co when DAILY_API_KEY is set, otherwise
--                         a Jitsi room, or the client's own Zoom/Teams/Meet
--                         link), status planned -> live -> held (or
--                         cancelled), minutes ready -> approved.
--   meeting_texts         the live transcript (speech recognition) and the
--                         typed notes, kept apart so the activity log does
--                         not copy them on every line.
--   meeting_attendees     staff (user_id) and guests (client or supplier
--                         contacts with name, email, phone), who joined.
--   meeting_agenda_items  the agenda, by hand or ticked from "Suggest topics".
--   meeting_points        issues, decisions and actions (owner, due date,
--                         status), linked to a client, supplier, quotation or
--                         purchase order. Drafts until the minutes are
--                         approved; approved actions notify their owners.
--   meeting_proposals     changes for other departments the minutes propose
--                         (CRM note, follow-up, opportunity stage, purchase
--                         request, compliance date, corrective action,
--                         calendar entry, next meeting, task). Nothing
--                         changes until a manager approves each one; then it
--                         goes through that module's own function or rules.
--   meeting_invitations   meetings clients or suppliers invite us to: from
--                         the public request page, or pasted by staff.
--   meeting_guest_links   guest links (/meet/<token>): only the SHA-256 of
--                         the token is kept; long, random, expiring.
--   meeting_portal        the company's public request link (/meet/request/<token>).
--   meeting_portal_hits   rate limit of the public request page.
--   calendar_entries      calendar dates added by hand or from approved
--                         proposals (dates found in the meeting notes).
--   calendar_links        each person's private calendar feed (.ics) for
--                         Google Calendar, iPhone or Outlook.
--
-- Who sees what:
--   * Management sees every meeting. Others see meetings open to the whole
--     team and those they attend, chair, present or organised.
--   * Everyone except drivers organises meetings; the organiser, the chair
--     and management change them. Management (or the chair) approves the
--     minutes; only management approves proposed updates and invitations.
--   * Every change goes through a function below; the tables are read-only.
--   * The public pages (guest link, request page, calendar feed) call their
--     functions with the service role key only.
--
-- Clearing test transactions keeps the meetings (they are the company's real
-- minutes); links to deleted quotations or orders are cleared. Closing a
-- company removes everything. The guest links, the request link, the feed
-- links and the rate-limit rows hold secrets and stay out of backups.
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Features
-- ---------------------------------------------------------------------
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('meetings', 'Meetings',
 'Regular team meetings and meetings with clients and suppliers: agenda with suggested topics from your own data, video calls in the app, live notes, AI minutes with issues, decisions and actions, follow-up of last time''s issues, guest links and a request page for clients.',
 'Administration', 'small', 'live', 'Every company that holds team, client or supplier meetings.',
 'Everyone heard, nothing forgotten: every action has an owner and a date, and comes back until it is done.',
 '[{"title": "Plan the meeting", "body": "Open Meetings and press + Meeting, or set a regular meeting. Press Suggest topics: overdue actions, money owed, low stock, late orders and filings due are proposed; tick what goes on the agenda."},
   {"title": "Hold it in the app", "body": "Press Start: everyone invited gets a notification with a Join button. Read the recording notice, then the app writes down what is said while you type notes."},
   {"title": "Approve the minutes", "body": "After the meeting the AI writes the summary, issues, decisions and actions. Check them, set owners and dates, and approve: each owner is told and finds the action under My actions."}]'::jsonb,
 '/meetings', 905),
('calendar', 'Calendar',
 'One calendar for meetings, actions from meetings, deliveries, supplies arriving, quotation and invoice dates, filings and licence expiries, leave and follow-ups, with a private link for Google Calendar, iPhone or Outlook.',
 'Administration', 'small', 'live', 'Everyone who wants to see what is coming up.',
 'No date forgotten: what the business promised and what is due shows in one place and on your phone''s calendar.',
 '[{"title": "See what is coming", "body": "Open Calendar for the month, the week or a simple list. Filter by kind of date."},
   {"title": "Dates from meetings", "body": "Dates said in a meeting (deliver on Friday, tukutane kesho saa 4) are proposed; a manager approves them before they go on the calendar."},
   {"title": "On your phone", "body": "Under Calendar, press Phone calendar to get your private link for Google Calendar, iPhone or Outlook."}]'::jsonb,
 '/calendar', 906)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------
create or replace function public.meeting_organiser_roles()
returns public.app_role[] language sql immutable set search_path = ''
as $$ select array['management', 'sales', 'procurement', 'finance', 'warehouse']::public.app_role[]; $$;

create or replace function public.meeting_topics()
returns text[] language sql immutable set search_path = ''
as $$ select array['Sales & clients', 'Procurement & suppliers', 'Stock', 'Deliveries', 'Money', 'Compliance', 'HSE',
                   'Admin & HR', 'Open floor']; $$;

create or replace function public.meeting_today()
returns date language sql stable set search_path = ''
as $$ select (now() at time zone 'Africa/Dar_es_Salaam')::date; $$;

-- A long random code (two random UUIDs, 64 hex characters).
create or replace function public.meeting_random_code()
returns text language sql volatile set search_path = ''
as $$ select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''); $$;

create or replace function public.meeting_token_digest(p_token text)
returns text language sql immutable set search_path = ''
as $$ select encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex'); $$;

-- An https address without spaces (Zoom, Teams, Google Meet, Jitsi, Daily...).
create or replace function public.meeting_link_ok(p text)
returns boolean language sql immutable set search_path = ''
as $$ select p is null or (p ~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:[0-9]{2,5})?(/[^\s<>"]*)?$' and char_length(p) <= 500); $$;

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
create table if not exists public.meeting_series (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  title           text not null check (char_length(btrim(title)) between 2 and 160),
  purpose         text check (purpose is null or char_length(purpose) <= 1000),
  frequency       text not null default 'weekly' check (frequency in ('daily', 'weekly', 'fortnightly', 'monthly', 'once')),
  weekday         integer check (weekday between 0 and 6),
  month_day       integer check (month_day between 1 and 31),
  start_date      date not null default (now() at time zone 'Africa/Dar_es_Salaam')::date,
  end_date        date,
  start_time      time not null default '09:00',
  minutes         integer not null default 30 check (minutes between 5 and 600),
  place           text check (place is null or char_length(place) <= 200),
  topics          text[] not null default '{}',
  audience        text not null default 'everyone' check (audience in ('everyone', 'roles', 'people')),
  audience_roles  public.app_role[] not null default '{}',
  audience_people uuid[] not null default '{}',
  chair_id        uuid references auth.users (id) on delete set null,
  presenter_mode  text not null default 'chosen' check (presenter_mode in ('chosen', 'fixed', 'rotate')),
  presenter_id    uuid references auth.users (id) on delete set null,
  rotation        uuid[] not null default '{}',
  record          boolean not null default true,
  language        text not null default 'both' check (language in ('both', 'sw', 'en')),
  active          boolean not null default true,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, company_id),
  check (end_date is null or end_date >= start_date)
);
create index if not exists meeting_series_company_idx on public.meeting_series (company_id, active);

create table if not exists public.meetings (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  series_id             uuid,
  title                 text not null check (char_length(btrim(title)) between 2 and 160),
  purpose               text check (purpose is null or char_length(purpose) <= 2000),
  kind                  text not null default 'internal' check (kind in ('internal', 'client', 'supplier', 'external')),
  starts_at             timestamptz not null,
  meeting_date          date not null,
  minutes               integer not null default 30 check (minutes between 5 and 600),
  place                 text check (place is null or char_length(place) <= 200),
  topics                text[] not null default '{}',
  chair_id              uuid references auth.users (id) on delete set null,
  presenter_id          uuid references auth.users (id) on delete set null,
  client_id             uuid,
  supplier_id           uuid,
  open_to_team          boolean not null default false,
  status                text not null default 'planned' check (status in ('planned', 'live', 'held', 'cancelled')),
  cancel_reason         text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  record                boolean not null default true,
  language              text not null default 'both' check (language in ('both', 'sw', 'en')),
  video_provider        text not null default 'jitsi' check (video_provider in ('jitsi', 'daily', 'external', 'none')),
  video_room            text not null default ('LeMoSp-' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
                        check (video_room ~ '^[A-Za-z0-9_-]{16,120}$'),
  video_url             text check (public.meeting_link_ok(video_url)),
  external_link         text check (public.meeting_link_ok(external_link)),
  announced_at          timestamptz,
  started_at            timestamptz,
  ended_at              timestamptz,
  minutes_status        text not null default 'none' check (minutes_status in ('none', 'writing', 'ready', 'failed', 'approved')),
  minutes_summary       jsonb check (minutes_summary is null or (jsonb_typeof(minutes_summary) = 'object' and pg_column_size(minutes_summary) <= 200000)),
  minutes_by            text check (minutes_by is null or minutes_by in ('ai', 'app', 'manual')),
  minutes_error         text check (minutes_error is null or char_length(minutes_error) <= 500),
  minutes_requested_at  timestamptz,
  approved_at           timestamptz,
  approved_by           uuid references auth.users (id) on delete set null,
  invitation_id         uuid,
  created_by            uuid default auth.uid() references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, company_id),
  foreign key (series_id, company_id) references public.meeting_series (id, company_id) on delete set null (series_id),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete set null (client_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id) on delete set null (supplier_id)
);
create index if not exists meetings_company_idx on public.meetings (company_id, starts_at desc);
create index if not exists meetings_status_idx on public.meetings (company_id, status, starts_at);
create unique index if not exists meetings_series_day_key on public.meetings (series_id, meeting_date) where series_id is not null;

create table if not exists public.meeting_texts (
  meeting_id  uuid primary key,
  company_id  uuid not null references public.companies (id) on delete cascade,
  transcript  text not null default '' check (char_length(transcript) <= 400000),
  notes       text not null default '' check (char_length(notes) <= 100000),
  updated_at  timestamptz not null default now(),
  foreign key (meeting_id, company_id) references public.meetings (id, company_id) on delete cascade
);

create table if not exists public.meeting_attendees (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  meeting_id   uuid not null,
  user_id      uuid references auth.users (id) on delete cascade,
  guest_name   text check (guest_name is null or char_length(btrim(guest_name)) between 2 and 120),
  guest_email  text check (guest_email is null or (guest_email ~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' and char_length(guest_email) <= 200)),
  guest_phone  text check (guest_phone is null or guest_phone ~ '^[0-9]{9,15}$'),
  guest_org    text check (guest_org is null or char_length(guest_org) <= 160),
  client_id    uuid,
  supplier_id  uuid,
  role         text not null default 'member' check (role in ('chair', 'presenter', 'member', 'guest')),
  response     text not null default 'pending' check (response in ('pending', 'accepted', 'declined')),
  joined_at    timestamptz,
  present      boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (id, company_id),
  foreign key (meeting_id, company_id) references public.meetings (id, company_id) on delete cascade,
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete set null (client_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id) on delete set null (supplier_id),
  check (num_nonnulls(user_id, guest_name) = 1)
);
create unique index if not exists meeting_attendees_user_key on public.meeting_attendees (meeting_id, user_id) where user_id is not null;
create index if not exists meeting_attendees_meeting_idx on public.meeting_attendees (meeting_id);
create index if not exists meeting_attendees_user_idx on public.meeting_attendees (user_id) where user_id is not null;

create table if not exists public.meeting_agenda_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  meeting_id  uuid not null,
  sort        integer not null default 100,
  topic       text,
  title       text not null check (char_length(btrim(title)) between 2 and 300),
  detail      text check (detail is null or char_length(detail) <= 1000),
  source      text not null default 'manual' check (source in ('manual', 'suggested', 'follow_up')),
  source_ref  text check (source_ref is null or char_length(source_ref) <= 120),
  owner_id    uuid references auth.users (id) on delete set null,
  minutes     integer check (minutes is null or minutes between 1 and 240),
  done        boolean not null default false,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  foreign key (meeting_id, company_id) references public.meetings (id, company_id) on delete cascade
);
create index if not exists meeting_agenda_meeting_idx on public.meeting_agenda_items (meeting_id, sort);

create table if not exists public.meeting_points (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  meeting_id         uuid not null,
  kind               text not null check (kind in ('issue', 'decision', 'action', 'note')),
  body               text not null check (char_length(btrim(body)) between 2 and 1000),
  raised_by          text check (raised_by is null or char_length(raised_by) <= 120),
  owner_id           uuid references auth.users (id) on delete set null,
  owner_name         text check (owner_name is null or char_length(owner_name) <= 120),
  due_on             date,
  status             text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  severity           text check (severity is null or severity in ('low', 'medium', 'high')),
  topic              text,
  client_id          uuid,
  supplier_id        uuid,
  quotation_id       uuid,
  purchase_order_id  uuid,
  carried_from       uuid references public.meeting_points (id) on delete set null,
  approved           boolean not null default false,
  source             text not null default 'manual' check (source in ('ai', 'app', 'manual', 'proposal')),
  sort               integer not null default 100,
  done_note          text check (done_note is null or char_length(done_note) <= 1000),
  done_at            timestamptz,
  done_by            uuid references auth.users (id) on delete set null,
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, company_id),
  foreign key (meeting_id, company_id) references public.meetings (id, company_id) on delete cascade,
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete set null (client_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id) on delete set null (supplier_id),
  foreign key (quotation_id, company_id) references public.quotations (id, company_id) on delete set null (quotation_id),
  foreign key (purchase_order_id, company_id) references public.purchase_orders (id, company_id) on delete set null (purchase_order_id)
);
create index if not exists meeting_points_meeting_idx on public.meeting_points (meeting_id, sort);
create index if not exists meeting_points_owner_idx on public.meeting_points (owner_id, status) where owner_id is not null;
create index if not exists meeting_points_open_idx on public.meeting_points (company_id, status, due_on) where approved;

create table if not exists public.meeting_proposals (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  meeting_id   uuid not null,
  point_id     uuid,
  target       text not null check (target in ('crm_note', 'followup', 'opportunity_stage', 'requisition', 'compliance_date',
                                                'corrective_action', 'calendar_entry', 'next_meeting', 'task')),
  title        text not null check (char_length(btrim(title)) between 2 and 300),
  payload      jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 20000),
  status       text not null default 'pending' check (status in ('pending', 'applied', 'rejected')),
  source       text not null default 'manual' check (source in ('ai', 'app', 'manual')),
  decision_note text check (decision_note is null or char_length(decision_note) <= 500),
  applied_ref  text check (applied_ref is null or char_length(applied_ref) <= 120),
  decided_by   uuid references auth.users (id) on delete set null,
  decided_at   timestamptz,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  foreign key (meeting_id, company_id) references public.meetings (id, company_id) on delete cascade,
  foreign key (point_id, company_id) references public.meeting_points (id, company_id) on delete set null (point_id)
);
create index if not exists meeting_proposals_meeting_idx on public.meeting_proposals (meeting_id);
create index if not exists meeting_proposals_pending_idx on public.meeting_proposals (company_id, status, created_at);

create table if not exists public.meeting_invitations (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  source             text not null check (source in ('portal', 'pasted')),
  requester_name     text not null check (char_length(btrim(requester_name)) between 2 and 120),
  requester_company  text check (requester_company is null or char_length(requester_company) <= 160),
  requester_email    text check (requester_email is null or (requester_email ~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' and char_length(requester_email) <= 200)),
  requester_phone    text check (requester_phone is null or requester_phone ~ '^[0-9]{9,15}$'),
  topic              text not null check (char_length(btrim(topic)) between 3 and 200),
  message            text check (message is null or char_length(message) <= 2000),
  proposed_at        timestamptz not null,
  minutes            integer not null default 30 check (minutes between 5 and 600),
  external_link      text check (public.meeting_link_ok(external_link)),
  client_id          uuid,
  supplier_id        uuid,
  status             text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  reply              text check (reply is null or char_length(reply) <= 2000),
  meeting_id         uuid,
  decided_by         uuid references auth.users (id) on delete set null,
  decided_at         timestamptz,
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, company_id),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete set null (client_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id) on delete set null (supplier_id),
  foreign key (meeting_id, company_id) references public.meetings (id, company_id) on delete set null (meeting_id)
);
create index if not exists meeting_invitations_company_idx on public.meeting_invitations (company_id, status, proposed_at);

-- Secrets (left out of backups because of the column names).
create table if not exists public.meeting_guest_links (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  meeting_id   uuid not null,
  attendee_id  uuid not null,
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz,
  uses         integer not null default 0,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (meeting_id, company_id) references public.meetings (id, company_id) on delete cascade,
  foreign key (attendee_id, company_id) references public.meeting_attendees (id, company_id) on delete cascade
);
create index if not exists meeting_guest_links_attendee_idx on public.meeting_guest_links (attendee_id);

create table if not exists public.meeting_portal (
  company_id     uuid primary key references public.companies (id) on delete cascade,
  request_token  text not null unique check (request_token ~ '^[0-9a-f]{40,64}$'),
  enabled        boolean not null default true,
  welcome        text check (welcome is null or char_length(welcome) <= 500),
  updated_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.meeting_portal_hits (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  sender_hash  text not null check (char_length(sender_hash) between 16 and 128),
  created_at   timestamptz not null default now()
);
create index if not exists meeting_portal_hits_idx on public.meeting_portal_hits (company_id, created_at);

create table if not exists public.calendar_entries (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  title        text not null check (char_length(btrim(title)) between 2 and 200),
  kind         text not null default 'other' check (kind in ('meeting', 'delivery', 'follow_up', 'event', 'payment', 'supplies', 'task', 'other')),
  starts_on    date not null,
  ends_on      date,
  at_time      time,
  notes        text check (notes is null or char_length(notes) <= 1000),
  owner_id     uuid references auth.users (id) on delete set null,
  client_id    uuid,
  supplier_id  uuid,
  meeting_id   uuid,
  proposal_id  uuid references public.meeting_proposals (id) on delete set null,
  private      boolean not null default false,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on),
  foreign key (client_id, company_id) references public.clients (id, company_id) on delete set null (client_id),
  foreign key (supplier_id, company_id) references public.suppliers (id, company_id) on delete set null (supplier_id),
  foreign key (meeting_id, company_id) references public.meetings (id, company_id) on delete set null (meeting_id)
);
create index if not exists calendar_entries_company_idx on public.calendar_entries (company_id, starts_on);

create table if not exists public.calendar_links (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  feed_token    text not null unique check (feed_token ~ '^[0-9a-f]{64}$'),
  kinds         text[] not null default array['meeting', 'action', 'entry', 'delivery', 'supplies', 'quotation', 'invoice',
                                                'compliance', 'leave', 'follow_up'],
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists calendar_links_active_key on public.calendar_links (company_id, user_id) where revoked_at is null;

-- ---------------------------------------------------------------------
-- 3. Who may see and change a meeting
-- ---------------------------------------------------------------------
create or replace function public.meeting_visible(p_company uuid, p_meeting uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_manager(p_company)
      or (public.is_member(p_company) and exists (
            select 1 from public.meetings m
             where m.id = p_meeting and m.company_id = p_company
               and (m.open_to_team or m.created_by = auth.uid() or m.chair_id = auth.uid() or m.presenter_id = auth.uid()
                    or exists (select 1 from public.meeting_attendees a where a.meeting_id = m.id and a.user_id = auth.uid()))));
$$;

-- The organiser, the chair and management.
create or replace function public.meeting_can_manage(p_meeting uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.meetings m
                  where m.id = p_meeting
                    and (public.is_manager(m.company_id)
                         or (public.has_role(m.company_id, public.meeting_organiser_roles())
                             and (m.created_by = auth.uid() or m.chair_id = auth.uid()))));
$$;

-- Management or the chair approves the minutes.
create or replace function public.meeting_can_approve(p_meeting uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.meetings m
                  where m.id = p_meeting
                    and (public.is_manager(m.company_id)
                         or (m.chair_id = auth.uid() and public.has_role(m.company_id, public.meeting_organiser_roles()))));
$$;

-- Notes and live lines: whoever manages it, and the staff who attend.
create or replace function public.meeting_can_note(p_meeting uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.meeting_can_manage(p_meeting)
      or exists (select 1 from public.meetings m join public.meeting_attendees a on a.meeting_id = m.id
                  where m.id = p_meeting and a.user_id = auth.uid() and public.is_member(m.company_id));
$$;

-- ---------------------------------------------------------------------
-- 4. Triggers on the rows
-- ---------------------------------------------------------------------
create or replace function public.prepare_meeting_row()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_table_name = 'meetings' then
    new.title := btrim(new.title);
    new.meeting_date := (new.starts_at at time zone 'Africa/Dar_es_Salaam')::date;
  elsif tg_table_name = 'meeting_series' then
    new.title := btrim(new.title);
  elsif tg_table_name = 'meeting_points' then
    new.body := btrim(new.body);
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['meetings', 'meeting_series', 'meeting_points'] loop
    execute format('drop trigger if exists %I_prepare on public.%I', t, t);
    execute format('create trigger %I_prepare before insert or update on public.%I for each row execute function public.prepare_meeting_row()', t, t);
  end loop;
  foreach t in array array['meeting_series', 'meetings', 'meeting_points', 'meeting_proposals', 'meeting_invitations',
                           'meeting_portal', 'calendar_entries'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['meeting_series', 'meetings', 'meeting_texts', 'meeting_attendees', 'meeting_agenda_items', 'meeting_points',
                           'meeting_proposals', 'meeting_invitations', 'meeting_guest_links', 'meeting_portal', 'meeting_portal_hits',
                           'calendar_entries', 'calendar_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
  foreach t in array array['meeting_series', 'meetings', 'meeting_texts', 'meeting_attendees', 'meeting_agenda_items', 'meeting_points',
                           'meeting_proposals', 'meeting_invitations', 'meeting_guest_links', 'calendar_entries', 'calendar_links'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
  end loop;
  -- The activity log (not the transcript, the rate-limit rows or the secret links).
  foreach t in array array['meeting_series', 'meetings', 'meeting_attendees', 'meeting_agenda_items', 'meeting_points', 'meeting_proposals',
                           'meeting_invitations', 'calendar_entries'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Row-level security: read only; every change is a function.
-- ---------------------------------------------------------------------
grant select on public.meeting_series, public.meetings, public.meeting_texts, public.meeting_attendees, public.meeting_agenda_items,
                public.meeting_points, public.meeting_proposals, public.meeting_invitations, public.calendar_entries
  to authenticated;
grant select (id, company_id, user_id, kinds, revoked_at, last_used_at, created_at) on public.calendar_links to authenticated;

drop policy if exists meeting_series_select on public.meeting_series;
create policy meeting_series_select on public.meeting_series for select to authenticated using (public.is_member(company_id));
drop policy if exists meetings_select on public.meetings;
create policy meetings_select on public.meetings for select to authenticated using (public.meeting_visible(company_id, id));
drop policy if exists meeting_texts_select on public.meeting_texts;
create policy meeting_texts_select on public.meeting_texts for select to authenticated using (public.meeting_visible(company_id, meeting_id));
drop policy if exists meeting_attendees_select on public.meeting_attendees;
create policy meeting_attendees_select on public.meeting_attendees for select to authenticated using (public.meeting_visible(company_id, meeting_id));
drop policy if exists meeting_agenda_items_select on public.meeting_agenda_items;
create policy meeting_agenda_items_select on public.meeting_agenda_items for select to authenticated using (public.meeting_visible(company_id, meeting_id));
drop policy if exists meeting_points_select on public.meeting_points;
create policy meeting_points_select on public.meeting_points for select to authenticated
  using (public.meeting_visible(company_id, meeting_id) or (approved and owner_id = auth.uid() and public.is_member(company_id)));
drop policy if exists meeting_proposals_select on public.meeting_proposals;
create policy meeting_proposals_select on public.meeting_proposals for select to authenticated
  using (public.is_manager(company_id) or (public.meeting_visible(company_id, meeting_id) and public.meeting_can_manage(meeting_id)));
drop policy if exists meeting_invitations_select on public.meeting_invitations;
create policy meeting_invitations_select on public.meeting_invitations for select to authenticated
  using (public.is_manager(company_id) or (created_by = auth.uid() and public.has_role(company_id, public.meeting_organiser_roles())));
drop policy if exists calendar_entries_select on public.calendar_entries;
create policy calendar_entries_select on public.calendar_entries for select to authenticated
  using (public.is_member(company_id) and (not private or owner_id = auth.uid() or created_by = auth.uid() or public.is_manager(company_id)));
drop policy if exists calendar_links_select on public.calendar_links;
create policy calendar_links_select on public.calendar_links for select to authenticated
  using (user_id = auth.uid() and public.is_member(company_id));

-- ---------------------------------------------------------------------
-- 6. Creating meetings
-- ---------------------------------------------------------------------
-- Internal: one meeting with its staff attendees. p keys: title, purpose, kind, starts_at, minutes, place, topics,
-- chair_id, presenter_id, client_id, supplier_id, open_to_team, record, language, external_link, attendees (uuid array).
create or replace function public.meeting_insert(p_company uuid, p jsonb, p_series uuid, p_actor uuid)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id      uuid;
  v_title   text := btrim(coalesce(p ->> 'title', ''));
  v_kind    text := coalesce(nullif(p ->> 'kind', ''), 'internal');
  v_at      timestamptz;
  v_min     integer := coalesce(nullif(p ->> 'minutes', '')::integer, 30);
  v_topics  text[];
  v_chair   uuid := nullif(p ->> 'chair_id', '')::uuid;
  v_pres    uuid := nullif(p ->> 'presenter_id', '')::uuid;
  v_client  uuid := nullif(p ->> 'client_id', '')::uuid;
  v_supp    uuid := nullif(p ->> 'supplier_id', '')::uuid;
  v_link    text := nullif(btrim(coalesce(p ->> 'external_link', '')), '');
  v_lang    text := coalesce(nullif(p ->> 'language', ''), 'both');
  v_people  uuid[];
  u         uuid;
begin
  if char_length(v_title) not between 2 and 160 then
    raise exception 'Give the meeting a title (2 to 160 letters).' using errcode = '22023';
  end if;
  if v_kind not in ('internal', 'client', 'supplier', 'external') then
    raise exception 'Unknown kind of meeting.' using errcode = '22023';
  end if;
  begin
    v_at := (p ->> 'starts_at')::timestamptz;
  exception when others then
    v_at := null;
  end;
  if v_at is null then
    raise exception 'Choose the date and time of the meeting.' using errcode = '22023';
  end if;
  if v_at < now() - interval '60 days' or v_at > now() + interval '2 years' then
    raise exception 'The meeting date must be within two years.' using errcode = '22023';
  end if;
  if v_min not between 5 and 600 then
    raise exception 'A meeting lasts from 5 to 600 minutes.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct t), '{}') into v_topics
    from jsonb_array_elements_text(case when jsonb_typeof(p -> 'topics') = 'array' then p -> 'topics' else '[]' end) t;
  if not (v_topics <@ public.meeting_topics()) then
    raise exception 'Unknown topic.' using errcode = '22023';
  end if;
  if v_lang not in ('both', 'sw', 'en') then v_lang := 'both'; end if;
  if v_chair is not null and not public.is_active_member(p_company, v_chair) then
    raise exception 'The chair must be an active team member.' using errcode = '22023';
  end if;
  if v_pres is not null and not public.is_active_member(p_company, v_pres) then
    raise exception 'The presenter must be an active team member.' using errcode = '22023';
  end if;
  if v_client is not null and not exists (select 1 from public.clients where id = v_client and company_id = p_company) then
    raise exception 'Client not found.' using errcode = '22023';
  end if;
  if v_supp is not null and not exists (select 1 from public.suppliers where id = v_supp and company_id = p_company) then
    raise exception 'Supplier not found.' using errcode = '22023';
  end if;
  if not public.meeting_link_ok(v_link) then
    raise exception 'The meeting link must be a full https:// address (Zoom, Teams, Google Meet...).' using errcode = '22023';
  end if;

  insert into public.meetings (company_id, series_id, title, purpose, kind, starts_at, meeting_date, minutes, place, topics, chair_id,
                               presenter_id, client_id, supplier_id, open_to_team, record, language, external_link, video_provider,
                               created_by)
  values (p_company, p_series, v_title, nullif(left(btrim(coalesce(p ->> 'purpose', '')), 2000), ''), v_kind, v_at,
          (v_at at time zone 'Africa/Dar_es_Salaam')::date, v_min, nullif(left(btrim(coalesce(p ->> 'place', '')), 200), ''),
          v_topics, v_chair, v_pres, v_client, v_supp,
          coalesce((p ->> 'open_to_team')::boolean, v_kind = 'internal'), coalesce((p ->> 'record')::boolean, true), v_lang,
          v_link, case when v_link is not null then 'external' else 'jitsi' end, p_actor)
  returning id into v_id;
  insert into public.meeting_texts (meeting_id, company_id) values (v_id, p_company);

  select coalesce(array_agg(distinct x::uuid), '{}') into v_people
    from jsonb_array_elements_text(case when jsonb_typeof(p -> 'attendees') = 'array' then p -> 'attendees' else '[]' end) x
   where x ~ '^[0-9a-f-]{36}$';
  v_people := v_people || array_remove(array[v_chair, v_pres, p_actor], null);
  foreach u in array v_people loop
    continue when not public.is_active_member(p_company, u);
    insert into public.meeting_attendees (company_id, meeting_id, user_id, role, response)
    values (p_company, v_id, u, case when u = v_chair then 'chair' when u = v_pres then 'presenter' else 'member' end,
            case when u = p_actor then 'accepted' else 'pending' end)
    on conflict (meeting_id, user_id) where user_id is not null do nothing;
  end loop;
  return v_id;
end;
$$;

create or replace function public.meeting_create(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  r    record;
  m    public.meetings;
begin
  if not public.has_role(p_company, public.meeting_organiser_roles()) then
    raise exception 'You cannot organise meetings.' using errcode = '42501';
  end if;
  v_id := public.meeting_insert(p_company, p, null, auth.uid());
  select * into m from public.meetings where id = v_id;
  for r in select user_id from public.meeting_attendees where meeting_id = v_id and user_id is not null and user_id <> auth.uid() loop
    perform public.notify(p_company, r.user_id, 'meeting_invited', 'attention', 'Meeting: ' || m.title,
      to_char(m.starts_at at time zone 'Africa/Dar_es_Salaam', 'Dy DD Mon HH24:MI') || coalesce(' · ' || m.place, ''),
      '/meetings/' || v_id, 'meeting-inv:' || v_id || ':' || r.user_id);
  end loop;
  return v_id;
end;
$$;

-- Edit while planned. Keys as meeting_insert (attendees: replaces the staff list; guests stay).
create or replace function public.meeting_update(p_meeting uuid, p jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m        public.meetings;
  v_tmp    uuid;
  v_new    public.meetings;
  v_people uuid[];
  u        uuid;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if m.id is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.status not in ('planned', 'live') then
    raise exception 'Only a planned meeting can be changed.' using errcode = '22023';
  end if;
  -- Check every value the same way as a new meeting (in a throwaway row, left out of the activity log).
  perform set_config('ims.quiet_audit', 'on', true);
  v_tmp := public.meeting_insert(m.company_id,
             jsonb_build_object('title', m.title, 'kind', m.kind, 'starts_at', m.starts_at, 'minutes', m.minutes, 'place', m.place,
                                'topics', to_jsonb(m.topics), 'chair_id', m.chair_id, 'presenter_id', m.presenter_id,
                                'client_id', m.client_id, 'supplier_id', m.supplier_id, 'open_to_team', m.open_to_team,
                                'record', m.record, 'language', m.language, 'external_link', m.external_link, 'purpose', m.purpose)
             || (p - 'attendees'), null, m.created_by);
  select * into v_new from public.meetings where id = v_tmp;
  delete from public.meetings where id = v_tmp;
  perform set_config('ims.quiet_audit', 'off', true);
  update public.meetings
     set title = v_new.title, purpose = v_new.purpose, kind = v_new.kind, starts_at = v_new.starts_at, minutes = v_new.minutes,
         place = v_new.place, topics = v_new.topics, chair_id = v_new.chair_id, presenter_id = v_new.presenter_id,
         client_id = v_new.client_id, supplier_id = v_new.supplier_id, open_to_team = v_new.open_to_team, record = v_new.record,
         language = v_new.language, external_link = v_new.external_link,
         video_provider = case when v_new.external_link is not null then 'external'
                               when m.video_provider = 'external' then 'jitsi' else m.video_provider end
   where id = p_meeting;
  if jsonb_typeof(p -> 'attendees') = 'array' then
    select coalesce(array_agg(distinct x::uuid), '{}') into v_people
      from jsonb_array_elements_text(p -> 'attendees') x where x ~ '^[0-9a-f-]{36}$';
    v_people := v_people || array_remove(array[v_new.chair_id, v_new.presenter_id], null);
    delete from public.meeting_attendees
     where meeting_id = p_meeting and user_id is not null and not (user_id = any (v_people)) and joined_at is null;
    foreach u in array v_people loop
      continue when not public.is_active_member(m.company_id, u);
      insert into public.meeting_attendees (company_id, meeting_id, user_id, role)
      values (m.company_id, p_meeting, u, 'member')
      on conflict (meeting_id, user_id) where user_id is not null do nothing;
    end loop;
  end if;
  update public.meeting_attendees
     set role = case when user_id = v_new.chair_id then 'chair' when user_id = v_new.presenter_id then 'presenter' else 'member' end
   where meeting_id = p_meeting and user_id is not null;
end;
$$;

create or replace function public.meeting_cancel(p_meeting uuid, p_reason text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings;
  r record;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if m.id is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.status <> 'planned' then
    raise exception 'Only a planned meeting can be cancelled.' using errcode = '22023';
  end if;
  update public.meetings set status = 'cancelled', cancel_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), '') where id = p_meeting;
  update public.meeting_guest_links set revoked_at = now() where meeting_id = p_meeting and revoked_at is null;
  for r in select user_id from public.meeting_attendees where meeting_id = p_meeting and user_id is not null and user_id <> auth.uid() loop
    perform public.notify(m.company_id, r.user_id, 'meeting_cancelled', 'attention', 'Meeting cancelled: ' || m.title,
      coalesce(nullif(btrim(coalesce(p_reason, '')), ''), to_char(m.starts_at at time zone 'Africa/Dar_es_Salaam', 'Dy DD Mon HH24:MI')),
      '/meetings/' || p_meeting, 'meeting-cancel:' || p_meeting || ':' || r.user_id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Regular meetings
-- ---------------------------------------------------------------------
-- p keys: title, purpose, frequency, weekday, month_day, start_date, end_date, start_time, minutes, place, topics,
-- audience, audience_roles, audience_people, chair_id, presenter_mode, presenter_id, rotation, record, language, active.
create or replace function public.meeting_save_series(p_company uuid, p_series uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id     uuid := p_series;
  v_freq   text := coalesce(nullif(p ->> 'frequency', ''), 'weekly');
  v_aud    text := coalesce(nullif(p ->> 'audience', ''), 'everyone');
  v_mode   text := coalesce(nullif(p ->> 'presenter_mode', ''), 'chosen');
  v_topics text[];
  v_roles  public.app_role[];
  v_people uuid[];
  v_rot    uuid[];
  v_chair  uuid := nullif(p ->> 'chair_id', '')::uuid;
  v_pres   uuid := nullif(p ->> 'presenter_id', '')::uuid;
  v_title  text := btrim(coalesce(p ->> 'title', ''));
  v_start  date := coalesce(nullif(p ->> 'start_date', '')::date, public.meeting_today());
  v_end    date := nullif(p ->> 'end_date', '')::date;
  v_wd     integer := nullif(p ->> 'weekday', '')::integer;
  v_md     integer := nullif(p ->> 'month_day', '')::integer;
  u        uuid;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can set regular meetings.' using errcode = '42501';
  end if;
  if p_series is not null and not exists (select 1 from public.meeting_series where id = p_series and company_id = p_company) then
    raise exception 'Regular meeting not found.' using errcode = '42501';
  end if;
  if char_length(v_title) not between 2 and 160 then
    raise exception 'Give the meeting a title (2 to 160 letters).' using errcode = '22023';
  end if;
  if v_freq not in ('daily', 'weekly', 'fortnightly', 'monthly', 'once') then
    raise exception 'Choose how often the meeting happens.' using errcode = '22023';
  end if;
  if v_freq in ('weekly', 'fortnightly') and (v_wd is null or v_wd not between 0 and 6) then
    raise exception 'Choose the day of the week.' using errcode = '22023';
  end if;
  if v_freq = 'monthly' and (v_md is null or v_md not between 1 and 31) then
    raise exception 'Choose the day of the month (1 to 31).' using errcode = '22023';
  end if;
  if v_aud not in ('everyone', 'roles', 'people') or v_mode not in ('chosen', 'fixed', 'rotate') then
    raise exception 'Unknown choice.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct t), '{}') into v_topics
    from jsonb_array_elements_text(case when jsonb_typeof(p -> 'topics') = 'array' then p -> 'topics' else '[]' end) t;
  if not (v_topics <@ public.meeting_topics()) then
    raise exception 'Unknown topic.' using errcode = '22023';
  end if;
  begin
    select coalesce(array_agg(distinct t::public.app_role), '{}') into v_roles
      from jsonb_array_elements_text(case when jsonb_typeof(p -> 'audience_roles') = 'array' then p -> 'audience_roles' else '[]' end) t;
  exception when others then
    raise exception 'Unknown role.' using errcode = '22023';
  end;
  select coalesce(array_agg(x::uuid), '{}') into v_people
    from (select distinct x from jsonb_array_elements_text(case when jsonb_typeof(p -> 'audience_people') = 'array' then p -> 'audience_people' else '[]' end) x
           where x ~ '^[0-9a-f-]{36}$') y;
  select coalesce(array_agg(x::uuid order by n), '{}') into v_rot
    from jsonb_array_elements_text(case when jsonb_typeof(p -> 'rotation') = 'array' then p -> 'rotation' else '[]' end) with ordinality r(x, n)
   where x ~ '^[0-9a-f-]{36}$';
  foreach u in array v_people || v_rot || array_remove(array[v_chair, v_pres], null) loop
    if not public.is_active_member(p_company, u) then
      raise exception 'Only active team members can be chosen.' using errcode = '22023';
    end if;
  end loop;
  if v_aud = 'roles' and cardinality(v_roles) = 0 then
    raise exception 'Choose at least one role.' using errcode = '22023';
  end if;
  if v_aud = 'people' and cardinality(v_people) = 0 then
    raise exception 'Choose at least one person.' using errcode = '22023';
  end if;
  if v_mode = 'fixed' and v_pres is null then
    raise exception 'Choose the presenter.' using errcode = '22023';
  end if;
  if v_mode = 'rotate' and cardinality(v_rot) < 2 then
    raise exception 'Choose at least two people to take turns.' using errcode = '22023';
  end if;
  if v_end is not null and v_end < v_start then
    raise exception 'The end date must be after the start date.' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.meeting_series (company_id, title) values (p_company, v_title) returning id into v_id;
  end if;
  update public.meeting_series
     set title = v_title, purpose = nullif(left(btrim(coalesce(p ->> 'purpose', '')), 1000), ''), frequency = v_freq,
         weekday = case when v_freq in ('weekly', 'fortnightly') then v_wd end,
         month_day = case when v_freq = 'monthly' then v_md end,
         start_date = v_start, end_date = v_end,
         start_time = coalesce(nullif(p ->> 'start_time', '')::time, '09:00'),
         minutes = coalesce(nullif(p ->> 'minutes', '')::integer, 30),
         place = nullif(left(btrim(coalesce(p ->> 'place', '')), 200), ''),
         topics = v_topics, audience = v_aud,
         audience_roles = case when v_aud = 'roles' then v_roles else '{}' end,
         audience_people = case when v_aud = 'people' then v_people else '{}' end,
         chair_id = v_chair, presenter_mode = v_mode,
         presenter_id = case when v_mode = 'fixed' then v_pres end,
         rotation = case when v_mode = 'rotate' then v_rot else '{}' end,
         record = coalesce((p ->> 'record')::boolean, true),
         language = case when p ->> 'language' in ('both', 'sw', 'en') then p ->> 'language' else 'both' end,
         active = coalesce((p ->> 'active')::boolean, true)
   where id = v_id;
  return v_id;
end;
$$;

create or replace function public.meeting_series_occurs(s public.meeting_series, d date)
returns boolean language sql immutable set search_path = ''
as $$
  select s.active and d >= s.start_date and (s.end_date is null or d <= s.end_date)
     and case s.frequency
           when 'daily' then extract(isodow from d) between 1 and 6
           when 'weekly' then extract(dow from d)::int = s.weekday
           when 'fortnightly' then extract(dow from d)::int = s.weekday and mod((d - s.start_date) / 7, 2) = 0
           when 'monthly' then extract(day from d)::int
                               = least(s.month_day, extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int)
           when 'once' then d = s.start_date
           else false end;
$$;

-- Makes the planned meetings of the next p_days days from the active regular meetings (once per day and series;
-- a meeting cancelled or moved is not made again). Anyone in the company may call it; it is harmless.
create or replace function public.meeting_schedule_series(p_company uuid, p_days integer default 14)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  s       public.meeting_series;
  d       date;
  v_today date := public.meeting_today();
  v_n     integer := 0;
  v_id    uuid;
  v_pres  uuid;
  v_last  uuid;
  v_k     integer;
  v_people uuid[];
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  for s in select * from public.meeting_series where company_id = p_company and active loop
    for d in select g::date from generate_series(v_today, v_today + least(greatest(coalesce(p_days, 14), 0), 60), interval '1 day') g loop
      continue when not public.meeting_series_occurs(s, d);
      continue when exists (select 1 from public.meetings where series_id = s.id and meeting_date = d);
      v_pres := null;
      if s.presenter_mode = 'fixed' then
        v_pres := s.presenter_id;
      elsif s.presenter_mode = 'rotate' and cardinality(s.rotation) > 0 then
        select presenter_id into v_last from public.meetings
         where series_id = s.id and presenter_id is not null order by meeting_date desc limit 1;
        v_k := coalesce(array_position(s.rotation, v_last), 0);
        v_pres := s.rotation[(v_k % cardinality(s.rotation)) + 1];
      end if;
      select coalesce(array_agg(m.user_id), '{}') into v_people
        from public.memberships m
       where m.company_id = p_company and m.active
         and (s.audience = 'everyone' or (s.audience = 'roles' and m.role = any (s.audience_roles))
              or (s.audience = 'people' and m.user_id = any (s.audience_people)));
      begin
        v_id := public.meeting_insert(p_company,
          jsonb_build_object('title', s.title, 'purpose', s.purpose, 'kind', 'internal',
                             'starts_at', ((d + s.start_time) at time zone 'Africa/Dar_es_Salaam'),
                             'minutes', s.minutes, 'place', s.place, 'topics', to_jsonb(s.topics), 'chair_id', s.chair_id,
                             'presenter_id', v_pres, 'open_to_team', s.audience = 'everyone', 'record', s.record,
                             'language', s.language, 'attendees', to_jsonb(v_people)),
          s.id, s.created_by);
        v_n := v_n + 1;
      exception when unique_violation then
        null;  -- made at the same moment on another device
      end;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 8. Attendees, guests and guest links
-- ---------------------------------------------------------------------
-- p keys: name, email, phone, org, client_id, supplier_id. Returns the attendee id.
create or replace function public.meeting_add_guest(p_meeting uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  m       public.meetings;
  v_email text := public.inbox_email_of(nullif(btrim(coalesce(p ->> 'email', '')), ''));
  v_phone text := public.inbox_phone_of(nullif(btrim(coalesce(p ->> 'phone', '')), ''));
  v_name  text := btrim(coalesce(p ->> 'name', ''));
  v_cl    uuid := nullif(p ->> 'client_id', '')::uuid;
  v_su    uuid := nullif(p ->> 'supplier_id', '')::uuid;
  v_id    uuid;
begin
  select * into m from public.meetings where id = p_meeting;
  if m.id is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.status not in ('planned', 'live') then
    raise exception 'Guests can be added to a planned meeting only.' using errcode = '22023';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'Enter the guest''s name.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p ->> 'email', '')), '') is not null and v_email is null then
    raise exception 'Enter a valid email address.' using errcode = '22023';
  end if;
  if v_phone is not null and length(v_phone) not between 9 and 15 then
    raise exception 'Enter a valid phone number.' using errcode = '22023';
  end if;
  if v_cl is not null and not exists (select 1 from public.clients where id = v_cl and company_id = m.company_id) then
    raise exception 'Client not found.' using errcode = '22023';
  end if;
  if v_su is not null and not exists (select 1 from public.suppliers where id = v_su and company_id = m.company_id) then
    raise exception 'Supplier not found.' using errcode = '22023';
  end if;
  if (select count(*) from public.meeting_attendees where meeting_id = p_meeting and user_id is null) >= 50 then
    raise exception 'A meeting can have up to 50 guests.' using errcode = '22023';
  end if;
  insert into public.meeting_attendees (company_id, meeting_id, guest_name, guest_email, guest_phone, guest_org, client_id, supplier_id, role)
  values (m.company_id, p_meeting, v_name, v_email, v_phone, nullif(left(btrim(coalesce(p ->> 'org', '')), 160), ''),
          coalesce(v_cl, m.client_id), coalesce(v_su, m.supplier_id), 'guest')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.meeting_remove_attendee(p_attendee uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.meeting_attendees;
begin
  select * into a from public.meeting_attendees where id = p_attendee;
  if a.id is null or not public.meeting_can_manage(a.meeting_id) then
    raise exception 'Attendee not found.' using errcode = '42501';
  end if;
  if a.joined_at is not null then
    raise exception 'This person already joined; they stay on the list.' using errcode = '22023';
  end if;
  delete from public.meeting_attendees where id = p_attendee;
end;
$$;

-- A new guest link for one guest (older ones are switched off). Returns the token once; only its SHA-256 is kept.
create or replace function public.meeting_guest_link(p_attendee uuid, p_days integer default 14)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  a       public.meeting_attendees;
  m       public.meetings;
  v_token text := public.meeting_random_code();
begin
  select * into a from public.meeting_attendees where id = p_attendee;
  if a.id is null or not public.meeting_can_manage(a.meeting_id) then
    raise exception 'Attendee not found.' using errcode = '42501';
  end if;
  if a.user_id is not null then
    raise exception 'Team members join from the app; guest links are for guests.' using errcode = '22023';
  end if;
  select * into m from public.meetings where id = a.meeting_id;
  if m.status not in ('planned', 'live') then
    raise exception 'The meeting is over or cancelled.' using errcode = '22023';
  end if;
  update public.meeting_guest_links set revoked_at = now() where attendee_id = p_attendee and revoked_at is null;
  insert into public.meeting_guest_links (company_id, meeting_id, attendee_id, token_hash, expires_at)
  values (a.company_id, a.meeting_id, p_attendee, public.meeting_token_digest(v_token),
          greatest(m.starts_at + make_interval(mins => m.minutes) + interval '6 hours',
                   now() + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 60))));
  return v_token;
end;
$$;

-- The public guest page (service role only): only this meeting's title, time, our company and how to join.
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
                            'can_join', m.status = 'live' or (m.status = 'planned' and now() >= m.starts_at - interval '15 minutes'));
end;
$$;

-- The guest pressed Join (service role only).
create or replace function public.meeting_guest_joined(p_token text)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  g public.meeting_guest_links;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return false; end if;
  select * into g from public.meeting_guest_links where token_hash = public.meeting_token_digest(p_token)
     and revoked_at is null and expires_at > now();
  if g.id is null then return false; end if;
  update public.meeting_guest_links set uses = uses + 1, last_used_at = now() where id = g.id;
  update public.meeting_attendees set joined_at = coalesce(joined_at, now()), present = true, response = 'accepted' where id = g.attendee_id;
  return true;
end;
$$;

-- A team member joined (from the room page). Someone who can see the meeting but was not invited is added.
create or replace function public.meeting_joined(p_meeting uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting;
  if m.id is null or not public.meeting_visible(m.company_id, p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.status = 'cancelled' then
    raise exception 'This meeting was cancelled.' using errcode = '22023';
  end if;
  insert into public.meeting_attendees (company_id, meeting_id, user_id, role, response, joined_at, present)
  values (m.company_id, p_meeting, auth.uid(), 'member', 'accepted', now(), true)
  on conflict (meeting_id, user_id) where user_id is not null
  do update set joined_at = coalesce(public.meeting_attendees.joined_at, now()), present = true, response = 'accepted';
end;
$$;

-- Who is here (ticked by the organiser in the room).
create or replace function public.meeting_set_present(p_attendee uuid, p_present boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  a public.meeting_attendees;
begin
  select * into a from public.meeting_attendees where id = p_attendee;
  if a.id is null or not public.meeting_can_manage(a.meeting_id) then
    raise exception 'Attendee not found.' using errcode = '42501';
  end if;
  update public.meeting_attendees set present = coalesce(p_present, false) where id = p_attendee;
end;
$$;

create or replace function public.meeting_respond(p_meeting uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.meeting_attendees set response = case when p_accept then 'accepted' else 'declined' end
   where meeting_id = p_meeting and user_id = auth.uid();
  if not found then
    raise exception 'You are not invited to this meeting.' using errcode = '22023';
  end if;
end;
$$;

-- The video room (server side, after creating a Daily.co room, or going back to Jitsi when Daily fails).
create or replace function public.meeting_set_video(p_meeting uuid, p_provider text, p_room text, p_url text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if m.id is null or not public.meeting_visible(m.company_id, p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.video_provider = 'external' then
    return;  -- the client's own link stays
  end if;
  if p_provider not in ('daily', 'jitsi') or p_room is null or p_room !~ '^[A-Za-z0-9_-]{16,120}$' or not public.meeting_link_ok(p_url) then
    raise exception 'Unknown video room.' using errcode = '22023';
  end if;
  update public.meetings set video_provider = p_provider, video_room = p_room, video_url = p_url where id = p_meeting;
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Agenda
-- ---------------------------------------------------------------------
-- p_items: [{title, detail, topic, source, source_ref, owner_id, minutes}]. Returns how many were added.
create or replace function public.meeting_add_agenda(p_meeting uuid, p_items jsonb)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  m      public.meetings;
  it     jsonb;
  v_n    integer := 0;
  v_sort integer;
  v_own  uuid;
  v_top  text;
  v_src  text;
begin
  select * into m from public.meetings where id = p_meeting;
  if m.id is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.status not in ('planned', 'live') then
    raise exception 'The agenda of a held meeting cannot be changed.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 40 then
    raise exception 'Up to 40 agenda items at a time.' using errcode = '22023';
  end if;
  select coalesce(max(sort), 0) into v_sort from public.meeting_agenda_items where meeting_id = p_meeting;
  for it in select * from jsonb_array_elements(p_items) loop
    continue when char_length(btrim(coalesce(it ->> 'title', ''))) < 2;
    v_src := case when it ->> 'source' in ('manual', 'suggested', 'follow_up') then it ->> 'source' else 'manual' end;
    continue when it ->> 'source_ref' is not null and exists (
      select 1 from public.meeting_agenda_items where meeting_id = p_meeting and source_ref = left(it ->> 'source_ref', 120));
    v_own := case when (it ->> 'owner_id') ~ '^[0-9a-f-]{36}$' and public.is_active_member(m.company_id, (it ->> 'owner_id')::uuid)
                  then (it ->> 'owner_id')::uuid end;
    v_top := case when it ->> 'topic' = any (public.meeting_topics()) then it ->> 'topic' end;
    v_sort := v_sort + 10;
    insert into public.meeting_agenda_items (company_id, meeting_id, sort, topic, title, detail, source, source_ref, owner_id, minutes)
    values (m.company_id, p_meeting, v_sort, v_top, left(btrim(it ->> 'title'), 300), nullif(left(btrim(coalesce(it ->> 'detail', '')), 1000), ''),
            v_src, nullif(left(it ->> 'source_ref', 120), ''), v_own,
            case when (it ->> 'minutes') ~ '^\d{1,3}$' and (it ->> 'minutes')::int between 1 and 240 then (it ->> 'minutes')::int end);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function public.meeting_agenda_item(p_item uuid, p_action text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  i public.meeting_agenda_items;
begin
  select * into i from public.meeting_agenda_items where id = p_item;
  if i.id is null or not public.meeting_can_manage(i.meeting_id) then
    raise exception 'Agenda item not found.' using errcode = '42501';
  end if;
  if p_action = 'remove' then
    delete from public.meeting_agenda_items where id = p_item;
  elsif p_action in ('done', 'undone') then
    update public.meeting_agenda_items set done = p_action = 'done' where id = p_item;
  elsif p_action in ('up', 'down') then
    update public.meeting_agenda_items set sort = sort + case when p_action = 'up' then -15 else 15 end where id = p_item;
  else
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
end;
$$;

-- "Suggest topics": business items from the company's own data, for the organiser to tick.
-- Money items (receivables, bills) only for management and finance. Each item: key, topic, title, detail, weight (1-3), ref.
create or replace function public.meeting_agenda_candidates(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := public.meeting_today();
  v_money boolean := public.has_role(p_company, public.finance_roles());
  v_out   jsonb := '[]'::jsonb;
  r       record;
  v_n     integer;
  v_txt   text;
begin
  if not public.has_role(p_company, public.meeting_organiser_roles()) then
    raise exception 'You cannot organise meetings.' using errcode = '42501';
  end if;

  -- Open and overdue actions from earlier meetings.
  for r in select p.id, p.body, p.due_on, p.topic, p.owner_name, coalesce(nullif(btrim(pr.full_name), ''), pr.email) as owner, m.title
             from public.meeting_points p join public.meetings m on m.id = p.meeting_id
             left join public.profiles pr on pr.id = p.owner_id
            where p.company_id = p_company and p.approved and p.kind = 'action' and p.status in ('open', 'in_progress')
            order by p.due_on nulls last limit 15 loop
    v_out := v_out || jsonb_build_object('key', 'action:' || r.id, 'topic', coalesce(r.topic, 'Open floor'),
      'title', 'Follow up: ' || left(r.body, 200),
      'detail', concat_ws(' · ', 'Owner ' || coalesce(r.owner, r.owner_name, 'not set'),
                          case when r.due_on < v_today then 'overdue since ' || to_char(r.due_on, 'DD Mon')
                               when r.due_on is not null then 'due ' || to_char(r.due_on, 'DD Mon') end, 'from ' || r.title),
      'weight', case when r.due_on < v_today then 3 else 2 end, 'ref', 'action:' || r.id, 'source', 'follow_up');
  end loop;
  -- Issues still open.
  for r in select p.id, p.body, p.topic, p.severity from public.meeting_points p
            where p.company_id = p_company and p.approved and p.kind = 'issue' and p.status in ('open', 'in_progress')
            order by p.created_at desc limit 8 loop
    v_out := v_out || jsonb_build_object('key', 'issue:' || r.id, 'topic', coalesce(r.topic, 'Open floor'),
      'title', 'Still open: ' || left(r.body, 200), 'detail', 'Raised at an earlier meeting',
      'weight', case when r.severity = 'high' then 3 else 2 end, 'ref', 'issue:' || r.id, 'source', 'follow_up');
  end loop;

  if v_money then
    select count(*), string_agg(distinct c.name, ', ') into v_n, v_txt
      from public.invoices i join public.clients c on c.id = i.client_id
     where i.company_id = p_company and i.status in ('issued', 'partly_paid') and i.due_date < v_today;
    if v_n > 0 then
      v_out := v_out || jsonb_build_object('key', 'receivables', 'topic', 'Money',
        'title', v_n || ' overdue invoice' || case when v_n > 1 then 's' else '' end || ' to collect',
        'detail', left(v_txt, 300), 'weight', 3, 'ref', 'receivables');
    end if;
    select count(*), string_agg(distinct s.name, ', ') into v_n, v_txt
      from public.supplier_bills b join public.suppliers s on s.id = b.supplier_id
     where b.company_id = p_company and b.status in ('open', 'partly_paid') and b.due_date <= v_today + 7;
    if v_n > 0 then
      v_out := v_out || jsonb_build_object('key', 'bills', 'topic', 'Money',
        'title', v_n || ' supplier bill' || case when v_n > 1 then 's' else '' end || ' due within a week or late',
        'detail', left(v_txt, 300), 'weight', 2, 'ref', 'bills');
    end if;
  end if;

  select count(*), string_agg(name, ', ') into v_n, v_txt from (
    select p.name from public.products p
      left join (select product_id, sum(quantity) q from public.stock_on_hand where company_id = p_company group by product_id) s
        on s.product_id = p.id
     where p.company_id = p_company and p.active and coalesce(p.reorder_level, 0) > 0 and coalesce(s.q, 0) <= p.reorder_level
     order by coalesce(s.q, 0) - p.reorder_level limit 8) x;
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('key', 'low_stock', 'topic', 'Stock',
      'title', 'Low stock: ' || v_n || ' product' || case when v_n > 1 then 's' else '' end || ' at or below the reorder level',
      'detail', left(v_txt, 300), 'weight', 2, 'ref', 'low_stock');
  end if;

  select count(*), string_agg(distinct coalesce(d.number, '') || ' ' || coalesce(c.name, ''), ', ') into v_n, v_txt
    from public.deliveries d left join public.clients c on c.id = d.client_id
   where d.company_id = p_company and d.status in ('draft', 'dispatched') and d.planned_date < v_today;
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('key', 'late_deliveries', 'topic', 'Deliveries',
      'title', v_n || ' late deliver' || case when v_n > 1 then 'ies' else 'y' end, 'detail', left(v_txt, 300), 'weight', 3, 'ref', 'late_deliveries');
  end if;

  select count(*), string_agg(distinct coalesce(po.number, '') || ' ' || coalesce(s.name, ''), ', ') into v_n, v_txt
    from public.purchase_orders po left join public.suppliers s on s.id = po.supplier_id
   where po.company_id = p_company and po.status in ('approved', 'sent', 'confirmed', 'partially_received') and po.expected_date < v_today;
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('key', 'late_orders', 'topic', 'Procurement & suppliers',
      'title', v_n || ' purchase order' || case when v_n > 1 then 's' else '' end || ' late from suppliers', 'detail', left(v_txt, 300),
      'weight', 2, 'ref', 'late_orders');
  end if;

  select count(*), string_agg(distinct coalesce(q.number, '') || ' ' || coalesce(c.name, ''), ', ') into v_n, v_txt
    from public.quotations q left join public.clients c on c.id = q.client_id
   where q.company_id = p_company and q.status = 'sent' and q.valid_until between v_today - 3 and v_today + 7;
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('key', 'quotes_expiring', 'topic', 'Sales & clients',
      'title', v_n || ' quotation' || case when v_n > 1 then 's' else '' end || ' waiting for an answer, expiring soon',
      'detail', left(v_txt, 300), 'weight', 2, 'ref', 'quotes_expiring');
  end if;

  select count(*), string_agg(distinct o.title, ', ') into v_n, v_txt
    from public.opportunities o
   where o.company_id = p_company and o.stage not in ('won', 'lost') and o.next_on <= v_today + 3;
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('key', 'pipeline', 'topic', 'Sales & clients',
      'title', v_n || ' pipeline follow-up' || case when v_n > 1 then 's' else '' end || ' due', 'detail', left(v_txt, 300),
      'weight', 2, 'ref', 'pipeline');
  end if;

  select count(*), string_agg(distinct i.name, ', ') into v_n, v_txt
    from public.compliance_deadlines d join public.compliance_items i on i.id = d.item_id
   where d.company_id = p_company and d.status = 'open' and i.status <> 'not_applicable' and d.due_on <= v_today + 14;
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('key', 'filings', 'topic', 'Compliance',
      'title', v_n || ' filing' || case when v_n > 1 then 's' else '' end || ' due in the next two weeks or late',
      'detail', left(v_txt, 300), 'weight', 3, 'ref', 'filings');
  end if;
  select count(*), string_agg(name || ' (' || to_char(expires_on, 'DD Mon') || ')', ', ') into v_n, v_txt
    from public.licences
   where company_id = p_company and status in ('active', 'expired') and expires_on <= v_today + 60;
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('key', 'licences', 'topic', 'Compliance',
      'title', v_n || ' licence' || case when v_n > 1 then 's' else '' end || ' to renew', 'detail', left(v_txt, 300),
      'weight', 2, 'ref', 'licences');
  end if;

  select count(*), string_agg(title, ', ') into v_n, v_txt
    from public.hse_incidents where company_id = p_company and status in ('open', 'investigating');
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('key', 'incidents', 'topic', 'HSE',
      'title', v_n || ' open safety incident' || case when v_n > 1 then 's' else '' end, 'detail', left(v_txt, 300), 'weight', 3, 'ref', 'incidents');
  end if;
  select count(*), string_agg(title, ', ') into v_n, v_txt
    from public.quality_ncrs where company_id = p_company and status in ('open', 'action');
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('key', 'ncrs', 'topic', 'HSE',
      'title', v_n || ' open quality problem' || case when v_n > 1 then 's' else '' end || ' (NCR)', 'detail', left(v_txt, 300),
      'weight', 2, 'ref', 'ncrs');
  end if;
  select count(*) into v_n from public.corrective_actions where company_id = p_company and status = 'open' and due_on < v_today;
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('key', 'corrective', 'topic', 'HSE',
      'title', v_n || ' corrective action' || case when v_n > 1 then 's' else '' end || ' overdue', 'detail', null, 'weight', 2, 'ref', 'corrective');
  end if;

  select count(*), string_agg(distinct coalesce(counterpart_name, counterpart_address), ', ') into v_n, v_txt
    from public.inbox_conversations
   where company_id = p_company and status = 'open' and last_direction = 'in' and last_message_at < now() - interval '1 day';
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('key', 'inbox', 'topic', 'Sales & clients',
      'title', v_n || ' client or supplier message' || case when v_n > 1 then 's' else '' end || ' waiting for a reply',
      'detail', left(v_txt, 300), 'weight', 2, 'ref', 'inbox');
  end if;

  select count(*), string_agg(e.full_name, ', ') into v_n, v_txt
    from public.leave_requests l join public.employees e on e.id = l.employee_id
   where l.company_id = p_company and l.status = 'approved' and l.starts_on between v_today and v_today + 14;
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('key', 'leave', 'topic', 'Admin & HR',
      'title', v_n || ' on leave in the next two weeks', 'detail', left(v_txt, 300), 'weight', 1, 'ref', 'leave');
  end if;

  v_out := v_out || jsonb_build_object('key', 'open_floor', 'topic', 'Open floor', 'title', 'Open floor: anything else from the team',
                                       'detail', null, 'weight', 1, 'ref', 'open_floor');
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------
-- 10. Holding the meeting
-- ---------------------------------------------------------------------
create or replace function public.meeting_start(p_meeting uuid, p_announced boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings;
  r record;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if m.id is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.status = 'live' then
    if p_announced and m.announced_at is null then
      update public.meetings set announced_at = now() where id = p_meeting;
    end if;
    return;
  end if;
  if m.status <> 'planned' then
    raise exception 'This meeting is already over or cancelled.' using errcode = '22023';
  end if;
  update public.meetings set status = 'live', started_at = now(), announced_at = case when p_announced then now() end where id = p_meeting;
  insert into public.meeting_attendees (company_id, meeting_id, user_id, role, response, joined_at, present)
  values (m.company_id, p_meeting, auth.uid(), 'member', 'accepted', now(), true)
  on conflict (meeting_id, user_id) where user_id is not null
  do update set joined_at = coalesce(public.meeting_attendees.joined_at, now()), present = true;
  for r in select user_id from public.meeting_attendees
            where meeting_id = p_meeting and user_id is not null and user_id <> auth.uid() and response <> 'declined' loop
    perform public.notify(m.company_id, r.user_id, 'meeting_started', 'critical', 'Meeting started: ' || m.title,
      'Tap to join from the app.', '/meetings/' || p_meeting || '/room', 'meeting-start:' || p_meeting || ':' || r.user_id);
  end loop;
end;
$$;

-- A line of the live transcript (speech) or of the typed notes, with who said or typed it.
create or replace function public.meeting_add_line(p_meeting uuid, p_kind text, p_text text, p_speaker text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m      public.meetings;
  v_line text := btrim(regexp_replace(coalesce(p_text, ''), '[\r\n]+', ' ', 'g'));
  v_who  text := nullif(left(btrim(regexp_replace(coalesce(p_speaker, ''), '[\r\n:\[\]]+', ' ', 'g')), 60), '');
  v_at   text;
begin
  select * into m from public.meetings where id = p_meeting;
  if m.id is null or not public.meeting_can_note(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.status <> 'live' then
    raise exception 'Start the meeting first.' using errcode = '22023';
  end if;
  if p_kind not in ('speech', 'typed') then
    raise exception 'Unknown kind of line.' using errcode = '22023';
  end if;
  if v_line = '' then return; end if;
  if v_who is null then
    select coalesce(nullif(btrim(full_name), ''), email) into v_who from public.profiles where id = auth.uid();
  end if;
  v_at := to_char(now() - coalesce(m.started_at, now()), 'HH24:MI:SS');
  v_line := '[' || v_at || '] ' || coalesce(left(v_who, 60) || ': ', '') || left(v_line, 2000) || E'\n';
  insert into public.meeting_texts (meeting_id, company_id) values (p_meeting, m.company_id) on conflict (meeting_id) do nothing;
  if p_kind = 'speech' then
    update public.meeting_texts set transcript = right(transcript || v_line, 400000), updated_at = now() where meeting_id = p_meeting;
  else
    update public.meeting_texts set notes = right(notes || v_line, 100000), updated_at = now() where meeting_id = p_meeting;
  end if;
end;
$$;

-- The organiser corrects the transcript or notes (until the minutes are approved).
create or replace function public.meeting_save_text(p_meeting uuid, p_transcript text, p_notes text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting;
  if m.id is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.minutes_status = 'approved' then
    raise exception 'The minutes are approved; the notes can no longer be changed.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_transcript, '')) > 400000 or char_length(coalesce(p_notes, '')) > 100000 then
    raise exception 'The notes are too long.' using errcode = '22023';
  end if;
  insert into public.meeting_texts (meeting_id, company_id, transcript, notes)
  values (p_meeting, m.company_id, coalesce(p_transcript, ''), coalesce(p_notes, ''))
  on conflict (meeting_id) do update set transcript = excluded.transcript, notes = excluded.notes, updated_at = now();
end;
$$;

create or replace function public.meeting_end(p_meeting uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if m.id is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.status not in ('planned', 'live') then
    raise exception 'This meeting is already over or cancelled.' using errcode = '22023';
  end if;
  update public.meetings
     set status = 'held', started_at = coalesce(started_at, now()), ended_at = now()
   where id = p_meeting;
  update public.meeting_guest_links set expires_at = least(expires_at, now() + interval '1 hour') where meeting_id = p_meeting;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Minutes and points
-- ---------------------------------------------------------------------
create or replace function public.meeting_minutes_state(p_meeting uuid, p_state text, p_error text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if m.id is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.status <> 'held' or m.minutes_status = 'approved' then
    raise exception 'The minutes can be written once the meeting has ended, until they are approved.' using errcode = '22023';
  end if;
  if p_state not in ('writing', 'failed') then
    raise exception 'Unknown state.' using errcode = '22023';
  end if;
  update public.meetings
     set minutes_status = case when p_state = 'failed' and m.minutes_summary is not null then 'ready' else p_state end,
         minutes_error = case when p_state = 'failed' then left(coalesce(p_error, 'The notes could not be written.'), 500) end,
         minutes_requested_at = case when p_state = 'writing' then now() else minutes_requested_at end
   where id = p_meeting;
end;
$$;

-- Internal: checks a proposed change. Returns the cleaned payload, or raises with the reason.
create or replace function public.meeting_proposal_clean(p_company uuid, p_target text, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := public.meeting_today();
  v_out   jsonb;
  v_d     date;
  v_n     integer;
  v_id    uuid;
  l       jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_text  text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception 'The change is empty.' using errcode = '22023';
  end if;
  -- Dates: YYYY-MM-DD from yesterday to two years ahead.
  if p ? 'next_on' or p ? 'due_on' or p ? 'needed_by' or p ? 'starts_on' or p ? 'ends_on' then
    for v_text in select x from unnest(array['next_on', 'due_on', 'needed_by', 'starts_on', 'ends_on']) x loop
      continue when not (p ? v_text) or jsonb_typeof(p -> v_text) = 'null';
      if (p ->> v_text) !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Dates must look like 2026-11-03.' using errcode = '22023';
      end if;
      v_d := (p ->> v_text)::date;
      if v_d < v_today - 1 or v_d > v_today + 730 then
        raise exception 'The date must be from today to two years ahead.' using errcode = '22023';
      end if;
    end loop;
  end if;
  case p_target
  when 'crm_note' then
    v_text := btrim(coalesce(p ->> 'summary', ''));
    if char_length(v_text) not between 2 and 2000 then raise exception 'Write the note (2 to 2000 letters).' using errcode = '22023'; end if;
    if nullif(p ->> 'client_id', '') is null and nullif(p ->> 'opportunity_id', '') is null then
      raise exception 'Choose the client or the opportunity.' using errcode = '22023';
    end if;
    if nullif(p ->> 'client_id', '') is not null and not exists (select 1 from public.clients where id = (p ->> 'client_id')::uuid and company_id = p_company) then
      raise exception 'Client not found.' using errcode = '22023';
    end if;
    if nullif(p ->> 'opportunity_id', '') is not null and not exists (select 1 from public.opportunities where id = (p ->> 'opportunity_id')::uuid and company_id = p_company) then
      raise exception 'Opportunity not found.' using errcode = '22023';
    end if;
    v_out := jsonb_build_object('client_id', nullif(p ->> 'client_id', ''), 'opportunity_id', nullif(p ->> 'opportunity_id', ''),
                                'summary', v_text, 'next_action', nullif(left(btrim(coalesce(p ->> 'next_action', '')), 300), ''),
                                'next_on', nullif(p ->> 'next_on', ''));
  when 'followup' then
    if num_nonnulls(nullif(p ->> 'quotation_id', ''), nullif(p ->> 'invoice_id', '')) <> 1 then
      raise exception 'Choose the quotation or the invoice.' using errcode = '22023';
    end if;
    if nullif(p ->> 'quotation_id', '') is not null and not exists (select 1 from public.quotations where id = (p ->> 'quotation_id')::uuid and company_id = p_company) then
      raise exception 'Quotation not found.' using errcode = '22023';
    end if;
    if nullif(p ->> 'invoice_id', '') is not null and not exists (select 1 from public.invoices where id = (p ->> 'invoice_id')::uuid and company_id = p_company) then
      raise exception 'Invoice not found.' using errcode = '22023';
    end if;
    v_out := jsonb_build_object('quotation_id', nullif(p ->> 'quotation_id', ''), 'invoice_id', nullif(p ->> 'invoice_id', ''),
                                'note', left(btrim(coalesce(p ->> 'note', '')), 1000), 'next_on', nullif(p ->> 'next_on', ''));
  when 'opportunity_stage' then
    if not exists (select 1 from public.opportunities where id = nullif(p ->> 'opportunity_id', '')::uuid and company_id = p_company) then
      raise exception 'Opportunity not found.' using errcode = '22023';
    end if;
    if coalesce(p ->> 'stage', '') not in ('lead', 'qualified', 'quoted', 'negotiation', 'won', 'lost') then
      raise exception 'Unknown stage.' using errcode = '22023';
    end if;
    v_out := jsonb_build_object('opportunity_id', p ->> 'opportunity_id', 'stage', p ->> 'stage',
                                'reason', nullif(left(btrim(coalesce(p ->> 'reason', '')), 500), ''));
  when 'requisition' then
    if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') not between 1 and 30 then
      raise exception 'List what to buy (1 to 30 items).' using errcode = '22023';
    end if;
    for l in select * from jsonb_array_elements(p -> 'lines') loop
      if char_length(btrim(coalesce(l ->> 'description', ''))) not between 1 and 300
         or coalesce(l ->> 'quantity', '') !~ '^\d+(\.\d+)?$' or (l ->> 'quantity')::numeric <= 0 then
        raise exception 'Each item needs a description and a quantity above 0.' using errcode = '22023';
      end if;
      v_id := case when (l ->> 'product_id') ~ '^[0-9a-f-]{36}$' then (l ->> 'product_id')::uuid end;
      if v_id is not null and not exists (select 1 from public.products where id = v_id and company_id = p_company) then
        v_id := null;
      end if;
      v_lines := v_lines || jsonb_build_object('description', left(btrim(l ->> 'description'), 300), 'quantity', (l ->> 'quantity')::numeric,
                                               'unit', nullif(left(btrim(coalesce(l ->> 'unit', '')), 20), ''), 'product_id', v_id);
    end loop;
    v_out := jsonb_build_object('reason', nullif(left(btrim(coalesce(p ->> 'reason', '')), 500), ''), 'needed_by', nullif(p ->> 'needed_by', ''),
                                'lines', v_lines);
  when 'compliance_date' then
    if not exists (select 1 from public.compliance_items where id = nullif(p ->> 'item_id', '')::uuid and company_id = p_company) then
      raise exception 'Compliance item not found.' using errcode = '22023';
    end if;
    if nullif(p ->> 'due_on', '') is null then raise exception 'Choose the new due date.' using errcode = '22023'; end if;
    v_out := jsonb_build_object('item_id', p ->> 'item_id', 'due_on', p ->> 'due_on');
  when 'corrective_action' then
    if coalesce(p ->> 'source_kind', '') not in ('incident', 'ncr') then
      raise exception 'Choose the incident or the quality problem.' using errcode = '22023';
    end if;
    if (p ->> 'source_kind' = 'incident' and not exists (select 1 from public.hse_incidents where id = nullif(p ->> 'source_id', '')::uuid and company_id = p_company))
       or (p ->> 'source_kind' = 'ncr' and not exists (select 1 from public.quality_ncrs where id = nullif(p ->> 'source_id', '')::uuid and company_id = p_company)) then
      raise exception 'Incident or quality problem not found.' using errcode = '22023';
    end if;
    v_text := btrim(coalesce(p ->> 'action', ''));
    if char_length(v_text) not between 3 and 1000 then raise exception 'Describe the action (3 to 1000 letters).' using errcode = '22023'; end if;
    if nullif(p ->> 'owner_id', '') is not null and not public.is_active_member(p_company, (p ->> 'owner_id')::uuid) then
      raise exception 'The owner must be an active team member.' using errcode = '22023';
    end if;
    v_out := jsonb_build_object('source_kind', p ->> 'source_kind', 'source_id', p ->> 'source_id', 'action', v_text,
                                'owner_id', nullif(p ->> 'owner_id', ''), 'due_on', nullif(p ->> 'due_on', ''));
  when 'calendar_entry' then
    v_text := btrim(coalesce(p ->> 'title', ''));
    if char_length(v_text) not between 2 and 200 then raise exception 'Give the date a title.' using errcode = '22023'; end if;
    if nullif(p ->> 'starts_on', '') is null then raise exception 'Choose the date.' using errcode = '22023'; end if;
    if coalesce(p ->> 'kind', 'other') not in ('meeting', 'delivery', 'follow_up', 'event', 'payment', 'supplies', 'task', 'other') then
      raise exception 'Unknown kind of date.' using errcode = '22023';
    end if;
    if nullif(p ->> 'at_time', '') is not null and (p ->> 'at_time') !~ '^([01]\d|2[0-3]):[0-5]\d$' then
      raise exception 'The time must look like 14:30.' using errcode = '22023';
    end if;
    if nullif(p ->> 'ends_on', '') is not null and (p ->> 'ends_on')::date < (p ->> 'starts_on')::date then
      raise exception 'The end date must be after the start date.' using errcode = '22023';
    end if;
    if nullif(p ->> 'owner_id', '') is not null and not public.is_active_member(p_company, (p ->> 'owner_id')::uuid) then
      raise exception 'The owner must be an active team member.' using errcode = '22023';
    end if;
    v_out := jsonb_build_object('title', v_text, 'kind', coalesce(p ->> 'kind', 'other'), 'starts_on', p ->> 'starts_on',
                                'ends_on', nullif(p ->> 'ends_on', ''), 'at_time', nullif(p ->> 'at_time', ''),
                                'notes', nullif(left(btrim(coalesce(p ->> 'notes', '')), 1000), ''), 'owner_id', nullif(p ->> 'owner_id', ''),
                                'phrase', nullif(left(btrim(coalesce(p ->> 'phrase', '')), 120), ''));
  when 'next_meeting' then
    begin
      v_d := null;
      if (p ->> 'starts_at')::timestamptz < now() or (p ->> 'starts_at')::timestamptz > now() + interval '2 years' then
        raise exception 'bad';
      end if;
    exception when others then
      raise exception 'Choose the date and time of the next meeting (from now to two years ahead).' using errcode = '22023';
    end;
    v_out := jsonb_build_object('starts_at', (p ->> 'starts_at')::timestamptz,
                                'title', nullif(left(btrim(coalesce(p ->> 'title', '')), 160), ''));
  when 'task' then
    v_text := btrim(coalesce(p ->> 'text', ''));
    if char_length(v_text) not between 2 and 1000 then raise exception 'Describe the task.' using errcode = '22023'; end if;
    if nullif(p ->> 'owner_id', '') is null or not public.is_active_member(p_company, (p ->> 'owner_id')::uuid) then
      raise exception 'Choose who does it (an active team member).' using errcode = '22023';
    end if;
    v_out := jsonb_build_object('text', v_text, 'owner_id', p ->> 'owner_id', 'due_on', nullif(p ->> 'due_on', ''));
  else
    raise exception 'Unknown kind of change.' using errcode = '22023';
  end case;
  return jsonb_strip_nulls(v_out);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  raise exception 'A value in the change is not valid.' using errcode = '22023';
end;
$$;

-- Writes the minutes (from the AI or the app's own notes) as drafts. p keys:
--   summary, topics [{topic, points[]}], suggestions[], unclear[], language_note, by ('ai' | 'app' | 'manual'),
--   follow_up [{point_id, status, note}],
--   points [{kind, body, raised_by, owner_id, owner_name, due_on, severity, topic, client_id, supplier_id, carried_from}],
--   proposals [{target, title, payload, point}]   (point: index into points)
-- Draft points and pending proposals written earlier by the AI or the app are replaced. Returns the number of points.
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

  update public.meetings
     set minutes_status = 'ready', minutes_by = v_by, minutes_error = null,
         minutes_summary = jsonb_build_object(
           'summary', left(coalesce(p ->> 'summary', ''), 6000),
           'topics', coalesce(case when jsonb_typeof(p -> 'topics') = 'array' then p -> 'topics' end, '[]'),
           'suggestions', coalesce(case when jsonb_typeof(p -> 'suggestions') = 'array' then p -> 'suggestions' end, '[]'),
           'unclear', coalesce(case when jsonb_typeof(p -> 'unclear') = 'array' then p -> 'unclear' end, '[]'),
           'language_note', left(coalesce(p ->> 'language_note', ''), 300),
           'follow_up', coalesce(case when jsonb_typeof(p -> 'follow_up') = 'array' then p -> 'follow_up' end, '[]'),
           'proposals', v_k)
   where id = p_meeting;
  return v_n;
end;
$$;

-- A point added or changed by hand. p keys: kind, body, owner_id, due_on, severity, topic, client_id, supplier_id,
-- quotation_id, purchase_order_id, raised_by.
create or replace function public.meeting_save_point(p_meeting uuid, p_point uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  m      public.meetings;
  o      public.meeting_points;
  v_id   uuid := p_point;
  v_kind text := p ->> 'kind';
  v_body text := btrim(coalesce(p ->> 'body', ''));
  v_own  uuid := nullif(p ->> 'owner_id', '')::uuid;
  v_due  date := nullif(p ->> 'due_on', '')::date;
  v_cl   uuid := nullif(p ->> 'client_id', '')::uuid;
  v_su   uuid := nullif(p ->> 'supplier_id', '')::uuid;
  v_qu   uuid := nullif(p ->> 'quotation_id', '')::uuid;
  v_po   uuid := nullif(p ->> 'purchase_order_id', '')::uuid;
begin
  if p_point is not null then
    select * into o from public.meeting_points where id = p_point;
    if o.id is null then raise exception 'Point not found.' using errcode = '42501'; end if;
    p_meeting := o.meeting_id;
  end if;
  select * into m from public.meetings where id = p_meeting;
  if m.id is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if o.approved and not public.is_manager(m.company_id) then
    raise exception 'Approved minutes are changed by management only.' using errcode = '42501';
  end if;
  if v_kind not in ('issue', 'decision', 'action', 'note') then
    raise exception 'Choose issue, decision, action or note.' using errcode = '22023';
  end if;
  if char_length(v_body) not between 2 and 1000 then
    raise exception 'Write the point (2 to 1000 letters).' using errcode = '22023';
  end if;
  if v_own is not null and not public.is_active_member(m.company_id, v_own) then
    raise exception 'The owner must be an active team member.' using errcode = '22023';
  end if;
  if v_due is not null and (v_due < m.meeting_date - 30 or v_due > m.meeting_date + 730) then
    raise exception 'The due date must be within two years of the meeting.' using errcode = '22023';
  end if;
  if (v_cl is not null and not exists (select 1 from public.clients where id = v_cl and company_id = m.company_id))
     or (v_su is not null and not exists (select 1 from public.suppliers where id = v_su and company_id = m.company_id))
     or (v_qu is not null and not exists (select 1 from public.quotations where id = v_qu and company_id = m.company_id))
     or (v_po is not null and not exists (select 1 from public.purchase_orders where id = v_po and company_id = m.company_id)) then
    raise exception 'That record was not found in your company.' using errcode = '22023';
  end if;
  if v_id is null then
    if m.status not in ('live', 'held') then
      raise exception 'Points are added during or after the meeting.' using errcode = '22023';
    end if;
    insert into public.meeting_points (company_id, meeting_id, kind, body, source, approved, sort)
    values (m.company_id, p_meeting, v_kind, v_body, 'manual', m.minutes_status = 'approved',
            coalesce((select max(sort) from public.meeting_points where meeting_id = p_meeting), 0) + 10)
    returning id into v_id;
  end if;
  update public.meeting_points
     set kind = v_kind, body = v_body, owner_id = v_own, due_on = v_due,
         owner_name = case when v_own is null then nullif(left(btrim(coalesce(p ->> 'owner_name', owner_name, '')), 120), '') else null end,
         severity = case when p ->> 'severity' in ('low', 'medium', 'high') then p ->> 'severity' end,
         topic = case when p ->> 'topic' = any (public.meeting_topics()) then p ->> 'topic' end,
         raised_by = nullif(left(btrim(coalesce(p ->> 'raised_by', raised_by, '')), 120), ''),
         client_id = v_cl, supplier_id = v_su, quotation_id = v_qu, purchase_order_id = v_po
   where id = v_id;
  -- An approved action given to someone new: they are told.
  if (select approved from public.meeting_points where id = v_id) and v_kind = 'action' and v_own is not null
     and v_own is distinct from o.owner_id and v_own <> auth.uid() then
    perform public.notify(m.company_id, v_own, 'meeting_action', 'attention', 'Action for you: ' || left(v_body, 120),
      coalesce('Due ' || to_char(v_due, 'DD Mon YYYY') || ' · ', '') || m.title, '/meetings/actions', 'meeting-action:' || v_id || ':' || v_own);
  end if;
  return v_id;
end;
$$;

create or replace function public.meeting_delete_point(p_point uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  o public.meeting_points;
begin
  select * into o from public.meeting_points where id = p_point;
  if o.id is null or not public.meeting_can_manage(o.meeting_id) then
    raise exception 'Point not found.' using errcode = '42501';
  end if;
  if o.approved and not public.is_manager(o.company_id) then
    raise exception 'Approved minutes are changed by management only.' using errcode = '42501';
  end if;
  delete from public.meeting_points where id = p_point;
end;
$$;

-- The owner (or the organiser, or management) moves an approved action or issue on.
create or replace function public.meeting_set_point_status(p_point uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  o public.meeting_points;
begin
  select * into o from public.meeting_points where id = p_point for update;
  if o.id is null or not ((o.owner_id = auth.uid() and public.is_member(o.company_id)) or public.meeting_can_manage(o.meeting_id)) then
    raise exception 'Point not found.' using errcode = '42501';
  end if;
  if not o.approved then
    raise exception 'The minutes are not approved yet.' using errcode = '22023';
  end if;
  if p_status not in ('open', 'in_progress', 'done', 'cancelled') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  if p_status = 'cancelled' and not public.meeting_can_manage(o.meeting_id) then
    raise exception 'Only the organiser or management can drop an action.' using errcode = '42501';
  end if;
  update public.meeting_points
     set status = p_status, done_note = nullif(left(btrim(coalesce(p_note, '')), 1000), ''),
         done_at = case when p_status in ('done', 'cancelled') then now() end,
         done_by = case when p_status in ('done', 'cancelled') then auth.uid() end
   where id = p_point;
end;
$$;

-- Approves the minutes: the points become final, last time's items are updated, action owners are told.
create or replace function public.meeting_approve_minutes(p_meeting uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  m     public.meetings;
  r     record;
  fu    jsonb;
  v_n   integer := 0;
begin
  select * into m from public.meetings where id = p_meeting for update;
  if m.id is null or not public.meeting_can_approve(p_meeting) then
    raise exception 'Only management or the chair can approve the minutes.' using errcode = '42501';
  end if;
  if m.status <> 'held' or m.minutes_status <> 'ready' then
    raise exception 'There are no minutes to approve yet.' using errcode = '22023';
  end if;
  update public.meeting_points set approved = true where meeting_id = p_meeting;
  -- Last time's actions and issues: what was said about them.
  for fu in select * from jsonb_array_elements(coalesce(m.minutes_summary -> 'follow_up', '[]')) loop
    continue when (fu ->> 'point_id') !~ '^[0-9a-f-]{36}$' or fu ->> 'status' not in ('done', 'in_progress');
    update public.meeting_points
       set status = fu ->> 'status',
           done_note = coalesce(nullif(left(btrim(coalesce(fu ->> 'note', '')), 1000), ''), done_note),
           done_at = case when fu ->> 'status' = 'done' then now() end,
           done_by = case when fu ->> 'status' = 'done' then auth.uid() end
     where id = (fu ->> 'point_id')::uuid and company_id = m.company_id and approved and status in ('open', 'in_progress')
       and meeting_id <> p_meeting;
  end loop;
  update public.meetings set minutes_status = 'approved', approved_at = now(), approved_by = auth.uid() where id = p_meeting;
  for r in select id, body, owner_id, due_on from public.meeting_points
            where meeting_id = p_meeting and kind = 'action' and owner_id is not null and status = 'open' loop
    v_n := v_n + 1;
    continue when r.owner_id = auth.uid();
    perform public.notify(m.company_id, r.owner_id, 'meeting_action', 'attention', 'Action for you: ' || left(r.body, 120),
      coalesce('Due ' || to_char(r.due_on, 'DD Mon YYYY') || ' · ', '') || m.title, '/meetings/actions',
      'meeting-action:' || r.id || ':' || r.owner_id);
  end loop;
  if exists (select 1 from public.meeting_proposals where meeting_id = p_meeting and status = 'pending') then
    perform public.notify_roles(m.company_id, array['management']::public.app_role[], auth.uid(), 'meeting_proposals', 'attention',
      'Updates from the meeting to review', m.title || ': check each proposed change before it is made.',
      '/meetings/' || p_meeting || '/minutes#updates', 'meeting-proposals:' || p_meeting);
  end if;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 12. Proposed updates for other departments (management reviews each one)
-- ---------------------------------------------------------------------
create or replace function public.meeting_proposal_add(p_meeting uuid, p_target text, p_title text, p_payload jsonb, p_point uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  m    public.meetings;
  v_id uuid;
begin
  select * into m from public.meetings where id = p_meeting;
  if m.id is null or not public.meeting_can_manage(p_meeting) then
    raise exception 'Meeting not found.' using errcode = '42501';
  end if;
  if m.status <> 'held' then
    raise exception 'Updates are proposed after the meeting.' using errcode = '22023';
  end if;
  if p_point is not null and not exists (select 1 from public.meeting_points where id = p_point and meeting_id = p_meeting) then
    raise exception 'Point not found.' using errcode = '22023';
  end if;
  insert into public.meeting_proposals (company_id, meeting_id, point_id, target, title, payload, source)
  values (m.company_id, p_meeting, p_point, p_target,
          left(coalesce(nullif(btrim(coalesce(p_title, '')), ''), p_target), 300),
          public.meeting_proposal_clean(m.company_id, p_target, p_payload), 'manual')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.meeting_proposal_edit(p_proposal uuid, p_title text, p_payload jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  x public.meeting_proposals;
begin
  select * into x from public.meeting_proposals where id = p_proposal for update;
  if x.id is null or not public.is_manager(x.company_id) then
    raise exception 'Only management reviews proposed updates.' using errcode = '42501';
  end if;
  if x.status <> 'pending' then
    raise exception 'This update was already decided.' using errcode = '22023';
  end if;
  update public.meeting_proposals
     set title = left(coalesce(nullif(btrim(coalesce(p_title, '')), ''), x.title), 300),
         payload = public.meeting_proposal_clean(x.company_id, x.target, p_payload)
   where id = p_proposal;
end;
$$;

-- Internal: makes the change through the module's own function (or under the module's own rule). Returns a reference.
create or replace function public.meeting_proposal_apply(x public.meeting_proposals)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  p     jsonb := public.meeting_proposal_clean(x.company_id, x.target, x.payload);
  m     public.meetings;
  v_id  uuid;
  i     public.compliance_items;
  l     jsonb;
  v_who uuid;
begin
  select * into m from public.meetings where id = x.meeting_id;
  case x.target
  when 'crm_note' then
    -- CRM notes have no function: the module's own rule (crm_activities_insert) is checked here.
    if not public.has_role(x.company_id, public.crm_roles()) then
      raise exception 'You cannot add CRM notes.' using errcode = '42501';
    end if;
    insert into public.crm_activities (company_id, opportunity_id, client_id, kind, happened_on, summary, next_action, next_on, created_by)
    values (x.company_id, (p ->> 'opportunity_id')::uuid, (p ->> 'client_id')::uuid, 'meeting', least(m.meeting_date, public.meeting_today()),
            p ->> 'summary', p ->> 'next_action', (p ->> 'next_on')::date, auth.uid())
    returning id into v_id;
    return 'crm_activities:' || v_id;
  when 'followup' then
    v_id := public.log_followup((p ->> 'quotation_id')::uuid, (p ->> 'invoice_id')::uuid, 'other',
                                coalesce(nullif(p ->> 'note', ''), 'Agreed at the meeting: ' || m.title), (p ->> 'next_on')::date);
    return 'followups:' || v_id;
  when 'opportunity_stage' then
    perform public.set_opportunity_stage((p ->> 'opportunity_id')::uuid, p ->> 'stage', p ->> 'reason');
    return 'opportunities:' || (p ->> 'opportunity_id');
  when 'requisition' then
    -- Purchase requests are drafted under the module's rule (requisitions_insert), then sent with submit_requisition.
    if not public.has_role(x.company_id, public.requisition_roles()) then
      raise exception 'You cannot ask for purchases.' using errcode = '42501';
    end if;
    insert into public.requisitions (company_id, needed_by, reason, notes, created_by)
    values (x.company_id, (p ->> 'needed_by')::date, coalesce(p ->> 'reason', left(x.title, 500)), left('From the meeting: ' || m.title, 1000), auth.uid())
    returning id into v_id;
    for l in select * from jsonb_array_elements(p -> 'lines') loop
      insert into public.requisition_lines (company_id, requisition_id, product_id, description, quantity, unit)
      values (x.company_id, v_id, (l ->> 'product_id')::uuid, l ->> 'description', (l ->> 'quantity')::numeric, l ->> 'unit');
    end loop;
    perform public.submit_requisition(v_id);
    return 'requisitions:' || v_id;
  when 'compliance_date' then
    select * into i from public.compliance_items where id = (p ->> 'item_id')::uuid;
    -- The checklist's own rule (compliance_items_update).
    if not public.compliance_can_write(i.company_id, i.finance_ok) then
      raise exception 'You cannot change this compliance item.' using errcode = '42501';
    end if;
    update public.compliance_items set due_on = (p ->> 'due_on')::date where id = i.id;
    return 'compliance_items:' || i.id;
  when 'corrective_action' then
    -- Corrective actions are added by management (corrective_actions_insert).
    if not public.is_manager(x.company_id) then
      raise exception 'Only management adds corrective actions.' using errcode = '42501';
    end if;
    insert into public.corrective_actions (company_id, source_kind, source_id, action, owner_id, due_on, created_by)
    values (x.company_id, p ->> 'source_kind', (p ->> 'source_id')::uuid, p ->> 'action', (p ->> 'owner_id')::uuid, (p ->> 'due_on')::date, auth.uid())
    returning id into v_id;
    v_who := (p ->> 'owner_id')::uuid;
    if v_who is not null and v_who <> auth.uid() then
      perform public.notify(x.company_id, v_who, 'corrective_action', 'attention', 'Corrective action for you', left(p ->> 'action', 300),
        case when p ->> 'source_kind' = 'ncr' then '/quality/' else '/hse/incidents/' end || (p ->> 'source_id'), 'ca-meeting:' || v_id);
    end if;
    return 'corrective_actions:' || v_id;
  when 'calendar_entry' then
    insert into public.calendar_entries (company_id, title, kind, starts_on, ends_on, at_time, notes, owner_id, client_id, supplier_id,
                                         meeting_id, proposal_id, created_by)
    values (x.company_id, p ->> 'title', p ->> 'kind', (p ->> 'starts_on')::date, (p ->> 'ends_on')::date, (p ->> 'at_time')::time,
            concat_ws(' · ', p ->> 'notes', case when p ? 'phrase' then 'Said: "' || (p ->> 'phrase') || '"' end, 'From ' || m.title),
            (p ->> 'owner_id')::uuid, m.client_id, m.supplier_id, m.id, x.id, auth.uid())
    returning id into v_id;
    return 'calendar_entries:' || v_id;
  when 'next_meeting' then
    v_id := public.meeting_insert(x.company_id,
      jsonb_build_object('title', coalesce(p ->> 'title', m.title), 'purpose', m.purpose, 'kind', m.kind, 'starts_at', p ->> 'starts_at',
                         'minutes', m.minutes, 'place', m.place, 'topics', to_jsonb(m.topics), 'chair_id', m.chair_id,
                         'presenter_id', m.presenter_id, 'client_id', m.client_id, 'supplier_id', m.supplier_id,
                         'open_to_team', m.open_to_team, 'record', m.record, 'language', m.language, 'external_link', m.external_link,
                         'attendees', (select coalesce(jsonb_agg(user_id), '[]') from public.meeting_attendees
                                        where meeting_id = m.id and user_id is not null)),
      null, case when public.is_active_member(x.company_id, m.created_by) then m.created_by else auth.uid() end);  -- the same organiser
    insert into public.meeting_attendees (company_id, meeting_id, guest_name, guest_email, guest_phone, guest_org, client_id, supplier_id, role)
    select company_id, v_id, guest_name, guest_email, guest_phone, guest_org, client_id, supplier_id, 'guest'
      from public.meeting_attendees where meeting_id = m.id and user_id is null;
    return 'meetings:' || v_id;
  when 'task' then
    insert into public.meeting_points (company_id, meeting_id, kind, body, owner_id, due_on, approved, source, sort)
    values (x.company_id, m.id, 'action', p ->> 'text', (p ->> 'owner_id')::uuid, (p ->> 'due_on')::date, true, 'proposal',
            coalesce((select max(sort) from public.meeting_points where meeting_id = m.id), 0) + 10)
    returning id into v_id;
    if (p ->> 'owner_id')::uuid <> auth.uid() then
      perform public.notify(x.company_id, (p ->> 'owner_id')::uuid, 'meeting_action', 'attention', 'Action for you: ' || left(p ->> 'text', 120),
        coalesce('Due ' || to_char((p ->> 'due_on')::date, 'DD Mon YYYY') || ' · ', '') || m.title, '/meetings/actions',
        'meeting-action:' || v_id || ':' || (p ->> 'owner_id'));
    end if;
    return 'meeting_points:' || v_id;
  end case;
  raise exception 'Unknown kind of change.' using errcode = '22023';
end;
$$;

-- Management approves (the change is made now, or nothing changes and the reason is shown) or rejects.
create or replace function public.meeting_proposal_decide(p_proposal uuid, p_approve boolean, p_note text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  x     public.meeting_proposals;
  m     public.meetings;
  v_ref text;
begin
  select * into x from public.meeting_proposals where id = p_proposal for update;
  if x.id is null or not public.is_manager(x.company_id) then
    raise exception 'Only management reviews proposed updates.' using errcode = '42501';
  end if;
  if x.status <> 'pending' then
    raise exception 'This update was already decided.' using errcode = '22023';
  end if;
  select * into m from public.meetings where id = x.meeting_id;
  if m.minutes_status not in ('ready', 'approved') then
    raise exception 'Write the minutes first.' using errcode = '22023';
  end if;
  if p_approve then
    v_ref := public.meeting_proposal_apply(x);
    update public.meeting_proposals
       set status = 'applied', applied_ref = left(v_ref, 120), decided_by = auth.uid(), decided_at = now(),
           decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
     where id = p_proposal;
  else
    update public.meeting_proposals
       set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
     where id = p_proposal;
  end if;
  return v_ref;
end;
$$;

-- ---------------------------------------------------------------------
-- 13. The client portal: invitations to us
-- ---------------------------------------------------------------------
-- Management switches the public request link on (made once) or off; p_new: a new link (the old one stops working).
create or replace function public.meeting_portal_set(p_company uuid, p_enabled boolean, p_new boolean, p_welcome text)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_token text;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can change the request page.' using errcode = '42501';
  end if;
  insert into public.meeting_portal (company_id, request_token, enabled, welcome, updated_by)
  values (p_company, public.meeting_random_code(), coalesce(p_enabled, true), nullif(left(btrim(coalesce(p_welcome, '')), 500), ''), auth.uid())
  on conflict (company_id) do update
     set enabled = coalesce(p_enabled, public.meeting_portal.enabled),
         request_token = case when p_new then public.meeting_random_code() else public.meeting_portal.request_token end,
         welcome = nullif(left(btrim(coalesce(p_welcome, '')), 500), ''), updated_by = auth.uid()
  returning request_token into v_token;
  return v_token;
end;
$$;

-- The link to share (organisers): {token, enabled, welcome} or null when not made yet.
create or replace function public.meeting_portal_link(p_company uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select case when public.has_role(p_company, public.meeting_organiser_roles()) then
    (select jsonb_build_object('token', request_token, 'enabled', enabled, 'welcome', welcome) from public.meeting_portal where company_id = p_company)
  end;
$$;

-- The public request page (service role only): the company's name and logo, or null.
create or replace function public.meeting_portal_info(p_token text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('company', c.name, 'logo_path', c.logo_path, 'welcome', p.welcome)
    from public.meeting_portal p join public.companies c on c.id = p.company_id
   where p_token ~ '^[0-9a-f]{40,64}$' and p.request_token = p_token and p.enabled
     and public.feature_on(c.id, 'meetings') and not coalesce(c.is_demo, false);
$$;

-- A client or supplier asks for a meeting (service role only). p keys: name, company, email, phone, topic, message,
-- proposed_at, minutes, link. p_sender: a hash of the sender's address and email made by the server (rate limit).
-- Returns {status: 'received' | 'invalid' (with error) | 'limited' | 'closed'}.
create or replace function public.meeting_portal_request(p_token text, p jsonb, p_sender text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_co    uuid;
  v_name  text := btrim(coalesce(p ->> 'name', ''));
  v_email text := public.inbox_email_of(nullif(btrim(coalesce(p ->> 'email', '')), ''));
  v_phone text := public.inbox_phone_of(nullif(btrim(coalesce(p ->> 'phone', '')), ''));
  v_topic text := btrim(coalesce(p ->> 'topic', ''));
  v_link  text := nullif(btrim(coalesce(p ->> 'link', '')), '');
  v_at    timestamptz;
  v_min   integer := case when (p ->> 'minutes') ~ '^\d{1,3}$' then (p ->> 'minutes')::integer else 30 end;
  v_party record;
  v_id    uuid;
begin
  select p2.company_id into v_co from public.meeting_portal p2 join public.companies c on c.id = p2.company_id
   where p_token ~ '^[0-9a-f]{40,64}$' and p2.request_token = p_token and p2.enabled and public.feature_on(c.id, 'meetings');
  if v_co is null then
    return jsonb_build_object('status', 'closed');
  end if;
  if p_sender is null or char_length(p_sender) not between 16 and 128 then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  delete from public.meeting_portal_hits where created_at < now() - interval '2 days';
  if (select count(*) from public.meeting_portal_hits where company_id = v_co and sender_hash = p_sender and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.meeting_portal_hits where company_id = v_co and created_at > now() - interval '1 day') >= 40 then
    return jsonb_build_object('status', 'limited');
  end if;
  insert into public.meeting_portal_hits (company_id, sender_hash) values (v_co, p_sender);
  -- Values that are not valid come back as {status: 'invalid', error} so the try above still counts.
  begin
  if char_length(v_name) not between 2 and 120 then
    raise exception 'Enter your name.' using errcode = '22023';
  end if;
  if v_email is null then
    raise exception 'Enter a valid email address so we can answer.' using errcode = '22023';
  end if;
  if v_phone is not null and length(v_phone) not between 9 and 15 then
    raise exception 'Enter a valid phone number.' using errcode = '22023';
  end if;
  if char_length(v_topic) not between 3 and 200 then
    raise exception 'Say what the meeting is about.' using errcode = '22023';
  end if;
  begin
    v_at := (p ->> 'proposed_at')::timestamptz;
  exception when others then
    v_at := null;
  end;
  if v_at is null or v_at < now() - interval '1 hour' or v_at > now() + interval '1 year' then
    raise exception 'Choose a date and time from now to one year ahead.' using errcode = '22023';
  end if;
  if v_min not between 15 and 240 then v_min := 30; end if;
  if not public.meeting_link_ok(v_link) then
    raise exception 'The meeting link must be a full https:// address.' using errcode = '22023';
  end if;
  select * into v_party from public.inbox_match_party(v_co, 'email', v_email);
  insert into public.meeting_invitations (company_id, source, requester_name, requester_company, requester_email, requester_phone, topic,
                                          message, proposed_at, minutes, external_link, client_id, supplier_id)
  values (v_co, 'portal', v_name, nullif(left(btrim(coalesce(p ->> 'company', '')), 160), ''), v_email, v_phone, v_topic,
          nullif(left(btrim(coalesce(p ->> 'message', '')), 2000), ''), v_at, v_min, v_link, v_party.client_id, v_party.supplier_id)
  returning id into v_id;
  perform public.notify_roles(v_co, array['management']::public.app_role[], null, 'meeting_request', 'attention',
    'Meeting request from ' || v_name || coalesce(' (' || nullif(btrim(coalesce(p ->> 'company', '')), '') || ')', ''),
    left(v_topic, 120) || ' · ' || to_char(v_at at time zone 'Africa/Dar_es_Salaam', 'Dy DD Mon HH24:MI'),
    '/meetings/invitations/' || v_id, 'meeting-req:' || v_id);
  exception when sqlstate '22023' or check_violation or invalid_text_representation then
    return jsonb_build_object('status', 'invalid', 'error', case when sqlstate = '22023' then sqlerrm else 'A value is not valid.' end);
  end;
  return jsonb_build_object('status', 'received', 'company_id', v_co, 'invitation_id', v_id);
end;
$$;

-- Staff paste an invitation they received (Zoom, Teams, Google Meet link). It goes straight on the calendar.
-- p keys: title, starts_at, minutes, link, organiser, organiser_company, organiser_email, notes, client_id, supplier_id, attendees.
create or replace function public.meeting_add_invitation(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_inv  uuid;
  v_id   uuid;
  v_link text := nullif(btrim(coalesce(p ->> 'link', '')), '');
  v_who  text := coalesce(nullif(btrim(coalesce(p ->> 'organiser', '')), ''), 'Not given');
  v_mail text := public.inbox_email_of(nullif(btrim(coalesce(p ->> 'organiser_email', '')), ''));
  v_party record;
begin
  if not public.has_role(p_company, public.meeting_organiser_roles()) then
    raise exception 'You cannot organise meetings.' using errcode = '42501';
  end if;
  if v_link is null or not public.meeting_link_ok(v_link) then
    raise exception 'Paste the full meeting link (it starts with https://).' using errcode = '22023';
  end if;
  if v_mail is not null and nullif(p ->> 'client_id', '') is null and nullif(p ->> 'supplier_id', '') is null then
    select * into v_party from public.inbox_match_party(p_company, 'email', v_mail);
  end if;
  v_id := public.meeting_insert(p_company,
    jsonb_build_object('title', p ->> 'title', 'purpose', p ->> 'notes', 'starts_at', p ->> 'starts_at', 'minutes', coalesce(p ->> 'minutes', '60'),
                       'external_link', v_link, 'record', false, 'open_to_team', false,
                       'client_id', coalesce(nullif(p ->> 'client_id', ''), v_party.client_id::text),
                       'supplier_id', coalesce(nullif(p ->> 'supplier_id', ''), v_party.supplier_id::text),
                       'kind', case when coalesce(nullif(p ->> 'client_id', ''), v_party.client_id::text) is not null then 'client'
                                    when coalesce(nullif(p ->> 'supplier_id', ''), v_party.supplier_id::text) is not null then 'supplier'
                                    else 'external' end,
                       'attendees', coalesce(p -> 'attendees', '[]')),
    null, auth.uid());
  insert into public.meeting_invitations (company_id, source, requester_name, requester_company, requester_email, topic, message,
                                          proposed_at, minutes, external_link, client_id, supplier_id, status, meeting_id,
                                          decided_by, decided_at, created_by)
  select p_company, 'pasted', left(v_who, 120), nullif(left(btrim(coalesce(p ->> 'organiser_company', '')), 160), ''), v_mail,
         left(m.title, 200), m.purpose, m.starts_at, m.minutes, v_link, m.client_id, m.supplier_id, 'accepted', m.id,
         auth.uid(), now(), auth.uid()
    from public.meetings m where m.id = v_id
  returning id into v_inv;
  update public.meetings set invitation_id = v_inv where id = v_id;
  return v_id;
end;
$$;

-- Management accepts (a meeting is made, with their link or our own room, and the person who asked as a guest)
-- or declines with a reply. Returns the meeting id when accepted.
create or replace function public.meeting_decide_invitation(p_invitation uuid, p_accept boolean, p_reply text, p_starts_at timestamptz,
                                                            p_attendees uuid[])
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  x    public.meeting_invitations;
  v_id uuid;
begin
  select * into x from public.meeting_invitations where id = p_invitation for update;
  if x.id is null or not public.is_manager(x.company_id) then
    raise exception 'Only management answers meeting requests.' using errcode = '42501';
  end if;
  if x.status <> 'pending' then
    raise exception 'This request was already answered.' using errcode = '22023';
  end if;
  if not p_accept then
    update public.meeting_invitations
       set status = 'declined', reply = nullif(left(btrim(coalesce(p_reply, '')), 2000), ''), decided_by = auth.uid(), decided_at = now()
     where id = p_invitation;
    return null;
  end if;
  v_id := public.meeting_insert(x.company_id,
    jsonb_build_object('title', left(x.topic || ' · ' || coalesce(x.requester_company, x.requester_name), 160), 'purpose', x.message,
                       'starts_at', coalesce(p_starts_at, x.proposed_at), 'minutes', x.minutes, 'external_link', x.external_link,
                       'client_id', x.client_id, 'supplier_id', x.supplier_id, 'open_to_team', false,
                       'kind', case when x.client_id is not null then 'client' when x.supplier_id is not null then 'supplier' else 'external' end,
                       'attendees', to_jsonb(coalesce(p_attendees, '{}'::uuid[]))),
    null, auth.uid());
  insert into public.meeting_attendees (company_id, meeting_id, guest_name, guest_email, guest_phone, guest_org, client_id, supplier_id, role, response)
  values (x.company_id, v_id, x.requester_name, x.requester_email, x.requester_phone, x.requester_company, x.client_id, x.supplier_id, 'guest', 'accepted');
  update public.meetings set invitation_id = x.id where id = v_id;
  update public.meeting_invitations
     set status = 'accepted', meeting_id = v_id, reply = nullif(left(btrim(coalesce(p_reply, '')), 2000), ''),
         decided_by = auth.uid(), decided_at = now()
   where id = p_invitation;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 14. Calendar
-- ---------------------------------------------------------------------
create or replace function public.calendar_add_entry(p_company uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_clean jsonb;
  v_id    uuid;
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  v_clean := public.meeting_proposal_clean(p_company, 'calendar_entry', p);
  insert into public.calendar_entries (company_id, title, kind, starts_on, ends_on, at_time, notes, owner_id, private, created_by)
  values (p_company, v_clean ->> 'title', v_clean ->> 'kind', (v_clean ->> 'starts_on')::date, (v_clean ->> 'ends_on')::date,
          (v_clean ->> 'at_time')::time, v_clean ->> 'notes', coalesce((v_clean ->> 'owner_id')::uuid, auth.uid()),
          coalesce((p ->> 'private')::boolean, false), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.calendar_remove_entry(p_entry uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  e public.calendar_entries;
begin
  select * into e from public.calendar_entries where id = p_entry;
  if e.id is null or not (public.is_manager(e.company_id) or (e.created_by = auth.uid() and public.is_member(e.company_id))) then
    raise exception 'Calendar entry not found.' using errcode = '42501';
  end if;
  delete from public.calendar_entries where id = p_entry;
end;
$$;

-- Internal: the dates one person may see, from p_from to p_to (at most 400 days), of the chosen kinds.
-- Kinds: meeting, action, entry, delivery, supplies, quotation, invoice, compliance, leave, follow_up.
-- Each item: {uid, date, end, time, kind, title, notes, href}.
create or replace function public.calendar_items_for(p_company uuid, p_user uuid, p_from date, p_to date, p_kinds text[])
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role  public.app_role;
  v_mgr   boolean;
  v_to    date := least(p_to, p_from + 400);
  k       text[] := coalesce(p_kinds, array['meeting', 'action', 'entry', 'delivery', 'supplies', 'quotation', 'invoice', 'compliance', 'leave', 'follow_up']);
  res     jsonb := '[]'::jsonb;
begin
  select role into v_role from public.memberships where company_id = p_company and user_id = p_user and active;
  if v_role is null or p_from is null or v_to is null or v_to < p_from then
    return '[]'::jsonb;
  end if;
  v_mgr := v_role = 'management';
  if 'meeting' = any (k) then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'm-' || m.id, 'date', m.meeting_date,
             'time', to_char(m.starts_at at time zone 'Africa/Dar_es_Salaam', 'HH24:MI') || '-'
                     || to_char((m.starts_at + make_interval(mins => m.minutes)) at time zone 'Africa/Dar_es_Salaam', 'HH24:MI'),
             'kind', 'meeting', 'title', m.title || case when m.status = 'cancelled' then ' (cancelled)' else '' end,
             'notes', concat_ws(' · ', m.place, case m.video_provider when 'external' then 'Online (their link)' when 'none' then null else 'Video in the app' end),
             'href', '/meetings/' || m.id))
      from public.meetings m
     where m.company_id = p_company and m.meeting_date between p_from and v_to and m.status <> 'cancelled'
       and (v_mgr or m.open_to_team or m.created_by = p_user or m.chair_id = p_user or m.presenter_id = p_user
            or exists (select 1 from public.meeting_attendees a where a.meeting_id = m.id and a.user_id = p_user))), '[]');
  end if;
  if 'action' = any (k) then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'a-' || p.id, 'date', p.due_on, 'kind', 'action',
             'title', 'Action: ' || left(p.body, 120) || coalesce(' (' || nullif(btrim(pr.full_name), '') || ')', ''),
             'notes', 'From ' || m.title, 'href', '/meetings/actions'))
      from public.meeting_points p join public.meetings m on m.id = p.meeting_id left join public.profiles pr on pr.id = p.owner_id
     where p.company_id = p_company and p.approved and p.kind = 'action' and p.status in ('open', 'in_progress')
       and p.due_on between p_from and v_to and (v_mgr or p.owner_id = p_user)), '[]');
  end if;
  if 'entry' = any (k) then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'c-' || e.id, 'date', e.starts_on, 'end', e.ends_on,
             'time', to_char(e.at_time, 'HH24:MI'), 'kind', e.kind, 'title', e.title, 'notes', e.notes,
             'href', case when e.meeting_id is not null then '/meetings/' || e.meeting_id else '/calendar?entry=' || e.id end, 'entry_id', e.id))
      from public.calendar_entries e
     where e.company_id = p_company and e.starts_on <= v_to and coalesce(e.ends_on, e.starts_on) >= p_from
       and (not e.private or e.owner_id = p_user or e.created_by = p_user or v_mgr)), '[]');
  end if;
  if 'delivery' = any (k) and v_role in ('management', 'sales', 'warehouse', 'finance', 'driver') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'd-' || d.id, 'date', d.planned_date, 'kind', 'delivery',
             'title', 'Deliver ' || coalesce(d.number, '') || coalesce(' to ' || c.name, ''), 'notes', d.delivery_site, 'href', '/deliveries/' || d.id))
      from public.deliveries d left join public.clients c on c.id = d.client_id
     where d.company_id = p_company and d.planned_date between p_from and v_to and d.status in ('draft', 'dispatched')
       and (v_role <> 'driver' or d.driver_id = p_user)), '[]');
  end if;
  if 'supplies' = any (k) and v_role in ('management', 'procurement', 'finance', 'warehouse') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'o-' || po.id, 'date', po.expected_date, 'kind', 'supplies',
             'title', coalesce(po.number, 'Order') || coalesce(' from ' || s.name, '') || ' arriving', 'href', '/purchase-orders/' || po.id))
      from public.purchase_orders po left join public.suppliers s on s.id = po.supplier_id
     where po.company_id = p_company and po.expected_date between p_from and v_to
       and po.status in ('approved', 'sent', 'confirmed', 'partially_received')), '[]');
  end if;
  if 'quotation' = any (k) and v_role in ('management', 'sales', 'procurement', 'finance') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'q-' || q.id, 'date', q.valid_until, 'kind', 'quotation',
             'title', coalesce(q.number, 'Quotation') || coalesce(' · ' || c.name, '') || ' valid until', 'href', '/quotations/' || q.id))
      from public.quotations q left join public.clients c on c.id = q.client_id
     where q.company_id = p_company and q.valid_until between p_from and v_to and q.status in ('approved', 'sent')), '[]');
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'r-' || r.id, 'date', r.due_on, 'kind', 'quotation',
             'title', 'Quote due: ' || coalesce(r.title, r.number, '') || coalesce(' · ' || c.name, ''), 'href', '/rfqs/' || r.id))
      from public.rfqs r left join public.clients c on c.id = r.client_id
     where r.company_id = p_company and r.due_on between p_from and v_to and r.status in ('new', 'quoting')), '[]');
  end if;
  if 'invoice' = any (k) and v_role in ('management', 'finance', 'sales') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'i-' || i.id, 'date', i.due_date, 'kind', 'invoice',
             'title', coalesce(i.number, 'Invoice') || coalesce(' · ' || c.name, '') || ' due', 'href', '/invoices/' || i.id))
      from public.invoices i left join public.clients c on c.id = i.client_id
     where i.company_id = p_company and i.due_date between p_from and v_to and i.status in ('issued', 'partly_paid')), '[]');
  end if;
  if 'compliance' = any (k) and v_role <> 'driver' then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'f-' || d.id, 'date', d.due_on, 'kind', 'compliance',
             'title', 'File: ' || i.name, 'notes', public.compliance_period_label(d.period_start, d.period_end), 'href', '/compliance/calendar'))
      from public.compliance_deadlines d join public.compliance_items i on i.id = d.item_id
     where d.company_id = p_company and d.status = 'open' and i.status <> 'not_applicable' and d.due_on between p_from and v_to), '[]');
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'l-' || l.id, 'date', l.expires_on, 'kind', 'compliance',
             'title', 'Licence expires: ' || l.name, 'notes', l.authority, 'href', '/compliance/licences/' || l.id))
      from public.licences l
     where l.company_id = p_company and l.status in ('active', 'expired') and l.expires_on between p_from and v_to), '[]');
  end if;
  if 'leave' = any (k) then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'v-' || l.id, 'date', l.starts_on, 'end', l.ends_on, 'kind', 'leave',
             'title', e.full_name || ' on leave', 'href', '/hr/leave'))
      from public.leave_requests l join public.employees e on e.id = l.employee_id
     where l.company_id = p_company and l.status = 'approved' and l.starts_on <= v_to and l.ends_on >= p_from
       and (v_role in ('management', 'finance') or e.user_id = p_user)), '[]');
  end if;
  if 'follow_up' = any (k) and v_role in ('management', 'sales') then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'p-' || o.id, 'date', o.next_on, 'kind', 'follow_up',
             'title', 'Follow up: ' || o.title, 'notes', o.next_action, 'href', '/crm/' || o.id))
      from public.opportunities o
     where o.company_id = p_company and o.stage not in ('won', 'lost') and o.next_on between p_from and v_to), '[]');
    res := res || coalesce((select jsonb_agg(jsonb_build_object('uid', 'u-' || f.id, 'date', f.next_on, 'kind', 'follow_up',
             'title', 'Follow up ' || coalesce(q.number, i.number, ''), 'notes', f.note,
             'href', case when f.quotation_id is not null then '/quotations/' || f.quotation_id else '/invoices/' || f.invoice_id end))
      from public.followups f left join public.quotations q on q.id = f.quotation_id left join public.invoices i on i.id = f.invoice_id
     where f.company_id = p_company and f.next_on between p_from and v_to), '[]');
  end if;
  return res;
end;
$$;

-- The calendar screen.
create or replace function public.calendar_items(p_company uuid, p_from date, p_to date, p_kinds text[] default null)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  return public.calendar_items_for(p_company, auth.uid(), p_from, p_to, p_kinds);
end;
$$;

-- My private calendar link (made once; p_new: a new link, the old one stops working). Returns the token.
create or replace function public.calendar_link(p_company uuid, p_new boolean, p_kinds text[] default null)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  v_token text;
  v_kinds text[];
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_kinds from unnest(coalesce(p_kinds, '{}'::text[])) x
   where x in ('meeting', 'action', 'entry', 'delivery', 'supplies', 'quotation', 'invoice', 'compliance', 'leave', 'follow_up');
  if p_new then
    update public.calendar_links set revoked_at = now() where company_id = p_company and user_id = auth.uid() and revoked_at is null;
  end if;
  select feed_token into v_token from public.calendar_links where company_id = p_company and user_id = auth.uid() and revoked_at is null;
  if v_token is null then
    insert into public.calendar_links (company_id, user_id, feed_token) values (p_company, auth.uid(), public.meeting_random_code())
    returning feed_token into v_token;
  end if;
  if cardinality(v_kinds) > 0 then
    update public.calendar_links set kinds = v_kinds where feed_token = v_token;
  end if;
  return v_token;
end;
$$;

create or replace function public.calendar_link_off(p_company uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  update public.calendar_links set revoked_at = now() where company_id = p_company and user_id = auth.uid() and revoked_at is null;
end;
$$;

-- The .ics feed (service role only): the token is checked here; 30 days back, one year ahead.
create or replace function public.calendar_feed(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  l  public.calendar_links;
  v_today date := public.meeting_today();
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into l from public.calendar_links where feed_token = p_token and revoked_at is null;
  if l.id is null or not exists (select 1 from public.memberships where company_id = l.company_id and user_id = l.user_id and active)
     or not public.feature_on(l.company_id, 'calendar') then
    return null;
  end if;
  update public.calendar_links set last_used_at = now() where id = l.id and (last_used_at is null or last_used_at < now() - interval '1 hour');
  return jsonb_build_object('company', (select name from public.companies where id = l.company_id),
                            'name', (select coalesce(nullif(btrim(full_name), ''), email) from public.profiles where id = l.user_id),
                            'items', public.calendar_items_for(l.company_id, l.user_id, v_today - 30, v_today + 366, l.kinds));
end;
$$;

-- ---------------------------------------------------------------------
-- 15. Reminders (run with the other alerts)
-- ---------------------------------------------------------------------
create or replace function public.run_meeting_alerts(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_today  date := public.meeting_today();
  v_before bigint;
  v_after  bigint;
  r        record;
begin
  if not exists (select 1 from public.companies where id = p_company) or not public.feature_on(p_company, 'meetings') then
    return 0;
  end if;
  select count(*) into v_before from public.notifications where company_id = p_company;
  -- Approved actions: two days before, on the day, and every week once late.
  for r in select p.id, p.body, p.owner_id, p.due_on, m.title from public.meeting_points p join public.meetings m on m.id = p.meeting_id
            where p.company_id = p_company and p.approved and p.kind = 'action' and p.status in ('open', 'in_progress')
              and p.owner_id is not null and p.due_on <= v_today + 2 loop
    perform public.notify(p_company, r.owner_id, 'meeting_action_due',
      case when r.due_on <= v_today then 'critical' else 'attention' end,
      case when r.due_on < v_today then 'Action overdue: ' when r.due_on = v_today then 'Action due today: ' else 'Action due soon: ' end || left(r.body, 120),
      'Due ' || to_char(r.due_on, 'DD Mon YYYY') || ' · from ' || r.title, '/meetings/actions',
      'mact-' || r.id || '-' || case when r.due_on < v_today then 'late-' || ((v_today - r.due_on) / 7) when r.due_on = v_today then 'today' else 'soon' end);
  end loop;
  -- Meetings tomorrow or today: attendees are reminded once.
  for r in select m.id, m.title, m.starts_at, m.place, a.user_id from public.meetings m join public.meeting_attendees a on a.meeting_id = m.id
            where m.company_id = p_company and m.status = 'planned' and a.user_id is not null and a.response <> 'declined'
              and m.starts_at between now() and now() + interval '24 hours' loop
    perform public.notify(p_company, r.user_id, 'meeting_soon', 'attention', 'Meeting soon: ' || r.title,
      to_char(r.starts_at at time zone 'Africa/Dar_es_Salaam', 'Dy DD Mon HH24:MI') || coalesce(' · ' || r.place, ''),
      '/meetings/' || r.id, 'meeting-soon:' || r.id || ':' || r.user_id);
  end loop;
  -- Calendar dates with an owner: the day before.
  for r in select e.id, e.title, e.starts_on, e.owner_id from public.calendar_entries e
            where e.company_id = p_company and e.owner_id is not null and e.starts_on between v_today and v_today + 1 loop
    perform public.notify(p_company, r.owner_id, 'calendar_entry', 'attention',
      case when r.starts_on = v_today then 'Today: ' else 'Tomorrow: ' end || r.title, to_char(r.starts_on, 'Dy DD Mon YYYY'),
      '/calendar', 'cal-' || r.id || '-' || r.starts_on);
  end loop;
  select count(*) into v_after from public.notifications where company_id = p_company;
  return v_after - v_before;
end;
$$;

-- Scheduled entry point: as the compliance update left it, plus the meeting reminders of each company.
create or replace function public.run_all_alerts(p_secret text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  v_total int := 0;
begin
  if not public.secret_ok('outbox', p_secret) then
    raise exception 'Not allowed.' using errcode = '42501';
  end if;
  perform public.purge_demo_companies();
  for c in select id from public.companies loop
    v_total := v_total + public.run_company_alerts(c.id);
    -- Compliance reminders never stop the other alerts.
    begin
      v_total := v_total + public.run_compliance_alerts(c.id);
    exception when others then
      raise warning 'Compliance alerts failed for %: %', c.id, sqlerrm;
    end;
    -- Nor do the meeting reminders.
    begin
      v_total := v_total + public.run_meeting_alerts(c.id);
    exception when others then
      raise warning 'Meeting alerts failed for %: %', c.id, sqlerrm;
    end;
  end loop;
  -- Growth recommendations never stop the alerts (each company is also
  -- protected inside run_all_growth_checks).
  begin
    perform public.run_all_growth_checks();
  exception when others then
    raise warning 'Growth checks failed: %', sqlerrm;
  end;
  begin
    v_total := v_total + public.run_report_schedules();
  exception when others then
    raise warning 'Scheduled reports failed: %', sqlerrm;
  end;
  return v_total;
end;
$$;

-- Called when someone opens the app: as before (at most every 30 minutes), plus compliance and meetings.
create or replace function public.refresh_alerts(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_last timestamptz;
  v_n    integer;
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  select alerts_checked_at into v_last from public.companies where id = p_company for update;
  if v_last is not null and v_last > now() - interval '30 minutes' then
    return 0;
  end if;
  v_n := public.run_company_alerts(p_company);
  begin
    v_n := v_n + public.run_compliance_alerts(p_company);
  exception when others then
    raise warning 'Compliance alerts failed: %', sqlerrm;
  end;
  begin
    v_n := v_n + public.run_meeting_alerts(p_company);
  exception when others then
    raise warning 'Meeting alerts failed: %', sqlerrm;
  end;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 16. Summary for the list and the dashboard card
-- ---------------------------------------------------------------------
create or replace function public.meeting_summary(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := public.meeting_today();
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'next', (select jsonb_build_object('id', m.id, 'title', m.title, 'starts_at', m.starts_at, 'status', m.status)
               from public.meetings m where m.company_id = p_company and m.status in ('planned', 'live')
                and m.starts_at >= now() - interval '3 hours' and public.meeting_visible(p_company, m.id)
              order by (m.status = 'live') desc, m.starts_at limit 1),
    'live', (select count(*) from public.meetings m where m.company_id = p_company and m.status = 'live' and public.meeting_visible(p_company, m.id)),
    'to_approve', (select count(*) from public.meetings m where m.company_id = p_company and m.status = 'held' and m.minutes_status in ('ready', 'writing', 'failed', 'none')
                     and public.meeting_can_manage(m.id)),
    'my_actions', (select count(*) from public.meeting_points where company_id = p_company and approved and kind = 'action'
                     and owner_id = auth.uid() and status in ('open', 'in_progress')),
    'my_overdue', (select count(*) from public.meeting_points where company_id = p_company and approved and kind = 'action'
                     and owner_id = auth.uid() and status in ('open', 'in_progress') and due_on < v_today),
    'open_actions', (select count(*) from public.meeting_points where company_id = p_company and approved and kind = 'action' and status in ('open', 'in_progress')),
    'requests', case when public.is_manager(p_company) then (select count(*) from public.meeting_invitations where company_id = p_company and status = 'pending') else 0 end,
    'proposals', case when public.is_manager(p_company) then (select count(*) from public.meeting_proposals where company_id = p_company and status = 'pending') else 0 end,
    'can_organise', public.has_role(p_company, public.meeting_organiser_roles()),
    'is_manager', public.is_manager(p_company));
end;
$$;

-- ---------------------------------------------------------------------
-- 17. Who may call the functions
-- ---------------------------------------------------------------------
revoke execute on function
  public.meeting_organiser_roles(), public.meeting_topics(), public.meeting_today(), public.meeting_random_code(),
  public.meeting_token_digest(text), public.meeting_link_ok(text), public.meeting_visible(uuid, uuid), public.meeting_can_manage(uuid),
  public.meeting_can_approve(uuid), public.meeting_can_note(uuid), public.prepare_meeting_row(),
  public.meeting_insert(uuid, jsonb, uuid, uuid), public.meeting_create(uuid, jsonb), public.meeting_update(uuid, jsonb),
  public.meeting_cancel(uuid, text), public.meeting_save_series(uuid, uuid, jsonb), public.meeting_series_occurs(public.meeting_series, date),
  public.meeting_schedule_series(uuid, integer), public.meeting_add_guest(uuid, jsonb), public.meeting_remove_attendee(uuid),
  public.meeting_guest_link(uuid, integer), public.meeting_guest_view(text), public.meeting_guest_joined(text), public.meeting_joined(uuid),
  public.meeting_set_present(uuid, boolean), public.meeting_respond(uuid, boolean), public.meeting_set_video(uuid, text, text, text),
  public.meeting_add_agenda(uuid, jsonb), public.meeting_agenda_item(uuid, text), public.meeting_agenda_candidates(uuid),
  public.meeting_start(uuid, boolean), public.meeting_add_line(uuid, text, text, text), public.meeting_save_text(uuid, text, text),
  public.meeting_end(uuid), public.meeting_minutes_state(uuid, text, text), public.meeting_proposal_clean(uuid, text, jsonb),
  public.meeting_save_minutes(uuid, jsonb), public.meeting_save_point(uuid, uuid, jsonb), public.meeting_delete_point(uuid),
  public.meeting_set_point_status(uuid, text, text), public.meeting_approve_minutes(uuid),
  public.meeting_proposal_add(uuid, text, text, jsonb, uuid), public.meeting_proposal_edit(uuid, text, jsonb),
  public.meeting_proposal_apply(public.meeting_proposals), public.meeting_proposal_decide(uuid, boolean, text),
  public.meeting_portal_set(uuid, boolean, boolean, text), public.meeting_portal_link(uuid), public.meeting_portal_info(text),
  public.meeting_portal_request(text, jsonb, text), public.meeting_add_invitation(uuid, jsonb),
  public.meeting_decide_invitation(uuid, boolean, text, timestamptz, uuid[]),
  public.calendar_add_entry(uuid, jsonb), public.calendar_remove_entry(uuid), public.calendar_items_for(uuid, uuid, date, date, text[]),
  public.calendar_items(uuid, date, date, text[]), public.calendar_link(uuid, boolean, text[]), public.calendar_link_off(uuid),
  public.calendar_feed(text), public.run_meeting_alerts(uuid), public.run_all_alerts(text), public.refresh_alerts(uuid),
  public.meeting_summary(uuid)
from public, anon, authenticated;

-- Used inside the security rules and the screens.
grant execute on function
  public.meeting_organiser_roles(), public.meeting_topics(), public.meeting_visible(uuid, uuid), public.meeting_can_manage(uuid),
  public.meeting_can_approve(uuid), public.meeting_can_note(uuid),
  public.meeting_create(uuid, jsonb), public.meeting_update(uuid, jsonb), public.meeting_cancel(uuid, text),
  public.meeting_save_series(uuid, uuid, jsonb), public.meeting_schedule_series(uuid, integer), public.meeting_add_guest(uuid, jsonb),
  public.meeting_remove_attendee(uuid), public.meeting_guest_link(uuid, integer), public.meeting_joined(uuid),
  public.meeting_set_present(uuid, boolean), public.meeting_respond(uuid, boolean), public.meeting_set_video(uuid, text, text, text),
  public.meeting_add_agenda(uuid, jsonb), public.meeting_agenda_item(uuid, text), public.meeting_agenda_candidates(uuid),
  public.meeting_start(uuid, boolean), public.meeting_add_line(uuid, text, text, text), public.meeting_save_text(uuid, text, text),
  public.meeting_end(uuid), public.meeting_minutes_state(uuid, text, text), public.meeting_save_minutes(uuid, jsonb),
  public.meeting_save_point(uuid, uuid, jsonb), public.meeting_delete_point(uuid), public.meeting_set_point_status(uuid, text, text),
  public.meeting_approve_minutes(uuid), public.meeting_proposal_add(uuid, text, text, jsonb, uuid),
  public.meeting_proposal_edit(uuid, text, jsonb), public.meeting_proposal_decide(uuid, boolean, text),
  public.meeting_portal_set(uuid, boolean, boolean, text), public.meeting_portal_link(uuid), public.meeting_add_invitation(uuid, jsonb),
  public.meeting_decide_invitation(uuid, boolean, text, timestamptz, uuid[]),
  public.calendar_add_entry(uuid, jsonb), public.calendar_remove_entry(uuid), public.calendar_items(uuid, date, date, text[]),
  public.calendar_link(uuid, boolean, text[]), public.calendar_link_off(uuid), public.meeting_summary(uuid), public.refresh_alerts(uuid)
to authenticated;

-- Only the public pages (server side, service role key).
grant execute on function
  public.meeting_guest_view(text), public.meeting_guest_joined(text), public.meeting_portal_info(text),
  public.meeting_portal_request(text, jsonb, text), public.calendar_feed(text)
to service_role;

-- The scheduler calls this with the public (anon) key plus the outbox secret, as before.
grant execute on function public.run_all_alerts(text) to anon, authenticated;

notify pgrst, 'reload schema';
