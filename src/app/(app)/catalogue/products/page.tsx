import { primeLang, tr } from "@/lib/tr";
import { FeatureOff } from "@/components/growth-tools/FeatureOff";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { cataloguePhotoUrl, DOC_KIND_LABEL } from "@/lib/growth-tools/catalogue";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { setCatalogueCategory, setCatalogueDocument, setCatalogueProduct } from "../actions";
import { PhotoUpload } from "./PhotoUpload";
import { BackLink } from "@/components/BackLink";
import "../../../growth-tools.css";

export const metadata = { title: "Catalogue products" };

type P = { id: string; sku: string | null; name: string; category: string | null; brand: string | null; selling_price: number | null; unit: string | null };
type CP = { product_id: string; public: boolean; show_price: boolean; summary: string | null; photo_path: string | null; sort: number };
type Doc = { id: string; title: string; kind: string; product_id: string };

export default async function CatalogueProductsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, features, isManager } = await getAppContext();
  if (!features.on("online_catalogue")) return <FeatureOff title="Online catalogue" isManager={isManager} />;
  const category = typeof sp.category === "string" ? sp.category.slice(0, 120) : "";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const only = sp.show === "public";

  let query = supabase.from("products").select("id, sku, name, category, brand, selling_price, unit").eq("company_id", company.id).eq("active", true).order("category").order("name").limit(150);
  if (category) query = query.eq("category", category);
  if (q) query = query.or(`name.ilike.%${q.replace(/[%,()]/g, " ")}%,sku.ilike.%${q.replace(/[%,()]/g, " ")}%`);
  const [{ data: products, error }, { data: cps, error: cpErr }, { data: cats }] = await Promise.all([
    query,
    supabase.from("catalogue_products").select("product_id, public, show_price, summary, photo_path, sort").eq("company_id", company.id),
    supabase.from("products").select("category").eq("company_id", company.id).eq("active", true).limit(5000),
  ]);
  if (isMissingTable(cpErr)) return <NotReady title="Online catalogue" />;
  if (error) throw new Error(error.message);
  const byId = new Map(((cps ?? []) as CP[]).map((c) => [c.product_id, c]));
  let rows = (products ?? []) as P[];
  if (only) rows = rows.filter((p) => byId.get(p.id)?.public);
  const ids = rows.map((p) => p.id);
  const { data: docs } = ids.length
    ? await supabase.from("documents").select("id, title, kind, product_id").eq("company_id", company.id).in("product_id", ids).in("kind", ["datasheet", "sds", "coa", "certificate"]).is("archived_at", null).not("file_path", "is", null)
    : { data: [] };
  const { data: pubDocs } = await supabase.from("catalogue_documents").select("document_id").eq("company_id", company.id).eq("public", true);
  const isPub = new Set((pubDocs ?? []).map((d) => d.document_id as string));
  const categories = Array.from(new Set((cats ?? []).map((c) => (c.category as string | null)?.trim() || "").filter(Boolean))).sort();
  const back = `/catalogue/products${category || q || only ? `?${new URLSearchParams({ ...(category ? { category } : {}), ...(q ? { q } : {}), ...(only ? { show: "public" } : {}) })}` : ""}`;

  return (
    <>
      <BackLink href="/catalogue" label="Online catalogue" />
      <h1>{tr("Catalogue products")}</h1>
      <p className="muted small">{tr("Tick the products to show. Prices appear only where “Show price” is ticked. Stock and costs are never shown.")}</p>
      <Notice {...notice} />
      <form className="toolbar card" method="get">
        <div className="toolbar-row">
          <input type="search" name="q" defaultValue={q} placeholder={tr("Search name or code")} aria-label={tr("Search")} />
          <select name="category" defaultValue={category} aria-label={tr("Category")}>
            <option value="">{tr("All categories")}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="row small" style={{ gap: 4 }}>
            <input type="checkbox" name="show" value="public" defaultChecked={only} /> {tr("Shown only")}
          </label>
          <button type="submit" className="btn btn-small">
            {tr("Filter")}
          </button>
        </div>
      </form>
      {isManager && (
        <div className="gt-share" style={{ margin: "8px 0 12px" }}>
          <form action={setCatalogueCategory}>
            <input type="hidden" name="category" value={category || "*"} />
            <input type="hidden" name="public" value="1" />
            <SubmitButton className="btn btn-small" pendingText="…">
              {category ? `${tr("Show all in")} ${category}` : tr("Show every active product")}
            </SubmitButton>
          </form>
          <form action={setCatalogueCategory}>
            <input type="hidden" name="category" value={category || "*"} />
            <input type="hidden" name="public" value="0" />
            <SubmitButton className="btn btn-small btn-ghost" pendingText="…">
              {category ? `${tr("Hide all in")} ${category}` : tr("Hide every product")}
            </SubmitButton>
          </form>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="card muted">{tr("No products match.")}</p>
      ) : (
        <ul className="list card">
          {rows.map((p) => {
            const c = byId.get(p.id);
            const photo = cataloguePhotoUrl(c?.photo_path);
            const pdocs = ((docs ?? []) as Doc[]).filter((d) => d.product_id === p.id);
            return (
              <li key={p.id} id={`p-${p.id}`}>
                <div className="gt-prod">
                  {photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photo} alt="" loading="lazy" />
                  ) : (
                    <span className="gt-ph" aria-hidden />
                  )}
                  <div className="gt-main">
                    <strong>{p.name}</strong> {c?.public ? <span className="badge tone-ok">{tr("Shown")}</span> : null}
                    <div className="small muted">
                      {[p.sku, p.brand, p.category].filter(Boolean).join(" · ")}
                      {c?.show_price && p.selling_price !== null && ` · ${formatMoney(p.selling_price, company.base_currency)}`}
                    </div>
                    {isManager ? (
                      <form action={setCatalogueProduct} className="grid" style={{ marginTop: 6, gap: 6 }}>
                        <input type="hidden" name="product_id" value={p.id} />
                        <input type="hidden" name="back" value={back} />
                        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                          <label className="row small" style={{ gap: 4 }}>
                            <input type="checkbox" name="public" defaultChecked={c?.public ?? false} /> {tr("Show")}
                          </label>
                          <label className="row small" style={{ gap: 4 }}>
                            <input type="checkbox" name="show_price" defaultChecked={c?.show_price ?? false} /> {tr("Show price")}
                          </label>
                          <input name="sort" type="number" defaultValue={c?.sort ?? 1000} aria-label={tr("Order")} title={tr("Order (smaller first)")} style={{ width: 80 }} />
                        </div>
                        <textarea name="summary" rows={2} maxLength={600} defaultValue={c?.summary ?? ""} placeholder={tr("Short description for buyers (optional)")} aria-label={tr("Description")} />
                        <div className="gt-share">
                          <SubmitButton className="btn btn-small btn-primary" pendingText="…">
                            {tr("Save")}
                          </SubmitButton>
                          <PhotoUpload companyId={company.id} productId={p.id} hasPhoto={!!c?.photo_path} />
                        </div>
                      </form>
                    ) : (
                      c?.summary && <p className="small">{c.summary}</p>
                    )}
                    {pdocs.length > 0 && (
                      <ul className="list" style={{ marginTop: 6 }}>
                        {pdocs.map((d) => (
                          <li key={d.id} className="row small" style={{ justifyContent: "space-between", gap: 8, padding: "6px 0" }}>
                            <span>
                              {tr(DOC_KIND_LABEL[d.kind] ?? d.kind)}: {d.title} {isPub.has(d.id) && <span className="badge tone-ok">{tr("Public")}</span>}
                            </span>
                            {isManager && (
                              <form action={setCatalogueDocument}>
                                <input type="hidden" name="document_id" value={d.id} />
                                <input type="hidden" name="public" value={isPub.has(d.id) ? "0" : "1"} />
                                <input type="hidden" name="back" value={back} />
                                <button type="submit" className="btn btn-small">
                                  {isPub.has(d.id) ? tr("Make private") : tr("Allow download")}
                                </button>
                              </form>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length >= 150 && <p className="small muted">{tr("Showing the first 150. Choose a category or search to see the others.")}</p>}
    </>
  );
}
