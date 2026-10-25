import Link from "next/link";
import { notFound } from "next/navigation";
import { tr } from "@/lib/tr";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { call, PortalError, requireParty } from "@/lib/portal/server";
import type { OrderDetail } from "@/lib/portal/types";
import { Badge, DELIVERY_STATUS, INVOICE_STATUS, ORDER_STATUS, ProgressBar } from "../../../ui";

export const metadata = { title: "Order" };

export default async function PortalOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireParty("client");
  let o: OrderDetail;
  try {
    o = await call<OrderDetail>(ctx, "portal_order", { p_id: id });
  } catch (e) {
    if (e instanceof PortalError && e.code === "42501") notFound();
    throw e;
  }
  return (
    <>
      <p className="small">
        <Link href="/portal/orders">← {tr("Orders & deliveries")}</Link>
      </p>
      <div className="page-head">
        <h1>{o.number}</h1>
        {o.progress && <Badge map={ORDER_STATUS} status={o.progress.status} />}
      </div>

      <section className="card">
        <dl className="kv">
          {o.client_ref && (
            <>
              <dt>{tr("Your ref")}</dt>
              <dd>{o.client_ref}</dd>
            </>
          )}
          {o.decided_at && (
            <>
              <dt>{tr("Accepted")}</dt>
              <dd>{formatDate(o.decided_at)}</dd>
            </>
          )}
          {o.delivery_time && (
            <>
              <dt>{tr("Delivery")}</dt>
              <dd>{o.delivery_time}</dd>
            </>
          )}
          <dt>{tr("Total")}</dt>
          <dd>{formatMoney(o.total, o.currency)}</dd>
        </dl>
        {o.progress && (
          <>
            <h3 className="small" style={{ marginBottom: 4 }}>
              {tr("Progress")} · {o.progress.done}/{o.progress.total}
            </h3>
            <ProgressBar progress={o.progress} />
          </>
        )}
        <p style={{ margin: "12px 0 0" }}>
          <a className="btn btn-small" href={`/portal/download/quotation/${o.id}/pdf`} target="_blank" rel="noopener">
            {tr("Quotation PDF")}
          </a>
        </p>
      </section>

      <section className="card">
        <h2>{tr("Deliveries")}</h2>
        {o.deliveries.length === 0 ? (
          <p className="muted small">{tr("Nothing has left our store for this order yet.")}</p>
        ) : (
          <ul className="list">
            {o.deliveries.map((d) => (
              <li key={d.id} className="portal-delivery">
                <div className="row">
                  <strong>{d.number}</strong>
                  <Badge map={DELIVERY_STATUS} status={d.status} />
                </div>
                <dl className="kv small">
                  {d.dispatched_at && (
                    <>
                      <dt>{tr("Left our store")}</dt>
                      <dd>{formatDateTime(d.dispatched_at)}</dd>
                    </>
                  )}
                  {d.vehicle && (
                    <>
                      <dt>{tr("Vehicle")}</dt>
                      <dd>{d.vehicle}</dd>
                    </>
                  )}
                  {d.delivered_at && (
                    <>
                      <dt>{tr("Delivered")}</dt>
                      <dd>{formatDateTime(d.delivered_at)}</dd>
                    </>
                  )}
                  {d.received_by_name && (
                    <>
                      <dt>{tr("Received by")}</dt>
                      <dd>{d.received_by_name}</dd>
                    </>
                  )}
                  {d.delivery_site && (
                    <>
                      <dt>{tr("Site")}</dt>
                      <dd>{d.delivery_site}</dd>
                    </>
                  )}
                  {d.failed_reason && (
                    <>
                      <dt>{tr("Reason")}</dt>
                      <dd>{d.failed_reason}</dd>
                    </>
                  )}
                </dl>
                {d.lines && d.lines.length > 0 && (
                  <ul className="small portal-mini-lines">
                    {d.lines.map((l, i) => (
                      <li key={i}>
                        {Number(l.quantity)} {l.unit} · {l.description}
                      </li>
                    ))}
                  </ul>
                )}
                {d.pod_notes && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{d.pod_notes}</p>}
                <p className="portal-links">
                  <a href={`/portal/download/delivery/${d.id}/pdf`} target="_blank" rel="noopener">
                    {tr("Delivery note PDF")}
                  </a>
                  {d.has_signature && (
                    <a href={`/portal/download/pod_signature/${d.id}/file`} target="_blank" rel="noopener">
                      {tr("Signature on delivery")}
                    </a>
                  )}
                  {d.has_photo && (
                    <a href={`/portal/download/pod_photo/${d.id}/file`} target="_blank" rel="noopener">
                      {tr("Photo on delivery")}
                    </a>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {o.invoices.length > 0 && (
        <section className="card">
          <h2>{tr("Invoices")}</h2>
          <ul className="list">
            {o.invoices.map((i) => (
              <li key={i.id} className="portal-row">
                <span>
                  <strong>{i.number}</strong> <Badge map={INVOICE_STATUS} status={i.status} />
                  <br />
                  <span className="small muted">{i.due_date ? `${tr("Due")} ${formatDate(i.due_date)}` : ""}</span>
                </span>
                <span className="portal-links">
                  <span className="num">{formatMoney(i.total, i.currency)}</span>
                  <a href={`/portal/download/invoice/${i.id}/pdf`} target="_blank" rel="noopener">
                    PDF
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2>{tr("Items ordered")}</h2>
        <ul className="lines">
          {o.lines.map((l) => (
            <li key={l.line_no} className="row">
              <span>{l.description}</span>
              <span className="small muted">
                {Number(l.quantity)} {l.unit}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
