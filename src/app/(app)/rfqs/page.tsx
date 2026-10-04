import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { cleanSearch, LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { RFQ_STATUS, StatusBadge, todayTz } from "@/lib/sales";

export const metadata = { title: "RFQs" };

const TABS = [
  { key: "open", label: "Open", statuses: ["new", "quoting"] },
  { key: "quoted", label: "Quoted", statuses: ["quoted"] },
  { key: "won", label: "Won", statuses: ["won"] },
  { key: "lost", label: "Lost / cancelled", statuses: ["lost", "cancelled"] },
  { key: "all", label: "All", statuses: [] as string[] },
];

type Row = {
  id: string;
  number: string;
  title: string | null;
  status: string;
  received_on: string;
  due_on: string | null;
  client: { name: string } | null;
};

export default async function RfqsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const q = cleanSearch(typeof sp.q === "string" ? sp.q : "");
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeSales")) redirect("/");

  let query = supabase
    .from("rfqs")
    .select("id, number, title, status, received_on, due_on, client:clients(name)", { count: "exact" })
    .eq("company_id", company.id)
    .order("due_on", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (tab.statuses.length) query = query.in("status", tab.statuses);
  if (q) query = query.or(`number.ilike.%${q}%,title.ilike.%${q}%,client_ref.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const today = todayTz();

  return (
    <>
      <p className="small">
        <Link href="/sales">{tr("← Sales")}</Link>
      </p>
      <div className="page-head">
        <h1>{tr("Client RFQs")}</h1>
        {can(role, "editSales") && (
          <Link href="/rfqs/new" className="btn btn-primary btn-small">{tr("+ New RFQ")}</Link>
        )}
      </div>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Filter")}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/rfqs?tab=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined}>
            {tr(String(t.label ?? ""))}
          </Link>
        ))}
      </nav>
      <form method="get" className="toolbar-row" style={{ marginBottom: 12 }}>
        <input type="hidden" name="tab" value={tab.key} />
        <input type="search" name="q" defaultValue={q} placeholder={tr("Search number, title, client ref…")} />
        <button className="btn" type="submit">{tr("Search")}</button>
      </form>
      {rows.length === 0 ? (
        <p className="card muted">{tr("No RFQs here.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const overdue = r.due_on && r.due_on < today && ["new", "quoting"].includes(r.status);
            return (
              <li key={r.id}>
                <Link href={`/rfqs/${r.id}`}>
                  <div className="main">
                    <div className="title">{r.client?.name ?? tr("Client")}</div>
                    <div className="sub">
                      {r.number}
                      {r.title ? ` · ${r.title}` : ""}
                    </div>
                  </div>
                  <div className="side">
                    <StatusBadge map={RFQ_STATUS} status={r.status} />
                    {r.due_on && (
                      <div className={`small ${overdue ? "text-warn" : "muted"}`}>
                        {overdue ? tr("Overdue · ") : tr("Due ")}
                        {formatDate(r.due_on)}
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {(count ?? 0) > LIST_LIMIT && <p className="muted small">{tr("Showing the first")}{" "}{LIST_LIMIT}.</p>}
    </>
  );
}
