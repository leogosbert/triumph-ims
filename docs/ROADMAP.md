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

## Stage 13 — Small-level essentials
- Expenses with categories and receipts photos; simple profit & loss; customer and supplier statements.
- Mobile-money payment methods (M-Pesa, Tigo Pesa, Airtel Money, HaloPesa) and simple reconciliation.
- Quotation follow-up and invoice reminders (configurable).

## Stage 14 — Medium operations & CRM
- CRM: leads, opportunities and pipeline, follow-ups, customer visits, communication history, important dates.
- Tenders and contracts (framework prices, validity, alerts); documents library with expiry.
- Stock transfers between stores, min/max levels, purchase requisitions, three-way match, partial deliveries/backorders.
- Supplier performance, slow-moving stock, quotation conversion, cross-sell insights.

## Stage 15 — Enterprise
- Branches/business units with consolidated head-office reporting; departmental permissions; multi-level approvals.
- Budgets vs actual, cash-flow forecasting, demand and purchase planning; scheduled reports.
- Fleet and logistics tracking; API and accounting/payment integrations.

## Stage 16 — Intelligence & integrations
- AI business assistant over the company's own data (permission-checked, states period and data used).
- Configurable Tanzania tax (TRA EFD/VFD); WhatsApp/SMS notifications; East Africa localisation.
