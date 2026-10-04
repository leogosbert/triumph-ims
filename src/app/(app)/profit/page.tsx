import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { monthRange, n } from "@/lib/finance";
import { type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { quoteNo } from "@/lib/sales";

export const metadata = { title: "Profit" };

type P = { invoice_id: string; client_id: string; quotation_id: string | null; revenue_base: number; cost_base: number; lines_without_cost: number };
type Group = { key: string; label: string; href?: string; sales: number; cost: number };

function add(map: Map<string, Group>, key: string, label: string, sales: number, cost: number, href?: string) {
  const g = map.get(key) ?? { key, label, href, sales: 0, cost: 0 };
  g.sales += sales;
  g.cost += cost;
  map.set(key, g);
}

function Table({ title, groups, base, minMargin }: { title: string; groups: Map<string, Group>; base: string; minMargin: number }) {
  const rows = [...groups.values()].sort((a, b) => b.sales - b.cost - (a.sales - a.cost));
  if (rows.length === 0) return null;
  const short = (v: number) => formatMoney(v, base).replace(`${base} `, "");
  return (
    <section className="card">
      <h2>{title}</h2>
      <div className="scroll-x">
        <table className="compare">
          <thead>
            <tr>
              <th>{title.replace("By ", "")}</th>
              <th>{tr("Sales")}</th>
              <th>{tr("Gross profit")}</th>
              <th>{tr("Margin")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => {
              const gp = g.sales - g.cost;
              const m = g.sales > 0 ? (gp / g.sales) * 100 : null;
              return (
                <tr key={g.key}>
                  <td>{g.href ? <Link href={g.href}>{tr(String(g.label ?? ""))}</Link> : g.label}</td>
                  <td>{short(g.sales)}</td>
                  <td>{short(gp)}</td>
                  <td className={m !== null && m < minMargin ? "text-warn" : undefined}>{m === null ? "–" : `${m.toFixed(1)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function ProfitPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const m = monthRange(typeof sp.m === "string" ? sp.m : null);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeProfit")) redirect("/");
  const base = company.base_currency;
  const minMargin = n(company.quote_min_margin_pct ?? 12);

  const [{ data: pData, error }, { data: costData }] = await Promise.all([
    supabase
      .from("invoice_profit")
      .select("invoice_id, client_id, quotation_id, revenue_base, cost_base, lines_without_cost")
      .eq("company_id", company.id)
      .gte("issue_date", m.start)
      .lt("issue_date", m.next)
      .limit(5000),
    supabase
      .from("order_costs")
      .select("quotation_id, amount, exchange_rate")
      .eq("company_id", company.id)
      .not("quotation_id", "is", null)
      .gte("incurred_on", m.start)
      .lt("incurred_on", m.next)
      .limit(5000),
  ]);
  if (error) throw new Error(error.message);
  const rows = (pData ?? []) as P[];
  const extras = (costData ?? []) as { quotation_id: string; amount: number; exchange_rate: number }[];

  const quoteIds = [...new Set([...rows.map((r) => r.quotation_id), ...extras.map((e) => e.quotation_id)].filter((x): x is string => !!x))];
  const [{ data: qData }, { data: cData }] = await Promise.all([
    quoteIds.length
      ? supabase.from("quotations").select("id, number, revision, client_id, created_by").in("id", quoteIds)
      : Promise.resolve({ data: [] }),
    supabase.from("clients").select("id, name, industry").eq("company_id", company.id).limit(5000),
  ]);
  const quotes = new Map(((qData ?? []) as { id: string; number: string; revision: number; client_id: string; created_by: string | null }[]).map((q) => [q.id, q]));
  const clients = new Map(((cData ?? []) as { id: string; name: string; industry: string | null }[]).map((c) => [c.id, c]));
  const names = await namesFor(supabase, [...quotes.values()].map((q) => q.created_by));

  const byClient = new Map<string, Group>();
  const byIndustry = new Map<string, Group>();
  const bySales = new Map<string, Group>();
  const byOrder = new Map<string, Group>();
  let sales = 0;
  let cogs = 0;
  let missing = 0;
  const book = (clientId: string, quotationId: string | null, s: number, c: number) => {
    const cl = clients.get(clientId);
    const q = quotationId ? quotes.get(quotationId) : null;
    add(byClient, clientId, cl?.name ?? "Client", s, c, `/clients/${clientId}`);
    add(byIndustry, cl?.industry ?? "Not set", cl?.industry ?? "Not set", s, c);
    const who = q?.created_by ?? "none";
    add(bySales, who, q?.created_by ? (names.get(q.created_by) ?? "Unknown") : "No quotation", s, c);
    if (q) add(byOrder, q.id, `${quoteNo(q)} · ${cl?.name ?? ""}`, s, c, `/quotations/${q.id}#profit`);
  };
  for (const r of rows) {
    sales += n(r.revenue_base);
    cogs += n(r.cost_base);
    missing += n(r.lines_without_cost);
    book(r.client_id, r.quotation_id, n(r.revenue_base), n(r.cost_base));
  }
  let other = 0;
  for (const e of extras) {
    const v = n(e.amount) * n(e.exchange_rate);
    other += v;
    const q = quotes.get(e.quotation_id);
    if (q) book(q.client_id, q.id, 0, v);
  }
  const gp = sales - cogs - other;

  return (
    <>
      <p className="small">
        <Link href="/finance">{tr("← Finance")}</Link>
      </p>
      <h1>{tr("Profit")}</h1>
      <nav className="tabs-row" aria-label={tr("Month")}>
        <Link href={`/profit?m=${m.prev}`}>{tr("← Earlier")}</Link>
        <Link href={`/profit?m=${m.month}`} aria-current="page">
          {tr(String(m.label ?? ""))}
        </Link>
        {!m.isCurrent && <Link href={`/profit?m=${m.after}`}>{tr("Later →")}</Link>}
      </nav>
      <div className="stat-grid">
        <div className="stat">
          <div className="n">{formatMoney(sales, base)}</div>
          <div className="l">{tr("Sales invoiced (before VAT)")}</div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(gp, base)}</div>
          <div className="l">{tr("Gross profit")}{" "}{sales > 0 && `· ${((gp / sales) * 100).toFixed(1)}%`}</div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(cogs, base)}</div>
          <div className="l">{tr("Cost of goods sold")}</div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(other, base)}</div>
          <div className="l">{tr("Other order costs (transport, bank…)")}</div>
        </div>
      </div>
      {missing > 0 && (
        <div className="banner warn small">
          {missing}{" "}{tr("invoiced line")}{missing === 1 ? tr(" has") : tr("s have")}{" "}{tr("no product cost, so profit is overstated. Set costs on the products (or confirm their purchase orders) before invoicing.")}</div>
      )}
      {rows.length === 0 && extras.length === 0 && <p className="card muted">{tr("No invoices issued in")}{" "}{tr(String(m.label ?? ""))}.</p>}
      <Table title={tr("By order")} groups={byOrder} base={base} minMargin={minMargin} />
      <Table title={tr("By client")} groups={byClient} base={base} minMargin={minMargin} />
      <Table title={tr("By industry")} groups={byIndustry} base={base} minMargin={minMargin} />
      <Table title={tr("By salesperson")} groups={bySales} base={base} minMargin={minMargin} />
      <p className="small muted">{tr("Sales are issued invoices in")}{" "}{tr(String(m.label ?? ""))}{tr(". Cost of goods uses each product's cost when the invoice was issued (landed cost if it was applied). Freight, duty and clearing on purchase orders are part of the landed cost; transport, bank charges and similar costs are added on the order.")}</p>
    </>
  );
}
