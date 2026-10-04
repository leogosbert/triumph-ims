import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { PO_STATUS } from "@/lib/purchasing";
import { can } from "@/lib/roles";
import { quoteNo, StatusBadge, todayTz } from "@/lib/sales";

export const metadata = { title: "Purchasing" };

type Po = { id: string; number: string; status: string; total: number; currency: string; expected_date: string | null; supplier: { name: string } | null };
type Q = { id: string; number: string; revision: number; total: number; currency: string; client: { name: string } | null };

export default async function PurchasingPage() {
  await primeLang();
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seePurchasing")) redirect("/");
  const today = todayTz();
  const cnt = { count: "exact" as const, head: true };
  const edit = can(role, "editPurchasing");

  const [openSrfq, pending, awaiting, late, incoming, approvalList] = await Promise.all([
    edit ? supabase.from("supplier_rfqs").select("id", cnt).eq("company_id", company.id).eq("status", "open") : Promise.resolve({ count: 0 }),
    supabase.from("purchase_orders").select("id", cnt).eq("company_id", company.id).eq("status", "pending_approval"),
    supabase.from("purchase_orders").select("id", cnt).eq("company_id", company.id).in("status", ["approved", "sent"]),
    supabase
      .from("purchase_orders")
      .select("id", cnt)
      .eq("company_id", company.id)
      .in("status", ["sent", "confirmed", "partially_received"])
      .lt("expected_date", today),
    supabase
      .from("purchase_orders")
      .select("id, number, status, total, currency, expected_date, supplier:suppliers(name)")
      .eq("company_id", company.id)
      .in("status", ["sent", "confirmed", "partially_received"])
      .order("expected_date", { ascending: true, nullsFirst: false })
      .limit(8),
    supabase
      .from("purchase_orders")
      .select("id, number, status, total, currency, expected_date, supplier:suppliers(name)")
      .eq("company_id", company.id)
      .eq("status", "pending_approval")
      .order("submitted_at")
      .limit(8),
  ]);

  // Accepted client quotations with nothing ordered yet.
  let toBuy: Q[] = [];
  if (edit) {
    const { data: accepted } = await supabase
      .from("quotations")
      .select("id, number, revision, total, currency, client:clients(name)")
      .eq("company_id", company.id)
      .eq("status", "accepted")
      .order("decided_at", { ascending: false })
      .limit(30);
    const ids = ((accepted ?? []) as unknown as Q[]).map((q) => q.id);
    if (ids.length) {
      const [{ data: srfqs }, { data: pos }] = await Promise.all([
        supabase.from("supplier_rfqs").select("quotation_id").in("quotation_id", ids).neq("status", "cancelled"),
        supabase.from("purchase_orders").select("quotation_id").in("quotation_id", ids).neq("status", "cancelled"),
      ]);
      const handled = new Set([...(srfqs ?? []), ...(pos ?? [])].map((r) => (r as { quotation_id: string }).quotation_id));
      toBuy = ((accepted ?? []) as unknown as Q[]).filter((q) => !handled.has(q.id)).slice(0, 8);
    }
  }
  const incomingList = (incoming.data ?? []) as unknown as Po[];
  const approvals = (approvalList.data ?? []) as unknown as Po[];

  return (
    <>
      <div className="page-head">
        <h1>{tr("Purchasing")}</h1>
        {edit && (
          <div className="actions" style={{ marginTop: 0 }}>
            <Link href="/supplier-rfqs/new" className="btn btn-primary btn-small">{tr("+ Ask suppliers")}</Link>
            <Link href="/purchase-orders/new" className="btn btn-small">{tr("+ PO")}</Link>
          </div>
        )}
      </div>

      <div className="stat-grid">
        {edit && (
          <Link href="/supplier-rfqs" className="stat">
            <div className="n">{openSrfq.count ?? 0}</div>
            <div className="l">{tr("Supplier RFQs collecting prices")}</div>
          </Link>
        )}
        <Link href="/purchase-orders?tab=approval" className={`stat ${(pending.count ?? 0) > 0 ? "alert" : ""}`}>
          <div className="n">{pending.count ?? 0}</div>
          <div className="l">{tr("POs waiting for approval")}</div>
        </Link>
        <Link href="/purchase-orders?tab=open" className="stat">
          <div className="n">{awaiting.count ?? 0}</div>
          <div className="l">{tr("Approved, not yet confirmed")}</div>
        </Link>
        <Link href="/purchase-orders?tab=incoming" className={`stat ${(late.count ?? 0) > 0 ? "alert" : ""}`}>
          <div className="n">{late.count ?? 0}</div>
          <div className="l">{tr("Deliveries late")}</div>
        </Link>
      </div>

      {toBuy.length > 0 && (
        <section className="card" style={{ borderColor: "#f0d49a" }}>
          <h2>{tr("Won orders to buy for")}</h2>
          <p className="muted small">{tr("Accepted client quotations with no supplier RFQ or PO yet.")}</p>
          <ul className="list">
            {toBuy.map((q) => (
              <li key={q.id} className="row">
                <Link href={`/quotations/${q.id}#purchasing`}>
                  {q.client?.name} · {quoteNo(q)}
                </Link>
                <span className="small">{formatMoney(q.total, q.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {approvals.length > 0 && (
        <section className="card">
          <h2>{can(role, "approvePOs") ? tr("POs waiting for your approval") : tr("POs waiting for approval")}</h2>
          <ul className="list">
            {approvals.map((p) => (
              <li key={p.id} className="row">
                <Link href={`/purchase-orders/${p.id}`}>
                  {p.supplier?.name} · {p.number}
                </Link>
                <span className="small">{formatMoney(p.total, p.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>{tr("Expected deliveries")}</h2>
          <Link href="/purchase-orders?tab=incoming" className="small">{tr("All →")}</Link>
        </div>
        {incomingList.length === 0 ? (
          <p className="muted small">{tr("Nothing on order.")}</p>
        ) : (
          <ul className="list">
            {incomingList.map((p) => (
              <li key={p.id} className="row">
                <Link href={`/purchase-orders/${p.id}`}>
                  {p.supplier?.name} <span className="muted small">· {p.number}</span>
                </Link>
                <span className="small">
                  {p.expected_date && <span className={p.expected_date < today ? "text-warn" : "muted"}>{formatDate(p.expected_date)} </span>}
                  <StatusBadge map={PO_STATUS} status={p.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-2">
        <Link href="/purchase-orders" className="tile">
          <div className="tile-title">{tr("All purchase orders")}</div>
          <div className="tile-sub">{tr("Drafts, approvals, confirmations")}</div>
        </Link>
        {can(role, "seeSuppliers") && (
          <Link href="/suppliers" className="tile">
            <div className="tile-title">{tr("Suppliers")}</div>
            <div className="tile-sub">{tr("Contacts, terms and lead times")}</div>
          </Link>
        )}
      </div>
    </>
  );
}
