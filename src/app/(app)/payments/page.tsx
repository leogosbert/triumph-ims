import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { monthRange, n, PAY_METHODS } from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";

export const metadata = { title: "Payments received" };

type Row = {
  id: string;
  number: string;
  received_on: string;
  amount: number;
  currency: string;
  exchange_rate: number;
  method: string;
  reference: string | null;
  voided_at: string | null;
  client: { name: string } | null;
  invoice: { id: string; number: string } | null;
};

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const m = monthRange(typeof sp.m === "string" ? sp.m : null);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeInvoices")) redirect("/");

  const { data, error } = await supabase
    .from("payments")
    .select("id, number, received_on, amount, currency, exchange_rate, method, reference, voided_at, client:clients(name), invoice:invoices(id, number)")
    .eq("company_id", company.id)
    .gte("received_on", m.start)
    .lt("received_on", m.next)
    .order("received_on", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const total = rows.filter((r) => !r.voided_at).reduce((s, r) => s + n(r.amount) * n(r.exchange_rate), 0);

  return (
    <>
      <p className="small">
        <Link href="/finance">{tr("← Finance")}</Link>
      </p>
      <h1>{tr("Payments received")}</h1>
      <nav className="tabs-row" aria-label={tr("Month")}>
        <Link href={`/payments?m=${m.prev}`}>{tr("← Earlier")}</Link>
        <Link href={`/payments?m=${m.month}`} aria-current="page">
          {tr(String(m.label ?? ""))}
        </Link>
        {!m.isCurrent && <Link href={`/payments?m=${m.after}`}>{tr("Later →")}</Link>}
      </nav>
      <div className="stat-grid">
        <div className="stat">
          <div className="n">{formatMoney(total, company.base_currency)}</div>
          <div className="l">{tr("Collected in")}{" "}{tr(String(m.label ?? ""))}</div>
        </div>
        <div className="stat">
          <div className="n">{rows.filter((r) => !r.voided_at).length}</div>
          <div className="l">{tr("Payments")}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="card muted">{tr("No payments recorded in")}{" "}{tr(String(m.label ?? ""))}{tr(". Record payments on the invoice they pay.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={r.invoice ? `/invoices/${r.invoice.id}#payments` : "#"}>
                <div className="main">
                  <div className="title" style={r.voided_at ? { textDecoration: "line-through" } : undefined}>
                    {r.client?.name}
                  </div>
                  <div className="sub">
                    {formatDate(r.received_on)} · {r.number} · {r.invoice?.number} · {PAY_METHODS[r.method] ?? r.method}
                    {r.reference ? ` · ${r.reference}` : ""}
                    {r.voided_at ? tr(" · voided") : ""}
                  </div>
                </div>
                <div className="side">{formatMoney(r.amount, r.currency)}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
