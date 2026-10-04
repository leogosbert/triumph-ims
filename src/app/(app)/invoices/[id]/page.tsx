import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { ProductLineFields } from "@/components/ProductPicker";
import { SharePdfButton } from "@/components/SharePdfButton";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { daysOverdue, INVOICE_STATUS, isOpen, n, PAY_METHODS, shownStatus } from "@/lib/finance";
import { formatDate, formatDateTime } from "@/lib/format";
import { CURRENCIES, PAYMENT_TERMS } from "@/lib/lists";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { productOptions } from "@/lib/options";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { quoteNo, StatusBadge, todayTz } from "@/lib/sales";
import {
  addInvoiceLine,
  cancelInvoice,
  issueInvoice,
  recordPayment,
  removeInvoiceLine,
  saveInvoiceHeader,
  updateInvoiceLine,
  voidPayment,
} from "../actions";

export const metadata = { title: "Invoice" };

const fmtNum = (v: unknown) => n(v).toLocaleString("en-GB", { maximumFractionDigits: 3 });

type Line = {
  id: string;
  line_no: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_pct: number;
  line_total: number;
  product: { sku: string } | null;
};
type Payment = {
  id: string;
  number: string;
  received_on: string;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

export default async function InvoicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeInvoices")) redirect("/");

  const { data: inv } = await supabase
    .from("invoices")
    .select("*, client:clients(id, name, credit_limit), quotation:quotations(id, number, revision), delivery:deliveries(id, number)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!inv) notFound();

  const edit = can(role, "editInvoices");
  const isDraft = inv.status === "draft";
  const editable = edit && isDraft;
  const open = isOpen(inv.status);
  const [{ data: lineData }, { data: payData }, products, names, { data: profit }] = await Promise.all([
    supabase
      .from("invoice_lines")
      .select("id, line_no, description, quantity, unit, unit_price, discount_pct, line_total, product:products(sku)")
      .eq("invoice_id", id)
      .order("line_no"),
    supabase
      .from("payments")
      .select("id, number, received_on, amount, currency, method, reference, voided_at, void_reason")
      .eq("invoice_id", id)
      .order("received_on"),
    editable ? productOptions(supabase, company.id) : Promise.resolve([]),
    namesFor(supabase, [inv.created_by, inv.issued_by, inv.credit_override_by]),
    can(role, "seeProfit") && !isDraft && inv.status !== "cancelled"
      ? supabase.from("invoice_profit").select("revenue_base, cost_base, lines_without_cost").eq("invoice_id", id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const lines = (lineData ?? []) as unknown as Line[];
  const payments = (payData ?? []) as Payment[];
  const ccy = inv.currency as string;
  const base = company.base_currency;
  const balance = n(inv.total) - n(inv.amount_paid);
  const shown = shownStatus(inv.status, inv.due_date);
  const late = open ? daysOverdue(inv.due_date) : 0;
  const pdfHref = `/invoices/${inv.id}/pdf`;
  const label = inv.number || "Draft invoice";
  const pdfName = `${inv.number || "Draft invoice"} ${inv.client?.name ?? ""}.pdf`;

  return (
    <>
      <p className="small">
        <Link href="/invoices">{tr("← Invoices")}</Link>
        {inv.quotation && can(role, "seeSales") && (
          <>
            {" · "}
            <Link href={`/quotations/${inv.quotation.id}`}>{quoteNo(inv.quotation)}</Link>
          </>
        )}
        {inv.delivery && (
          <>
            {" · "}
            <Link href={`/deliveries/${inv.delivery.id}`}>{inv.delivery.number}</Link>
          </>
        )}
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{inv.client?.name}</h1>
        <StatusBadge map={INVOICE_STATUS} status={shown} />
        <div className="head-amount num">
          {formatMoney(inv.status === "issued" || inv.status === "partly_paid" ? balance : inv.total, ccy)}
          {(inv.status === "issued" || inv.status === "partly_paid") && <span>{tr("Balance due")}</span>}
        </div>
      </div>
      <p className="muted small">
        {label}
        {inv.issue_date && <>{" "}{tr("· issued")}{" "}{formatDate(inv.issue_date)}</>}
        {inv.due_date && <>{" "}{tr("· due")}{" "}{formatDate(inv.due_date)}</>}
        {late > 0 && <span className="text-warn"> · {late}{" "}{tr("days overdue")}</span>}
        {inv.created_by && <>{" "}{tr("· by")}{" "}{names.get(inv.created_by)}</>}
      </p>
      <Notice {...notice} />

      {inv.status === "cancelled" && (
        <div className="banner bad">
          <strong>{tr("Cancelled.")}</strong> {inv.cancelled_reason ?? ""}
        </div>
      )}
      {inv.credit_override_by && (
        <div className="banner warn small">{tr("Issued above the client's credit limit, approved by")}{" "}{names.get(inv.credit_override_by)}.
        </div>
      )}

      <div className="actions-bar">
        {!isDraft && (
          <>
            <SharePdfButton href={pdfHref} fileName={pdfName} title={`Invoice ${inv.number}`} />
            <a className="btn" href={pdfHref} target="_blank" rel="noopener">{tr("Open PDF")}</a>
          </>
        )}
        {isDraft && lines.length > 0 && (
          <a className="btn" href={pdfHref} target="_blank" rel="noopener">{tr("Preview PDF")}</a>
        )}
      </div>

      {editable && lines.length > 0 && (
        <form action={issueInvoice} className="card">
          <input type="hidden" name="id" value={inv.id} />
          <p className="small muted" style={{ marginTop: 0 }}>{tr("Issuing gives the invoice its number and due date and locks it. If it takes the client above their credit limit, only management can issue it.")}</p>
          <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Issuing…")}>{tr("Issue invoice")}</SubmitButton>
        </form>
      )}

      {/* ---------- Money ---------- */}
      {!isDraft && inv.status !== "cancelled" && (
        <section className="card" id="payments">
          <h2>{tr("Payment")}</h2>
          <div className="totals" style={{ maxWidth: "none" }}>
            <div className="row">
              <span>{tr("Invoice total")}</span>
              <span>{formatMoney(inv.total, ccy)}</span>
            </div>
            <div className="row">
              <span>{tr("Paid")}</span>
              <span>{formatMoney(inv.amount_paid, ccy)}</span>
            </div>
            <div className={`row grand ${late > 0 ? "text-warn" : ""}`}>
              <span>{tr("Balance due")}</span>
              <span>{formatMoney(balance, ccy)}</span>
            </div>
          </div>

          {payments.length > 0 && (
            <ul className="list" style={{ marginTop: 12 }}>
              {payments.map((p) => (
                <li key={p.id}>
                  <div className="row">
                    <span>
                      <strong style={p.voided_at ? { textDecoration: "line-through" } : undefined}>
                        {formatMoney(p.amount, p.currency)}
                      </strong>{" "}
                      <span className="small muted">
                        {formatDate(p.received_on)} · {PAY_METHODS[p.method] ?? p.method}
                        {p.reference ? ` · ${p.reference}` : ""} · {p.number}
                      </span>
                    </span>
                    {!p.voided_at && (
                      <a className="btn btn-small" href={`/payments/${p.id}/pdf`} target="_blank" rel="noopener">{tr("Receipt")}</a>
                    )}
                  </div>
                  {p.voided_at && <div className="small text-warn">{tr("Voided:")}{" "}{p.void_reason}</div>}
                  {!p.voided_at && can(role, "voidPayments") && (
                    <details className="small">
                      <summary>{tr("Void this payment")}</summary>
                      <form action={voidPayment} className="inline-form" style={{ marginTop: 6 }}>
                        <input type="hidden" name="invoice_id" value={inv.id} />
                        <input type="hidden" name="payment_id" value={p.id} />
                        <input name="reason" type="text" placeholder={tr("Reason, e.g. cheque bounced")} required />
                        <SubmitButton className="btn btn-small btn-danger" pendingText="…">{tr("Void")}</SubmitButton>
                      </form>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}

          {edit && open && (
            <details style={{ marginTop: 12 }} open={payments.length === 0}>
              <summary>
                <strong>{tr("+ Record a payment received")}</strong>
              </summary>
              <form action={recordPayment} style={{ marginTop: 12 }}>
                <input type="hidden" name="invoice_id" value={inv.id} />
                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor="amount">{tr("Amount (")}{ccy})</label>
                    <input id="amount" name="amount" type="text" inputMode="decimal" defaultValue={fmtNum(balance)} required />
                  </div>
                  <div className="field">
                    <label htmlFor="received_on">{tr("Date received")}</label>
                    <input id="received_on" name="received_on" type="date" defaultValue={todayTz()} />
                  </div>
                  <div className="field">
                    <label htmlFor="method">{tr("How")}</label>
                    <select id="method" name="method" defaultValue="bank_transfer">
                      {Object.entries(PAY_METHODS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="reference">{tr("Reference")}</label>
                    <input id="reference" name="reference" type="text" placeholder={tr("Bank ref, cheque no., M-Pesa code")} />
                  </div>
                  {ccy !== base && (
                    <div className="field">
                      <label htmlFor="exchange_rate">{tr("Exchange rate on the day")}{" "}<span className="hint">· {base}{" "}{tr("per 1")}{" "}{ccy}</span>
                      </label>
                      <input id="exchange_rate" name="exchange_rate" type="text" inputMode="decimal" defaultValue={fmtNum(inv.exchange_rate)} />
                    </div>
                  )}
                </div>
                <SubmitButton pendingText={tr("Saving…")}>{tr("Record payment")}</SubmitButton>
              </form>
            </details>
          )}
        </section>
      )}

      {/* ---------- Lines ---------- */}
      <section className="card" id="lines">
        <h2>{tr("Items (")}{lines.length})</h2>
        {lines.length === 0 && <p className="muted small">{tr("No items yet.")}</p>}
        <ul className="lines">
          {lines.map((l) => (
            <li key={l.id}>
              <div className="line-head">
                <div>
                  <div className="desc">
                    {l.line_no}. {l.description}
                  </div>
                  <div className="muted small">
                    {fmtNum(l.quantity)} {l.unit} × {formatMoney(l.unit_price, ccy)}
                    {n(l.discount_pct) > 0 && ` − ${n(l.discount_pct)}%`}
                    {l.product ? ` · ${l.product.sku}` : ""}
                  </div>
                </div>
                <strong style={{ whiteSpace: "nowrap" }}>{formatMoney(l.line_total, ccy)}</strong>
              </div>
              {editable && (
                <div className="row" style={{ alignItems: "end" }}>
                  <form action={updateInvoiceLine} className="line-edit" style={{ flex: 1 }}>
                    <input type="hidden" name="invoice_id" value={inv.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <div>
                      <label htmlFor={`q-${l.id}`}>{tr("Qty")}</label>
                      <input id={`q-${l.id}`} name="quantity" type="text" inputMode="decimal" defaultValue={fmtNum(l.quantity)} />
                    </div>
                    <div>
                      <label htmlFor={`p-${l.id}`}>{tr("Unit price")}</label>
                      <input id={`p-${l.id}`} name="unit_price" type="text" inputMode="decimal" defaultValue={fmtNum(l.unit_price)} />
                    </div>
                    <div>
                      <label htmlFor={`d-${l.id}`}>{tr("Disc. %")}</label>
                      <input id={`d-${l.id}`} name="discount_pct" type="text" inputMode="decimal" defaultValue={fmtNum(l.discount_pct)} />
                    </div>
                    <SubmitButton className="btn btn-small" pendingText="…">{tr("Update")}</SubmitButton>
                  </form>
                  <form action={removeInvoiceLine}>
                    <input type="hidden" name="invoice_id" value={inv.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <SubmitButton className="btn btn-small btn-danger" pendingText="…">{tr("Remove")}</SubmitButton>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="totals" style={{ marginTop: 12 }}>
          {n(inv.discount_total) > 0 && (
            <div className="row small muted">
              <span>{tr("Discounts")}</span>
              <span>− {formatMoney(inv.discount_total, ccy)}</span>
            </div>
          )}
          <div className="row">
            <span>{tr("Subtotal")}</span>
            <span>{formatMoney(inv.subtotal, ccy)}</span>
          </div>
          <div className="row">
            <span>{tr("VAT")}{" "}{n(inv.vat_rate)}%</span>
            <span>{formatMoney(inv.vat_amount, ccy)}</span>
          </div>
          <div className="row grand">
            <span>{tr("Total")}</span>
            <span>{formatMoney(inv.total, ccy)}</span>
          </div>
          {ccy !== base && (
            <div className="row small muted">
              <span>{tr("≈ in")}{" "}{base}{" "}{tr("at")}{" "}{fmtNum(inv.exchange_rate)}
              </span>
              <span>{formatMoney(n(inv.total) * n(inv.exchange_rate), base)}</span>
            </div>
          )}
        </div>

        {editable && (
          <details style={{ marginTop: 16 }} open={lines.length === 0}>
            <summary>
              <strong>{tr("+ Add an item")}</strong>
            </summary>
            <form action={addInvoiceLine} style={{ marginTop: 12 }}>
              <input type="hidden" name="invoice_id" value={inv.id} />
              <ProductLineFields products={products} showPrice />
              <SubmitButton pendingText={tr("Adding…")}>{tr("Add item")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      {profit && (
        <section className="card">
          <h2>{tr("Profit on this invoice")}</h2>
          <p className="muted small">{tr("Only management and finance see this. Costs are the product costs when the invoice was issued.")}</p>
          {(() => {
            const rev = n(profit.revenue_base);
            const cost = n(profit.cost_base);
            const gp = rev - cost;
            return (
              <dl className="kv">
                <dt>{tr("Sales (before VAT)")}</dt>
                <dd>{formatMoney(rev, base)}</dd>
                <dt>{tr("Cost of goods")}</dt>
                <dd>{formatMoney(cost, base)}</dd>
                <dt>{tr("Gross profit")}</dt>
                <dd>
                  <strong>{formatMoney(gp, base)}</strong> {rev > 0 && <span className="muted">({((gp / rev) * 100).toFixed(1)}%)</span>}
                </dd>
                {n(profit.lines_without_cost) > 0 && (
                  <>
                    <dt>{tr("Lines without a cost")}</dt>
                    <dd className="text-warn">{n(profit.lines_without_cost)}{" "}{tr("— profit is overstated")}</dd>
                  </>
                )}
              </dl>
            );
          })()}
          {inv.quotation && (
            <p className="small">
              <Link href={`/quotations/${inv.quotation.id}#profit`}>{tr("Whole-order profit, including freight and other costs →")}</Link>
            </p>
          )}
        </section>
      )}

      {/* ---------- Details ---------- */}
      <section className="card" id="details">
        <h2>{tr("Details")}</h2>
        <form action={saveInvoiceHeader}>
          <input type="hidden" name="id" value={inv.id} />
          <fieldset className="plain" disabled={!editable}>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="client_ref">{tr("Client's order / PO no.")}</label>
                <input id="client_ref" name="client_ref" type="text" defaultValue={inv.client_ref ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="contact_name">{tr("Attention")}</label>
                <input id="contact_name" name="contact_name" type="text" defaultValue={inv.contact_name ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="currency">{tr("Currency")}</label>
                <select id="currency" name="currency" defaultValue={ccy}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="exchange_rate">{tr("Exchange rate")}{" "}<span className="hint">· {base}{" "}{tr("per 1 unit")}</span>
                </label>
                <input id="exchange_rate" name="exchange_rate" type="text" inputMode="decimal" defaultValue={fmtNum(inv.exchange_rate)} />
              </div>
              <div className="field">
                <label htmlFor="issue_date">{tr("Invoice date")}{" "}<span className="hint">{tr("· blank = the day it is issued")}</span>
                </label>
                <input id="issue_date" name="issue_date" type="date" defaultValue={inv.issue_date ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="due_date">{tr("Due date")}{" "}<span className="hint">{tr("· blank =")}{" "}{company.invoice_due_days ?? 30}{" "}{tr("days after")}</span>
                </label>
                <input id="due_date" name="due_date" type="date" defaultValue={inv.due_date ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="payment_terms">{tr("Payment terms")}</label>
                <select id="payment_terms" name="payment_terms" defaultValue={inv.payment_terms ?? ""}>
                  <option value="">—</option>
                  {[...new Set([...(inv.payment_terms ? [inv.payment_terms] : []), ...PAYMENT_TERMS])].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="vat_rate">{tr("VAT %")}</label>
                <input id="vat_rate" name="vat_rate" type="text" inputMode="decimal" defaultValue={fmtNum(inv.vat_rate)} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="notes">{tr("Notes")}{" "}<span className="hint">{tr("· printed on the invoice")}</span>
                </label>
                <textarea id="notes" name="notes" defaultValue={inv.notes ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="terms">{tr("Terms")}</label>
                <textarea id="terms" name="terms" defaultValue={inv.terms ?? ""} />
              </div>
            </div>
            {editable && <SubmitButton>{tr("Save details")}</SubmitButton>}
          </fieldset>
        </form>
        {inv.issued_at && (
          <p className="small muted">{tr("Issued")}{" "}{formatDateTime(inv.issued_at)}
            {inv.issued_by && <>{" "}{tr("by")}{" "}{names.get(inv.issued_by)}</>}
          </p>
        )}
      </section>

      {((edit && isDraft) || (can(role, "voidPayments") && open && n(inv.amount_paid) === 0)) && (
        <details className="card">
          <summary>
            <strong>{tr("Cancel this invoice")}</strong>
          </summary>
          <form action={cancelInvoice} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={inv.id} />
            <div className="field">
              <label htmlFor="reason">{tr("Reason")}{" "}{!isDraft && <span className="hint">{tr("· required")}</span>}</label>
              <input id="reason" name="reason" type="text" required={!isDraft} />
            </div>
            <SubmitButton className="btn btn-danger" pendingText={tr("Cancelling…")}>{tr("Cancel invoice")}</SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}
