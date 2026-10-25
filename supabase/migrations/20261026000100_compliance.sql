-- =====================================================================
-- Legal & compliance: what a general supply company in Tanzania must
-- register, renew, file and keep, with reminders.
--
--   Catalogue     built-in list of requirements (BRELA, TRA, NSSF, WCF,
--                 OSHA, council, NeST, sector regulators, insurance).
--                 Read-only reference data, generated from
--                 src/lib/compliance/catalogue.ts (single source of truth).
--   Checklist     the company's own list: catalogue items or its own,
--                 status, owner, due date, linked library documents.
--   Licences      as many licences as the company holds or applies for,
--                 with expiry reminders and linked documents.
--   Calendar      recurring filings (monthly, quarterly, yearly) built from
--                 the checklist, each period marked filed with a reference.
--   Directors     directors and shareholders, with a company-level
--                 "shares not yet decided" switch; shares never add up
--                 to more than 100%.
--
-- Who sees what:
--   * Everyone except drivers reads the checklist, licences and calendar.
--   * Management changes everything. Finance also updates tax and
--     social-security items and marks their filings.
--   * Directors' personal details (IDs, TINs): management and finance only.
--
-- Clearing test transactions keeps all of this: it is the company's real
-- legal set-up, not test data. Closing a company removes it with the rest.
--
-- GUIDANCE, NOT LEGAL ADVICE: the catalogue says so and flags what must
-- be confirmed with the authority (verify = true).
--
-- Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Feature
-- ---------------------------------------------------------------------
insert into public.feature_categories (name, description, sort)
values ('Legal & compliance', 'Company registration, tax filings, licences, directors and the documents inspectors and tenders ask for.', 88)
on conflict (name) do nothing;

insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
('compliance', 'Legal & compliance',
 'A checklist of what a Tanzanian supply company must register, renew and file (BRELA, TRA, NSSF, WCF, OSHA, council, NeST and sector licences), a licences register, a tax and filing calendar, directors and shares, and a guide to the documents each activity needs.',
 'Legal & compliance', 'small', 'live', 'Every company, from the day it is registered with BRELA.',
 'No missed filing or expired licence, and every paper ready for a tender, an audit or an inspection.',
 '[{"title": "Set up your checklist", "body": "Open Legal & compliance and press Set up my checklist. The usual requirements for a new general supply company are added; mark what you already have and switch off what does not apply."},
   {"title": "Upload the papers", "body": "Open an item or a licence and upload the certificate. It goes into the documents library and you are reminded before it expires."},
   {"title": "Never miss a filing", "body": "The tax and filing calendar lists PAYE, VAT, provisional tax and the yearly returns. Mark each one filed with its reference; management is told when one is due or late."}]'::jsonb,
 '/compliance', 488)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. The catalogue (reference data, the same for every company)
-- ---------------------------------------------------------------------
create table if not exists public.compliance_catalogue (
  code               text primary key check (code ~ '^[A-Z][A-Z0-9_]{2,59}$'),
  category           text not null check (category in ('company', 'tax', 'social_security', 'labour', 'local_government',
                                                       'procurement', 'sector', 'import', 'insurance')),
  kind               text not null check (kind in ('registration', 'licence', 'filing', 'record')),
  name               text not null,
  authority          text not null,
  applies_to         text not null check (applies_to in ('always', 'conditional')),
  condition          text,
  purpose            text not null,
  documents_needed   text[] not null default '{}',
  renewal            text,
  due_rule           text,
  frequency          text not null default 'none' check (frequency in ('none', 'monthly', 'quarterly', 'annual')),
  due_day            integer check (due_day between 1 and 31),
  due_offset_months  integer check (due_offset_months between -11 and 12),
  penalty            text,
  website            text check (website is null or website ~ '^https://'),
  verify             boolean not null default false,
  verify_note        text,
  starter            boolean not null default false,
  finance            boolean not null default false,
  tags               text[] not null default '{}',
  keywords           text[] not null default '{}',
  sort               integer not null default 0,
  reviewed_on        date,
  updated_at         timestamptz not null default now()
);

-- BEGIN GENERATED COMPLIANCE CATALOGUE (npx tsx scripts/compliance-catalogue-sql.ts; do not edit by hand)
insert into public.compliance_catalogue (code, category, kind, name, authority, applies_to, condition, purpose, documents_needed, renewal, due_rule, frequency, due_day, due_offset_months, penalty, website, verify, verify_note, starter, finance, tags, keywords, sort, reviewed_on)
values
('BRELA_INCORPORATION', 'company', 'registration', 'Certificate of Incorporation', 'BRELA (Business Registrations and Licensing Agency)', 'always', null, 'Proves the company legally exists. Banks, TRA, the council, clients and every tender ask for it.', array['Certificate of Incorporation (keep the original safe and certified copies ready)', 'Company registration number', 'Registered office address']::text[], 'Once. It does not expire.', 'Done when the company was registered with BRELA.', 'none', null, null, 'Without it the company cannot open a bank account, get a TIN, a business licence or bid for tenders.', 'https://www.brela.go.tz', false, null, true, false, array['start', 'tender', 'bank']::text[], array['cheti cha usajili', 'registration certificate', 'incorporation']::text[], 10, '2026-10-25'),
('BRELA_MEMART', 'company', 'registration', 'Memorandum and Articles of Association (MEMART)', 'BRELA', 'always', null, 'The company''s constitution: its objects (what business it may do), share capital, the subscribers and their shares, and how directors are appointed and decisions are made.', array['Certified copy of the MEMART as filed with BRELA', 'Any special resolutions that changed it']::text[], 'Changed only by special resolution, and the change is filed with BRELA.', 'Filed at registration; file every change.', 'none', null, null, 'Clients and tender boards check that your objects cover general supply; acting outside them can cause disputes.', 'https://www.brela.go.tz', false, null, true, false, array['start', 'tender', 'bank', 'shares']::text[], array['memorandum', 'articles', 'katiba ya kampuni']::text[], 20, '2026-10-25'),
('BRELA_SHAREHOLDING', 'company', 'record', 'Agree and record the shareholding', 'The shareholders and directors; changes filed with BRELA', 'conditional', 'While the owners have not yet decided how the shares are split (your case now).', 'The MEMART lists the subscribers and the shares each took at registration. Agree the final split, record it in a shareholders'' or board resolution (ideally also a shareholders'' agreement), issue share certificates, update the register of members and file any allotment or transfer with BRELA.', array['Shareholders'' agreement (recommended)', 'Board or shareholders'' resolution on the allotment', 'Share certificates', 'Updated register of members', 'BRELA filing of the allotment or transfer']::text[], 'Once, then on every change of shares.', 'As soon as the owners agree; file changes with BRELA within the period it sets.', 'none', null, null, 'Undecided or unrecorded shares cause disputes between owners and delay bank facilities, beneficial-ownership filings, local-content registration (Tanzanian ownership is checked) and tenders.', 'https://www.brela.go.tz', true, 'Ask BRELA or your lawyer which forms and fees apply, and TRA whether stamp duty is due on a transfer of shares.', true, false, array['shares', 'bank', 'mining']::text[], array['shares', 'hisa', 'shareholders agreement', 'allotment']::text[], 30, '2026-10-25'),
('BRELA_BENEFICIAL_OWNERS', 'company', 'filing', 'Beneficial ownership declaration', 'BRELA', 'always', null, 'Declares the real people who own or control the company, as required by the Companies Act and the beneficial ownership regulations.', array['ID (NIDA or passport) of each beneficial owner', 'TIN of each owner', 'How each person owns or controls the company (shares, votes, other control)', 'Contact details']::text[], 'At registration and whenever ownership or control changes.', 'File through BRELA''s Online Registration System (ORS); update after any change within the period BRELA sets.', 'none', null, null, 'Failure to declare or update can lead to penalties for the company and its officers, and banks may hold back services.', 'https://www.brela.go.tz', true, 'Confirm with BRELA the time allowed to report a change and the current form.', true, false, array['start', 'bank', 'tender', 'shares']::text[], array['beneficial owner', 'BO', 'wamiliki halisi']::text[], 40, '2026-10-25'),
('BRELA_REGISTERS', 'company', 'record', 'Statutory registers, minutes and company secretary', 'BRELA (Companies Act)', 'always', null, 'Keep the register of members (shareholders), the register of directors and secretary and the minutes of meetings at the registered office, and have a company secretary.', array['Register of members', 'Register of directors and secretary', 'Minutes book (board and shareholders)', 'Company secretary''s appointment']::text[], 'Keep up to date; update when anything changes.', 'Ongoing.', 'none', null, null, 'Missing registers are a common audit and due-diligence finding; banks and big clients ask for them.', 'https://www.brela.go.tz', true, 'Confirm the company secretary rules and register formats with your lawyer or BRELA.', true, false, array['start', 'bank', 'shares', 'tra_audit']::text[], array['register of members', 'directors register', 'katibu wa kampuni', 'company secretary']::text[], 50, '2026-10-25'),
('BRELA_ANNUAL_RETURN', 'company', 'filing', 'Annual return to BRELA', 'BRELA', 'always', null, 'Confirms each year the company''s directors, shareholders, registered office and share capital.', array['Current list of directors and shareholders', 'Registered office address', 'Fee paid through BRELA ORS']::text[], 'Every year.', 'Once a year through BRELA ORS. The due date is linked to the company''s registration anniversary or annual general meeting: confirm your exact date and the fee with BRELA and set it as the due date here.', 'annual', null, null, 'Late filing attracts penalties, and a company that does not file for years risks being struck off the register.', 'https://www.brela.go.tz', true, 'Exact due date for your company and the current fees and late penalties.', true, false, array['start', 'tender']::text[], array['annual returns', 'marejesho ya mwaka']::text[], 60, '2026-10-25'),
('BRELA_CHANGES', 'company', 'filing', 'Tell BRELA about changes (directors, shares, address)', 'BRELA', 'conditional', 'When a director joins or leaves, shares are allotted or transferred, or the registered office moves.', 'Keeps the official record the same as reality, which banks and tender boards check.', array['Board or shareholders'' resolution', 'The BRELA form for the change, filed through ORS', 'ID of each new director']::text[], 'Each time something changes.', 'Within the period set by the Companies Act after the change: confirm with BRELA.', 'none', null, null, 'Late notice attracts penalties, and the BRELA record will not match your tender or bank papers.', 'https://www.brela.go.tz', true, 'Time allowed for each kind of change and the fees.', true, false, array['shares', 'bank']::text[], '{}'::text[], 70, '2026-10-25'),
('AGM_MINUTES', 'company', 'record', 'Annual general meeting and board minutes', 'The company (Companies Act and your Articles)', 'always', null, 'Hold the meetings the law and your Articles require (approving the accounts, appointing the auditor, electing directors) and keep signed minutes.', array['Notice of the meeting', 'Signed minutes', 'Resolutions passed']::text[], 'AGM every year; board meetings as needed.', 'Set the date of your AGM here once the directors agree it.', 'annual', null, null, 'Decisions without minutes are hard to prove to banks, auditors and TRA.', null, true, 'Confirm with your lawyer whether your company must hold an AGM every year or may pass written resolutions instead.', true, false, array['shares', 'bank', 'tra_audit']::text[], array['AGM', 'mkutano mkuu', 'minutes', 'kumbukumbu za vikao']::text[], 80, '2026-10-25'),
('PDPC_REGISTRATION', 'company', 'licence', 'Personal data protection registration', 'PDPC (Personal Data Protection Commission)', 'conditional', 'If you collect and keep personal data of customers'' contacts, suppliers'' contacts or staff (almost every business).', 'Under the Personal Data Protection Act, 2022, data controllers and processors register with the PDPC and must protect the personal data they hold.', array['Online registration application', 'What personal data you keep and why', 'Privacy notice / data protection policy']::text[], 'Registration is renewed periodically: confirm the period with the PDPC.', 'Register before processing personal data.', 'none', null, null, 'Processing personal data without registration or proper protection can attract fines.', 'https://www.pdpc.go.tz', true, 'Whether your company must register, the fee and how long the certificate is valid.', true, false, array['start']::text[], array['data protection', 'privacy', 'ulinzi wa taarifa binafsi']::text[], 90, '2026-10-25'),
('BANK_ACCOUNT', 'company', 'record', 'Company bank account and signing mandate', 'Your bank', 'always', null, 'An account in the company''s name, with a board resolution saying who may sign. Needed for tenders, taxes and client payments.', array['Board resolution on the account and signatories', 'Directors'' IDs and TINs (bank KYC)', 'Beneficial ownership details', 'Certificate of Incorporation and MEMART']::text[], 'Update the mandate when signatories change.', 'Before trading.', 'none', null, null, 'Clients and tender boards will not pay into personal accounts.', null, false, null, true, false, array['start', 'bank', 'tender']::text[], '{}'::text[], 100, '2026-10-25'),
('TRA_TIN', 'tax', 'registration', 'TIN certificate (company)', 'TRA (Tanzania Revenue Authority)', 'always', null, 'The company''s Taxpayer Identification Number. Needed for the business licence, bank, imports, tenders and every tax return.', array['Certificate of Incorporation and MEMART', 'Directors'' IDs (NIDA) and their own TINs', 'Lease agreement or other proof of the business premises', 'Application through TRA''s online system']::text[], 'Once. Keep the details (address, directors) up to date with TRA.', 'Right after registration, before trading.', 'none', null, null, 'No business licence, imports or tenders without a TIN.', 'https://www.tra.go.tz', false, null, true, true, array['start', 'tax', 'tender', 'import', 'bank']::text[], array['TIN', 'namba ya mlipakodi']::text[], 200, '2026-10-25'),
('TRA_VAT_REGISTRATION', 'tax', 'registration', 'VAT registration (VRN)', 'TRA', 'conditional', 'When your taxable turnover passes the VAT registration threshold (check the current threshold with TRA: it is set in the VAT Act and has been changed by Finance Acts), or voluntarily, since many corporate and government buyers prefer VAT-registered suppliers.', 'Lets you charge VAT and claim back input VAT on purchases. Your VRN goes on every tax invoice.', array['TIN certificate', 'Business licence', 'Turnover records or projections', 'Bank statements', 'Lease of the premises']::text[], 'Once; then a VAT return every month.', 'Apply as soon as you pass the threshold (or when you decide to register voluntarily).', 'none', null, null, 'Trading above the threshold without registering attracts penalties and VAT assessed on past sales.', 'https://www.tra.go.tz', true, 'The current registration threshold and the conditions for voluntary registration.', false, true, array['start', 'tax', 'tender', 'industrial_clients', 'mining']::text[], array['VAT', 'VRN', 'kodi ya ongezeko la thamani']::text[], 210, '2026-10-25'),
('TRA_EFD', 'tax', 'registration', 'EFD / VFD fiscal receipts', 'TRA', 'conditional', 'VAT-registered businesses, and other businesses TRA requires to use fiscal devices (check with TRA for your turnover level).', 'Every sale needs a fiscal receipt or fiscal invoice from a TRA-approved EFD or VFD (virtual fiscal device).', array['EFD or VFD from a TRA-approved supplier', 'Registration of the device with TRA', 'Daily Z-reports kept']::text[], 'Keep the device working and serviced.', 'Before your first sale once it applies to you.', 'none', null, null, 'Selling without issuing fiscal receipts attracts heavy fines.', 'https://www.tra.go.tz', true, 'Which businesses must use EFD/VFD at your turnover level, and approved suppliers.', false, true, array['tax', 'tra_audit', 'industrial_clients']::text[], array['EFD', 'VFD', 'risiti', 'fiscal receipt', 'mashine ya EFD']::text[], 220, '2026-10-25'),
('TRA_PAYE', 'tax', 'filing', 'PAYE (monthly)', 'TRA', 'conditional', 'When you pay salaries or wages, including pay to directors.', 'Income tax deducted from employees'' pay and paid to TRA every month.', array['Payroll for the month', 'Monthly PAYE return', 'Payment receipt (control number)']::text[], 'Every month.', 'By the 7th of the following month.', 'monthly', 7, 1, 'Late payment attracts interest and penalties.', 'https://www.tra.go.tz', false, null, false, true, array['tax', 'hire_staff', 'tra_audit']::text[], array['PAYE', 'kodi ya mshahara']::text[], 230, '2026-10-25'),
('TRA_SDL', 'tax', 'filing', 'Skills and Development Levy (SDL, monthly)', 'TRA', 'conditional', 'Employers with at least the number of employees set by law (check the current threshold and rate with TRA).', 'A levy on gross payroll, paid to TRA every month together with PAYE.', array['Payroll for the month', 'SDL return', 'Payment receipt']::text[], 'Every month.', 'By the 7th of the following month (with PAYE).', 'monthly', 7, 1, 'Late payment attracts interest and penalties.', 'https://www.tra.go.tz', true, 'The current SDL rate and the minimum number of employees.', false, true, array['tax', 'hire_staff', 'tra_audit']::text[], array['SDL', 'skills levy']::text[], 240, '2026-10-25'),
('TRA_WHT', 'tax', 'filing', 'Withholding tax (monthly)', 'TRA', 'conditional', 'When you pay rent, service fees, interest or other payments on which tax must be withheld.', 'Tax you deduct from certain payments to others and pay to TRA. Expect clients to withhold tax on your service invoices too.', array['Withholding tax statement / return', 'Payment receipts', 'Withholding certificates issued to the payees']::text[], 'Every month in which you withheld tax.', 'Pay and file by the 7th of the following month.', 'monthly', 7, 1, 'You become liable for tax you failed to withhold, plus interest and penalties.', 'https://www.tra.go.tz', true, 'Which payments need withholding and the current rates.', true, true, array['tax', 'tra_audit', 'premises']::text[], array['withholding', 'WHT', 'kodi ya zuio']::text[], 250, '2026-10-25'),
('TRA_VAT_RETURN', 'tax', 'filing', 'VAT return (monthly)', 'TRA', 'conditional', 'Once the company is VAT-registered.', 'Monthly return of VAT on your sales and VAT on your purchases. File even in a month with no sales (nil return).', array['Sales and purchases VAT registers', 'Fiscal receipts and tax invoices', 'Return filed online']::text[], 'Every month.', 'By the 20th of the following month. Do not leave it to the last day.', 'monthly', 20, 1, 'Late filing and late payment attract penalties and interest.', 'https://www.tra.go.tz', false, null, false, true, array['tax', 'tra_audit']::text[], array['VAT return', 'ritani ya VAT']::text[], 260, '2026-10-25'),
('TRA_ESTIMATE', 'tax', 'filing', 'Statement of estimated tax payable', 'TRA', 'always', null, 'Your estimate of the year''s income tax, which sets the provisional tax instalments. It can be revised during the year.', array['Estimate of income and expenses for the year', 'Statement filed online']::text[], 'Every financial year.', 'By the end of the third month of the financial year (31 March for a December year end).', 'annual', 31, -9, 'A low estimate can lead to interest on the tax underpaid.', 'https://www.tra.go.tz', true, 'Confirm the date for your year end and the rules for a company in its first year.', true, true, array['tax', 'tra_audit']::text[], array['estimated tax', 'makadirio ya kodi']::text[], 270, '2026-10-25'),
('TRA_PROVISIONAL_TAX', 'tax', 'filing', 'Provisional (instalment) tax', 'TRA', 'always', null, 'Corporate income tax paid in four instalments during the year, based on your statement of estimated tax.', array['Statement of estimated tax', 'Instalment payment receipts']::text[], 'Four times a year.', 'By the last day of each quarter of the financial year (for a December year end: 31 March, 30 June, 30 September and 31 December).', 'quarterly', 31, 0, 'Late or underpaid instalments attract interest.', 'https://www.tra.go.tz', true, 'Confirm the instalment dates for your year end.', true, true, array['tax', 'tra_audit']::text[], array['instalment tax', 'kodi ya awamu']::text[], 280, '2026-10-25'),
('TRA_FINAL_RETURN', 'tax', 'filing', 'Final return of income (corporate tax)', 'TRA', 'always', null, 'The company''s income tax return for the year, with the audited accounts; any balance of tax is paid with it.', array['Audited financial statements', 'Tax computation', 'Return of income filed online', 'Payment of any balance']::text[], 'Every financial year.', 'Within six months after the end of the financial year (30 June for a December year end).', 'annual', 31, 6, 'Late returns attract penalties and interest, and TRA will not give a tax clearance.', 'https://www.tra.go.tz', false, null, true, true, array['tax', 'tra_audit', 'tender']::text[], array['income tax return', 'ritani ya mwaka', 'corporate tax']::text[], 290, '2026-10-25'),
('AUDITED_ACCOUNTS', 'tax', 'filing', 'Audited financial statements', 'An auditor registered with NBAA; filed with TRA', 'always', null, 'A company''s yearly accounts are audited by a registered auditor and attached to the tax return. Banks and tender boards ask for them too.', array['Books of account, bank statements, invoices and receipts', 'Auditor''s engagement letter', 'Signed audited accounts']::text[], 'Every financial year.', 'In time for the final return of income (within six months after the year end).', 'annual', 31, 6, 'Without audited accounts you cannot file a proper return or pass the financial checks of a tender.', 'https://www.nbaa.go.tz', false, null, true, true, array['tax', 'tra_audit', 'tender', 'bank']::text[], array['audit', 'hesabu zilizokaguliwa', 'financial statements']::text[], 300, '2026-10-25'),
('BOOKS_OF_ACCOUNT', 'tax', 'record', 'Books of account and supporting documents', 'TRA and the Companies Act', 'always', null, 'Keep proper books (sales, purchases, expenses, bank, stock) and the invoices, receipts and contracts behind them, ready for TRA or an auditor.', array['Sales and purchase records', 'Bank statements and reconciliations', 'Stock records', 'Contracts and supporting documents']::text[], 'Ongoing. Keep them for the period the tax law requires.', 'Ongoing.', 'none', null, null, 'Missing records lead to estimated assessments and penalties in a TRA audit.', 'https://www.tra.go.tz', true, 'How many years records must be kept (check the Tax Administration Act with your accountant).', true, true, array['tax', 'tra_audit']::text[], array['records', 'kumbukumbu za hesabu', 'bookkeeping']::text[], 310, '2026-10-25'),
('TRA_TAX_CLEARANCE', 'tax', 'licence', 'Tax clearance certificate', 'TRA', 'always', null, 'Shows that the company''s taxes are up to date. Needed to renew the business licence, for most tenders and by many corporate clients.', array['Returns filed and taxes paid', 'Audited accounts or estimate of tax', 'Application through TRA']::text[], 'Usually yearly: check the validity on the certificate.', 'Before it expires, and before each licence renewal or tender.', 'none', null, null, 'Without it you miss tenders and cannot renew the business licence.', 'https://www.tra.go.tz', true, 'How long a certificate is valid and what TRA asks for a new company.', true, true, array['tax', 'tender', 'mining', 'industrial_clients', 'start']::text[], array['tax clearance', 'hati ya kodi']::text[], 320, '2026-10-25'),
('NSSF_REGISTRATION', 'social_security', 'registration', 'NSSF employer registration', 'NSSF (National Social Security Fund)', 'conditional', 'As soon as you employ anyone.', 'Registers the company as an employer so employees'' pension contributions can be paid.', array['Employer registration form', 'Certificate of Incorporation', 'TIN certificate', 'Business licence', 'List of employees with their IDs']::text[], 'Once; register each new employee.', 'When you take on your first employee.', 'none', null, null, 'Not registering or not paying attracts penalties on top of the unpaid contributions.', 'https://www.nssf.go.tz', false, null, false, true, array['hire_staff']::text[], array['NSSF', 'mfuko wa hifadhi ya jamii', 'pension']::text[], 400, '2026-10-25'),
('NSSF_CONTRIBUTIONS', 'social_security', 'filing', 'NSSF contributions (monthly)', 'NSSF', 'conditional', 'Every month you have employees.', 'Employer and employee pension contributions, a percentage of gross pay.', array['Contribution schedule for the month', 'Payment receipt (control number)']::text[], 'Every month.', 'Monthly, within the time NSSF sets after the month (commonly by the end of the following month): confirm with NSSF.', 'monthly', 31, 1, 'Late contributions attract a penalty for every month they are late.', 'https://www.nssf.go.tz', true, 'The exact due date and the current contribution rates.', false, true, array['hire_staff']::text[], array['NSSF contributions', 'michango']::text[], 410, '2026-10-25'),
('WCF_REGISTRATION', 'social_security', 'registration', 'WCF employer registration', 'WCF (Workers Compensation Fund)', 'conditional', 'As soon as you employ anyone.', 'Compulsory cover for employees injured or made ill at work.', array['Employer registration form', 'Certificate of Incorporation', 'TIN certificate', 'List of employees']::text[], 'Once.', 'When you take on your first employee.', 'none', null, null, 'Penalties, and the company may have to pay compensation itself.', 'https://www.wcf.go.tz', false, null, false, true, array['hire_staff', 'osha_inspection']::text[], array['WCF', 'fidia kwa wafanyakazi']::text[], 420, '2026-10-25'),
('WCF_CONTRIBUTIONS', 'social_security', 'filing', 'WCF contributions (monthly)', 'WCF', 'conditional', 'Every month you have employees.', 'The employer''s contribution, a percentage of gross pay set by WCF.', array['Monthly return of employees'' earnings', 'Payment receipt']::text[], 'Every month.', 'Monthly, within the time WCF sets (commonly by the end of the following month): confirm with WCF.', 'monthly', 31, 1, 'Late contributions attract penalties.', 'https://www.wcf.go.tz', true, 'The exact due date and the current rate for private employers.', false, true, array['hire_staff']::text[], '{}'::text[], 430, '2026-10-25'),
('EMPLOYMENT_CONTRACTS', 'labour', 'record', 'Written employment contracts', 'Labour Commissioner (Employment and Labour Relations Act, 2004)', 'conditional', 'When you employ anyone.', 'Give each employee written particulars or a contract (job, pay, hours, leave, notice) and keep a signed copy.', array['Signed contract for each employee', 'Job description', 'Copies of the employee''s ID, TIN and NSSF number']::text[], 'For every new employee and every change of terms.', 'When the person starts work.', 'none', null, null, 'Disputes at the CMA are hard to defend without written contracts and records.', null, false, null, false, false, array['hire_staff', 'osha_inspection']::text[], array['mkataba wa ajira', 'contract']::text[], 500, '2026-10-25'),
('STAFF_REGISTER', 'labour', 'record', 'Staff register and employment records', 'Labour Commissioner', 'conditional', 'When you employ anyone.', 'Keep a register of staff, attendance or time records, leave, payroll and statutory deductions.', array['Staff register', 'Attendance records or timesheets', 'Payroll and payslips', 'Leave records']::text[], 'Ongoing. Keep them for the period the law requires after employment ends.', 'Ongoing.', 'none', null, null, 'Labour inspectors and the CMA expect these records.', null, true, 'How long records must be kept after employment ends.', false, false, array['hire_staff', 'osha_inspection', 'tra_audit']::text[], array['daftari la wafanyakazi', 'staff records']::text[], 510, '2026-10-25'),
('WORKPLACE_POLICIES', 'labour', 'record', 'Employee rights notice and workplace policies', 'Labour Commissioner / OSHA', 'conditional', 'When you employ anyone.', 'Display the statement of employee rights at the workplace and adopt basic policies: disciplinary and grievance procedure, health and safety, anti-harassment.', array['Statement of employee rights (displayed)', 'Disciplinary and grievance procedure', 'Health and safety policy']::text[], 'Review every year.', 'Before the first employee starts.', 'none', null, null, 'A common finding in labour and OSHA inspections.', null, true, 'The required notice and its language.', false, false, array['hire_staff', 'osha_inspection']::text[], '{}'::text[], 520, '2026-10-25'),
('OSHA_REGISTRATION', 'labour', 'licence', 'OSHA workplace registration and compliance licence', 'OSHA (Occupational Safety and Health Authority)', 'conditional', 'When you have a workplace (office, shop, store or warehouse) with employees.', 'Registers the workplace under the Occupational Health and Safety Act. After inspection OSHA issues a compliance licence or certificate.', array['Workplace registration form', 'Site plan or layout of the premises', 'Fire-fighting and first-aid arrangements', 'Medical examinations of employees where required', 'Safety policy and risk assessment']::text[], 'The compliance licence is renewed regularly (confirm the period with OSHA).', 'Register before or when the workplace opens.', 'none', null, null, 'Fines and possible closure orders after an inspection.', 'https://www.osha.go.tz', true, 'Renewal period, fees and the medical examinations required for your kind of work.', false, false, array['hire_staff', 'osha_inspection', 'premises', 'chemicals']::text[], array['OSHA', 'usalama mahali pa kazi']::text[], 530, '2026-10-25'),
('WORK_PERMITS', 'labour', 'licence', 'Work and residence permits for non-citizens', 'Labour Commissioner (work permit) and Immigration Department (residence permit)', 'conditional', 'Only if a non-citizen works in the business, including a foreign director who works in Tanzania.', 'A non-citizen may only work in Tanzania with a valid work permit and residence permit.', array['Passport', 'Academic and professional certificates', 'Employment contract or appointment', 'Succession plan for a local employee']::text[], 'Valid for a fixed period; renew well before expiry.', 'Before the person starts work.', 'none', null, null, 'Fines for the employer and removal of the worker.', 'https://www.immigration.go.tz', true, 'Permit classes, fees and validity.', false, false, array['hire_staff']::text[], array['work permit', 'kibali cha kazi', 'residence permit']::text[], 540, '2026-10-25'),
('BUSINESS_LICENCE', 'local_government', 'licence', 'Business licence', 'BRELA (category A) or your city, municipal, town or district council (category B)', 'always', null, 'The licence to carry on business at your premises under the Business Licensing Act. Which category and office applies depends on your activities: confirm with BRELA or your council.', array['Certificate of Incorporation and MEMART', 'TIN certificate', 'Tax clearance (for renewals)', 'Lease agreement or title deed of the premises', 'Directors'' IDs or passports (and work permits for non-citizens)', 'Application through the online licensing system (BRELA or the council''s TAUSI portal)']::text[], 'Every year.', 'Before you start trading, then before it expires each year.', 'none', null, null, 'Trading without a valid licence can lead to fines and closure of the premises.', 'https://www.brela.go.tz', true, 'Whether your activities are category A or B, the fee, and the documents your council asks for.', true, false, array['start', 'tender', 'premises', 'mining', 'industrial_clients']::text[], array['leseni ya biashara', 'business licence', 'trading licence']::text[], 600, '2026-10-25'),
('TAUSI_PORTAL', 'local_government', 'record', 'TAUSI account for council licences and levies', 'PO-RALG and your council', 'conditional', 'If your council handles your business licence, service levy or other charges through the TAUSI portal.', 'The online portal of local government authorities for business licences, service levy and other council charges.', array['Company login', 'TIN', 'Premises details']::text[], 'Keep the login and details current.', 'When you first apply for a council licence or pay a levy.', 'none', null, null, 'Without an account you cannot apply or pay online.', 'https://www.tamisemi.go.tz', true, 'The current TAUSI address and whether your council uses it.', true, false, array['start', 'premises']::text[], array['TAUSI', 'halmashauri', 'council']::text[], 610, '2026-10-25'),
('SERVICE_LEVY', 'local_government', 'filing', 'Service levy to the council', 'Your city, municipal or district council', 'always', null, 'A local levy on turnover under the Local Government Finance Act, paid to the council where you do business.', array['Turnover figures for the period', 'Payment receipt from the council']::text[], 'As your council collects it (often monthly or quarterly).', 'As set by your council: set the next due date here.', 'none', null, null, 'Penalties, and the council may refuse to renew the business licence.', null, true, 'The current rate, how often it is paid and the council''s due dates.', true, true, array['premises', 'tax']::text[], array['ushuru wa huduma', 'service levy']::text[], 620, '2026-10-25'),
('FIRE_CERTIFICATE', 'local_government', 'licence', 'Fire safety certificate', 'Tanzania Fire and Rescue Force (Jeshi la Zimamoto na Uokoaji)', 'always', null, 'After inspecting the premises, the Fire and Rescue Force issues a fire safety certificate. Extinguishers must be serviced and in date.', array['Inspection request and fee', 'Serviced and tagged fire extinguishers', 'Marked emergency exits']::text[], 'Usually every year (confirm with the Fire and Rescue Force).', 'Before opening the premises, then every year.', 'none', null, null, 'Fines; it is often needed for the business licence and for insurance claims.', null, true, 'Fees and how often the certificate is renewed.', true, false, array['premises', 'osha_inspection', 'chemicals', 'lubricants']::text[], array['zimamoto', 'fire']::text[], 630, '2026-10-25'),
('PREMISES_LEASE', 'local_government', 'record', 'Lease of the business premises', 'Landlord; stamp duty and withholding tax with TRA', 'always', null, 'A written lease for the office or store. Needed for the TIN, the business licence and VAT; tax may need to be withheld on rent.', array['Signed lease agreement', 'Stamp duty receipt', 'Landlord''s TIN']::text[], 'When the lease ends.', 'Before applying for the licence.', 'none', null, null, 'Unstamped leases may not be accepted as evidence; missing withholding tax on rent becomes the company''s liability.', 'https://www.tra.go.tz', true, 'Stamp duty and withholding tax on rent: check the current rules with TRA.', true, false, array['start', 'premises', 'tra_audit']::text[], array['mkataba wa pango', 'lease']::text[], 640, '2026-10-25'),
('SIGNBOARD_PERMIT', 'local_government', 'licence', 'Signboard permit', 'Your council', 'conditional', 'If you put up a signboard or billboard at the premises.', 'Councils charge a fee or levy for business signs.', array['Application with the size and place of the sign', 'Payment receipt']::text[], 'Usually every year.', 'Before putting up the sign.', 'none', null, null, 'Fines and removal of the sign.', null, true, 'Fees and renewal with your council.', false, false, array['premises']::text[], array['bango', 'signboard']::text[], 650, '2026-10-25'),
('PPRA_NEST', 'procurement', 'licence', 'NeST supplier registration (government tenders)', 'PPRA (Public Procurement Regulatory Authority)', 'conditional', 'If you want to bid for government and public-body tenders.', 'Public bodies run their tenders on NeST, the National e-Procurement System of Tanzania. Suppliers register and keep their profile and documents current.', array['Certificate of Incorporation and MEMART', 'TIN and VRN certificates', 'Valid business licence', 'Valid tax clearance', 'Directors, shareholders and beneficial owners', 'Audited accounts', 'Bank details', 'Registration fee']::text[], 'Registration is renewed every year (confirm the fee and date on NeST).', 'Before your first government tender, then yearly.', 'none', null, null, 'You cannot bid for public tenders without it.', 'https://www.ppra.go.tz', true, 'The current registration fee, renewal date and documents asked on NeST.', true, false, array['tender']::text[], array['NeST', 'PPRA', 'zabuni', 'TANePS', 'tender']::text[], 700, '2026-10-25'),
('GPSA_FRAMEWORK', 'procurement', 'registration', 'GPSA framework supplier', 'GPSA (Government Procurement Services Agency)', 'conditional', 'If you want to supply common-use goods (stationery, office equipment, fuel, vehicles and similar) to public bodies through framework agreements.', 'GPSA runs framework agreements for items most public bodies buy. Being on a framework makes you an approved supplier for that period.', array['Bid for the framework call', 'Company registration, TIN, VRN, tax clearance and business licence', 'Product catalogues and manufacturer authorisations']::text[], 'For each framework period.', 'When GPSA invites bids for the framework.', 'none', null, null, 'Without it you can only sell common-use items to government through open tenders.', 'https://www.gpsa.go.tz', true, 'Which items are on frameworks now and when the next call opens.', false, false, array['tender']::text[], array['GPSA', 'framework']::text[], 710, '2026-10-25'),
('TENDER_PACK', 'procurement', 'record', 'Standard tender pack (ready-to-send copies)', 'Your own checklist', 'conditional', 'Before every tender or large quotation.', 'Certified copies of the papers almost every tender asks for, kept ready so you can submit quickly.', array['Certified Certificate of Incorporation and MEMART', 'TIN and VRN certificates', 'Valid business licence and tax clearance', 'Audited accounts (the last three years when available)', 'Bank reference or statements', 'Power of attorney or board resolution for the person who signs', 'Company profile and list of past supplies with references', 'Manufacturer or distributor authorisation letters', 'Bid security or bid-securing declaration', 'NSSF and WCF compliance certificates where asked']::text[], 'Check the dates before each bid.', 'Keep it current.', 'none', null, null, 'Missing or expired papers are the most common reason bids are rejected.', null, false, null, true, false, array['tender', 'mining', 'industrial_clients', 'oil_gas']::text[], array['tender documents', 'nyaraka za zabuni']::text[], 720, '2026-10-25'),
('POWER_OF_ATTORNEY', 'procurement', 'record', 'Power of attorney or board resolution for the signatory', 'The board; registered or notarised where the buyer requires it', 'conditional', 'When someone signs bids or contracts for the company.', 'Shows that the person signing may bind the company. Tenders often ask for a power of attorney.', array['Board resolution', 'Power of attorney (notarised or registered if required)', 'Signatory''s ID']::text[], 'When the signatory changes.', 'Before signing bids or contracts.', 'none', null, null, 'Bids signed without proof of authority can be rejected.', null, true, 'Whether the buyer needs the power of attorney registered.', false, false, array['tender']::text[], array['power of attorney', 'hati ya uwakilishi']::text[], 730, '2026-10-25'),
('CLIENT_VENDOR_REGISTRATION', 'procurement', 'record', 'Vendor registration with each big client', 'Each client''s procurement department', 'conditional', 'For each mine, sugar factory, cement plant, oil & gas company or other large buyer you supply.', 'Large clients run their own supplier registration: company papers, tax clearance, bank letter, HSE, quality and anti-bribery policies, insurance, sometimes a site induction.', array['The client''s vendor form', 'Company papers and tax clearance', 'Bank confirmation letter', 'HSE, quality and anti-bribery policies', 'Insurance certificates', 'References from other clients']::text[], 'Usually checked again every year.', 'Before the first order from that client.', 'none', null, null, 'Orders and payments are held until you are an approved vendor.', null, false, null, true, false, array['mining', 'industrial_clients', 'oil_gas', 'lubricants']::text[], array['vendor registration', 'supplier onboarding', 'prequalification']::text[], 740, '2026-10-25'),
('HSE_QUALITY_POLICIES', 'procurement', 'record', 'HSE, quality and anti-bribery policies', 'Your company (clients audit them)', 'conditional', 'Asked for by mining, oil & gas and industrial clients.', 'Signed policies and simple procedures: health and safety, environment, quality (ISO 9001 style), anti-bribery and code of conduct, PPE.', array['Health, safety and environment policy', 'Quality policy', 'Anti-bribery policy / code of conduct', 'PPE and incident reporting procedure']::text[], 'Review and sign again every year.', 'Before vendor registration with industrial clients.', 'none', null, null, 'Without them you fail vendor registration and supplier audits.', null, false, null, true, false, array['mining', 'industrial_clients', 'oil_gas', 'osha_inspection']::text[], array['HSE policy', 'quality policy', 'sera']::text[], 750, '2026-10-25'),
('GCLA_CHEMICALS', 'sector', 'licence', 'GCLA chemical dealer registration and permits', 'GCLA (Government Chemist Laboratory Authority)', 'conditional', 'If you import, store, sell, transport or supply industrial or consumer chemicals (mining reagents, cleaning and water-treatment chemicals and similar).', 'Under the Industrial and Consumer Chemicals (Management and Control) Act, chemical dealers register with GCLA, the chemicals are registered, and permits are needed for imports and exports.', array['Application to register as a chemical dealer', 'Premises and storage details', 'Safety data sheet (SDS) for each chemical', 'List of chemicals and quantities', 'Import or export permit for each consignment', 'The trained person responsible for chemicals']::text[], 'Registration is renewed periodically (confirm with GCLA); a permit for each consignment.', 'Before the first chemical is imported or sold.', 'none', null, null, 'Goods held at the port, fines and confiscation.', 'https://www.gcla.go.tz', true, 'Registration categories, fees, validity and permit rules for your chemicals.', false, false, array['chemicals', 'import', 'mining']::text[], array['GCLA', 'kemikali', 'chemicals', 'mkemia mkuu']::text[], 800, '2026-10-25'),
('EWURA_PETROLEUM', 'sector', 'licence', 'EWURA licence for petroleum products and lubricants', 'EWURA (Energy and Water Utilities Regulatory Authority)', 'conditional', 'If you sell, store or distribute fuels, petroleum products or lubricants (check with EWURA whether your lubricant trade needs a licence or registration).', 'EWURA licenses petroleum supply activities (wholesale, retail, storage) and regulates the lubricants business.', array['Application on EWURA''s online licensing system', 'Company papers (incorporation, MEMART, TIN, tax clearance, business licence)', 'Storage facility details and approvals', 'Product specifications and standards conformity', 'Fire and environmental approvals for the storage']::text[], 'As stated on the licence.', 'Before you trade in the products.', 'none', null, null, 'Trading without a licence attracts fines and seizure of products.', 'https://www.ewura.go.tz', true, 'Which licence your lubricant or fuel activity needs, fees and validity.', false, false, array['lubricants', 'mining', 'oil_gas', 'industrial_clients']::text[], array['EWURA', 'lubricants', 'vilainishi', 'mafuta', 'oil', 'petroleum']::text[], 810, '2026-10-25'),
('MINING_LOCAL_CONTENT', 'sector', 'registration', 'Mining Commission local-content supplier registration', 'Mining Commission (Tume ya Madini)', 'conditional', 'If you supply goods or services to mining companies.', 'Mining local-content rules require mines to buy from Tanzanian suppliers and report them. Mines usually ask suppliers to be registered with the Commission''s local-content system. Tanzanian ownership is checked, so settle the shareholding first.', array['Certificate of Incorporation and MEMART showing the shareholders', 'TIN, VRN, tax clearance and business licence', 'Company profile and the goods and services you supply', 'Shareholders'' and directors'' IDs']::text[], 'Confirm with the Commission.', 'Before tendering to mines.', 'none', null, null, 'Mines may not be allowed to buy from suppliers that are not registered.', 'https://www.tumemadini.go.tz', true, 'Registration steps, fees, renewal and the ownership rules that apply.', false, false, array['mining', 'lubricants', 'chemicals']::text[], array['local content', 'Tume ya Madini', 'mining commission', 'migodi']::text[], 820, '2026-10-25'),
('PURA_LOCAL_CONTENT', 'sector', 'registration', 'Oil & gas (upstream) local-content supplier registration', 'PURA (Petroleum Upstream Regulatory Authority)', 'conditional', 'If you supply upstream oil & gas companies (exploration and production) or their contractors.', 'Upstream local-content rules give preference to registered local suppliers; register in the supplier database the regulator uses.', array['Company papers and tax clearance', 'Shareholding details', 'Company profile, HSE and quality policies']::text[], 'Confirm with PURA.', 'Before tendering to oil & gas companies.', 'none', null, null, 'You may not be considered for upstream contracts.', 'https://www.pura.go.tz', true, 'Which register applies, the steps and renewal.', false, false, array['oil_gas']::text[], array['PURA', 'oil and gas', 'mafuta na gesi']::text[], 830, '2026-10-25'),
('TBS_CERTIFICATION', 'sector', 'licence', 'TBS product standards and import conformity', 'TBS (Tanzania Bureau of Standards)', 'conditional', 'If you pack or brand products, import goods that need conformity checks, or clients ask for TBS-certified goods.', 'TBS certifies products against Tanzanian standards (the TBS mark) and checks imported goods for conformity before or on arrival.', array['Product specifications and test reports', 'Certificate of conformity from the exporting country where required', 'TBS application and fees']::text[], 'Per certificate or per consignment.', 'Before importing or selling regulated products.', 'none', null, null, 'Goods can be held, tested at your cost or destroyed.', 'https://www.tbs.go.tz', true, 'Whether your products need certification or import inspection, and the current procedure.', false, false, array['import', 'lubricants', 'industrial_clients']::text[], array['TBS', 'standards', 'viwango', 'PVoC']::text[], 840, '2026-10-25'),
('NEMC_ENVIRONMENT', 'sector', 'licence', 'NEMC environmental compliance', 'NEMC (National Environment Management Council)', 'conditional', 'If you store chemicals or petroleum products, handle hazardous waste, or run a warehouse or project that needs an environmental assessment.', 'Projects and some premises need an environmental impact assessment (EIA) certificate or an environmental audit; hazardous waste needs permits.', array['Project brief or EIA report by a registered expert', 'EIA certificate', 'Waste management plan', 'Environmental monitoring or audit report where required']::text[], 'As set in the certificate; audits and reports as required.', 'Before the project or storage starts.', 'none', null, null, 'Stop orders and fines.', 'https://www.nemc.or.tz', true, 'Whether your premises or activity needs an EIA, an audit or a waste permit.', false, false, array['chemicals', 'lubricants', 'premises']::text[], array['NEMC', 'mazingira', 'environment', 'EIA']::text[], 850, '2026-10-25'),
('TMDA_PRODUCTS', 'sector', 'licence', 'TMDA premises and product registration', 'TMDA (Tanzania Medicines and Medical Devices Authority)', 'conditional', 'Only if you supply medicines, medical devices, diagnostics or medical-grade PPE (for example surgical masks and medical gloves). Ordinary industrial PPE is not normally TMDA-regulated: confirm with TMDA.', 'Premises and products dealing in medicines and medical devices must be registered or permitted.', array['Premises registration', 'Product registration or notification', 'Qualified person where required', 'Import permit for each consignment']::text[], 'As stated on the permits.', 'Before importing or selling the products.', 'none', null, null, 'Seizure of products and fines.', 'https://www.tmda.go.tz', true, 'Whether your products are regulated by TMDA.', false, false, array['import']::text[], array['TMDA', 'medical', 'dawa', 'PPE']::text[], 860, '2026-10-25'),
('SDS_PRODUCT_DOCS', 'sector', 'record', 'Safety data sheets and product certificates', 'Manufacturers; checked by GCLA, OSHA and clients', 'conditional', 'For every chemical, lubricant or hazardous product you supply.', 'Keep a current SDS (and a certificate of analysis where relevant) for each product. Mines and plants ask for them before delivery; inspectors check them.', array['SDS for each product (current version)', 'Certificates of analysis (CoA)', 'Manufacturer or distributor authorisation', 'Product datasheets']::text[], 'When the manufacturer updates them.', 'Before the first delivery of the product.', 'none', null, null, 'Deliveries refused at the gate; findings in inspections.', null, false, null, false, false, array['chemicals', 'lubricants', 'mining', 'osha_inspection', 'industrial_clients']::text[], array['SDS', 'MSDS', 'CoA', 'datasheet']::text[], 870, '2026-10-25'),
('WMA_VERIFICATION', 'sector', 'licence', 'Verification of scales and measures', 'WMA (Weights and Measures Agency)', 'conditional', 'If you sell by weight or volume using your own scales, meters or measures (for example bulk oils).', 'Scales and measuring instruments used in trade must be verified and stamped.', array['List of instruments', 'Verification certificate or stamp', 'Fee receipt']::text[], 'Usually every year.', 'Before using the instrument for sales, then every year.', 'none', null, null, 'Fines and seizure of unverified instruments.', 'https://www.wma.go.tz', true, 'How often your instruments must be verified and the fees.', false, false, array['lubricants']::text[], array['WMA', 'vipimo', 'scales']::text[], 880, '2026-10-25'),
('LATRA_VEHICLES', 'sector', 'licence', 'Commercial vehicle licences', 'LATRA (Land Transport Regulatory Authority)', 'conditional', 'If you run trucks or vehicles carrying goods for hire (check with LATRA whether vehicles carrying only your own goods need a licence).', 'Goods vehicles used commercially need LATRA licences, as well as the usual road licence, inspection and insurance.', array['Vehicle registration cards', 'Insurance', 'Vehicle inspection report', 'LATRA application']::text[], 'Usually every year.', 'Before the vehicle is used commercially.', 'none', null, null, 'Fines and vehicles held at checkpoints.', 'https://www.latra.go.tz', true, 'Whether your vehicles need a LATRA licence.', false, false, array['vehicles']::text[], array['LATRA', 'magari', 'transport']::text[], 890, '2026-10-25'),
('IMPORT_CUSTOMS', 'import', 'record', 'Imports: customs declaration (TANCIS) and permits', 'TRA Customs', 'conditional', 'If you import goods.', 'Imports are declared in TANCIS, normally by a licensed clearing and forwarding agent. You need a TIN, and some goods need permits (GCLA, TBS, TMDA, others) before they are released.', array['Commercial invoice and packing list', 'Bill of lading or airway bill', 'Certificate of origin', 'Permits for regulated goods', 'Insurance certificate from a local insurer', 'Letter appointing the clearing agent']::text[], 'For every consignment.', 'Before the goods arrive.', 'none', null, null, 'Wrong declarations attract penalties; goods without permits are held.', 'https://www.tra.go.tz', true, 'Duty rates and permits for each product (ask your clearing agent and TRA Customs).', false, false, array['import', 'chemicals']::text[], array['TANCIS', 'customs', 'forodha', 'clearing agent', 'import']::text[], 900, '2026-10-25'),
('CUSTOMS_AGENT_LICENCE', 'import', 'licence', 'Customs agent licence (only if you clear goods yourselves)', 'TRA Customs', 'conditional', 'Only if the company itself acts as a clearing and forwarding agent. Most suppliers use a licensed agent instead.', 'Only licensed customs agents may lodge declarations for others.', array['Application to TRA Customs', 'Qualified staff certificates', 'Bond or guarantee']::text[], 'As stated on the licence.', 'Before clearing goods.', 'none', null, null, 'Declarations refused.', 'https://www.tra.go.tz', true, 'The requirements for a customs agent licence.', false, false, array['import']::text[], '{}'::text[], 910, '2026-10-25'),
('TIRA_INSURANCE', 'insurance', 'licence', 'Business insurance (TIRA-licensed insurers)', 'TIRA (Tanzania Insurance Regulatory Authority)', 'always', null, 'Motor third-party insurance is compulsory for every vehicle; imports are expected to be insured with insurers in Tanzania; clients often ask for public liability, goods-in-transit or professional cover. Buy only from licensed insurers.', array['Policy schedules and certificates', 'Premium receipts', 'Motor insurance certificate or sticker']::text[], 'Every year for each policy.', 'Before each policy ends.', 'none', null, null, 'Driving without motor insurance is an offence; uninsured losses fall on the company.', 'https://www.tira.go.tz', true, 'Which covers your clients require and the rules on insuring imports locally.', true, false, array['vehicles', 'import', 'mining', 'industrial_clients', 'oil_gas', 'lubricants']::text[], array['insurance', 'bima', 'TIRA']::text[], 950, '2026-10-25')
on conflict (code) do update
  set category = excluded.category,
      kind = excluded.kind,
      name = excluded.name,
      authority = excluded.authority,
      applies_to = excluded.applies_to,
      condition = excluded.condition,
      purpose = excluded.purpose,
      documents_needed = excluded.documents_needed,
      renewal = excluded.renewal,
      due_rule = excluded.due_rule,
      frequency = excluded.frequency,
      due_day = excluded.due_day,
      due_offset_months = excluded.due_offset_months,
      penalty = excluded.penalty,
      website = excluded.website,
      verify = excluded.verify,
      verify_note = excluded.verify_note,
      starter = excluded.starter,
      finance = excluded.finance,
      tags = excluded.tags,
      keywords = excluded.keywords,
      sort = excluded.sort,
      reviewed_on = excluded.reviewed_on,
      updated_at = now();
-- 57 requirements, reviewed 2026-10-25
-- END GENERATED COMPLIANCE CATALOGUE

-- ---------------------------------------------------------------------
-- 3. The company's settings for this area (one row per company)
-- ---------------------------------------------------------------------
create table if not exists public.compliance_settings (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null unique references public.companies (id) on delete cascade,
  year_end_month     integer not null default 12 check (year_end_month between 1 and 12),
  incorporated_on    date,
  shares_decided     boolean not null default false,
  shares_decided_at  timestamptz,
  shareholding_note  text check (shareholding_note is null or char_length(shareholding_note) <= 4000),
  board_note         text check (board_note is null or char_length(board_note) <= 4000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. Licences register
-- ---------------------------------------------------------------------
create table if not exists public.licences (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 2 and 160),
  authority       text check (authority is null or char_length(authority) <= 160),
  catalogue_code  text check (catalogue_code is null or char_length(catalogue_code) <= 60),
  licence_no      text check (licence_no is null or char_length(licence_no) <= 80),
  category        text check (category is null or char_length(category) <= 80),
  product_scope   text check (product_scope is null or char_length(product_scope) <= 500),
  status          text not null default 'planned' check (status in ('planned', 'applied', 'active', 'expired', 'suspended')),
  applied_on      date,
  issued_on       date,
  expires_on      date,
  remind_days     integer not null default 60 check (remind_days between 0 and 365),
  conditions      text check (conditions is null or char_length(conditions) <= 2000),
  cost            numeric(18, 2) check (cost is null or cost >= 0),
  currency        text not null default 'TZS' check (currency ~ '^[A-Z]{3}$'),
  notes           text check (notes is null or char_length(notes) <= 2000),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, company_id),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index if not exists licences_company_idx on public.licences (company_id, status, expires_on);

-- ---------------------------------------------------------------------
-- 5. The company's checklist
-- ---------------------------------------------------------------------
create table if not exists public.compliance_items (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  code               text,
  name               text not null check (char_length(btrim(name)) between 2 and 160),
  category           text not null default 'company'
                     check (category in ('company', 'tax', 'social_security', 'labour', 'local_government',
                                         'procurement', 'sector', 'import', 'insurance')),
  authority          text check (authority is null or char_length(authority) <= 160),
  frequency          text not null default 'none' check (frequency in ('none', 'monthly', 'quarterly', 'annual')),
  due_day            integer check (due_day between 1 and 31),
  due_offset_months  integer check (due_offset_months between -11 and 12),
  calendar_from      date,
  due_on             date,
  status             text not null default 'not_started' check (status in ('not_started', 'in_progress', 'done', 'not_applicable')),
  status_note        text check (status_note is null or char_length(status_note) <= 500),
  done_on            date,
  done_by            uuid references auth.users (id) on delete set null,
  owner_id           uuid references auth.users (id) on delete set null,
  licence_id         uuid,
  finance_ok         boolean not null default false,
  notes              text check (notes is null or char_length(notes) <= 2000),
  sort               integer not null default 1000,
  created_by         uuid default auth.uid() references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, company_id),
  foreign key (licence_id, company_id) references public.licences (id, company_id) on delete set null (licence_id)
);
create unique index if not exists compliance_items_code_key on public.compliance_items (company_id, code) where code is not null;
create index if not exists compliance_items_company_idx on public.compliance_items (company_id, category, sort);
create index if not exists compliance_items_due_idx on public.compliance_items (company_id, due_on) where due_on is not null;

-- ---------------------------------------------------------------------
-- 6. Recurring filings: one row per item and period
-- ---------------------------------------------------------------------
create table if not exists public.compliance_deadlines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  item_id       uuid not null,
  period_start  date not null,
  period_end    date not null,
  due_on        date not null,
  status        text not null default 'open' check (status in ('open', 'filed', 'not_required')),
  filed_on      date,
  reference     text check (reference is null or char_length(reference) <= 120),
  note          text check (note is null or char_length(note) <= 500),
  filed_by      uuid references auth.users (id) on delete set null,
  filed_at      timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (item_id, period_start),
  foreign key (item_id, company_id) references public.compliance_items (id, company_id) on delete cascade,
  check (period_end >= period_start)
);
create index if not exists compliance_deadlines_company_idx on public.compliance_deadlines (company_id, status, due_on);

-- ---------------------------------------------------------------------
-- 7. Documents from the library linked to an item or a licence
-- ---------------------------------------------------------------------
create table if not exists public.compliance_documents (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  document_id  uuid not null,
  item_id      uuid,
  licence_id   uuid,
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  foreign key (document_id, company_id) references public.documents (id, company_id) on delete cascade,
  foreign key (item_id, company_id) references public.compliance_items (id, company_id) on delete cascade,
  foreign key (licence_id, company_id) references public.licences (id, company_id) on delete cascade,
  check (num_nonnulls(item_id, licence_id) = 1)
);
create unique index if not exists compliance_documents_item_key on public.compliance_documents (item_id, document_id) where item_id is not null;
create unique index if not exists compliance_documents_licence_key on public.compliance_documents (licence_id, document_id) where licence_id is not null;
create index if not exists compliance_documents_document_idx on public.compliance_documents (document_id);

-- ---------------------------------------------------------------------
-- 8. Directors and shareholders
-- ---------------------------------------------------------------------
create table if not exists public.company_directors (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  full_name      text not null check (char_length(btrim(full_name)) between 2 and 120),
  role           text not null default 'director'
                 check (role in ('director', 'managing_director', 'chairperson', 'secretary', 'shareholder')),
  id_type        text not null default 'nida' check (id_type in ('nida', 'passport', 'other')),
  id_number      text check (id_number is null or char_length(id_number) <= 40),
  nationality    text check (nationality is null or char_length(nationality) <= 60),
  tin            text check (tin is null or char_length(tin) <= 40),
  appointed_on   date,
  resigned_on    date,
  phone          text check (phone is null or char_length(phone) <= 40),
  email          text check (email is null or char_length(email) <= 120),
  address        text check (address is null or char_length(address) <= 300),
  share_percent  numeric(7, 3) check (share_percent is null or (share_percent >= 0 and share_percent <= 100)),
  shares_held    bigint check (shares_held is null or shares_held >= 0),
  notes          text check (notes is null or char_length(notes) <= 1000),
  sort           integer not null default 0,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (resigned_on is null or appointed_on is null or resigned_on >= appointed_on)
);
create index if not exists company_directors_company_idx on public.company_directors (company_id, sort, full_name);

-- ---------------------------------------------------------------------
-- 9. Rules on the rows
-- ---------------------------------------------------------------------
-- Management writes everything; finance also the tax and social-security items.
create or replace function public.compliance_can_write(p_company uuid, p_finance_ok boolean)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_manager(p_company)
      or (coalesce(p_finance_ok, false) and public.has_role(p_company, array['finance']::public.app_role[]));
$$;

create or replace function public.prepare_compliance_record()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_flag boolean := coalesce(current_setting('ims.status_change', true), '') = 'on';
begin
  if tg_table_name = 'compliance_items' then
    new.name := btrim(new.name);
    if tg_op = 'INSERT' then
      if not v_flag then
        new.status := 'not_started';
        new.done_on := null;
        new.done_by := null;
      end if;
      if new.code is null then
        new.finance_ok := new.category in ('tax', 'social_security');
      end if;
    end if;
    if new.owner_id is not null and (tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id)
       and not public.is_active_member(new.company_id, new.owner_id) then
      raise exception 'Only active team members can be responsible for an item.' using errcode = '22023';
    end if;
    if new.frequency = 'none' then
      new.due_day := null;
      new.due_offset_months := null;
    elsif new.due_day is not null and new.due_offset_months is null then
      new.due_offset_months := 1;
    end if;
    if tg_op = 'UPDATE' and not v_flag
       and (new.status is distinct from old.status or new.done_on is distinct from old.done_on
            or new.done_by is distinct from old.done_by or new.code is distinct from old.code
            or new.finance_ok is distinct from old.finance_ok) then
      raise exception 'Use the buttons to change the status.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'licences' then
    new.name := btrim(new.name);
    new.licence_no := nullif(btrim(new.licence_no), '');
    if tg_op = 'INSERT' and new.status in ('expired', 'suspended') and not v_flag then
      new.status := 'planned';
    end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status and not v_flag then
      raise exception 'Use the buttons to change the status.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'compliance_deadlines' then
    if tg_op = 'UPDATE' and not v_flag
       and (new.status is distinct from old.status or new.filed_on is distinct from old.filed_on
            or new.reference is distinct from old.reference or new.filed_by is distinct from old.filed_by) then
      raise exception 'Use Mark filed to record a filing.' using errcode = '42501';
    end if;
  elsif tg_table_name = 'company_directors' then
    new.full_name := btrim(new.full_name);
  end if;
  return new;
end;
$$;

-- Shares of current shareholders never add up to more than 100%.
create or replace function public.check_director_shares()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_sum numeric;
begin
  select coalesce(sum(share_percent), 0) into v_sum
    from public.company_directors where company_id = new.company_id and resigned_on is null;
  if v_sum > 100 then
    raise exception 'The shares add up to % %%: they cannot be more than 100 %%.', round(v_sum, 3) using errcode = '22023';
  end if;
  return null;
end;
$$;

-- A change to how an item repeats (or switching it off) clears its open future filings; they are built again.
create or replace function public.on_compliance_item_changed()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.frequency is distinct from old.frequency or new.due_day is distinct from old.due_day
     or new.due_offset_months is distinct from old.due_offset_months or new.calendar_from is distinct from old.calendar_from
     or (new.status = 'not_applicable' and old.status <> 'not_applicable') then
    perform set_config('ims.status_change', 'on', true);
    delete from public.compliance_deadlines
     where item_id = new.id and status = 'open'
       and (new.status = 'not_applicable' or due_on >= (now() at time zone 'Africa/Dar_es_Salaam')::date
            or (new.calendar_from is not null and due_on < new.calendar_from));
    perform set_config('ims.status_change', '', true);
  end if;
  return null;
end;
$$;

-- The guards above block direct changes to statuses; clearing a company's data is allowed.
drop trigger if exists compliance_items_prepare on public.compliance_items;
create trigger compliance_items_prepare before insert or update on public.compliance_items
  for each row execute function public.prepare_compliance_record();
drop trigger if exists licences_prepare on public.licences;
create trigger licences_prepare before insert or update on public.licences
  for each row execute function public.prepare_compliance_record();
drop trigger if exists compliance_deadlines_prepare on public.compliance_deadlines;
create trigger compliance_deadlines_prepare before insert or update on public.compliance_deadlines
  for each row execute function public.prepare_compliance_record();
drop trigger if exists company_directors_prepare on public.company_directors;
create trigger company_directors_prepare before insert or update on public.company_directors
  for each row execute function public.prepare_compliance_record();
drop trigger if exists company_directors_shares on public.company_directors;
create trigger company_directors_shares after insert or update of share_percent, resigned_on on public.company_directors
  for each row execute function public.check_director_shares();
drop trigger if exists compliance_items_changed on public.compliance_items;
create trigger compliance_items_changed after update on public.compliance_items
  for each row execute function public.on_compliance_item_changed();

-- ---------------------------------------------------------------------
-- 10. Functions: checklist
-- ---------------------------------------------------------------------
-- Add requirements from the catalogue. No codes: the usual set for a new general supply company.
-- p_registered: the company is already registered with BRELA (certificate and MEMART marked done).
create or replace function public.compliance_adopt(p_company uuid, p_codes text[] default null, p_registered boolean default false)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_codes   text[];
  v_unknown text;
  v_n       integer;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can set up the checklist.' using errcode = '42501';
  end if;
  v_codes := coalesce(p_codes, array(select code from public.compliance_catalogue where starter order by sort));
  select string_agg(c, ', ') into v_unknown
    from unnest(v_codes) c where not exists (select 1 from public.compliance_catalogue k where k.code = c);
  if v_unknown is not null then
    raise exception 'Unknown requirement: %', v_unknown using errcode = '22023';
  end if;
  insert into public.compliance_settings (company_id) values (p_company) on conflict (company_id) do nothing;
  insert into public.compliance_items (company_id, code, name, category, authority, frequency, due_day, due_offset_months,
                                       finance_ok, sort)
  select p_company, k.code, k.name, k.category, left(k.authority, 160), k.frequency, k.due_day, k.due_offset_months,
         k.finance, k.sort
    from public.compliance_catalogue k
   where k.code = any (v_codes)
  on conflict (company_id, code) where code is not null do nothing;
  get diagnostics v_n = row_count;
  if p_registered then
    perform set_config('ims.status_change', 'on', true);
    update public.compliance_items
       set status = 'done', done_on = (now() at time zone 'Africa/Dar_es_Salaam')::date, done_by = auth.uid(),
           status_note = 'Registered with BRELA. Upload the copy.'
     where company_id = p_company and code in ('BRELA_INCORPORATION', 'BRELA_MEMART') and status = 'not_started';
    perform set_config('ims.status_change', '', true);
  end if;
  return v_n;
end;
$$;

create or replace function public.compliance_set_status(p_item uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  i public.compliance_items;
begin
  select * into i from public.compliance_items where id = p_item;
  if i.id is null or not public.compliance_can_write(i.company_id, i.finance_ok) then
    raise exception 'Only management can change this.' using errcode = '42501';
  end if;
  if p_status not in ('not_started', 'in_progress', 'done', 'not_applicable') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.compliance_items
     set status = p_status,
         status_note = nullif(btrim(coalesce(p_note, '')), ''),
         done_on = case when p_status = 'done' then coalesce(case when i.status = 'done' then i.done_on end,
                                                             (now() at time zone 'Africa/Dar_es_Salaam')::date) end,
         done_by = case when p_status = 'done' then coalesce(case when i.status = 'done' then i.done_by end, auth.uid()) end,
         -- Back from "does not apply": the calendar starts again from today, not from when it was added.
         calendar_from = case when i.status = 'not_applicable' and p_status <> 'not_applicable'
                              then (now() at time zone 'Africa/Dar_es_Salaam')::date else i.calendar_from end
   where id = p_item;
  perform set_config('ims.status_change', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Functions: licences
-- ---------------------------------------------------------------------
create or replace function public.compliance_set_licence_status(p_licence uuid, p_status text, p_on date)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  l       public.licences;
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
begin
  select * into l from public.licences where id = p_licence;
  if l.id is null or not public.is_manager(l.company_id) then
    raise exception 'Only management can change a licence.' using errcode = '42501';
  end if;
  if p_status not in ('planned', 'applied', 'active', 'expired', 'suspended') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  if p_status = 'active' and l.expires_on is not null and l.expires_on < v_today then
    raise exception 'The expiry date has passed. Enter the new expiry date first.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.licences
     set status = p_status,
         applied_on = case when p_status = 'applied' then coalesce(p_on, applied_on, v_today) else applied_on end,
         issued_on = case when p_status = 'active' then coalesce(p_on, issued_on, v_today) else issued_on end
   where id = p_licence;
  perform set_config('ims.status_change', '', true);
end;
$$;

-- Who may link a document to an item or licence.
create or replace function public.compliance_can_link(p_company uuid, p_item uuid, p_licence uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select case
    when p_item is not null then exists (select 1 from public.compliance_items i
                                          where i.id = p_item and i.company_id = p_company
                                            and public.compliance_can_write(i.company_id, i.finance_ok))
    when p_licence is not null then public.is_manager(p_company)
    else false end;
$$;

-- ---------------------------------------------------------------------
-- 12. Functions: the filing calendar
-- ---------------------------------------------------------------------
create or replace function public.compliance_period_label(p_start date, p_end date)
returns text language sql immutable set search_path = ''
as $$
  select case
    when date_trunc('month', p_start) = date_trunc('month', p_end) then to_char(p_start, 'Mon YYYY')
    when p_end - p_start < 100 then 'Quarter to ' || to_char(p_end, 'Mon YYYY')
    else 'Year to ' || to_char(p_end, 'Mon YYYY') end;
$$;

-- Internal: build the open filings of every recurring item due up to p_until (kept once built).
create or replace function public.compliance_generate_deadlines(p_company uuid, p_until date)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_ye    integer;
  r       record;
  v_len   integer;
  m       date;
  v_month date;
  v_due   date;
  v_from  date;
  v_n     integer := 0;
  v_k     integer;
begin
  select year_end_month into v_ye from public.compliance_settings where company_id = p_company;
  v_ye := coalesce(v_ye, 12);
  for r in select i.* from public.compliance_items i
            where i.company_id = p_company and i.frequency <> 'none' and i.due_day is not null
              and i.due_offset_months is not null and i.status <> 'not_applicable' loop
    v_len := case r.frequency when 'monthly' then 1 when 'quarterly' then 3 else 12 end;
    v_from := coalesce(r.calendar_from, (r.created_at at time zone 'Africa/Dar_es_Salaam')::date);
    -- m: the first day of the last month of each period
    for m in select d::date from generate_series(date_trunc('month', v_from - interval '24 months'),
                                                 date_trunc('month', p_until + interval '13 months'), interval '1 month') d loop
      if v_len > 1 and mod(mod(extract(month from m)::int - v_ye, v_len) + v_len, v_len) <> 0 then
        continue;
      end if;
      v_month := (m + make_interval(months => r.due_offset_months))::date;
      v_due := v_month + (least(r.due_day, extract(day from (v_month + interval '1 month' - interval '1 day'))::int) - 1);
      continue when v_due < v_from or v_due > p_until;
      insert into public.compliance_deadlines (company_id, item_id, period_start, period_end, due_on)
      values (p_company, r.id, (m - make_interval(months => v_len - 1))::date, (m + interval '1 month' - interval '1 day')::date, v_due)
      on conflict (item_id, period_start) do update
        set due_on = excluded.due_on, period_end = excluded.period_end
        where public.compliance_deadlines.status = 'open'
          and (public.compliance_deadlines.due_on, public.compliance_deadlines.period_end) is distinct from (excluded.due_on, excluded.period_end);
      get diagnostics v_k = row_count;
      v_n := v_n + v_k;
    end loop;
  end loop;
  return v_n;
end;
$$;

-- Anyone who reads the calendar: bring it up to date (the next 100 days).
create or replace function public.compliance_refresh_calendar(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
begin
  if not public.has_role(p_company, public.document_roles()) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  return public.compliance_generate_deadlines(p_company, (now() at time zone 'Africa/Dar_es_Salaam')::date + 100);
end;
$$;

create or replace function public.compliance_mark_filed(p_deadline uuid, p_filed_on date, p_reference text, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  d public.compliance_deadlines;
  i public.compliance_items;
begin
  select * into d from public.compliance_deadlines where id = p_deadline;
  select * into i from public.compliance_items where id = d.item_id;
  if d.id is null or not public.compliance_can_write(d.company_id, i.finance_ok) then
    raise exception 'Only management can mark this filing.' using errcode = '42501';
  end if;
  if d.status <> 'open' then
    raise exception 'This filing is already marked.' using errcode = '22023';
  end if;
  if p_filed_on is not null and p_filed_on > (now() at time zone 'Africa/Dar_es_Salaam')::date then
    raise exception 'The filing date cannot be in the future.' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.compliance_deadlines
     set status = 'filed', filed_on = coalesce(p_filed_on, (now() at time zone 'Africa/Dar_es_Salaam')::date),
         reference = nullif(btrim(coalesce(p_reference, '')), ''), note = nullif(btrim(coalesce(p_note, '')), ''),
         filed_by = auth.uid(), filed_at = now()
   where id = p_deadline;
  perform set_config('ims.status_change', '', true);
end;
$$;

-- Nothing to file for that period (for example no salaries paid that month).
create or replace function public.compliance_skip_filing(p_deadline uuid, p_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  d public.compliance_deadlines;
  i public.compliance_items;
begin
  select * into d from public.compliance_deadlines where id = p_deadline;
  select * into i from public.compliance_items where id = d.item_id;
  if d.id is null or not public.compliance_can_write(d.company_id, i.finance_ok) then
    raise exception 'Only management can mark this filing.' using errcode = '42501';
  end if;
  if d.status <> 'open' then
    raise exception 'This filing is already marked.' using errcode = '22023';
  end if;
  if coalesce(btrim(p_note), '') = '' then
    raise exception 'Say why nothing was filed (for example: no salaries paid that month).' using errcode = '22023';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.compliance_deadlines
     set status = 'not_required', note = btrim(p_note), filed_by = auth.uid(), filed_at = now(), filed_on = null, reference = null
   where id = p_deadline;
  perform set_config('ims.status_change', '', true);
end;
$$;

create or replace function public.compliance_reopen_filing(p_deadline uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  d public.compliance_deadlines;
  i public.compliance_items;
begin
  select * into d from public.compliance_deadlines where id = p_deadline;
  select * into i from public.compliance_items where id = d.item_id;
  if d.id is null or not public.compliance_can_write(d.company_id, i.finance_ok) then
    raise exception 'Only management can change this filing.' using errcode = '42501';
  end if;
  perform set_config('ims.status_change', 'on', true);
  update public.compliance_deadlines
     set status = 'open', filed_on = null, reference = null, note = null, filed_by = null, filed_at = null
   where id = p_deadline;
  perform set_config('ims.status_change', '', true);
end;
$$;

-- ---------------------------------------------------------------------
-- 13. Functions: settings, directors and shares
-- ---------------------------------------------------------------------
create or replace function public.compliance_save_settings(p_company uuid, p_year_end_month integer, p_incorporated_on date,
                                                           p_shareholding_note text, p_board_note text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_old integer;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can change this.' using errcode = '42501';
  end if;
  if p_year_end_month is not null and p_year_end_month not between 1 and 12 then
    raise exception 'Choose the month your financial year ends.' using errcode = '22023';
  end if;
  select year_end_month into v_old from public.compliance_settings where company_id = p_company;
  insert into public.compliance_settings (company_id, year_end_month, incorporated_on, shareholding_note, board_note)
  values (p_company, coalesce(p_year_end_month, 12), p_incorporated_on,
          nullif(btrim(coalesce(p_shareholding_note, '')), ''), nullif(btrim(coalesce(p_board_note, '')), ''))
  on conflict (company_id) do update
    set year_end_month = excluded.year_end_month, incorporated_on = excluded.incorporated_on,
        shareholding_note = excluded.shareholding_note, board_note = excluded.board_note;
  if v_old is distinct from coalesce(p_year_end_month, 12) then
    -- Quarters and years move with the year end: open future filings are built again.
    perform set_config('ims.status_change', 'on', true);
    delete from public.compliance_deadlines d using public.compliance_items i
     where i.id = d.item_id and d.company_id = p_company and i.frequency in ('quarterly', 'annual')
       and d.status = 'open' and d.due_on >= (now() at time zone 'Africa/Dar_es_Salaam')::date;
    perform set_config('ims.status_change', '', true);
  end if;
end;
$$;

create or replace function public.compliance_set_shares_decided(p_company uuid, p_decided boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_sum numeric;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can change this.' using errcode = '42501';
  end if;
  if p_decided then
    select coalesce(sum(share_percent), 0) into v_sum
      from public.company_directors where company_id = p_company and resigned_on is null;
    if v_sum <= 0 then
      raise exception 'Enter each shareholder''s percentage first.' using errcode = '22023';
    end if;
    if v_sum > 100 then
      raise exception 'The shares add up to more than 100 %%.' using errcode = '22023';
    end if;
  end if;
  insert into public.compliance_settings (company_id, shares_decided, shares_decided_at)
  values (p_company, coalesce(p_decided, false), case when p_decided then now() end)
  on conflict (company_id) do update
    set shares_decided = excluded.shares_decided, shares_decided_at = excluded.shares_decided_at;
end;
$$;

-- ---------------------------------------------------------------------
-- 14. Summary for the dashboard card and the overview
-- ---------------------------------------------------------------------
create or replace function public.compliance_summary(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_items jsonb;
  v_fil   jsonb;
  v_lic   jsonb;
  v_next  jsonb;
  v_docs  integer;
  v_total integer;
  v_done  integer;
begin
  if not public.has_role(p_company, public.document_roles()) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'items', count(*),
           'applicable', count(*) filter (where status <> 'not_applicable'),
           'done', count(*) filter (where status = 'done'),
           'in_progress', count(*) filter (where status = 'in_progress'),
           'not_started', count(*) filter (where status = 'not_started'),
           'not_applicable', count(*) filter (where status = 'not_applicable'),
           'items_overdue', count(*) filter (where status in ('not_started', 'in_progress') and due_on < v_today),
           'items_due_soon', count(*) filter (where status in ('not_started', 'in_progress') and due_on between v_today and v_today + 14),
           'missing_docs', count(*) filter (where status = 'done' and not exists (
                              select 1 from public.compliance_documents x where x.item_id = i.id)
                              and coalesce((select k.kind from public.compliance_catalogue k where k.code = i.code), 'record')
                                  in ('registration', 'licence')))
    into v_items
    from public.compliance_items i where i.company_id = p_company;
  select jsonb_build_object(
           'filings_overdue', count(*) filter (where d.due_on < v_today),
           'filings_due_soon', count(*) filter (where d.due_on between v_today and v_today + 14))
    into v_fil
    from public.compliance_deadlines d join public.compliance_items i on i.id = d.item_id
   where d.company_id = p_company and d.status = 'open' and i.status <> 'not_applicable';
  select jsonb_build_object(
           'licences', count(*),
           'licences_active', count(*) filter (where status = 'active' and (expires_on is null or expires_on >= v_today)),
           'licences_pending', count(*) filter (where status in ('planned', 'applied')),
           'licences_expiring', count(*) filter (where status = 'active' and expires_on between v_today and v_today + remind_days),
           'licences_expired', count(*) filter (where status in ('active', 'expired') and expires_on < v_today),
           'licences_suspended', count(*) filter (where status = 'suspended'))
    into v_lic
    from public.licences where company_id = p_company;
  select count(*) into v_docs from public.documents
   where company_id = p_company and archived_at is null and expires_on is not null
     and kind in ('certificate', 'licence', 'tax', 'company', 'insurance') and expires_on <= v_today + remind_days;
  select coalesce(jsonb_agg(x order by x ->> 'due_on'), '[]'::jsonb) into v_next from (
    select jsonb_build_object('id', d.id, 'item_id', i.id, 'name', i.name, 'due_on', d.due_on,
                              'period', public.compliance_period_label(d.period_start, d.period_end)) x
      from public.compliance_deadlines d join public.compliance_items i on i.id = d.item_id
     where d.company_id = p_company and d.status = 'open' and i.status <> 'not_applicable'
     order by d.due_on limit 5) n;
  v_total := (v_items ->> 'applicable')::int;
  v_done := (v_items ->> 'done')::int;
  return v_items || v_fil || v_lic || jsonb_build_object(
    'ready', true,
    'can_manage', public.is_manager(p_company),
    'score', case when v_total > 0 then round(100.0 * v_done / v_total)::int else 0 end,
    'overdue', (v_items ->> 'items_overdue')::int + (v_fil ->> 'filings_overdue')::int,
    'due_soon', (v_items ->> 'items_due_soon')::int + (v_fil ->> 'filings_due_soon')::int,
    'documents_expiring', v_docs,
    'directors', (select count(*) from public.company_directors where company_id = p_company and resigned_on is null
                    and role <> 'shareholder'),
    'shares_decided', coalesce((select shares_decided from public.compliance_settings where company_id = p_company), false),
    'set_up', exists (select 1 from public.compliance_items where company_id = p_company),
    'next_filings', v_next);
end;
$$;

-- ---------------------------------------------------------------------
-- 15. Daily alerts (run with the other alerts)
-- ---------------------------------------------------------------------
create or replace function public.run_compliance_alerts(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_today  date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
  v_before bigint;
  v_after  bigint;
  r        record;
  v_band   integer;
  v_sev    text;
  v_title  text;
  v_key    text;
  v_roles  public.app_role[];
begin
  if not exists (select 1 from public.companies where id = p_company) or not public.feature_on(p_company, 'compliance') then
    return 0;
  end if;
  select count(*) into v_before from public.notifications where company_id = p_company;
  perform public.compliance_generate_deadlines(p_company, v_today + 45);

  -- Active licences past their expiry date become expired.
  perform set_config('ims.status_change', 'on', true);
  update public.licences set status = 'expired'
   where company_id = p_company and status = 'active' and expires_on < v_today;
  perform set_config('ims.status_change', '', true);

  -- Licences within their reminder period, and once expired (until renewed).
  for r in select l.id, l.name, l.authority, l.expires_on, l.remind_days
             from public.licences l
            where l.company_id = p_company and l.status in ('active', 'expired') and l.expires_on is not null
              and l.expires_on <= v_today + l.remind_days loop
    v_band := case when r.expires_on < v_today then -1 when r.expires_on <= v_today + 7 then 7 else r.remind_days end;
    perform public.notify_roles(p_company, array['management']::public.app_role[], null, 'licence_expiry',
      case when v_band <= 7 then 'critical' else 'attention' end,
      case when v_band = -1 then 'Licence expired: ' else 'Licence expiring: ' end || r.name,
      coalesce(nullif(r.authority, '') || ' · ', '') || case when v_band = -1 then 'expired ' else 'expires ' end
        || to_char(r.expires_on, 'DD Mon YYYY') || ' · renew it and upload the new copy',
      '/compliance/licences/' || r.id, 'lic-' || r.id || '-' || r.expires_on || '-' || v_band);
  end loop;

  -- Recurring filings due within 7 days, today, or late (late: reminded every week).
  for r in select d.id, d.due_on, d.period_start, d.period_end, i.id as item_id, i.name, i.owner_id, i.finance_ok
             from public.compliance_deadlines d join public.compliance_items i on i.id = d.item_id
            where d.company_id = p_company and d.status = 'open' and i.status <> 'not_applicable'
              and d.due_on <= v_today + 7 loop
    if r.due_on < v_today then
      v_sev := 'critical';
      v_title := 'Filing overdue: ';
      v_key := 'cdl-' || r.id || '-late-' || ((v_today - r.due_on) / 7);
    elsif r.due_on = v_today then
      v_sev := 'critical';
      v_title := 'Filing due today: ';
      v_key := 'cdl-' || r.id || '-today';
    else
      v_sev := 'attention';
      v_title := 'Filing due: ';
      v_key := 'cdl-' || r.id || '-7';
    end if;
    v_roles := case when r.finance_ok then array['management', 'finance'] else array['management'] end::public.app_role[];
    perform public.notify_roles(p_company, v_roles, null, 'compliance_filing', v_sev, v_title || r.name,
      public.compliance_period_label(r.period_start, r.period_end) || ' · due ' || to_char(r.due_on, 'DD Mon YYYY'),
      '/compliance/calendar', v_key);
    perform public.notify(p_company, r.owner_id, 'compliance_filing', v_sev, v_title || r.name,
      public.compliance_period_label(r.period_start, r.period_end) || ' · due ' || to_char(r.due_on, 'DD Mon YYYY'),
      '/compliance/calendar', v_key);
  end loop;

  -- Checklist items with a due date within 7 days or late.
  for r in select i.id, i.name, i.due_on, i.owner_id, i.finance_ok
             from public.compliance_items i
            where i.company_id = p_company and i.status in ('not_started', 'in_progress') and i.due_on <= v_today + 7 loop
    if r.due_on < v_today then
      v_sev := 'critical';
      v_title := 'Compliance overdue: ';
      v_key := 'cit-' || r.id || '-' || r.due_on || '-late-' || ((v_today - r.due_on) / 7);
    else
      v_sev := 'attention';
      v_title := 'Compliance due: ';
      v_key := 'cit-' || r.id || '-' || r.due_on;
    end if;
    v_roles := case when r.finance_ok then array['management', 'finance'] else array['management'] end::public.app_role[];
    perform public.notify_roles(p_company, v_roles, null, 'compliance_due', v_sev, v_title || r.name,
      'Due ' || to_char(r.due_on, 'DD Mon YYYY'), '/compliance/checklist/' || r.id, v_key);
    perform public.notify(p_company, r.owner_id, 'compliance_due', v_sev, v_title || r.name,
      'Due ' || to_char(r.due_on, 'DD Mon YYYY'), '/compliance/checklist/' || r.id, v_key);
  end loop;

  select count(*) into v_after from public.notifications where company_id = p_company;
  return v_after - v_before;
end;
$$;

-- Scheduled entry point: as before (Stage 15), plus the compliance alerts of each company.
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

-- Called when someone opens the app: as Stage 7 (at most every 30 minutes), plus compliance.
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
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- 16. Triggers, row-level security and grants
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['compliance_settings', 'licences', 'compliance_items', 'compliance_deadlines', 'company_directors'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function public.touch_updated_at()', t, t);
  end loop;
  foreach t in array array['compliance_settings', 'licences', 'compliance_items', 'compliance_deadlines', 'compliance_documents',
                           'company_directors'] loop
    execute format('drop trigger if exists %I_keep on public.%I', t, t);
    execute format('create trigger %I_keep before update on public.%I for each row execute function public.keep_company()', t, t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  -- The activity log: every change (filings: only when marked, not when the calendar builds them).
  foreach t in array array['compliance_settings', 'licences', 'compliance_items', 'compliance_documents', 'company_directors'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end;
$$;
drop trigger if exists compliance_deadlines_audit on public.compliance_deadlines;
create trigger compliance_deadlines_audit after update or delete on public.compliance_deadlines
  for each row execute function public.audit_row();

-- The catalogue: read-only reference data for everyone signed in.
alter table public.compliance_catalogue enable row level security;
revoke all on public.compliance_catalogue from public, anon, authenticated;
grant select on public.compliance_catalogue to authenticated;
drop policy if exists compliance_catalogue_select on public.compliance_catalogue;
create policy compliance_catalogue_select on public.compliance_catalogue for select to authenticated using (true);

-- Settings: read by everyone except drivers; changed only through the functions.
drop policy if exists compliance_settings_select on public.compliance_settings;
create policy compliance_settings_select on public.compliance_settings for select to authenticated
  using (public.has_role(company_id, public.document_roles()));

-- Licences: everyone except drivers reads; management writes.
drop policy if exists licences_select on public.licences;
create policy licences_select on public.licences for select to authenticated
  using (public.has_role(company_id, public.document_roles()));
drop policy if exists licences_insert on public.licences;
create policy licences_insert on public.licences for insert to authenticated with check (public.is_manager(company_id));
drop policy if exists licences_update on public.licences;
create policy licences_update on public.licences for update to authenticated
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));
drop policy if exists licences_delete on public.licences;
create policy licences_delete on public.licences for delete to authenticated using (public.is_manager(company_id));
grant insert (company_id, name, authority, catalogue_code, licence_no, category, product_scope, status, applied_on, issued_on,
              expires_on, remind_days, conditions, cost, currency, notes)
  on public.licences to authenticated;
grant update (name, authority, catalogue_code, licence_no, category, product_scope, applied_on, issued_on, expires_on,
              remind_days, conditions, cost, currency, notes)
  on public.licences to authenticated;
grant delete on public.licences to authenticated;

-- Checklist: everyone except drivers reads; management (and finance for tax items) writes.
drop policy if exists compliance_items_select on public.compliance_items;
create policy compliance_items_select on public.compliance_items for select to authenticated
  using (public.has_role(company_id, public.document_roles()));
drop policy if exists compliance_items_insert on public.compliance_items;
create policy compliance_items_insert on public.compliance_items for insert to authenticated
  with check (public.compliance_can_write(company_id, finance_ok));
drop policy if exists compliance_items_update on public.compliance_items;
create policy compliance_items_update on public.compliance_items for update to authenticated
  using (public.compliance_can_write(company_id, finance_ok)) with check (public.compliance_can_write(company_id, finance_ok));
drop policy if exists compliance_items_delete on public.compliance_items;
create policy compliance_items_delete on public.compliance_items for delete to authenticated using (public.is_manager(company_id));
grant insert (company_id, name, category, authority, frequency, due_day, due_offset_months, calendar_from, due_on, owner_id,
              licence_id, notes, sort)
  on public.compliance_items to authenticated;
grant update (name, category, authority, frequency, due_day, due_offset_months, calendar_from, due_on, owner_id, licence_id,
              notes, sort)
  on public.compliance_items to authenticated;
grant delete on public.compliance_items to authenticated;

-- Filings: everyone except drivers reads; marked only through the functions.
drop policy if exists compliance_deadlines_select on public.compliance_deadlines;
create policy compliance_deadlines_select on public.compliance_deadlines for select to authenticated
  using (public.has_role(company_id, public.document_roles()));

-- Linked documents: read with the checklist; linked and unlinked by whoever may change the item or licence.
drop policy if exists compliance_documents_select on public.compliance_documents;
create policy compliance_documents_select on public.compliance_documents for select to authenticated
  using (public.has_role(company_id, public.document_roles()));
drop policy if exists compliance_documents_insert on public.compliance_documents;
create policy compliance_documents_insert on public.compliance_documents for insert to authenticated
  with check (public.compliance_can_link(company_id, item_id, licence_id));
drop policy if exists compliance_documents_delete on public.compliance_documents;
create policy compliance_documents_delete on public.compliance_documents for delete to authenticated
  using (public.compliance_can_link(company_id, item_id, licence_id));
grant insert (company_id, document_id, item_id, licence_id) on public.compliance_documents to authenticated;
grant delete on public.compliance_documents to authenticated;

-- Directors: personal details (IDs, TINs), so management and finance read; management writes.
drop policy if exists company_directors_select on public.company_directors;
create policy company_directors_select on public.company_directors for select to authenticated
  using (public.has_role(company_id, public.finance_roles()));
drop policy if exists company_directors_insert on public.company_directors;
create policy company_directors_insert on public.company_directors for insert to authenticated with check (public.is_manager(company_id));
drop policy if exists company_directors_update on public.company_directors;
create policy company_directors_update on public.company_directors for update to authenticated
  using (public.is_manager(company_id)) with check (public.is_manager(company_id));
drop policy if exists company_directors_delete on public.company_directors;
create policy company_directors_delete on public.company_directors for delete to authenticated using (public.is_manager(company_id));
grant insert (company_id, full_name, role, id_type, id_number, nationality, tin, appointed_on, resigned_on, phone, email, address,
              share_percent, shares_held, notes, sort)
  on public.company_directors to authenticated;
grant update (full_name, role, id_type, id_number, nationality, tin, appointed_on, resigned_on, phone, email, address,
              share_percent, shares_held, notes, sort)
  on public.company_directors to authenticated;
grant delete on public.company_directors to authenticated;

-- ---------------------------------------------------------------------
-- 17. Functions: who may call them
-- ---------------------------------------------------------------------
revoke execute on function
  public.compliance_can_write(uuid, boolean),
  public.prepare_compliance_record(),
  public.check_director_shares(),
  public.on_compliance_item_changed(),
  public.compliance_adopt(uuid, text[], boolean),
  public.compliance_set_status(uuid, text, text),
  public.compliance_set_licence_status(uuid, text, date),
  public.compliance_can_link(uuid, uuid, uuid),
  public.compliance_period_label(date, date),
  public.compliance_generate_deadlines(uuid, date),
  public.compliance_refresh_calendar(uuid),
  public.compliance_mark_filed(uuid, date, text, text),
  public.compliance_skip_filing(uuid, text),
  public.compliance_reopen_filing(uuid),
  public.compliance_save_settings(uuid, integer, date, text, text),
  public.compliance_set_shares_decided(uuid, boolean),
  public.compliance_summary(uuid),
  public.run_compliance_alerts(uuid),
  public.run_all_alerts(text),
  public.refresh_alerts(uuid)
from public, anon, authenticated;
grant execute on function
  public.compliance_can_write(uuid, boolean),
  public.compliance_adopt(uuid, text[], boolean),
  public.compliance_set_status(uuid, text, text),
  public.compliance_set_licence_status(uuid, text, date),
  public.compliance_can_link(uuid, uuid, uuid),
  public.compliance_period_label(date, date),
  public.compliance_refresh_calendar(uuid),
  public.compliance_mark_filed(uuid, date, text, text),
  public.compliance_skip_filing(uuid, text),
  public.compliance_reopen_filing(uuid),
  public.compliance_save_settings(uuid, integer, date, text, text),
  public.compliance_set_shares_decided(uuid, boolean),
  public.compliance_summary(uuid),
  public.refresh_alerts(uuid)
to authenticated;
-- The scheduler calls this with the public (anon) key plus the outbox secret, as before.
grant execute on function public.run_all_alerts(text) to anon, authenticated;

notify pgrst, 'reload schema';
