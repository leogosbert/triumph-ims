import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { headline, monthStart, sourceHref, sourceLabel, toTbRows, yearStart } from "@/lib/ledger";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { todayTz } from "@/lib/services";
import { resyncBooks } from "./actions";
import { ledgerContext } from "./shared";

export const metadata = { title: "Accounts" };

type Check = {
  balanced: boolean;
  debits: number;
  credits: number;
  receivable_books: number;
  receivable_documents: number;
  payable_books: number;
  payable_documents: number;
  issues: number;
  closed_until: string | null;
};

type Issue = { id: string; source: string; source_id: string; error: string; created_at: string };

const PAGES: { href: string; title: string; sub: string }[] = [
  { href: "/accounts/profit-loss", title: "Profit & loss", sub: "Income, cost of sales, expenses and profit for any period" },
  { href: "/accounts/balance-sheet", title: "Balance sheet", sub: "What the business owns and owes on a date" },
  { href: "/accounts/trial-balance", title: "Trial balance", sub: "Every account with its debit or credit balance, for your accountant" },
  { href: "/accounts/vat", title: "VAT return", sub: "VAT on sales and purchases for a month, with the documents behind it" },
  { href: "/accounts/chart", title: "Chart of accounts", sub: "The accounts with their balances; add your own" },
  { href: "/accounts/journals", title: "Journals", sub: "Every entry in the books; post adjustments and opening balances" },
  { href: "/accounts/assets", title: "Fixed assets", sub: "Vehicles, machines and equipment with monthly depreciation" },
  { href: "/accounts/close", title: "Close the books", sub: "Lock finished months so nothing in them changes" },
];

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company } = await ledgerContext();
  const base = company.base_currency;
  const today = todayTz();

  const [chk, month, year, issuesRes] = await Promise.all([
    supabase.rpc("gl_check", { p_company: company.id }),
    supabase.rpc("gl_trial_balance", { p_company: company.id, p_from: monthStart(today), p_to: today }),
    supabase.rpc("gl_trial_balance", { p_company: company.id, p_from: yearStart(today), p_to: today }),
    supabase.from("gl_sync_issues").select("id, source, source_id, error, created_at").eq("company_id", company.id).order("created_at", { ascending: false }).limit(50),
  ]);
  if (isMissingTable(chk.error) || isMissingTable(issuesRes.error)) return <NotReady title="Accounts" />;
  if (chk.error) throw new Error(chk.error.message);
  if (month.error) throw new Error(month.error.message);
  if (year.error) throw new Error(year.error.message);
  const c = chk.data as Check;
  const m = headline(toTbRows(month.data));
  const y = headline(toTbRows(year.data));
  const issues = (issuesRes.data ?? []) as Issue[];

  // Supplier payments open their bill.
  const spIds = issues.filter((i) => i.source === "supplier_payments").map((i) => i.source_id);
  const billOf = new Map<string, string>();
  if (spIds.length) {
    const { data } = await supabase.from("supplier_payments").select("id, bill_id").in("id", spIds);
    for (const r of (data ?? []) as { id: string; bill_id: string }[]) billOf.set(r.id, r.bill_id);
  }

  const arDiff = Math.abs(Number(c.receivable_books) - Number(c.receivable_documents));
  const apDiff = Math.abs(Number(c.payable_books) - Number(c.payable_documents));
  const mismatch = arDiff > 1 || apDiff > 1;
  const healthy = c.balanced && !mismatch && Number(c.issues) === 0;

  const Resync = () => (
    <form action={resyncBooks}>
      <input type="hidden" name="back" value="/accounts" />
      <SubmitButton className="btn btn-small" pendingText={tr("Posting…")}>
        {tr("Post everything again")}
      </SubmitButton>
    </form>
  );

  const figures: { label: string; m?: number; y?: number; now?: number }[] = [
    { label: "Sales (before VAT)", m: m.sales, y: y.sales },
    { label: "Gross profit", m: m.grossProfit, y: y.grossProfit },
    { label: "Net profit", m: m.netProfit, y: y.netProfit },
  ];

  return (
    <>
      <div className="page-head">
        <h1>{tr("Accounts")}</h1>
        <Link href="/accounts/journals/new" className="btn btn-primary btn-small">
          {tr("+ Journal")}
        </Link>
      </div>
      <p className="muted small">
        {tr("The books keep themselves: every invoice, payment, supplier bill, expense and payroll is posted for you. Journals by hand are only for adjustments and opening balances.")}
      </p>
      <Notice {...notice} />

      {healthy ? (
        <p className="banner ok">
          {tr("The books balance and match your invoices and bills.")}
          {c.closed_until && (
            <>
              {" "}
              {tr("Closed until")} {formatDate(c.closed_until)}.
            </>
          )}
        </p>
      ) : (
        <>
          {!c.balanced && (
            <p className="banner bad">
              {tr("The books do not balance: total debits and total credits differ.")} {formatMoney(c.debits, base)} / {formatMoney(c.credits, base)}
            </p>
          )}
          {mismatch && (
            <div className="banner warn">
              <p style={{ marginTop: 0 }}>{tr("What clients and suppliers owe in the books differs from the open invoices and bills.")}</p>
              <p className="small">
                {tr("Clients in the books")}: {formatMoney(c.receivable_books, base)} · {tr("Open invoices")}: {formatMoney(c.receivable_documents, base)}
                <br />
                {tr("Suppliers in the books")}: {formatMoney(c.payable_books, base)} · {tr("Open bills")}: {formatMoney(c.payable_documents, base)}
              </p>
              <Resync />
            </div>
          )}
        </>
      )}

      {issues.length > 0 && (
        <section className="card">
          <h2>
            {tr("Posting problems")} <span className="badge tone-bad">{Number(c.issues)}</span>
          </h2>
          <p className="muted small">{tr("These documents are saved but could not be posted to the books. Fix the document, then post everything again.")}</p>
          <ul className="rec-list">
            {issues.map((i) => {
              const href = sourceHref(i.source, i.source_id, billOf);
              const body = (
                <>
                  <div className="main">
                    <div className="title">{tr(sourceLabel(i.source))}</div>
                    <div className="sub">{tr(i.error)}</div>
                  </div>
                  <div className="side small muted">{formatDate(i.created_at)}</div>
                </>
              );
              return <li key={i.id}>{href ? <Link href={href}>{body}</Link> : <div style={{ display: "flex", gap: 8 }}>{body}</div>}</li>;
            })}
          </ul>
          <div style={{ marginTop: 10 }}>
            <Resync />
          </div>
        </section>
      )}

      <section className="card">
        <h2>{tr("This month and this year")}</h2>
        <div className="scroll-x">
          <table className="compare rep-table">
            <thead>
              <tr>
                <th></th>
                <th className="num">{tr("This month")}</th>
                <th className="num">{tr("This year")}</th>
              </tr>
            </thead>
            <tbody>
              {figures.map((f) => (
                <tr key={f.label}>
                  <td>{tr(f.label)}</td>
                  <td className={`num${(f.m ?? 0) < 0 ? " text-warn" : ""}`}>{formatMoney(f.m, base)}</td>
                  <td className={`num${(f.y ?? 0) < 0 ? " text-warn" : ""}`}>{formatMoney(f.y, base)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="stat-grid">
        <Link href="/accounts/chart" className="stat">
          <div className="n">{formatMoney(y.money, base)}</div>
          <div className="l">{tr("Cash, bank and mobile money")}</div>
        </Link>
        <Link href="/accounts/balance-sheet" className="stat">
          <div className="n">{formatMoney(y.clientsOwe, base)}</div>
          <div className="l">{tr("Clients owe")}</div>
        </Link>
        <Link href="/accounts/balance-sheet" className="stat">
          <div className="n">{formatMoney(y.weOwe, base)}</div>
          <div className="l">{tr("We owe suppliers")}</div>
        </Link>
        <Link href="/accounts/vat" className={`stat${y.vatToPay > 0 ? " alert" : ""}`}>
          <div className="n">{formatMoney(y.vatToPay, base)}</div>
          <div className="l">{tr(y.vatToPay < 0 ? "VAT to claim back" : "VAT to pay")}</div>
        </Link>
      </div>
      <p className="muted small">
        {tr("Books closed until")}: {c.closed_until ? formatDate(c.closed_until) : tr("not closed yet")} ·{" "}
        <Link href="/accounts/close">{tr("Close the books")}</Link>
      </p>

      <ul className="rec-list">
        {PAGES.map((p) => (
          <li key={p.href}>
            <Link href={p.href}>
              <div className="main">
                <div className="title">{tr(p.title)}</div>
                <div className="sub">{tr(p.sub)}</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
