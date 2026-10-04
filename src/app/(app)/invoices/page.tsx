import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { daysOverdue, INVOICE_STATUS, n, shownStatus } from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { cleanSearch, LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";

export const metadata = { title: "Invoices" };

const TABS = [
  { key: "unpaid", label: "Unpaid" },
  { key: "overdue", label: "Overdue" },
  { key: "draft", label: "Drafts" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

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
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeInvoices")) redirect("/");

  let q = supabase
    .from("invoices")
    .select("id, number, status, issue_date, due_date, currency, total, amount_paid, created_at, client:clients(name)")
    .eq("company_id", company.id)
    .limit(LIST_LIMIT);
  if (tab.key === "unpaid") q = q.in("status", ["issued", "partly_paid"]).order("due_date", { ascending: true });
  else if (tab.key === "overdue") q = q.in("status", ["issued", "partly_paid"]).lt("due_date", todayTz()).order("due_date");
  else if (tab.key === "draft") q = q.eq("status", "draft").order("created_at", { ascending: false });
  else if (tab.key === "paid") q = q.eq("status", "paid").order("issue_date", { ascending: false });
  else q = q.order("created_at", { ascending: false });
  const { data, error } = await (search
    ? supabase
        .from("invoices")
        .select("id, number, status, issue_date, due_date, currency, total, amount_paid, created_at, client:clients(name)")
        .eq("company_id", company.id)
        .or(`number.ilike.%${search}%,client_ref.ilike.%${search}%`)
        .order("created_at", { ascending: false })
        .limit(LIST_LIMIT)
    : q);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const openTotal = rows
    .filter((r) => r.status === "issued" || r.status === "partly_paid")
    .reduce((s, r) => s + n(r.total) - n(r.amount_paid), 0);

  return (
    <>
      <p className="small">
        <Link href={can(role, "seeFinance") ? "/finance" : "/sales"}>← {can(role, "seeFinance") ? tr("Finance") : tr("Sales")}</Link>
      </p>
      <div className="page-head">
        <h1>{tr("Invoices")}</h1>
        {can(role, "editInvoices") && (
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
        <nav className="tabs-row" aria-label={tr("Filter")}>
          {TABS.map((t) => (
            <Link key={t.key} href={`/invoices?tab=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined}>
              {tr(String(t.label ?? ""))}
            </Link>
          ))}
        </nav>
      )}
      {rows.length === 0 ? (
        <p className="card muted">{tr("No invoices here. Invoices are usually created from an accepted quotation or a delivered delivery note.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const shown = shownStatus(r.status, r.due_date);
            const late = shown === "overdue" ? daysOverdue(r.due_date) : 0;
            const owed = n(r.total) - n(r.amount_paid);
            return (
              <li key={r.id}>
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
              </li>
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
