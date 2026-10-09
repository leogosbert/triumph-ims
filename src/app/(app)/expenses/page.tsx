import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { getAppContext, stage13Ready } from "@/lib/context";
import { methodLabel, monthRange, n } from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";

export const metadata = { title: "Expenses" };

type Row = {
  id: string;
  number: string;
  spent_on: string;
  payee: string | null;
  description: string;
  amount: number;
  vat_amount: number;
  currency: string;
  exchange_rate: number;
  method: string;
  provider: string | null;
  receipt_path: string | null;
  voided_at: string | null;
  reconciled_at: string | null;
  category_id: string;
  created_by: string | null;
};

export default async function ExpensesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const m = monthRange(typeof sp.m === "string" ? sp.m : null);
  const cat = typeof sp.cat === "string" ? sp.cat : "";
  const { supabase, company, role, user } = await getAppContext();
  const manage = can(role, "manageExpenses");
  const base = company.base_currency;

  if (!stage13Ready(company)) {
    return (
      <>
        <h1>{tr("Expenses")}</h1>
        <p className="card muted">{tr("This is not available yet. Ask LeMo Tech to run the latest database update.")}</p>
      </>
    );
  }

  let q = supabase
    .from("expenses")
    .select("id, number, spent_on, payee, description, amount, vat_amount, currency, exchange_rate, method, provider, receipt_path, voided_at, reconciled_at, category_id, created_by")
    .eq("company_id", company.id)
    .gte("spent_on", m.start)
    .lt("spent_on", m.next)
    .order("spent_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2000);
  if (!manage) q = q.eq("created_by", user.id);
  if (cat) q = q.eq("category_id", cat);
  const [{ data, error }, { data: catData }] = await Promise.all([
    q,
    supabase.from("expense_categories").select("id, name, active, sort").eq("company_id", company.id).order("sort").order("name"),
  ]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const categories = (catData ?? []) as { id: string; name: string; active: boolean }[];
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const names = manage ? await namesFor(supabase, rows.map((r) => r.created_by)) : new Map<string, string>();

  const live = rows.filter((r) => !r.voided_at);
  const baseOf = (r: Row) => n(r.amount) * n(r.exchange_rate);
  const total = live.reduce((s, r) => s + baseOf(r), 0);
  const vat = live.reduce((s, r) => s + n(r.vat_amount) * n(r.exchange_rate), 0);
  const byCat = new Map<string, number>();
  for (const r of live) byCat.set(r.category_id, (byCat.get(r.category_id) ?? 0) + baseOf(r));
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const noReceipt = live.filter((r) => !r.receipt_path).length;
  const href = (month: string, c = cat) => `/expenses?m=${month}${c ? `&cat=${c}` : ""}`;

  return (
    <>
      {can(role, "seeFinance") && (
        <p className="small">
          <Link href="/finance">{tr("← Finance")}</Link>
        </p>
      )}
      <div className="page-head">
        <h1>{manage ? tr("Expenses") : tr("My expenses")}</h1>
        <Link href="/expenses/new" className="btn btn-primary btn-small">
          {tr("+ Expense")}
        </Link>
      </div>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Month")}>
        <Link href={href(m.prev)}>{tr("← Earlier")}</Link>
        <Link href={href(m.month)} aria-current="page">
          {tr(m.label)}
        </Link>
        {!m.isCurrent && <Link href={href(m.after)}>{tr("Later →")}</Link>}
      </nav>

      <div className="stat-grid">
        <div className="stat">
          <div className="n">{formatMoney(total, base)}</div>
          <div className="l">
            {cat ? tr(catName.get(cat) ?? "") : tr("Spent")} · {tr(m.label)}
          </div>
        </div>
        <div className="stat">
          <div className="n">{live.length}</div>
          <div className="l">{tr("Expenses")}</div>
        </div>
        {vat > 0 && (
          <div className="stat">
            <div className="n">{formatMoney(vat, base)}</div>
            <div className="l">{tr("of which VAT")}</div>
          </div>
        )}
        {noReceipt > 0 && (
          <div className="stat">
            <div className="n text-warn">{noReceipt}</div>
            <div className="l">{tr("without a receipt photo")}</div>
          </div>
        )}
      </div>

      {manage && catRows.length > 1 && !cat && (
        <section className="card">
          <h2>{tr("By category")}</h2>
          <div className="totals" style={{ maxWidth: "none" }}>
            {catRows.map(([id, v]) => (
              <div className="row" key={id}>
                <span>
                  <Link href={href(m.month, id)}>{tr(catName.get(id) ?? "")}</Link>
                </span>
                <span>
                  {formatMoney(v, base)} <span className="small muted">· {total > 0 ? Math.round((v / total) * 100) : 0}%</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {categories.length > 0 && (
        <form method="get" className="inline-form" style={{ margin: "8px 0" }}>
          <input type="hidden" name="m" value={m.month} />
          <select name="cat" defaultValue={cat} aria-label={tr("Spending category")}>
            <option value="">{tr("All categories")}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {tr(c.name)}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-small">
            {tr("Show")}
          </button>
          {manage && (
            <Link href="/expenses/categories" className="small">
              {tr("Edit categories")}
            </Link>
          )}
        </form>
      )}

      {rows.length === 0 ? (
        <p className="card muted">{tr("No expenses recorded for this month. Record rent, fuel, airtime and other spending with “+ Expense”.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/expenses/${r.id}`}>
                <div className="main">
                  <div className="title" style={r.voided_at ? { textDecoration: "line-through" } : undefined}>
                    {r.description}
                  </div>
                  <div className="sub">
                    {tr(catName.get(r.category_id) ?? "")} · {formatDate(r.spent_on)} · {tr(methodLabel(r.method, r.provider))}
                    {r.payee && ` · ${r.payee}`}
                    {manage && r.created_by && names.get(r.created_by) && ` · ${names.get(r.created_by)}`}
                  </div>
                </div>
                <div className="side">
                  <div>{formatMoney(r.amount, r.currency)}</div>
                  <div className="small muted">
                    {r.voided_at ? tr("Voided") : [r.receipt_path ? "📎" : "", r.reconciled_at ? "✓" : ""].filter(Boolean).join(" ") || r.number}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
