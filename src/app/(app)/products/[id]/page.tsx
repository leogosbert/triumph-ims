import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { RecordFields } from "@/components/RecordFields";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { PRODUCT_SECTIONS } from "@/lib/fields";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney, marginPercent } from "@/lib/money";
import { can } from "@/lib/roles";
import { LinkedDocuments } from "@/components/LinkedDocuments";
import { saveProduct, saveProductCost, setProductActive } from "../actions";

export const metadata = { title: "Product" };

type Cost = { main_supplier_id: string | null; last_cost: number | null; updated_at: string };

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, features } = await getAppContext();
  const showCosts = can(role, "seeCosts");
  const editCosts = can(role, "editCosts");

  const [{ data: product }, { data: costRow }, { data: supplierData }] = await Promise.all([
    supabase.from("products").select("*").eq("id", id).eq("company_id", company.id).maybeSingle(),
    showCosts
      ? supabase
          .from("product_costs")
          .select("main_supplier_id, last_cost, updated_at")
          .eq("product_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    showCosts
      ? supabase.from("suppliers").select("id, name, code").eq("company_id", company.id).eq("active", true).order("name")
      : Promise.resolve({ data: [] }),
  ]);
  if (!product) notFound();
  const cost = costRow as Cost | null;
  const suppliers = (supplierData ?? []) as { id: string; name: string; code: string }[];
  const editable = can(role, "editProducts");
  const margin = marginPercent(product.selling_price, cost?.last_cost);

  return (
    <>
      <p className="small">
        <Link href="/products">{tr("← Products")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{product.name}</h1>
        <span className="badge">{product.sku}</span>
      </div>
      <p className="muted small">
        {formatMoney(product.selling_price, company.base_currency)}{" "}{tr("per")}{" "}{product.unit}{" "}{tr("· added")}{" "}
        {formatDate(product.created_at)}
        {product.hazardous && (
          <>
            {" "}
            · <span className="badge warn">{tr("Hazardous")}</span>
          </>
        )}
        {!product.active && (
          <>
            {" "}
            · <span className="badge off">{tr("Archived")}</span>
          </>
        )}
      </p>
      <Notice {...notice} />

      {showCosts && (
        <section className="card" id="costs">
          <h2>{tr("Purchasing")}</h2>
          <p className="muted small">{tr("Only management, procurement and finance can see this.")}</p>
          <dl className="kv" style={{ marginBottom: 12 }}>
            <dt>{tr("Last cost")}</dt>
            <dd>{formatMoney(cost?.last_cost, company.base_currency)}</dd>
            <dt>{tr("Margin")}</dt>
            <dd className={margin !== null && margin < 12 ? "text-warn" : undefined}>
              {margin === null ? "—" : `${margin.toFixed(1)}%`}
              {margin !== null && margin < 12 && tr(" · below 12%, needs approval when quoting")}
            </dd>
          </dl>
          {editCosts && (
            <form action={saveProductCost}>
              <input type="hidden" name="product_id" value={product.id} />
              <div className="grid grid-2">
                <div className="field">
                  <label htmlFor="main_supplier_id">{tr("Main supplier")}</label>
                  <select id="main_supplier_id" name="main_supplier_id" defaultValue={cost?.main_supplier_id ?? ""}>
                    <option value="">—</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="last_cost">{tr("Last cost (")}{company.base_currency})</label>
                  <input
                    id="last_cost"
                    name="last_cost"
                    type="text"
                    inputMode="decimal"
                    defaultValue={cost?.last_cost != null ? Number(cost.last_cost).toLocaleString("en-GB") : ""}
                  />
                </div>
              </div>
              <SubmitButton>{tr("Save purchasing details")}</SubmitButton>
            </form>
          )}
          {!editCosts && cost?.main_supplier_id && (
            <p className="small">{tr("Main supplier:")}{" "}
              <Link href={`/suppliers/${cost.main_supplier_id}`}>
                {suppliers.find((s) => s.id === cost.main_supplier_id)?.name ?? tr("view supplier")}
              </Link>
            </p>
          )}
        </section>
      )}

      {can(role, "seeDocuments") && features.on("documents") && (
        <LinkedDocuments supabase={supabase} companyId={company.id} field="product_id" id={id} back={`/products/${id}#documents`} kind="sds" />
      )}

      <form action={saveProduct}>
        <input type="hidden" name="id" value={product.id} />
        <fieldset className="plain" disabled={!editable}>
          <RecordFields sections={PRODUCT_SECTIONS} values={product} readOnly={!editable} />
          {editable && <SubmitButton className="btn btn-primary btn-block">{tr("Save changes")}</SubmitButton>}
        </fieldset>
      </form>

      {editable && (
        <form action={setProductActive} style={{ marginTop: 16 }}>
          <input type="hidden" name="id" value={product.id} />
          <input type="hidden" name="active" value={product.active ? "false" : "true"} />
          <SubmitButton className={`btn btn-block ${product.active ? "btn-danger" : ""}`} pendingText={tr("Working…")}>
            {product.active ? tr("Archive product") : tr("Restore product")}
          </SubmitButton>
        </form>
      )}
    </>
  );
}
