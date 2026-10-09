# LeMoSp Roadmap — towards "Start Simple, Grow With Your Business"

See [PRODUCT-VISION.md](PRODUCT-VISION.md) for the philosophy. This file tracks what exists and what comes next.

## Already built (stages 1–10)

| Area | Built | Level it belongs to |
| --- | --- | --- |
| Company profile, branding, users, roles (management, sales, procurement, warehouse, driver, finance) | ✅ | Small |
| Customers (clients, contacts, credit limits, terms), suppliers, products & catalogue import | ✅ | Small / Medium |
| Client RFQs, quotations with PDF, approval rules by margin/value | ✅ | Small / Medium |
| Supplier RFQs & price comparison, purchase orders with approvals | ✅ | Medium |
| Goods received (GRN), stock on hand, batches & expiry, multiple stores, adjustments, opening stock | ✅ | Small / Medium |
| Delivery notes, driver app with offline proof of delivery | ✅ | Small / Medium |
| Invoices, receipts, payments, receivables aging, supplier bills, payables, landed cost, order profit | ✅ | Small / Medium |
| Multi-currency with exchange-rate controls | ✅ | Medium |
| Control tower dashboard, notifications engine, push/email outbox | ✅ | All |
| Activity log (audit trail), data export, nightly backups | ✅ | All |
| English/Kiswahili, dark mode, PWA install, animations | ✅ | All |
| Demo (one level), two-step verification, password security, app lock, update pop-up | ✅ | All |

## Stage 11 — Progressive platform foundation (built — run the Stage 11 SQL)
- Business level per company (Small / Medium / Enterprise), changeable any time, never loses data.
- Feature catalogue + per-company switches (level = defaults; any feature can be switched on).
- Onboarding questionnaire → recommended level with plain-language explanation and comparison.
- Adaptive navigation (level + role + features); locked features shown as "Available as your business grows".
- Growth engine: company metrics → configurable recommendation rules → contextual recommendations
  (accept / postpone / dismiss), notifications to managers.
- Growth & Recommendations page; Settings → Business level & features.
- Suggestion Box with review workflow, assignment, comments, internal improvements.
- Platform Admin: companies, levels, feature catalogue, recommendation rules, anonymised feedback and adoption analytics.

## Stage 12 — Demos & guided tours (built — run the Stage 12 SQL)
- Small, Medium and Enterprise demo companies with level-appropriate fictional data; switch level inside the demo.
- Interactive guided tours on the real screens (spotlight steps), per-feature tutorials, "Explore demo" in onboarding.
- LeMoSp ADMIN: the platform admin area installs as its own app (Android and iPhone) with its own install card.

## v1.13 — Trust & separation (built — run the v1.13 SQL)
- LeMoSp ADMIN served from its own web address (second Netlify site from the same code) so phones install it separately.
- Demo guides per scale with "see the guide for another scale?"; more reliable update notice.
- Automatic in-app backups per company (nightly, kept 7 daily / 5 weekly / 12 monthly), download, overdue alerts.
- Security plus: strict browser security headers, sign-in history and new-device alerts, sign out everywhere,
  password re-check before sensitive changes (enforced in the database), privacy blur, security health check.

## v1.14 — Leaving & admin alerts (built — run the v1.14 SQL)
- Delete my account (7-day grace, business records kept as "Deleted user"); close company (30-day grace, then all data deleted);
  remove the app / clear this device; public /delete-account page; admin Deletions tab with file clean-up.
- LeMoSp ADMIN notifications: bell, list, phone push and optional email, daily summary.

## v1.15 — Reports (built — no SQL needed)
- Reports section: 18 reports (sales, purchasing, stock, deliveries, payments, bills, profit, order costs, lists),
  any date range or ready-made period, filters, column chooser and sort; print, PDF and Excel download; saved reports per device.

## Stage 13 (v1.16) — Small-level essentials (built — run the Stage 13 SQL)
SQL: `supabase/migrations/20261016000100_stage13_small_essentials.sql`. Until it is run, the new screens say
"not available yet" and everything else works as before.
- Expenses (`/expenses`) with editable categories and receipt photos (private `receipts` bucket); everyone records
  their own, management and finance see all and can void. Expenses and "Expenses by category" reports.
- Simple profit & loss (`/profit-loss`): month, previous month, year to date; "Profit & loss by month" report.
- Client and supplier statements of account (`/statements`, `/clients/[id]/statement`, `/suppliers/[id]/statement`)
  with PDF, running balance and aging at the end date.
- Mobile money: service (M-Pesa, Mixx by Yas / Tigo Pesa, Airtel Money, HaloPesa, AzamPesa) on payments in and out
  and on expenses; pay numbers on invoices (step-up protected, like bank details); "Check payments" (`/reconcile`)
  to tick payments against the statement by hand or by pasting the statement.
- Quotation follow-ups and invoice reminders: per-company timing (Settings → Company → Follow-ups and reminders),
  alerts in notifications, ready-made WhatsApp/SMS/email messages in English and Kiswahili, follow-up log with
  next date or promised payment date (overdue reminders pause until a promised date).

## Stage 14 (v1.17) — Medium operations & CRM (built — run the two Stage 14 SQL files)
SQL, in order: `supabase/migrations/20261017000100_stage14_crm_contracts.sql`, then
`supabase/migrations/20261017000200_stage14_operations.sql`. Until they are run, the new screens say
"not available yet" and everything else works as before. Running them switches the features on for Medium and
Enterprise companies (Small companies can switch them on under Features).
- CRM pipeline (`/crm`): opportunities for clients or prospects, stages with win chance, owner, next step and
  follow-up alerts, calls/visits/messages history, convert prospect to client, quotation link (won or lost when the
  quotation is accepted or rejected), important client dates with yearly reminders; CRM on the client page.
- Tenders (`/tenders`): closing date and time with reminders, default checklist of papers, bid price, result with
  winner and winning price. Contracts (`/contracts`): framework and supply contracts with agreed prices, "Use
  contract prices" on draft quotations, end-of-contract alerts.
- Documents library (`/documents`): files in a private `documents` bucket, linked to clients, suppliers, products,
  tenders or contracts, with expiry reminders.
- Stock transfers (`/transfers`) between stores (oldest expiry first, in transit, receive or cancel); maximum stock
  level on products; reorder list (`/stock/reorder`) with suggested quantities to a draft PO or purchase request.
- Purchase requests (`/requisitions`): anyone but drivers asks; management approves; procurement orders.
- Order, receipt and bill check (`/purchasing/match`), still to deliver (`/backorders`), Business insights
  (`/insights`: win rates, supplier punctuality, slow-moving stock, items bought together).
- Reports: Sales pipeline, Tenders, Documents and expiry dates.

## Stage 15 (v1.18) — Enterprise (built — run the two Stage 15 SQL files)
SQL, in order: `supabase/migrations/20261018000100_stage15_planning_fleet.sql`, then
`supabase/migrations/20261018000200_stage15_branches_approvals.sql`. Until they are run, the new screens say
"not available yet". Running them switches the features on for Enterprise companies (others can switch them on
under Features).
- Budgets vs actual (`/budgets`): monthly budgets for sales, gross profit, expenses (total or per category) and net
  profit against the profit & loss figures.
- Cash-flow forecast (`/cashflow`): cash today plus unpaid invoices, minus supplier bills, unbilled purchase orders
  and usual monthly expenses, week by week for 13 or 26 weeks.
- Purchase planning (`/planning`): sales per day, days of stock, reorder point from the supplier's lead time plus a
  week of safety stock, quantity for a month after arrival; to draft POs, purchase requests or reorder levels.
- Vehicles (`/fleet`): insurance, inspection and service dates with reminders; fuel, service and repair log
  (drivers add lines too); plates offered on delivery notes.
- Branches (`/branches`): stores and people per branch; quotations, invoices, purchase orders and expenses take the
  branch of their maker (or of the quotation); management can move a document. Head-office figures
  (`/head-office`): sales, gross profit, expenses, purchases, money owed and stock per branch.
- Approval steps (`/approvals`): purchase orders above each step's amount are approved in order by the step's role
  (or management); never by the submitter, never two steps by one person; the next approver is notified.
- Scheduled reports (`/scheduled-reports`): any report with its filters, every day, week or month, as an alert and
  email with a link for the period just ended (sent by the existing alert job from 07:00).
- Still to come: departmental permissions (limiting what each branch sees); API and accounting/payment
  integrations.

## Stage 16 — Intelligence & integrations
- AI business assistant over the company's own data (permission-checked, states period and data used).
- Configurable Tanzania tax (TRA EFD/VFD); WhatsApp/SMS notifications; East Africa localisation.
