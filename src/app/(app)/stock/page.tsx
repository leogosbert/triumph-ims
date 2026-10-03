import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { cleanSearch } from "@/lib/records";
import { can } from "@/lib/roles";
import { daysUntil, fmtQty, storeOptions, type OnHand } from "@/lib/stock";

export const metadata = { title: "Stock" };

type Product = { id: string; sku: string; name: string; unit: string; reorder_level: number | null; category: string | null };

export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeStock")) redirect("/");
  const store = typeof sp.store === "string" ? sp.store : "";
  const q = cleanSearch(typeof sp.q === "string" ? sp.q : "").toLowerCase();
  const view = sp.view === "all" ? "all" : "instock";

  let ohq = supabase.from("stock_on_hand").select("product_id, warehouse_id, batch_no, expiry_date, quantity").eq("company_id", company.id);
  if (store) ohq = ohq.eq("warehouse_id", store);
  const [stores, { data: ohData }, { data: prodData }] = await Promise.all([
    storeOptions(supabase, company.id),
    ohq.limit(10000),
    supabase.from("products").select("id, sku, name, unit, reorder_level, category").eq("company_id", company.id).eq("active", true).order("name").limit(5000),
  ]);
  const onHand = (ohData ?? []) as OnHand[];
  const products = (prodData ?? []) as Product[];

  const totals = new Map<string, number>();
  for (const r of onHand) totals.set(r.product_id, (totals.get(r.product_id) ?? 0) + Number(r.quantity));
  const low = products.filter((p) => p.reorder_level != null && Number(p.reorder_level) > 0 && (totals.get(p.id) ?? 0) <= Number(p.reorder_level));
  const expiring = onHand
    .filter((r) => r.expiry_date && Number(r.quantity) > 0 && daysUntil(r.expiry_date) <= 60)
    .sort((a, b) => (a.expiry_date! < b.expiry_date! ? -1 : 1));
  const byId = new Map(products.map((p) => [p.id, p]));
  let list = products.filter((p) => (view === "all" ? true : (totals.get(p.id) ?? 0) !== 0));
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));

  return (
    <>
      <div className="page-head">
        <h1>Stock</h1>
        <div className="actions" style={{ marginTop: 0 }}>
          {can(role, "receiveGoods") && (
            <Link href="/receiving" className="btn btn-primary btn-small">
              Receive goods
            </Link>
          )}
          {can(role, "seeDeliveries") && (
            <Link href="/deliveries" className="btn btn-small">
              Deliveries
            </Link>
          )}
        </div>
      </div>
      <Notice {...notice} />

      <div className="stat-grid">
        <div className="stat">
          <div className="n">{products.filter((p) => (totals.get(p.id) ?? 0) > 0).length}</div>
          <div className="l">Products in stock</div>
        </div>
        <a href="#low" className={`stat ${low.length ? "alert" : ""}`}>
          <div className="n">{low.length}</div>
          <div className="l">At or below reorder level</div>
        </a>
        <a href="#expiry" className={`stat ${expiring.length ? "alert" : ""}`}>
          <div className="n">{expiring.length}</div>
          <div className="l">Batches expiring within 60 days</div>
        </a>
        <div className="stat">
          <div className="n">{stores.length}</div>
          <div className="l">
            Store{stores.length === 1 ? "" : "s"}
            {can(role, "manageWarehouses") && (
              <>
                {" · "}
                <Link href="/warehouses">manage</Link>
              </>
            )}
          </div>
        </div>
      </div>

      <form method="get" className="card toolbar">
        <div className="toolbar-row">
          <input type="search" name="q" defaultValue={q} placeholder="Search product or SKU…" aria-label="Search" />
          <button className="btn" type="submit">
            Search
          </button>
        </div>
        <div className="toolbar-row small">
          <select name="store" defaultValue={store} aria-label="Store">
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" name="view" value="all" defaultChecked={view === "all"} /> Include products with no stock
          </label>
          {can(role, "adjustStock") && (
            <Link href="/stock/adjust" className="btn btn-small" style={{ marginLeft: "auto" }}>
              Adjust stock
            </Link>
          )}
        </div>
      </form>

      {expiring.length > 0 && (
        <section className="card" id="expiry" style={{ borderColor: "#f0d49a" }}>
          <h2>Expiring soon</h2>
          <ul className="list">
            {expiring.slice(0, 20).map((r) => {
              const p = byId.get(r.product_id);
              const days = daysUntil(r.expiry_date!);
              return (
                <li key={`${r.product_id}-${r.warehouse_id}-${r.batch_no}`} className="row">
                  <Link href={`/stock/${r.product_id}`}>
                    {p?.name ?? "Product"} <span className="muted small">· batch {r.batch_no || "—"}</span>
                  </Link>
                  <span className={`small ${days < 0 ? "text-warn" : ""}`}>
                    {fmtQty(r.quantity)} {p?.unit} · {days < 0 ? "expired" : `expires`} {formatDate(r.expiry_date!)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {low.length > 0 && (
        <section className="card" id="low" style={{ borderColor: "#f0d49a" }}>
          <h2>Reorder</h2>
          <ul className="list">
            {low.map((p) => (
              <li key={p.id} className="row">
                <Link href={`/stock/${p.id}`}>{p.name}</Link>
                <span className="small text-warn">
                  {fmtQty(totals.get(p.id) ?? 0)} {p.unit} (reorder at {fmtQty(p.reorder_level)})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2>{store ? stores.find((s) => s.id === store)?.name : "All stores"}</h2>
      {list.length === 0 ? (
        <p className="card muted">
          {products.length === 0 ? "No products yet." : "Nothing in stock here yet. Stock arrives when you receive goods against a purchase order, or through an adjustment (opening balance)."}
        </p>
      ) : (
        <ul className="rec-list">
          {list.slice(0, 300).map((p) => {
            const qty = totals.get(p.id) ?? 0;
            const isLow = p.reorder_level != null && Number(p.reorder_level) > 0 && qty <= Number(p.reorder_level);
            return (
              <li key={p.id}>
                <Link href={`/stock/${p.id}`}>
                  <div className="main">
                    <div className="title">{p.name}</div>
                    <div className="sub">
                      {p.sku}
                      {p.category ? ` · ${p.category}` : ""}
                    </div>
                  </div>
                  <div className={`side ${isLow ? "text-warn" : ""}`}>
                    <strong>{fmtQty(qty)}</strong> {p.unit}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
