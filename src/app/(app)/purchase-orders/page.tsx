import { EmptyState } from "@/components/EmptyState";
import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { getAppContext, noAccess } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { PO_STATUS } from "@/lib/purchasing";
import { cleanSearch, LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";
import { BackLink } from "@/components/BackLink";
import { FilterChips } from "@/components/lists/FilterChips";
import { ListSort } from "@/components/lists/ListSort";
import { SwipeRow } from "@/components/lists/SwipeRow";
import { readSort, sortLinks, sortRows, type SortOption } from "@/lib/list-view";

export const metadata = { title: "Purchase orders" };

const TABS = [
  { key: "open", label: "In progress", statuses: ["draft", "pending_approval", "approved", "sent", "confirmed", "partially_received"] },
  { key: "approval", label: "Waiting for approval", statuses: ["pending_approval"] },
  { key: "incoming", label: "Awaiting delivery", statuses: ["sent", "confirmed", "partially_received"] },
  { key: "done", label: "Received / closed", statuses: ["received", "closed"] },
  { key: "mine", label: "Mine", statuses: [] as string[] },
  { key: "all", label: "All", statuses: [] as string[] },
];

const SORTS: SortOption[] = [
  { key: "newest", label: "Newest", col: "created_at", dir: "desc" },
  { key: "date", label: "Order date", col: "order_date", dir: "desc" },
  { key: "due", label: "Expected", col: "expected_date", dir: "asc" },
  { key: "amount", label: "Amount", col: "total", dir: "desc" },
  { key: "supplier", label: "Supplier", dir: "asc" },
  { key: "status", label: "Status", col: "status", dir: "asc" },
];

type Row = {
  id: string;
  number: string;
  status: string;
  total: number;
  currency: string;
  order_date: string;
  expected_date: string | null;
  supplier: { name: string } | null;
};

export default async function PurchaseOrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const q = cleanSearch(typeof sp.q === "string" ? sp.q : "");
  const { supabase, company, roles, user } = await getAppContext();
  if (!can(roles, "seePurchasing")) noAccess();
  const sort = readSort(sp, SORTS, "newest");

  let query = supabase
    .from("purchase_orders")
    .select("id, number, status, total, currency, order_date, expected_date, supplier:suppliers(name)", { count: "exact" })
    .eq("company_id", company.id)
    .order(sort.opt.col ?? "created_at", { ascending: sort.opt.col ? sort.ascending : false, nullsFirst: false })
    .limit(LIST_LIMIT);
  if (sort.key !== "newest") query = query.order("created_at", { ascending: false });
  if (tab.statuses.length) query = query.in("status", tab.statuses);
  if (tab.key === "mine") query = query.eq("created_by", user.id);
  if (q) query = query.or(`number.ilike.%${q}%,supplier_ref.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const loaded = (data ?? []) as unknown as Row[];
  const rows = sort.key === "supplier" ? sortRows(loaded, (r) => r.supplier?.name, sort.dir) : loaded;
  const canReceive = can(roles, "receiveGoods");
  const today = todayTz();

  return (
    <>
      <BackLink href="/purchasing" label="Purchasing" />
      <div className="page-head">
        <h1>{tr("Purchase orders")}</h1>
        {can(roles, "editPurchasing") && (
          <Link href="/purchase-orders/new" className="btn btn-primary btn-small">{tr("+ New PO")}</Link>
        )}
      </div>
      <Notice {...notice} />
      <FilterChips
        list="purchase-orders"
        current={tab.key}
        explicit={typeof sp.tab === "string"}
        chips={TABS.map((t) => ({ key: t.key, label: t.label, href: `/purchase-orders?tab=${t.key}` }))}
      />
      <form method="get" className="toolbar-row" style={{ marginBottom: 12 }}>
        <input type="hidden" name="tab" value={tab.key} />
        {sort.explicit && <input type="hidden" name="sort" value={sort.key} />}
        {sort.explicit && <input type="hidden" name="dir" value={sort.dir} />}
        <input type="search" name="q" defaultValue={q} placeholder={tr("Search PO no. or supplier ref…")} />
        <button className="btn" type="submit">{tr("Search")}</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          icon={q ? "search" : "purchasing"}
          text={q ? "No purchase orders match your search." : "No purchase orders here."}
          action={!q && can(roles, "editPurchasing") ? { href: "/purchase-orders/new", label: "Create a purchase order" } : undefined}
        />
      ) : (
        <>
        {rows.length > 1 && <ListSort links={sortLinks("/purchase-orders", { ...sp, tab: tab.key }, SORTS, sort)} />}
        <ul className="rec-list">
          {rows.map((r) => {
            const late = r.expected_date && r.expected_date < today && ["sent", "confirmed", "partially_received"].includes(r.status);
            const receivable = canReceive && ["approved", "sent", "confirmed", "partially_received"].includes(r.status);
            return (
              <SwipeRow
                key={r.id}
                href={`/purchase-orders/${r.id}`}
                actions={receivable ? [{ label: "Receive", href: `/purchase-orders/${r.id}/receive`, tone: "pay" }] : []}
              >
                <Link href={`/purchase-orders/${r.id}`}>
                  <div className="main">
                    <div className="title">{r.supplier?.name ?? tr("Supplier")}</div>
                    <div className="sub">
                      {r.number} · {formatDate(r.order_date)}
                      {r.expected_date && (
                        <span className={late ? "text-warn" : undefined}>
                          {" "}
                          · {late ? tr("late, was due") : tr("due")} {formatDate(r.expected_date)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="side">
                    {formatMoney(r.total, r.currency)}
                    <div>
                      <StatusBadge map={PO_STATUS} status={r.status} />
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
