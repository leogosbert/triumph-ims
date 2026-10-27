import Link from "next/link";
import { notFound } from "next/navigation";
import { tr } from "@/lib/tr";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { call, PortalError, requireParty } from "@/lib/portal/server";
import type { QuoteDetail } from "@/lib/portal/types";
import { Badge, QUOTE_STATUS } from "../../../ui";
import { DecideQuote } from "../../../_c/DecideQuote";

export const metadata = { title: "Quotation" };

export default async function PortalQuotation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireParty("client");
  let q: QuoteDetail;
  try {
    q = await call<QuoteDetail>(ctx, "portal_quotation", { p_id: id });
  } catch (e) {
    if (e instanceof PortalError && e.code === "42501") notFound();
    throw e;
  }
  const d = q.decision;
  return (
    <>
      <p className="small">
        <Link href="/portal/quotations">← {tr("Quotations")}</Link>
      </p>
      <div className="page-head">
        <h1>{q.number}</h1>
        {q.expired ? <span className="badge tone-off">{tr("Expired")}</span> : <Badge map={QUOTE_STATUS} status={q.status} />}
      </div>

      <section className="card">
        <dl className="kv">
          <dt>{tr("Date")}</dt>
          <dd>{formatDate(q.issue_date)}</dd>
          {q.valid_until && (
            <>
              <dt>{tr("Valid until")}</dt>
              <dd>{formatDate(q.valid_until)}</dd>
            </>
          )}
          {q.client_ref && (
            <>
              <dt>{tr("Your ref")}</dt>
              <dd>{q.client_ref}</dd>
            </>
          )}
          {q.delivery_time && (
            <>
              <dt>{tr("Delivery")}</dt>
              <dd>{q.delivery_time}</dd>
            </>
          )}
          {q.payment_terms && (
            <>
              <dt>{tr("Payment terms")}</dt>
              <dd>{q.payment_terms}</dd>
            </>
          )}
          {q.incoterms && (
            <>
              <dt>{tr("Incoterms")}</dt>
              <dd>{q.incoterms}</dd>
            </>
          )}
        </dl>
        <p style={{ margin: "12px 0 0" }}>
          <a className="btn btn-small" href={`/portal/download/quotation/${q.id}/pdf`} target="_blank" rel="noopener">
            {tr("Download PDF")}
          </a>
        </p>
      </section>

      <section className="card">
        <h2>{tr("Items")}</h2>
        <ul className="lines">
          {q.lines.map((l) => (
            <li key={l.line_no}>
              <div className="row">
                <span>{l.description}</span>
                <span className="num">{formatMoney(l.line_total, q.currency)}</span>
              </div>
              <div className="small muted">
                {Number(l.quantity)} {l.unit} × {formatMoney(l.unit_price, q.currency)}
                {Number(l.discount_pct) > 0 ? ` · −${Number(l.discount_pct)}%` : ""}
              </div>
            </li>
          ))}
        </ul>
        <div className="totals">
          <div className="row">
            <span>{tr("Subtotal")}</span>
            <span className="num">{formatMoney(q.subtotal, q.currency)}</span>
          </div>
          {Number(q.discount_total) > 0 && (
            <div className="row">
              <span>{tr("Discount")}</span>
              <span className="num">−{formatMoney(q.discount_total, q.currency)}</span>
            </div>
          )}
          <div className="row">
            <span>
              {tr("VAT")} {Number(q.vat_rate)}%
            </span>
            <span className="num">{formatMoney(q.vat_amount, q.currency)}</span>
          </div>
          <div className="row grand">
            <span>{tr("Total")}</span>
            <span className="num">{formatMoney(q.total, q.currency)}</span>
          </div>
        </div>
        {q.notes && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{q.notes}</p>}
        {q.terms && (
          <details className="small">
            <summary>{tr("Terms and conditions")}</summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{q.terms}</p>
          </details>
        )}
      </section>

      {d && (
        <section className="card">
          <h2>{d.decision === "accepted" ? tr("Accepted") : tr("Declined")}</h2>
          <p className="small" style={{ margin: 0 }}>
            {d.signer_name}
            {d.signer_position ? `, ${d.signer_position}` : ""} · {formatDateTime(d.created_at)}
          </p>
          {d.client_po_ref && (
            <p className="small">
              {tr("Your order reference")}: {d.client_po_ref}
            </p>
          )}
          {d.reason && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{d.reason}</p>}
          {d.signature_kind === "typed" && d.signature_text && <p className="portal-typed-sig">{d.signature_text}</p>}
          {d.signature_kind === "drawn" && d.signature_image?.startsWith("data:image/png;base64,") && (
            <img src={d.signature_image} alt={tr("Signature")} className="portal-sig-img" />
          )}
        </section>
      )}

      {q.can_decide && (
        <section className="card" id="answer">
          <h2>{tr("Your answer")}</h2>
          <DecideQuote id={q.id} defaultName={ctx.me.account.name} defaultPosition={ctx.me.account.position ?? ""} />
        </section>
      )}
      {q.status === "sent" && q.expired && (
        <p className="notice notice-error">{tr("This quotation has expired. Ask us for an updated one.")}</p>
      )}
    </>
  );
}
