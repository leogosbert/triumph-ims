import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AgingTable, type AgingRow } from "@/components/AgingTable";
import { getAppContext } from "@/lib/context";
import { agingBucket, daysOverdue, n, openBase } from "@/lib/finance";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";

export const metadata = { title: "Money we owe" };

type Bill = {
  total: number;
  amount_paid: number;
  exchange_rate: number;
  currency: string;
  due_date: string | null;
  supplier: { id: string; name: string } | null;
};

export default async function PayablesPage() {
  await primeLang();
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeFinance")) redirect("/");
  const { data, error } = await supabase
    .from("supplier_bills")
    .select("total, amount_paid, exchange_rate, currency, due_date, supplier:suppliers(id, name)")
    .eq("company_id", company.id)
    .in("status", ["open", "partly_paid"])
    .limit(5000);
  if (error) throw new Error(error.message);
  const bills = (data ?? []) as unknown as Bill[];

  const byCurrency = new Map<string, number>();
  const bySupplier = new Map<string, AgingRow>();
  let dueSoon = 0;
  for (const b of bills) {
    byCurrency.set(b.currency, (byCurrency.get(b.currency) ?? 0) + n(b.total) - n(b.amount_paid));
    const d = daysOverdue(b.due_date);
    if (b.due_date && d <= 0 && d >= -7) dueSoon += openBase(b);
    if (!b.supplier) continue;
    const row = bySupplier.get(b.supplier.id) ?? {
      id: b.supplier.id,
      name: b.supplier.name,
      href: `/suppliers/${b.supplier.id}`,
      buckets: [0, 0, 0, 0, 0],
    };
    row.buckets[agingBucket(b.due_date)] += openBase(b);
    bySupplier.set(b.supplier.id, row);
  }
  const rows = [...bySupplier.values()].sort((a, b) => b.buckets.reduce((x, y) => x + y, 0) - a.buckets.reduce((x, y) => x + y, 0));

  return (
    <>
      <p className="small">
        <Link href="/finance">{tr("← Finance")}</Link>
      </p>
      <h1>{tr("Money we owe")}</h1>
      <p className="muted small">{tr("Unpaid supplier bills. Totals are converted to")}{" "}{company.base_currency}{" "}{tr("at each bill's rate.")}</p>
      {byCurrency.size > 0 && (
        <div className="card">
          <h2>{tr("By currency")}</h2>
          <ul className="list">
            {[...byCurrency.entries()].map(([c, v]) => (
              <li key={c} className="row">
                <span>{c}</span>
                <strong>{formatMoney(v, c)}</strong>
              </li>
            ))}
          </ul>
          {dueSoon > 0 && <p className="small text-warn">{formatMoney(dueSoon, company.base_currency)}{" "}{tr("falls due in the next 7 days.")}</p>}
        </div>
      )}
      <AgingTable rows={rows} currency={company.base_currency} partyLabel="Supplier" />
      <p className="small">
        <Link href="/bills">{tr("See all supplier bills →")}</Link>
      </p>
    </>
  );
}
