import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { LevelBadge } from "@/components/suggestions/SuggestionBadge";
import {
  ACCOUNT_STATUS,
  CATEGORIES,
  estimateMonthly,
  INVOICE_STATUS,
  loadPriceBook,
  overdue,
  priceOf,
  type AccountStatus,
  type CompanyBilling,
  type EstimateLine,
  type PlatformInvoice,
} from "@/lib/billing";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { PLAYBOOKS } from "@/lib/playbooks";
import { platformAdmin } from "../../guard";
import { createInvoice, grantItem, issueInvoice, recordPayment, saveCompanyBilling, voidInvoice } from "../actions";
import { RequestCard, type AdminRequest } from "../RequestCard";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Company billing" };

type PlatformCompany = { id: string; name: string; business_level: string; members: number; is_demo: boolean };

const today = () => new Date().toISOString().slice(0, 10);
const monthEnd = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};
const monthStart = () => `${today().slice(0, 8)}01`;

/** One company's terms, requests, playbooks and invoices from LeMo Tech. */
export default async function AdminCompanyBillingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase } = admin;
  const back = `/admin/billing/${id}`;

  const [{ data: cos }, book, { data: billRow }, { data: reqRows }, { data: invRows }] = await Promise.all([
    supabase.rpc("platform_companies", { p_include_demo: true }),
    loadPriceBook(supabase),
    supabase.from("company_billing").select("*").eq("company_id", id).maybeSingle(),
    supabase.rpc("platform_service_requests", { p_status: null, p_company: id }),
    supabase.from("platform_invoices").select("*").eq("company_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  const c = ((cos ?? []) as PlatformCompany[]).find((x) => x.id === id);
  if (!c) {
    return (
      <p className="card muted">
        {tr("Company not found.")} <Link href="/admin/billing">{tr("← Billing & services")}</Link>
      </p>
    );
  }
  const b: Partial<CompanyBilling> = (billRow as CompanyBilling | null) ?? {};
  const currency = (b.currency ?? "TZS") as "TZS" | "USD";
  const requests = (reqRows ?? []) as AdminRequest[];
  const invoices = (invRows ?? []) as PlatformInvoice[];
  const items = book.items;

  // Playbooks this company has, or has asked for.
  const pbState = new Map<string, AdminRequest>();
  for (const r of requests) {
    if (!r.playbook_id) continue;
    const prev = pbState.get(r.playbook_id);
    const rank = (s: string) => (s === "approved" || s === "delivered" ? 0 : s === "requested" ? 1 : 2);
    if (!prev || rank(r.status) < rank(prev.status)) pbState.set(r.playbook_id, r);
  }

  // Suggested invoice: the regular monthly lines plus approved one-off services not billed yet.
  const live = requests.filter((r) => r.status === "approved" || r.status === "delivered");
  const monthly = live.filter((r) => r.unit === "month" || r.unit === "user_month").map((r) => ({ key: r.item_key, quantity: Number(r.quantity) }));
  const lines: (EstimateLine & { requestId?: string })[] = estimateMonthly({ items, level: c.business_level, currency, members: Number(c.members), drivers: 0, monthly });
  for (const r of live.filter((x) => x.unit !== "month" && x.unit !== "user_month" && !x.invoice_id && x.category !== "playbook")) {
    const item = items.find((i) => i.key === r.item_key);
    const unit = r.quoted_price !== null ? Number(r.quoted_price) : item ? (priceOf(item, currency) ?? 0) : 0;
    lines.push({ key: r.item_key, description: r.item_name, quantity: Number(r.quantity), unit_price: unit, amount: unit * Number(r.quantity), requestId: r.id });
  }
  for (const r of live.filter((x) => x.category === "playbook" && !x.invoice_id)) {
    const item = items.find((i) => i.key === r.item_key);
    const unit = item ? (priceOf(item, currency) ?? 0) : 0;
    if (unit > 0) lines.push({ key: r.item_key, description: r.item_name, quantity: 1, unit_price: unit, amount: unit, requestId: r.id });
  }
  const blanks = 3;
  const st = ACCOUNT_STATUS[(b.status ?? "trial") as AccountStatus];

  return (
    <>
      <BackLink href="/admin/billing" label="Billing & services"> · <Link href={`/admin/companies/${id}`}>{tr("Company and features")}</Link>
      </BackLink>
      <div className="page-head">
        <h2 className="adm-title">{c.name}</h2>
        <LevelBadge level={c.business_level} /> <span className={`badge tone-${st.tone}`}>{tr(st.label)}</span>
      </div>
      <Notice {...notice} />
      {c.is_demo && <p className="notice">{tr("This is a demo company: it has every playbook and is never billed.")}</p>}

      <section className="card" id="terms">
        <h2>{tr("Billing terms")}</h2>
        <form action={saveCompanyBilling} className="stack">
          <input type="hidden" name="company_id" value={id} />
          <div className="grid">
            <div>
              <label htmlFor="status">{tr("Account")}</label>
              <select id="status" name="status" defaultValue={b.status ?? "trial"}>
                {(Object.keys(ACCOUNT_STATUS) as AccountStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {tr(ACCOUNT_STATUS[s].label)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="currency">{tr("Currency")}</label>
              <select id="currency" name="currency" defaultValue={currency}>
                <option value="TZS">TZS</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label htmlFor="cycle">{tr("Billing")}</label>
              <select id="cycle" name="cycle" defaultValue={b.cycle ?? "monthly"}>
                <option value="monthly">{tr("Monthly")}</option>
                <option value="quarterly">{tr("Quarterly (5% off)")}</option>
                <option value="annual">{tr("Annual (2 months free)")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="discount_pct">{tr("Discount %")}</label>
              <input id="discount_pct" name="discount_pct" inputMode="decimal" defaultValue={String(b.discount_pct ?? 0)} />
            </div>
            <div>
              <label htmlFor="trial_ends_on">{tr("Free trial ends")}</label>
              <input id="trial_ends_on" name="trial_ends_on" type="date" defaultValue={b.trial_ends_on ?? ""} />
            </div>
            <div>
              <label htmlFor="next_invoice_on">{tr("Next invoice")}</label>
              <input id="next_invoice_on" name="next_invoice_on" type="date" defaultValue={b.next_invoice_on ?? ""} />
            </div>
          </div>
          <label className="check">
            <input type="checkbox" name="founding" defaultChecked={Boolean(b.founding)} /> {tr("Founding client (30% off for 12 months, prices locked for 24 months)")}
          </label>
          <p className="hint">{tr("Changing the account to Payment overdue, Read-only or Suspended tells management and finance at once.")}</p>
          <SubmitButton className="btn btn-primary" pendingText={tr("Saving…")}>
            {tr("Save terms")}
          </SubmitButton>
        </form>
        {(b.billing_name || b.billing_email || b.billing_tin) && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            {tr("Invoice to:")} {[b.billing_name, b.billing_email, b.billing_tin && `TIN ${b.billing_tin}`].filter(Boolean).join(" · ")}
          </p>
        )}
      </section>

      <section className="card" id="requests">
        <h2>{tr("Requests and services")}</h2>
        {requests.filter((r) => r.status !== "cancelled").length === 0 ? (
          <p className="muted small">{tr("No requests yet.")}</p>
        ) : (
          <ul className="list">
            {requests
              .filter((r) => r.status !== "cancelled")
              .map((r) => (
                <RequestCard key={r.id} r={r} back={`${back}#requests`} showCompany={false} />
              ))}
          </ul>
        )}
        <details>
          <summary className="btn btn-small">{tr("Give a service, add-on or playbook")}</summary>
          <form action={grantItem} className="stack" style={{ marginTop: 10 }}>
            <input type="hidden" name="company_id" value={id} />
            <input type="hidden" name="back" value={`${back}#requests`} />
            <label htmlFor="item">{tr("Item")}</label>
            <select id="item" name="item" required>
              {CATEGORIES.filter((cat) => cat.key !== "plan").map((cat) => (
                <optgroup key={cat.key} label={tr(cat.title)}>
                  {items
                    .filter((i) => i.category === cat.key && i.active)
                    .map((i) => (
                      <option key={i.key} value={i.key}>
                        {i.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <label htmlFor="g-qty">{tr("How many")}</label>
            <input id="g-qty" name="quantity" inputMode="decimal" defaultValue="1" />
            <label htmlFor="g-note">{tr("Note to the company (optional)")}</label>
            <input id="g-note" name="note" maxLength={1000} />
            <SubmitButton className="btn btn-primary" pendingText="…">
              {tr("Give")}
            </SubmitButton>
          </form>
        </details>
      </section>

      <section className="card" id="playbooks">
        <h2>{tr("Playbooks")}</h2>
        <ul className="list">
          {PLAYBOOKS.map((p) => {
            const r = pbState.get(p.id);
            const has = c.is_demo || r?.status === "approved" || r?.status === "delivered";
            const key = items.find((i) => i.playbook_id === p.id)?.key;
            return (
              <li key={p.id} className="row" style={{ gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  {p.title}{" "}
                  {has ? (
                    <span className="badge tone-ok">{tr("Has it")}</span>
                  ) : r?.status === "requested" ? (
                    <span className="badge tone-warn">{tr("Requested")}</span>
                  ) : null}
                </span>
                {!has && key && !c.is_demo && (
                  <form action={grantItem}>
                    <input type="hidden" name="company_id" value={id} />
                    <input type="hidden" name="item" value={key} />
                    <input type="hidden" name="back" value={`${back}#playbooks`} />
                    <SubmitButton className="btn btn-small btn-primary" pendingText="…">
                      {tr("Give")}
                    </SubmitButton>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card" id="new">
        <h2>{tr("New invoice")}</h2>
        <p className="muted small">
          {tr("Suggested from the plan for this level, people above the included users, monthly add-ons and approved services not billed yet. Untick what should not be billed, change any amount, or add your own lines.")}
        </p>
        <form action={createInvoice} className="stack">
          <input type="hidden" name="company_id" value={id} />
          <div className="grid">
            <div>
              <label htmlFor="inv-cur">{tr("Currency")}</label>
              <select id="inv-cur" name="currency" defaultValue={currency}>
                <option value="TZS">TZS</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div>
              <label htmlFor="period_start">{tr("Period from")}</label>
              <input id="period_start" name="period_start" type="date" defaultValue={monthStart()} />
            </div>
            <div>
              <label htmlFor="period_end">{tr("to")}</label>
              <input id="period_end" name="period_end" type="date" defaultValue={monthEnd()} />
            </div>
            <div>
              <label htmlFor="inv-disc">{tr("Discount %")}</label>
              <input id="inv-disc" name="discount_pct" inputMode="decimal" defaultValue={String(b.discount_pct ?? 0)} />
            </div>
          </div>
          <div className="bl-lines">
            {[...lines, ...Array.from({ length: blanks }, () => null)].map((l, n) => (
              <div key={n} className="bl-line">
                <div>
                  <label className="check">
                    <input type="checkbox" name="line_use" value={String(n)} defaultChecked={Boolean(l)} /> {tr("Line")} {n + 1}
                  </label>
                  <input type="hidden" name="line_key" value={l?.key ?? ""} />
                  <input type="hidden" name="line_req" value={l?.requestId ?? ""} />
                  <input name="line_desc" defaultValue={l?.description ?? ""} placeholder={tr("Description")} aria-label={tr("Description")} maxLength={300} />
                </div>
                <div>
                  <label>{tr("Qty")}</label>
                  <input name="line_qty" inputMode="decimal" defaultValue={l ? String(l.quantity) : "1"} aria-label={tr("Qty")} />
                </div>
                <div>
                  <label>{tr("Price")}</label>
                  <input name="line_price" inputMode="decimal" defaultValue={l ? String(l.unit_price) : ""} aria-label={tr("Price")} />
                </div>
              </div>
            ))}
          </div>
          <label htmlFor="inv-notes">{tr("Notes on the invoice (optional)")}</label>
          <textarea id="inv-notes" name="notes" maxLength={1000} />
          <p className="hint">{tr("VAT is added from LeMo Tech details. Prices for USD invoices must be in USD.")}</p>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <SubmitButton className="btn btn-primary" name="issue" value="1" pendingText={tr("Issuing…")}>
              {tr("Issue invoice")}
            </SubmitButton>
            <SubmitButton className="btn" name="issue" value="0" pendingText="…">
              {tr("Save as draft")}
            </SubmitButton>
          </div>
        </form>
      </section>

      <section className="card" id="invoices">
        <h2>{tr("Invoices")}</h2>
        {invoices.length === 0 ? (
          <p className="muted small">{tr("No invoices yet.")}</p>
        ) : (
          <ul className="list">
            {invoices.map((i) => {
              const s = overdue(i) ? { label: "Overdue", tone: "bad" } : (INVOICE_STATUS[i.status] ?? INVOICE_STATUS.issued);
              const due = Number(i.total) - Number(i.paid_amount);
              return (
                <li key={i.id}>
                  <div className="line-head">
                    <div style={{ minWidth: 0 }}>
                      <strong>{i.number ?? tr("Draft")}</strong> <span className={`badge tone-${s.tone}`}>{tr(s.label)}</span>
                      <div className="muted small">
                        {formatMoney(i.total, i.currency)}
                        {Number(i.paid_amount) > 0 && i.status === "issued" && ` · ${tr("paid")} ${formatMoney(i.paid_amount, i.currency)}`}
                        {i.due_on && ` · ${tr("due")} ${formatDate(i.due_on)}`}
                        {i.paid_ref && ` · ${i.paid_method ?? ""} ${i.paid_ref}`}
                        {i.void_reason && ` · ${i.void_reason}`}
                      </div>
                    </div>
                    <a className="btn btn-small" href={`/admin/billing/invoice/${i.id}/pdf`} target="_blank" rel="noopener">
                      {tr("PDF")}
                    </a>
                  </div>
                  <div className="adm-req-actions" style={{ marginTop: 6 }}>
                    {i.status === "draft" && (
                      <form action={issueInvoice}>
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="back" value={`${back}#invoices`} />
                        <SubmitButton className="btn btn-small btn-primary" pendingText="…">
                          {tr("Issue")}
                        </SubmitButton>
                      </form>
                    )}
                    {i.status === "issued" && (
                      <details>
                        <summary className="btn btn-small btn-primary">{tr("Record payment")}</summary>
                        <form action={recordPayment} className="adm-req-actions" style={{ marginTop: 6 }}>
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="back" value={`${back}#invoices`} />
                          <input name="amount" inputMode="decimal" defaultValue={String(due)} aria-label={tr("Amount received")} style={{ maxWidth: 140 }} />
                          <select name="method" aria-label={tr("Method")} defaultValue="M-Pesa">
                            {["M-Pesa", "Mixx by Yas", "Airtel Money", "HaloPesa", "AzamPesa", "Bank transfer", "Cash", "Card"].map((m) => (
                              <option key={m}>{m}</option>
                            ))}
                          </select>
                          <input name="ref" placeholder={tr("Reference")} aria-label={tr("Reference")} maxLength={120} style={{ maxWidth: 160 }} />
                          <input name="paid_on" type="date" defaultValue={today()} aria-label={tr("Paid on")} />
                          <SubmitButton className="btn btn-small btn-primary" pendingText="…">
                            {tr("Save payment")}
                          </SubmitButton>
                        </form>
                      </details>
                    )}
                    {(i.status === "draft" || (i.status === "issued" && Number(i.paid_amount) === 0)) && (
                      <details>
                        <summary className="btn btn-small">{tr("Cancel invoice")}</summary>
                        <form action={voidInvoice} className="adm-req-actions" style={{ marginTop: 6 }}>
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="back" value={`${back}#invoices`} />
                          <input name="reason" required minLength={3} maxLength={300} placeholder={tr("Reason")} aria-label={tr("Reason")} />
                          <SubmitButton className="btn btn-small btn-danger" pendingText="…">
                            {tr("Cancel invoice")}
                          </SubmitButton>
                        </form>
                      </details>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
