import { EmptyState } from "@/components/EmptyState";
import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { getAppContext, noAccess } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { cleanSearch, LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { QUOTE_STATUS, quoteNo, StatusBadge, todayTz } from "@/lib/sales";
import { OrderProgressMini } from "@/components/OrderProgress";
import { loadOrderJourneys } from "@/lib/orders";
import { BackLink } from "@/components/BackLink";
import { FilterChips } from "@/components/lists/FilterChips";
import { ListSort } from "@/components/lists/ListSort";
import { SwipeRow } from "@/components/lists/SwipeRow";
import { readSort, sortLinks, sortRows, type SortOption } from "@/lib/list-view";

export const metadata = { title: "Quotations" };

const TABS = [
  { key: "open", label: "In progress", statuses: ["draft", "pending_approval", "approved", "sent"] },
  { key: "approval", label: "Waiting for approval", statuses: ["pending_approval"] },
  { key: "sent", label: "Sent", statuses: ["sent"] },
  { key: "accepted", label: "Accepted", statuses: ["accepted"] },
  { key: "mine", label: "Mine", statuses: [] as string[] },
  { key: "closed", label: "Rejected / cancelled", statuses: ["rejected", "cancelled"] },
  { key: "all", label: "All", statuses: [] as string[] },
];

const SORTS: SortOption[] = [
  { key: "newest", label: "Newest", col: "created_at", dir: "desc" },
  { key: "date", label: "Date", col: "issue_date", dir: "desc" },
  { key: "amount", label: "Amount", col: "total", dir: "desc" },
  { key: "client", label: "Client", dir: "asc" },
  { key: "valid", label: "Valid until", col: "valid_until", dir: "asc" },
  { key: "status", label: "Status", col: "status", dir: "asc" },
];

type Row = {
  id: string;
  number: string;
  revision: number;
  status: string;
  total: number;
  currency: string;
  issue_date: string;
  valid_until: string | null;
  client: { name: string } | null;
};

export default async function QuotationsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const q = cleanSearch(typeof sp.q === "string" ? sp.q : "");
  const { supabase, company, roles, user } = await getAppContext();
  if (!can(roles, "seeSales")) noAccess();
  const sort = readSort(sp, SORTS, "newest");

  let query = supabase
    .from("quotations")
    .select("id, number, revision, status, total, currency, issue_date, valid_until, client:clients(name)", {
      count: "exact",
    })
    .eq("company_id", company.id)
    .neq("status", "superseded")
    .order(sort.opt.col ?? "created_at", { ascending: sort.opt.col ? sort.ascending : false, nullsFirst: false })
    .limit(LIST_LIMIT);
  if (sort.opt.col && sort.key !== "newest") query = query.order("created_at", { ascending: false });
  if (tab.statuses.length) query = query.in("status", tab.statuses);
  if (tab.key === "mine") query = query.eq("created_by", user.id);
  if (q) query = query.or(`number.ilike.%${q}%,client_ref.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const loaded = (data ?? []) as unknown as Row[];
  const rows = sort.key === "client" ? sortRows(loaded, (r) => r.client?.name, sort.dir) : loaded;
  const today = todayTz();
  // Progress bar and next stage for every open or won order (one database call for the whole list).
  const journeys = await loadOrderJourneys(
    supabase,
    rows.filter((r) => !["rejected", "cancelled"].includes(r.status)).map((r) => r.id),
  );

  return (
    <>
      <BackLink href="/sales" label="Sales" />
      <div className="page-head">
        <h1>{tr("Quotations")}</h1>
        {can(roles, "editSales") && (
          <Link href="/quotations/new" className="btn btn-primary btn-small">{tr("+ New quotation")}</Link>
        )}
      </div>
      <Notice {...notice} />
      <FilterChips
        list="quotations"
        current={tab.key}
        explicit={typeof sp.tab === "string"}
        chips={TABS.map((t) => ({ key: t.key, label: t.label, href: `/quotations?tab=${t.key}` }))}
      />
      <form method="get" className="toolbar-row" style={{ marginBottom: 12 }}>
        <input type="hidden" name="tab" value={tab.key} />
        {sort.explicit && <input type="hidden" name="sort" value={sort.key} />}
        {sort.explicit && <input type="hidden" name="dir" value={sort.dir} />}
        <input type="search" name="q" defaultValue={q} placeholder={tr("Search quotation no. or client ref…")} />
        <button className="btn" type="submit">{tr("Search")}</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          icon={q ? "search" : "doc"}
          text={q ? "No quotations match your search." : "No quotations here."}
          action={!q && can(roles, "editSales") ? { href: "/quotations/new", label: "Create a quotation" } : undefined}
        />
      ) : (
        <>
        {rows.length > 1 && <ListSort links={sortLinks("/quotations", { ...sp, tab: tab.key }, SORTS, sort)} />}
        <ul className="rec-list">
          {rows.map((r) => {
            const expired = r.valid_until && r.valid_until < today && ["approved", "sent"].includes(r.status);
            return (
              <SwipeRow
                key={r.id}
                href={`/quotations/${r.id}`}
                actions={r.status === "draft" ? [] : [{ label: "PDF", href: `/quotations/${r.id}/pdf`, newTab: true }]}
              >
                <Link href={`/quotations/${r.id}`}>
                  <div className="main">
                    <div className="title">{r.client?.name ?? tr("Client")}</div>
                    <div className="sub">
                      {quoteNo(r)} · {formatDate(r.issue_date)}
                      {expired && <span className="text-warn">{" "}{tr("· validity expired")}</span>}
                    </div>
                    {journeys[r.id] && <OrderProgressMini journey={journeys[r.id]} />}
                  </div>
                  <div className="side">
                    {formatMoney(r.total, r.currency)}
                    <div>
                      <StatusBadge map={QUOTE_STATUS} status={r.status} />
                    </div>
                  </div>
                </Link>
              </SwipeRow>
            );
          })}
        </ul>
        </>
      )}
      {(count ?? 0) > LIST_LIMIT && <p className="muted small">{tr("Showing the first")}{" "}{LIST_LIMIT}.</p>}
    </>
  );
}
