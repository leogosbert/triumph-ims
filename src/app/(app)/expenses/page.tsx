import { EmptyState } from "@/components/EmptyState";
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
import { BackLink } from "@/components/BackLink";
import { FilterChips } from "@/components/lists/FilterChips";
import { ListSort } from "@/components/lists/ListSort";
import { listHref, readSort, sortLinks, type SortOption } from "@/lib/list-view";

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

const SORTS: SortOption[] = [
  { key: "date", label: "Date", col: "spent_on", dir: "desc" },
  { key: "amount", label: "Amount", col: "amount", dir: "desc" },
  { key: "payee", label: "Paid to", col: "payee", dir: "asc" },
];
const SHOW = ["all", "mine", "noreceipt"] as const;

export default async function ExpensesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const m = monthRange(typeof sp.m === "string" ? sp.m : null);
  const cat = typeof sp.cat === "string" ? sp.cat : "";
  const { supabase, company, roles, user } = await getAppContext();
  const manage = can(roles, "manageExpenses");
  const sort = readSort(sp, SORTS, "date");
  // People who are not managers only ever see their own, so "Mine" is for managers.
  const show = SHOW.find((s) => s === sp.show && (s !== "mine" || manage)) ?? "all";
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
    .order(sort.opt.col ?? "spent_on", { ascending: sort.ascending, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(2000);
  if (!manage || show === "mine") q = q.eq("created_by", user.id);
  if (show === "noreceipt") q = q.is("receipt_path", null);
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
      {can(roles, "seeFinance") && (
        <BackLink href="/finance" label="Finance" />
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
          {show !== "all" && <input type="hidden" name="show" value={show} />}
          {sort.explicit && <input type="hidden" name="sort" value={sort.key} />}
          {sort.explicit && <input type="hidden" name="dir" value={sort.dir} />}
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

      <FilterChips
        list="expenses"
        label="Show"
        current={show}
        explicit={typeof sp.show === "string"}
        chips={[
          { key: "all", label: manage ? "All" : "All mine", href: listHref("/expenses", sp, { show: null }) },
          ...(manage ? [{ key: "mine", label: "Mine", href: listHref("/expenses", sp, { show: "mine" }) }] : []),
          { key: "noreceipt", label: "No receipt photo", href: listHref("/expenses", sp, { show: "noreceipt" }) },
        ]}
      />
      {rows.length > 1 && <ListSort links={sortLinks("/expenses", sp, SORTS, sort)} />}
      {rows.length === 0 ? (
        {show === "all" ? (
          <EmptyState
            icon="cash"
            text="No expenses recorded for this month. Record rent, fuel, airtime and other spending here."
            action={{ href: "/expenses/new", label: "Record an expense" }}
          />
        ) : (
          <p className="card muted">{tr("Nothing here for this month.")}</p>
        )}
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
