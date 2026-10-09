import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Notice } from "@/components/Notice";
import { StockGauge } from "@/components/StockGauge";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { cleanSearch } from "@/lib/records";
import { can } from "@/lib/roles";
import { daysUntil, fmtQty, storeOptions, type OnHand } from "@/lib/stock";

export const metadata = { title: "Stock" };

type Product = { id: string; sku: string; name: string; unit: string; reorder_level: number | null; category: string | null };

export default async function StockPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role, features } = await getAppContext();
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
  // Quantity per store per product.
  const byStore = new Map<string, Map<string, number>>();
  for (const r of onHand) {
    const m = byStore.get(r.warehouse_id) ?? new Map<string, number>();
    m.set(r.product_id, (m.get(r.product_id) ?? 0) + Number(r.quantity));
    byStore.set(r.warehouse_id, m);
  }

  return (
    <>
      <div className="page-head">
        <h1>{tr("Stock")}</h1>
        <div className="actions" style={{ marginTop: 0 }}>
          {can(role, "receiveGoods") && (
            <Link href="/receiving" className="btn btn-primary btn-small">{tr("Receive goods")}</Link>
          )}
          {can(role, "seeDeliveries") && (
            <Link href="/deliveries" className="btn btn-small">{tr("Deliveries")}</Link>
          )}
          {features.on("stock_transfers") && stores.length > 1 && (
            <Link href="/transfers" className="btn btn-small">{tr("Transfers")}</Link>
          )}
        </div>
      </div>
      <Notice {...notice} />

      <div className="stat-grid">
        <div className="stat">
          <div className="n">{products.filter((p) => (totals.get(p.id) ?? 0) > 0).length}</div>
          <div className="l">{tr("Products in stock")}</div>
        </div>
        <a href="#low" className={`stat ${low.length ? "alert" : ""}`}>
          <div className="n">{low.length}</div>
          <div className="l">{tr("At or below reorder level")}</div>
        </a>
        <a href="#expiry" className={`stat ${expiring.length ? "alert" : ""}`}>
          <div className="n">{expiring.length}</div>
          <div className="l">{tr("Batches expiring within 60 days")}</div>
        </a>
        <div className="stat">
          <div className="n">{stores.length}</div>
          <div className="l">{tr("Store")}{stores.length === 1 ? "" : "s"}
            {can(role, "manageWarehouses") && (
              <>
                {" · "}
                <Link href="/warehouses">{tr("manage")}</Link>
              </>
            )}
          </div>
        </div>
      </div>

      <form method="get" className="card toolbar">
        <div className="toolbar-row">
          <input type="search" name="q" defaultValue={q} placeholder={tr("Search product or SKU…")} aria-label={tr("Search")} />
          <button className="btn" type="submit">{tr("Search")}</button>
        </div>
        <div className="toolbar-row small">
          <select name="store" defaultValue={store} aria-label={tr("Store")}>
            <option value="">{tr("All stores")}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="check">
            <input type="checkbox" name="view" value="all" defaultChecked={view === "all"} />{" "}{tr("Include products with no stock")}</label>
          {can(role, "adjustStock") && (
            <>
              <Link href="/stock/adjust" className="btn btn-small" style={{ marginLeft: "auto" }}>{tr("Adjust stock")}</Link>
              <Link href="/stock/import" className="btn btn-small">{tr("Load opening stock")}</Link>
            </>
          )}
        </div>
      </form>

      {expiring.length > 0 && (
        <section className="card" id="expiry" style={{ borderColor: "#f0d49a" }}>
          <h2>{tr("Expiring soon")}</h2>
          <ul className="list">
            {expiring.slice(0, 20).map((r) => {
              const p = byId.get(r.product_id);
              const days = daysUntil(r.expiry_date!);
              return (
                <li key={`${r.product_id}-${r.warehouse_id}-${r.batch_no}`} className="row">
                  <Link href={`/stock/${r.product_id}`}>
                    {p?.name ?? tr("Product")} <span className="muted small">{tr("· batch")}{" "}{r.batch_no || "—"}</span>
                  </Link>
                  <span className={`small ${days < 0 ? "text-warn" : ""}`}>
                    {fmtQty(r.quantity)} {p?.unit} · {days < 0 ? tr("expired") : tr("expires")} {formatDate(r.expiry_date!)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {low.length > 0 && (
        <section className="card" id="low" style={{ borderColor: "#f0d49a" }}>
          <div className="page-head" style={{ marginBottom: 4 }}>
            <h2 style={{ margin: 0 }}>{tr("Reorder")}</h2>
            {can(role, "seeReorder") && features.on("reorder_levels") && (
              <Link href="/stock/reorder" className="btn btn-small btn-primary">{tr("What to reorder")}</Link>
            )}
          </div>
          <ul className="list">
            {low.map((p) => (
              <li key={p.id} className="row">
                <Link href={`/stock/${p.id}`}>{p.name}</Link>
                <span className="small text-warn">
                  {fmtQty(totals.get(p.id) ?? 0)} {p.unit}{" "}{tr("(reorder at")}{" "}{fmtQty(p.reorder_level)})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <h2>{tr("Stores")}</h2>
      <p className="muted small" style={{ marginTop: -4 }}>{tr("Tap a store to see its items. The gauge shows each item's stock against its reorder level.")}</p>
      {products.length === 0 ? (
        <p className="card muted">{tr("No products yet.")}</p>
      ) : (
        (store ? stores.filter((s) => s.id === store) : stores).map((st) => {
          const here = byStore.get(st.id) ?? new Map<string, number>();
          let items = products.filter((p) => (view === "all" ? true : (here.get(p.id) ?? 0) !== 0));
          if (q) items = items.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q));
          const lowHere = items.filter((p) => p.reorder_level != null && Number(p.reorder_level) > 0 && (here.get(p.id) ?? 0) <= Number(p.reorder_level)).length;
          const units = items.reduce((sum, p) => sum + Math.max(0, here.get(p.id) ?? 0), 0);
          const scaleMax = Math.max(1, ...items.map((p) => here.get(p.id) ?? 0));
          const open = Boolean(store) || (Boolean(q) && items.length > 0);
          return (
            <details key={st.id} className="store-card" open={open}>
              <summary>
                <span className="store-ico" aria-hidden>
                  <Icon name="warehouse" size={20} />
                </span>
                <span className="store-txt">
                  <strong>{st.name}</strong>
                  <span>
                    {st.code} · {items.length} {tr(items.length === 1 ? "item" : "items")} · {fmtQty(units)} {tr("units")}
                  </span>
                </span>
                {lowHere > 0 && <span className="badge tone-bad">{lowHere} {tr("low")}</span>}
                <span className="store-chev" aria-hidden>
                  <Icon name="chevron" size={18} />
                </span>
              </summary>
              {items.length === 0 ? (
                <p className="muted small store-empty">{q ? tr("No matching items in this store.") : tr("Nothing in stock here yet.")}</p>
              ) : (
                <ul className="rec-list stock-list">
                  {items.slice(0, 300).map((p) => (
                    <li key={p.id}>
                      <Link href={`/stock/${p.id}`}>
                        <div className="main">
                          <div className="title">{p.name}</div>
                          <div className="sub">
                            {p.sku}
                            {p.category ? ` · ${p.category}` : ""}
                            {p.reorder_level ? ` · ${tr("reorder at")} ${fmtQty(p.reorder_level)}` : ""}
                          </div>
                        </div>
                        <StockGauge qty={here.get(p.id) ?? 0} reorder={p.reorder_level != null ? Number(p.reorder_level) : null} scaleMax={scaleMax} unit={p.unit} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          );
        })
      )}
    </>
  );
}
