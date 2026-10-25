-- Tests for the shared inbox: email and WhatsApp conversations, webhooks (service role), replies.
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

insert into auth.users (email) values ('boss.ib@i.test'), ('sales.ib@i.test'), ('driver.ib@i.test'), ('store.ib@i.test'),
                                      ('proc.ib@i.test'), ('other.ib@i.test');
select id as boss from auth.users where email = 'boss.ib@i.test' \gset
select id as sales from auth.users where email = 'sales.ib@i.test' \gset
select id as driver from auth.users where email = 'driver.ib@i.test' \gset
select id as store from auth.users where email = 'store.ib@i.test' \gset
select id as proc from auth.users where email = 'proc.ib@i.test' \gset
select id as outsider from auth.users where email = 'other.ib@i.test' \gset

select tests.login('boss.ib@i.test'); set role authenticated;
select public.create_company('Inbox Co') as co \gset
reset role;
select tests.login('other.ib@i.test'); set role authenticated;
select public.create_company('Other Inbox Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
values (:'co', :'sales', 'sales'), (:'co', :'driver', 'driver'), (:'co', :'store', 'warehouse'), (:'co', :'proc', 'procurement');
insert into public.clients (company_id, name) values (:'co', 'Geita Gold Mine') returning id as client \gset
insert into public.client_contacts (company_id, client_id, name, email, phone)
values (:'co', :'client', 'Asha Buyer', 'Asha.Buyer@GGM.co.tz; stores@ggm.co.tz', '0754 111 222');
insert into public.suppliers (company_id, name, email, phone) values (:'co', 'Valves Ltd', 'sales@valves.test', '+255 713 999 888') returning id as sup \gset
insert into public.clients (company_id, name) values (:'other', 'Other Client') returning id as oclient \gset

-- ---- 1. Settings -------------------------------------------------------------------------------
select tests.login('sales.ib@i.test'); set role authenticated;
select tests.blocked(format('select public.inbox_save_settings(%L, %L)', :'co', '{"inbound_address":"x@in.test"}'),
  'only management changes the inbox settings');
reset role;
select tests.login('boss.ib@i.test'); set role authenticated;
select tests.blocked(format('select public.inbox_save_settings(%L, %L)', :'co', '{"inbound_address":"bad+tag@in.test"}'),
  'an inbox address with + is refused');
select public.inbox_save_settings(:'co', '{"inbound_address":"  Inbox-Co@In.Test ","whatsapp_phone_number_id":"1098765432","whatsapp_display_phone":"+255 700 000 001","reply_name":"Inbox Co"}');
select tests.check((select inbound_address from public.inbox_settings where company_id = :'co') = 'inbox-co@in.test', 'settings saved (address in lower case)');
select tests.blocked(format('insert into public.inbox_settings (company_id) values (%L)', :'other'), 'settings only through the function');
reset role;
select tests.login('other.ib@i.test'); set role authenticated;
select tests.blocked(format('select public.inbox_save_settings(%L, %L)', :'other', '{"inbound_address":"inbox-co@in.test"}'),
  'another company cannot take the same address');
select public.inbox_save_settings(:'other', '{"inbound_address":"other@in.test"}');
reset role;

-- ---- 2. Recording what arrives (webhooks) --------------------------------------------------------
select tests.login('boss.ib@i.test'); set role authenticated;
select tests.blocked($$select public.inbox_record_inbound('{"channel":"email","from":"a@b.test","to":["inbox-co@in.test"]}')$$,
  'signed-in users cannot record inbound messages');
reset role;
set role anon;
select tests.blocked($$select public.inbox_record_inbound('{"channel":"email","from":"a@b.test","to":["inbox-co@in.test"]}')$$,
  'visitors cannot record inbound messages');
reset role;

set role service_role;
select public.inbox_record_inbound(jsonb_build_object(
  'channel', 'email', 'provider', 'resend', 'provider_message_id', 'rs-1',
  'from', 'Asha Buyer <asha.buyer@ggm.co.tz>', 'from_name', 'Asha Buyer',
  'to', jsonb_build_array('Inbox Co <INBOX-CO@in.test>'), 'cc', jsonb_build_array('boss@ggm.co.tz'),
  'subject', 'RFQ: 20 gate valves', 'text', 'Please quote 20 gate valves DN50.', 'html', '<p>Please quote</p>',
  'message_id', '<m1@ggm.co.tz>',
  'attachments', jsonb_build_array(jsonb_build_object('file_name', '../spec.pdf', 'content_type', 'application/pdf', 'size', 1234, 'provider_attachment_id', 'att-1')))) as r1 \gset
select (:'r1'::jsonb ->> 'conversation_id') as conv, (:'r1'::jsonb ->> 'message_id') as m1,
       (:'r1'::jsonb -> 'attachments' -> 0 ->> 'id') as att \gset
select tests.check(:'r1'::jsonb ->> 'status' = 'recorded' and (:'r1'::jsonb ->> 'company_id')::uuid = :'co',
  'an email to the inbox address is recorded for the right company');
select tests.check((select client_id from public.inbox_conversations where id = :'conv') = :'client',
  'the client is linked by the contact''s email (one of two in the field, any case)');
select tests.check((select unread_count from public.inbox_conversations where id = :'conv') = 1
                   and (select counterpart_address from public.inbox_conversations where id = :'conv') = 'asha.buyer@ggm.co.tz',
  'one unread message from the client''s address');
select tests.check((select file_name from public.inbox_attachments where id = :'att') = '.._spec.pdf', 'attachment names cannot hold folders');

-- The provider sends it again: nothing new.
select public.inbox_record_inbound(jsonb_build_object(
  'channel', 'email', 'provider', 'resend', 'provider_message_id', 'rs-1',
  'from', 'asha.buyer@ggm.co.tz', 'to', jsonb_build_array('inbox-co@in.test'), 'subject', 'RFQ: 20 gate valves', 'text', 'again')) as r2 \gset
select tests.check(:'r2'::jsonb ->> 'status' = 'duplicate' and :'r2'::jsonb ->> 'message_id' = :'m1', 'a repeated webhook is a duplicate');
-- Same email, different provider id (e.g. sent to two of our addresses): the Message-ID catches it.
select tests.check(public.inbox_record_inbound(jsonb_build_object(
  'channel', 'email', 'provider', 'resend', 'provider_message_id', 'rs-1b', 'message_id', '<m1@ggm.co.tz>',
  'from', 'asha.buyer@ggm.co.tz', 'to', jsonb_build_array('inbox-co@in.test'), 'subject', 'RFQ: 20 gate valves')) ->> 'status' = 'duplicate',
  'the same Message-ID is a duplicate');
select tests.check((select count(*) from public.inbox_messages where conversation_id = :'conv') = 1, 'still one message');

-- A reply in the same thread (In-Reply-To) joins the conversation even with another subject.
select public.inbox_record_inbound(jsonb_build_object(
  'channel', 'email', 'provider', 'resend', 'provider_message_id', 'rs-2', 'message_id', '<m2@ggm.co.tz>',
  'in_reply_to', '<m1@ggm.co.tz>', 'references', jsonb_build_array('<m1@ggm.co.tz>'),
  'from', 'asha.buyer@ggm.co.tz', 'to', jsonb_build_array('inbox-co@in.test'), 'subject', 'Also 5 ball valves', 'text', 'And 5 ball valves.')) as r3 \gset
select tests.check((:'r3'::jsonb ->> 'conversation_id') = :'conv', 'a reply joins the email thread');
-- "Re:" with the same subject joins too.
select tests.check(public.inbox_record_inbound(jsonb_build_object(
  'channel', 'email', 'provider', 'resend', 'provider_message_id', 'rs-3',
  'from', 'asha.buyer@ggm.co.tz', 'to', jsonb_build_array('inbox-co@in.test'), 'subject', 'RE: Fwd: RFQ: 20 gate valves', 'text', 'Any news?'))
  ->> 'conversation_id' = :'conv', 'Re: with the same subject joins the conversation');
-- Unknown address: not recorded anywhere.
select tests.check(public.inbox_record_inbound(jsonb_build_object(
  'channel', 'email', 'provider', 'resend', 'provider_message_id', 'rs-x',
  'from', 'spam@spam.test', 'to', jsonb_build_array('nobody@in.test'), 'subject', 'Hi')) ->> 'status' = 'no_company',
  'mail to an unknown address is not recorded');
-- A supplier writes; the reply-to code (+ref) finds an existing conversation.
select public.inbox_record_inbound(jsonb_build_object(
  'channel', 'email', 'provider', 'generic', 'provider_message_id', 'g-1',
  'from', 'SALES@valves.test', 'to', jsonb_build_array('inbox-co@in.test'), 'subject', 'Price list 2027', 'text', 'Attached.')) ->> 'conversation_id' as sconv \gset
select tests.check((select supplier_id from public.inbox_conversations where id = :'sconv') = :'sup', 'the supplier is linked by email');
select ref as sref from public.inbox_conversations where id = :'sconv' \gset
select tests.check(public.inbox_record_inbound(jsonb_build_object(
  'channel', 'email', 'provider', 'generic', 'provider_message_id', 'g-2',
  'from', 'sales@valves.test', 'to', jsonb_build_array('inbox-co+' || :'sref' || '@in.test'), 'subject', 'Something else', 'text', 'x'))
  ->> 'conversation_id' = :'sconv', 'alias+ref@domain finds the conversation');
-- WhatsApp: by the business number id; the client is found by phone.
select public.inbox_record_inbound(jsonb_build_object(
  'channel', 'whatsapp', 'provider', 'whatsapp', 'provider_message_id', 'wamid.1', 'phone_number_id', '1098765432',
  'from', '255754111222', 'from_name', 'Asha', 'text', 'Habari, mmepokea email yangu?')) ->> 'conversation_id' as wconv \gset
select tests.check((select client_id from public.inbox_conversations where id = :'wconv') = :'client'
                   and (select channel from public.inbox_conversations where id = :'wconv') = 'whatsapp',
  'a WhatsApp from the contact''s phone (0754 111 222) is linked to the client');
select tests.check(public.inbox_record_inbound(jsonb_build_object(
  'channel', 'whatsapp', 'provider', 'whatsapp', 'provider_message_id', 'wamid.1', 'phone_number_id', '1098765432',
  'from', '255754111222', 'text', 'again')) ->> 'status' = 'duplicate', 'a repeated WhatsApp webhook is a duplicate');
select tests.check(public.inbox_record_inbound(jsonb_build_object(
  'channel', 'whatsapp', 'provider', 'whatsapp', 'provider_message_id', 'wamid.2', 'phone_number_id', '999',
  'from', '255754111222', 'text', 'x')) ->> 'status' = 'no_company', 'an unknown WhatsApp number is not recorded');
-- Attachment upload by the webhook.
reset role;  -- (the storage API puts the file there; here it is added directly)
insert into storage.objects (bucket_id, name) values ('inbox', :'co' || '/' || :'conv' || '/' || :'att' || '-spec.pdf');
set role service_role;
select public.inbox_attachment_stored(:'att', :'co' || '/' || :'conv' || '/' || :'att' || '-spec.pdf');
select tests.blocked(format('select public.inbox_attachment_stored(%L, %L)', :'att', :'other' || '/' || :'conv' || '/x.pdf'),
  'a file outside the conversation folder is refused');
reset role;
select tests.check((select count(*) from public.notifications where user_id = :'boss' and kind = 'inbox_message' and severity = 'attention') = 6
                   and (select count(*) from public.notifications where user_id = :'sales' and kind = 'inbox_message') = 6,
  'management and sales are told about every new message (attention)');
select tests.check((select count(*) from public.notifications where user_id in (:'driver', :'store', :'proc') and kind = 'inbox_message') = 0,
  'drivers, warehouse and procurement are not notified');

-- ---- 3. Who can read -------------------------------------------------------------------------------
select tests.login('sales.ib@i.test'); set role authenticated;
select tests.check((select count(*) from public.inbox_conversations) = 3 and (select count(*) from public.inbox_messages) = 6,
  'sales reads the company inbox');
select tests.check(public.inbox_unread_count(:'co') = 3, 'unread badge: 3 conversations');
select tests.check(public.can_use_inbox_file(:'co' || '/' || :'conv' || '/' || :'att' || '-spec.pdf'), 'sales can open the attachment');
select tests.blocked(format('update public.inbox_conversations set status = %L where id = %L', 'closed', :'conv'), 'no direct status change');
select tests.blocked(format('insert into public.inbox_messages (company_id, conversation_id, channel, direction, body_text) values (%L, %L, %L, %L, %L)',
  :'co', :'conv', 'email', 'out', 'x'), 'no direct messages');
select tests.blocked(format('delete from public.inbox_conversations where id = %L', :'conv'), 'no deleting conversations');
reset role;
select tests.login('proc.ib@i.test'); set role authenticated;
select tests.check((select count(*) from public.inbox_conversations) = 3, 'procurement reads the inbox');
reset role;
select tests.login('driver.ib@i.test'); set role authenticated;
select tests.check((select count(*) from public.inbox_conversations) = 0 and (select count(*) from public.inbox_messages) = 0
                   and (select count(*) from public.inbox_attachments) = 0 and (select count(*) from public.inbox_settings) = 0,
  'drivers cannot read the inbox');
select tests.check(public.inbox_unread_count(:'co') = 0, 'drivers get no badge');
select tests.check(not public.can_use_inbox_file(:'co' || '/' || :'conv' || '/' || :'att' || '-spec.pdf'), 'drivers cannot open attachments');
select tests.blocked(format('select public.inbox_set_status(%L, %L)', :'conv', 'closed'), 'drivers cannot close');
reset role;
select tests.login('store.ib@i.test'); set role authenticated;
select tests.check((select count(*) from public.inbox_conversations) = 0, 'warehouse cannot read the inbox');
reset role;
select tests.login('other.ib@i.test'); set role authenticated;
select tests.check((select count(*) from public.inbox_conversations where company_id = :'co') = 0
                   and (select count(*) from public.inbox_messages where company_id = :'co') = 0,
  'another company sees nothing');
select tests.blocked(format('select public.inbox_mark_read(%L, true)', :'conv'), 'another company cannot touch the conversation');
select tests.blocked(format('select public.inbox_record_outbound(%L, %L)', :'conv', '{"text":"hi"}'), 'another company cannot reply');
select tests.check(not public.can_use_inbox_file(:'co' || '/' || :'conv' || '/' || :'att' || '-spec.pdf'), 'another company cannot open the file');
reset role;

-- ---- 4. Status, assignment, replies ---------------------------------------------------------------------
select tests.login('sales.ib@i.test'); set role authenticated;
select public.inbox_mark_read(:'conv', true);
select tests.check((select unread_count from public.inbox_conversations where id = :'conv') = 0, 'mark as read');
select public.inbox_mark_read(:'conv', false);
select tests.check((select unread_count from public.inbox_conversations where id = :'conv') = 1, 'mark as unread');
select tests.blocked(format('select public.inbox_assign(%L, %L)', :'conv', :'driver'), 'cannot assign to a driver');
select tests.blocked(format('select public.inbox_assign(%L, %L)', :'conv', :'outsider'), 'cannot assign to someone outside the company');
select public.inbox_assign(:'conv', :'proc');
select tests.check((select assigned_to from public.inbox_conversations where id = :'conv') = :'proc', 'assigned to procurement');
select tests.blocked(format('select public.inbox_record_outbound(%L, %L)', :'conv', '{"text":"   "}'), 'an empty reply is refused');
select tests.blocked(format('select public.inbox_record_outbound(%L, %L)', :'conv', '{"text":"x","status":"delivered"}'), 'unknown reply status refused');
select public.inbox_record_outbound(:'conv', jsonb_build_object('text', 'Quotation follows today.', 'subject', 'Re: RFQ: 20 gate valves',
  'provider', 'resend', 'provider_message_id', 'out-1', 'message_id', '<out1@in.test>', 'in_reply_to', '<m2@ggm.co.tz>',
  'from', 'Inbox Co <inbox-co@in.test>')) as out1 \gset
select tests.check((select direction = 'out' and status = 'sent' and sent_by = :'sales' and to_addresses = array['asha.buyer@ggm.co.tz']
                      from public.inbox_messages where id = :'out1'), 'the reply is recorded as sent, to the client');
select tests.check((select unread_count = 0 and last_direction = 'out' from public.inbox_conversations where id = :'conv'), 'replying marks it read');
select public.inbox_record_outbound(:'wconv', '{"text":"Ndiyo, tumepokea.","status":"manual","provider":"wa_link"}') as out2 \gset
select tests.check((select status from public.inbox_messages where id = :'out2') = 'manual', 'a WhatsApp sent by hand is recorded as manual');
select public.inbox_set_status(:'conv', 'closed');
select tests.check((select status = 'closed' and closed_by = :'sales' from public.inbox_conversations where id = :'conv'), 'close');
select tests.blocked(format('select public.inbox_set_status(%L, %L)', :'conv', 'archived'), 'unknown status refused');
select public.inbox_link(:'sconv', :'client', null);
select tests.check((select client_id = :'client' and supplier_id is null from public.inbox_conversations where id = :'sconv'), 'link by hand');
select tests.blocked(format('select public.inbox_link(%L, %L, null)', :'sconv', :'oclient'), 'cannot link another company''s client');
select public.inbox_start_conversation(:'co', 'whatsapp', '0713 999 888', null, null, null, null) as nconv \gset
select tests.check((select supplier_id = :'sup' and counterpart_address = '255713999888' and assigned_to = :'sales'
                      from public.inbox_conversations where id = :'nconv'), 'start a WhatsApp: number cleaned, supplier found');
select tests.blocked(format('select public.inbox_start_conversation(%L, %L, %L, null, null, null, null)', :'co', 'email', 'not-an-email'),
  'a bad email address is refused');
reset role;
select tests.check((select count(*) from public.notifications where user_id = :'proc' and kind = 'inbox_assigned') = 1, 'the assignee is told');

-- A new message on a closed conversation opens it again (and tells the assignee).
set role service_role;
select tests.check(public.inbox_record_inbound(jsonb_build_object(
  'channel', 'email', 'provider', 'resend', 'provider_message_id', 'rs-4', 'in_reply_to', '<out1@in.test>',
  'from', 'asha.buyer@ggm.co.tz', 'to', jsonb_build_array('inbox-co@in.test'), 'subject', 'Re: RFQ: 20 gate valves', 'text', 'Thanks'))
  ->> 'conversation_id' = :'conv', 'the client''s answer to our reply joins the thread');
reset role;
select tests.check((select status = 'open' and unread_count = 1 from public.inbox_conversations where id = :'conv'), 'and opens it again');
select tests.check((select count(*) from public.notifications where user_id = :'proc' and kind = 'inbox_message') = 1, 'the assignee is told');

-- ---- 5. Rules every new function follows ------------------------------------------------------------------
select tests.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'inbox\_%' or p.proname in ('can_use_inbox_file', 'add_inbox_cleanup'))
     and p.prosecdef and not coalesce(p.proconfig @> array['search_path=""'], false)),
  'inbox functions pin an empty search path');
select tests.check(not has_function_privilege('authenticated', 'public.inbox_record_inbound(jsonb)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.inbox_record_inbound(jsonb)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.inbox_attachment_stored(uuid, text)', 'EXECUTE')
                   and has_function_privilege('service_role', 'public.inbox_record_inbound(jsonb)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.inbox_unread_count(uuid)', 'EXECUTE')
                   and has_function_privilege('authenticated', 'public.inbox_record_outbound(uuid, jsonb)', 'EXECUTE'),
  'grants: only the webhooks record what arrives; users reply');
select tests.check((select bool_and(relrowsecurity) from pg_class
                     where oid in ('public.inbox_settings'::regclass, 'public.inbox_conversations'::regclass,
                                   'public.inbox_messages'::regclass, 'public.inbox_attachments'::regclass)),
  'row-level security is on');
select tests.check((select count(*) from public.backup_table_plan()
                     where table_name like 'inbox\_%' and skipped is null) = 4, 'the inbox is part of the company backup');

set role anon;
select tests.blocked('select count(*) from public.inbox_conversations', 'anon: no conversations');
select tests.blocked(format('select public.inbox_unread_count(%L)', :'co'), 'anon: no badge');
reset role;

-- ---- 6. Deleting the company removes the inbox ----------------------------------------------------------
select count(public.delete_company_step(c, interval '1 hour')) from unnest(array[:'other']::uuid[]) c \gset x_
select tests.check((select count(*) from public.inbox_settings where company_id = :'other') = 0
                   and not exists (select 1 from public.companies where id = :'other'), 'a deleted company''s inbox settings go');
select count(public.delete_company_step(c, interval '1 hour')) from unnest(array[:'co']::uuid[]) c \gset x_
select tests.check((select count(*) from public.inbox_conversations where company_id = :'co') = 0
                   and (select count(*) from public.inbox_messages where company_id = :'co') = 0
                   and (select count(*) from public.inbox_attachments where company_id = :'co') = 0
                   and not exists (select 1 from public.companies where id = :'co'), 'deleting the company removes its inbox');
select tests.check(exists (select 1 from public.storage_cleanup where bucket = 'inbox' and prefix = :'co' || '/'),
  'inbox files are cleaned up with the company');

-- Clean up so later test files see a normal database.
delete from storage.objects where bucket_id = 'inbox';
delete from public.storage_cleanup where company_ref in (:'co', :'other');
delete from public.company_closures where company_id in (:'co', :'other');
delete from auth.users where email like '%.ib@i.test';
