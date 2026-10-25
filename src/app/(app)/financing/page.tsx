import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FeatureOff } from "@/components/growth-tools/FeatureOff";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { FIN_STATUS } from "@/lib/growth-tools/financing";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";

export const metadata = { title: "LPO financing" };

type Row = {
  id: string;
  number: string;
  status: string;
  bank_name: string;
  amount: number;
  approved_amount: number | null;
  currency: string;
  lpo_number: string | null;
  repayment_due: string | null;
  submitted_on: string | null;
  created_at: string;
  client: { name: string } | null;
};

const OPEN = ["draft", "submitted", "approved", "disbursed"];

export default async function FinancingPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role, features, isManager } = await getAppContext();
  if (!can(role, "seeFinance")) redirect("/");
  if (!features.on("lpo_financing")) return <FeatureOff title="LPO financing" isManager={isManager} />;
  const view = sp.view === "closed" ? "closed" : "open";
  const { data, error } = await supabase
    .from("financing_requests")
    .select("id, number, status, bank_name, amount, approved_amount, currency, lpo_number, repayment_due, submitted_on, created_at, client:clients(name)")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (isMissingTable(error)) return <NotReady title="LPO financing" />;
  if (error) throw new Error(error.message);
  // Reminders for repayments due and banks that have not answered (also run by the hourly job).
  await supabase.rpc("financing_run_alerts", { p_company: company.id });
  const all = (data ?? []) as unknown as Row[];
  const rows = all.filter((r) => (view === "open" ? OPEN.includes(r.status) : !OPEN.includes(r.status)));
  const today = todayTz();
  const soon = new Date(Date.parse(`${today}T12:00:00Z`) + 14 * 86400000).toISOString().slice(0, 10);
  const owed = all.filter((r) => r.status === "disbursed");
  const dueSoon = owed.filter((r) => r.repayment_due && r.repayment_due <= soon).length;
  const owedByCcy = new Map<string, number>();
  for (const r of owed) owedByCcy.set(r.currency, (owedByCcy.get(r.currency) ?? 0) + Number(r.approved_amount ?? r.amount));

  return (
    <>
      <p className="small">
        <Link href="/finance">{tr("← Finance")}</Link>
      </p>
      <div className="page-head">
        <h1>{tr("LPO financing")}</h1>
        <Link href="/financing/new" className="btn btn-primary btn-small">
          {tr("+ Request")}
        </Link>
      </div>
      <p className="muted small">{tr("A bank-ready pack for each client order (LPO), and the request tracked until the loan is repaid.")}</p>
      <Notice {...notice} />
      <div className="stat-grid">
        <div className="stat">
          <div className="n">{all.filter((r) => r.status === "submitted").length}</div>
          <div className="l">{tr("With the bank")}</div>
        </div>
        <div className="stat">
          <div className="n">{all.filter((r) => r.status === "approved").length}</div>
          <div className="l">{tr("Approved, not received")}</div>
        </div>
        <div className="stat">
          <div className="n">{owedByCcy.size ? Array.from(owedByCcy).map(([c, v]) => formatMoney(v, c)).join(" + ") : "—"}</div>
          <div className="l">{tr("Owed to banks")}</div>
        </div>
        <div className="stat">
          <div className={`n${dueSoon ? " text-warn" : ""}`}>{dueSoon}</div>
          <div className="l">{tr("Repayments due within 14 days")}</div>
        </div>
      </div>
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/financing" aria-current={view === "open" ? "page" : undefined}>
          {tr("Open")} ({all.filter((r) => OPEN.includes(r.status)).length})
        </Link>
        <Link href="/financing?view=closed" aria-current={view === "closed" ? "page" : undefined}>
          {tr("Closed")} ({all.filter((r) => !OPEN.includes(r.status)).length})
        </Link>
      </nav>
      {rows.length === 0 ? (
        <p className="card muted">
          {view === "open" ? tr("No requests yet. Start from an accepted quotation (the client's order) with “Finance this LPO”, or tap “+ Request”.") : tr("Nothing closed yet.")}
        </p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const late = r.status === "disbursed" && r.repayment_due && r.repayment_due < today;
            return (
              <li key={r.id}>
                <Link href={`/financing/${r.id}`}>
                  <div className="main">
                    <div className="title">{r.client?.name ?? ""}</div>
                    <div className="sub">
                      {r.number} · {r.bank_name}
                      {r.lpo_number && ` · LPO ${r.lpo_number}`}
                    </div>
                    {r.status === "disbursed" && r.repayment_due && (
                      <div className={`sub${late ? " text-warn" : ""}`}>
                        {tr("Repay by")} {formatDate(r.repayment_due)}
                      </div>
                    )}
                    {r.status === "submitted" && r.submitted_on && (
                      <div className="sub">
                        {tr("Submitted")} {formatDate(r.submitted_on)}
                      </div>
                    )}
                  </div>
                  <div className="side">
                    <StatusBadge map={FIN_STATUS} status={r.status} />
                    <div className="small">{formatMoney(Number(r.approved_amount ?? r.amount), r.currency)}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
