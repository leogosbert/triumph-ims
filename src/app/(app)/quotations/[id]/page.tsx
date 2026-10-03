import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { ProductLineFields } from "@/components/ProductPicker";
import { SharePdfButton } from "@/components/SharePdfButton";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDate, formatDateTime } from "@/lib/format";
import { CURRENCIES, INCOTERMS, PAYMENT_TERMS } from "@/lib/lists";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { productOptions } from "@/lib/options";
import { PO_STATUS, SRFQ_STATUS } from "@/lib/purchasing";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { QUOTE_STATUS, quoteNo, StatusBadge, todayTz } from "@/lib/sales";
import {
  addQuoteLine,
  cancelQuote,
  markSent,
  recordOutcome,
  removeQuoteLine,
  reviewQuote,
  reviseQuote,
  saveQuoteHeader,
  submitQuote,
  updateQuoteLine,
} from "../actions";
import { createSupplierRfq } from "../../supplier-rfqs/actions";

export const metadata = { title: "Quotation" };

type Line = {
  id: string;
  line_no: number;
  product_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_pct: number;
  line_total: number;
  product: { sku: string } | null;
};

const n = (v: unknown) => Number(v ?? 0);
const fmtNum = (v: unknown) => n(v).toLocaleString("en-GB", { maximumFractionDigits: 3 });

export default async function QuotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user } = await getAppContext();

  const { data: q } = await supabase
    .from("quotations")
    .select("*, client:clients(id, name, code, tax_status)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!q) notFound();

  const showCosts = can(role, "seeCosts");
  const canEdit = can(role, "editSales");
  const isDraft = q.status === "draft";
  const editable = canEdit && isDraft;

  const [{ data: lineData }, { data: revData }, { data: marginRow }] = await Promise.all([
    supabase
      .from("quotation_lines")
      .select("id, line_no, product_id, description, quantity, unit, unit_price, discount_pct, line_total, product:products(sku)")
      .eq("quotation_id", id)
      .order("line_no"),
    supabase
      .from("quotations")
      .select("id, number, revision, status")
      .eq("company_id", company.id)
      .eq("number", q.number)
      .order("revision"),
    showCosts
      ? supabase.from("quotation_margins").select("*").eq("quotation_id", id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const lines = (lineData ?? []) as unknown as Line[];
  const revisions = (revData ?? []) as { id: string; number: string; revision: number; status: string }[];

  // Live margin estimate for drafts (cost roles only).
  let estimate: { margin: number | null; missing: number } | null = null;
  if (showCosts && isDraft && lines.length) {
    const ids = lines.map((l) => l.product_id).filter((x): x is string => !!x);
    const { data: costs } = ids.length
      ? await supabase.from("product_costs").select("product_id, last_cost").in("product_id", ids)
      : { data: [] };
    const costMap = new Map(((costs ?? []) as { product_id: string; last_cost: number | null }[]).map((c) => [c.product_id, c.last_cost]));
    let rev = 0;
    let cost = 0;
    let missing = 0;
    for (const l of lines) {
      const c = l.product_id ? costMap.get(l.product_id) : null;
      if (c === null || c === undefined) missing++;
      else {
        rev += n(l.line_total) * n(q.exchange_rate);
        cost += n(l.quantity) * n(c);
      }
    }
    estimate = { margin: rev > 0 ? ((rev - cost) / rev) * 100 : null, missing };
  }

  const products = editable ? await productOptions(supabase, company.id) : [];
  const buyer = can(role, "editPurchasing");
  const [{ data: srfqData }, { data: poData }] = buyer
    ? await Promise.all([
        supabase.from("supplier_rfqs").select("id, number, status").eq("quotation_id", id),
        supabase.from("purchase_orders").select("id, number, status, supplier:suppliers(name)").eq("quotation_id", id),
      ])
    : [{ data: [] }, { data: [] }];
  const linkedSrfqs = (srfqData ?? []) as { id: string; number: string; status: string }[];
  const linkedPos = (poData ?? []) as unknown as { id: string; number: string; status: string; supplier: { name: string } | null }[];
  const names = await namesFor(supabase, [q.created_by, q.submitted_by, q.approved_by]);
  const ccy = q.currency as string;
  const today = todayTz();
  const expired = q.valid_until && q.valid_until < today && ["approved", "sent"].includes(q.status);
  const pdfHref = `/quotations/${q.id}/pdf`;
  const pdfName = `${quoteNo(q)} ${q.client?.name ?? ""}.pdf`.replace(/[^\w.\- ]+/g, "").trim();
  const minMargin = n(company.quote_min_margin_pct ?? 12);

  return (
    <>
      <p className="small">
        <Link href="/quotations">← Quotations</Link>
        {q.rfq_id && (
          <>
            {" · "}
            <Link href={`/rfqs/${q.rfq_id}`}>RFQ</Link>
          </>
        )}
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{q.client?.name}</h1>
        <StatusBadge map={QUOTE_STATUS} status={q.status} />
      </div>
      <p className="muted small">
        {quoteNo(q)} · issued {formatDate(q.issue_date)}
        {q.valid_until && <> · valid until {formatDate(q.valid_until)}</>}
        {expired && <span className="text-warn"> · expired</span>}
        {q.created_by && <> · by {names.get(q.created_by)}</>}
      </p>
      <Notice {...notice} />

      {isDraft && q.review_note && (
        <div className="banner bad">
          <strong>Sent back by management:</strong> {q.review_note}
        </div>
      )}
      {q.status === "pending_approval" && (
        <div className="banner warn">
          <strong>Waiting for management approval</strong> because: {q.approval_reason}.
          {q.submitted_by && (
            <div className="small">
              Submitted by {names.get(q.submitted_by)} on {formatDateTime(q.submitted_at)}
            </div>
          )}
        </div>
      )}
      {["approved", "sent", "accepted"].includes(q.status) && q.approved_by && q.approval_reason && (
        <div className="banner ok small">
          Approved by {names.get(q.approved_by)} despite: {q.approval_reason}.{q.review_note ? ` Note: ${q.review_note}` : ""}
        </div>
      )}
      {["accepted", "rejected"].includes(q.status) && q.outcome_reason && (
        <div className={`banner ${q.status === "accepted" ? "ok" : "bad"} small`}>
          Client&apos;s answer: {q.outcome_reason}
        </div>
      )}

      {/* ---------- Actions ---------- */}
      <div className="actions-bar">
        {["approved", "sent", "accepted", "rejected"].includes(q.status) && (
          <>
            <SharePdfButton href={pdfHref} fileName={pdfName} title={`Quotation ${quoteNo(q)}`} />
            <a className="btn" href={pdfHref} target="_blank" rel="noopener">
              Open PDF
            </a>
          </>
        )}
        {isDraft && lines.length > 0 && (
          <a className="btn" href={pdfHref} target="_blank" rel="noopener">
            Preview PDF
          </a>
        )}
      </div>

      {canEdit && isDraft && lines.length > 0 && (
        <form action={submitQuote} className="card">
          <input type="hidden" name="id" value={q.id} />
          <p className="small muted" style={{ marginTop: 0 }}>
            When you submit, the app checks the margin and value. If they&apos;re within the rules it&apos;s approved
            straight away; otherwise management is asked to approve.
          </p>
          <SubmitButton className="btn btn-primary btn-block" pendingText="Checking…">
            Submit quotation
          </SubmitButton>
        </form>
      )}

      {q.status === "pending_approval" && can(role, "approveQuotes") && q.submitted_by !== user.id && (
        <form action={reviewQuote} className="card">
          <input type="hidden" name="id" value={q.id} />
          <h2>Your decision</h2>
          <div className="field">
            <label htmlFor="note">
              Note <span className="hint">· required when sending back</span>
            </label>
            <textarea id="note" name="note" placeholder="e.g. OK for this client; or: reduce discount to 5%" />
          </div>
          <div className="actions">
            <SubmitButton name="decision" value="approve" pendingText="Saving…">
              Approve
            </SubmitButton>
            <SubmitButton name="decision" value="return" className="btn btn-danger" pendingText="Saving…">
              Send back for changes
            </SubmitButton>
          </div>
        </form>
      )}

      {canEdit && ["approved", "sent"].includes(q.status) && (
        <section className="card">
          <h2>Client</h2>
          {q.status === "approved" && (
            <form action={markSent} style={{ marginBottom: 12 }}>
              <input type="hidden" name="id" value={q.id} />
              <SubmitButton className="btn btn-block">I have sent it to the client</SubmitButton>
            </form>
          )}
          <form action={recordOutcome}>
            <input type="hidden" name="id" value={q.id} />
            <div className="field">
              <label htmlFor="reason">
                Client&apos;s answer <span className="hint">· e.g. PO number, or why they declined</span>
              </label>
              <input id="reason" name="reason" type="text" />
            </div>
            <div className="actions">
              <SubmitButton name="outcome" value="accepted" pendingText="Saving…">
                Client accepted
              </SubmitButton>
              <SubmitButton name="outcome" value="rejected" className="btn btn-danger" pendingText="Saving…">
                Client rejected
              </SubmitButton>
            </div>
          </form>
        </section>
      )}

      {buyer && ["approved", "sent", "accepted"].includes(q.status) && (
        <section className="card" id="purchasing">
          <h2>Purchasing for this order</h2>
          {linkedSrfqs.length + linkedPos.length === 0 && (
            <p className="muted small">
              {q.status === "accepted" ? "The client accepted. Ask suppliers for prices, or order directly." : "You can ask suppliers for prices already."}
            </p>
          )}
          <ul className="list">
            {linkedSrfqs.map((r) => (
              <li key={r.id} className="row">
                <Link href={`/supplier-rfqs/${r.id}`}>Supplier RFQ {r.number}</Link>
                <StatusBadge map={SRFQ_STATUS} status={r.status} />
              </li>
            ))}
            {linkedPos.map((p) => (
              <li key={p.id} className="row">
                <Link href={`/purchase-orders/${p.id}`}>
                  {p.number} · {p.supplier?.name}
                </Link>
                <StatusBadge map={PO_STATUS} status={p.status} />
              </li>
            ))}
          </ul>
          <div className="actions">
            <form action={createSupplierRfq}>
              <input type="hidden" name="quotation_id" value={q.id} />
              <SubmitButton className="btn btn-primary" pendingText="Creating…">
                Request supplier quotes
              </SubmitButton>
            </form>
            <Link href={`/purchase-orders/new?quotation=${q.id}`} className="btn">
              Create purchase order
            </Link>
          </div>
        </section>
      )}

      {/* ---------- Lines ---------- */}
      <section className="card" id="lines">
        <h2>Items ({lines.length})</h2>
        {lines.length === 0 && <p className="muted small">No items yet.</p>}
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
                  <form action={updateQuoteLine} className="line-edit" style={{ flex: 1 }}>
                    <input type="hidden" name="quotation_id" value={q.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <div>
                      <label htmlFor={`q-${l.id}`}>Qty</label>
                      <input id={`q-${l.id}`} name="quantity" type="text" inputMode="decimal" defaultValue={fmtNum(l.quantity)} />
                    </div>
                    <div>
                      <label htmlFor={`p-${l.id}`}>Unit price</label>
                      <input id={`p-${l.id}`} name="unit_price" type="text" inputMode="decimal" defaultValue={fmtNum(l.unit_price)} />
                    </div>
                    <div>
                      <label htmlFor={`d-${l.id}`}>Disc. %</label>
                      <input id={`d-${l.id}`} name="discount_pct" type="text" inputMode="decimal" defaultValue={fmtNum(l.discount_pct)} />
                    </div>
                    <SubmitButton className="btn btn-small" pendingText="…">
                      Update
                    </SubmitButton>
                  </form>
                  <form action={removeQuoteLine}>
                    <input type="hidden" name="quotation_id" value={q.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <SubmitButton className="btn btn-small btn-danger" pendingText="…">
                      Remove
                    </SubmitButton>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="totals" style={{ marginTop: 12 }}>
          {n(q.discount_total) > 0 && (
            <div className="row small muted">
              <span>Discounts</span>
              <span>− {formatMoney(q.discount_total, ccy)}</span>
            </div>
          )}
          <div className="row">
            <span>Subtotal</span>
            <span>{formatMoney(q.subtotal, ccy)}</span>
          </div>
          <div className="row">
            <span>VAT {n(q.vat_rate)}%</span>
            <span>{formatMoney(q.vat_amount, ccy)}</span>
          </div>
          <div className="row grand">
            <span>Total</span>
            <span>{formatMoney(q.total, ccy)}</span>
          </div>
          {ccy !== company.base_currency && (
            <div className="row small muted">
              <span>
                ≈ in {company.base_currency} at {fmtNum(q.exchange_rate)}
              </span>
              <span>{formatMoney(n(q.total) * n(q.exchange_rate), company.base_currency)}</span>
            </div>
          )}
        </div>

        {editable && (
          <details style={{ marginTop: 16 }} open={lines.length === 0}>
            <summary>
              <strong>+ Add an item</strong>
            </summary>
            <form action={addQuoteLine} style={{ marginTop: 12 }}>
              <input type="hidden" name="quotation_id" value={q.id} />
              <ProductLineFields products={products} showPrice />
              {ccy !== company.base_currency && (
                <p className="hint">
                  Catalogue prices are converted from {company.base_currency} at the rate on this quotation ({fmtNum(q.exchange_rate)}).
                  Set the rate under Details first.
                </p>
              )}
              <SubmitButton pendingText="Adding…">Add item</SubmitButton>
            </form>
          </details>
        )}
      </section>

      {showCosts && (estimate || marginRow) && (
        <section className="card">
          <h2>Margin</h2>
          <p className="muted small">Only management, procurement and finance can see this.</p>
          {(() => {
            const m = estimate ? estimate.margin : marginRow?.margin_pct != null ? n(marginRow.margin_pct) : null;
            const missing = estimate ? estimate.missing : n(marginRow?.lines_without_cost);
            return (
              <dl className="kv">
                <dt>{estimate ? "Estimated margin" : "Margin at submission"}</dt>
                <dd className={m !== null && m < minMargin ? "text-warn" : undefined}>
                  {m === null ? "—" : `${m.toFixed(1)}%`}
                </dd>
                {missing > 0 && (
                  <>
                    <dt>Lines without a cost</dt>
                    <dd className="text-warn">{missing}</dd>
                  </>
                )}
                {!estimate && marginRow && (
                  <>
                    <dt>Cost (known lines)</dt>
                    <dd>{formatMoney(marginRow.cost_base, company.base_currency)}</dd>
                  </>
                )}
              </dl>
            );
          })()}
        </section>
      )}

      {/* ---------- Details ---------- */}
      <section className="card" id="details">
        <h2>Details</h2>
        <form action={saveQuoteHeader}>
          <input type="hidden" name="id" value={q.id} />
          <fieldset className="plain" disabled={!editable}>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="contact_name">Attention (client contact)</label>
                <input id="contact_name" name="contact_name" type="text" defaultValue={q.contact_name ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="client_ref">Client&apos;s reference</label>
                <input id="client_ref" name="client_ref" type="text" defaultValue={q.client_ref ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="currency">Currency</label>
                <select id="currency" name="currency" defaultValue={ccy}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="exchange_rate">
                  Exchange rate <span className="hint">· {company.base_currency} per 1 unit</span>
                </label>
                <input id="exchange_rate" name="exchange_rate" type="text" inputMode="decimal" defaultValue={fmtNum(q.exchange_rate)} />
              </div>
              <div className="field">
                <label htmlFor="issue_date">Issue date</label>
                <input id="issue_date" name="issue_date" type="date" defaultValue={q.issue_date} />
              </div>
              <div className="field">
                <label htmlFor="valid_until">Valid until</label>
                <input id="valid_until" name="valid_until" type="date" defaultValue={q.valid_until ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="delivery_time">Delivery time</label>
                <input id="delivery_time" name="delivery_time" type="text" defaultValue={q.delivery_time ?? ""} placeholder="e.g. 2–3 weeks after PO" />
              </div>
              <div className="field">
                <label htmlFor="payment_terms">Payment terms</label>
                <select id="payment_terms" name="payment_terms" defaultValue={q.payment_terms ?? ""}>
                  <option value="">—</option>
                  {[...new Set([...(q.payment_terms ? [q.payment_terms] : []), ...PAYMENT_TERMS])].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="incoterms">Incoterms</label>
                <select id="incoterms" name="incoterms" defaultValue={q.incoterms ?? ""}>
                  <option value="">—</option>
                  {INCOTERMS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="vat_rate">VAT %</label>
                <input id="vat_rate" name="vat_rate" type="text" inputMode="decimal" defaultValue={fmtNum(q.vat_rate)} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="notes">
                  Notes to the client <span className="hint">· printed on the quotation</span>
                </label>
                <textarea id="notes" name="notes" defaultValue={q.notes ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="terms">Terms and conditions</label>
                <textarea id="terms" name="terms" defaultValue={q.terms ?? ""} />
              </div>
            </div>
            {editable && <SubmitButton>Save details</SubmitButton>}
          </fieldset>
        </form>
      </section>

      {revisions.length > 1 && (
        <section className="card">
          <h2>Versions</h2>
          <ul className="list">
            {revisions.map((r) => (
              <li key={r.id} className="row">
                {r.id === q.id ? <strong>{quoteNo(r)} (this one)</strong> : <Link href={`/quotations/${r.id}`}>{quoteNo(r)}</Link>}
                <StatusBadge map={QUOTE_STATUS} status={r.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && (
        <div className="actions">
          {["pending_approval", "approved", "sent", "rejected"].includes(q.status) && (
            <form action={reviseQuote}>
              <input type="hidden" name="id" value={q.id} />
              <SubmitButton className="btn" pendingText="Copying…">
                Make a revision
              </SubmitButton>
            </form>
          )}
          {!["accepted", "superseded", "cancelled"].includes(q.status) && (
            <form action={cancelQuote}>
              <input type="hidden" name="id" value={q.id} />
              <SubmitButton className="btn btn-danger" pendingText="Cancelling…">
                Cancel quotation
              </SubmitButton>
            </form>
          )}
        </div>
      )}
    </>
  );
}
