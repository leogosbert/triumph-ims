import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext, noAccess } from "@/lib/context";
import { contractKindLabel, daysUntil, isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { BackLink } from "@/components/BackLink";
import { FilterChips } from "@/components/lists/FilterChips";
import { ListSort } from "@/components/lists/ListSort";
import { readSort, sortLinks, sortRows, type SortOption } from "@/lib/list-view";

export const metadata = { title: "Contracts" };

// Contracts are all loaded at once, so these sort the loaded rows.
const SORTS: SortOption[] = [
  { key: "end", label: "End date", dir: "asc" },
  { key: "client", label: "Client", dir: "asc" },
  { key: "value", label: "Value", dir: "desc" },
  { key: "start", label: "Start date", dir: "desc" },
];

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
  const { supabase, company, roles } = await getAppContext();
  if (!can(roles, "seeContracts")) noAccess();
  const view = sp.view === "ended" ? "ended" : sp.view === "ending" ? "ending" : "current";
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
  const ending = current.filter((r) => (daysUntil(r.end_date) ?? 999) <= r.remind_days);
  const shown = view === "current" ? current : view === "ending" ? ending : ended;
  const sort = readSort(sp, SORTS, "end");
  const get: Record<string, (r: Row) => string | number | null> = {
    end: (r) => r.end_date,
    client: (r) => r.client?.name ?? null,
    value: (r) => (r.value_cap === null ? null : Number(r.value_cap)),
    start: (r) => r.start_date,
  };
  // Ended contracts keep their latest-first order until the person picks a sort.
  const rows = sort.explicit ? sortRows(shown, get[sort.key], sort.dir) : shown;

  return (
    <>
      {can(roles, "seeCrm") && (
        <BackLink href="/crm" label="Pipeline" />
      )}
      <div className="page-head">
        <h1>{tr("Contracts")}</h1>
        {can(roles, "seeCrm") && (
          <Link href="/contracts/new" className="btn btn-primary btn-small">
            {tr("+ Contract")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("Framework agreements and supply contracts with agreed prices. Quotations for the client can use these prices in one tap.")}</p>
      <Notice {...notice} />
      <FilterChips
        list="contracts"
        label="Show"
        current={view}
        explicit={typeof sp.view === "string"}
        chips={[
          { key: "current", label: `${tr("Current")} (${current.length})`, href: "/contracts" },
          ...(ending.length ? [{ key: "ending", label: `${tr("Ending soon")} (${ending.length})`, href: "/contracts?view=ending" }] : []),
          { key: "ended", label: `${tr("Ended")} (${ended.length})`, href: "/contracts?view=ended" },
        ]}
      />
      {rows.length > 1 && <ListSort links={sortLinks("/contracts", sp, SORTS, sort)} />}
      {view === "current" && ending.length > 0 && (
        <div className="banner warn small">
          {ending.length} {tr("contract(s) ending soon: time to agree the renewal.")}
        </div>
      )}
      {rows.length === 0 ? (
        <p className="card muted">{view === "ended" ? tr("No ended contracts.") : tr("No current contracts.")}</p>
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
