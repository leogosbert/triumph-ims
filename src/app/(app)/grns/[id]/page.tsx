import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { fmtQty } from "@/lib/stock";

export const metadata = { title: "Goods received" };

type L = { id: string; description: string; quantity: number; unit: string; batch_no: string; expiry_date: string | null; condition: string };

export default async function GrnPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "receiveGoods") && role !== "finance") redirect("/");
  const { data: g } = await supabase
    .from("goods_receipts")
    .select("*, po:purchase_orders(id, number, supplier:suppliers(name)), store:warehouses(name)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!g) notFound();
  const { data } = await supabase.from("grn_lines").select("id, description, quantity, unit, batch_no, expiry_date, condition").eq("grn_id", id);
  const lines = (data ?? []) as L[];
  const names = await namesFor(supabase, [g.received_by]);

  return (
    <>
      <p className="small">
        <Link href="/receiving">← Receive goods</Link> · <Link href={`/purchase-orders/${g.po?.id}`}>{g.po?.number}</Link>
      </p>
      <h1>{g.number}</h1>
      <p className="muted small">
        From {g.po?.supplier?.name} into {g.store?.name} on {formatDate(g.received_on)}
        {g.received_by && <> by {names.get(g.received_by)}</>}
        {g.supplier_delivery_note && <> · their DN {g.supplier_delivery_note}</>}
      </p>
      <Notice {...notice} />
      {g.notes && <p className="card">{g.notes}</p>}
      <section className="card">
        <ul className="lines">
          {lines.map((l) => (
            <li key={l.id} className="line-head">
              <div>
                <div className="desc">{l.description}</div>
                <div className="muted small">
                  {l.batch_no ? `Batch ${l.batch_no}` : "No batch"}
                  {l.expiry_date ? ` · expires ${formatDate(l.expiry_date)}` : ""}
                  {l.condition === "damaged" && <span className="text-warn"> · damaged, not in stock</span>}
                </div>
              </div>
              <strong>
                {fmtQty(l.quantity)} {l.unit}
              </strong>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
