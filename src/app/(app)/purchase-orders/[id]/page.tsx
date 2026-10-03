import Link from "next/link";
import { notFound, redirect } from "next/navigation";
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
import { namesFor } from "@/lib/people";
import { PO_STATUS } from "@/lib/purchasing";
import { can } from "@/lib/roles";
import { quoteNo, StatusBadge, todayTz } from "@/lib/sales";
import {
  addPoLine,
  cancelPo,
  confirmPo,
  markPoSent,
  removePoLine,
  reviewPo,
  savePoHeader,
  submitPo,
  updatePoLine,
} from "../actions";

export const metadata = { title: "Purchase order" };

type Line = {
  id: string;
  line_no: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  line_total: number;
  received_qty: number;
  product: { sku: string } | null;
};
const n = (v: unknown) => Number(v ?? 0);
const fmtNum = (v: unknown) => n(v).toLocaleString("en-GB", { maximumFractionDigits: 6 });

export default async function PurchaseOrderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user } = await getAppContext();
  if (!can(role, "seePurchasing")) redirect("/");

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*, supplier:suppliers(id, name, code, country)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!po) notFound();

  const canEdit = can(role, "editPurchasing");
  const isDraft = po.status === "draft";
  const editable = canEdit && isDraft;
  const { data: grnData } = await supabase.from("goods_receipts").select("id, number, received_on").eq("po_id", id).order("created_at");
  const grns = (grnData ?? []) as { id: string; number: string; received_on: string }[];
  const [{ data: lineData }, { data: quote }, products, names] = await Promise.all([
    supabase
      .from("po_lines")
      .select("id, line_no, description, quantity, unit, unit_price, line_total, received_qty, product:products(sku)")
      .eq("po_id", id)
      .order("line_no"),
    po.quotation_id && can(role, "seeSales")
      ? supabase.from("quotations").select("id, number, revision, client:clients(name)").eq("id", po.quotation_id).maybeSingle()
      : Promise.resolve({ data: null }),
    editable ? productOptions(supabase, company.id) : Promise.resolve([]),
    namesFor(supabase, [po.created_by, po.submitted_by, po.approved_by]),
  ]);
  const lines = (lineData ?? []) as unknown as Line[];
  const q = quote as { id: string; number: string; revision: number; client: { name: string } | null } | null;
  const ccy = po.currency as string;
  const today = todayTz();
  const late = po.expected_date && po.expected_date < today && ["sent", "confirmed", "partially_received"].includes(po.status);
  const pdfHref = `/purchase-orders/${po.id}/pdf`;
  const pdfName = `${po.number} ${po.supplier?.name ?? ""}.pdf`.replace(/[^\w.\- ]+/g, "").trim();

  return (
    <>
      <p className="small">
        <Link href="/purchase-orders">← Purchase orders</Link>
        {po.srfq_id && can(role, "editPurchasing") && (
          <>
            {" · "}
            <Link href={`/supplier-rfqs/${po.srfq_id}`}>Supplier RFQ</Link>
          </>
        )}
        {q && (
          <>
            {" · "}
            <Link href={`/quotations/${q.id}`}>
              For {q.client?.name} ({quoteNo(q)})
            </Link>
          </>
        )}
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{po.supplier?.name}</h1>
        <StatusBadge map={PO_STATUS} status={po.status} />
      </div>
      <p className="muted small">
        {po.number} · {formatDate(po.order_date)}
        {po.expected_date && (
          <span className={late ? "text-warn" : undefined}>
            {" "}
            · {late ? "late, was due" : "due"} {formatDate(po.expected_date)}
          </span>
        )}
        {po.supplier_ref && <> · their ref {po.supplier_ref}</>}
      </p>
      <Notice {...notice} />

      {isDraft && po.review_note && (
        <div className="banner bad">
          <strong>Sent back by management:</strong> {po.review_note}
        </div>
      )}
      {po.status === "pending_approval" && (
        <div className="banner warn">
          <strong>Waiting for management approval</strong> because: {po.approval_reason}.
          {po.submitted_by && (
            <div className="small">
              Submitted by {names.get(po.submitted_by)} on {formatDateTime(po.submitted_at)}
            </div>
          )}
        </div>
      )}

      <div className="actions-bar">
        {!["draft", "pending_approval", "cancelled"].includes(po.status) && (
          <>
            <SharePdfButton href={pdfHref} fileName={pdfName} title={`Purchase order ${po.number}`} />
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

      {editable && lines.length > 0 && (
        <form action={submitPo} className="card">
          <input type="hidden" name="id" value={po.id} />
          <p className="small muted" style={{ marginTop: 0 }}>
            POs above {formatMoney(company.po_approval_above, company.base_currency)} need management approval (unless you are management).
          </p>
          <SubmitButton className="btn btn-primary btn-block" pendingText="Submitting…">
            Submit purchase order
          </SubmitButton>
        </form>
      )}

      {po.status === "pending_approval" && can(role, "approvePOs") && po.submitted_by !== user.id && (
        <form action={reviewPo} className="card">
          <input type="hidden" name="id" value={po.id} />
          <h2>Your decision</h2>
          <div className="field">
            <label htmlFor="note">
              Note <span className="hint">· required when sending back</span>
            </label>
            <textarea id="note" name="note" />
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

      {canEdit && ["approved", "sent"].includes(po.status) && (
        <section className="card">
          <h2>Supplier</h2>
          {po.status === "approved" && (
            <form action={markPoSent} style={{ marginBottom: 12 }}>
              <input type="hidden" name="id" value={po.id} />
              <SubmitButton className="btn btn-block">I have sent it to the supplier</SubmitButton>
            </form>
          )}
          <form action={confirmPo}>
            <input type="hidden" name="id" value={po.id} />
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="supplier_ref">Their order / confirmation no.</label>
                <input id="supplier_ref" name="supplier_ref" type="text" defaultValue={po.supplier_ref ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="expected_date">Confirmed delivery date</label>
                <input id="expected_date" name="expected_date" type="date" defaultValue={po.expected_date ?? ""} />
              </div>
            </div>
            <SubmitButton pendingText="Saving…">Supplier confirmed</SubmitButton>
            <p className="hint" style={{ marginTop: 6 }}>Confirming also updates each product&apos;s last cost from this PO.</p>
          </form>
        </section>
      )}

      {(can(role, "receiveGoods") && ["approved", "sent", "confirmed", "partially_received"].includes(po.status)) || grns.length > 0 ? (
        <section className="card">
          <h2>Goods received</h2>
          {grns.length === 0 && <p className="muted small">Nothing received yet.</p>}
          <ul className="list">
            {grns.map((g) => (
              <li key={g.id} className="row">
                <Link href={`/grns/${g.id}`}>{g.number}</Link>
                <span className="small muted">{formatDate(g.received_on)}</span>
              </li>
            ))}
          </ul>
          {can(role, "receiveGoods") && ["approved", "sent", "confirmed", "partially_received"].includes(po.status) && (
            <Link href={`/purchase-orders/${po.id}/receive`} className="btn btn-primary" style={{ marginTop: 8 }}>
              Receive goods
            </Link>
          )}
        </section>
      ) : null}

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
                    {l.product ? ` · ${l.product.sku}` : ""}
                    {n(l.received_qty) > 0 && ` · received ${fmtNum(l.received_qty)}`}
                  </div>
                </div>
                <strong style={{ whiteSpace: "nowrap" }}>{formatMoney(l.line_total, ccy)}</strong>
              </div>
              {editable && (
                <div className="row" style={{ alignItems: "end" }}>
                  <form action={updatePoLine} className="line-edit" style={{ flex: 1, gridTemplateColumns: "1fr 1fr auto" }}>
                    <input type="hidden" name="po_id" value={po.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <div>
                      <label htmlFor={`q-${l.id}`}>Qty</label>
                      <input id={`q-${l.id}`} name="quantity" type="text" inputMode="decimal" defaultValue={fmtNum(l.quantity)} />
                    </div>
                    <div>
                      <label htmlFor={`p-${l.id}`}>Unit price</label>
                      <input id={`p-${l.id}`} name="unit_price" type="text" inputMode="decimal" defaultValue={fmtNum(l.unit_price)} />
                    </div>
                    <SubmitButton className="btn btn-small" pendingText="…">
                      Update
                    </SubmitButton>
                  </form>
                  <form action={removePoLine}>
                    <input type="hidden" name="po_id" value={po.id} />
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
          <div className="row">
            <span>Subtotal</span>
            <span>{formatMoney(po.subtotal, ccy)}</span>
          </div>
          {n(po.freight) > 0 && (
            <div className="row">
              <span>Freight</span>
              <span>{formatMoney(po.freight, ccy)}</span>
            </div>
          )}
          <div className="row">
            <span>VAT {n(po.vat_rate)}%</span>
            <span>{formatMoney(po.vat_amount, ccy)}</span>
          </div>
          <div className="row grand">
            <span>Total</span>
            <span>{formatMoney(po.total, ccy)}</span>
          </div>
          {ccy !== company.base_currency && (
            <div className="row small muted">
              <span>
                ≈ in {company.base_currency} at {fmtNum(po.exchange_rate)}
              </span>
              <span>{formatMoney(n(po.total) * n(po.exchange_rate), company.base_currency)}</span>
            </div>
          )}
        </div>
        {editable && (
          <details style={{ marginTop: 16 }} open={lines.length === 0}>
            <summary>
              <strong>+ Add an item</strong>
            </summary>
            <form action={addPoLine} style={{ marginTop: 12 }}>
              <input type="hidden" name="po_id" value={po.id} />
              <ProductLineFields products={products} showPrice />
              <p className="hint">An empty price uses the product&apos;s last cost (converted at this PO&apos;s exchange rate).</p>
              <SubmitButton pendingText="Adding…">Add item</SubmitButton>
            </form>
          </details>
        )}
      </section>

      <section className="card" id="details">
        <h2>Details</h2>
        <form action={savePoHeader}>
          <input type="hidden" name="id" value={po.id} />
          <fieldset className="plain" disabled={!editable}>
            <div className="grid grid-2">
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
                <input id="exchange_rate" name="exchange_rate" type="text" inputMode="decimal" defaultValue={fmtNum(po.exchange_rate)} />
              </div>
              <div className="field">
                <label htmlFor="order_date">Order date</label>
                <input id="order_date" name="order_date" type="date" defaultValue={po.order_date} />
              </div>
              <div className="field">
                <label htmlFor="expected_date2">Required by</label>
                <input id="expected_date2" name="expected_date" type="date" defaultValue={po.expected_date ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="delivery_location">Deliver to</label>
                <input id="delivery_location" name="delivery_location" type="text" defaultValue={po.delivery_location ?? ""} placeholder={company.address ?? "Our store"} />
              </div>
              <div className="field">
                <label htmlFor="payment_terms">Payment terms</label>
                <select id="payment_terms" name="payment_terms" defaultValue={po.payment_terms ?? ""}>
                  <option value="">—</option>
                  {[...new Set([...(po.payment_terms ? [po.payment_terms] : []), ...PAYMENT_TERMS])].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="incoterms">Incoterms</label>
                <select id="incoterms" name="incoterms" defaultValue={po.incoterms ?? ""}>
                  <option value="">—</option>
                  {INCOTERMS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="freight">Freight</label>
                <input id="freight" name="freight" type="text" inputMode="decimal" defaultValue={fmtNum(po.freight)} />
              </div>
              <div className="field">
                <label htmlFor="vat_rate">VAT % <span className="hint">· 0 for foreign suppliers</span></label>
                <input id="vat_rate" name="vat_rate" type="text" inputMode="decimal" defaultValue={fmtNum(po.vat_rate)} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="supplier_ref2">Supplier&apos;s quote reference</label>
                <input id="supplier_ref2" name="supplier_ref" type="text" defaultValue={po.supplier_ref ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="shipping_instructions">Shipping instructions</label>
                <textarea id="shipping_instructions" name="shipping_instructions" defaultValue={po.shipping_instructions ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="notes">Notes to the supplier</label>
                <textarea id="notes" name="notes" defaultValue={po.notes ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="terms">Terms</label>
                <textarea id="terms" name="terms" defaultValue={po.terms ?? ""} placeholder="Leave empty for the standard PO terms" />
              </div>
            </div>
            {editable && <SubmitButton>Save details</SubmitButton>}
          </fieldset>
        </form>
      </section>

      {canEdit && !["partially_received", "received", "closed", "cancelled"].includes(po.status) && (
        <form action={cancelPo}>
          <input type="hidden" name="id" value={po.id} />
          <SubmitButton className="btn btn-block btn-danger" pendingText="Cancelling…">
            Cancel purchase order
          </SubmitButton>
        </form>
      )}
    </>
  );
}
