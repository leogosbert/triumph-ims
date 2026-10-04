import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { RecordFields } from "@/components/RecordFields";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { SUPPLIER_SECTIONS } from "@/lib/fields";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { saveSupplier, setSupplierActive } from "../actions";

export const metadata = { title: "Supplier" };

type Linked = { product_id: string; last_cost: number | null; product: { name: string; sku: string } | null };

export default async function SupplierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeSuppliers")) redirect("/");

  const [{ data: supplier }, { data: linkedData }] = await Promise.all([
    supabase.from("suppliers").select("*").eq("id", id).eq("company_id", company.id).maybeSingle(),
    can(role, "seeCosts")
      ? supabase
          .from("product_costs")
          .select("product_id, last_cost, product:products(name, sku)")
          .eq("main_supplier_id", id)
          .eq("company_id", company.id)
          .limit(50)
      : Promise.resolve({ data: [] }),
  ]);
  if (!supplier) notFound();
  const linked = (linkedData ?? []) as unknown as Linked[];
  const editable = can(role, "editSuppliers");

  return (
    <>
      <p className="small">
        <Link href="/suppliers">{tr("← Suppliers")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{supplier.name}</h1>
        <span className="badge">{supplier.code}</span>
      </div>
      <p className="muted small">{tr("Added")}{" "}{formatDate(supplier.created_at)}
        {!supplier.active && (
          <>
            {" "}
            · <span className="badge off">{tr("Archived")}</span>
          </>
        )}
      </p>
      <Notice {...notice} />

      {linked.length > 0 && (
        <section className="card">
          <h2>{tr("Main supplier for")}</h2>
          <ul className="list">
            {linked.map((l) => (
              <li key={l.product_id} className="row">
                <Link href={`/products/${l.product_id}`}>
                  {l.product?.name ?? tr("Product")} <span className="muted small">{l.product?.sku}</span>
                </Link>
                <span className="small muted">{tr("Last cost")}{" "}{formatMoney(l.last_cost, "TZS")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={saveSupplier}>
        <input type="hidden" name="id" value={supplier.id} />
        <fieldset className="plain" disabled={!editable}>
          <RecordFields sections={SUPPLIER_SECTIONS} values={supplier} readOnly={!editable} />
          {editable && <SubmitButton className="btn btn-primary btn-block">{tr("Save changes")}</SubmitButton>}
        </fieldset>
      </form>

      {editable && (
        <form action={setSupplierActive} style={{ marginTop: 16 }}>
          <input type="hidden" name="id" value={supplier.id} />
          <input type="hidden" name="active" value={supplier.active ? "false" : "true"} />
          <SubmitButton className={`btn btn-block ${supplier.active ? "btn-danger" : ""}`} pendingText={tr("Working…")}>
            {supplier.active ? tr("Archive supplier") : tr("Restore supplier")}
          </SubmitButton>
        </form>
      )}
    </>
  );
}
