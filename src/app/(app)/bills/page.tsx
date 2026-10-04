import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { BILL_STATUS, daysOverdue, n, shownStatus } from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";

export const metadata = { title: "Supplier bills" };

const TABS = [
  { key: "open", label: "To pay" },
  { key: "overdue", label: "Overdue" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

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
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeBills")) redirect("/");

  let q = supabase
    .from("supplier_bills")
    .select("id, number, supplier_invoice_no, status, bill_date, due_date, currency, total, amount_paid, supplier:suppliers(name)")
    .eq("company_id", company.id)
    .limit(LIST_LIMIT);
  if (tab.key === "open") q = q.in("status", ["open", "partly_paid"]).order("due_date", { ascending: true, nullsFirst: false });
  else if (tab.key === "overdue") q = q.in("status", ["open", "partly_paid"]).lt("due_date", todayTz()).order("due_date");
  else if (tab.key === "paid") q = q.eq("status", "paid").order("bill_date", { ascending: false });
  else q = q.order("created_at", { ascending: false });
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <p className="small">
        <Link href={can(role, "seeFinance") ? "/finance" : "/purchasing"}>← {can(role, "seeFinance") ? tr("Finance") : tr("Purchasing")}</Link>
      </p>
      <div className="page-head">
        <h1>{tr("Supplier bills")}</h1>
        {can(role, "editBills") && (
          <Link href="/bills/new" className="btn btn-primary btn-small">{tr("+ Bill")}</Link>
        )}
      </div>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Filter")}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/bills?tab=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined}>
            {tr(String(t.label ?? ""))}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="card muted">{tr("No bills here. Record a supplier's invoice from its purchase order, or with “+ Bill”.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const shown = shownStatus(r.status, r.due_date);
            const late = shown === "overdue" ? daysOverdue(r.due_date) : 0;
            return (
              <li key={r.id}>
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
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
