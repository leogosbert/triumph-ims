import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { QUOTE_STATUS, quoteNo, RFQ_STATUS, StatusBadge, todayTz } from "@/lib/sales";

export const metadata = { title: "Sales" };

type Rfq = { id: string; number: string; title: string | null; status: string; due_on: string | null; client: { name: string } | null };
type Quote = { id: string; number: string; revision: number; status: string; total: number; currency: string; client: { name: string } | null };

export default async function SalesPage() {
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeSales")) redirect("/");
  const today = todayTz();
  const monthStart = `${today.slice(0, 7)}-01`;
  const cnt = { count: "exact" as const, head: true };

  const [openRfqs, overdueRfqs, drafts, pending, sent, wonMonth, rfqList, pendingList] = await Promise.all([
    supabase.from("rfqs").select("id", cnt).eq("company_id", company.id).in("status", ["new", "quoting"]),
    supabase.from("rfqs").select("id", cnt).eq("company_id", company.id).in("status", ["new", "quoting"]).lt("due_on", today),
    supabase.from("quotations").select("id", cnt).eq("company_id", company.id).eq("status", "draft"),
    supabase.from("quotations").select("id", cnt).eq("company_id", company.id).eq("status", "pending_approval"),
    supabase.from("quotations").select("id", cnt).eq("company_id", company.id).eq("status", "sent"),
    supabase
      .from("quotations")
      .select("total, exchange_rate")
      .eq("company_id", company.id)
      .eq("status", "accepted")
      .gte("decided_at", monthStart),
    supabase
      .from("rfqs")
      .select("id, number, title, status, due_on, client:clients(name)")
      .eq("company_id", company.id)
      .in("status", ["new", "quoting"])
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(6),
    supabase
      .from("quotations")
      .select("id, number, revision, status, total, currency, client:clients(name)")
      .eq("company_id", company.id)
      .eq("status", "pending_approval")
      .order("submitted_at")
      .limit(6),
  ]);
  const wonValue = ((wonMonth.data ?? []) as { total: number; exchange_rate: number }[]).reduce(
    (s, r) => s + Number(r.total) * Number(r.exchange_rate),
    0,
  );
  const rfqs = (rfqList.data ?? []) as unknown as Rfq[];
  const approvals = (pendingList.data ?? []) as unknown as Quote[];

  return (
    <>
      <div className="page-head">
        <h1>Sales</h1>
        {can(role, "editSales") && (
          <div className="actions" style={{ marginTop: 0 }}>
            <Link href="/rfqs/new" className="btn btn-primary btn-small">
              + RFQ
            </Link>
            <Link href="/quotations/new" className="btn btn-small">
              + Quotation
            </Link>
          </div>
        )}
      </div>

      <div className="stat-grid">
        <Link href="/rfqs?tab=open" className={`stat ${(overdueRfqs.count ?? 0) > 0 ? "alert" : ""}`}>
          <div className="n">{openRfqs.count ?? 0}</div>
          <div className="l">
            RFQs to answer{(overdueRfqs.count ?? 0) > 0 ? ` · ${overdueRfqs.count} overdue` : ""}
          </div>
        </Link>
        <Link href="/quotations?tab=approval" className={`stat ${(pending.count ?? 0) > 0 ? "alert" : ""}`}>
          <div className="n">{pending.count ?? 0}</div>
          <div className="l">Waiting for approval</div>
        </Link>
        <Link href="/quotations?tab=sent" className="stat">
          <div className="n">{sent.count ?? 0}</div>
          <div className="l">Sent, awaiting answer</div>
        </Link>
        <Link href="/quotations?tab=accepted" className="stat">
          <div className="n" style={{ fontSize: "1.1rem" }}>
            {formatMoney(wonValue, company.base_currency)}
          </div>
          <div className="l">Accepted this month (incl. VAT)</div>
        </Link>
      </div>

      {approvals.length > 0 && (
        <section className="card">
          <h2>{can(role, "approveQuotes") ? "Waiting for your approval" : "Waiting for approval"}</h2>
          <ul className="list">
            {approvals.map((q) => (
              <li key={q.id} className="row">
                <Link href={`/quotations/${q.id}`}>
                  {q.client?.name} · {quoteNo(q)}
                </Link>
                <span className="small">{formatMoney(q.total, q.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <div className="row">
          <h2 style={{ margin: 0 }}>RFQs to answer</h2>
          <Link href="/rfqs" className="small">
            All RFQs →
          </Link>
        </div>
        {rfqs.length === 0 ? (
          <p className="muted small">Nothing waiting. New client requests will appear here.</p>
        ) : (
          <ul className="list">
            {rfqs.map((r) => (
              <li key={r.id} className="row">
                <Link href={`/rfqs/${r.id}`}>
                  {r.client?.name}
                  <span className="muted small"> · {r.title ?? r.number}</span>
                </Link>
                <span className="small">
                  {r.due_on && (
                    <span className={r.due_on < today ? "text-warn" : "muted"}>{formatDate(r.due_on)} </span>
                  )}
                  <StatusBadge map={RFQ_STATUS} status={r.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid grid-2">
        <Link href="/quotations" className="tile">
          <div className="tile-title">All quotations</div>
          <div className="tile-sub">
            {drafts.count ?? 0} draft{(drafts.count ?? 0) === 1 ? "" : "s"} in progress
          </div>
        </Link>
        <Link href="/clients" className="tile">
          <div className="tile-title">Clients</div>
          <div className="tile-sub">Contacts, sites and history</div>
        </Link>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        <StatusBadge map={QUOTE_STATUS} status="pending_approval" /> quotations need a manager before they can be sent.
      </p>
    </>
  );
}
