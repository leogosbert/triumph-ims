import { EmptyState } from "@/components/EmptyState";
import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { getAppContext, noAccess } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { SRFQ_STATUS } from "@/lib/purchasing";
import { LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";
import { BackLink } from "@/components/BackLink";
import { FilterChips } from "@/components/lists/FilterChips";
import { ListSort } from "@/components/lists/ListSort";
import { readSort, sortLinks, type SortOption } from "@/lib/list-view";

export const metadata = { title: "Supplier RFQs" };

const TABS = [
  { key: "open", label: "Collecting prices", statuses: ["open"] },
  { key: "awarded", label: "Awarded", statuses: ["awarded"] },
  { key: "all", label: "All", statuses: [] as string[] },
];

const SORTS: SortOption[] = [
  { key: "newest", label: "Newest", col: "created_at", dir: "desc" },
  { key: "due", label: "Reply by", col: "due_on", dir: "asc" },
  { key: "title", label: "Title", col: "title", dir: "asc" },
  { key: "status", label: "Status", col: "status", dir: "asc" },
];

type Row = { id: string; number: string; title: string | null; status: string; due_on: string | null; invites: { status: string }[] };

export default async function SupplierRfqsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const { supabase, company, roles } = await getAppContext();
  if (!can(roles, "editPurchasing")) noAccess();
  const sort = readSort(sp, SORTS, "newest");

  let query = supabase
    .from("supplier_rfqs")
    .select("id, number, title, status, due_on, invites:supplier_rfq_suppliers(status)")
    .eq("company_id", company.id)
    .order(sort.opt.col ?? "created_at", { ascending: sort.ascending, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (tab.statuses.length) query = query.in("status", tab.statuses);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const today = todayTz();

  return (
    <>
      <BackLink href="/purchasing" label="Purchasing" />
      <div className="page-head">
        <h1>{tr("Supplier RFQs")}</h1>
        <Link href="/supplier-rfqs/new" className="btn btn-primary btn-small">{tr("+ New")}</Link>
      </div>
      <Notice {...notice} />
      <FilterChips
        list="supplier-rfqs"
        current={tab.key}
        explicit={typeof sp.tab === "string"}
        chips={TABS.map((t) => ({ key: t.key, label: t.label, href: `/supplier-rfqs?tab=${t.key}` }))}
      />
      {rows.length > 1 && <ListSort links={sortLinks("/supplier-rfqs", sp, SORTS, sort)} />}
      {rows.length === 0 ? (
        <EmptyState icon="purchasing" text="No supplier RFQs here." action={{ href: "/supplier-rfqs/new", label: "Ask suppliers for prices" }} />
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const quoted = r.invites.filter((i) => i.status === "quoted").length;
            return (
              <li key={r.id}>
                <Link href={`/supplier-rfqs/${r.id}`}>
                  <div className="main">
                    <div className="title">{r.title ?? r.number}</div>
                    <div className="sub">
                      {r.number} · {quoted}{" "}{tr("of")}{" "}{r.invites.length}{" "}{tr("supplier")}{r.invites.length === 1 ? "" : "s"}{" "}{tr("priced")}</div>
                  </div>
                  <div className="side">
                    <StatusBadge map={SRFQ_STATUS} status={r.status} />
                    {r.due_on && r.status === "open" && (
                      <div className={`small ${r.due_on < today ? "text-warn" : "muted"}`}>{tr("Reply by")}{" "}{formatDate(r.due_on)}</div>
                    )}
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
