import Link from "next/link";
import { tr } from "@/lib/tr";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { call, requireParty } from "@/lib/portal/server";
import type { DeliveryRow, OrderRow } from "@/lib/portal/types";
import { Badge, DELIVERY_STATUS, EmptyState, ORDER_STATUS, ProgressBar, stageWord } from "../../ui";

export const metadata = { title: "Orders" };

export default async function PortalOrders() {
  const ctx = await requireParty("client");
  const { orders, deliveries } = await call<{ orders: OrderRow[]; deliveries: DeliveryRow[] }>(ctx, "portal_orders");
  const moving = deliveries.filter((d) => d.status === "dispatched");
  return (
    <>
      <div className="page-head">
        <h1>{tr("Orders & deliveries")}</h1>
      </div>

      {moving.length > 0 && (
        <section className="card">
          <h2>{tr("On the way")}</h2>
          <DeliveryList rows={moving} />
        </section>
      )}

      <section className="card">
        <h2>{tr("Your orders")}</h2>
        {orders.length === 0 ? (
          <EmptyState text="When you accept a quotation, the order shows here with its progress." />
        ) : (
          <ul className="list">
            {orders.map((o) => (
              <li key={o.id}>
                <Link href={`/portal/orders/${o.id}`} className="portal-row">
                  <span>
                    <strong>{o.number}</strong>
                    {o.client_ref && <span className="small muted"> · {tr("Your ref")} {o.client_ref}</span>}
                    <br />
                    {o.progress && <Badge map={ORDER_STATUS} status={o.progress.status} />}
                    {o.progress?.next && o.progress.status === "in_progress" && (
                      <span className="small muted">
                        {" "}
                        {tr("Next")}: {tr(stageWord(o.progress.next))}
                      </span>
                    )}
                  </span>
                  <span className="num">{formatMoney(o.total, o.currency)}</span>
                </Link>
                {o.progress?.status === "in_progress" && <ProgressBar progress={o.progress} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      {deliveries.length > moving.length && (
        <section className="card">
          <h2>{tr("Deliveries")}</h2>
          <DeliveryList rows={deliveries.filter((d) => d.status !== "dispatched")} />
        </section>
      )}
    </>
  );
}

function DeliveryList({ rows }: { rows: DeliveryRow[] }) {
  return (
    <ul className="list">
      {rows.map((d) => (
        <li key={d.id}>
          <div className="portal-row">
            <span>
              <strong>{d.number}</strong> <Badge map={DELIVERY_STATUS} status={d.status} />
              <br />
              <span className="small muted">
                {d.status === "delivered" && d.delivered_at
                  ? `${tr("Delivered")} ${formatDate(d.delivered_at)}${d.received_by_name ? ` · ${tr("Received by")} ${d.received_by_name}` : ""}`
                  : d.status === "dispatched" && d.dispatched_at
                    ? `${tr("Left our store")} ${formatDate(d.dispatched_at)}`
                    : d.planned_date
                      ? `${tr("Planned")} ${formatDate(d.planned_date)}`
                      : ""}
                {d.delivery_site ? ` · ${d.delivery_site}` : ""}
              </span>
            </span>
            <span className="portal-links">
              {d.quotation_id && <Link href={`/portal/orders/${d.quotation_id}`}>{tr("Order")}</Link>}
              <a href={`/portal/download/delivery/${d.id}/pdf`} target="_blank" rel="noopener">
                {tr("Delivery note")}
              </a>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
