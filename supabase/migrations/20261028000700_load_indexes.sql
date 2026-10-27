-- =====================================================================
-- TRIUMPH IMS / LeMoSp  ·  Load-test indexes
--
-- Found by a local load test against a large single-company dataset
-- (5k clients, 20k products, 50k quotations, 50k invoices, 30k POs,
-- 160k stock movements ...). The list/landing screens sort a whole
-- company's rows by date and take the first 100. Without an index that
-- already carries that order, Postgres had to read and RLS-check EVERY
-- matching row before the LIMIT, e.g. the default invoices list spent
-- ~2.6 s scanning 50k rows just to show 100.
--
-- Each index below lets the matching screen read rows already in the
-- order it wants and stop at the LIMIT, cutting those queries from
-- 1-2.6 s to ~5 ms on the test data. All are idempotent and plain
-- (CONCURRENTLY is unnecessary here and breaks the SQL-editor workflow).
--
-- NOTE: the heaviest dashboard aggregates (stock_on_hand, invoice_profit)
-- are NOT index-fixable: they aggregate a whole company and their cost is
-- dominated by per-row RLS. See docs/load-report notes; the recommended
-- fix there is a SECURITY DEFINER aggregate RPC, not an index.
-- =====================================================================

-- Default list landings: ORDER BY created_at DESC LIMIT 100 ------------
create index if not exists invoices_company_created_idx
  on public.invoices (company_id, created_at desc);

create index if not exists quotations_company_created_idx
  on public.quotations (company_id, created_at desc);

create index if not exists purchase_orders_company_created_idx
  on public.purchase_orders (company_id, created_at desc);

create index if not exists supplier_bills_company_created_idx
  on public.supplier_bills (company_id, created_at desc);

-- Deliveries list: ORDER BY planned_date DESC NULLS LAST, created_at DESC
create index if not exists deliveries_company_planned_idx
  on public.deliveries (company_id, planned_date desc nulls last, created_at desc);

-- Money owed / unpaid & overdue invoice tabs & aging -------------------
-- Open invoices ordered by due_date (receivables, invoices?tab=unpaid,
-- invoices?tab=overdue, finance aging).
create index if not exists invoices_company_due_open_idx
  on public.invoices (company_id, due_date)
  where status in ('issued', 'partly_paid');

-- Approvals queue: quotations awaiting approval by submission time ------
-- (home "My" page, sales approvals).
create index if not exists quotations_company_submitted_pending_idx
  on public.quotations (company_id, submitted_at)
  where status = 'pending_approval';
