-- Tests for Legal & compliance: catalogue, checklist, licences, filing calendar, linked documents,
-- directors and shares, the summary, alerts and closing a company.
\set ON_ERROR_STOP on
\set QUIET on
set client_min_messages = notice;

create schema if not exists tests;
grant usage on schema tests to authenticated, anon;
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
grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (email)
values ('boss.cp@g.test'), ('fin.cp@g.test'), ('sales.cp@g.test'), ('driver.cp@g.test'), ('other.cp@g.test'), ('close.cp@g.test');
select id as boss from auth.users where email = 'boss.cp@g.test' \gset
select id as fin from auth.users where email = 'fin.cp@g.test' \gset
select id as sales from auth.users where email = 'sales.cp@g.test' \gset
select id as driver from auth.users where email = 'driver.cp@g.test' \gset
select id as outsider from auth.users where email = 'other.cp@g.test' \gset

select tests.login('boss.cp@g.test'); set role authenticated;
select public.create_company('Compliance Supply Co') as co \gset
reset role;
select tests.login('other.cp@g.test'); set role authenticated;
select public.create_company('Other Compliance Co') as other \gset
reset role;
insert into public.memberships (company_id, user_id, role)
values (:'co', :'fin', 'finance'), (:'co', :'sales', 'sales'), (:'co', :'driver', 'driver');

-- ---- 1. Feature and catalogue ---------------------------------------------------------------
select tests.check((select default_level = 'small' and status = 'live' and route = '/compliance' and module = 'Legal & compliance'
                     from public.features where key = 'compliance'), 'compliance feature: small level, live, /compliance');
select tests.check((select count(*) from public.compliance_catalogue) = 57, 'catalogue has 57 requirements');
select tests.check((select count(*) from public.compliance_catalogue where verify and coalesce(verify_note, '') = '') = 0,
  'every requirement to verify says what to confirm');
select tests.check((select count(*) from public.compliance_catalogue where website is not null and website !~ '^https://www\.[a-z0-9-]+\.(go|or)\.tz$') = 0,
  'websites are official .go.tz / .or.tz addresses');
select tests.check((select frequency = 'monthly' and due_day = 7 and due_offset_months = 1 from public.compliance_catalogue where code = 'TRA_PAYE')
                   and (select due_day = 20 from public.compliance_catalogue where code = 'TRA_VAT_RETURN'),
  'PAYE by the 7th and VAT by the 20th of the following month');

select tests.login('sales.cp@g.test'); set role authenticated;
select tests.check((select count(*) from public.compliance_catalogue) = 57, 'anyone signed in reads the catalogue');
select tests.blocked($$insert into public.compliance_catalogue (code, category, kind, name, authority, applies_to, purpose)
                       values ('HACK_X', 'tax', 'filing', 'x', 'x', 'always', 'x')$$, 'the catalogue cannot be changed');
select tests.blocked($$update public.compliance_catalogue set name = 'x' where code = 'TRA_TIN'$$, 'catalogue rows cannot be edited');
reset role;
set role anon;
select tests.blocked('select count(*) from public.compliance_catalogue', 'anon: no catalogue');
reset role;

-- ---- 2. Setting up the checklist --------------------------------------------------------------
select tests.login('sales.cp@g.test'); set role authenticated;
select tests.blocked(format('select public.compliance_adopt(%L)', :'co'), 'only management sets up the checklist');
reset role;
select tests.login('boss.cp@g.test'); set role authenticated;
select public.compliance_adopt(:'co', null, true) as adopted \gset
select tests.check(:adopted = (select count(*) from public.compliance_catalogue where starter) and :adopted > 20,
  'set up: the starter set for a new general supply company is added');
select tests.check((select status from public.compliance_items where company_id = :'co' and code = 'BRELA_INCORPORATION') = 'done'
                   and (select status from public.compliance_items where company_id = :'co' and code = 'BRELA_MEMART') = 'done'
                   and (select status from public.compliance_items where company_id = :'co' and code = 'TRA_TIN') = 'not_started',
  'already registered with BRELA: incorporation and MEMART done, the rest not started');
select tests.check((select count(*) from public.compliance_items where company_id = :'co' and code in ('GCLA_CHEMICALS', 'EWURA_PETROLEUM', 'TRA_PAYE')) = 0,
  'no supply licences or payroll filings before they are chosen');
select tests.check(public.compliance_adopt(:'co', null, true) = 0, 'setting up again adds nothing twice');
select tests.check(public.compliance_adopt(:'co', array['TRA_PAYE', 'TRA_VAT_RETURN', 'GCLA_CHEMICALS', 'BRELA_ANNUAL_RETURN']) = 3,
  'adopting chosen requirements adds only the new ones');
select tests.blocked(format('select public.compliance_adopt(%L, array[%L])', :'co', 'NO_SUCH_THING'), 'unknown requirements are refused');
select tests.check((select finance_ok from public.compliance_items where company_id = :'co' and code = 'TRA_PAYE')
                   and not (select finance_ok from public.compliance_items where company_id = :'co' and code = 'BUSINESS_LICENCE'),
  'tax items can be updated by finance, company items not');
select tests.check(exists (select 1 from public.compliance_settings where company_id = :'co' and not shares_decided and year_end_month = 12),
  'settings start with shares not yet decided and a December year end');
select id as it_lic from public.compliance_items where company_id = :'co' and code = 'BUSINESS_LICENCE' \gset
select id as it_tin from public.compliance_items where company_id = :'co' and code = 'TRA_TIN' \gset
select id as it_paye from public.compliance_items where company_id = :'co' and code = 'TRA_PAYE' \gset
select id as it_prov from public.compliance_items where company_id = :'co' and code = 'TRA_PROVISIONAL_TAX' \gset
select id as it_final from public.compliance_items where company_id = :'co' and code = 'TRA_FINAL_RETURN' \gset
select id as it_est from public.compliance_items where company_id = :'co' and code = 'TRA_ESTIMATE' \gset
select id as it_gcla from public.compliance_items where company_id = :'co' and code = 'GCLA_CHEMICALS' \gset
select id as it_vat from public.compliance_items where company_id = :'co' and code = 'TRA_VAT_RETURN' \gset

-- ---- 3. Statuses and who may change what -------------------------------------------------------
select tests.blocked(format('update public.compliance_items set status = %L where id = %L', 'done', :'it_lic'),
  'status only through the buttons');
select tests.blocked(format('update public.compliance_items set code = %L where id = %L', 'TRA_TIN', :'it_lic'), 'the catalogue code cannot be changed');
select public.compliance_set_status(:'it_lic', 'in_progress', 'Applied at the council');
select tests.check((select status = 'in_progress' and status_note = 'Applied at the council' from public.compliance_items where id = :'it_lic'),
  'management moves an item on with a note');
select public.compliance_set_status(:'it_gcla', 'not_applicable', 'We do not deal in chemicals yet');
update public.compliance_items set due_on = current_date + 3, owner_id = :'sales' where id = :'it_lic';
select tests.blocked(format('update public.compliance_items set owner_id = %L where id = %L', :'outsider', :'it_lic'),
  'only team members can be responsible');
insert into public.compliance_items (company_id, name, category, notes)
values (:'co', 'Client X vendor renewal', 'procurement', 'Yearly') returning id as it_custom \gset
select tests.check((select status = 'not_started' and code is null and not finance_ok from public.compliance_items where id = :'it_custom'),
  'management adds its own item');
insert into public.compliance_items (company_id, name, category, frequency, due_day) values (:'co', 'Board pack', 'company', 'none', 9)
returning id as it_none \gset
select tests.check((select due_day is null from public.compliance_items where id = :'it_none'), 'a one-off item keeps no calendar rule');
reset role;

select tests.login('fin.cp@g.test'); set role authenticated;
select public.compliance_set_status(:'it_tin', 'done', null);
select tests.check((select status = 'done' and done_by = :'fin' and done_on is not null from public.compliance_items where id = :'it_tin'),
  'finance marks a tax item done');
select tests.blocked(format('select public.compliance_set_status(%L, %L, null)', :'it_lic', 'done'), 'finance cannot change company items');
insert into public.compliance_items (company_id, name, category) values (:'co', 'Stamp duty on lease', 'tax') returning id as it_fin \gset
select tests.check((select finance_ok from public.compliance_items where id = :'it_fin'), 'finance adds its own tax item');
select tests.blocked(format('insert into public.compliance_items (company_id, name, category) values (%L, %L, %L)', :'co', 'Fin board item', 'company'),
  'finance cannot add company items');
update public.compliance_items set notes = 'changed by finance' where id = :'it_lic';
select tests.check((select notes is null from public.compliance_items where id = :'it_lic'), 'finance cannot edit company items');
reset role;

select tests.login('sales.cp@g.test'); set role authenticated;
select tests.check((select count(*) from public.compliance_items where company_id = :'co') = :adopted + 6,
  'everyone except drivers reads the checklist');
update public.compliance_items set notes = 'sales was here' where id = :'it_lic';
select tests.check((select notes is null from public.compliance_items where id = :'it_lic'), 'sales cannot edit the checklist');
select tests.blocked(format('select public.compliance_set_status(%L, %L, null)', :'it_tin', 'not_started'), 'sales cannot change a status');
select tests.blocked(format('insert into public.compliance_items (company_id, name) values (%L, %L)', :'co', 'Sales item'), 'sales cannot add items');
reset role;
select tests.login('driver.cp@g.test'); set role authenticated;
select tests.check((select count(*) from public.compliance_items) = 0 and (select count(*) from public.licences) = 0
                   and (select count(*) from public.compliance_deadlines) = 0, 'drivers do not see compliance');
select tests.blocked(format('select public.compliance_summary(%L)', :'co'), 'drivers get no summary');
reset role;
select tests.login('other.cp@g.test'); set role authenticated;
select tests.check((select count(*) from public.compliance_items where company_id = :'co') = 0
                   and (select count(*) from public.compliance_settings where company_id = :'co') = 0, 'another company sees nothing');
select tests.blocked(format('select public.compliance_set_status(%L, %L, null)', :'it_lic', 'done'), 'another company cannot change statuses');
select tests.blocked(format('select public.compliance_summary(%L)', :'co'), 'another company gets no summary');
reset role;

-- ---- 4. The filing calendar ---------------------------------------------------------------------------
-- The calendar starts from when an item was added; start PAYE 40 days ago so one filing is already late.
select tests.login('boss.cp@g.test'); set role authenticated;
update public.compliance_items set calendar_from = current_date - 40 where id = :'it_paye';
select public.compliance_refresh_calendar(:'co') as built \gset
select tests.check(:built > 0, 'the calendar is built from the recurring items');
select tests.check((select bool_and(extract(day from due_on) = 7 and due_on = (date_trunc('month', period_end) + interval '1 month')::date + 6)
                     from public.compliance_deadlines where item_id = :'it_paye'),
  'PAYE: due on the 7th of the month after each period');
select tests.check(exists (select 1 from public.compliance_deadlines where item_id = :'it_paye' and due_on < current_date and status = 'open'),
  'a PAYE filing in the last 40 days is overdue');
select tests.check(not exists (select 1 from public.compliance_deadlines where item_id = :'it_paye' and due_on < current_date - 40),
  'nothing before the calendar start date');
select tests.check(not exists (select 1 from public.compliance_deadlines where item_id = :'it_gcla'), 'items that do not apply have no filings');
select tests.check(public.compliance_refresh_calendar(:'co') = 0, 'building again changes nothing');
reset role;
-- A long window (as the database itself, internal function) to check quarters and years.
select public.compliance_generate_deadlines(:'co', current_date + 400) > 0 as long_built \gset
select tests.check((select bool_and(extract(month from due_on)::int in (3, 6, 9, 12)
                                    and due_on = (date_trunc('month', due_on) + interval '1 month - 1 day')::date)
                     from public.compliance_deadlines where item_id = :'it_prov') and :'long_built',
  'provisional tax: last day of each quarter (December year end)');
select tests.check((select bool_and(to_char(due_on, 'MM-DD') = '06-30') from public.compliance_deadlines where item_id = :'it_final')
                   and exists (select 1 from public.compliance_deadlines where item_id = :'it_final'),
  'final return: 30 June, six months after a December year end');
select tests.check((select bool_and(to_char(due_on, 'MM-DD') = '03-31' and extract(year from due_on) = extract(year from period_end))
                     from public.compliance_deadlines where item_id = :'it_est')
                   and exists (select 1 from public.compliance_deadlines where item_id = :'it_est'),
  'estimated tax: 31 March of the year itself');
select tests.check(not exists (select 1 from public.compliance_deadlines where item_id = :'it_vat' and due_on <> (date_trunc('month', due_on) + interval '19 days')::date),
  'VAT return: the 20th');
reset role;

select tests.login('boss.cp@g.test'); set role authenticated;
select tests.blocked(format('select public.compliance_generate_deadlines(%L, current_date + 999)', :'co'), 'users cannot build the calendar far ahead');
-- Moving the year end to July moves quarters and years.
select public.compliance_save_settings(:'co', 7, '2026-02-10', 'Four directors; shares not yet agreed.', 'Board meets monthly.');
select public.compliance_refresh_calendar(:'co') \gset x_
reset role;
select public.compliance_generate_deadlines(:'co', current_date + 400) \gset x_
select tests.check((select bool_and(extract(month from due_on)::int in (1, 4, 7, 10)) from public.compliance_deadlines
                     where item_id = :'it_prov' and status = 'open' and due_on >= current_date),
  'July year end: quarters end in October, January, April and July');
select tests.check((select bool_and(to_char(due_on, 'MM-DD') = '01-31') from public.compliance_deadlines
                     where item_id = :'it_final' and status = 'open' and due_on >= current_date),
  'July year end: final return by 31 January');
select tests.check((select incorporated_on = '2026-02-10' and board_note = 'Board meets monthly.' from public.compliance_settings where company_id = :'co'),
  'settings saved');

select id as dl_late from public.compliance_deadlines where item_id = :'it_paye' and due_on < current_date order by due_on limit 1 \gset
select id as dl_next from public.compliance_deadlines where item_id = :'it_paye' and due_on >= current_date order by due_on limit 1 \gset
select id as dl_vat from public.compliance_deadlines where item_id = :'it_vat' order by due_on limit 1 \gset
select tests.login('sales.cp@g.test'); set role authenticated;
select tests.blocked(format('select public.compliance_mark_filed(%L, current_date, %L, null)', :'dl_late', 'X'), 'sales cannot mark a filing');
reset role;
select tests.login('fin.cp@g.test'); set role authenticated;
select tests.blocked(format('update public.compliance_deadlines set status = %L where id = %L', 'filed', :'dl_late'),
  'filings are marked only through the function');
select tests.blocked(format('select public.compliance_mark_filed(%L, current_date + 1, null, null)', :'dl_late'), 'no filing date in the future');
select tests.blocked(format('select public.compliance_mark_filed(%L, current_date, null, null, -5)', :'dl_late'), 'no negative amount');
select public.compliance_mark_filed(:'dl_late', current_date, 'PAYE-CN-991234', 'Paid by bank', 412500.456, ' 991100223344 ', current_date);
select tests.check((select status = 'filed' and reference = 'PAYE-CN-991234' and filed_by = :'fin' and amount = 412500.46
                           and control_number = '991100223344' and paid_on = current_date
                      from public.compliance_deadlines where id = :'dl_late'),
  'finance marks PAYE filed with the reference, amount, control number and payment date');
select tests.blocked(format('update public.compliance_deadlines set amount = 1 where id = %L', :'dl_late'), 'the amount is changed only through the functions');
select tests.blocked(format('select public.compliance_mark_filed(%L, null, null, null)', :'dl_late'), 'cannot mark twice');
select tests.blocked(format('select public.compliance_skip_filing(%L, %L)', :'dl_next', ''), 'nothing to file needs a reason');
select public.compliance_skip_filing(:'dl_vat', 'Not VAT registered yet');
select tests.check((select status from public.compliance_deadlines where id = :'dl_vat') = 'not_required', 'a period with nothing to file');
select public.compliance_reopen_filing(:'dl_vat');
select tests.check((select status = 'open' and note is null from public.compliance_deadlines where id = :'dl_vat'), 'a marked filing can be opened again');
select public.compliance_mark_filed(:'dl_vat', null, null, null, 1000, '9911', null);
select public.compliance_reopen_filing(:'dl_vat');
select tests.check((select status = 'open' and amount is null and control_number is null and paid_on is null from public.compliance_deadlines where id = :'dl_vat'),
  'opening a filing again clears its amount and control number');
reset role;
-- The late PAYE period is filed; make another one late for the alerts below.
select tests.login('boss.cp@g.test'); set role authenticated;
update public.compliance_items set calendar_from = current_date - 75 where id = :'it_paye';
select public.compliance_refresh_calendar(:'co') \gset x_
select tests.check((select count(*) from public.compliance_deadlines where item_id = :'it_paye' and status = 'open' and due_on < current_date) >= 1,
  'an earlier start date adds the earlier periods');
select tests.check((select status from public.compliance_deadlines where id = :'dl_late') = 'filed', 'filed periods are kept');
reset role;

-- ---- 5. Licences ----------------------------------------------------------------------------------------
select tests.login('boss.cp@g.test'); set role authenticated;
insert into public.licences (company_id, name, authority, catalogue_code, category, product_scope, status, remind_days)
values (:'co', 'GCLA chemical dealer', 'GCLA', 'GCLA_CHEMICALS', 'Chemicals', 'Mining reagents, water treatment', 'planned', 60)
returning id as lic_gcla \gset
insert into public.licences (company_id, name, authority, licence_no, status, issued_on, expires_on, remind_days)
values (:'co', 'Business licence 2026', 'Kinondoni MC', 'BL-778', 'active', current_date - 300, current_date + 10, 30)
returning id as lic_bl \gset
insert into public.licences (company_id, name, authority, status, issued_on, expires_on)
values (:'co', 'Fire certificate', 'Zimamoto', 'active', current_date - 400, current_date - 3)
returning id as lic_fire \gset
insert into public.licences (company_id, name, status) values (:'co', 'Odd start', 'suspended') returning id as lic_odd \gset
select tests.check((select status from public.licences where id = :'lic_odd') = 'planned', 'a new licence cannot start suspended or expired');
select tests.blocked(format('update public.licences set status = %L where id = %L', 'active', :'lic_gcla'), 'licence status only through the buttons');
select public.compliance_set_licence_status(:'lic_gcla', 'applied', '2026-10-01');
select tests.check((select status = 'applied' and applied_on = '2026-10-01' from public.licences where id = :'lic_gcla'), 'licence applied for');
select tests.blocked(format('select public.compliance_set_licence_status(%L, %L, null)', :'lic_fire', 'active'),
  'an expired licence cannot be made active without a new expiry date');
select tests.blocked(format('select public.compliance_set_licence_status(%L, %L, null)', :'lic_gcla', 'cancelled'), 'unknown licence status');
select tests.blocked(format('insert into public.licences (company_id, name, issued_on, expires_on) values (%L, %L, current_date, current_date - 1)', :'co', 'Bad dates'),
  'expiry before issue refused');
update public.compliance_items set licence_id = :'lic_bl' where id = :'it_lic';
reset role;
select tests.login('fin.cp@g.test'); set role authenticated;
select tests.check((select count(*) from public.licences where company_id = :'co') = 4, 'finance reads the licences');
select tests.blocked(format('insert into public.licences (company_id, name) values (%L, %L)', :'co', 'Fin licence'), 'finance cannot add licences');
select tests.blocked(format('select public.compliance_set_licence_status(%L, %L, null)', :'lic_gcla', 'active'), 'finance cannot change licences');
reset role;
select tests.login('other.cp@g.test'); set role authenticated;
select tests.check((select count(*) from public.licences where company_id = :'co') = 0, 'another company sees no licences');
select tests.blocked(format('insert into public.compliance_items (company_id, name, licence_id) values (%L, %L, %L)', :'other', 'Borrowed licence', :'lic_bl'),
  'another company cannot point its items at our licence');
reset role;

-- ---- 6. Linked documents --------------------------------------------------------------------------------
select tests.login('boss.cp@g.test'); set role authenticated;
insert into public.documents (company_id, title, kind, reference, expires_on, remind_days)
values (:'co', 'Business licence 2026 (scan)', 'licence', 'BL-778', current_date + 10, 30) returning id as doc_bl \gset
insert into public.documents (company_id, title, kind) values (:'co', 'BRELA certificate', 'company') returning id as doc_brela \gset
insert into public.compliance_documents (company_id, document_id, licence_id) values (:'co', :'doc_bl', :'lic_bl');
insert into public.compliance_documents (company_id, document_id, item_id)
select :'co', :'doc_brela', id from public.compliance_items where company_id = :'co' and code = 'BRELA_INCORPORATION';
select tests.blocked(format('insert into public.compliance_documents (company_id, document_id, licence_id) values (%L, %L, %L)', :'co', :'doc_bl', :'lic_bl'),
  'the same document is linked once');
select tests.blocked(format('insert into public.compliance_documents (company_id, document_id, item_id, licence_id) values (%L, %L, %L, %L)',
  :'co', :'doc_bl', :'it_lic', :'lic_bl'), 'a link is to an item or a licence, not both');
reset role;
select tests.login('other.cp@g.test'); set role authenticated;
insert into public.documents (company_id, title, kind) values (:'other', 'Their paper', 'other') returning id as doc_other \gset
reset role;
select tests.login('boss.cp@g.test'); set role authenticated;
select tests.blocked(format('insert into public.compliance_documents (company_id, document_id, item_id) values (%L, %L, %L)', :'co', :'doc_other', :'it_lic'),
  'another company''s document cannot be linked');
reset role;
select tests.login('sales.cp@g.test'); set role authenticated;
select tests.check((select count(*) from public.compliance_documents where company_id = :'co') = 2, 'sales sees the linked documents');
select tests.blocked(format('insert into public.compliance_documents (company_id, document_id, item_id) values (%L, %L, %L)', :'co', :'doc_bl', :'it_lic'),
  'sales cannot link documents');
reset role;
select tests.login('fin.cp@g.test'); set role authenticated;
insert into public.compliance_documents (company_id, document_id, item_id) values (:'co', :'doc_brela', :'it_tin');
select tests.check((select count(*) from public.compliance_documents where item_id = :'it_tin') = 1, 'finance links a document to a tax item');
select tests.blocked(format('insert into public.compliance_documents (company_id, document_id, licence_id) values (%L, %L, %L)', :'co', :'doc_brela', :'lic_gcla'),
  'finance cannot link documents to licences');
delete from public.compliance_documents where item_id = :'it_tin';
select tests.check((select count(*) from public.compliance_documents where item_id = :'it_tin') = 0, 'finance unlinks it again');
reset role;

-- ---- 7. Directors and shares ----------------------------------------------------------------------------
select tests.login('boss.cp@g.test'); set role authenticated;
insert into public.company_directors (company_id, full_name, role, id_type, id_number, nationality, tin, appointed_on, sort)
values (:'co', 'Leo Director', 'managing_director', 'nida', '19800101-11111-00001-21', 'Tanzanian', '111-222-333', '2026-02-10', 1),
       (:'co', 'Amina Director', 'director', 'nida', '19850101-11111-00001-22', 'Tanzanian', null, '2026-02-10', 2),
       (:'co', 'Baraka Director', 'director', 'nida', null, 'Tanzanian', null, '2026-02-10', 3),
       (:'co', 'Neema Director', 'director', 'passport', 'AB123456', 'Kenyan', null, '2026-02-10', 4);
select tests.check((public.compliance_summary(:'co') ->> 'directors')::int = 4 and not (public.compliance_summary(:'co') ->> 'shares_decided')::boolean,
  '4 directors, shares not yet decided');
select tests.blocked(format('select public.compliance_set_shares_decided(%L, true)', :'co'), 'cannot mark shares decided with no percentages');
update public.company_directors set share_percent = 25 where company_id = :'co';
select public.compliance_set_shares_decided(:'co', true);
select tests.check((select shares_decided and shares_decided_at is not null from public.compliance_settings where company_id = :'co'),
  'shares decided: 4 x 25%');
select tests.blocked(format('insert into public.company_directors (company_id, full_name, role, share_percent) values (%L, %L, %L, 10)', :'co', 'Extra Holder', 'shareholder'),
  'shares cannot add up to more than 100%');
select tests.blocked(format('update public.company_directors set share_percent = 30 where company_id = %L and full_name = %L', :'co', 'Leo Director'),
  'raising one holder above the total is refused');
update public.company_directors set resigned_on = '2026-09-30' where company_id = :'co' and full_name = 'Neema Director';
insert into public.company_directors (company_id, full_name, role, share_percent) values (:'co', 'New Holder', 'shareholder', 25);
select tests.check((select sum(share_percent) from public.company_directors where company_id = :'co' and resigned_on is null) = 100,
  'a resigned holder no longer counts; the new holder takes the 25%');
select tests.blocked(format('insert into public.company_directors (company_id, full_name, appointed_on, resigned_on) values (%L, %L, %L, %L)',
  :'co', 'Backwards', '2026-05-01', '2026-04-01'), 'resigning before appointment refused');
select public.compliance_set_shares_decided(:'co', false);
select tests.check((select count(*) from public.company_directors where company_id = :'co' and share_percent is not null) = 5,
  'going back to "not decided" keeps the percentages');
reset role;
select tests.login('fin.cp@g.test'); set role authenticated;
select tests.check((select count(*) from public.company_directors where company_id = :'co') = 5, 'finance reads the directors');
select tests.blocked(format('insert into public.company_directors (company_id, full_name) values (%L, %L)', :'co', 'Fin Director'),
  'finance cannot add directors');
select tests.blocked(format('select public.compliance_set_shares_decided(%L, true)', :'co'), 'finance cannot decide the shares');
reset role;
select tests.login('sales.cp@g.test'); set role authenticated;
select tests.check((select count(*) from public.company_directors) = 0, 'sales cannot read directors'' personal details');
select tests.blocked(format('select public.compliance_save_settings(%L, 12, null, null, null)', :'co'), 'sales cannot change the settings');
reset role;

-- ---- 8. Summary ------------------------------------------------------------------------------------------
select tests.login('boss.cp@g.test'); set role authenticated;
select public.compliance_summary(:'co') as s \gset
select tests.check((:'s'::jsonb ->> 'ready')::boolean and (:'s'::jsonb ->> 'set_up')::boolean and (:'s'::jsonb ->> 'can_manage')::boolean,
  'summary: ready, set up, can manage');
select tests.check((:'s'::jsonb ->> 'done')::int = 3 and (:'s'::jsonb ->> 'not_applicable')::int = 1
                   and (:'s'::jsonb ->> 'applicable')::int = (:'s'::jsonb ->> 'items')::int - 1,
  'summary counts done and not applicable items');
select tests.check((:'s'::jsonb ->> 'score')::int = round(100.0 * 3 / ((:'s'::jsonb ->> 'applicable')::int)), 'score = done / applicable');
select tests.check((:'s'::jsonb ->> 'filings_overdue')::int >= 1 and (:'s'::jsonb ->> 'overdue')::int >= 1, 'summary shows the late PAYE');
select tests.check((:'s'::jsonb ->> 'items_due_soon')::int = 1, 'summary shows the business licence item due in 3 days');
select tests.check((:'s'::jsonb ->> 'licences_expiring')::int = 1 and (:'s'::jsonb ->> 'licences_expired')::int = 1
                   and (:'s'::jsonb ->> 'licences_pending')::int = 2 and (:'s'::jsonb ->> 'licences')::int = 4,
  'summary: one licence expiring, one expired, two pending');
select tests.check((:'s'::jsonb ->> 'missing_docs')::int = 2, 'done registrations without a document are counted (MEMART, TIN)');
select tests.check((:'s'::jsonb ->> 'documents_expiring')::int = 1, 'library papers expiring are counted');
select tests.check(jsonb_array_length(:'s'::jsonb -> 'next_filings') between 1 and 5, 'summary lists the next filings');
reset role;
select tests.login('sales.cp@g.test'); set role authenticated;
select tests.check(not (public.compliance_summary(:'co') ->> 'can_manage')::boolean, 'sales reads the summary but cannot manage');
reset role;
set role anon;
select tests.blocked(format('select public.compliance_summary(%L)', :'co'), 'anon: no summary');
select tests.blocked('select count(*) from public.licences', 'anon: no licences');
reset role;

-- ---- 9. Alerts -------------------------------------------------------------------------------------------
delete from public.notifications where company_id = :'co';
select public.run_compliance_alerts(:'co') as n_alerts \gset
select tests.check(:n_alerts > 0, 'compliance alerts were sent');
select tests.check((select status from public.licences where id = :'lic_fire') = 'expired', 'a licence past its expiry date becomes expired');
select tests.check((select severity = 'critical' and link = '/compliance/licences/' || :'lic_fire' from public.notifications
                     where user_id = :'boss' and kind = 'licence_expiry' and title like 'Licence expired:%'),
  'management is told a licence has expired (critical)');
select tests.check((select severity from public.notifications where user_id = :'boss' and kind = 'licence_expiry' and title like 'Licence expiring:%') = 'attention',
  'management is told a licence expires within its reminder period');
select tests.check(exists (select 1 from public.notifications where user_id = :'boss' and kind = 'compliance_filing' and title like 'Filing overdue: PAYE%' and severity = 'critical'),
  'management is told about the late PAYE filing');
select tests.check(exists (select 1 from public.notifications where user_id = :'fin' and kind = 'compliance_filing' and title like 'Filing overdue: PAYE%'),
  'finance is told about late tax filings');
select tests.check(exists (select 1 from public.notifications where user_id = :'boss' and kind = 'compliance_due' and title = 'Compliance due: Business licence'),
  'management is told a checklist item is due');
select tests.check(exists (select 1 from public.notifications where user_id = :'sales' and kind = 'compliance_due'),
  'the person responsible is told too');
select tests.check(not exists (select 1 from public.notifications where user_id = :'fin' and kind in ('licence_expiry', 'compliance_due')),
  'finance is not told about licences or company items');
select tests.check(not exists (select 1 from public.notifications where user_id in (:'driver', :'outsider') and company_id = :'co'),
  'drivers and outsiders get no compliance alerts');
select tests.check(public.run_compliance_alerts(:'co') = 0, 'running again sends nothing twice');
-- A filing due within 7 days is a heads-up, not critical.
select tests.check(not exists (select 1 from public.notifications where kind = 'compliance_filing' and title like 'Filing due:%' and severity <> 'attention'),
  'filings due soon are "attention"');

select tests.login('boss.cp@g.test'); set role authenticated;
select public.set_company_feature(:'co', 'compliance', false);
insert into public.licences (company_id, name, status, issued_on, expires_on, remind_days)
values (:'co', 'EWURA lubricants', 'active', current_date - 10, current_date + 5, 30) returning id as lic_ewura \gset
reset role;
select tests.check(public.run_compliance_alerts(:'co') = 0, 'no compliance alerts while the feature is switched off');
select tests.login('boss.cp@g.test'); set role authenticated;
select public.set_company_feature(:'co', 'compliance', null);
reset role;
select tests.check(public.run_compliance_alerts(:'co') > 0, 'alerts come back when it is switched on');
update public.companies set alerts_checked_at = null where id = :'co';
select tests.login('boss.cp@g.test'); set role authenticated;
select tests.check(public.refresh_alerts(:'co') >= 0, 'opening the app runs the alerts, compliance included');
reset role;
select tests.check(not has_function_privilege('authenticated', 'public.run_compliance_alerts(uuid)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.compliance_generate_deadlines(uuid, date)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.compliance_save_rules(uuid, jsonb)', 'EXECUTE')
                   and has_function_privilege('authenticated', 'public.compliance_save_rules(uuid, jsonb)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.compliance_mark_filed(uuid, date, text, text, numeric, text, date)', 'EXECUTE')
                   and not has_function_privilege('anon', 'public.compliance_summary(uuid)', 'EXECUTE')
                   and has_function_privilege('authenticated', 'public.compliance_summary(uuid)', 'EXECUTE')
                   and has_function_privilege('service_role', 'public.run_all_alerts(text)', 'EXECUTE'),
  'grants: alerts and the calendar builder are internal; the scheduler entry point stays reachable');
select tests.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'compliance\_%' or p.proname in ('run_compliance_alerts', 'prepare_compliance_record', 'check_director_shares',
                                                           'on_compliance_item_changed'))
     and not coalesce(p.proconfig @> array['search_path=""'], false)),
  'every compliance function has an empty search path');

-- ---- 10. Not applicable clears open filings; deleting items --------------------------------------------
select tests.login('boss.cp@g.test'); set role authenticated;
select public.compliance_set_status(:'it_vat', 'not_applicable', 'Not VAT registered');
select tests.check(not exists (select 1 from public.compliance_deadlines where item_id = :'it_vat' and status = 'open'),
  'switching an item off removes its open filings');
select public.compliance_set_status(:'it_vat', 'not_started', null);
select tests.check((select calendar_from = current_date from public.compliance_items where id = :'it_vat'),
  'switching it back on starts the calendar from today');
delete from public.compliance_items where id = :'it_custom';
select tests.check(not exists (select 1 from public.compliance_items where id = :'it_custom'), 'management deletes its own item');
reset role;
select tests.login('fin.cp@g.test'); set role authenticated;
delete from public.compliance_items where id = :'it_fin';
select tests.check(exists (select 1 from public.compliance_items where id = :'it_fin'), 'finance cannot delete items');
reset role;

-- ---- 10b. Tax & legal rules --------------------------------------------------------------------------
select tests.login('sales.cp@g.test'); set role authenticated;
select tests.blocked(format('select public.compliance_save_rules(%L, %L::jsonb)', :'co', '{"vat_due_day": 18}'), 'sales cannot change the rules');
reset role;
select tests.login('fin.cp@g.test'); set role authenticated;
select tests.blocked(format('select public.compliance_save_rules(%L, %L::jsonb)', :'co', '[1]'), 'the rules must be an object');
select tests.blocked(format('select public.compliance_save_rules(%L, %L::jsonb)', :'co', '{"vat_due_day": 40}'), 'a due day stays within 1 to 31');
select tests.blocked(format('select public.compliance_save_rules(%L, %L::jsonb)', :'co', '{"Bad Key": 1}'), 'rule names are checked');
select tests.blocked(format('select public.compliance_save_rules(%L, %L::jsonb)', :'co', '{"x_rule": {"a": 1}}'), 'values are plain numbers, yes/no or short text');
select tests.blocked(format('select public.compliance_save_rules(%L, %L::jsonb)', :'co', '{"late_filing_min": -1}'), 'no negative numbers');
select public.compliance_save_rules(:'co', '{"vat_due_day": 18, "paye_due_day": 9, "return_months": 4, "dpo_name": "Asha", "next_working_day": false, "unused": null}');
select tests.check((select legal_rules = '{"vat_due_day": 18, "paye_due_day": 9, "return_months": 4, "dpo_name": "Asha", "next_working_day": false}'::jsonb
                      from public.compliance_settings where company_id = :'co'),
  'finance saves the rules (empty values dropped)');
select tests.check((select due_day from public.compliance_items where id = :'it_vat') = 18
                   and (select due_day from public.compliance_items where id = :'it_paye') = 9
                   and (select due_offset_months from public.compliance_items where id = :'it_final') = 4,
  'the usual TRA filings follow the rules');
select public.compliance_refresh_calendar(:'co') \gset x_
select tests.check(not exists (select 1 from public.compliance_deadlines where item_id = :'it_vat' and status = 'open' and due_on >= current_date
                                 and extract(day from due_on) <> 18)
                   and exists (select 1 from public.compliance_deadlines where item_id = :'it_vat' and status = 'open' and due_on >= current_date),
  'open VAT filings move to the 18th');
reset role;
select tests.login('boss.cp@g.test'); set role authenticated;
select public.compliance_save_rules(:'co', '{"wht_due_day": 10}');
select public.compliance_adopt(:'co', array['TRA_WHT']) \gset x_
select tests.check((select due_day from public.compliance_items where company_id = :'co' and code = 'TRA_WHT') = 10,
  'a filing added later takes the company''s due day');
select public.compliance_save_rules(:'co', '{}');
select tests.check((select due_day from public.compliance_items where id = :'it_vat') = 20
                   and (select due_day from public.compliance_items where id = :'it_paye') = 7
                   and (select due_offset_months from public.compliance_items where id = :'it_final') = 6
                   and (select due_day from public.compliance_items where company_id = :'co' and code = 'TRA_WHT') = 7
                   and (select legal_rules from public.compliance_settings where company_id = :'co') = '{}'::jsonb,
  'reset to the law: the catalogue''s due days come back');
reset role;
select tests.login('ware.cp@g.test'); set role authenticated;
select tests.blocked(format('select public.compliance_save_rules(%L, %L::jsonb)', :'co', '{}'), 'other roles cannot reset the rules');
reset role;

-- ---- 11. Clearing test transactions keeps the legal set-up --------------------------------------------
select count(*) as items_before from public.compliance_items where company_id = :'co' \gset
select public.reset_company_transactions(:'co', 'Compliance Supply Co') \gset x_
select tests.check((select count(*) from public.compliance_items where company_id = :'co') = :items_before
                   and (select count(*) from public.licences where company_id = :'co') = 5
                   and (select count(*) from public.company_directors where company_id = :'co') = 5,
  'clearing test transactions keeps the checklist, licences and directors');

-- ---- 12. Closing a company removes everything ------------------------------------------------------------
select tests.login('close.cp@g.test'); set role authenticated;
select public.create_company('Closing Compliance Co') as cl \gset
select public.compliance_adopt(:'cl', array['TRA_PAYE', 'BUSINESS_LICENCE', 'BRELA_INCORPORATION'], true) \gset x_
insert into public.licences (company_id, name, status, expires_on) values (:'cl', 'Licence to go', 'active', current_date + 20) returning id as cl_lic \gset
insert into public.company_directors (company_id, full_name, share_percent) values (:'cl', 'Only Director', 100);
insert into public.documents (company_id, title, kind) values (:'cl', 'Cert', 'company') returning id as cl_doc \gset
insert into public.compliance_documents (company_id, document_id, licence_id) values (:'cl', :'cl_doc', :'cl_lic');
update public.compliance_items set licence_id = :'cl_lic' where company_id = :'cl' and code = 'BUSINESS_LICENCE';
update public.compliance_items set calendar_from = current_date - 60 where company_id = :'cl' and code = 'TRA_PAYE';
select public.compliance_refresh_calendar(:'cl') \gset x_
reset role;
select tests.check((select count(*) from public.compliance_deadlines where company_id = :'cl') > 0, 'the closing company has filings');
select tests.check((select count(*) from public.backup_table_plan()
                     where table_name in ('compliance_settings', 'compliance_items', 'compliance_deadlines', 'compliance_documents',
                                          'licences', 'company_directors') and skipped is null) = 6
                   and not exists (select 1 from public.backup_table_plan() where table_name = 'compliance_catalogue'),
  'backups include the company''s compliance records, not the shared catalogue');
select count(public.delete_company_step(c, interval '1 hour')) from unnest(array[:'cl']::uuid[]) c \gset x_
select tests.check(not exists (select 1 from public.companies where id = :'cl')
                   and (select count(*) from public.compliance_items where company_id = :'cl') = 0
                   and (select count(*) from public.compliance_deadlines where company_id = :'cl') = 0
                   and (select count(*) from public.compliance_documents where company_id = :'cl') = 0
                   and (select count(*) from public.licences where company_id = :'cl') = 0
                   and (select count(*) from public.company_directors where company_id = :'cl') = 0
                   and (select count(*) from public.compliance_settings where company_id = :'cl') = 0,
  'closing a company deletes its compliance records');
select tests.check((select count(*) from public.compliance_catalogue) = 57, 'the catalogue stays');
