"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { kickOutbox } from "@/lib/outbox";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

export async function adjustStock(form: FormData) {
  const { supabase, company } = await getAppContext();
  const back = "/stock/adjust";
  const product = str(form, "product_id");
  const direction = str(form, "direction") === "remove" ? -1 : 1;
  const qty = toNumber(str(form, "quantity"));
  if (!product) redirect(withNotice(back, { error: "Choose the product." }));
  if (qty === null || Number.isNaN(qty) || qty <= 0) redirect(withNotice(back, { error: "Enter a quantity above zero." }));
  const { error } = await supabase.rpc("adjust_stock", {
    p_company: company.id,
    p_product: product,
    p_warehouse: str(form, "warehouse_id"),
    p_quantity: direction * qty,
    p_batch: str(form, "batch_no"),
    p_expiry: optional(form, "expiry_date"),
    p_reason: str(form, "reason"),
  });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath("/stock");
  redirect(withNotice(`/stock/${product}`, { msg: "Stock adjusted." }));
}

export async function saveWarehouse(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const values = {
    code: str(form, "code").toUpperCase(),
    name: str(form, "name"),
    address: optional(form, "address"),
    active: str(form, "active") !== "false",
  };
  if (!values.code || values.name.length < 2) redirect(withNotice("/warehouses", { error: "Enter a short code and a name." }));
  const { error } = id
    ? await supabase.from("warehouses").update(values).eq("id", id).eq("company_id", company.id)
    : await supabase.from("warehouses").insert({ ...values, company_id: company.id });
  if (error)
    redirect(withNotice("/warehouses", { error: /duplicate key/.test(error.message) ? "That code is already used." : friendlyError(error.message) }));
  revalidatePath("/warehouses");
  redirect(withNotice("/warehouses", { msg: id ? "Store saved." : "Store added." }));
}

export async function receiveGoods(form: FormData) {
  kickOutbox(); // send any alerts this creates right after the response
  const { supabase } = await getAppContext();
  const poId = str(form, "po_id");
  const back = `/purchase-orders/${poId}/receive`;
  const lines: Record<string, unknown>[] = [];
  for (const [k, v] of form.entries()) {
    const m = /^qty_(.+)$/.exec(k);
    if (!m) continue;
    const qty = toNumber(String(v));
    if (qty === null || qty === 0) continue;
    if (Number.isNaN(qty) || qty < 0) redirect(withNotice(back, { error: "Quantities must be numbers." }));
    const id = m[1];
    lines.push({
      po_line_id: id,
      quantity: qty,
      batch_no: str(form, `batch_${id}`),
      expiry_date: str(form, `expiry_${id}`) || null,
      condition: str(form, `cond_${id}`) || "good",
      note: str(form, `note_${id}`) || null,
    });
  }
  if (!lines.length) redirect(withNotice(back, { error: "Enter at least one quantity received." }));
  const { data, error } = await supabase.rpc("receive_goods", {
    p_po: poId,
    p_warehouse: str(form, "warehouse_id"),
    p_received_on: optional(form, "received_on"),
    p_supplier_dn: optional(form, "supplier_dn"),
    p_notes: optional(form, "notes"),
    p_lines: lines,
  });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath("/stock");
  revalidatePath(`/purchase-orders/${poId}`);
  revalidatePath("/receiving");
  redirect(withNotice(`/grns/${data as string}`, { msg: "Goods received and added to stock." }));
}
