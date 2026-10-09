import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { monthRange } from "@/lib/finance";
import { type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/sales";

export const metadata = { title: "Head-office figures" };

type Row = {
  branch_id: string | null;
  branch_name: string | null;
  sales: number;
  gross_profit: number;
  expenses: number;
  purchases: number;
  owed: number;
  stock_value: number;
  invoices: number;
  staff: number;
  stores: number;
};

const MEASURES = ["sales", "gross_profit", "expenses", "purchases", "owed", "stock_value"] as const;

function dayBefore(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default async function HeadOfficePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "planFinance")) redirect("/");
  const year = sp.y === "1";
  const m = monthRange(typeof sp.m === "string" ? sp.m : null);
  const today = todayTz();
  const from = year ? `${today.slice(0, 4)}-01-01` : m.start;
  const to = year ? today : dayBefore(m.next);
  const { data, error } = await supabase.rpc("branch_summary", { p_company: company.id, p_from: from, p_to: to });
  if (error && /branch_summary|branches/.test(error.message)) return <NotReady title="Head-office figures" />;
  if (error) throw new Error(error.message);
  const rows = ((data ?? []) as Row[]).map((r) => ({ ...r, net: Number(r.gross_profit) - Number(r.expenses) }));
  const total = rows.reduce(
    (t, r) => {
      for (const k of MEASURES) t[k] += Number(r[k]);
      t.net += r.net;
      t.invoices += Number(r.invoices);
      return t;
    },
    { sales: 0, gross_profit: 0, expenses: 0, purchases: 0, owed: 0, stock_value: 0, net: 0, invoices: 0 },
  );
  const base = company.base_currency;
  const money = (v: number) => formatMoney(v, base).replace(`${base} `, "");
  const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");
  const best = rows.filter((r) => r.branch_id).sort((a, b) => b.net - a.net)[0];

  return (
    <>
      <p className="small">
        <Link href="/branches">{tr("← Branches")}</Link>
      </p>
      <h1>{tr("Head-office figures")}</h1>
      <p className="muted small">
        {tr("Every branch side by side. Sales and profit are before VAT; money owed and stock are as of today. Amounts in")} {base}.
      </p>
      <nav className="tabs-row" aria-label={tr("Period")}>
        {!year && <Link href={`/head-office?m=${m.prev}`}>{tr("← Earlier")}</Link>}
        <Link href={`/head-office?m=${m.month}`} aria-current={!year ? "page" : undefined}>
          {tr(m.label)}
        </Link>
        {!year && !m.isCurrent && <Link href={`/head-office?m=${m.after}`}>{tr("Later →")}</Link>}
        <Link href="/head-office?y=1" aria-current={year ? "page" : undefined}>
          {tr("This year")}
        </Link>
      </nav>

      {rows.length === 0 || rows.every((r) => !r.branch_id) ? (
        <p className="card muted">
          {tr("No branches yet.")} <Link href="/branches">{tr("Add your branches")}</Link>
        </p>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat">
              <div className="n">{formatMoney(total.sales, base)}</div>
              <div className="l">{tr("Sales, all branches")}</div>
            </div>
            <div className="stat">
              <div className="n">{formatMoney(total.net, base)}</div>
              <div className="l">{tr("Profit after expenses")}</div>
            </div>
            {best && (
              <div className="stat">
                <div className="n">{best.branch_name}</div>
                <div className="l">{tr("Most profitable branch")}</div>
              </div>
            )}
          </div>
          <section className="card">
            <div className="scroll-x">
              <table className="compare">
                <thead>
                  <tr>
                    <th>{tr("Branch")}</th>
                    <th className="num">{tr("Sales")}</th>
                    <th className="num">{tr("Gross profit")}</th>
                    <th className="num">{tr("Margin")}</th>
                    <th className="num">{tr("Expenses")}</th>
                    <th className="num">{tr("Profit after expenses")}</th>
                    <th className="num">{tr("Purchases")}</th>
                    <th className="num">{tr("Clients owe")}</th>
                    <th className="num">{tr("Stock value")}</th>
                    <th className="num">{tr("Share of sales")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.branch_id ?? "none"}>
                      <td>
                        <strong>{r.branch_name ?? tr("No branch")}</strong>
                        <div className="muted small">
                          {r.invoices} {tr("invoices")} · {r.staff} {tr("people")} · {r.stores} {tr("stores")}
                        </div>
                      </td>
                      <td className="num">{money(r.sales)}</td>
                      <td className="num">{money(r.gross_profit)}</td>
                      <td className="num">{pct(Number(r.gross_profit), Number(r.sales))}</td>
                      <td className="num">{money(r.expenses)}</td>
                      <td className={`num ${r.net < 0 ? "text-warn" : ""}`}>{money(r.net)}</td>
                      <td className="num">{money(r.purchases)}</td>
                      <td className="num">{money(r.owed)}</td>
                      <td className="num">{money(r.stock_value)}</td>
                      <td className="num">{pct(Number(r.sales), total.sales)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>
                      <strong>{tr("Whole company")}</strong>
                    </td>
                    <td className="num">{money(total.sales)}</td>
                    <td className="num">{money(total.gross_profit)}</td>
                    <td className="num">{pct(total.gross_profit, total.sales)}</td>
                    <td className="num">{money(total.expenses)}</td>
                    <td className="num">{money(total.net)}</td>
                    <td className="num">{money(total.purchases)}</td>
                    <td className="num">{money(total.owed)}</td>
                    <td className="num">{money(total.stock_value)}</td>
                    <td className="num">100%</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="hint">{tr("Order costs (transport, bank charges) are not split by branch; see Profit & loss for the whole company.")}</p>
          </section>
        </>
      )}
    </>
  );
}
