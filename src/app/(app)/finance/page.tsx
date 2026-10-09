import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext, stage13Ready } from "@/lib/context";
import { daysOverdue, monthRange, n, openBase } from "@/lib/finance";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";

export const metadata = { title: "Finance" };

type Inv = { id: string; number: string; total: number; amount_paid: number; exchange_rate: number; currency: string; due_date: string | null; client: { name: string } | null };

export default async function FinancePage() {
  await primeLang();
  const { supabase, company, role, features } = await getAppContext();
  const ready13 = stage13Ready(company);
  if (!can(role, "seeFinance")) redirect(can(role, "seeInvoices") ? "/invoices" : "/");
  const base = company.base_currency;
  const m = monthRange();

  const [{ data: openInv }, { data: bills }, { data: issued }, { data: paid }, { count: drafts }, { data: delivered }, { data: invoicedDn }] =
    await Promise.all([
      supabase
        .from("invoices")
        .select("id, number, total, amount_paid, exchange_rate, currency, due_date, client:clients(name)")
        .eq("company_id", company.id)
        .in("status", ["issued", "partly_paid"])
        .limit(5000),
      supabase
        .from("supplier_bills")
        .select("total, amount_paid, exchange_rate, due_date")
        .eq("company_id", company.id)
        .in("status", ["open", "partly_paid"])
        .limit(5000),
      supabase
        .from("invoices")
        .select("subtotal, exchange_rate")
        .eq("company_id", company.id)
        .in("status", ["issued", "partly_paid", "paid"])
        .gte("issue_date", m.start)
        .lt("issue_date", m.next)
        .limit(5000),
      supabase
        .from("payments")
        .select("amount, exchange_rate")
        .eq("company_id", company.id)
        .is("voided_at", null)
        .gte("received_on", m.start)
        .lt("received_on", m.next)
        .limit(5000),
      supabase.from("invoices").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("status", "draft"),
      supabase.from("deliveries").select("id").eq("company_id", company.id).eq("status", "delivered").limit(2000),
      supabase.from("invoices").select("delivery_id").eq("company_id", company.id).neq("status", "cancelled").not("delivery_id", "is", null),
    ]);
  const [{ data: spent }, { count: toCheck }] = ready13
    ? await Promise.all([
        supabase
          .from("expenses")
          .select("amount, exchange_rate")
          .eq("company_id", company.id)
          .is("voided_at", null)
          .gte("spent_on", m.start)
          .lt("spent_on", m.next)
          .limit(5000),
        supabase
          .from("payments")
          .select("id", { count: "exact", head: true })
          .eq("company_id", company.id)
          .eq("method", "mobile_money")
          .is("voided_at", null)
          .is("reconciled_at", null),
      ])
    : [{ data: [] }, { count: 0 }];
  const expensesMonth = ((spent ?? []) as { amount: number; exchange_rate: number }[]).reduce((s, e) => s + n(e.amount) * n(e.exchange_rate), 0);

  const inv = (openInv ?? []) as unknown as Inv[];
  const owed = inv.reduce((s, i) => s + openBase(i), 0);
  const late = inv.filter((i) => daysOverdue(i.due_date) > 0);
  const lateSum = late.reduce((s, i) => s + openBase(i), 0);
  const billRows = (bills ?? []) as { total: number; amount_paid: number; exchange_rate: number; due_date: string | null }[];
  const weOwe = billRows.reduce((s, b) => s + openBase(b), 0);
  const dueSoon = billRows.filter((b) => b.due_date && daysOverdue(b.due_date) >= -7).reduce((s, b) => s + openBase(b), 0);
  const sales = ((issued ?? []) as { subtotal: number; exchange_rate: number }[]).reduce((s, i) => s + n(i.subtotal) * n(i.exchange_rate), 0);
  const collected = ((paid ?? []) as { amount: number; exchange_rate: number }[]).reduce((s, p) => s + n(p.amount) * n(p.exchange_rate), 0);
  const done = new Set(((invoicedDn ?? []) as { delivery_id: string }[]).map((r) => r.delivery_id));
  const toInvoice = ((delivered ?? []) as { id: string }[]).filter((d) => !done.has(d.id)).length;

  const Tile = ({ href, title, sub }: { href: string; title: string; sub: string }) => (
    <Link href={href} className="tile">
      <div className="tile-title">{title}</div>
      <div className="tile-sub">{sub}</div>
    </Link>
  );

  return (
    <>
      <h1>{tr("Finance")}</h1>
      <div className="stat-grid">
        <Link href="/receivables" className="stat">
          <div className="n">{formatMoney(owed, base)}</div>
          <div className="l">{tr("Owed to us")}</div>
        </Link>
        <Link href="/invoices?tab=overdue" className={`stat ${lateSum > 0 ? "alert" : ""}`}>
          <div className="n">{formatMoney(lateSum, base)}</div>
          <div className="l">{tr("Overdue ·")}{" "}{late.length}{" "}{tr("invoice")}{late.length === 1 ? "" : "s"}</div>
        </Link>
        <Link href="/payables" className="stat">
          <div className="n">{formatMoney(weOwe, base)}</div>
          <div className="l">{tr("We owe suppliers")}</div>
        </Link>
        <Link href="/bills" className={`stat ${dueSoon > 0 ? "alert" : ""}`}>
          <div className="n">{formatMoney(dueSoon, base)}</div>
          <div className="l">{tr("To pay within 7 days (or late)")}</div>
        </Link>
        <Link href="/profit" className="stat">
          <div className="n">{formatMoney(sales, base)}</div>
          <div className="l">{tr("Invoiced in")}{" "}{tr(String(m.label ?? ""))}{" "}{tr("(before VAT)")}</div>
        </Link>
        <Link href="/payments" className="stat">
          <div className="n">{formatMoney(collected, base)}</div>
          <div className="l">{tr("Collected in")}{" "}{tr(String(m.label ?? ""))}</div>
        </Link>
        {ready13 && features.on("expenses") && (
          <Link href="/expenses" className="stat">
            <div className="n">{formatMoney(expensesMonth, base)}</div>
            <div className="l">
              {tr("Expenses in")} {tr(m.label)}
            </div>
          </Link>
        )}
        {ready13 && features.on("mobile_money") && (toCheck ?? 0) > 0 && (
          <Link href="/reconcile" className="stat alert">
            <div className="n">{toCheck}</div>
            <div className="l">{tr("Mobile-money payments to check")}</div>
          </Link>
        )}
      </div>

      {(toInvoice > 0 || (drafts ?? 0) > 0) && (
        <section className="card" style={{ borderColor: "#f0d49a" }}>
          <h2>{tr("To do")}</h2>
          <ul className="list">
            {toInvoice > 0 && (
              <li className="row">
                <Link href="/invoices/new">{tr("Delivered but not invoiced")}</Link>
                <strong>{toInvoice}</strong>
              </li>
            )}
            {(drafts ?? 0) > 0 && (
              <li className="row">
                <Link href="/invoices?tab=draft">{tr("Draft invoices to issue")}</Link>
                <strong>{drafts}</strong>
              </li>
            )}
          </ul>
        </section>
      )}

      {late.length > 0 && (
        <section className="card">
          <h2>{tr("Most overdue")}</h2>
          <ul className="list">
            {late
              .sort((a, b) => daysOverdue(b.due_date) - daysOverdue(a.due_date))
              .slice(0, 6)
              .map((i) => (
                <li key={i.id} className="row">
                  <Link href={`/invoices/${i.id}`}>
                    {i.client?.name} · {i.number}
                  </Link>
                  <span className="small">
                    {formatMoney(n(i.total) - n(i.amount_paid), i.currency)} · <span className="text-warn">{daysOverdue(i.due_date)}{" "}{tr("days")}</span>
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <div className="grid grid-2">
        <Tile href="/invoices" title={tr("Invoices")} sub={tr("Create, issue and share invoices")} />
        <Tile href="/payments" title={tr("Payments received")} sub={tr("Money in, with receipts")} />
        <Tile href="/receivables" title={tr("Money owed to us")} sub={tr("By client and how late (aging)")} />
        <Tile href="/bills" title={tr("Supplier bills")} sub={tr("Record and pay suppliers' invoices")} />
        <Tile href="/payables" title={tr("Money we owe")} sub={tr("By supplier and currency")} />
        {can(role, "seeProfit") && <Tile href="/profit" title={tr("Profit")} sub={tr("By order, client, industry, salesperson")} />}
        {features.on("expenses") && <Tile href="/expenses" title={tr("Expenses")} sub={tr("Rent, fuel, wages and other spending, with receipt photos")} />}
        {can(role, "seeProfit") && features.on("simple_pl") && (
          <Tile href="/profit-loss" title={tr("Profit & loss")} sub={tr("Sales, costs, expenses and net profit by month")} />
        )}
        {features.on("statements") && <Tile href="/statements" title={tr("Statements")} sub={tr("Client and supplier statements of account")} />}
        {features.on("mobile_money") && <Tile href="/reconcile" title={tr("Check payments")} sub={tr("Tick payments against the M-Pesa or bank statement")} />}
        <Tile href="/rates" title={tr("Exchange rates")} sub={tr("Company rates for USD, EUR and other currencies")} />
      </div>
    </>
  );
}
