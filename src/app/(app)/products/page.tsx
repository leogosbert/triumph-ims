import Link from "next/link";
import { ListToolbar } from "@/components/ListToolbar";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { CATEGORIES } from "@/lib/lists";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney, marginPercent } from "@/lib/money";
import { cleanSearch, LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";

export const metadata = { title: "Products" };

type Row = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  brand: string | null;
  mfr_part_no: string | null;
  unit: string;
  pack_size: string | null;
  selling_price: number | null;
  hazardous: boolean;
  active: boolean;
};

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const q = cleanSearch(typeof sp.q === "string" ? sp.q : "");
  const category = typeof sp.category === "string" ? sp.category : "";
  const archived = sp.archived === "1";
  const { supabase, company, role } = await getAppContext();
  const showCosts = can(role, "seeCosts");

  let query = supabase
    .from("products")
    .select("id, sku, name, category, brand, mfr_part_no, unit, pack_size, selling_price, hazardous, active", {
      count: "exact",
    })
    .eq("company_id", company.id)
    .order("name")
    .limit(LIST_LIMIT);
  if (!archived) query = query.eq("active", true);
  if (category) query = query.eq("category", category);
  if (q)
    query = query.or(
      `name.ilike.%${q}%,sku.ilike.%${q}%,brand.ilike.%${q}%,mfr_part_no.ilike.%${q}%,specification.ilike.%${q}%`,
    );
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  const costs = new Map<string, number | null>();
  if (showCosts && rows.length) {
    const { data: costData } = await supabase
      .from("product_costs")
      .select("product_id, last_cost")
      .in(
        "product_id",
        rows.map((r) => r.id),
      );
    for (const c of (costData ?? []) as { product_id: string; last_cost: number | null }[]) {
      costs.set(c.product_id, c.last_cost);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Products</h1>
        <span className="muted small">{count ?? 0} found</span>
      </div>
      <Notice {...notice} />
      <ListToolbar
        q={q}
        archived={archived}
        filter={{ name: "category", label: "Categories", value: category, options: CATEGORIES }}
        addHref={can(role, "editProducts") ? "/products/new" : undefined}
        addLabel="New product"
      />
      {rows.length === 0 ? (
        <p className="card muted">
          {q || category ? "No products match your search." : "No products yet."}{" "}
          {can(role, "importData") && !q && !category && (
            <>
              You can <Link href="/import">import them from your spreadsheet</Link>.
            </>
          )}
        </p>
      ) : (
        <ul className="rec-list">
          {rows.map((p) => {
            const m = marginPercent(p.selling_price, costs.get(p.id));
            return (
              <li key={p.id}>
                <Link href={`/products/${p.id}`}>
                  <div className="main">
                    <div className="title">
                      {p.name} {p.hazardous && <span className="badge warn">Hazardous</span>}{" "}
                      {!p.active && <span className="badge off">Archived</span>}
                    </div>
                    <div className="sub">
                      {p.sku}
                      {p.brand ? ` · ${p.brand}` : ""}
                      {p.mfr_part_no ? ` · ${p.mfr_part_no}` : ""}
                      {p.category ? ` · ${p.category}` : ""}
                    </div>
                  </div>
                  <div className="side">
                    {formatMoney(p.selling_price, company.base_currency)}
                    <div className="small muted">
                      per {p.unit}
                      {p.pack_size ? ` (${p.pack_size})` : ""}
                    </div>
                    {showCosts && m !== null && (
                      <div className={`small ${m < 12 ? "text-warn" : "muted"}`}>{m.toFixed(1)}% margin</div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {(count ?? 0) > LIST_LIMIT && (
        <p className="muted small">Showing the first {LIST_LIMIT}. Search to narrow the list.</p>
      )}
    </>
  );
}
