import { tr } from "@/lib/tr";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { call, requireParty } from "@/lib/portal/server";
import { payLinkFor } from "@/lib/portal/pay";
import type { InvoiceRow } from "@/lib/portal/types";
import { Badge, EmptyState, INVOICE_STATUS } from "../../ui";

export const metadata = { title: "Invoices" };

export default async function PortalInvoices() {
  const ctx = await requireParty("client");
  const { invoices, owed } = await call<{ invoices: InvoiceRow[]; owed: { currency: string; balance: number; overdue: number }[] }>(
    ctx,
    "portal_invoices",
  );
  const companyId = ctx.me.company.id;
  const payLinks = new Map<string, string>();
  await Promise.all(
    invoices
      .filter((i) => i.status !== "paid")
      .map(async (i) => {
        const url = await payLinkFor(i, companyId);
        if (url) payLinks.set(i.id, url);
      }),
  );
  const partyId = ctx.me.account.party_id;
  return (
    <>
      <div className="page-head">
        <h1>{tr("Invoices")}</h1>
      </div>

      <section className="card">
        <h2>{tr("Your balance")}</h2>
        {owed.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>{tr("Nothing is owed. Thank you.")}</p>
        ) : (
          <div className="stat-grid">
            {owed.map((o) => (
              <div key={o.currency} className={`stat${Number(o.overdue) > 0 ? " alert" : ""}`}>
                <span className="n">{formatMoney(o.balance, o.currency)}</span>
                <span className="l">
                  {tr("Owed")}
                  {Number(o.overdue) > 0 ? ` · ${tr("overdue")} ${formatMoney(o.overdue, o.currency)}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
        <form method="get" action={`/portal/download/statement/${partyId}/pdf`} target="_blank" className="portal-statement">
          <div className="field">
            <label htmlFor="st-from">{tr("From")}</label>
            <input id="st-from" type="date" name="from" />
          </div>
          <div className="field">
            <label htmlFor="st-to">{tr("To")}</label>
            <input id="st-to" type="date" name="to" />
          </div>
          <button type="submit" className="btn btn-small">{tr("Statement PDF")}</button>
        </form>
        <p className="hint" style={{ margin: 0 }}>{tr("Leave the dates empty for the usual period.")}</p>
      </section>

      <section className="card">
        <h2>{tr("All invoices")}</h2>
        {invoices.length === 0 ? (
          <EmptyState text="No invoices yet." />
        ) : (
          <ul className="list">
            {invoices.map((i) => {
              const overdue = (i.days_overdue ?? 0) > 0;
              const pay = payLinks.get(i.id);
              return (
                <li key={i.id}>
                  <div className="portal-row">
                    <span>
                      <strong>{i.number}</strong> <Badge map={INVOICE_STATUS} status={overdue ? "overdue" : i.status} />
                      <br />
                      <span className="small muted">
                        {i.issue_date ? formatDate(i.issue_date) : ""}
                        {i.due_date ? ` · ${tr("Due")} ${formatDate(i.due_date)}` : ""}
                        {overdue ? ` · ${i.days_overdue} ${tr("days late")}` : ""}
                        {i.client_ref ? ` · ${tr("Your ref")} ${i.client_ref}` : ""}
                        {i.quotation_number ? ` · ${i.quotation_number}` : ""}
                      </span>
                    </span>
                    <span className="portal-amount">
                      <span className="num">{formatMoney(i.total, i.currency)}</span>
                      {i.status !== "paid" && Number(i.amount_paid) > 0 && (
                        <span className="small muted">
                          {tr("Balance")} {formatMoney(i.balance, i.currency)}
                        </span>
                      )}
                    </span>
                  </div>
                  <p className="portal-links">
                    <a href={`/portal/download/invoice/${i.id}/pdf`} target="_blank" rel="noopener">
                      {tr("Invoice PDF")}
                    </a>
                    {pay && (
                      <a href={pay} className="btn btn-small btn-primary" target="_blank" rel="noopener noreferrer">
                        {tr("Pay now")}
                      </a>
                    )}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
