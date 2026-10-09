import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/sales";
import { recordCash, removeCash } from "./actions";

export const metadata = { title: "Cash-flow forecast" };

type Week = { week_start: string; cash_in: number; bills_out: number; orders_out: number; expenses_out: number };
type Doc = { id: string; number: string; due_date: string | null; total: number; amount_paid: number; exchange_rate: number; party: { name: string } | null };

export default async function CashflowPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "planFinance")) redirect("/");
  const weeks = sp.w === "26" ? 26 : 13;
  const base = company.base_currency;
  const [{ data: wData, error }, { data: posData }, { data: invData }, { data: billData }] = await Promise.all([
    supabase.rpc("cashflow_forecast", { p_company: company.id, p_weeks: weeks }),
    supabase.from("cash_positions").select("id, as_of, amount, note").eq("company_id", company.id).order("as_of", { ascending: false }).order("created_at", { ascending: false }).limit(5),
    supabase
      .from("invoices")
      .select("id, number, due_date, total, amount_paid, exchange_rate, party:clients(name)")
      .eq("company_id", company.id)
      .in("status", ["issued", "partly_paid"])
      .order("due_date", { ascending: true })
      .limit(500),
    supabase
      .from("supplier_bills")
      .select("id, number, due_date, total, amount_paid, exchange_rate, party:suppliers(name)")
      .eq("company_id", company.id)
      .in("status", ["open", "partly_paid"])
      .order("due_date", { ascending: true })
      .limit(500),
  ]);
  if (error && /cashflow_forecast|cash_positions/.test(error.message)) return <NotReady title="Cash-flow forecast" />;
  if (error) throw new Error(error.message);
  const rows = (wData ?? []) as Week[];
  const positions = (posData ?? []) as { id: string; as_of: string; amount: number; note: string | null }[];
  const start = positions[0];
  let balance = Number(start?.amount ?? 0);
  const table = rows.map((w) => {
    const out = Number(w.bills_out) + Number(w.orders_out) + Number(w.expenses_out);
    const net = Number(w.cash_in) - out;
    balance += net;
    return { ...w, out, net, balance };
  });
  const firstShort = table.find((w) => w.balance < 0);
  const open = (d: Doc) => (Number(d.total) - Number(d.amount_paid)) * Number(d.exchange_rate);
  const bigIn = ((invData ?? []) as unknown as Doc[]).sort((a, b) => open(b) - open(a)).slice(0, 6);
  const bigOut = ((billData ?? []) as unknown as Doc[]).sort((a, b) => open(b) - open(a)).slice(0, 6);
  const today = todayTz();
  const short = (v: number) => formatMoney(v, base).replace(`${base} `, "");

  return (
    <>
      <p className="small">
        <Link href="/finance">{tr("← Finance")}</Link>
      </p>
      <h1>{tr("Cash-flow forecast")}</h1>
      <p className="muted small">
        {tr("Money expected in from unpaid invoices (by the promised or due date) and out to supplier bills, purchase orders not billed yet and your usual monthly expenses. Amounts in")} {base}.
      </p>
      <Notice {...notice} />

      <div className="stat-grid">
        <div className="stat">
          <div className="n">{start ? formatMoney(start.amount, base) : "—"}</div>
          <div className="l">
            {tr("Cash and bank")} {start ? `· ${formatDate(start.as_of)}` : `· ${tr("not entered yet")}`}
          </div>
        </div>
        <div className={`stat ${firstShort ? "alert" : ""}`}>
          <div className="n">{table.length ? formatMoney(table[table.length - 1].balance, base) : "—"}</div>
          <div className="l">
            {tr("Expected after")} {weeks} {tr("weeks")}
          </div>
        </div>
        <div className={`stat ${firstShort ? "alert" : ""}`}>
          <div className="n">{firstShort ? formatDate(firstShort.week_start) : tr("None")}</div>
          <div className="l">{tr("First week below zero")}</div>
        </div>
      </div>

      <form action={recordCash} className="card">
        <h2>{tr("Cash today")}</h2>
        <p className="small muted">{tr("Add up the bank accounts, mobile-money wallets and cash in hand. The forecast starts from the latest figure.")}</p>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="amount">
              {tr("Amount")} ({base})
            </label>
            <input id="amount" name="amount" type="text" inputMode="decimal" required />
          </div>
          <div className="field">
            <label htmlFor="as_of">{tr("Date")}</label>
            <input id="as_of" name="as_of" type="date" defaultValue={today} max={today} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="note">{tr("Note")}</label>
            <input id="note" name="note" type="text" maxLength={300} placeholder={tr("e.g. CRDB 12.4m, M-Pesa 1.1m, cash 0.3m")} />
          </div>
        </div>
        <SubmitButton className="btn btn-small">{tr("Save")}</SubmitButton>
        {positions.length > 0 && (
          <ul className="list small" style={{ marginTop: 8 }}>
            {positions.map((p) => (
              <li key={p.id} className="row">
                <span>
                  {formatDate(p.as_of)} · {formatMoney(p.amount, base)}
                  {p.note && <span className="muted"> · {p.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </form>
      {positions[0] && (
        <form action={removeCash} style={{ marginTop: -8, marginBottom: 16 }}>
          <input type="hidden" name="id" value={positions[0].id} />
          <button type="submit" className="btn btn-small">
            {tr("Remove the latest figure")}
          </button>
        </form>
      )}

      <section className="card">
        <div className="page-head" style={{ marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{tr("Week by week")}</h2>
          <nav className="tabs-row" aria-label={tr("Weeks")} style={{ margin: 0 }}>
            <Link href="/cashflow" aria-current={weeks === 13 ? "page" : undefined}>
              13
            </Link>
            <Link href="/cashflow?w=26" aria-current={weeks === 26 ? "page" : undefined}>
              26
            </Link>
          </nav>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="compare">
            <thead>
              <tr>
                <th>{tr("Week of")}</th>
                <th>{tr("In")}</th>
                <th>{tr("Bills")}</th>
                <th>{tr("Orders")}</th>
                <th>{tr("Expenses")}</th>
                <th>{tr("Balance")}</th>
              </tr>
            </thead>
            <tbody>
              {table.map((w) => (
                <tr key={w.week_start}>
                  <td>{formatDate(w.week_start)}</td>
                  <td className="text-ok">{short(w.cash_in)}</td>
                  <td>{short(w.bills_out)}</td>
                  <td>{short(w.orders_out)}</td>
                  <td>{short(w.expenses_out)}</td>
                  <td className={w.balance < 0 ? "text-warn" : undefined}>
                    <strong>{short(w.balance)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">{tr("Overdue invoices and bills are counted in the first week. A promised payment date from a reminder call is used when there is one.")}</p>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <h2>{tr("Largest amounts to collect")}</h2>
          {bigIn.length === 0 ? (
            <p className="muted small">{tr("Nothing owed to you.")}</p>
          ) : (
            <ul className="list">
              {bigIn.map((d) => (
                <li key={d.id} className="row">
                  <Link href={`/invoices/${d.id}`}>
                    {d.party?.name} · {d.number}
                  </Link>
                  <span className={`small ${d.due_date && d.due_date < today ? "text-warn" : "muted"}`}>
                    {short(open(d))} {d.due_date && `· ${formatDate(d.due_date)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>{tr("Largest bills to pay")}</h2>
          {bigOut.length === 0 ? (
            <p className="muted small">{tr("No unpaid supplier bills.")}</p>
          ) : (
            <ul className="list">
              {bigOut.map((d) => (
                <li key={d.id} className="row">
                  <Link href={`/bills/${d.id}`}>
                    {d.party?.name} · {d.number}
                  </Link>
                  <span className={`small ${d.due_date && d.due_date < today ? "text-warn" : "muted"}`}>
                    {short(open(d))} {d.due_date && `· ${formatDate(d.due_date)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
