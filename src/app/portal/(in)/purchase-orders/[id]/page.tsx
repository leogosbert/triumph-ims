import Link from "next/link";
import { notFound } from "next/navigation";
import { tr } from "@/lib/tr";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { call, PortalError, requireParty } from "@/lib/portal/server";
import type { PoDetail } from "@/lib/portal/types";
import { confirmPo } from "../../../actions";
import { ActionForm } from "../../../_c/ActionForm";
import { Badge, PO_STATUS, SUBMISSION_STATUS } from "../../../ui";

export const metadata = { title: "Purchase order" };

export default async function PortalPurchaseOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireParty("supplier");
  let po: PoDetail;
  try {
    po = await call<PoDetail>(ctx, "portal_purchase_order", { p_id: id });
  } catch (e) {
    if (e instanceof PortalError && e.code === "42501") notFound();
    throw e;
  }
  return (
    <>
      <p className="small">
        <Link href="/portal/purchase-orders">← {tr("Purchase orders")}</Link>
      </p>
      <div className="page-head">
        <h1>{po.number}</h1>
        <Badge map={PO_STATUS} status={po.status} />
      </div>

      {po.can_confirm && (
        <section className="card portal-callout">
          <h2>{tr("Please confirm this order")}</h2>
          <ActionForm action={confirmPo}>
            <input type="hidden" name="id" value={po.id} />
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="po-ref">
                  {tr("Your order or proforma number")} <span className="hint">{tr("optional")}</span>
                </label>
                <input id="po-ref" name="supplier_ref" type="text" maxLength={120} defaultValue={po.supplier_ref ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="po-exp">{tr("Delivery date you can meet")}</label>
                <input id="po-exp" name="expected_date" type="date" defaultValue={po.expected_date ?? ""} />
              </div>
            </div>
            <button type="submit" className="btn btn-primary btn-block">{tr("Confirm purchase order")}</button>
          </ActionForm>
        </section>
      )}

      <section className="card">
        <dl className="kv">
          <dt>{tr("Order date")}</dt>
          <dd>{formatDate(po.order_date)}</dd>
          {po.expected_date && (
            <>
              <dt>{tr("Expected")}</dt>
              <dd>{formatDate(po.expected_date)}</dd>
            </>
          )}
          {po.confirmed_at && (
            <>
              <dt>{tr("Confirmed")}</dt>
              <dd>{formatDateTime(po.confirmed_at)}</dd>
            </>
          )}
          {po.supplier_ref && (
            <>
              <dt>{tr("Your ref")}</dt>
              <dd>{po.supplier_ref}</dd>
            </>
          )}
          {po.delivery_location && (
            <>
              <dt>{tr("Deliver to")}</dt>
              <dd>{po.delivery_location}</dd>
            </>
          )}
          {po.payment_terms && (
            <>
              <dt>{tr("Payment terms")}</dt>
              <dd>{po.payment_terms}</dd>
            </>
          )}
          {po.incoterms && (
            <>
              <dt>{tr("Incoterms")}</dt>
              <dd>{po.incoterms}</dd>
            </>
          )}
        </dl>
        {po.shipping_instructions && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{po.shipping_instructions}</p>}
        <p className="portal-links" style={{ marginTop: 12 }}>
          <a className="btn btn-small" href={`/portal/download/po/${po.id}/pdf`} target="_blank" rel="noopener">
            {tr("Download PDF")}
          </a>
          {po.status !== "sent" && (
            <Link className="btn btn-small" href={`/portal/send?po=${po.id}`}>
              {tr("Send delivery note or invoice")}
            </Link>
          )}
        </p>
      </section>

      <section className="card">
        <h2>{tr("Items")}</h2>
        <ul className="lines">
          {po.lines.map((l) => (
            <li key={l.line_no}>
              <div className="row">
                <span>{l.description}</span>
                <span className="num">{formatMoney(l.line_total, po.currency)}</span>
              </div>
              <div className="small muted">
                {Number(l.quantity)} {l.unit} × {formatMoney(l.unit_price, po.currency)}
                {Number(l.received_qty) > 0 ? ` · ${tr("received")} ${Number(l.received_qty)}` : ""}
              </div>
            </li>
          ))}
        </ul>
        <div className="totals">
          <div className="row">
            <span>{tr("Subtotal")}</span>
            <span className="num">{formatMoney(po.subtotal, po.currency)}</span>
          </div>
          {Number(po.freight) > 0 && (
            <div className="row">
              <span>{tr("Freight")}</span>
              <span className="num">{formatMoney(po.freight, po.currency)}</span>
            </div>
          )}
          <div className="row">
            <span>
              {tr("VAT")} {Number(po.vat_rate)}%
            </span>
            <span className="num">{formatMoney(po.vat_amount, po.currency)}</span>
          </div>
          <div className="row grand">
            <span>{tr("Total")}</span>
            <span className="num">{formatMoney(po.total, po.currency)}</span>
          </div>
        </div>
        {po.terms && (
          <details className="small">
            <summary>{tr("Terms and conditions")}</summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{po.terms}</p>
          </details>
        )}
      </section>

      {po.submissions.length > 0 && (
        <section className="card">
          <h2>{tr("What you sent for this order")}</h2>
          <ul className="list">
            {po.submissions.map((s) => (
              <li key={s.id} className="portal-row">
                <span>
                  {s.kind === "invoice" ? `${tr("Invoice")} ${s.supplier_invoice_no ?? ""}` : tr("Delivery note")}
                  <br />
                  <span className="small muted">{formatDate(s.created_at)}</span>
                </span>
                <Badge map={SUBMISSION_STATUS} status={s.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
