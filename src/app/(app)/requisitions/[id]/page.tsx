import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { ProductLineFields } from "@/components/ProductPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { productOptions } from "@/lib/options";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { REQUEST_STATUS, fmtQty, storeOptions } from "@/lib/stock";
import { addRequisitionLine, cancelRequisition, decideRequisition, orderRequisition, removeRequisitionLine, saveRequisition, submitRequisition } from "../actions";
import { RequisitionFields } from "../RequisitionFields";

export const metadata = { title: "Purchase request" };

type Line = { id: string; product_id: string | null; description: string; quantity: number; unit: string; note: string | null; product: { sku: string } | null };
type Supplier = { id: string; name: string; code: string };

export default async function RequisitionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user } = await getAppContext();
  if (!can(role, "requestPurchases")) redirect("/");
  const { data: r, error } = await supabase.from("requisitions").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Purchase request" />;
  if (!r) notFound();
  const mine = r.created_by === user.id;
  const draft = r.status === "draft";
  const canOrder = r.status === "approved" && can(role, "editPurchasing");
  const [{ data: lineData }, stores, products, { data: po }, { data: supplierData }] = await Promise.all([
    supabase.from("requisition_lines").select("id, product_id, description, quantity, unit, note, product:products(sku)").eq("requisition_id", id).order("created_at"),
    storeOptions(supabase, company.id, false),
    draft && mine ? productOptions(supabase, company.id) : Promise.resolve([]),
    r.po_id ? supabase.from("purchase_orders").select("id, number, status").eq("id", r.po_id).maybeSingle() : Promise.resolve({ data: null }),
    canOrder ? supabase.from("suppliers").select("id, name, code").eq("company_id", company.id).eq("active", true).order("name") : Promise.resolve({ data: [] }),
  ]);
  const lines = (lineData ?? []) as unknown as Line[];
  const suppliers = (supplierData ?? []) as Supplier[];
  const names = await namesFor(supabase, [r.created_by, r.decided_by]);
  const store = stores.find((s) => s.id === r.warehouse_id);

  // Suggest the supplier who last supplied these items.
  let lastSupplier = "";
  const productIds = lines.map((l) => l.product_id).filter((v): v is string => Boolean(v));
  if (canOrder && productIds.length) {
    const { data: recent } = await supabase
      .from("po_lines")
      .select("po:purchase_orders!inner(supplier_id, status, order_date)")
      .in("product_id", productIds)
      .neq("po.status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(20);
    const counts = new Map<string, number>();
    for (const row of (recent ?? []) as unknown as { po: { supplier_id: string } | null }[]) {
      if (row.po) counts.set(row.po.supplier_id, (counts.get(row.po.supplier_id) ?? 0) + 1);
    }
    lastSupplier = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    if (!suppliers.some((s) => s.id === lastSupplier)) lastSupplier = "";
  }
  const cancellable = ["draft", "submitted", "approved"].includes(r.status) && (mine || role === "management");

  return (
    <>
      <p className="small">
        <Link href="/requisitions">{tr("← Purchase requests")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{r.reason ?? r.number}</h1>
        <StatusBadge map={REQUEST_STATUS} status={r.status} />
      </div>
      <p className="muted small">
        {r.number}
        {r.created_by && names.get(r.created_by) && ` · ${tr("asked by")} ${names.get(r.created_by)}`}
        {r.submitted_at && ` · ${formatDateTime(r.submitted_at)}`}
        {r.needed_by && ` · ${tr("needed by")} ${formatDate(r.needed_by)}`}
        {store && ` · ${store.name}`}
      </p>
      {r.notes && <p className="small">{r.notes}</p>}
      <Notice {...notice} />
      {r.decided_at && (r.status === "rejected" || r.decision_note) && (
        <div className={`banner small ${r.status === "rejected" ? "warn" : "ok"}`}>
          {r.status === "rejected" ? tr("Rejected") : tr("Approved")}
          {r.decided_by && names.get(r.decided_by) && ` · ${names.get(r.decided_by)}`} · {formatDateTime(r.decided_at)}
          {r.decision_note && ` · ${r.decision_note}`}
        </div>
      )}
      {po && (
        <p className="banner ok small">
          {tr("Ordered on purchase order")} <Link href={`/purchase-orders/${po.id}`}>{po.number}</Link>
        </p>
      )}

      <section className="card" id="items">
        <h2>
          {tr("Items")} <span className="small muted">· {lines.length}</span>
        </h2>
        {lines.length === 0 ? (
          <p className="muted small">{tr("No items yet.")}</p>
        ) : (
          <ul className="lines">
            {lines.map((l) => (
              <li key={l.id}>
                <div className="line-head">
                  <div>
                    <div className="desc">{l.description}</div>
                    <div className="muted small">
                      {l.product?.sku ?? tr("Not in the catalogue")}
                      {l.note && ` · ${l.note}`}
                    </div>
                  </div>
                  <strong style={{ whiteSpace: "nowrap" }}>
                    {fmtQty(l.quantity)} {l.unit}
                  </strong>
                </div>
                {draft && mine && (
                  <form action={removeRequisitionLine}>
                    <input type="hidden" name="requisition_id" value={r.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <button type="submit" className="btn btn-small">
                      {tr("Remove")}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {draft && mine && (
          <form action={addRequisitionLine} style={{ marginTop: 12 }}>
            <input type="hidden" name="requisition_id" value={r.id} />
            <ProductLineFields products={products} />
            <SubmitButton className="btn btn-small">{tr("Add item")}</SubmitButton>
          </form>
        )}
      </section>

      {draft && mine && (
        <section className="card">
          <form action={submitRequisition}>
            <input type="hidden" name="id" value={r.id} />
            <p className="small muted">
              {role === "management" ? tr("As management, your own request is approved when you send it.") : tr("Management will be asked to approve it.")}
            </p>
            <SubmitButton disabled={lines.length === 0}>{role === "management" ? tr("Approve and send to procurement") : tr("Send for approval")}</SubmitButton>
          </form>
          <details style={{ marginTop: 12 }}>
            <summary>{tr("Change details")}</summary>
            <form action={saveRequisition} style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={r.id} />
              <RequisitionFields stores={stores.filter((s) => s.active)} v={r} />
              <SubmitButton className="btn btn-small">{tr("Save")}</SubmitButton>
            </form>
          </details>
        </section>
      )}

      {r.status === "submitted" && role === "management" && (
        <section className="card">
          <h2>{tr("Decision")}</h2>
          <form action={decideRequisition}>
            <input type="hidden" name="id" value={r.id} />
            <div className="field">
              <label htmlFor="note">{tr("Note")}</label>
              <input id="note" name="note" type="text" maxLength={500} placeholder={tr("Needed when rejecting")} />
            </div>
            <div className="row">
              <SubmitButton name="decision" value="approve">
                {tr("Approve")}
              </SubmitButton>
              <SubmitButton name="decision" value="reject" className="btn">
                {tr("Reject")}
              </SubmitButton>
            </div>
          </form>
        </section>
      )}

      {canOrder && (
        <section className="card" id="order">
          <h2>{tr("Order it")}</h2>
          <p className="small muted">{tr("Makes a draft purchase order with these items at the last known cost. Check the prices, then send it as usual.")}</p>
          <form action={orderRequisition}>
            <input type="hidden" name="id" value={r.id} />
            <div className="field">
              <label htmlFor="supplier_id">{tr("Supplier")}</label>
              <select id="supplier_id" name="supplier_id" required defaultValue={lastSupplier}>
                <option value="" disabled>
                  {tr("Choose a supplier")}
                </option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code}){s.id === lastSupplier ? ` · ${tr("last supplier")}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton pendingText={tr("Creating…")}>{tr("Create draft PO")}</SubmitButton>
          </form>
        </section>
      )}

      {cancellable && (
        <form action={cancelRequisition} style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={r.id} />
          <SubmitButton className="btn btn-small" pendingText="…">
            {tr("Cancel request")}
          </SubmitButton>
        </form>
      )}
    </>
  );
}
