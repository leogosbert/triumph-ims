import Link from "next/link";
import { tr } from "@/lib/tr";
import { formatDate } from "@/lib/format";
import { call, requireParty } from "@/lib/portal/server";
import type { RfqRow } from "@/lib/portal/types";
import { Badge, EmptyState, RFQ_STATUS, rfqState } from "../../ui";

export const metadata = { title: "Requests for prices" };

export default async function PortalRfqs() {
  const ctx = await requireParty("supplier");
  const rows = await call<RfqRow[]>(ctx, "portal_rfqs");
  return (
    <>
      <div className="page-head">
        <h1>{tr("Requests for prices")}</h1>
      </div>
      <section className="card">
        {rows.length === 0 ? (
          <EmptyState text="No requests for prices yet." />
        ) : (
          <ul className="list">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/portal/rfqs/${r.id}`} className="portal-row">
                  <span>
                    <strong>{r.number}</strong>
                    {r.title && <span> · {r.title}</span>}
                    <br />
                    <Badge map={RFQ_STATUS} status={rfqState(r)} />
                    <span className="small muted">
                      {" "}
                      {r.lines} {tr("items")}
                      {r.due_on && r.rfq_status === "open" ? ` · ${tr("Answer by")} ${formatDate(r.due_on)}` : ""}
                    </span>
                  </span>
                  <span aria-hidden="true">›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
