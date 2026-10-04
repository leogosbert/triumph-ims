import { primeLang, tr } from "@/lib/tr";
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
import { OrderCosts, type OrderCost } from "@/components/OrderCosts";
import { BILL_STATUS, shownStatus } from "@/lib/finance";
import { applyLandedCost } from "../../finance/actions";

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
  await primeLang();
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
  const showCosts = can(role, "editOrderCosts") && po.status !== "cancelled" && !isDraft;
  const showBills = can(role, "seeBills") && !["draft", "pending_approval", "cancelled"].includes(po.status);
  const [{ data: costData }, { data: billData }] = await Promise.all([
    showCosts
      ? supabase.from("order_costs").select("id, kind, description, amount, currency, exchange_rate, incurred_on").eq("po_id", id).order("incurred_on")
      : Promise.resolve({ data: [] }),
    showBills
      ? supabase.from("supplier_bills").select("id, number, supplier_invoice_no, status, due_date, total, currency").eq("po_id", id).order("created_at")
      : Promise.resolve({ data: [] }),
  ]);
  const costs = (costData ?? []) as OrderCost[];
  const poBills = (billData ?? []) as { id: string; number: string; supplier_invoice_no: string | null; status: string; due_date: string | null; total: number; currency: string }[];
  const extrasBase = costs.reduce((s, c) => s + n(c.amount) * n(c.exchange_rate), 0);
  const spread = n(po.freight) * n(po.exchange_rate) + extrasBase;
  const goodsBase = n(po.subtotal) * n(po.exchange_rate);
  const landedReady = ["confirmed", "partially_received", "received", "closed"].includes(po.status);
  const q = quote as { id: string; number: string; revision: number; client: { name: string } | null } | null;
  const ccy = po.currency as string;
  const today = todayTz();
  const late = po.expected_date && po.expected_date < today && ["sent", "confirmed", "partially_received"].includes(po.status);
  const pdfHref = `/purchase-orders/${po.id}/pdf`;
  const pdfName = `${po.number} ${po.supplier?.name ?? ""}.pdf`.replace(/[^\w.\- ]+/g, "").trim();

  return (
    <>
      <p className="small">
        <Link href="/purchase-orders">{tr("← Purchase orders")}</Link>
        {po.srfq_id && can(role, "editPurchasing") && (
          <>
            {" · "}
            <Link href={`/supplier-rfqs/${po.srfq_id}`}>{tr("Supplier RFQ")}</Link>
          </>
        )}
        {q && (
          <>
            {" · "}
            <Link href={`/quotations/${q.id}`}>{tr("For")}{" "}{q.client?.name} ({quoteNo(q)})
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
            · {late ? tr("late, was due") : tr("due")} {formatDate(po.expected_date)}
          </span>
        )}
        {po.supplier_ref && <>{" "}{tr("· their ref")}{" "}{po.supplier_ref}</>}
      </p>
      <Notice {...notice} />

      {isDraft && po.review_note && (
        <div className="banner bad">
          <strong>{tr("Sent back by management:")}</strong> {po.review_note}
        </div>
      )}
      {po.status === "pending_approval" && (
        <div className="banner warn">
          <strong>{tr("Waiting for management approval")}</strong>{" "}{tr("because:")}{" "}{po.approval_reason}.
          {po.submitted_by && (
            <div className="small">{tr("Submitted by")}{" "}{names.get(po.submitted_by)}{" "}{tr("on")}{" "}{formatDateTime(po.submitted_at)}
            </div>
          )}
        </div>
      )}

      <div className="actions-bar">
        {!["draft", "pending_approval", "cancelled"].includes(po.status) && (
          <>
            <SharePdfButton href={pdfHref} fileName={pdfName} title={`Purchase order ${po.number}`} />
            <a className="btn" href={pdfHref} target="_blank" rel="noopener">{tr("Open PDF")}</a>
          </>
        )}
        {isDraft && lines.length > 0 && (
          <a className="btn" href={pdfHref} target="_blank" rel="noopener">{tr("Preview PDF")}</a>
        )}
      </div>

      {editable && lines.length > 0 && (
        <form action={submitPo} className="card">
          <input type="hidden" name="id" value={po.id} />
          <p className="small muted" style={{ marginTop: 0 }}>{tr("POs above")}{" "}{formatMoney(company.po_approval_above, company.base_currency)}{" "}{tr("need management approval (unless you are management).")}</p>
          <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Submitting…")}>{tr("Submit purchase order")}</SubmitButton>
        </form>
      )}

      {po.status === "pending_approval" && can(role, "approvePOs") && po.submitted_by !== user.id && (
        <form action={reviewPo} className="card">
          <input type="hidden" name="id" value={po.id} />
          <h2>{tr("Your decision")}</h2>
          <div className="field">
            <label htmlFor="note">{tr("Note")}{" "}<span className="hint">{tr("· required when sending back")}</span>
            </label>
            <textarea id="note" name="note" />
          </div>
          <div className="actions">
            <SubmitButton name="decision" value="approve" pendingText={tr("Saving…")}>{tr("Approve")}</SubmitButton>
            <SubmitButton name="decision" value="return" className="btn btn-danger" pendingText={tr("Saving…")}>{tr("Send back for changes")}</SubmitButton>
          </div>
        </form>
      )}

      {canEdit && ["approved", "sent"].includes(po.status) && (
        <section className="card">
          <h2>{tr("Supplier")}</h2>
          {po.status === "approved" && (
            <form action={markPoSent} style={{ marginBottom: 12 }}>
              <input type="hidden" name="id" value={po.id} />
              <SubmitButton className="btn btn-block">{tr("I have sent it to the supplier")}</SubmitButton>
            </form>
          )}
          <form action={confirmPo}>
            <input type="hidden" name="id" value={po.id} />
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="supplier_ref">{tr("Their order / confirmation no.")}</label>
                <input id="supplier_ref" name="supplier_ref" type="text" defaultValue={po.supplier_ref ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="expected_date">{tr("Confirmed delivery date")}</label>
                <input id="expected_date" name="expected_date" type="date" defaultValue={po.expected_date ?? ""} />
              </div>
            </div>
            <SubmitButton pendingText={tr("Saving…")}>{tr("Supplier confirmed")}</SubmitButton>
            <p className="hint" style={{ marginTop: 6 }}>{tr("Confirming also updates each product's last cost from this PO.")}</p>
          </form>
        </section>
      )}

      {(can(role, "receiveGoods") && ["approved", "sent", "confirmed", "partially_received"].includes(po.status)) || grns.length > 0 ? (
        <section className="card">
          <h2>{tr("Goods received")}</h2>
          {grns.length === 0 && <p className="muted small">{tr("Nothing received yet.")}</p>}
          <ul className="list">
            {grns.map((g) => (
              <li key={g.id} className="row">
                <Link href={`/grns/${g.id}`}>{g.number}</Link>
                <span className="small muted">{formatDate(g.received_on)}</span>
              </li>
            ))}
          </ul>
          {can(role, "receiveGoods") && ["approved", "sent", "confirmed", "partially_received"].includes(po.status) && (
            <Link href={`/purchase-orders/${po.id}/receive`} className="btn btn-primary" style={{ marginTop: 8 }}>{tr("Receive goods")}</Link>
          )}
        </section>
      ) : null}

      {showBills && (
        <section className="card" id="bills">
          <h2>{tr("Supplier's invoices")}</h2>
          {poBills.length === 0 && <p className="muted small">{tr("No supplier invoice recorded yet.")}</p>}
          <ul className="list">
            {poBills.map((b) => (
              <li key={b.id} className="row">
                <Link href={`/bills/${b.id}`}>{b.supplier_invoice_no || b.number}</Link>
                <span className="small">
                  {formatMoney(b.total, b.currency)} <StatusBadge map={BILL_STATUS} status={shownStatus(b.status, b.due_date)} />
                </span>
              </li>
            ))}
          </ul>
          {can(role, "editBills") && (
            <Link href={`/bills/new?po=${po.id}`} className="btn" style={{ marginTop: 8 }}>{tr("Record supplier's invoice")}</Link>
          )}
        </section>
      )}

      {showCosts && (
        <section className="card" id="costs">
          <h2>{tr("Import costs & landed cost")}</h2>
          <p className="muted small">{tr("Add duty, clearing, port charges, insurance and other costs for this order. They are shared over the items by value to give the true landed cost per unit.")}</p>
          <OrderCosts
            costs={costs}
            back={`/purchase-orders/${po.id}#costs`}
            poId={po.id}
            base={company.base_currency}
            canEdit={can(role, "editOrderCosts")}
          />
          {n(po.subtotal) > 0 && (
            <div className="scroll-x" style={{ marginTop: 12 }}>
              <table className="compare">
                <thead>
                  <tr>
                    <th>{tr("Item")}</th>
                    <th>{tr("Qty")}</th>
                    <th>{tr("Price (")}{company.base_currency})</th>
                    <th>{tr("Landed / unit")}</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const unitBase = n(l.unit_price) * n(po.exchange_rate);
                    const landed = (n(l.line_total) * n(po.exchange_rate) + (spread * n(l.line_total)) / n(po.subtotal)) / n(l.quantity);
                    return (
                      <tr key={l.id}>
                        <td>{l.description}</td>
                        <td>{fmtNum(l.quantity)}</td>
                        <td>{formatMoney(unitBase, company.base_currency).replace(`${company.base_currency} `, "")}</td>
                        <td className="best">{formatMoney(landed, company.base_currency).replace(`${company.base_currency} `, "")}</td>
                      </tr>
                    );
                  })}
                  <tr className="total">
                    <td>{tr("Total landed")}</td>
                    <td />
                    <td>{formatMoney(goodsBase, company.base_currency).replace(`${company.base_currency} `, "")}</td>
                    <td>{formatMoney(goodsBase + spread, company.base_currency).replace(`${company.base_currency} `, "")}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {po.landed_applied_at && (
            <p className="small muted">{tr("Applied")}{" "}{formatDateTime(po.landed_applied_at)}: {formatMoney(po.landed_cost_base, company.base_currency)}.
            </p>
          )}
          {landedReady ? (
            <form action={applyLandedCost} style={{ marginTop: 8 }}>
              <input type="hidden" name="po_id" value={po.id} />
              <SubmitButton className="btn btn-primary" pendingText={tr("Applying…")}>
                {po.landed_applied_at ? tr("Re-apply landed cost") : tr("Use landed cost as product cost")}
              </SubmitButton>
              <p className="hint" style={{ marginTop: 6 }}>{tr("Updates each product's cost, so quotation margins and profit use the real cost.")}</p>
            </form>
          ) : (
            <p className="hint">{tr("The landed cost can be applied once the supplier has confirmed the order.")}</p>
          )}
        </section>
      )}

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
                      <label htmlFor={`q-${l.id}`}>{tr("Qty")}</label>
                      <input id={`q-${l.id}`} name="quantity" type="text" inputMode="decimal" defaultValue={fmtNum(l.quantity)} />
                    </div>
                    <div>
                      <label htmlFor={`p-${l.id}`}>{tr("Unit price")}</label>
                      <input id={`p-${l.id}`} name="unit_price" type="text" inputMode="decimal" defaultValue={fmtNum(l.unit_price)} />
                    </div>
                    <SubmitButton className="btn btn-small" pendingText="…">{tr("Update")}</SubmitButton>
                  </form>
                  <form action={removePoLine}>
                    <input type="hidden" name="po_id" value={po.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <SubmitButton className="btn btn-small btn-danger" pendingText="…">{tr("Remove")}</SubmitButton>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
        <div className="totals" style={{ marginTop: 12 }}>
          <div className="row">
            <span>{tr("Subtotal")}</span>
            <span>{formatMoney(po.subtotal, ccy)}</span>
          </div>
          {n(po.freight) > 0 && (
            <div className="row">
              <span>{tr("Freight")}</span>
              <span>{formatMoney(po.freight, ccy)}</span>
            </div>
          )}
          <div className="row">
            <span>{tr("VAT")}{" "}{n(po.vat_rate)}%</span>
            <span>{formatMoney(po.vat_amount, ccy)}</span>
          </div>
          <div className="row grand">
            <span>{tr("Total")}</span>
            <span>{formatMoney(po.total, ccy)}</span>
          </div>
          {ccy !== company.base_currency && (
            <div className="row small muted">
              <span>{tr("≈ in")}{" "}{company.base_currency}{" "}{tr("at")}{" "}{fmtNum(po.exchange_rate)}
              </span>
              <span>{formatMoney(n(po.total) * n(po.exchange_rate), company.base_currency)}</span>
            </div>
          )}
        </div>
        {editable && (
          <details style={{ marginTop: 16 }} open={lines.length === 0}>
            <summary>
              <strong>{tr("+ Add an item")}</strong>
            </summary>
            <form action={addPoLine} style={{ marginTop: 12 }}>
              <input type="hidden" name="po_id" value={po.id} />
              <ProductLineFields products={products} showPrice />
              <p className="hint">{tr("An empty price uses the product's last cost (converted at this PO's exchange rate).")}</p>
              <SubmitButton pendingText={tr("Adding…")}>{tr("Add item")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      <section className="card" id="details">
        <h2>{tr("Details")}</h2>
        <form action={savePoHeader}>
          <input type="hidden" name="id" value={po.id} />
          <fieldset className="plain" disabled={!editable}>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="currency">{tr("Currency")}</label>
                <select id="currency" name="currency" defaultValue={ccy}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="exchange_rate">{tr("Exchange rate")}{" "}<span className="hint">· {company.base_currency}{" "}{tr("per 1 unit")}</span>
                </label>
                <input id="exchange_rate" name="exchange_rate" type="text" inputMode="decimal" defaultValue={fmtNum(po.exchange_rate)} />
              </div>
              <div className="field">
                <label htmlFor="order_date">{tr("Order date")}</label>
                <input id="order_date" name="order_date" type="date" defaultValue={po.order_date} />
              </div>
              <div className="field">
                <label htmlFor="expected_date2">{tr("Required by")}</label>
                <input id="expected_date2" name="expected_date" type="date" defaultValue={po.expected_date ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="delivery_location">{tr("Deliver to")}</label>
                <input id="delivery_location" name="delivery_location" type="text" defaultValue={po.delivery_location ?? ""} placeholder={company.address ?? tr("Our store")} />
              </div>
              <div className="field">
                <label htmlFor="payment_terms">{tr("Payment terms")}</label>
                <select id="payment_terms" name="payment_terms" defaultValue={po.payment_terms ?? ""}>
                  <option value="">—</option>
                  {[...new Set([...(po.payment_terms ? [po.payment_terms] : []), ...PAYMENT_TERMS])].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="incoterms">{tr("Incoterms")}</label>
                <select id="incoterms" name="incoterms" defaultValue={po.incoterms ?? ""}>
                  <option value="">—</option>
                  {INCOTERMS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="freight">{tr("Freight")}</label>
                <input id="freight" name="freight" type="text" inputMode="decimal" defaultValue={fmtNum(po.freight)} />
              </div>
              <div className="field">
                <label htmlFor="vat_rate">{tr("VAT %")}{" "}<span className="hint">{tr("· 0 for foreign suppliers")}</span></label>
                <input id="vat_rate" name="vat_rate" type="text" inputMode="decimal" defaultValue={fmtNum(po.vat_rate)} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="supplier_ref2">{tr("Supplier's quote reference")}</label>
                <input id="supplier_ref2" name="supplier_ref" type="text" defaultValue={po.supplier_ref ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="shipping_instructions">{tr("Shipping instructions")}</label>
                <textarea id="shipping_instructions" name="shipping_instructions" defaultValue={po.shipping_instructions ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="notes">{tr("Notes to the supplier")}</label>
                <textarea id="notes" name="notes" defaultValue={po.notes ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="terms">{tr("Terms")}</label>
                <textarea id="terms" name="terms" defaultValue={po.terms ?? ""} placeholder={tr("Leave empty for the standard PO terms")} />
              </div>
            </div>
            {editable && <SubmitButton>{tr("Save details")}</SubmitButton>}
          </fieldset>
        </form>
      </section>

      {canEdit && !["partially_received", "received", "closed", "cancelled"].includes(po.status) && (
        <form action={cancelPo}>
          <input type="hidden" name="id" value={po.id} />
          <SubmitButton className="btn btn-block btn-danger" pendingText={tr("Cancelling…")}>{tr("Cancel purchase order")}</SubmitButton>
        </form>
      )}
    </>
  );
}
