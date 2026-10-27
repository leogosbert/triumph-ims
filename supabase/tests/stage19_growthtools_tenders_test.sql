-- Tests for tender alerts: settings, notices (pasted, from the Inbox, from web sources), reading and
-- scoring, duplicates, one tap to a tender, the job's functions and the daily digest.
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
create or replace function tests.blocked(p_sql text, p_label text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FAILED (was allowed): %', p_label;
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'pass: % (blocked: %)', p_label, sqlerrm;
end $$;
grant execute on all functions in schema tests to authenticated, anon, service_role;

insert into auth.users (email) values ('boss.ta@g.test'), ('sales.ta@g.test'), ('fin.ta@g.test'), ('other.ta@g.test');
select id as boss from auth.users where email = 'boss.ta@g.test' \gset
select id as sales from auth.users where email = 'sales.ta@g.test' \gset
select id as fin from auth.users where email = 'fin.ta@g.test' \gset
select id as outsider from auth.users where email = 'other.ta@g.test' \gset

select tests.login('boss.ta@g.test'); set role authenticated;
select public.create_company('Tender Alerts Co') as co \gset
reset role;
select tests.login('other.ta@g.test'); set role authenticated;
select public.create_company('Other Tender Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role) values (:'co', :'sales', 'sales'), (:'co', :'fin', 'finance');
insert into public.clients (company_id, name) values (:'co', 'Geita Gold Mining Ltd') returning id as client \gset
insert into public.products (company_id, name, category, brand) values
  (:'co', 'Hydraulic oil ISO VG 68', 'Lubricants', 'Shell'),
  (:'co', 'Gate valve DN100', 'Valves', 'KSB');

-- ---- 1. Feature and settings ------------------------------------------------------------------
select tests.check((select default_level = 'medium' and status = 'live' and route = '/tenders/alerts'
                      from public.features where key = 'tender_alerts'), 'tender alerts: a live medium feature');
select tests.check(public.feature_on(:'co', 'tender_alerts'), 'on for a new (medium) company');

select tests.login('sales.ta@g.test'); set role authenticated;
select public.tender_save_settings(:'co', '{"keywords": ["lubricants", " Valves ", "lubricants", ""], "exclude_keywords": ["catering"], "min_score": 30}');
select tests.check((select keywords = array['lubricants', 'Valves'] and exclude_keywords = array['catering'] and min_score = 30
                      from public.tender_alert_settings where company_id = :'co'), 'sales saves keywords (trimmed, no repeats or blanks)');
select tests.blocked(format('select public.tender_save_settings(%L, %L)', :'co', '{"min_score": 300}'), 'score out of range refused');
select tests.check((public.tender_context(:'co') -> 'product_categories') ? 'Lubricants'
                   and jsonb_array_length(public.tender_context(:'co') -> 'products') = 2,
  'matching context lists the product categories and products');
reset role;

select tests.login('fin.ta@g.test'); set role authenticated;
select tests.blocked(format('select public.tender_save_settings(%L, %L)', :'co', '{}'), 'finance cannot change tender alerts');
select tests.blocked(format('select public.tender_context(%L)', :'co'), 'finance cannot read the matching context');
select tests.check((select count(*) from public.tender_alert_settings) = 0, 'finance does not see the settings');
reset role;

-- ---- 2. Pasted notices, reading and duplicates -----------------------------------------------------
select tests.login('sales.ta@g.test'); set role authenticated;
select public.tender_notice_add(:'co', jsonb_build_object('raw_text',
  'Geita Gold Mining Ltd invites bids for the supply of lubricants and hydraulic oils. Tender No. GGML/2026/LUB/014. Closing date 20 November 2026 at 10:00.',
  'url', 'https://example.com/tenders/14')) as n1 \gset
select tests.check((select source = 'paste' and status = 'new' and created_by = :'sales' and url = 'https://example.com/tenders/14'
                      from public.tender_notices where id = :'n1'), 'a pasted advert waits to be read');
select tests.blocked(format('select public.tender_notice_add(%L, %L)', :'co', '{"raw_text": "too short"}'), 'a few words are not an advert');
select tests.blocked(format('insert into public.tender_notices (company_id, source, status) values (%L, %L, %L)', :'co', 'paste', 'matched'),
  'notices cannot be written directly');
select tests.blocked(format('update public.tender_notices set status = %L where id = %L', 'converted', :'n1'), 'status only through the functions');

select public.tender_notice_save(:'n1', jsonb_build_object(
  'title', 'Supply of lubricants and hydraulic oils', 'buyer', 'Geita Gold Mining Ltd', 'reference', 'GGML/2026/LUB/014',
  'closing_at', (now() + interval '20 days')::text, 'documents_required', jsonb_build_array('Tax clearance certificate', 'GCLA registration', 'Tax clearance certificate'),
  'bid_security', 'TZS 2,000,000', 'extracted_by', 'ai', 'score', 78, 'decision', 'bid',
  'reasons', jsonb_build_array(jsonb_build_object('kind', 'fit', 'ok', true, 'text', 'Matches Lubricants')),
  'matched', jsonb_build_array('Lubricants'))) as st \gset
select tests.check(:'st' = 'matched', 'reading a notice makes it matched');
select tests.check((select title = 'Supply of lubricants and hydraulic oils' and reference = 'GGML/2026/LUB/014' and score = 78
                           and decision = 'bid' and extracted_by = 'ai' and cardinality(documents_required) = 2
                           and fingerprint like 'ref:%' and jsonb_array_length(reasons) = 1
                      from public.tender_notices where id = :'n1'), 'the fields, score and reasons are saved (repeated papers once)');

-- The same tender again (other wording, same reference) is recognised.
select public.tender_notice_add(:'co', jsonb_build_object('raw_text', 'NeST alert: Supply of lubricants, Tender GGML-2026-LUB-014, Geita Gold Mining.')) as n2 \gset
select public.tender_notice_save(:'n2', '{"reference": "GGML-2026-LUB-014", "title": "Lubricants", "extracted_by": "rules", "score": 70}') as st2 \gset
select tests.check(:'st2' = 'dismissed' and (select duplicate_of = :'n1'::uuid and dismissed_reason is not null
                                               from public.tender_notices where id = :'n2'),
  'the same reference read again is dismissed as a repeat');
select tests.blocked(format('select public.tender_notice_add(%L, %L)', :'co',
  jsonb_build_object('raw_text', 'Another copy of the advert text here', 'reference', 'GGML/2026/LUB/014')), 'adding a known reference is refused');
select public.tender_notice_restore(:'n2');
select tests.check((select status = 'matched' and duplicate_of is null and fingerprint is null from public.tender_notices where id = :'n2'),
  'a repeat can be brought back (it no longer counts as the same tender)');
select public.tender_notice_dismiss(:'n2', 'Same as the other one');
select tests.check((select status = 'dismissed' and dismissed_reason = 'Same as the other one' and decided_by = :'sales'
                      from public.tender_notices where id = :'n2'), 'dismissed with a reason');

-- ---- 3. One tap to a tender ------------------------------------------------------------------------------
select public.tender_notice_to_tender(:'n1', :'client', null) as t1 \gset
select tests.check((select client_id = :'client' and reference = 'GGML/2026/LUB/014' and title = 'Supply of lubricants and hydraulic oils'
                           and status = 'preparing' and owner_id = :'sales' and notes like 'From tender alerts (score 78)%'
                      from public.tenders where id = :'t1'), 'Make tender: a tender record with the buyer, reference and closing date');
select tests.check((select count(*) from public.tender_tasks where tender_id = :'t1') = 10,
  'the usual 9 steps plus the paper the notice asks for that is not on the list (GCLA)');
select tests.check((select status = 'converted' and tender_id = :'t1' from public.tender_notices where id = :'n1'), 'the notice is converted');
select tests.check(public.tender_notice_to_tender(:'n1', null, null) = :'t1'::uuid, 'a second tap opens the same tender');
select tests.blocked(format('select public.tender_notice_dismiss(%L, null)', :'n1'), 'a converted notice cannot be dismissed');

select public.tender_notice_add(:'co', '{"title": "Supply of valves for the sugar factory", "raw_text": "Kilombero Sugar invites quotations for gate valves."}') as n3 \gset
select tests.blocked(format('select public.tender_notice_to_tender(%L, null, null)', :'n3'), 'no closing date: asked for one');
select public.tender_notice_save(:'n3', '{"buyer": "Kilombero Sugar Co", "extracted_by": "person"}') as x \gset
select public.tender_notice_to_tender(:'n3', null, (now() + interval '5 days')) as t3 \gset
select tests.check((select buyer_name = 'Kilombero Sugar Co' and client_id is null from public.tenders where id = :'t3'),
  'a buyer who is not a client is kept by name');
reset role;

select tests.login('fin.ta@g.test'); set role authenticated;
select tests.check((select count(*) from public.tender_notices) = 0, 'finance does not see notices');
select tests.blocked(format('select public.tender_notice_add(%L, %L)', :'co', '{"raw_text": "Invitation for bids for the supply of chemicals"}'),
  'finance cannot add notices');
reset role;
select tests.login('other.ta@g.test'); set role authenticated;
select tests.check((select count(*) from public.tender_notices where company_id = :'co') = 0, 'another company sees no notices');
select tests.blocked(format('select public.tender_notice_dismiss(%L, null)', :'n3'), 'another company cannot act on a notice');
reset role;

-- ---- 4. Tender emails in the Inbox -------------------------------------------------------------------------
insert into public.inbox_settings (company_id, inbound_address) values (:'co', 'tenders-co@in.example.test');
set role service_role;
select public.inbox_record_inbound(jsonb_build_object('channel', 'email', 'provider', 'generic', 'provider_message_id', 'm-1',
  'from', 'NeST Alerts <alerts@nest.go.tz>', 'to', jsonb_build_array('tenders-co@in.example.test'),
  'subject', 'Tender Notice: Supply of industrial lubricants', 'text', 'A new tender matching your category was published on NeST.')) as r1 \gset
select public.inbox_record_inbound(jsonb_build_object('channel', 'email', 'provider', 'generic', 'provider_message_id', 'm-2',
  'from', 'asha@client.example.test', 'to', jsonb_build_array('tenders-co@in.example.test'),
  'subject', 'Lunch on Friday', 'text', 'Shall we meet at noon?')) as r2 \gset
reset role;
select (:'r1'::jsonb ->> 'message_id') as m1 \gset
select (:'r2'::jsonb ->> 'message_id') as m2 \gset
select tests.check((select count(*) from public.tender_notices where inbox_message_id = :'m1' and source = 'email' and status = 'new') = 1,
  'a tender email in the Inbox becomes a notice waiting to be read');
select tests.check((select count(*) from public.tender_notices where inbox_message_id = :'m2') = 0, 'other email is left alone');

select tests.login('sales.ta@g.test'); set role authenticated;
select tests.check(public.tender_notice_from_inbox(:'m1') = (select id from public.tender_notices where inbox_message_id = :'m1'),
  'Read as tender notice on a picked-up email opens the same notice');
select public.tender_notice_from_inbox(:'m2') as nm2 \gset
select tests.check((select source = 'email' and raw_text like 'Lunch on Friday%' from public.tender_notices where id = :'nm2'),
  'any email can be read as a tender notice by hand');
select public.tender_save_settings(:'co', '{"keywords": ["lubricants"], "inbox_pick": false, "min_score": 30}');
reset role;
set role service_role;
select public.inbox_record_inbound(jsonb_build_object('channel', 'email', 'provider', 'generic', 'provider_message_id', 'm-3',
  'from', 'alerts@nest.go.tz', 'to', jsonb_build_array('tenders-co@in.example.test'),
  'subject', 'Tender Notice: Supply of cement', 'text', 'Invitation for bids.')) as r3 \gset
reset role;
select tests.check((select count(*) from public.tender_notices where inbox_message_id = (:'r3'::jsonb ->> 'message_id')::uuid) = 0,
  'with pick-up switched off, tender emails stay only in the Inbox');

-- ---- 5. Web sources and the scheduled job ----------------------------------------------------------------------
select tests.login('boss.ta@g.test'); set role authenticated;
insert into public.tender_sources (company_id, name, url) values (:'co', 'Mine procurement page', 'https://procurement.example.test/tenders')
returning id as src \gset
select tests.blocked(format('update public.tender_sources set last_status = %L where id = %L', 'ok', :'src'),
  'when a source was read is recorded only by the job');
select tests.blocked(format('insert into public.tender_sources (company_id, name, url) values (%L, %L, %L)', :'co', 'Bad', 'ftp://x.test/'),
  'only web addresses');
select tests.blocked('select * from public.tender_sources_due(5)', 'the job''s functions are not for the app');
select tests.blocked('select public.tender_run_digest()', 'the digest is not for the app');
reset role;
select tests.login('sales.ta@g.test'); set role authenticated;
select tests.blocked(format('insert into public.tender_sources (company_id, name, url) values (%L, %L, %L)', :'co', 'Mine', 'https://a.test/'),
  'only management adds sources');
select tests.check((select count(*) from public.tender_sources) = 1, 'sales sees the sources');
reset role;

set role service_role;
select tests.check((select count(*) from public.tender_sources_due(10) where id = :'src') = 1, 'a new source is due');
select public.tender_notice_ingest(:'src', jsonb_build_object('title', 'Supply of hydraulic oil to North Mara', 'buyer', 'North Mara Gold Mine',
  'url', 'https://procurement.example.test/tenders/77', 'closing_at', (now() + interval '9 days')::text)) as w1 \gset
select tests.check(:'w1' <> '', 'an advert from the source is added');
select tests.check(public.tender_notice_ingest(:'src', jsonb_build_object('title', 'Supply of hydraulic oil to North Mara',
  'buyer', 'North Mara Gold Mine')) is null, 'the same advert next time is not added again');
select public.tender_source_fetched(:'src', 'ok', null, 1);
select tests.check((select count(*) from public.tender_sources_due(10) where id = :'src') = 0, 'a source just read is not due');
select tests.check((select count(*) from public.tender_notices_waiting(50) where company_id = :'co') = 3, 'three notices wait to be read');
select public.tender_notice_save_job(:'w1', '{"extracted_by": "ai", "score": 64, "decision": "consider"}') as sw \gset
select tests.check(:'sw' = 'matched' and (select extracted_by = 'ai' from public.tender_notices where id = :'w1'), 'the job saves its reading');
select tests.check(public.tender_ai_take(:'co', 2) and public.tender_ai_take(:'co', 2) and not public.tender_ai_take(:'co', 2),
  'the job reads at most the daily number with AI');
reset role;

-- ---- 6. The daily digest ----------------------------------------------------------------------------------------
set role service_role;
select public.tender_notice_save_job((select id from public.tender_notices where inbox_message_id = :'m1'),
  '{"title": "Industrial lubricants", "buyer": "TANESCO", "score": 20, "closing_at": "2030-01-01T10:00:00+03:00"}') as x \gset
select tests.check(public.tender_run_digest_at('2026-10-27 06:30+03') = 0, 'before 07:00 no digest is sent');
select public.tender_run_digest_at('2026-10-27 08:00+03') as d1 \gset
reset role;
select tests.check(:'d1' = 2 and (select count(*) from public.notifications where kind = 'tender_digest' and company_id = :'co'
                                    and user_id in (:'boss', :'sales')) = 2,
  'the digest goes to management and sales');
select tests.check((select title from public.notifications where kind = 'tender_digest' and user_id = :'boss') = '1 new tender matches what you sell'
                   and (select body like 'Best: Supply of hydraulic oil to North Mara%score 64%' from public.notifications
                         where kind = 'tender_digest' and user_id = :'boss'),
  'only notices scoring at least the lowest score are counted (one, the best is named)');
select tests.check((select count(*) from public.notifications where kind = 'tender_digest' and user_id = :'fin') = 0, 'finance gets no digest');
select tests.check((select count(*) from public.tender_notices where company_id = :'co' and status = 'matched' and notified_at is null) = 0,
  'notices are marked as sent');
set role service_role;
select tests.check(public.tender_run_digest_at('2026-10-27 15:00+03') = 0, 'one digest a day');
reset role;

-- ---- 7. Summary and the feature switch ------------------------------------------------------------------------------
select tests.login('sales.ta@g.test'); set role authenticated;
select tests.check((public.tender_alert_summary(:'co') ->> 'sources')::int = 1 and (public.tender_alert_summary(:'co') ->> 'set_up')::boolean,
  'summary for the tenders page');
reset role;
select tests.login('boss.ta@g.test'); set role authenticated;
select public.set_company_feature(:'co', 'tender_alerts', false);
reset role;
select tests.login('sales.ta@g.test'); set role authenticated;
select tests.blocked(format('select public.tender_notice_add(%L, %L)', :'co', '{"raw_text": "Invitation for bids for the supply of chemicals"}'),
  'switched off: no new notices');
reset role;
set role service_role;
select tests.check((select count(*) from public.tender_sources_due(10) where company_id = :'co') = 0, 'switched off: sources are not read');
select public.inbox_record_inbound(jsonb_build_object('channel', 'email', 'provider', 'generic', 'provider_message_id', 'm-4',
  'from', 'alerts@nest.go.tz', 'to', jsonb_build_array('tenders-co@in.example.test'),
  'subject', 'Tender Notice: Supply of acids', 'text', 'Invitation for bids.')) as r4 \gset
reset role;
select tests.check((:'r4'::jsonb ->> 'status') = 'recorded', 'switched off: the Inbox still records the email');
select tests.login('boss.ta@g.test'); set role authenticated;
select public.set_company_feature(:'co', 'tender_alerts', true);
reset role;
