import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { formatMoney } from "@/lib/money";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { fmtQty } from "@/lib/stock";

export const metadata = { title: "Business insights" };

const DAY = 864e5;

type Quote = { id: string; status: string; total: number; exchange_rate: number; created_by: string | null; client: { id: string; name: string } | null };
type Po = { id: string; expected_date: string | null; supplier: { id: string; name: string } | null; grns: { received_on: string }[] };

function pct(a: number, b: number) {
  return b > 0 ? `${Math.round((a / b) * 100)}%` : "—";
}

export default async function InsightsPage() {
  await primeLang();
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeInsights")) redirect("/");
  const base = company.base_currency;
  const yearAgo = new Date(Date.now() - 365 * DAY).toISOString();
  const quarterAgo = new Date(Date.now() - 90 * DAY).toISOString();

  const [{ data: qData }, { data: poData }, { data: ohData }, { data: moved }, { data: costs }, { data: prodData }, { data: wonLines }] = await Promise.all([
    supabase
      .from("quotations")
      .select("id, status, total, exchange_rate, created_by, client:clients(id, name)")
      .eq("company_id", company.id)
      .in("status", ["sent", "accepted", "rejected"])
      .gte("sent_at", yearAgo)
      .limit(5000),
    supabase
      .from("purchase_orders")
      .select("id, expected_date, supplier:suppliers(id, name), grns:goods_receipts(received_on)")
      .eq("company_id", company.id)
      .in("status", ["partially_received", "received", "closed"])
      .not("expected_date", "is", null)
      .gte("order_date", yearAgo.slice(0, 10))
      .limit(3000),
    supabase.from("stock_on_hand").select("product_id, quantity").eq("company_id", company.id).limit(20000),
    supabase.from("stock_movements").select("product_id").eq("company_id", company.id).eq("kind", "dispatch").gte("created_at", quarterAgo).limit(20000),
    supabase.from("product_costs").select("product_id, last_cost").limit(10000),
    supabase.from("products").select("id, name, sku, unit").eq("company_id", company.id).limit(10000),
    supabase
      .from("quotation_lines")
      .select("quotation_id, product_id, quotation:quotations!inner(status, sent_at)")
      .eq("company_id", company.id)
      .eq("quotation.status", "accepted")
      .gte("quotation.sent_at", yearAgo)
      .not("product_id", "is", null)
      .limit(20000),
  ]);
  const quotes = (qData ?? []) as unknown as Quote[];
  const pos = (poData ?? []) as unknown as Po[];
  const products = new Map((prodData ?? []).map((p) => [p.id, p]));

  // 1. Quotation conversion, by salesperson and by client.
  type Conv = { key: string; name: string; sent: number; won: number; lost: number; value: number };
  const bySeller = new Map<string, Conv>();
  const byClient = new Map<string, Conv>();
  const names = await namesFor(supabase, quotes.map((q) => q.created_by));
  for (const q of quotes) {
    const add = (m: Map<string, Conv>, key: string, name: string) => {
      const c = m.get(key) ?? { key, name, sent: 0, won: 0, lost: 0, value: 0 };
      c.sent += 1;
      if (q.status === "accepted") {
        c.won += 1;
        c.value += Number(q.total) * Number(q.exchange_rate);
      }
      if (q.status === "rejected") c.lost += 1;
      m.set(key, c);
    };
    add(bySeller, q.created_by ?? "", (q.created_by && names.get(q.created_by)) || tr("Unknown"));
    if (q.client) add(byClient, q.client.id, q.client.name);
  }
  const sellers = [...bySeller.values()].sort((a, b) => b.value - a.value);
  const clients = [...byClient.values()].filter((c) => c.sent >= 2).sort((a, b) => b.won / b.sent - a.won / a.sent || b.value - a.value).slice(0, 10);
  const totalWon = quotes.filter((q) => q.status === "accepted").length;

  // 2. Supplier delivery on time (first goods received note vs the expected date).
  type Sup = { name: string; orders: number; onTime: number; lateDays: number };
  const bySupplier = new Map<string, Sup>();
  for (const p of pos) {
    if (!p.supplier || !p.expected_date || p.grns.length === 0) continue;
    const first = p.grns.map((g) => g.received_on).sort()[0];
    const late = Math.round((Date.parse(first) - Date.parse(p.expected_date)) / DAY);
    const s = bySupplier.get(p.supplier.id) ?? { name: p.supplier.name, orders: 0, onTime: 0, lateDays: 0 };
    s.orders += 1;
    if (late <= 0) s.onTime += 1;
    else s.lateDays += late;
    bySupplier.set(p.supplier.id, s);
  }
  const suppliers = [...bySupplier.values()].sort((a, b) => a.onTime / a.orders - b.onTime / b.orders || b.orders - a.orders);

  // 3. Slow-moving stock: in stock, nothing dispatched in 90 days.
  const qty = new Map<string, number>();
  for (const s of ohData ?? []) qty.set(s.product_id, (qty.get(s.product_id) ?? 0) + Number(s.quantity));
  const movedSet = new Set((moved ?? []).map((m) => m.product_id));
  const cost = new Map((costs ?? []).map((c) => [c.product_id, Number(c.last_cost ?? 0)]));
  const slow = [...qty.entries()]
    .filter(([id, q]) => q > 0 && !movedSet.has(id) && products.has(id))
    .map(([id, q]) => ({ id, q, value: q * (cost.get(id) ?? 0), p: products.get(id)! }))
    .sort((a, b) => b.value - a.value);
  const slowValue = slow.reduce((s, r) => s + r.value, 0);

  // 4. Bought together: product pairs on the same accepted quotation.
  const perQuote = new Map<string, Set<string>>();
  for (const l of (wonLines ?? []) as { quotation_id: string; product_id: string }[]) {
    const set = perQuote.get(l.quotation_id) ?? new Set<string>();
    set.add(l.product_id);
    perQuote.set(l.quotation_id, set);
  }
  const pairs = new Map<string, number>();
  for (const set of perQuote.values()) {
    const ids = [...set].sort();
    if (ids.length > 30) continue;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.set(`${ids[i]}|${ids[j]}`, (pairs.get(`${ids[i]}|${ids[j]}`) ?? 0) + 1);
  }
  const topPairs = [...pairs.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, n]) => {
      const [a, b] = k.split("|");
      return { a: products.get(a), b: products.get(b), n };
    });

  return (
    <>
      <h1>{tr("Business insights")}</h1>
      <p className="muted small">{tr("The last 12 months, from your own records. Use it to decide where to push and what to fix.")}</p>

      <section className="card">
        <h2>{tr("Quotations won")}</h2>
        <p className="small muted">
          {quotes.length} {tr("sent")} · {totalWon} {tr("won")} · {pct(totalWon, quotes.length)}
        </p>
        {sellers.length === 0 ? (
          <p className="muted small">{tr("No quotations sent in the last 12 months.")}</p>
        ) : (
          <table className="compare">
            <thead>
              <tr>
                <th>{tr("Salesperson")}</th>
                <th>{tr("Sent")}</th>
                <th>{tr("Won")}</th>
                <th>{tr("Win rate")}</th>
                <th>{tr("Value won")}</th>
              </tr>
            </thead>
            <tbody>
              {sellers.map((s) => (
                <tr key={s.key}>
                  <td>{s.name}</td>
                  <td>{s.sent}</td>
                  <td>{s.won}</td>
                  <td>{pct(s.won, s.sent)}</td>
                  <td>{formatMoney(s.value, base)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {clients.length > 0 && (
          <>
            <h3 style={{ marginTop: 16 }}>{tr("By client")}</h3>
            <table className="compare">
              <thead>
                <tr>
                  <th>{tr("Client")}</th>
                  <th>{tr("Sent")}</th>
                  <th>{tr("Win rate")}</th>
                  <th>{tr("Value won")}</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <Link href={`/clients/${c.key}`}>{c.name}</Link>
                    </td>
                    <td>{c.sent}</td>
                    <td>{pct(c.won, c.sent)}</td>
                    <td>{formatMoney(c.value, base)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="card">
        <h2>{tr("Supplier delivery on time")}</h2>
        {suppliers.length === 0 ? (
          <p className="muted small">{tr("No received purchase orders with an expected date yet.")}</p>
        ) : (
          <table className="compare">
            <thead>
              <tr>
                <th>{tr("Supplier")}</th>
                <th>{tr("Orders")}</th>
                <th>{tr("On time")}</th>
                <th>{tr("Average days late")}</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.name}>
                  <td>{s.name}</td>
                  <td>{s.orders}</td>
                  <td className={s.onTime / s.orders < 0.7 ? "text-warn" : undefined}>{pct(s.onTime, s.orders)}</td>
                  <td>{s.orders - s.onTime > 0 ? Math.round(s.lateDays / (s.orders - s.onTime)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h2>{tr("Slow-moving stock")}</h2>
        <p className="small muted">
          {tr("In stock, but nothing dispatched in 90 days")}: {slow.length} {tr("products")} · {formatMoney(slowValue, base)} {tr("at last cost")}
        </p>
        {slow.length > 0 && (
          <ul className="list">
            {slow.slice(0, 15).map((r) => (
              <li key={r.id} className="row">
                <Link href={`/stock/${r.id}`}>{r.p.name}</Link>
                <span className="small muted">
                  {fmtQty(r.q)} {r.p.unit} · {formatMoney(r.value, base)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>{tr("Often bought together")}</h2>
        <p className="small muted">{tr("Products won on the same quotation. When a client asks for one, offer the other.")}</p>
        {topPairs.length === 0 ? (
          <p className="muted small">{tr("Not enough won quotations yet.")}</p>
        ) : (
          <ul className="list">
            {topPairs.map((r, i) => (
              <li key={i} className="row">
                <span>
                  {r.a?.name} + {r.b?.name}
                </span>
                <span className="small muted">
                  {r.n} {tr("times")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
