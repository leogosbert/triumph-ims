import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext, stage13Ready } from "@/lib/context";
import { monthRange } from "@/lib/finance";
import { type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { loadPnl, type Pnl } from "@/lib/pnl";
import { can } from "@/lib/roles";

export const metadata = { title: "Profit & loss" };

export default async function ProfitLossPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const m = monthRange(typeof sp.m === "string" ? sp.m : null);
  const prev = monthRange(m.prev);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeProfit")) redirect("/");
  const base = company.base_currency;
  const ready = stage13Ready(company);
  const yearStart = `${m.month.slice(0, 4)}-01-01`;

  const [cur, last, ytd, { data: catData }] = await Promise.all([
    loadPnl(supabase, company.id, m.start, m.next, ready),
    loadPnl(supabase, company.id, prev.start, prev.next, ready),
    loadPnl(supabase, company.id, yearStart, m.next, ready),
    ready
      ? supabase.from("expense_categories").select("id, name, sort").eq("company_id", company.id).order("sort")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const cats = ((catData ?? []) as { id: string; name: string }[]).filter((c) => ytd.byCategory.has(c.id));
  const short = (v: number) => formatMoney(v, base).replace(`${base} `, "");
  const cols: { label: string; p: Pnl }[] = [
    { label: m.label, p: cur },
    { label: prev.label, p: last },
    { label: `${tr("Year to date")} ${m.month.slice(0, 4)}`, p: ytd },
  ];
  const pct = (p: Pnl, v: number) => (p.sales > 0 ? `${((v / p.sales) * 100).toFixed(1)}%` : "–");

  const Row = ({ label, get, strong, sub, neg }: { label: string; get: (p: Pnl) => number; strong?: boolean; sub?: boolean; neg?: boolean }) => (
    <tr className={strong ? "total" : undefined}>
      <td style={sub ? { paddingLeft: 20 } : undefined} className={sub ? "small muted" : undefined}>
        {strong ? <strong>{label}</strong> : label}
      </td>
      {cols.map((c) => {
        const v = get(c.p);
        return (
          <td key={c.label} className={strong && v < 0 ? "text-warn" : sub ? "small muted" : undefined}>
            {strong ? <strong>{short(v)}</strong> : neg && v ? `(${short(v)})` : short(v)}
          </td>
        );
      })}
    </tr>
  );

  return (
    <>
      <p className="small">
        <Link href="/finance">{tr("← Finance")}</Link>
      </p>
      <h1>{tr("Profit & loss")}</h1>
      <nav className="tabs-row" aria-label={tr("Month")}>
        <Link href={`/profit-loss?m=${m.prev}`}>{tr("← Earlier")}</Link>
        <Link href={`/profit-loss?m=${m.month}`} aria-current="page">
          {tr(m.label)}
        </Link>
        {!m.isCurrent && <Link href={`/profit-loss?m=${m.after}`}>{tr("Later →")}</Link>}
      </nav>

      <div className="stat-grid">
        <div className="stat">
          <div className="n">{formatMoney(cur.sales, base)}</div>
          <div className="l">{tr("Sales (before VAT)")}</div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(cur.gross, base)}</div>
          <div className="l">
            {tr("Gross profit")} · {pct(cur, cur.gross)}
          </div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(cur.expenses + cur.orderCosts, base)}</div>
          <div className="l">{tr("Expenses and order costs")}</div>
        </div>
        <div className="stat">
          <div className={`n ${cur.net < 0 ? "text-warn" : ""}`}>{formatMoney(cur.net, base)}</div>
          <div className="l">{cur.net < 0 ? tr("Loss") : tr("Net profit")}</div>
        </div>
      </div>

      {!ready && <div className="banner warn small">{tr("Expenses are not included yet: ask LeMo Tech to run the latest database update.")}</div>}
      {cur.linesWithoutCost > 0 && (
        <div className="banner warn small">
          {cur.linesWithoutCost} {tr("invoiced lines have no product cost, so profit is overstated.")}
        </div>
      )}

      <section className="card">
        <div className="scroll-x">
          <table className="compare">
            <thead>
              <tr>
                <th>{base}</th>
                {cols.map((c) => (
                  <th key={c.label}>{tr(c.label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <Row label={tr("Sales (before VAT)")} get={(p) => p.sales} />
              <Row label={tr("Cost of goods sold")} get={(p) => p.cogs} neg />
              <Row label={tr("Gross profit")} get={(p) => p.gross} strong />
              <Row label={tr("Order costs (transport, bank…)")} get={(p) => p.orderCosts} neg />
              <Row label={tr("Expenses (before VAT)")} get={(p) => p.expenses} neg />
              {cats.map((c) => (
                <Row key={c.id} label={tr(c.name)} get={(p) => p.byCategory.get(c.id) ?? 0} sub />
              ))}
              <Row label={tr("Net profit")} get={(p) => p.net} strong />
              <tr>
                <td className="small muted">{tr("Net margin")}</td>
                {cols.map((c) => (
                  <td key={c.label} className="small muted">
                    {pct(c.p, c.p.net)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <p className="small">
        <Link href="/profit">{tr("Profit by order, client and salesperson →")}</Link>
        {" · "}
        <Link href="/reports">{tr("Download as PDF or Excel in Reports →")}</Link>
      </p>
      <p className="small muted">
        {tr("A simple view for running the business, not a tax return. Sales are issued invoices by invoice date; expenses are counted on the date paid, without VAT. Supplier bills for stock are not expenses: their cost counts when the goods are sold. Freight, duty and clearing on purchase orders are part of the landed cost.")}
      </p>
    </>
  );
}
