import Link from "next/link";
import { tr } from "@/lib/tr";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { call, requireParty } from "@/lib/portal/server";
import type { PoRow } from "@/lib/portal/types";
import { Badge, EmptyState, PO_STATUS } from "../../ui";

export const metadata = { title: "Purchase orders" };

export default async function PortalPurchaseOrders() {
  const ctx = await requireParty("supplier");
  const rows = await call<PoRow[]>(ctx, "portal_purchase_orders");
  return (
    <>
      <div className="page-head">
        <h1>{tr("Purchase orders")}</h1>
      </div>
      <section className="card">
        {rows.length === 0 ? (
          <EmptyState text="No purchase orders yet." />
        ) : (
          <ul className="list">
            {rows.map((p) => (
              <li key={p.id}>
                <Link href={`/portal/purchase-orders/${p.id}`} className="portal-row">
                  <span>
                    <strong>{p.number}</strong>
                    <span className="small muted"> · {formatDate(p.order_date)}</span>
                    <br />
                    <Badge map={PO_STATUS} status={p.status} />
                    {p.expected_date && <span className="small muted"> {tr("Expected")} {formatDate(p.expected_date)}</span>}
                  </span>
                  <span className="num">{formatMoney(p.total, p.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
