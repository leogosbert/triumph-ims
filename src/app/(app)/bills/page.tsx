import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { getAppContext, noAccess } from "@/lib/context";
import { BILL_STATUS, daysOverdue, n, shownStatus } from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";
import { BackLink } from "@/components/BackLink";
import { FilterChips } from "@/components/lists/FilterChips";
import { ListSort } from "@/components/lists/ListSort";
import { SwipeRow } from "@/components/lists/SwipeRow";
import { readSort, sortLinks, sortRows, weekAhead, type SortOption } from "@/lib/list-view";

export const metadata = { title: "Supplier bills" };

const TABS = [
  { key: "open", label: "To pay" },
  { key: "overdue", label: "Overdue" },
  { key: "week", label: "Due this week" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

const SORTS: SortOption[] = [
  { key: "due", label: "Due date", col: "due_date", dir: "asc" },
  { key: "date", label: "Bill date", col: "bill_date", dir: "desc" },
  { key: "newest", label: "Newest", col: "created_at", dir: "desc" },
  { key: "amount", label: "Amount", col: "total", dir: "desc" },
  { key: "supplier", label: "Supplier", dir: "asc" },
  { key: "status", label: "Status", col: "status", dir: "asc" },
];
const TAB_SORT: Record<string, string> = { open: "due", overdue: "due", week: "due", paid: "date" };

type Row = {
  id: string;
  number: string;
  supplier_invoice_no: string | null;
  status: string;
  bill_date: string;
  due_date: string | null;
  currency: string;
  total: number;
  amount_paid: number;
  supplier: { name: string } | null;
};

export default async function BillsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const { supabase, company, roles } = await getAppContext();
  if (!can(roles, "seeBills")) noAccess();
  const sort = readSort(sp, SORTS, TAB_SORT[tab.key] ?? "newest");
  const week = weekAhead(todayTz());

  let q = supabase
    .from("supplier_bills")
    .select("id, number, supplier_invoice_no, status, bill_date, due_date, currency, total, amount_paid, supplier:suppliers(name)")
    .eq("company_id", company.id)
    .limit(LIST_LIMIT);
  if (tab.key === "open") q = q.in("status", ["open", "partly_paid"]);
  else if (tab.key === "overdue") q = q.in("status", ["open", "partly_paid"]).lt("due_date", todayTz());
  else if (tab.key === "week") q = q.in("status", ["open", "partly_paid"]).gte("due_date", week.from).lte("due_date", week.to);
  else if (tab.key === "paid") q = q.eq("status", "paid");
  q = q
    .order(sort.opt.col ?? "created_at", { ascending: sort.opt.col ? sort.ascending : false, nullsFirst: false })
    .order("created_at", { ascending: false });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const loaded = (data ?? []) as unknown as Row[];
  const rows = sort.key === "supplier" ? sortRows(loaded, (r) => r.supplier?.name, sort.dir) : loaded;
  const canPay = can(roles, "editBills");

  return (
    <>
      <BackLink href={can(roles, "seeFinance") ? "/finance" : "/purchasing"} label={can(roles, "seeFinance") ? "Finance" : "Purchasing"} />
      <div className="page-head">
        <h1>{tr("Supplier bills")}</h1>
        {can(roles, "editBills") && (
          <Link href="/bills/new" className="btn btn-primary btn-small">{tr("+ Bill")}</Link>
        )}
      </div>
      <Notice {...notice} />
      <FilterChips
        list="bills"
        current={tab.key}
        explicit={typeof sp.tab === "string"}
        chips={TABS.map((t) => ({ key: t.key, label: t.label, href: `/bills?tab=${t.key}` }))}
      />
      {rows.length > 1 && <ListSort links={sortLinks("/bills", sp, SORTS, sort)} />}
      {rows.length === 0 ? (
        <p className="card muted">{tr("No bills here. Record a supplier's invoice from its purchase order, or with “+ Bill”.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const shown = shownStatus(r.status, r.due_date);
            const late = shown === "overdue" ? daysOverdue(r.due_date) : 0;
            const toPay = canPay && (r.status === "open" || r.status === "partly_paid");
            return (
              <SwipeRow
                key={r.id}
                href={`/bills/${r.id}`}
                actions={toPay ? [{ label: "Pay", href: `/bills/${r.id}#payments`, tone: "pay" }] : []}
              >
                <Link href={`/bills/${r.id}`}>
                  <div className="main">
                    <div className="title">{r.supplier?.name}</div>
                    <div className="sub">
                      {r.supplier_invoice_no || r.number} · {formatDate(r.bill_date)}
                      {r.due_date && (r.status === "open" || r.status === "partly_paid") && ` · due ${formatDate(r.due_date)}`}
                      {late > 0 && ` · ${late} days late`}
                    </div>
                  </div>
                  <div className="side">
                    <div>{formatMoney(r.status === "partly_paid" ? n(r.total) - n(r.amount_paid) : r.total, r.currency)}</div>
                    <StatusBadge map={BILL_STATUS} status={shown} />
                  </div>
                </Link>
              </SwipeRow>
            );
          })}
        </ul>
      )}
    </>
  );
}
