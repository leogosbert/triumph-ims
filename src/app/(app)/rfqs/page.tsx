import { EmptyState } from "@/components/EmptyState";
import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { getAppContext, noAccess } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { cleanSearch, LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { RFQ_STATUS, StatusBadge, todayTz } from "@/lib/sales";
import { BackLink } from "@/components/BackLink";
import { FilterChips } from "@/components/lists/FilterChips";
import { ListSort } from "@/components/lists/ListSort";
import { readSort, sortLinks, sortRows, type SortOption } from "@/lib/list-view";

export const metadata = { title: "RFQs" };

const TABS = [
  { key: "open", label: "Open", statuses: ["new", "quoting"] },
  { key: "overdue", label: "Overdue", statuses: ["new", "quoting"] },
  { key: "mine", label: "Mine", statuses: ["new", "quoting"] },
  { key: "quoted", label: "Quoted", statuses: ["quoted"] },
  { key: "won", label: "Won", statuses: ["won"] },
  { key: "lost", label: "Lost / cancelled", statuses: ["lost", "cancelled"] },
  { key: "all", label: "All", statuses: [] as string[] },
];

const SORTS: SortOption[] = [
  { key: "due", label: "Due date", col: "due_on", dir: "asc" },
  { key: "received", label: "Received", col: "received_on", dir: "desc" },
  { key: "client", label: "Client", dir: "asc" },
  { key: "status", label: "Status", col: "status", dir: "asc" },
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
  const { supabase, company, roles, user } = await getAppContext();
  if (!can(roles, "seeSales")) noAccess();
  const sort = readSort(sp, SORTS, "due");
  const today = todayTz();

  let query = supabase
    .from("rfqs")
    .select("id, number, title, status, received_on, due_on, client:clients(name)", { count: "exact" })
    .eq("company_id", company.id)
    .order(sort.opt.col ?? "due_on", { ascending: sort.opt.col ? sort.ascending : true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (tab.statuses.length) query = query.in("status", tab.statuses);
  if (tab.key === "overdue") query = query.lt("due_on", today);
  if (tab.key === "mine") query = query.eq("assigned_to", user.id);
  if (q) query = query.or(`number.ilike.%${q}%,title.ilike.%${q}%,client_ref.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const loaded = (data ?? []) as unknown as Row[];
  const rows = sort.key === "client" ? sortRows(loaded, (r) => r.client?.name, sort.dir) : loaded;

  return (
    <>
      <BackLink href="/sales" label="Sales" />
      <div className="page-head">
        <h1>{tr("Client RFQs")}</h1>
        {can(roles, "editSales") && (
          <Link href="/rfqs/new" className="btn btn-primary btn-small">{tr("+ New RFQ")}</Link>
        )}
      </div>
      <Notice {...notice} />
      <FilterChips
        list="rfqs"
        current={tab.key}
        explicit={typeof sp.tab === "string"}
        chips={TABS.map((t) => ({ key: t.key, label: t.label, href: `/rfqs?tab=${t.key}` }))}
      />
      <form method="get" className="toolbar-row" style={{ marginBottom: 12 }}>
        <input type="hidden" name="tab" value={tab.key} />
        {sort.explicit && <input type="hidden" name="sort" value={sort.key} />}
        {sort.explicit && <input type="hidden" name="dir" value={sort.dir} />}
        <input type="search" name="q" defaultValue={q} placeholder={tr("Search number, title, client ref…")} />
        <button className="btn" type="submit">{tr("Search")}</button>
      </form>
      {rows.length > 1 && <ListSort links={sortLinks("/rfqs", { ...sp, tab: tab.key }, SORTS, sort)} />}
      {rows.length === 0 ? (
        <EmptyState
          icon={q ? "search" : "inbox"}
          text={q ? "No RFQs match your search." : "No RFQs here."}
          action={!q && can(roles, "editSales") ? { href: "/rfqs/new", label: "Record a client RFQ" } : undefined}
        />
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
