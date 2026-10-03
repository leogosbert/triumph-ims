import Link from "next/link";
import { redirect } from "next/navigation";
import { AgingTable, type AgingRow } from "@/components/AgingTable";
import { getAppContext } from "@/lib/context";
import { agingBucket, n, openBase } from "@/lib/finance";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";

export const metadata = { title: "Money owed to us" };

type Inv = {
  total: number;
  amount_paid: number;
  exchange_rate: number;
  due_date: string | null;
  client: { id: string; name: string; credit_limit: number } | null;
};

export default async function ReceivablesPage() {
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeFinance")) redirect("/");
  const { data, error } = await supabase
    .from("invoices")
    .select("total, amount_paid, exchange_rate, due_date, client:clients(id, name, credit_limit)")
    .eq("company_id", company.id)
    .in("status", ["issued", "partly_paid"])
    .limit(5000);
  if (error) throw new Error(error.message);

  const byClient = new Map<string, AgingRow & { limit: number }>();
  for (const i of (data ?? []) as unknown as Inv[]) {
    if (!i.client) continue;
    const row = byClient.get(i.client.id) ?? {
      id: i.client.id,
      name: i.client.name,
      href: `/clients/${i.client.id}#account`,
      buckets: [0, 0, 0, 0, 0],
      limit: n(i.client.credit_limit),
    };
    row.buckets[agingBucket(i.due_date)] += openBase(i);
    byClient.set(i.client.id, row);
  }
  const rows = [...byClient.values()]
    .map((r) => {
      const t = r.buckets.reduce((a, b) => a + b, 0);
      return { ...r, note: r.limit > 0 && t > r.limit ? `Over credit limit (${formatMoney(r.limit, company.base_currency)})` : null };
    })
    .sort((a, b) => b.buckets.reduce((x, y) => x + y, 0) - a.buckets.reduce((x, y) => x + y, 0));

  return (
    <>
      <p className="small">
        <Link href="/finance">← Finance</Link>
      </p>
      <h1>Money owed to us</h1>
      <p className="muted small">Unpaid invoices by client and how late they are. Foreign-currency invoices are shown in {company.base_currency} at their invoice rate.</p>
      <AgingTable rows={rows} currency={company.base_currency} partyLabel="Client" />
      <p className="small">
        <Link href="/invoices?tab=overdue">See overdue invoices →</Link>
      </p>
    </>
  );
}
