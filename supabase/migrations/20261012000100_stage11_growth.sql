-- =====================================================================
-- LeMoSp  ·  Stage 11: grow with your business
--
-- "Start simple, grow with your business": one platform, three operating
-- modes (Small / Medium / Enterprise). The business level only sets the
-- DEFAULT set of features; management can switch single features on or
-- off, and changing level never deletes data or the company's own choices.
--
--   features                 – platform catalogue (live and planned)
--   company_features         – a company's own on/off choices
--   recommendation_rules     – "when metric X reaches Y, suggest Z"
--   company_recommendations  – contextual suggestions for one company
--   suggestions (+comments)  – the company's internal Suggestion Box
--   platform_admins          – LeMo Tech staff (catalogue, statistics)
--
-- Safe to run more than once. Existing companies keep level 'medium' and
-- are marked as onboarded; new companies start with onboarding.
-- Platform admins are added by hand in the SQL editor:
--   insert into public.platform_admins (user_id)
--   select id from auth.users where email = '<your email>';
-- =====================================================================

-- ---------------------------------------------------------------------
-- Business level
-- ---------------------------------------------------------------------
do $$
begin
  create type public.business_level as enum ('small', 'medium', 'enterprise');
exception when duplicate_object then
  null;
end $$;
grant usage on type public.business_level to authenticated;

create or replace function public.level_rank(p_level public.business_level)
returns integer language sql immutable set search_path = ''
as $$
  select case p_level when 'small' then 1 when 'medium' then 2 when 'enterprise' then 3 end;
$$;

-- New company columns. None of them is in the column UPDATE grants, so
-- users change them only through the functions below.
alter table public.companies
  add column if not exists business_level public.business_level not null default 'medium',
  -- Added with default TRUE so every company that already exists counts
  -- as onboarded; new companies get FALSE (default changed just below).
  add column if not exists onboarding_done boolean not null default true,
  add column if not exists level_changed_at timestamptz;
alter table public.companies alter column onboarding_done set default false;

-- Onboarding answers (see "Profile" in the Stage 11 contract). Management only;
-- written only by set_business_level().
create table if not exists public.company_profiles (
  company_id  uuid primary key references public.companies (id) on delete cascade,
  profile     jsonb not null default '{}'::jsonb check (jsonb_typeof(profile) = 'object'),
  updated_at  timestamptz not null default now()
);
alter table public.company_profiles enable row level security;
drop policy if exists company_profiles_select on public.company_profiles;
create policy company_profiles_select on public.company_profiles for select to authenticated
  using (public.is_manager(company_id));
revoke all on public.company_profiles from anon, authenticated;
grant select on public.company_profiles to authenticated;

-- When each company was last checked for recommendations. Kept out of
-- companies so this housekeeping never fills the activity history.
-- Only used by functions (no policies, no grants).
create table if not exists public.company_growth_state (
  company_id  uuid primary key references public.companies (id) on delete cascade,
  checked_at  timestamptz
);
alter table public.company_growth_state enable row level security;
revoke all on public.company_growth_state from anon, authenticated;

-- Demo companies are ready to use: no onboarding questions.
create or replace function public.demo_skip_onboarding()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.is_demo then
    new.onboarding_done := true;
  end if;
  return new;
end;
$$;
drop trigger if exists companies_demo_onboarding on public.companies;
create trigger companies_demo_onboarding before insert on public.companies
  for each row execute function public.demo_skip_onboarding();

-- ---------------------------------------------------------------------
-- Platform admins (LeMo Tech staff)
-- ---------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
alter table public.platform_admins enable row level security;  -- no policies: only used by functions
revoke all on public.platform_admins from anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null
     and not public.is_anonymous_user()
     and public.session_aal() = 'aal2'   -- platform admins always sign in with two-step verification
     and exists (select 1 from public.platform_admins a where a.user_id = auth.uid());
$$;

create or replace function public.require_platform_admin()
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Only LeMo platform administrators (signed in with two-step verification) can do this.'
      using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Feature catalogue
-- ---------------------------------------------------------------------
create table if not exists public.features (
  key            text primary key check (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  name           text not null check (char_length(btrim(name)) between 2 and 120),
  description    text,
  module         text not null default 'Other',
  default_level  public.business_level not null default 'medium',
  status         text not null default 'planned' check (status in ('live', 'planned')),
  audience       text,
  benefits       text,
  tutorial       jsonb not null default '[]'::jsonb check (jsonb_typeof(tutorial) = 'array'),
  route          text check (route is null or (route ~ '^/[A-Za-z0-9/_#-]*$' and route !~ '^//')),
  sort           integer not null default 0,
  active         boolean not null default true,
  -- Core features are part of every level and can never be switched off.
  core           boolean not null default false,
  check (not core or default_level = 'small')
);

create table if not exists public.company_features (
  company_id   uuid not null references public.companies (id) on delete cascade,
  feature_key  text not null references public.features (key) on delete cascade on update cascade,
  enabled      boolean not null,
  source       text not null default 'manual' check (source in ('manual', 'admin', 'recommendation')),
  changed_by   uuid references auth.users (id) on delete set null,
  changed_at   timestamptz not null default now(),
  primary key (company_id, feature_key)
);
create index if not exists company_features_key_idx on public.company_features (feature_key);

alter table public.features         enable row level security;
alter table public.company_features enable row level security;

drop policy if exists features_select on public.features;
create policy features_select on public.features for select to authenticated using (true);
drop policy if exists features_admin_insert on public.features;
create policy features_admin_insert on public.features for insert to authenticated
  with check (public.is_platform_admin());
drop policy if exists features_admin_update on public.features;
create policy features_admin_update on public.features for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists features_admin_delete on public.features;
create policy features_admin_delete on public.features for delete to authenticated
  using (public.is_platform_admin());

drop policy if exists company_features_select on public.company_features;
create policy company_features_select on public.company_features for select to authenticated
  using (public.is_member(company_id));

revoke all on public.features, public.company_features from anon, authenticated;
grant select, insert, update, delete on public.features to authenticated;
grant select on public.company_features to authenticated;

-- Seed. Re-running refreshes the catalogue texts but keeps an admin's
-- default level, module, order and on/off switch.
insert into public.features (key, name, description, module, default_level, status, audience, benefits, tutorial, route, sort)
values
-- Small · live
('dashboard', 'Dashboard', 'Your business at a glance: sales, money owed, open requests and what needs attention today.', 'Overview', 'small', 'live',
 'Owner, managers', 'Start every day knowing what needs your attention.',
 '[{"title":"Open the app","body":"The dashboard is the first screen you see."},{"title":"Tap a tile","body":"Each number opens the list behind it."},{"title":"Act on alerts","body":"Red and orange items need action first."}]', '/', 10),
('customers', 'Customers', 'Keep every customer''s details, contacts, sites and history in one place.', 'Sales', 'small', 'live',
 'Owner, sales staff', 'Never lose a customer''s phone number, TIN or purchase history again.',
 '[{"title":"Add a customer","body":"Go to Customers and tap Add. Name is enough to start."},{"title":"Add contacts","body":"Save the buyer, finance and technical contacts."},{"title":"See history","body":"Open a customer to see requests, quotations, invoices and payments."}]', '/clients', 20),
('client_rfqs', 'Customer requests (RFQs)', 'Record every request for prices from customers and track whether it has been answered.', 'Sales', 'small', 'live',
 'Owner, sales staff', 'No customer request is forgotten or answered late.',
 '[{"title":"Record the request","body":"Tap New request and choose the customer."},{"title":"Add the items","body":"List what the customer asked for and the due date."},{"title":"Turn it into a quotation","body":"When prices are ready, create the quotation from the request."}]', '/rfqs', 30),
('quotations', 'Quotations', 'Prepare professional quotations with your logo, VAT and terms, and send them as PDF.', 'Sales', 'small', 'live',
 'Owner, sales staff', 'Quote faster and look professional to big customers.',
 '[{"title":"Create a quotation","body":"Start from a request or from scratch."},{"title":"Add items and prices","body":"The app adds VAT and totals for you."},{"title":"Send it","body":"Download or share the PDF with the customer."},{"title":"Record the answer","body":"Mark it won or lost to keep your figures right."}]', '/quotations', 40),
('invoices', 'Invoices & receipts', 'Issue numbered invoices from won orders or deliveries and print receipts for payments.', 'Finance', 'small', 'live',
 'Owner, finance staff', 'Get paid faster with clear, correct invoices.',
 '[{"title":"Create the invoice","body":"Start from a won quotation or a delivery."},{"title":"Check and issue","body":"Issuing gives the invoice its number and locks it."},{"title":"Share it","body":"Send the PDF to the customer."}]', '/invoices', 50),
('payments', 'Payments received', 'Record money received from customers against their invoices.', 'Finance', 'small', 'live',
 'Owner, finance staff', 'Always know which invoices are paid.',
 '[{"title":"Open the invoice","body":"Find the invoice the customer paid."},{"title":"Record the payment","body":"Enter the amount, date and method."},{"title":"Give a receipt","body":"Share the receipt with the customer."}]', '/payments', 60),
('receivables', 'Who owes us', 'See every unpaid invoice by customer and how late it is.', 'Finance', 'small', 'live',
 'Owner, finance staff', 'Follow up the right customers and protect your cash.',
 '[{"title":"Open Who owes us","body":"Customers are listed by amount owed."},{"title":"Check the age","body":"Late invoices are grouped by days overdue."},{"title":"Follow up","body":"Call or message the customer and record the payment when it comes."}]', '/receivables', 70),
('products', 'Products & services', 'Your list of products and services with prices, units and technical details.', 'Inventory', 'small', 'live',
 'Owner, sales and stores staff', 'Quote the right item at the right price every time.',
 '[{"title":"Add products","body":"Add items one by one or import a spreadsheet."},{"title":"Set prices","body":"Enter selling prices and, for management, costs."},{"title":"Use them everywhere","body":"Products appear in quotations, orders and invoices."}]', '/products', 80),
('inventory', 'Stock', 'See what you have in stock and record goods in and out.', 'Inventory', 'small', 'live',
 'Owner, stores staff', 'Know what you can sell today without counting shelves.',
 '[{"title":"Load opening stock","body":"Enter what you have today."},{"title":"Receive and deliver","body":"Stock goes up when goods arrive and down when you deliver."},{"title":"Check a product","body":"Open a product to see its stock and movements."}]', '/stock', 90),
('suppliers', 'Suppliers', 'Keep your suppliers'' details, products, terms and lead times.', 'Purchasing', 'small', 'live',
 'Owner, purchasing staff', 'Find the right supplier quickly when a customer asks.',
 '[{"title":"Add a supplier","body":"Go to Suppliers and tap Add."},{"title":"Record terms","body":"Save payment terms, currency and lead time."},{"title":"See history","body":"Open a supplier to see orders and bills."}]', '/suppliers', 100),
('purchases', 'Purchase orders', 'Send numbered purchase orders to suppliers and track what has arrived.', 'Purchasing', 'small', 'live',
 'Owner, purchasing staff', 'Order exactly what the customer needs and track it until it arrives.',
 '[{"title":"Create a purchase order","body":"Choose the supplier and add the items."},{"title":"Send it","body":"Share the PDF with the supplier."},{"title":"Track it","body":"Mark it confirmed and receive the goods when they arrive."}]', '/purchase-orders', 110),
('deliveries', 'Deliveries', 'Prepare delivery notes, dispatch goods and record proof of delivery.', 'Logistics', 'small', 'live',
 'Owner, stores staff, drivers', 'Prove what was delivered, when and to whom.',
 '[{"title":"Create the delivery","body":"Start from a won order and pick the items."},{"title":"Dispatch","body":"Assign a driver and vehicle."},{"title":"Confirm delivery","body":"Capture the receiver''s name and signature on the phone."}]', '/deliveries', 120),
('notifications', 'Alerts & notifications', 'Alerts for new requests, approvals, overdue invoices, low stock and more, in the app, by push and by email.', 'Overview', 'small', 'live',
 'Everyone', 'The app tells you what needs attention, so you do not have to check every list.',
 '[{"title":"Open alerts","body":"Tap the bell to see your notifications."},{"title":"Turn on phone alerts","body":"Allow notifications when the app asks."},{"title":"Choose email","body":"Switch email alerts on or off in your account."}]', '/notifications', 130),
('suggestions', 'Suggestion Box', 'Every team member can suggest improvements; management reviews, assigns and tracks them.', 'Improvement', 'small', 'live',
 'Everyone', 'Good ideas from your team are captured and acted on.',
 '[{"title":"Make a suggestion","body":"Tap New suggestion, choose a topic and describe your idea."},{"title":"Management reviews","body":"Managers approve, ask questions or assign it to someone."},{"title":"Follow progress","body":"You are notified when the status changes."}]', '/suggestions', 140),
('team', 'Team & simple roles', 'Invite your staff and give each person a role: management, sales, purchasing, stores, driver or finance.', 'Administration', 'small', 'live',
 'Owner, managers', 'Each person sees only what they need for their work.',
 '[{"title":"Invite someone","body":"Enter their email and choose a role."},{"title":"They accept","body":"They sign up with that email and join your company."},{"title":"Change roles","body":"Switch roles or deactivate people who leave."}]', '/settings/team', 150),
('activity', 'Activity history', 'A record of who changed what and when.', 'Administration', 'small', 'live',
 'Owner, managers', 'Nobody can quietly change prices or records.',
 '[{"title":"Open Activity","body":"See the latest changes first."},{"title":"Check details","body":"Each entry shows what changed from and to."}]', '/activity', 160),
-- Small · planned
('expenses', 'Expenses', 'Record day-to-day business expenses with receipts.', 'Finance', 'small', 'planned',
 'Owner, finance staff', 'Know where your money goes each month.',
 '[{"title":"Record an expense","body":"Enter the amount, category and date."},{"title":"Attach the receipt","body":"Take a photo of the receipt."}]', '/expenses', 170),
('simple_pl', 'Simple profit & loss', 'A plain monthly view of sales, costs and profit.', 'Finance', 'small', 'planned',
 'Owner', 'See whether the business made money this month.',
 '[{"title":"Open the report","body":"Choose the month."},{"title":"Read the result","body":"Sales minus costs and expenses gives your profit."}]', null, 180),
('statements', 'Customer & supplier statements', 'Statements of account showing invoices, payments and balance for a customer or supplier.', 'Finance', 'small', 'planned',
 'Owner, finance staff', 'Agree balances with customers and suppliers quickly.',
 '[{"title":"Choose the customer or supplier","body":"Open their page."},{"title":"Share the statement","body":"Download the PDF and send it."}]', null, 190),
('mobile_money', 'Mobile-money payments', 'Record and match payments made by M-Pesa, Tigo Pesa, Airtel Money and similar services.', 'Finance', 'small', 'planned',
 'Owner, finance staff', 'Mobile-money payments are matched to invoices without paperwork.',
 '[{"title":"Record the payment","body":"Choose mobile money and enter the reference."},{"title":"Match it","body":"Link it to the customer''s invoice."}]', null, 200),
-- Medium · live
('supplier_rfqs', 'Supplier quotations & comparison', 'Ask several suppliers for prices and compare their offers side by side.', 'Procurement', 'medium', 'live',
 'Owner, purchasing staff', 'Buy at the best price and lead time, with a record of why.',
 '[{"title":"Ask suppliers","body":"Create a supplier request and choose the suppliers."},{"title":"Enter their prices","body":"Record each supplier''s price, lead time and terms."},{"title":"Compare and choose","body":"The comparison shows the best offer; turn it into a purchase order."}]', '/supplier-rfqs', 210),
('goods_received', 'Goods received notes', 'Record goods arriving from suppliers against purchase orders, with batches and inspection.', 'Procurement', 'small', 'live',
 'Stores and purchasing staff', 'Stock and supplier bills stay accurate.',
 '[{"title":"Open the purchase order","body":"Choose the order the goods belong to."},{"title":"Receive the goods","body":"Enter the quantities that arrived and where they are stored."},{"title":"Check stock","body":"Stock is updated straight away."}]', '/receiving', 220),
('supplier_bills', 'Supplier bills', 'Record supplier invoices and payments made to suppliers.', 'Finance', 'medium', 'live',
 'Owner, finance staff', 'Pay suppliers on time and never twice.',
 '[{"title":"Record the bill","body":"Enter the supplier''s invoice number, amount and due date."},{"title":"Pay it","body":"Record the payment when you pay."}]', '/bills', 230),
('payables', 'What we owe suppliers', 'See unpaid supplier bills and when they are due.', 'Finance', 'medium', 'live',
 'Owner, finance staff', 'Plan payments and keep good supplier relationships.',
 '[{"title":"Open What we owe","body":"Bills are listed by supplier and due date."},{"title":"Plan payments","body":"Pay the most urgent bills first."}]', '/payables', 240),
('multi_warehouse', 'Multiple stores', 'Keep stock in several stores or sites and see exactly what is where.', 'Inventory', 'medium', 'live',
 'Owner, stores staff', 'Know which store holds the goods before you promise a delivery.',
 '[{"title":"Add a store","body":"Give it a short code and a name."},{"title":"Receive into it","body":"Choose the store when goods arrive."},{"title":"Deliver from it","body":"Choose the store when you dispatch."}]', '/warehouses', 250),
('batch_expiry', 'Batches & expiry dates', 'Track batch numbers and expiry dates for chemicals, lubricants and consumables.', 'Inventory', 'medium', 'live',
 'Stores staff, management', 'Sell old batches first and never deliver expired goods.',
 '[{"title":"Enter the batch","body":"Record batch and expiry when goods arrive."},{"title":"Get alerts","body":"The app warns you 60, 30 and 7 days before expiry."}]', null, 260),
('reorder_levels', 'Reorder levels & low-stock alerts', 'Set a minimum stock for each product and get an alert when it runs low.', 'Inventory', 'medium', 'live',
 'Stores and purchasing staff', 'Buy in time and avoid running out of fast-moving items.',
 '[{"title":"Set the reorder level","body":"Open a product and enter the minimum stock."},{"title":"Get alerts","body":"Stores and purchasing are notified when stock is low."},{"title":"Order in time","body":"Create a purchase order from the alert."}]', null, 270),
('credit_management', 'Customer credit limits & terms', 'Set a credit limit and payment terms per customer; invoices above the limit need a manager.', 'Sales', 'medium', 'live',
 'Owner, finance staff', 'Protect your cash flow from customers who pay late.',
 '[{"title":"Set the limit","body":"Open the customer and enter a credit limit."},{"title":"Issue invoices","body":"Invoices above the limit need a manager."},{"title":"Follow up","body":"Use Who owes us to chase late payers."}]', null, 280),
('approvals', 'Approval workflows', 'Quotations below your minimum margin or above a value, and large purchase orders, need a manager''s approval.', 'Administration', 'medium', 'live',
 'Owner, managers', 'Big or risky deals are always checked before they go out.',
 '[{"title":"Set the limits","body":"In company settings, enter the approval amounts and minimum margin."},{"title":"Staff submit","body":"Documents above the limits go to management."},{"title":"Approve or return","body":"Managers approve or send back with a note."}]', '/settings/company', 290),
('multi_currency', 'Multiple currencies', 'Quote, buy and invoice in USD and other currencies with a recorded exchange rate.', 'Finance', 'medium', 'live',
 'Owner, finance staff', 'Every foreign-currency document keeps the rate used, so figures add up.',
 '[{"title":"Set the rates","body":"Finance enters today''s exchange rates."},{"title":"Choose the currency","body":"Pick the currency on the quotation, order or invoice."},{"title":"See base totals","body":"Reports convert everything to TZS."}]', '/rates', 300),
('landed_cost', 'Landed cost', 'Add freight, duty, clearing and other costs to an order to see the true cost of imported goods.', 'Procurement', 'medium', 'live',
 'Owner, purchasing and finance staff', 'Price imported goods on their real cost, not just the supplier price.',
 '[{"title":"Open the order","body":"Choose the purchase or sales order."},{"title":"Add costs","body":"Enter freight, duty, clearing and transport."},{"title":"Check the margin","body":"Profit reports include these costs."}]', null, 310),
('profit_analysis', 'Profit by order, client & industry', 'See gross profit and margin per order, customer, industry and product.', 'Analytics', 'medium', 'live',
 'Owner, managers', 'Focus on the customers and products that really make money.',
 '[{"title":"Open Profit","body":"Choose the period."},{"title":"Compare","body":"Sort by customer, industry or product."}]', '/profit', 320),
('driver_app', 'Driver app & proof of delivery', 'Drivers see their deliveries on the phone and capture signature, photo and location, even offline.', 'Logistics', 'medium', 'live',
 'Drivers, stores staff', 'Proof of delivery is captured on site and invoicing can start at once.',
 '[{"title":"Invite the driver","body":"Give them the driver role."},{"title":"Dispatch","body":"Assign the delivery to the driver."},{"title":"Confirm on site","body":"The driver captures name, signature and photo."}]', '/driver', 330),
('data_export', 'Data export', 'Download your company data as spreadsheets at any time.', 'Administration', 'small', 'live',
 'Owner', 'Your data is always yours, for your accountant or for backup.',
 '[{"title":"Open Export","body":"In settings, choose Data export."},{"title":"Download","body":"Choose what to export and download the file."}]', '/settings/export', 340),
('security_policy', 'Two-step verification & sign-out policy', 'Require a code from an authenticator app for everyone and sign people out automatically after inactivity.', 'Administration', 'small', 'live',
 'Owner, managers', 'A stolen password is not enough to reach your business data.',
 '[{"title":"Turn it on for yourself","body":"Set up two-step verification in your account."},{"title":"Require it for everyone","body":"In security settings, require two-step for the team."},{"title":"Choose a sign-out time","body":"Pick how long the app stays signed in without activity."}]', '/settings/security', 350),
-- Medium · planned
('crm_pipeline', 'CRM & sales pipeline', 'Track opportunities, visits and follow-ups from first contact to order.', 'Sales', 'medium', 'planned',
 'Owner, sales staff', 'See which deals are coming and follow up at the right time.',
 '[{"title":"Add an opportunity","body":"Record the customer, value and expected date."},{"title":"Move it along","body":"Update the stage after each contact."}]', null, 360),
('tenders', 'Tenders', 'Track tenders and bids with closing dates, documents and outcome.', 'Sales', 'medium', 'planned',
 'Owner, sales staff', 'Never miss a tender closing date.',
 '[{"title":"Record the tender","body":"Enter the number, client and closing date."},{"title":"Prepare the bid","body":"Attach documents and track progress."}]', null, 370),
('contracts', 'Contracts & framework prices', 'Keep customer contracts with agreed prices and validity, with alerts before they expire.', 'Sales', 'medium', 'planned',
 'Owner, sales staff', 'Always quote the agreed contract price and renew on time.',
 '[{"title":"Add the contract","body":"Enter dates, products and agreed prices."},{"title":"Get reminders","body":"The app warns you before it expires."}]', null, 380),
('documents', 'Documents library', 'Store certificates, SDS, CoAs and company documents in one place.', 'Administration', 'medium', 'planned',
 'Everyone', 'Find any certificate or document from your phone in seconds.',
 '[{"title":"Upload a document","body":"Choose the file and what it belongs to."},{"title":"Find it later","body":"Search by product, customer or type."}]', null, 390),
('stock_transfers', 'Stock transfers', 'Move stock between stores with a transfer note.', 'Inventory', 'medium', 'planned',
 'Stores staff', 'Stock in every store stays correct when goods move.',
 '[{"title":"Create a transfer","body":"Choose the from and to stores and the items."},{"title":"Receive it","body":"The receiving store confirms what arrived."}]', null, 400),
('requisitions', 'Purchase requisitions', 'Staff request items to be bought; purchasing turns approved requests into orders.', 'Procurement', 'medium', 'planned',
 'All staff, purchasing', 'Every purchase starts from an approved need.',
 '[{"title":"Request items","body":"Describe what is needed and why."},{"title":"Approve and order","body":"Management approves and purchasing orders."}]', null, 410),
('bank_reconciliation', 'Bank & mobile-money reconciliation', 'Match bank and mobile-money statements with payments recorded in the app.', 'Finance', 'medium', 'planned',
 'Finance staff', 'Your records agree with the bank every month.',
 '[{"title":"Import the statement","body":"Upload the bank statement file."},{"title":"Match","body":"The app suggests matches with recorded payments."}]', null, 420),
('bi_insights', 'Business insights', 'Charts and trends for sales, margins, customers and suppliers.', 'Analytics', 'medium', 'planned',
 'Owner, managers', 'Spot trends early and make decisions on facts.',
 '[{"title":"Open Insights","body":"Choose a topic and period."},{"title":"Drill down","body":"Tap a chart to see the details."}]', null, 430),
-- Enterprise · planned
('branches', 'Branches & business units', 'Run several branches or business units with their own stores, teams and figures.', 'Administration', 'enterprise', 'planned',
 'Owner, head office', 'Each branch is managed on its own while head office sees everything.',
 '[{"title":"Add a branch","body":"Give it a name and assign stores and staff."},{"title":"Work per branch","body":"Documents carry the branch automatically."}]', null, 440),
('consolidated_reports', 'Head-office consolidated reports', 'Combined sales, profit, stock and money owed across all branches.', 'Analytics', 'enterprise', 'planned',
 'Owner, head office', 'One view of the whole group.',
 '[{"title":"Open the report","body":"Choose the period."},{"title":"Compare branches","body":"See each branch side by side."}]', null, 450),
('budgets', 'Budgets vs actual', 'Set monthly budgets and compare them with actual sales and costs.', 'Finance', 'enterprise', 'planned',
 'Owner, finance', 'Keep spending and targets under control.',
 '[{"title":"Enter the budget","body":"Set targets per month and category."},{"title":"Track","body":"See actual against budget every month."}]', null, 460),
('cashflow_forecast', 'Cash-flow forecasting', 'Forecast cash in and out from invoices, bills and orders.', 'Finance', 'enterprise', 'planned',
 'Owner, finance', 'See cash shortages weeks before they happen.',
 '[{"title":"Open the forecast","body":"See expected cash for the coming weeks."},{"title":"Act early","body":"Chase payments or delay purchases in time."}]', null, 470),
('demand_forecast', 'Demand & purchase planning', 'Suggest what to buy and when, based on sales history and lead times.', 'Inventory', 'enterprise', 'planned',
 'Purchasing, stores', 'Hold less stock while running out less often.',
 '[{"title":"Review suggestions","body":"The app lists items to reorder."},{"title":"Create orders","body":"Turn suggestions into purchase orders."}]', null, 480),
('advanced_approvals', 'Multi-level approvals', 'Several approval steps by amount, department or document type.', 'Administration', 'enterprise', 'planned',
 'Owner, managers', 'Large organisations keep control without slowing down.',
 '[{"title":"Design the steps","body":"Set who approves at each amount."},{"title":"Approve in order","body":"Each approver is notified in turn."}]', null, 490),
('scheduled_reports', 'Scheduled reports', 'Reports emailed automatically every day, week or month.', 'Analytics', 'enterprise', 'planned',
 'Owner, managers', 'The right figures arrive in your inbox without asking.',
 '[{"title":"Choose a report","body":"Pick the report and the people."},{"title":"Set the schedule","body":"Daily, weekly or monthly."}]', null, 500),
('fleet_tracking', 'Fleet & logistics tracking', 'Track vehicles, routes, fuel and service dates.', 'Logistics', 'enterprise', 'planned',
 'Logistics, management', 'Know where your vehicles and deliveries are.',
 '[{"title":"Add vehicles","body":"Enter each vehicle and its service dates."},{"title":"Track trips","body":"See routes and delivery times."}]', null, 510),
('integrations', 'Integrations & API', 'Connect LeMoSp with accounting software, e-invoicing, banks and customers'' systems.', 'Administration', 'enterprise', 'planned',
 'Owner, IT', 'Enter data once and share it with your other systems.',
 '[{"title":"Choose the integration","body":"Pick the system to connect."},{"title":"Connect","body":"Follow the steps to link the accounts."}]', null, 520),
('ai_assistant', 'AI business assistant', 'Ask questions about your business in plain language and get drafts of quotations and emails.', 'Analytics', 'enterprise', 'planned',
 'Owner, managers', 'Get answers in seconds instead of building reports.',
 '[{"title":"Ask a question","body":"For example: who owes us more than 20 million?"},{"title":"Use the answer","body":"Open the records behind the answer."}]', null, 530)
on conflict (key) do update
  set name = excluded.name, description = excluded.description, audience = excluded.audience,
      benefits = excluded.benefits, tutorial = excluded.tutorial, route = excluded.route, status = excluded.status;

-- Core features: always on, at every level (re-applied on every run).
update public.features
   set core = (key in ('dashboard', 'team', 'security_policy', 'data_export', 'notifications', 'activity', 'suggestions')),
       default_level = case when key in ('dashboard', 'team', 'security_policy', 'data_export', 'notifications', 'activity', 'suggestions') then 'small' else default_level end
 where core is distinct from (key in ('dashboard', 'team', 'security_policy', 'data_export', 'notifications', 'activity', 'suggestions'))
    or (key in ('dashboard', 'team', 'security_policy', 'data_export', 'notifications', 'activity', 'suggestions') and default_level <> 'small');

-- ---------------------------------------------------------------------
-- Which features a company has
-- ---------------------------------------------------------------------
-- Internal: no permission check (used by the functions below).
create or replace function public.feature_map_internal(p_company uuid)
returns table (key text, name text, description text, module text, default_level public.business_level, status text,
               audience text, benefits text, tutorial jsonb, route text, sort integer, enabled boolean, source text)
language sql stable security definer set search_path = ''
as $$
  select f.key, f.name, f.description, f.module, f.default_level, f.status, f.audience, f.benefits, f.tutorial, f.route, f.sort,
         case when f.status <> 'live' or not f.active then false
              when f.core then true
              else coalesce(cf.enabled, public.level_rank(c.business_level) >= public.level_rank(f.default_level)) end,
         coalesce(cf.source, 'level')
    from public.companies c
    cross join public.features f
    left join public.company_features cf on cf.company_id = c.id and cf.feature_key = f.key
   where c.id = p_company
   order by f.sort, f.key;
$$;

create or replace function public.feature_on(p_company uuid, p_key text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((select m.enabled from public.feature_map_internal(p_company) m where m.key = p_key), false);
$$;

create or replace function public.company_feature_map(p_company uuid)
returns table (key text, name text, description text, module text, default_level public.business_level, status text,
               audience text, benefits text, tutorial jsonb, route text, sort integer, enabled boolean, source text)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  return query select m.* from public.feature_map_internal(p_company) m;
end;
$$;

create or replace function public.feature_enabled(p_company uuid, p_key text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.is_member(p_company) and public.feature_on(p_company, p_key);
$$;

-- Internal: switch a feature for a company (p_enabled null = back to the level default).
create or replace function public.apply_company_feature(p_company uuid, p_key text, p_enabled boolean, p_source text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  f public.features;
  v_old boolean;
  v_new boolean;
begin
  select * into f from public.features where key = p_key;
  if f.key is null then
    raise exception 'Unknown feature.' using errcode = '22023';
  end if;
  if f.status <> 'live' or not f.active then
    raise exception '"%" is not available yet.', f.name using errcode = '22023';
  end if;
  if f.core and p_enabled is not null and not p_enabled then
    raise exception '"%" is part of every plan and cannot be switched off.', f.name using errcode = '22023';
  end if;
  if not exists (select 1 from public.companies where id = p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  v_old := public.feature_on(p_company, p_key);
  if p_enabled is null then
    delete from public.company_features where company_id = p_company and feature_key = p_key;
  else
    insert into public.company_features (company_id, feature_key, enabled, source, changed_by, changed_at)
    values (p_company, p_key, p_enabled, p_source, auth.uid(), now())
    on conflict (company_id, feature_key) do update
      set enabled = excluded.enabled, source = excluded.source, changed_by = excluded.changed_by, changed_at = now();
  end if;
  v_new := public.feature_on(p_company, p_key);
  if v_new then
    -- Recommendations for this feature are done.
    update public.company_recommendations
       set status = 'accepted', postponed_until = null, updated_at = now()
     where company_id = p_company and feature_key = p_key and status in ('new', 'seen', 'postponed');
  end if;
  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (p_company, auth.uid(), 'update', 'company_features', p_key,
          jsonb_build_object(f.name, jsonb_build_object('from', v_old, 'to', v_new),
                             'source', jsonb_build_object('from', null, 'to', coalesce(p_source, 'level'))));
end;
$$;

create or replace function public.set_company_feature(p_company uuid, p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_demo boolean;
begin
  select is_demo into v_demo from public.companies where id = p_company;
  if public.is_manager(p_company) then
    if public.is_anonymous_user() and not coalesce(v_demo, false) then
      raise exception 'Only management can change features.' using errcode = '42501';
    end if;
    perform public.apply_company_feature(p_company, p_key, p_enabled, 'manual');
  else
    raise exception 'Only management can change features.' using errcode = '42501';
  end if;
end;
$$;

-- Internal: change level (and onboarding answers). Never deletes data or
-- the company's own feature choices.
create or replace function public.apply_business_level(p_company uuid, p_level public.business_level, p_profile jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_old public.business_level;
begin
  if p_level is null then
    raise exception 'Choose a business level.' using errcode = '22023';
  end if;
  if p_profile is not null and jsonb_typeof(p_profile) <> 'object' then
    raise exception 'The business profile must be a set of answers.' using errcode = '22023';
  end if;
  if p_profile is not null and octet_length(p_profile::text) > 16000 then
    raise exception 'The business profile is too long.' using errcode = '22023';
  end if;
  select business_level into v_old from public.companies where id = p_company for update;
  if not found then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  -- The companies audit trigger records this change in the activity history.
  update public.companies
     set business_level   = p_level,
         level_changed_at = case when v_old is distinct from p_level then now() else level_changed_at end,
         onboarding_done  = true
   where id = p_company;
  if p_profile is not null then
    insert into public.company_profiles (company_id, profile, updated_at) values (p_company, p_profile, now())
    on conflict (company_id) do update
      set profile = public.company_profiles.profile || excluded.profile, updated_at = now();
  end if;
  -- Level suggestions that this change fulfils are done.
  update public.company_recommendations
     set status = 'accepted', postponed_until = null, updated_at = now()
   where company_id = p_company and target_level is not null
     and public.level_rank(target_level) <= public.level_rank(p_level)
     and status in ('new', 'seen', 'postponed');
end;
$$;

-- Management: the onboarding answers.
create or replace function public.company_profile(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can see the business profile.' using errcode = '42501';
  end if;
  return coalesce((select p.profile from public.company_profiles p where p.company_id = p_company), '{}'::jsonb);
end;
$$;

create or replace function public.set_business_level(p_company uuid, p_level public.business_level, p_profile jsonb default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can change the business level.' using errcode = '42501';
  end if;
  if public.is_anonymous_user() and not exists (select 1 from public.companies where id = p_company and is_demo) then
    raise exception 'Only management can change the business level.' using errcode = '42501';
  end if;
  perform public.apply_business_level(p_company, p_level, p_profile);
end;
$$;

-- ---------------------------------------------------------------------
-- Company figures used for recommendations
-- ---------------------------------------------------------------------
create or replace function public.company_metrics_raw(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  v_base text;
  v_today date := (now() at time zone 'Africa/Dar_es_Salaam')::date;
begin
  select base_currency into v_base from public.companies where id = p_company;
  if v_base is null then
    return null;
  end if;
  return jsonb_build_object(
    'members', (select count(*) from public.memberships m where m.company_id = p_company and m.active),
    'clients', (select count(*) from public.clients c where c.company_id = p_company and c.active),
    'suppliers', (select count(*) from public.suppliers s where s.company_id = p_company and s.active),
    'products', (select count(*) from public.products p where p.company_id = p_company and p.active),
    'warehouses', (select count(*) from public.warehouses w where w.company_id = p_company and w.active),
    'invoices_30d', (select count(*) from public.invoices i
                      where i.company_id = p_company and i.status in ('issued', 'partly_paid', 'paid')
                        and i.issue_date > v_today - 30),
    'quotations_30d', (select count(*) from public.quotations q
                        where q.company_id = p_company and q.revision = 0 and q.status <> 'cancelled'
                          and q.issue_date > v_today - 30),
    'purchase_orders_30d', (select count(*) from public.purchase_orders o
                             where o.company_id = p_company and o.status <> 'cancelled' and o.order_date > v_today - 30),
    'deliveries_30d', (select count(*) from public.deliveries d
                        where d.company_id = p_company and d.status <> 'cancelled' and d.created_at > now() - interval '30 days'),
    'revenue_30d', (select coalesce(round(sum(i.total * i.exchange_rate), 2), 0) from public.invoices i
                     where i.company_id = p_company and i.status in ('issued', 'partly_paid', 'paid')
                       and i.issue_date > v_today - 30),
    'receivables_open', (select coalesce(round(sum((i.total - i.amount_paid) * i.exchange_rate), 2), 0) from public.invoices i
                          where i.company_id = p_company and i.status in ('issued', 'partly_paid')),
    'credit_clients', (select count(*) from public.clients c where c.company_id = p_company and c.active and c.credit_limit > 0),
    'foreign_docs_90d',
      (select count(*) from public.quotations q
        where q.company_id = p_company and q.currency <> v_base and q.status <> 'cancelled' and q.issue_date > v_today - 90)
      + (select count(*) from public.purchase_orders o
          where o.company_id = p_company and o.currency <> v_base and o.status <> 'cancelled' and o.order_date > v_today - 90)
      + (select count(*) from public.invoices i
          where i.company_id = p_company and i.currency <> v_base and i.status <> 'cancelled'
            and coalesce(i.issue_date, i.created_at::date) > v_today - 90),
    'suggestions_30d', (select count(*) from public.suggestions s
                         where s.company_id = p_company and s.created_at > now() - interval '30 days')
  );
end;
$$;

create or replace function public.company_metrics(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can see these figures.' using errcode = '42501';
  end if;
  return public.company_metrics_raw(p_company);
end;
$$;

-- ---------------------------------------------------------------------
-- Recommendation rules and a company's recommendations
-- ---------------------------------------------------------------------
create table if not exists public.recommendation_rules (
  key           text primary key check (key ~ '^[a-z][a-z0-9_]{1,59}$'),
  title         text not null check (char_length(btrim(title)) between 2 and 140),
  metric        text not null check (metric in ('members', 'clients', 'suppliers', 'products', 'warehouses', 'invoices_30d',
                                                'quotations_30d', 'purchase_orders_30d', 'deliveries_30d', 'revenue_30d',
                                                'receivables_open', 'credit_clients', 'foreign_docs_90d', 'suggestions_30d')),
  op            text not null default '>=' check (op in ('>=', '>', '<=', '<')),
  threshold     numeric not null,
  feature_key   text references public.features (key) on delete cascade on update cascade,
  target_level  public.business_level,
  applies_to    public.business_level[] not null,
  message       text,
  active        boolean not null default true,
  sort          integer not null default 0,
  check (num_nonnulls(feature_key, target_level) = 1)
);

create table if not exists public.company_recommendations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  rule_key         text not null references public.recommendation_rules (key) on delete cascade on update cascade,
  feature_key      text,
  target_level     public.business_level,
  title            text not null,
  reason           text,
  metric_value     numeric,
  threshold        numeric,
  status           text not null default 'new' check (status in ('new', 'seen', 'postponed', 'dismissed', 'accepted')),
  postponed_until  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (company_id, rule_key)
);
create index if not exists company_recommendations_open_idx on public.company_recommendations (company_id, status);

alter table public.recommendation_rules    enable row level security;
alter table public.company_recommendations enable row level security;

drop policy if exists recommendation_rules_select on public.recommendation_rules;
create policy recommendation_rules_select on public.recommendation_rules for select to authenticated using (true);
drop policy if exists recommendation_rules_admin_insert on public.recommendation_rules;
create policy recommendation_rules_admin_insert on public.recommendation_rules for insert to authenticated
  with check (public.is_platform_admin());
drop policy if exists recommendation_rules_admin_update on public.recommendation_rules;
create policy recommendation_rules_admin_update on public.recommendation_rules for update to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());
drop policy if exists recommendation_rules_admin_delete on public.recommendation_rules;
create policy recommendation_rules_admin_delete on public.recommendation_rules for delete to authenticated
  using (public.is_platform_admin());

drop policy if exists company_recommendations_select on public.company_recommendations;
create policy company_recommendations_select on public.company_recommendations for select to authenticated
  using (public.is_manager(company_id));

revoke all on public.recommendation_rules, public.company_recommendations from anon, authenticated;
grant select, insert, update, delete on public.recommendation_rules to authenticated;
grant select on public.company_recommendations to authenticated;

-- Seed (admin-owned afterwards: re-running never overwrites thresholds).
insert into public.recommendation_rules (key, title, metric, op, threshold, feature_key, target_level, applies_to, message, sort)
values
('products_inventory', 'Switch on reorder levels', 'products', '>=', 150, 'reorder_levels', null, '{small}',
 'Your catalogue has grown to {value} products. Reorder levels and low-stock alerts help you buy in time and avoid running out.', 10),
('credit_customers', 'Manage customer credit', 'credit_clients', '>=', 3, 'credit_management', null, '{small}',
 '{value} customers now buy on credit. Credit limits and payment terms protect your cash flow.', 20),
('stores', 'Manage several stores', 'warehouses', '>=', 2, 'multi_warehouse', null, '{small}',
 'You now keep stock in {value} places. Multiple stores shows exactly what is where.', 30),
('team_approvals', 'Use approval workflows', 'members', '>=', 5, 'approvals', null, '{small,medium}',
 'Your team has {value} people. Approval workflows make sure big quotations and purchases are checked.', 40),
('foreign_currency', 'Work in several currencies', 'foreign_docs_90d', '>=', 1, 'multi_currency', null, '{small}',
 'You recently used another currency. Multi-currency records the exchange rate on every document.', 50),
('supplier_compare', 'Compare supplier quotations', 'purchase_orders_30d', '>=', 10, 'supplier_rfqs', null, '{small}',
 'You raised {value} purchase orders this month. Comparing supplier quotations helps you buy at the best price.', 60),
('goods_in', 'Record goods received', 'purchase_orders_30d', '>=', 5, 'goods_received', null, '{small}',
 'Recording goods received against purchase orders keeps stock and supplier bills accurate.', 70),
('small_to_medium_team', 'Consider the Medium mode', 'members', '>=', 6, null, 'medium', '{small}',
 'Your team has grown to {value} people.', 110),
('small_to_medium_products', 'Consider the Medium mode', 'products', '>=', 300, null, 'medium', '{small}',
 'You now manage {value} products.', 120),
('small_to_medium_sales', 'Consider the Medium mode', 'revenue_30d', '>=', 30000000, null, 'medium', '{small}',
 'Sales in the last 30 days reached TZS {value}.', 130),
('small_to_medium_invoices', 'Consider the Medium mode', 'invoices_30d', '>=', 60, null, 'medium', '{small}',
 'You issued {value} invoices in the last 30 days.', 140),
('medium_to_enterprise_stores', 'Consider the Enterprise mode', 'warehouses', '>=', 4, null, 'enterprise', '{medium}',
 'You operate {value} stores.', 210),
('medium_to_enterprise_team', 'Consider the Enterprise mode', 'members', '>=', 40, null, 'enterprise', '{medium}',
 'Your team has {value} people.', 220),
('medium_to_enterprise_products', 'Consider the Enterprise mode', 'products', '>=', 3000, null, 'enterprise', '{medium}',
 'You now manage {value} products.', 230),
('medium_to_enterprise_sales', 'Consider the Enterprise mode', 'revenue_30d', '>=', 500000000, null, 'enterprise', '{medium}',
 'Sales in the last 30 days reached TZS {value}.', 240)
on conflict (key) do nothing;

-- Numbers in messages: 1,234,567 (decimals only when there are any).
create or replace function public.fmt_count(p_value numeric)
returns text language sql immutable set search_path = ''
as $$
  select case when p_value is null then ''
              when p_value = trunc(p_value) then to_char(p_value, 'FM999,999,999,999,990')
              else to_char(round(p_value, 2), 'FM999,999,999,999,990.00') end;
$$;

-- Internal: evaluate the rules for one company. Returns how many new
-- recommendations were created. Demo companies are never checked.
create or replace function public.growth_check(p_company uuid)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  co public.companies;
  v_metrics jsonb;
  r public.recommendation_rules;
  rec public.company_recommendations;
  v numeric;
  v_hit boolean;
  v_reason text;
  v_id uuid;
  v_created integer := 0;
begin
  select * into co from public.companies where id = p_company;
  if co.id is null or co.is_demo then
    return 0;
  end if;
  -- One check per company at a time, without locking the company row.
  perform pg_advisory_xact_lock(hashtext('ims.growth_check'), hashtext(p_company::text));
  v_metrics := public.company_metrics_raw(p_company);

  for r in select * from public.recommendation_rules rr
            where rr.active and co.business_level = any (rr.applies_to)
            order by rr.sort, rr.key loop
    v := (v_metrics ->> r.metric)::numeric;
    if v is null then continue; end if;
    v_hit := case r.op when '>=' then v >= r.threshold when '>' then v > r.threshold
                       when '<=' then v <= r.threshold when '<' then v < r.threshold end;
    if not coalesce(v_hit, false) then continue; end if;

    if r.feature_key is not null then
      -- Only live features that the company does not have yet.
      if not exists (select 1 from public.features f where f.key = r.feature_key and f.status = 'live' and f.active) then
        continue;
      end if;
      if public.feature_on(p_company, r.feature_key) then continue; end if;
    elsif public.level_rank(r.target_level) <= public.level_rank(co.business_level) then
      continue;
    end if;

    v_reason := replace(replace(coalesce(r.message, ''), '{value}', public.fmt_count(v)),
                        '{threshold}', public.fmt_count(r.threshold));

    select * into rec from public.company_recommendations
     where company_id = p_company and rule_key = r.key for update;
    if rec.id is null then
      insert into public.company_recommendations (company_id, rule_key, feature_key, target_level, title, reason,
                                                  metric_value, threshold)
      values (p_company, r.key, r.feature_key, r.target_level, r.title, v_reason, v, r.threshold)
      returning id into v_id;
      v_created := v_created + 1;
      perform public.notify_roles(p_company, array['management']::public.app_role[], null, 'growth', 'info',
        'Suggestion for your business: ' || r.title, v_reason, '/growth', 'growth-' || v_id);
    elsif rec.status in ('new', 'seen') then
      update public.company_recommendations
         set title = r.title, reason = v_reason, metric_value = v, threshold = r.threshold,
             feature_key = r.feature_key, target_level = r.target_level, updated_at = now()
       where id = rec.id;
    elsif rec.status = 'postponed' and coalesce(rec.postponed_until, now()) <= now() then
      update public.company_recommendations
         set status = 'new', postponed_until = null, title = r.title, reason = v_reason, metric_value = v,
             threshold = r.threshold, feature_key = r.feature_key, target_level = r.target_level, updated_at = now()
       where id = rec.id;
      perform public.notify_roles(p_company, array['management']::public.app_role[], null, 'growth', 'info',
        'Suggestion for your business: ' || r.title, v_reason, '/growth',
        'growth-' || rec.id || '-' || to_char(now(), 'YYYYMMDD'));
    end if;
    -- dismissed / accepted (and still postponed) recommendations stay as they are.
  end loop;

  insert into public.company_growth_state (company_id, checked_at) values (p_company, now())
  on conflict (company_id) do update set checked_at = excluded.checked_at;
  return v_created;
end;
$$;

-- Management: check now (at most every 10 minutes unless forced).
create or replace function public.run_growth_check(p_company uuid, p_force boolean default false)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  v_last timestamptz;
  v_demo boolean;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can check for recommendations.' using errcode = '42501';
  end if;
  -- Rate limit first, before any lock is taken.
  select c.is_demo, g.checked_at into v_demo, v_last
    from public.companies c left join public.company_growth_state g on g.company_id = c.id
   where c.id = p_company;
  if v_demo then
    return 0;
  end if;
  if not coalesce(p_force, false) and v_last is not null and v_last > now() - interval '10 minutes' then
    return 0;
  end if;
  return public.growth_check(p_company);
end;
$$;

-- Scheduled (internal): every real company at most once a day. One failing
-- company never stops the others.
create or replace function public.run_all_growth_checks()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  c record;
  v_total integer := 0;
begin
  for c in select co.id from public.companies co
             left join public.company_growth_state g on g.company_id = co.id
            where not co.is_demo and (g.checked_at is null or g.checked_at < now() - interval '24 hours') loop
    begin
      v_total := v_total + public.growth_check(c.id);
    exception when others then
      raise warning 'Growth check for % failed: %', c.id, sqlerrm;
    end;
  end loop;
  return v_total;
end;
$$;

-- Management answers a recommendation.
create or replace function public.respond_recommendation(p_id uuid, p_action text, p_days integer default 14)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  rec public.company_recommendations;
  v_status text;
begin
  select * into rec from public.company_recommendations where id = p_id for update;
  if rec.id is null or not public.is_manager(rec.company_id) then
    raise exception 'Recommendation not found.' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('seen', 'postpone', 'dismiss', 'accept') then
    raise exception 'Unknown action.' using errcode = '22023';
  end if;
  if rec.status = 'accepted' then
    if p_action = 'accept' then return; end if;
    raise exception 'This recommendation has already been accepted.' using errcode = '22023';
  end if;

  if p_action = 'seen' then
    if rec.status <> 'new' then return; end if;
    v_status := 'seen';
    update public.company_recommendations set status = 'seen', updated_at = now() where id = p_id;
  elsif p_action = 'postpone' then
    if p_days is null or p_days < 1 or p_days > 365 then
      raise exception 'Postpone for 1 to 365 days.' using errcode = '22023';
    end if;
    v_status := 'postponed';
    update public.company_recommendations
       set status = 'postponed', postponed_until = now() + make_interval(days => p_days), updated_at = now()
     where id = p_id;
  elsif p_action = 'dismiss' then
    v_status := 'dismissed';
    update public.company_recommendations set status = 'dismissed', postponed_until = null, updated_at = now() where id = p_id;
  else
    v_status := 'accepted';
    if rec.feature_key is not null then
      perform public.apply_company_feature(rec.company_id, rec.feature_key, true, 'recommendation');
    elsif rec.target_level is not null then
      if public.is_anonymous_user() and not exists (select 1 from public.companies where id = rec.company_id and is_demo) then
        raise exception 'Recommendation not found.' using errcode = '42501';
      end if;
      perform public.apply_business_level(rec.company_id, rec.target_level, null);
    end if;
    update public.company_recommendations set status = 'accepted', postponed_until = null, updated_at = now() where id = p_id;
  end if;

  insert into public.audit_log (company_id, actor_id, action, entity, entity_id, details)
  values (rec.company_id, auth.uid(), 'update', 'company_recommendations', p_id::text,
          jsonb_build_object('status', jsonb_build_object('from', rec.status, 'to', v_status),
                             'title', jsonb_build_object('from', null, 'to', rec.title)));
end;
$$;

-- ---------------------------------------------------------------------
-- Suggestion Box
-- ---------------------------------------------------------------------
create table if not exists public.suggestions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  number        text not null default '',
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  category      text not null check (category in ('sales', 'customers', 'procurement', 'suppliers', 'inventory', 'warehouse',
                                                  'finance', 'accounting', 'logistics', 'employees', 'technology', 'reporting',
                                                  'security', 'hse', 'business_growth', 'other')),
  title         text not null check (char_length(btrim(title)) between 3 and 140),
  body          text not null default '' check (char_length(body) <= 4000),
  status        text not null default 'submitted'
                check (status in ('submitted', 'under_review', 'needs_clarification', 'approved', 'rejected', 'assigned',
                                  'implemented', 'archived')),
  assigned_to   uuid references auth.users (id) on delete set null,
  department    text check (department is null or char_length(department) <= 80),
  is_internal   boolean not null default false,
  about_app     boolean not null default false,
  manager_note  text check (manager_note is null or char_length(manager_note) <= 2000),
  decided_by    uuid references auth.users (id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists suggestions_number_key on public.suggestions (company_id, number) where number <> '';
create index if not exists suggestions_company_idx on public.suggestions (company_id, status, created_at desc);
create index if not exists suggestions_about_app_idx on public.suggestions (created_at desc) where about_app;

create table if not exists public.suggestion_comments (
  id             uuid primary key default gen_random_uuid(),
  suggestion_id  uuid not null references public.suggestions (id) on delete cascade,
  company_id     uuid not null references public.companies (id) on delete cascade,
  author_id      uuid default auth.uid() references auth.users (id) on delete set null,
  body           text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at     timestamptz not null default now()
);
create index if not exists suggestion_comments_idx on public.suggestion_comments (suggestion_id, created_at);

drop trigger if exists suggestions_touch on public.suggestions;
create trigger suggestions_touch before update on public.suggestions for each row execute function public.touch_updated_at();
drop trigger if exists suggestions_keep on public.suggestions;
create trigger suggestions_keep before update on public.suggestions for each row execute function public.keep_company();
drop trigger if exists suggestions_audit on public.suggestions;
create trigger suggestions_audit after insert or update on public.suggestions for each row execute function public.audit_row();
drop trigger if exists company_recommendations_touch on public.company_recommendations;
create trigger company_recommendations_touch before update on public.company_recommendations
  for each row execute function public.touch_updated_at();

-- Who may see a suggestion: its author, the person it is assigned to, and management.
create or replace function public.suggestion_visible(p_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.suggestions s
     where s.id = p_id and public.is_member(s.company_id)
       and (s.created_by = auth.uid() or s.assigned_to = auth.uid() or public.is_manager(s.company_id)));
$$;

alter table public.suggestions         enable row level security;
alter table public.suggestion_comments enable row level security;

drop policy if exists suggestions_select on public.suggestions;
create policy suggestions_select on public.suggestions for select to authenticated
  using (public.is_member(company_id)
         and (created_by = auth.uid() or assigned_to = auth.uid() or public.is_manager(company_id)));
drop policy if exists suggestion_comments_select on public.suggestion_comments;
create policy suggestion_comments_select on public.suggestion_comments for select to authenticated
  using (public.suggestion_visible(suggestion_id));

revoke all on public.suggestions, public.suggestion_comments from anon, authenticated;
grant select on public.suggestions, public.suggestion_comments to authenticated;

create or replace function public.suggestion_check_input(p_category text, p_title text, p_body text)
returns void language plpgsql immutable set search_path = ''
as $$
begin
  if p_category is null or p_category not in ('sales', 'customers', 'procurement', 'suppliers', 'inventory', 'warehouse',
                                              'finance', 'accounting', 'logistics', 'employees', 'technology', 'reporting',
                                              'security', 'hse', 'business_growth', 'other') then
    raise exception 'Choose a topic from the list.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 140 then
    raise exception 'The title must be 3 to 140 characters.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_body, '')) > 4000 then
    raise exception 'Please keep the description under 4,000 characters.' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.suggestion_status_label(p_status text)
returns text language sql immutable set search_path = ''
as $$
  select case p_status
    when 'submitted' then 'submitted' when 'under_review' then 'under review'
    when 'needs_clarification' then 'needs more information' when 'approved' then 'approved'
    when 'rejected' then 'not taken forward' when 'assigned' then 'assigned' when 'implemented' then 'implemented'
    when 'archived' then 'archived' else p_status end;
$$;

-- De-duplication key for suggestion notifications: one per suggestion, event
-- and hour (notify() makes it unique per recipient).
create or replace function public.suggestion_key(p_id uuid, p_event text)
returns text language sql stable set search_path = ''
as $$
  select 'sug-' || p_id || '-' || p_event || '-' || to_char(now() at time zone 'UTC', 'YYYYMMDDHH24');
$$;

-- Any team member: put a suggestion in the box.
create or replace function public.submit_suggestion(p_company uuid, p_category text, p_title text, p_body text,
                                                    p_about_app boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_no text;
begin
  if not public.is_member(p_company) then
    raise exception 'Company not found.' using errcode = '42501';
  end if;
  perform public.suggestion_check_input(p_category, p_title, p_body);
  if (select count(*) from public.suggestions
       where created_by = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'You have sent many suggestions in the last hour. Please try again later.' using errcode = '54000';
  end if;
  v_no := public.next_code(p_company, 'suggestions', 'SUG-', 4);
  insert into public.suggestions (company_id, number, created_by, category, title, body, about_app)
  values (p_company, v_no, auth.uid(), p_category, btrim(p_title), coalesce(btrim(p_body), ''), coalesce(p_about_app, false))
  returning id into v_id;
  perform public.notify_roles(p_company, array['management']::public.app_role[], auth.uid(), 'suggestion', 'info',
    'New suggestion: ' || btrim(p_title), v_no || ' · ' || replace(p_category, '_', ' '), '/suggestions/' || v_id,
    public.suggestion_key(v_id, 'new'));
  return v_id;
end;
$$;

-- Management: record an improvement directly (optionally assigned to someone).
create or replace function public.create_improvement(p_company uuid, p_category text, p_title text, p_body text,
                                                     p_assign_to uuid default null, p_department text default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_no text;
begin
  if not public.is_manager(p_company) then
    raise exception 'Only management can create improvements.' using errcode = '42501';
  end if;
  perform public.suggestion_check_input(p_category, p_title, p_body);
  if p_assign_to is not null and not public.is_active_member(p_company, p_assign_to) then
    raise exception 'The person must be an active member of the team.' using errcode = '22023';
  end if;
  v_no := public.next_code(p_company, 'suggestions', 'SUG-', 4);
  insert into public.suggestions (company_id, number, created_by, category, title, body, status, assigned_to, department,
                                  is_internal, decided_by, decided_at)
  values (p_company, v_no, auth.uid(), p_category, btrim(p_title), coalesce(btrim(p_body), ''),
          case when p_assign_to is null then 'approved' else 'assigned' end, p_assign_to,
          nullif(btrim(p_department), ''), true, auth.uid(), now())
  returning id into v_id;
  if p_assign_to is not null and p_assign_to is distinct from auth.uid() then
    perform public.notify(p_company, p_assign_to, 'suggestion', 'attention', 'Improvement assigned to you: ' || btrim(p_title),
      v_no || coalesce(' · ' || nullif(btrim(p_department), ''), ''), '/suggestions/' || v_id,
      public.suggestion_key(v_id, 'assigned'));
  end if;
  return v_id;
end;
$$;

-- Management: decide on a suggestion.
create or replace function public.review_suggestion(p_id uuid, p_status text, p_note text default null,
                                                    p_assign_to uuid default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  s public.suggestions;
  v_assignee uuid;
begin
  select * into s from public.suggestions where id = p_id for update;
  if s.id is null or not public.is_manager(s.company_id) then
    raise exception 'Suggestion not found.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('under_review', 'needs_clarification', 'approved', 'rejected', 'assigned',
                                          'implemented', 'archived') then
    raise exception 'Choose a valid status.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 2000 then
    raise exception 'Please keep the note under 2,000 characters.' using errcode = '22023';
  end if;
  v_assignee := coalesce(p_assign_to, s.assigned_to);
  if p_assign_to is not null and not public.is_active_member(s.company_id, p_assign_to) then
    raise exception 'The person must be an active member of the team.' using errcode = '22023';
  end if;
  if p_status = 'assigned' and (v_assignee is null or not public.is_active_member(s.company_id, v_assignee)) then
    raise exception 'Choose an active team member to assign it to.' using errcode = '22023';
  end if;

  update public.suggestions
     set status = p_status,
         assigned_to = v_assignee,
         manager_note = coalesce(nullif(btrim(p_note), ''), manager_note),
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;

  if s.created_by is distinct from auth.uid() then
    perform public.notify(s.company_id, s.created_by, 'suggestion',
      case when p_status = 'needs_clarification' then 'attention' else 'info' end,
      case when p_status = 'needs_clarification' then 'More information needed: ' || s.title
           else 'Your suggestion is ' || public.suggestion_status_label(p_status) || ': ' || s.title end,
      s.number || coalesce(' · ' || nullif(btrim(p_note), ''), ''), '/suggestions/' || p_id,
      public.suggestion_key(p_id, 'review-' || p_status));
  end if;
  if p_status = 'assigned' and v_assignee is distinct from auth.uid()
     and (v_assignee is distinct from s.assigned_to or s.status <> 'assigned') then
    perform public.notify(s.company_id, v_assignee, 'suggestion', 'attention', 'Improvement assigned to you: ' || s.title,
      s.number || coalesce(' · ' || nullif(btrim(p_note), ''), ''), '/suggestions/' || p_id,
      public.suggestion_key(p_id, 'assigned'));
  end if;
end;
$$;

-- The person it is assigned to: report progress.
create or replace function public.update_my_assignment(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  s public.suggestions;
begin
  select * into s from public.suggestions where id = p_id for update;
  if s.id is null or s.assigned_to is distinct from auth.uid() or not public.is_member(s.company_id) then
    raise exception 'Suggestion not found.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('under_review', 'implemented') then
    raise exception 'You can mark it as in progress or implemented.' using errcode = '22023';
  end if;
  if s.status not in ('assigned', 'under_review', 'approved') then
    raise exception 'This suggestion is no longer open.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > 2000 then
    raise exception 'Please keep the note under 2,000 characters.' using errcode = '22023';
  end if;
  if (select count(*) from public.audit_log a
       where a.actor_id = auth.uid() and a.entity = 'suggestions' and a.action = 'update'
         and a.created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'You have updated many suggestions in the last few minutes. Please wait a little and try again.'
      using errcode = '54000';
  end if;
  update public.suggestions set status = p_status where id = p_id;
  if nullif(btrim(p_note), '') is not null then
    insert into public.suggestion_comments (suggestion_id, company_id, author_id, body)
    values (p_id, s.company_id, auth.uid(), btrim(p_note));
  end if;
  perform public.notify_roles(s.company_id, array['management']::public.app_role[], auth.uid(), 'suggestion', 'info',
    'Improvement ' || public.suggestion_status_label(p_status) || ': ' || s.title,
    s.number || coalesce(' · ' || nullif(btrim(p_note), ''), ''), '/suggestions/' || p_id,
    public.suggestion_key(p_id, 'progress-' || p_status));
  -- The author too (managers were already told above).
  if s.created_by is distinct from auth.uid()
     and not exists (select 1 from public.memberships m where m.company_id = s.company_id and m.user_id = s.created_by
                       and m.active and m.role = 'management') then
    perform public.notify(s.company_id, s.created_by, 'suggestion', 'info',
      'Your suggestion is ' || public.suggestion_status_label(p_status) || ': ' || s.title,
      s.number, '/suggestions/' || p_id, public.suggestion_key(p_id, 'progress-' || p_status));
  end if;
end;
$$;

-- The author: answer a request for more information.
create or replace function public.resubmit_suggestion(p_id uuid, p_body text)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  s public.suggestions;
begin
  select * into s from public.suggestions where id = p_id for update;
  if s.id is null or s.created_by is distinct from auth.uid() or not public.is_member(s.company_id) then
    raise exception 'Suggestion not found.' using errcode = '42501';
  end if;
  if s.status <> 'needs_clarification' then
    raise exception 'Only a suggestion that needs more information can be sent again.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) = 0 then
    raise exception 'Add the extra information.' using errcode = '22023';
  end if;
  if char_length(p_body) > 4000 then
    raise exception 'Please keep the description under 4,000 characters.' using errcode = '22023';
  end if;
  update public.suggestions set status = 'submitted', body = btrim(p_body) where id = p_id;
  perform public.notify_roles(s.company_id, array['management']::public.app_role[], auth.uid(), 'suggestion', 'info',
    'Suggestion updated: ' || s.title, s.number || ' · more information added', '/suggestions/' || p_id,
    public.suggestion_key(p_id, 'resubmit'));
end;
$$;

-- Author, assignee or management: add a comment.
create or replace function public.comment_suggestion(p_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  s public.suggestions;
  v_id uuid;
  v_title text;
begin
  select * into s from public.suggestions where id = p_id;
  if s.id is null or not public.suggestion_visible(p_id) then
    raise exception 'Suggestion not found.' using errcode = '42501';
  end if;
  if s.status in ('archived', 'rejected', 'implemented') then
    raise exception 'This suggestion is closed, so it cannot get new comments.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_body, ''))) not between 1 and 2000 then
    raise exception 'Write a comment of up to 2,000 characters.' using errcode = '22023';
  end if;
  if (select count(*) from public.suggestion_comments c
       where c.author_id = auth.uid() and c.created_at > now() - interval '10 minutes') >= 20 then
    raise exception 'You have added many comments in the last few minutes. Please wait a little and try again.'
      using errcode = '54000';
  end if;
  insert into public.suggestion_comments (suggestion_id, company_id, author_id, body)
  values (p_id, s.company_id, auth.uid(), btrim(p_body))
  returning id into v_id;

  v_title := 'New comment on ' || s.number || ': ' || s.title;
  if s.created_by is distinct from auth.uid() then
    perform public.notify(s.company_id, s.created_by, 'suggestion', 'info', v_title, left(btrim(p_body), 200),
      '/suggestions/' || p_id, public.suggestion_key(p_id, 'comment'));
  end if;
  if s.assigned_to is distinct from auth.uid() and s.assigned_to is distinct from s.created_by then
    perform public.notify(s.company_id, s.assigned_to, 'suggestion', 'info', v_title, left(btrim(p_body), 200),
      '/suggestions/' || p_id, public.suggestion_key(p_id, 'comment'));
  end if;
  if not public.is_manager(s.company_id) then
    -- Managers other than the author/assignee (already notified above).
    perform public.notify(s.company_id, m.user_id, 'suggestion', 'info', v_title, left(btrim(p_body), 200),
      '/suggestions/' || p_id, public.suggestion_key(p_id, 'comment'))
      from public.memberships m
     where m.company_id = s.company_id and m.active and m.role = 'management'
       and m.user_id is distinct from auth.uid()
       and m.user_id is distinct from s.created_by and m.user_id is distinct from s.assigned_to;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Platform administration (LeMo Tech). Demo companies are left out of
-- every statistic.
-- ---------------------------------------------------------------------
create or replace function public.platform_overview()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  return jsonb_build_object(
    'companies_total', (select count(*) from public.companies where not is_demo),
    'by_level', jsonb_build_object(
      'small', (select count(*) from public.companies where not is_demo and business_level = 'small'),
      'medium', (select count(*) from public.companies where not is_demo and business_level = 'medium'),
      'enterprise', (select count(*) from public.companies where not is_demo and business_level = 'enterprise')),
    'demo_companies', (select count(*) from public.companies where is_demo),
    'users_total', (select count(*) from auth.users u where not coalesce(u.is_anonymous, false)),
    'active_companies_30d', (select count(distinct a.company_id) from public.audit_log a
                               join public.companies c on c.id = a.company_id and not c.is_demo
                              where a.actor_id is not null and a.created_at > now() - interval '30 days'),
    'suggestions_30d', (select count(*) from public.suggestions s join public.companies c on c.id = s.company_id and not c.is_demo
                         where s.created_at > now() - interval '30 days'),
    'open_recommendations', (select count(*) from public.company_recommendations r
                               join public.companies c on c.id = r.company_id and not c.is_demo
                              where r.status in ('new', 'seen'))
  );
end;
$$;

create or replace function public.platform_companies(p_include_demo boolean default false)
returns table (id uuid, name text, business_level public.business_level, is_demo boolean, created_at timestamptz,
               members integer, last_activity timestamptz, features_on integer, open_recommendations integer,
               onboarding_done boolean)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_platform_admin();
  return query
    select c.id, c.name, c.business_level, c.is_demo, c.created_at,
           (select count(*)::integer from public.memberships m where m.company_id = c.id and m.active),
           (select max(a.created_at) from public.audit_log a where a.company_id = c.id and a.actor_id is not null),
           (select count(*)::integer from public.feature_map_internal(c.id) fm where fm.enabled),
           (select count(*)::integer from public.company_recommendations r where r.company_id = c.id and r.status in ('new', 'seen')),
           c.onboarding_done
      from public.companies c
     where coalesce(p_include_demo, false) or not c.is_demo
     order by c.created_at desc;
end;
$$;

create or replace function public.platform_feedback_stats()
returns table (category text, business_level public.business_level, status text, n bigint)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_platform_admin();
  return query
    select s.category, c.business_level, s.status, count(*)
      from public.suggestions s join public.companies c on c.id = s.company_id
     where not c.is_demo
     group by s.category, c.business_level, s.status
     order by s.category, c.business_level, s.status;
end;
$$;

-- Feedback about the app itself: no company name and no author.
create or replace function public.platform_app_feedback(p_limit integer default 100)
returns table (id uuid, category text, business_level public.business_level, title text, body text, status text,
               created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_platform_admin();
  return query
    select s.id, s.category, c.business_level, s.title, s.body, s.status, s.created_at
      from public.suggestions s join public.companies c on c.id = s.company_id
     where s.about_app and not c.is_demo
     order by s.created_at desc
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

create or replace function public.platform_feature_adoption()
returns table (key text, name text, default_level public.business_level, status text, enabled_companies integer,
               total_companies integer)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
begin
  perform public.require_platform_admin();
  return query
    with real_co as (select c.id from public.companies c where not c.is_demo),
         states as (select fm.key, fm.enabled from real_co r cross join lateral public.feature_map_internal(r.id) fm)
    select f.key, f.name, f.default_level, f.status,
           (select count(*)::integer from states st where st.key = f.key and st.enabled),
           (select count(*)::integer from real_co)
      from public.features f
     order by f.sort, f.key;
end;
$$;

create or replace function public.admin_set_company_level(p_company uuid, p_level public.business_level)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  perform public.apply_business_level(p_company, p_level, null);
end;
$$;

create or replace function public.admin_set_company_feature(p_company uuid, p_key text, p_enabled boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_platform_admin();
  perform public.apply_company_feature(p_company, p_key, p_enabled, 'admin');
end;
$$;

-- ---------------------------------------------------------------------
-- Scheduled entry point: exactly as Stage 10 (demo clean-up, alerts for
-- every company), plus the daily growth checks for real companies.
-- ---------------------------------------------------------------------
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
  end loop;
  -- Growth recommendations never stop the alerts (each company is also
  -- protected inside run_all_growth_checks).
  begin
    perform public.run_all_growth_checks();
  exception when others then
    raise warning 'Growth checks failed: %', sqlerrm;
  end;
  return v_total;
end;
$$;

-- ---------------------------------------------------------------------
-- Grants. New functions are executable by PUBLIC by default: revoke.
-- ---------------------------------------------------------------------
revoke execute on function
  public.level_rank(public.business_level),
  public.demo_skip_onboarding(),
  public.is_platform_admin(),
  public.require_platform_admin(),
  public.feature_map_internal(uuid),
  public.feature_on(uuid, text),
  public.company_feature_map(uuid),
  public.feature_enabled(uuid, text),
  public.apply_company_feature(uuid, text, boolean, text),
  public.set_company_feature(uuid, text, boolean),
  public.apply_business_level(uuid, public.business_level, jsonb),
  public.set_business_level(uuid, public.business_level, jsonb),
  public.company_profile(uuid),
  public.company_metrics_raw(uuid),
  public.company_metrics(uuid),
  public.fmt_count(numeric),
  public.growth_check(uuid),
  public.run_growth_check(uuid, boolean),
  public.run_all_growth_checks(),
  public.respond_recommendation(uuid, text, integer),
  public.suggestion_visible(uuid),
  public.suggestion_check_input(text, text, text),
  public.suggestion_status_label(text),
  public.suggestion_key(uuid, text),
  public.submit_suggestion(uuid, text, text, text, boolean),
  public.create_improvement(uuid, text, text, text, uuid, text),
  public.review_suggestion(uuid, text, text, uuid),
  public.update_my_assignment(uuid, text, text),
  public.resubmit_suggestion(uuid, text),
  public.comment_suggestion(uuid, text),
  public.platform_overview(),
  public.platform_companies(boolean),
  public.platform_feedback_stats(),
  public.platform_app_feedback(integer),
  public.platform_feature_adoption(),
  public.admin_set_company_level(uuid, public.business_level),
  public.admin_set_company_feature(uuid, text, boolean)
from public, anon, authenticated;

grant execute on function
  public.level_rank(public.business_level),
  public.is_platform_admin(),
  public.company_feature_map(uuid),
  public.feature_enabled(uuid, text),
  public.set_company_feature(uuid, text, boolean),
  public.set_business_level(uuid, public.business_level, jsonb),
  public.company_profile(uuid),
  public.company_metrics(uuid),
  public.run_growth_check(uuid, boolean),
  public.respond_recommendation(uuid, text, integer),
  public.suggestion_visible(uuid),
  public.submit_suggestion(uuid, text, text, text, boolean),
  public.create_improvement(uuid, text, text, text, uuid, text),
  public.review_suggestion(uuid, text, text, uuid),
  public.update_my_assignment(uuid, text, text),
  public.resubmit_suggestion(uuid, text),
  public.comment_suggestion(uuid, text),
  public.platform_overview(),
  public.platform_companies(boolean),
  public.platform_feedback_stats(),
  public.platform_app_feedback(integer),
  public.platform_feature_adoption(),
  public.admin_set_company_level(uuid, public.business_level),
  public.admin_set_company_feature(uuid, text, boolean)
to authenticated;

-- Redefined: keeps its grants (the server calls it with the secret).
revoke execute on function public.run_all_alerts(text) from public;
grant execute on function public.run_all_alerts(text) to anon, authenticated;

notify pgrst, 'reload schema';
