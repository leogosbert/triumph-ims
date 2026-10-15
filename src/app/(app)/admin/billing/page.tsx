import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { LevelBadge } from "@/components/suggestions/SuggestionBadge";
import { ACCOUNT_STATUS, BILLING_MISSING, loadPriceBook, planFor, priceOf, type AccountStatus } from "@/lib/billing";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { isMissingSql } from "@/components/suggestions/meta";
import { platformAdmin } from "../guard";

export const metadata = { title: "Billing & services" };

type Row = {
  company_id: string;
  company_name: string;
  business_level: string;
  members: number;
  status: AccountStatus;
  currency: "TZS" | "USD";
  cycle: string;
  discount_pct: number;
  founding: boolean;
  trial_ends_on: string | null;
  next_invoice_on: string | null;
  open_invoices: number;
  overdue_invoices: number;
  balance: number;
  paid_this_month: number;
  waiting_requests: number;
};

/** Every paying (or trial) company: status, what is owed, and the plan value per month. */
export default async function AdminBillingPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const notice = await readNotice(searchParams);
  const [{ data, error }, book] = await Promise.all([admin.supabase.rpc("platform_billing_overview"), loadPriceBook(admin.supabase)]);
  if (error) {
    return <p className="card muted">{isMissingSql(error) ? tr(BILLING_MISSING) : tr("Could not load billing.")}</p>;
  }
  const rows = (data ?? []) as Row[];
  // Plan value in TZS (the main currency) for the monthly recurring total.
  const planTzs = (level: string) => {
    const p = planFor(book.items, level);
    return p ? (priceOf(p, "TZS") ?? 0) : 0;
  };
  const paying = rows.filter((r) => r.status === "active" || r.status === "grace");
  const mrr = paying.reduce((a, r) => a + planTzs(r.business_level) * (1 - Number(r.discount_pct) / 100), 0);
  const owedTzs = rows.filter((r) => r.currency === "TZS").reduce((a, r) => a + Number(r.balance), 0);
  const owedUsd = rows.filter((r) => r.currency === "USD").reduce((a, r) => a + Number(r.balance), 0);
  const paidTzs = rows.filter((r) => r.currency === "TZS").reduce((a, r) => a + Number(r.paid_this_month), 0);
  const overdue = rows.filter((r) => Number(r.overdue_invoices) > 0).length;
  const trials = rows.filter((r) => r.status === "trial").length;

  return (
    <>
      <Notice {...notice} />
      <section className="card">
        <h2>{tr("At a glance")}</h2>
        <div className="bl-plan">
          <div className="bl-stat">
            <span>{tr("Monthly plan value (paying companies)")}</span>
            <strong>{formatMoney(mrr, "TZS")}</strong>
          </div>
          <div className="bl-stat">
            <span>{tr("Paid this month")}</span>
            <strong>{formatMoney(paidTzs, "TZS")}</strong>
          </div>
          <div className="bl-stat">
            <span>{tr("Still owed")}</span>
            <strong>
              {formatMoney(owedTzs, "TZS")}
              {owedUsd > 0 && ` · ${formatMoney(owedUsd, "USD")}`}
            </strong>
          </div>
          <div className="bl-stat">
            <span>{tr("Companies with overdue invoices")}</span>
            <strong>{overdue}</strong>
          </div>
          <div className="bl-stat">
            <span>{tr("On free trial")}</span>
            <strong>{trials}</strong>
          </div>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          {tr("Only LeMo Tech's own billing is shown here: never a company's customers, prices or documents.")}
        </p>
      </section>

      <section className="card">
        <h2>{tr("Companies")}</h2>
        {rows.length === 0 ? (
          <p className="muted">{tr("No companies yet.")}</p>
        ) : (
          <div className="bl-wrap">
            <table className="bl-table">
              <thead>
                <tr>
                  <th>{tr("Company")}</th>
                  <th>{tr("Account")}</th>
                  <th className="num">{tr("People")}</th>
                  <th className="num">{tr("Still owed")}</th>
                  <th>{tr("Next invoice")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = ACCOUNT_STATUS[r.status] ?? ACCOUNT_STATUS.trial;
                  return (
                    <tr key={r.company_id}>
                      <td>
                        <Link href={`/admin/billing/${r.company_id}`}>
                          <strong>{r.company_name}</strong>
                        </Link>{" "}
                        <LevelBadge level={r.business_level} />
                        {Number(r.waiting_requests) > 0 && (
                          <div className="small">
                            <span className="badge tone-warn">
                              {r.waiting_requests} {tr("waiting requests")}
                            </span>
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`badge tone-${st.tone}`}>{tr(st.label)}</span>
                        {r.founding && <div className="small muted">{tr("Founding client")}</div>}
                      </td>
                      <td className="num">{r.members}</td>
                      <td className="num">
                        {formatMoney(r.balance, r.currency)}
                        {Number(r.overdue_invoices) > 0 && (
                          <div className="small">
                            <span className="badge tone-bad">
                              {r.overdue_invoices} {tr("overdue")}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="small">{r.next_invoice_on ? formatDate(r.next_invoice_on) : r.trial_ends_on ? `${tr("Trial ends")} ${formatDate(r.trial_ends_on)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
