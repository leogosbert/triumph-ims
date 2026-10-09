import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext, stage13Ready } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { MONTHS_SHORT } from "@/lib/finance";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { loadPnlMonths, type Pnl } from "@/lib/pnl";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/sales";
import { saveBudget } from "./actions";

export const metadata = { title: "Budgets vs actual" };

type Budget = { month: number; measure: string; category_id: string | null; amount: number };
type Line = { key: string; label: string; actual: (p: Pnl) => number; /** true when more is better (sales, profit). */ up: boolean };

const MAIN: Line[] = [
  { key: "sales", label: "Sales (before VAT)", actual: (p) => p.sales, up: true },
  { key: "gross_profit", label: "Gross profit", actual: (p) => p.gross, up: true },
  { key: "expenses", label: "Expenses (before VAT)", actual: (p) => p.expenses, up: false },
  { key: "net_profit", label: "Net profit", actual: (p) => p.net, up: true },
];

export default async function BudgetsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "planFinance")) redirect("/");
  const today = todayTz();
  const thisYear = Number(today.slice(0, 4));
  const year = typeof sp.y === "string" && /^\d{4}$/.test(sp.y) ? Number(sp.y) : thisYear;
  const base = company.base_currency;

  const { data: bData, error } = await supabase.from("budgets").select("month, measure, category_id, amount").eq("company_id", company.id).eq("year", year);
  if (isMissingTable(error)) return <NotReady title="Budgets vs actual" />;
  if (error) throw new Error(error.message);
  const ready = stage13Ready(company);
  const [months, { data: catData }] = await Promise.all([
    loadPnlMonths(supabase, company.id, year, ready),
    supabase.from("expense_categories").select("id, name, active").eq("company_id", company.id).order("sort"),
  ]);
  const budgets = (bData ?? []) as Budget[];
  const cats = (catData ?? []) as { id: string; name: string; active: boolean }[];
  const catLines: Line[] = cats
    .filter((c) => budgets.some((b) => b.category_id === c.id))
    .map((c) => ({ key: `cat:${c.id}`, label: c.name, actual: (p) => p.byCategory.get(c.id) ?? 0, up: false }));
  const lines = [...MAIN, ...catLines];
  const selectedKey = typeof sp.line === "string" ? sp.line : "sales";
  const extraCat = selectedKey.startsWith("cat:") ? cats.find((c) => `cat:${c.id}` === selectedKey) : undefined;
  const selected: Line =
    lines.find((l) => l.key === selectedKey) ??
    (extraCat ? { key: selectedKey, label: extraCat.name, actual: (p) => p.byCategory.get(extraCat.id) ?? 0, up: false } : MAIN[0]);

  const budgetOf = (key: string, month: number) => {
    const [measure, cat] = key.startsWith("cat:") ? ["expense_category", key.slice(4)] : [key, null];
    return budgets.find((b) => b.measure === measure && b.category_id === cat && b.month === month)?.amount;
  };
  // Year to date for the current year; the whole year otherwise.
  const upTo = year === thisYear ? Number(today.slice(5, 7)) : year < thisYear ? 12 : 0;
  const short = (v: number) => formatMoney(v, base).replace(`${base} `, "");
  const tone = (l: Line, budget: number, actual: number) => {
    if (!budget) return undefined;
    const behind = l.up ? actual < budget : actual > budget;
    return behind ? "text-warn" : "text-ok";
  };

  return (
    <>
      <p className="small">
        <Link href="/finance">{tr("← Finance")}</Link>
      </p>
      <h1>{tr("Budgets vs actual")}</h1>
      <nav className="tabs-row" aria-label={tr("Year")}>
        <Link href={`/budgets?y=${year - 1}&line=${encodeURIComponent(selected.key)}`}>← {year - 1}</Link>
        <Link href={`/budgets?y=${year}&line=${encodeURIComponent(selected.key)}`} aria-current="page">
          {year}
        </Link>
        <Link href={`/budgets?y=${year + 1}&line=${encodeURIComponent(selected.key)}`}>{year + 1} →</Link>
      </nav>
      <Notice {...notice} />

      <section className="card">
        <h2>
          {upTo === 12 ? tr("Whole year") : upTo === 0 ? tr("Not started yet") : `${tr("Year to date")} · ${tr("Jan")}–${tr(MONTHS_SHORT[upTo - 1])}`}{" "}
          <span className="small muted">({base})</span>
        </h2>
        <div style={{ overflowX: "auto" }}>
          <table className="compare">
            <thead>
              <tr>
                <th>{tr("Line")}</th>
                <th>{tr("Budget")}</th>
                <th>{tr("Actual")}</th>
                <th>{tr("Difference")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                let b = 0;
                let a = 0;
                let any = false;
                for (let i = 1; i <= Math.max(upTo, 0); i++) {
                  const v = budgetOf(l.key, i);
                  if (v != null) {
                    any = true;
                    b += Number(v);
                  }
                  a += l.actual(months[i - 1]);
                }
                return (
                  <tr key={l.key} style={l.key === selected.key ? { fontWeight: 700 } : undefined}>
                    <td>
                      <Link href={`/budgets?y=${year}&line=${encodeURIComponent(l.key)}`}>{l.key.startsWith("cat:") ? l.label : tr(l.label)}</Link>
                    </td>
                    <td>{any ? short(b) : "—"}</td>
                    <td>{short(a)}</td>
                    <td className={any ? tone(l, b, a) : undefined}>{any ? `${a - b >= 0 ? "+" : ""}${short(a - b)}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {cats.length > 0 && (
          <form method="get" className="inline-form" style={{ marginTop: 8 }}>
            <input type="hidden" name="y" value={year} />
            <select name="line" aria-label={tr("Expense category")} defaultValue="">
              <option value="" disabled>
                {tr("Budget for an expense category…")}
              </option>
              {cats
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={`cat:${c.id}`}>
                    {c.name}
                  </option>
                ))}
            </select>
            <button type="submit" className="btn btn-small">
              {tr("Open")}
            </button>
          </form>
        )}
      </section>

      <section className="card" id="edit">
        <h2>
          {selected.key.startsWith("cat:") ? selected.label : tr(selected.label)} · {year}
        </h2>
        <form action={saveBudget}>
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="line" value={selected.key} />
          <div style={{ overflowX: "auto" }}>
            <table className="compare">
              <thead>
                <tr>
                  <th>{tr("Month")}</th>
                  <th>{tr("Budget")}</th>
                  <th>{tr("Actual")}</th>
                  <th>{tr("Difference")}</th>
                </tr>
              </thead>
              <tbody>
                {MONTHS_SHORT.map((label, i) => {
                  const b = budgetOf(selected.key, i + 1);
                  const a = selected.actual(months[i]);
                  const started = year < thisYear || (year === thisYear && i + 1 <= upTo);
                  return (
                    <tr key={label}>
                      <td>{tr(label)}</td>
                      <td>
                        <input
                          name={`m${i + 1}`}
                          type="text"
                          inputMode="decimal"
                          defaultValue={b != null ? String(Number(b)) : ""}
                          aria-label={`${tr("Budget")} ${tr(label)}`}
                          style={{ width: 130 }}
                        />
                      </td>
                      <td>{started ? short(a) : "—"}</td>
                      <td className={started && b != null ? tone(selected, Number(b), a) : undefined}>
                        {started && b != null ? `${a - Number(b) >= 0 ? "+" : ""}${short(a - Number(b))}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="field" style={{ marginTop: 8 }}>
            <label htmlFor="same">{tr("Or the same amount every month")}</label>
            <input id="same" name="same" type="text" inputMode="decimal" placeholder={tr("e.g. 15,000,000")} />
          </div>
          <p className="small muted">{tr("Leave a month empty for no budget. Amounts are in")} {base}.</p>
          <SubmitButton>{tr("Save budget")}</SubmitButton>
        </form>
      </section>
    </>
  );
}
