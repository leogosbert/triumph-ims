import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { PO_STATUS } from "@/lib/purchasing";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";

export const metadata = { title: "Receive goods" };

type Po = { id: string; number: string; status: string; expected_date: string | null; supplier: { name: string } | null };
type Grn = { id: string; number: string; received_on: string; po: { number: string; supplier: { name: string } | null } | null };

export default async function ReceivingPage() {
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "receiveGoods")) redirect("/");
  const today = todayTz();
  const [{ data: poData }, { data: grnData }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, number, status, expected_date, supplier:suppliers(name)")
      .eq("company_id", company.id)
      .in("status", ["approved", "sent", "confirmed", "partially_received"])
      .order("expected_date", { ascending: true, nullsFirst: false })
      .limit(100),
    supabase
      .from("goods_receipts")
      .select("id, number, received_on, po:purchase_orders(number, supplier:suppliers(name))")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const pos = (poData ?? []) as unknown as Po[];
  const grns = (grnData ?? []) as unknown as Grn[];

  return (
    <>
      <p className="small">
        <Link href="/stock">← Stock</Link>
      </p>
      <h1>Receive goods</h1>
      <p className="muted small">Choose the purchase order the delivery belongs to. Check quantities against the supplier&apos;s delivery note.</p>
      {pos.length === 0 ? (
        <p className="card muted">No purchase orders are waiting for delivery.</p>
      ) : (
        <ul className="rec-list">
          {pos.map((p) => (
            <li key={p.id}>
              <Link href={`/purchase-orders/${p.id}/receive`}>
                <div className="main">
                  <div className="title">{p.supplier?.name}</div>
                  <div className="sub">
                    {p.number}
                    {p.expected_date && (
                      <span className={p.expected_date < today ? "text-warn" : undefined}> · due {formatDate(p.expected_date)}</span>
                    )}
                  </div>
                </div>
                <div className="side">
                  <StatusBadge map={PO_STATUS} status={p.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {grns.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Recently received</h2>
          <ul className="list">
            {grns.map((g) => (
              <li key={g.id} className="row">
                <Link href={`/grns/${g.id}`}>
                  {g.number} · {g.po?.supplier?.name}
                </Link>
                <span className="small muted">
                  {formatDate(g.received_on)} · {g.po?.number}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
