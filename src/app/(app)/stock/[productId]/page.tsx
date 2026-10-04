import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { daysUntil, fmtQty, storeOptions, type OnHand } from "@/lib/stock";

export const metadata = { title: "Stock card" };

type Move = {
  id: string;
  quantity: number;
  kind: string;
  batch_no: string;
  expiry_date: string | null;
  warehouse_id: string;
  grn_id: string | null;
  delivery_id: string | null;
  note: string | null;
  created_at: string;
};
const KIND: Record<string, string> = { receipt: "Received", dispatch: "Dispatched", return: "Returned", adjustment: "Adjusted" };

export default async function StockCardPage({ params, searchParams }: { params: Promise<{ productId: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { productId } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeStock")) redirect("/");

  const [{ data: product }, { data: ohData }, { data: mvData }, stores] = await Promise.all([
    supabase.from("products").select("id, sku, name, unit, reorder_level").eq("id", productId).eq("company_id", company.id).maybeSingle(),
    supabase.from("stock_on_hand").select("product_id, warehouse_id, batch_no, expiry_date, quantity").eq("product_id", productId),
    supabase
      .from("stock_movements")
      .select("id, quantity, kind, batch_no, expiry_date, warehouse_id, grn_id, delivery_id, note, created_at")
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .limit(100),
    storeOptions(supabase, company.id, false),
  ]);
  if (!product) notFound();
  const onHand = ((ohData ?? []) as OnHand[]).sort((a, b) => (a.expiry_date ?? "9999") < (b.expiry_date ?? "9999") ? -1 : 1);
  const moves = (mvData ?? []) as Move[];
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const total = onHand.reduce((s, r) => s + Number(r.quantity), 0);

  return (
    <>
      <p className="small">
        <Link href="/stock">{tr("← Stock")}</Link> · <Link href={`/products/${product.id}`}>{tr("Product details")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{product.name}</h1>
        <span className="badge">{product.sku}</span>
      </div>
      <p>
        <strong style={{ fontSize: "1.4rem" }}>{fmtQty(total)}</strong> {product.unit}{" "}{tr("in stock")}{product.reorder_level ? <span className="muted small">{" "}{tr("· reorder at")}{" "}{fmtQty(product.reorder_level)}</span> : null}
      </p>
      <Notice {...notice} />

      <section className="card">
        <h2>{tr("By store and batch")}</h2>
        {onHand.length === 0 ? (
          <p className="muted small">{tr("None in stock.")}</p>
        ) : (
          <ul className="list">
            {onHand.map((r) => {
              const d = r.expiry_date ? daysUntil(r.expiry_date) : null;
              return (
                <li key={`${r.warehouse_id}-${r.batch_no}`} className="row">
                  <div>
                    <strong>{storeName.get(r.warehouse_id)}</strong>
                    <div className="muted small">{tr("Batch")}{" "}{r.batch_no || "—"}
                      {r.expiry_date && (
                        <span className={d !== null && d <= 60 ? "text-warn" : undefined}>{" "}{tr("· expires")}{" "}{formatDate(r.expiry_date)}</span>
                      )}
                    </div>
                  </div>
                  <strong>
                    {fmtQty(r.quantity)} {product.unit}
                  </strong>
                </li>
              );
            })}
          </ul>
        )}
        {can(role, "adjustStock") && (
          <Link href={`/stock/adjust?product=${product.id}`} className="btn btn-small" style={{ marginTop: 12 }}>{tr("Adjust stock")}</Link>
        )}
      </section>

      <section className="card">
        <h2>{tr("Movements")}</h2>
        {moves.length === 0 ? (
          <p className="muted small">{tr("No movements yet.")}</p>
        ) : (
          <ul className="list">
            {moves.map((m) => (
              <li key={m.id} className="row">
                <div>
                  <strong>{KIND[m.kind] ?? m.kind}</strong>{" "}
                  {m.grn_id && can(role, "receiveGoods") && <Link href={`/grns/${m.grn_id}`} className="small">{tr("GRN")}</Link>}
                  {m.delivery_id && can(role, "seeDeliveries") && <Link href={`/deliveries/${m.delivery_id}`} className="small">{tr("Delivery")}</Link>}
                  <div className="muted small">
                    {formatDateTime(m.created_at)} · {storeName.get(m.warehouse_id)}{" "}{tr("· batch")}{" "}{m.batch_no || "—"}
                    {m.note ? ` · ${m.note}` : ""}
                  </div>
                </div>
                <strong className={Number(m.quantity) < 0 ? "text-warn" : undefined}>
                  {Number(m.quantity) > 0 ? "+" : ""}
                  {fmtQty(m.quantity)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
