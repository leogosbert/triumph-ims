import Link from "next/link";
import { notFound } from "next/navigation";
import { tr } from "@/lib/tr";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { call, PortalError, requireParty } from "@/lib/portal/server";
import type { RfqDetail } from "@/lib/portal/types";
import { Badge, RFQ_STATUS, rfqState } from "../../../ui";
import { AnswerRfq } from "../../../_c/AnswerRfq";

export const metadata = { title: "Request for prices" };

export default async function PortalRfq({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await requireParty("supplier");
  let r: RfqDetail;
  try {
    r = await call<RfqDetail>(ctx, "portal_rfq", { p_id: id });
  } catch (e) {
    if (e instanceof PortalError && e.code === "42501") notFound();
    throw e;
  }
  const ccy = r.currency || ctx.me.company.base_currency;
  return (
    <>
      <p className="small">
        <Link href="/portal/rfqs">← {tr("Requests for prices")}</Link>
      </p>
      <div className="page-head">
        <h1>
          {r.number}
          {r.title ? ` · ${r.title}` : ""}
        </h1>
        <Badge map={RFQ_STATUS} status={rfqState(r)} />
      </div>
      <section className="card">
        <dl className="kv">
          {r.due_on && (
            <>
              <dt>{tr("Answer by")}</dt>
              <dd>{formatDate(r.due_on)}</dd>
            </>
          )}
          {r.delivery_location && (
            <>
              <dt>{tr("Deliver to")}</dt>
              <dd>{r.delivery_location}</dd>
            </>
          )}
          {r.received_on && (
            <>
              <dt>{tr("You answered")}</dt>
              <dd>{formatDate(r.received_on)}</dd>
            </>
          )}
        </dl>
        {r.notes && <p className="small" style={{ whiteSpace: "pre-wrap" }}>{r.notes}</p>}
      </section>

      {r.can_answer ? (
        <section className="card">
          <h2>{r.status === "quoted" ? tr("Update your prices") : tr("Your prices")}</h2>
          <AnswerRfq rfq={r} currency={ccy} />
        </section>
      ) : (
        <section className="card">
          <h2>{tr("Your answer")}</h2>
          {r.awarded_to_you && <p className="notice notice-ok">{tr("You won this request. A purchase order follows.")}</p>}
          {r.rfq_status !== "open" && !r.awarded_to_you && <p className="muted small">{tr("This request is closed.")}</p>}
          <ul className="lines">
            {r.lines.map((l) => (
              <li key={l.id}>
                <div className="row">
                  <span>{l.description}</span>
                  <span className="num">{l.unit_price != null ? formatMoney(l.unit_price, ccy) : "—"}</span>
                </div>
                <div className="small muted">
                  {Number(l.quantity)} {l.unit}
                  {l.notes ? ` · ${l.notes}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {r.files.length > 0 && (
        <section className="card">
          <h2>{tr("Your attachments")}</h2>
          <ul className="list">
            {r.files.map((f) => (
              <li key={f.id} className="portal-row">
                <span>{f.file_name}</span>
                <a href={`/portal/download/file/${f.id}/file`} target="_blank" rel="noopener">
                  {tr("Open")}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
