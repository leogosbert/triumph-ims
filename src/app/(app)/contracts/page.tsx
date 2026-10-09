import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { contractKindLabel, daysUntil, isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";

export const metadata = { title: "Contracts" };

type Row = {
  id: string;
  number: string;
  title: string;
  kind: string;
  start_date: string;
  end_date: string;
  currency: string;
  value_cap: number | null;
  remind_days: number;
  cancelled_at: string | null;
  client: { name: string } | null;
  prices: { count: number }[];
};

export default async function ContractsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeContracts")) redirect("/");
  const view = sp.view === "ended" ? "ended" : "current";
  const { data, error } = await supabase
    .from("contracts")
    .select("id, number, title, kind, start_date, end_date, currency, value_cap, remind_days, cancelled_at, client:clients(name), prices:contract_prices(count)")
    .eq("company_id", company.id)
    .order("end_date")
    .limit(2000);
  if (isMissingTable(error)) return <NotReady title="Contracts" />;
  if (error) throw new Error(error.message);
  const all = (data ?? []) as unknown as Row[];
  const isCurrent = (r: Row) => !r.cancelled_at && (daysUntil(r.end_date) ?? 0) >= 0;
  const current = all.filter(isCurrent);
  const ended = all.filter((r) => !isCurrent(r)).reverse();
  const rows = view === "current" ? current : ended;
  const ending = current.filter((r) => (daysUntil(r.end_date) ?? 999) <= r.remind_days);

  return (
    <>
      {can(role, "seeCrm") && (
        <p className="small">
          <Link href="/crm">{tr("← Pipeline")}</Link>
        </p>
      )}
      <div className="page-head">
        <h1>{tr("Contracts")}</h1>
        {can(role, "seeCrm") && (
          <Link href="/contracts/new" className="btn btn-primary btn-small">
            {tr("+ Contract")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("Framework agreements and supply contracts with agreed prices. Quotations for the client can use these prices in one tap.")}</p>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/contracts" aria-current={view === "current" ? "page" : undefined}>
          {tr("Current")} ({current.length})
        </Link>
        <Link href="/contracts?view=ended" aria-current={view === "ended" ? "page" : undefined}>
          {tr("Ended")} ({ended.length})
        </Link>
      </nav>
      {view === "current" && ending.length > 0 && (
        <div className="banner warn small">
          {ending.length} {tr("contract(s) ending soon: time to agree the renewal.")}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="card muted">{view === "current" ? tr("No current contracts.") : tr("No ended contracts.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const left = daysUntil(r.end_date) ?? 0;
            return (
              <li key={r.id}>
                <Link href={`/contracts/${r.id}`}>
                  <div className="main">
                    <div className="title">{r.client?.name}</div>
                    <div className="sub">
                      {r.title} · {tr(contractKindLabel(r.kind))}
                    </div>
                    <div className="sub">
                      {formatDate(r.start_date)} – {formatDate(r.end_date)} · {r.prices?.[0]?.count ?? 0} {tr("prices")}
                    </div>
                  </div>
                  <div className="side">
                    {r.value_cap !== null && <div>{formatMoney(r.value_cap, r.currency)}</div>}
                    <div className={`small${!r.cancelled_at && left <= r.remind_days && left >= 0 ? " text-warn" : " muted"}`}>
                      {r.cancelled_at ? tr("Ended early") : left < 0 ? tr("Ended") : `${left} ${tr("days left")}`}
                    </div>
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
