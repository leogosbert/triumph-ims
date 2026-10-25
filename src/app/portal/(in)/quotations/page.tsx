import Link from "next/link";
import { tr } from "@/lib/tr";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { call, requireParty } from "@/lib/portal/server";
import type { QuoteRow } from "@/lib/portal/types";
import { Badge, EmptyState, QUOTE_STATUS } from "../../ui";

export const metadata = { title: "Quotations" };

export default async function PortalQuotations() {
  const ctx = await requireParty("client");
  const rows = await call<QuoteRow[]>(ctx, "portal_quotations");
  const open = rows.filter((q) => q.status === "sent" && !q.expired);
  const rest = rows.filter((q) => !(q.status === "sent" && !q.expired));
  return (
    <>
      <div className="page-head">
        <h1>{tr("Quotations")}</h1>
      </div>
      {rows.length === 0 && <EmptyState text="No quotations yet." />}
      {open.length > 0 && (
        <section className="card">
          <h2>{tr("Waiting for your answer")}</h2>
          <QuoteList rows={open} />
        </section>
      )}
      {rest.length > 0 && (
        <section className="card">
          <h2>{tr("Earlier quotations")}</h2>
          <QuoteList rows={rest} />
        </section>
      )}
    </>
  );
}

function QuoteList({ rows }: { rows: QuoteRow[] }) {
  return (
    <ul className="list">
      {rows.map((q) => (
        <li key={q.id}>
          <Link href={`/portal/quotations/${q.id}`} className="portal-row">
            <span>
              <strong>{q.number}</strong>
              <span className="small muted">
                {" "}
                · {formatDate(q.issue_date)}
                {q.client_ref ? ` · ${tr("Your ref")} ${q.client_ref}` : ""}
              </span>
              <br />
              {q.status === "sent" && q.expired ? (
                <span className="badge tone-off">{tr("Expired")}</span>
              ) : (
                <Badge map={QUOTE_STATUS} status={q.status} />
              )}
              {q.status === "sent" && !q.expired && q.valid_until && (
                <span className="small muted"> {tr("Valid until")} {formatDate(q.valid_until)}</span>
              )}
            </span>
            <span className="num">{formatMoney(q.total, q.currency)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
