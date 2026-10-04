import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { PO_STATUS } from "@/lib/purchasing";
import { cleanSearch, LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";

export const metadata = { title: "Purchase orders" };

const TABS = [
  { key: "open", label: "In progress", statuses: ["draft", "pending_approval", "approved", "sent", "confirmed", "partially_received"] },
  { key: "approval", label: "Waiting for approval", statuses: ["pending_approval"] },
  { key: "incoming", label: "Awaiting delivery", statuses: ["sent", "confirmed", "partially_received"] },
  { key: "done", label: "Received / closed", statuses: ["received", "closed"] },
  { key: "all", label: "All", statuses: [] as string[] },
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
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seePurchasing")) redirect("/");

  let query = supabase
    .from("purchase_orders")
    .select("id, number, status, total, currency, order_date, expected_date, supplier:suppliers(name)", { count: "exact" })
    .eq("company_id", company.id)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (tab.statuses.length) query = query.in("status", tab.statuses);
  if (q) query = query.or(`number.ilike.%${q}%,supplier_ref.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const today = todayTz();

  return (
    <>
      <p className="small">
        <Link href="/purchasing">{tr("← Purchasing")}</Link>
      </p>
      <div className="page-head">
        <h1>{tr("Purchase orders")}</h1>
        {can(role, "editPurchasing") && (
          <Link href="/purchase-orders/new" className="btn btn-primary btn-small">{tr("+ New PO")}</Link>
        )}
      </div>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Filter")}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/purchase-orders?tab=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined}>
            {tr(String(t.label ?? ""))}
          </Link>
        ))}
      </nav>
      <form method="get" className="toolbar-row" style={{ marginBottom: 12 }}>
        <input type="hidden" name="tab" value={tab.key} />
        <input type="search" name="q" defaultValue={q} placeholder={tr("Search PO no. or supplier ref…")} />
        <button className="btn" type="submit">{tr("Search")}</button>
      </form>
      {rows.length === 0 ? (
        <p className="card muted">{tr("No purchase orders here.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const late = r.expected_date && r.expected_date < today && ["sent", "confirmed", "partially_received"].includes(r.status);
            return (
              <li key={r.id}>
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
              </li>
            );
          })}
        </ul>
      )}
      {(count ?? 0) > LIST_LIMIT && <p className="muted small">{tr("Showing the first")}{" "}{LIST_LIMIT}.</p>}
    </>
  );
}
