import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import type { SearchParams } from "@/lib/messages";

export const metadata = { title: "Order, receipt and bill check" };

type Po = {
  id: string;
  number: string;
  status: string;
  order_date: string;
  currency: string;
  exchange_rate: number;
  total: number;
  supplier: { name: string } | null;
  lines: { quantity: number; received_qty: number; line_total: number }[];
};
type Bill = { po_id: string; total: number; exchange_rate: number };

const MATCH: Record<string, { label: string; tone: string }> = {
  over: { label: "Billed more than received", tone: "bad" },
  to_bill: { label: "Received, not billed", tone: "warn" },
  part: { label: "Billed less than received", tone: "info" },
  waiting: { label: "Waiting for goods", tone: "off" },
  ok: { label: "Matches", tone: "ok" },
};

export default async function MatchPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeBills")) redirect("/");
  const view = sp.view === "all" ? "all" : "check";
  const { data: poData, error } = await supabase
    .from("purchase_orders")
    .select("id, number, status, order_date, currency, exchange_rate, total, supplier:suppliers(name), lines:po_lines(quantity, received_qty, line_total)")
    .eq("company_id", company.id)
    .in("status", ["sent", "confirmed", "partially_received", "received", "closed"])
    .order("order_date", { ascending: false })
    .limit(400);
  if (error) throw new Error(error.message);
  const pos = (poData ?? []) as unknown as Po[];
  const { data: billData } = pos.length
    ? await supabase
        .from("supplier_bills")
        .select("po_id, total, exchange_rate")
        .in("po_id", pos.map((p) => p.id))
        .neq("status", "cancelled")
    : { data: [] };
  const billed = new Map<string, number>();
  for (const b of (billData ?? []) as Bill[]) billed.set(b.po_id, (billed.get(b.po_id) ?? 0) + Number(b.total) * Number(b.exchange_rate));

  const base = company.base_currency;
  const rows = pos.map((p) => {
    const rate = Number(p.exchange_rate);
    const goods = p.lines.reduce((s, l) => s + Number(l.line_total), 0);
    const goodsIn = p.lines.reduce((s, l) => s + Math.min(Number(l.received_qty), Number(l.quantity)) * (Number(l.line_total) / Math.max(Number(l.quantity), 1e-9)), 0);
    const ordered = Number(p.total) * rate;
    // What was received, at the order's prices with its VAT and freight in proportion.
    const received = goods > 0 ? ordered * (goodsIn / goods) : 0;
    const bill = billed.get(p.id) ?? 0;
    const tol = Math.max(ordered * 0.01, 1);
    const match = bill > received + tol ? "over" : received <= tol ? (bill > tol ? "over" : "waiting") : bill <= tol ? "to_bill" : bill < received - tol ? "part" : "ok";
    return { p, ordered, received, bill, match };
  });
  const problems = rows.filter((r) => r.match === "over" || r.match === "to_bill" || r.match === "part");
  const shown = view === "all" ? rows : problems;

  return (
    <>
      <p className="small">
        <Link href="/purchasing">{tr("← Purchasing")}</Link>
      </p>
      <h1>{tr("Order, receipt and bill check")}</h1>
      <p className="muted small">
        {tr("For each purchase order: what was ordered, what arrived (goods received notes) and what the supplier billed. Pay only for what arrived.")}{" "}
        {tr("Amounts in")} {base}.
      </p>
      <div className="stat-grid">
        <div className={`stat ${rows.some((r) => r.match === "over") ? "alert" : ""}`}>
          <div className="n">{rows.filter((r) => r.match === "over").length}</div>
          <div className="l">{tr("Billed more than received")}</div>
        </div>
        <div className="stat">
          <div className="n">{rows.filter((r) => r.match === "to_bill").length}</div>
          <div className="l">{tr("Received, not billed")}</div>
        </div>
        <div className="stat">
          <div className="n">{rows.filter((r) => r.match === "ok").length}</div>
          <div className="l">{tr("Matches")}</div>
        </div>
      </div>
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/purchasing/match" aria-current={view === "check" ? "page" : undefined}>
          {tr("To check")}
        </Link>
        <Link href="/purchasing/match?view=all" aria-current={view === "all" ? "page" : undefined}>
          {tr("All")}
        </Link>
      </nav>
      {shown.length === 0 ? (
        <p className="card muted">{tr("Nothing to check: what was billed matches what arrived.")}</p>
      ) : (
        <ul className="rec-list">
          {shown.map(({ p, ordered, received, bill, match }) => (
            <li key={p.id}>
              <Link href={`/purchase-orders/${p.id}`}>
                <div className="main">
                  <div className="title">
                    {p.supplier?.name} · {p.number}
                  </div>
                  <div className="sub">
                    {formatDate(p.order_date)} · {tr("ordered")} {formatMoney(ordered, base)} · {tr("received")} {formatMoney(received, base)} · {tr("billed")}{" "}
                    {formatMoney(bill, base)}
                  </div>
                </div>
                <div className="side">
                  <StatusBadge map={MATCH} status={match} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
