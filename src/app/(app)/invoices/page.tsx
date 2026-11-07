import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { getAppContext, noAccess } from "@/lib/context";
import { daysOverdue, INVOICE_STATUS, n, shownStatus } from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { cleanSearch, LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";
import { BackLink } from "@/components/BackLink";
import { FilterChips } from "@/components/lists/FilterChips";
import { ListSort } from "@/components/lists/ListSort";
import { SwipeRow, type RowAction } from "@/components/lists/SwipeRow";
import { readSort, sortLinks, sortRows, weekAhead, type SortOption } from "@/lib/list-view";

export const metadata = { title: "Invoices" };

const TABS = [
  { key: "unpaid", label: "Unpaid" },
  { key: "overdue", label: "Overdue" },
  { key: "week", label: "Due this week" },
  { key: "mine", label: "Mine" },
  { key: "draft", label: "Drafts" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

const SORTS: SortOption[] = [
  { key: "due", label: "Due date", col: "due_date", dir: "asc" },
  { key: "date", label: "Date", col: "issue_date", dir: "desc" },
  { key: "newest", label: "Newest", col: "created_at", dir: "desc" },
  { key: "amount", label: "Amount", col: "total", dir: "desc" },
  { key: "client", label: "Client", dir: "asc" },
  { key: "status", label: "Status", col: "status", dir: "asc" },
];
/** Each chip's natural order when the person has not picked one. */
const TAB_SORT: Record<string, string> = { unpaid: "due", overdue: "due", week: "due", paid: "date" };

type Row = {
  id: string;
  number: string;
  status: string;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  total: number;
  amount_paid: number;
  created_at: string;
  client: { name: string } | null;
};

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const search = cleanSearch(typeof sp.q === "string" ? sp.q : "");
  const { supabase, company, roles, user } = await getAppContext();
  if (!can(roles, "seeInvoices")) noAccess();
  const sort = readSort(sp, SORTS, search ? "newest" : (TAB_SORT[tab.key] ?? "newest"));
  // Sorts the database can do; "client" orders the loaded rows by name below.
  const order = { col: sort.opt.col ?? "created_at", ascending: sort.opt.col ? sort.ascending : false };
  const week = weekAhead(todayTz());

  let q = supabase
    .from("invoices")
    .select("id, number, status, issue_date, due_date, currency, total, amount_paid, created_at, client:clients(name)")
    .eq("company_id", company.id)
    .limit(LIST_LIMIT);
  if (tab.key === "unpaid") q = q.in("status", ["issued", "partly_paid"]);
  else if (tab.key === "overdue") q = q.in("status", ["issued", "partly_paid"]).lt("due_date", todayTz());
  else if (tab.key === "week") q = q.in("status", ["issued", "partly_paid"]).gte("due_date", week.from).lte("due_date", week.to);
  else if (tab.key === "mine") q = q.eq("created_by", user.id);
  else if (tab.key === "draft") q = q.eq("status", "draft");
  else if (tab.key === "paid") q = q.eq("status", "paid");
  q = q.order(order.col, { ascending: order.ascending, nullsFirst: false }).order("created_at", { ascending: false });
  const { data, error } = await (search
    ? supabase
        .from("invoices")
        .select("id, number, status, issue_date, due_date, currency, total, amount_paid, created_at, client:clients(name)")
        .eq("company_id", company.id)
        .or(`number.ilike.%${search}%,client_ref.ilike.%${search}%`)
        .order(order.col, { ascending: order.ascending, nullsFirst: false })
        .limit(LIST_LIMIT)
    : q);
  if (error) throw new Error(error.message);
  const loaded = (data ?? []) as unknown as Row[];
  const rows = sort.key === "client" ? sortRows(loaded, (r) => r.client?.name, sort.dir) : loaded;
  const canPay = can(roles, "editInvoices");
  const openTotal = rows
    .filter((r) => r.status === "issued" || r.status === "partly_paid")
    .reduce((s, r) => s + n(r.total) - n(r.amount_paid), 0);

  return (
    <>
      <BackLink href={can(roles, "seeFinance") ? "/finance" : "/sales"} label={can(roles, "seeFinance") ? "Finance" : "Sales"} />
      <div className="page-head">
        <h1>{tr("Invoices")}</h1>
        {can(roles, "editInvoices") && (
          <Link href="/invoices/new" className="btn btn-primary btn-small">{tr("+ Invoice")}</Link>
        )}
      </div>
      <Notice {...notice} />
      <form className="card toolbar" method="get" role="search">
        <div className="toolbar-row">
          <input type="search" name="q" defaultValue={search} placeholder={tr("Invoice no. or client's PO no.")} aria-label={tr("Search")} />
          <button className="btn" type="submit">{tr("Search")}</button>
        </div>
      </form>
      {!search && (
        <FilterChips
          list="invoices"
          current={tab.key}
          explicit={typeof sp.tab === "string"}
          chips={TABS.map((t) => ({ key: t.key, label: t.label, href: `/invoices?tab=${t.key}` }))}
        />
      )}
      {rows.length > 1 && <ListSort links={sortLinks("/invoices", sp, SORTS, sort)} />}
      {rows.length === 0 ? (
        <p className="card muted">{tr("No invoices here. Invoices are usually created from an accepted quotation or a delivered delivery note.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const shown = shownStatus(r.status, r.due_date);
            const late = shown === "overdue" ? daysOverdue(r.due_date) : 0;
            const owed = n(r.total) - n(r.amount_paid);
            const actions: RowAction[] = [];
            if (canPay && (r.status === "issued" || r.status === "partly_paid")) actions.push({ label: "Record payment", href: `/invoices/${r.id}#payments`, tone: "pay" });
            else if (r.status !== "draft" && r.status !== "cancelled") actions.push({ label: "PDF", href: `/invoices/${r.id}/pdf`, newTab: true });
            return (
              <SwipeRow key={r.id} href={`/invoices/${r.id}`} actions={actions}>
                <Link href={`/invoices/${r.id}`}>
                  <div className="main">
                    <div className="title">{r.client?.name}</div>
                    <div className="sub">
                      {r.number || tr("Draft")}
                      {r.issue_date && ` · ${formatDate(r.issue_date)}`}
                      {r.due_date && (r.status === "issued" || r.status === "partly_paid") && ` · due ${formatDate(r.due_date)}`}
                      {late > 0 && ` · ${late} days late`}
                    </div>
                  </div>
                  <div className="side">
                    <div>{formatMoney(r.status === "partly_paid" ? owed : r.total, r.currency)}</div>
                    <StatusBadge map={INVOICE_STATUS} status={shown} />
                  </div>
                </Link>
              </SwipeRow>
            );
          })}
        </ul>
      )}
      {openTotal > 0 && tab.key !== "all" && rows.every((r) => r.currency === company.base_currency) && (
        <p className="small muted">{tr("Still owed on this list:")}{" "}{formatMoney(openTotal, company.base_currency)}</p>
      )}
    </>
  );
}
