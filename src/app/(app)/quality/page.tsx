import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { NCR_SOURCES, NCR_STATUS } from "@/lib/hse";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { todayTz } from "@/lib/services";

export const metadata = { title: "Quality" };

type Row = { id: string; number: string; raised_on: string; source: string; title: string; status: string; cost: number; supplier: { name: string } | null; client: { name: string } | null };
type StatRow = { supplier_id: string | null; cost: number; raised_on: string; supplier: { name: string } | null };

const TABS = [
  { key: "open", label: "Open" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

export default async function QualityPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeQuality")) redirect("/");
  const tab = TABS.some((t) => t.key === sp.tab) ? String(sp.tab) : "open";
  const source = typeof sp.source === "string" && sp.source in NCR_SOURCES ? sp.source : "";

  const today = todayTz();
  const monthStart = today.slice(0, 8) + "01";
  const yearStart = today.slice(0, 4) + "-01-01";
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  const yearAgo = d.toISOString().slice(0, 10);
  const since = yearAgo < yearStart ? yearAgo : yearStart;

  let q = supabase
    .from("quality_ncrs")
    .select("id, number, raised_on, source, title, status, cost, supplier:suppliers(name), client:clients(name)")
    .eq("company_id", company.id)
    .order("raised_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(300);
  if (tab === "open") q = q.neq("status", "closed");
  if (tab === "closed") q = q.eq("status", "closed");
  if (source) q = q.eq("source", source);

  const [list, openCount, stats] = await Promise.all([
    q,
    supabase.from("quality_ncrs").select("id", { count: "exact", head: true }).eq("company_id", company.id).neq("status", "closed"),
    supabase.from("quality_ncrs").select("supplier_id, cost, raised_on, supplier:suppliers(name)").eq("company_id", company.id).gte("raised_on", since).limit(10000),
  ]);
  if (isMissingTable(list.error)) return <NotReady title="Quality" />;
  if (list.error) throw new Error(list.error.message);
  const rows = (list.data ?? []) as unknown as Row[];
  const statRows = (stats.data ?? []) as unknown as StatRow[];
  const thisMonth = statRows.filter((r) => r.raised_on >= monthStart).length;
  const costYear = statRows.filter((r) => r.raised_on >= yearStart).reduce((s, r) => s + Number(r.cost ?? 0), 0);
  const bySupplier = new Map<string, { name: string; n: number }>();
  for (const r of statRows) {
    if (!r.supplier_id || r.raised_on < yearAgo) continue;
    const cur = bySupplier.get(r.supplier_id) ?? { name: r.supplier?.name ?? "—", n: 0 };
    cur.n += 1;
    bySupplier.set(r.supplier_id, cur);
  }
  const top = [...bySupplier.entries()].sort((a, b) => b[1].n - a[1].n)[0];

  const href = (t: string, s: string) => {
    const p = new URLSearchParams();
    if (t !== "open") p.set("tab", t);
    if (s) p.set("source", s);
    const qs = p.toString();
    return qs ? `/quality?${qs}` : "/quality";
  };

  return (
    <>
      <div className="page-head">
        <h1>{tr("Quality")}</h1>
        <Link href="/quality/new" className="btn btn-primary btn-small">
          {tr("+ NCR")}
        </Link>
      </div>
      <p className="muted small">{tr("Non-conformance reports: faulty goods from suppliers, client complaints and problems found in your own work.")}</p>
      <Notice {...notice} />
      <div className="stat-grid">
        <div className={`stat ${openCount.count ? "alert" : ""}`}>
          <div className="n">{openCount.count ?? 0}</div>
          <div className="l">{tr("Open NCRs")}</div>
        </div>
        <div className="stat">
          <div className="n">{thisMonth}</div>
          <div className="l">{tr("NCRs this month")}</div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(costYear, company.base_currency)}</div>
          <div className="l">{tr("Cost of quality this year")}</div>
        </div>
        <div className="stat">
          <div className="n" style={{ fontSize: top ? "1rem" : undefined }}>
            {top ? (
              <Link href={`/suppliers/${top[0]}`}>
                {top[1].name} ({top[1].n})
              </Link>
            ) : (
              "—"
            )}
          </div>
          <div className="l">{tr("Supplier with most NCRs (12 months)")}</div>
        </div>
      </div>
      <nav className="tabs-row" aria-label={tr("Show")}>
        {TABS.map((t) => (
          <Link key={t.key} href={href(t.key, source)} aria-current={tab === t.key ? "page" : undefined}>
            {tr(t.label)}
          </Link>
        ))}
      </nav>
      <nav className="tabs-row" aria-label={tr("Source")}>
        <Link href={href(tab, "")} aria-current={!source ? "page" : undefined}>
          {tr("Any source")}
        </Link>
        {Object.entries(NCR_SOURCES).map(([k, label]) => (
          <Link key={k} href={href(tab, k)} aria-current={source === k ? "page" : undefined}>
            {tr(label)}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="card muted">{tr("No NCRs here. Raise one when goods or work are not as they should be.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/quality/${r.id}`}>
                <div className="main">
                  <div className="title">
                    {r.number} · {r.title}
                  </div>
                  <div className="sub">
                    {tr(NCR_SOURCES[r.source] ?? r.source)}
                    {r.supplier?.name && ` · ${r.supplier.name}`}
                    {r.client?.name && ` · ${r.client.name}`} · {formatDate(r.raised_on)}
                    {Number(r.cost) > 0 && ` · ${formatMoney(Number(r.cost), company.base_currency)}`}
                  </div>
                </div>
                <div className="side">
                  <StatusBadge map={NCR_STATUS} status={r.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
