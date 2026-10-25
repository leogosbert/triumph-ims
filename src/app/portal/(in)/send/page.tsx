import { tr } from "@/lib/tr";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { call, requireParty } from "@/lib/portal/server";
import type { PoRow, Submission } from "@/lib/portal/types";
import { Badge, EmptyState, SUBMISSION_STATUS } from "../../ui";
import { SubmitDoc } from "../../_c/SubmitDoc";

export const metadata = { title: "Invoices & delivery notes" };

/** The supplier sends delivery notes and invoices. Invoices become draft bills only after finance checks them. */
export default async function PortalSend({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireParty("supplier");
  const [subs, pos] = await Promise.all([call<Submission[]>(ctx, "portal_submissions_list"), call<PoRow[]>(ctx, "portal_purchase_orders")]);
  const orders = pos.filter((p) => p.status !== "sent").map((p) => ({ id: p.id, number: p.number, currency: p.currency }));
  const po = typeof sp.po === "string" && orders.some((o) => o.id === sp.po) ? sp.po : "";
  return (
    <>
      <div className="page-head">
        <h1>{tr("Invoices & delivery notes")}</h1>
      </div>
      <section className="card">
        <h2>{tr("Send a document")}</h2>
        <SubmitDoc orders={orders} defaultPo={po} currency={ctx.me.company.base_currency} />
      </section>
      <section className="card">
        <h2>{tr("What you sent")}</h2>
        {subs.length === 0 ? (
          <EmptyState text="Nothing sent yet." />
        ) : (
          <ul className="list">
            {subs.map((s) => (
              <li key={s.id}>
                <div className="portal-row">
                  <span>
                    <strong>{s.kind === "invoice" ? `${tr("Invoice")} ${s.supplier_invoice_no ?? ""}` : `${tr("Delivery note")} ${s.reference ?? ""}`}</strong>
                    <br />
                    <span className="small muted">
                      {s.doc_date ? formatDate(s.doc_date) : formatDate(s.created_at)}
                      {s.po_number ? ` · ${s.po_number}` : ""}
                    </span>
                  </span>
                  <span className="portal-amount">
                    <Badge map={SUBMISSION_STATUS} status={s.status} />
                    {s.kind === "invoice" && <span className="num small">{formatMoney(s.total, s.currency)}</span>}
                  </span>
                </div>
                {s.status === "rejected" && s.review_note && (
                  <p className="small notice notice-error" style={{ margin: "6px 0 0" }}>
                    {s.review_note}
                  </p>
                )}
                {s.files && s.files.length > 0 && (
                  <p className="portal-links small">
                    {s.files.map((f) => (
                      <a key={f.id} href={`/portal/download/file/${f.id}/file`} target="_blank" rel="noopener">
                        {f.file_name}
                      </a>
                    ))}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="small" style={{ margin: "12px 0 0" }}>
          <a href={`/portal/download/statement/${ctx.me.account.party_id}/pdf`} target="_blank" rel="noopener">
            {tr("Statement of account (PDF)")}
          </a>
        </p>
      </section>
    </>
  );
}
