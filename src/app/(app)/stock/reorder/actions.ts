"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { can } from "@/lib/roles";

const BACK = "/stock/reorder";

function fail(error: string): never {
  redirect(withNotice(BACK, { error: friendlyError(error) }));
}

/** The ticked items of one group, with their quantities. */
function picked(form: FormData) {
  const out: { product: string; qty: number }[] = [];
  for (const product of form.getAll("pick").map(String)) {
    const qty = toNumber(str(form, `qty_${product}`));
    if (qty !== null && !Number.isNaN(qty) && qty > 0) out.push({ product, qty });
  }
  return out;
}

/** Turn ticked suggestions into a purchase request (mode=request) or a draft purchase order (mode=po). */
export async function reorderAction(form: FormData) {
  const items = picked(form);
  if (items.length === 0) fail("Tick at least one item with a quantity.");
  const { supabase, company, role } = await getAppContext();
  const { data: prods } = await supabase.from("products").select("id, name, unit").in("id", items.map((i) => i.product));
  const byId = new Map((prods ?? []).map((p) => [p.id, p]));

  if (str(form, "mode") === "po") {
    if (!can(role, "editPurchasing")) fail("Only management and procurement can create purchase orders.");
    const supplier = str(form, "supplier_id");
    if (!supplier) fail("Choose the supplier.");
    const { data: po, error } = await supabase.rpc("create_purchase_order", { p_company: company.id, p_supplier: supplier, p_quotation: null });
    if (error) fail(error.message);
    const { data: costs } = await supabase.from("product_costs").select("product_id, last_cost").in("product_id", items.map((i) => i.product));
    const cost = new Map((costs ?? []).map((c) => [c.product_id, Number(c.last_cost ?? 0)]));
    const { error: lineError } = await supabase.from("po_lines").insert(
      items.map((i) => ({
        company_id: company.id,
        po_id: po as string,
        product_id: i.product,
        description: byId.get(i.product)?.name ?? "",
        quantity: i.qty,
        unit: byId.get(i.product)?.unit ?? "pcs",
        unit_price: Math.round((cost.get(i.product) ?? 0) * 100) / 100,
      })),
    );
    if (lineError) fail(lineError.message);
    revalidatePath(BACK);
    revalidatePath("/purchase-orders");
    redirect(withNotice(`/purchase-orders/${po as string}#lines`, { msg: "Draft purchase order made at last known cost. Check the prices, then submit it." }));
  }

  if (!can(role, "requestPurchases")) fail("You cannot ask for purchases.");
  const { data: req, error } = await supabase
    .from("requisitions")
    .insert({ company_id: company.id, reason: "Restock: at or below reorder level" })
    .select("id")
    .single();
  if (error) fail(error.message);
  const { error: lineError } = await supabase.from("requisition_lines").insert(
    items.map((i) => ({ company_id: company.id, requisition_id: req.id, product_id: i.product, description: "", quantity: i.qty, unit: byId.get(i.product)?.unit ?? "pcs" })),
  );
  if (lineError) fail(lineError.message);
  revalidatePath(BACK);
  revalidatePath("/requisitions");
  redirect(withNotice(`/requisitions/${req.id}`, { msg: "Purchase request made. Check it and send it for approval." }));
}
