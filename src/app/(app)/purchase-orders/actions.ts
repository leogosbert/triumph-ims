"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { kickOutbox } from "@/lib/outbox";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function done(id: string, msg: string, anchor = ""): never {
  revalidatePath("/purchase-orders");
  revalidatePath(`/purchase-orders/${id}`);
  revalidatePath("/purchasing");
  revalidatePath("/");
  redirect(withNotice(`/purchase-orders/${id}${anchor}`, { msg }));
}
function fail(id: string, error: string, anchor = ""): never {
  redirect(withNotice(`/purchase-orders/${id}${anchor}`, { error: friendlyError(error) }));
}

export async function newPurchaseOrder(form: FormData) {
  const { supabase, company } = await getAppContext();
  const supplier = str(form, "supplier_id");
  const quotation = str(form, "quotation_id") || null;
  const back = `/purchase-orders/new${quotation ? `?quotation=${quotation}` : ""}`;
  if (!supplier) redirect(withNotice(back, { error: "Please choose the supplier." }));
  const { data, error } = await supabase.rpc("create_purchase_order", {
    p_company: company.id,
    p_supplier: supplier,
    p_quotation: quotation,
  });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  done(
    data as string,
    quotation ? "Draft PO created with the client's items at last known cost. Check the prices." : "Draft PO created. Add the items.",
    "#lines",
  );
}

export async function savePoHeader(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const currency = str(form, "currency");
  const rate = currency === company.base_currency ? 1 : toNumber(str(form, "exchange_rate"));
  const freight = toNumber(str(form, "freight")) ?? 0;
  const vat = toNumber(str(form, "vat_rate"));
  if (rate === null || Number.isNaN(rate) || rate <= 0) fail(id, "Exchange rate must be more than zero.", "#details");
  if (Number.isNaN(freight) || freight < 0) fail(id, "Freight must be zero or more.", "#details");
  if (vat === null || Number.isNaN(vat) || vat < 0 || vat > 100) fail(id, "VAT must be between 0 and 100.", "#details");
  const { data, error } = await supabase
    .from("purchase_orders")
    .update({
      currency,
      exchange_rate: rate,
      order_date: str(form, "order_date") || undefined,
      expected_date: optional(form, "expected_date"),
      delivery_location: optional(form, "delivery_location"),
      payment_terms: optional(form, "payment_terms"),
      incoterms: optional(form, "incoterms"),
      supplier_ref: optional(form, "supplier_ref"),
      shipping_instructions: optional(form, "shipping_instructions"),
      notes: optional(form, "notes"),
      terms: optional(form, "terms"),
      freight,
      vat_rate: vat,
    })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(id, error?.message ?? "0 rows", "#details");
  done(id, "Purchase order details saved.", "#details");
}

export async function addPoLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "po_id");
  const productId = str(form, "product_id") || null;
  let description = str(form, "description");
  let unit = str(form, "unit");
  let price = toNumber(str(form, "unit_price"));
  const qty = toNumber(str(form, "quantity"));
  if (productId) {
    const [{ data: p }, { data: cost }, { data: po }] = await Promise.all([
      supabase.from("products").select("name, unit, brand, mfr_part_no").eq("id", productId).maybeSingle(),
      supabase.from("product_costs").select("last_cost").eq("product_id", productId).maybeSingle(),
      supabase.from("purchase_orders").select("exchange_rate").eq("id", id).maybeSingle(),
    ]);
    if (p) {
      description ||= [p.name, p.brand, p.mfr_part_no].filter(Boolean).join(" · ");
      unit ||= p.unit;
    }
    if (price === null && cost?.last_cost != null) {
      price = Math.round((Number(cost.last_cost) / Number(po?.exchange_rate ?? 1)) * 100) / 100;
    }
  }
  if (!description) fail(id, "Describe the item, or choose a product.", "#lines");
  if (qty === null || Number.isNaN(qty) || qty <= 0) fail(id, "Quantity must be more than zero.", "#lines");
  if (price === null || Number.isNaN(price) || price < 0) fail(id, "Enter the unit price (no last cost is known for this item).", "#lines");
  const { error } = await supabase.from("po_lines").insert({
    company_id: company.id,
    po_id: id,
    product_id: productId,
    description,
    quantity: qty,
    unit: unit || "pcs",
    unit_price: price,
  });
  if (error) fail(id, error.message, "#lines");
  done(id, "Line added.", "#lines");
}

export async function updatePoLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "po_id");
  const qty = toNumber(str(form, "quantity"));
  const price = toNumber(str(form, "unit_price"));
  if (qty === null || Number.isNaN(qty) || qty <= 0) fail(id, "Quantity must be more than zero.", "#lines");
  if (price === null || Number.isNaN(price) || price < 0) fail(id, "Unit price must be zero or more.", "#lines");
  const { data, error } = await supabase
    .from("po_lines")
    .update({ quantity: qty, unit_price: price })
    .eq("id", str(form, "line_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(id, error?.message ?? "0 rows", "#lines");
  done(id, "Line updated.", "#lines");
}

export async function removePoLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "po_id");
  const { data, error } = await supabase
    .from("po_lines")
    .delete()
    .eq("id", str(form, "line_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(id, error?.message ?? "0 rows", "#lines");
  done(id, "Line removed.", "#lines");
}

export async function submitPo(form: FormData) {
  kickOutbox(); // send any alerts this creates right after the response
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { data, error } = await supabase.rpc("submit_purchase_order", { p_id: id });
  if (error) fail(id, error.message);
  done(id, data === "approved" ? "Approved. Download the PDF and send it to the supplier." : "Sent to management for approval.");
}

export async function reviewPo(form: FormData) {
  kickOutbox(); // send any alerts this creates right after the response
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const approve = str(form, "decision") === "approve";
  const { error } = await supabase.rpc("review_purchase_order", { p_id: id, p_approve: approve, p_note: optional(form, "note") });
  if (error) fail(id, error.message);
  if (!approve) done(id, "Sent back with your note.");
  const { data: po } = await supabase.from("purchase_orders").select("status").eq("id", id).maybeSingle();
  done(id, po?.status === "pending_approval" ? "Your approval is saved. The next approver has been told." : "Purchase order approved.");
}

export async function markPoSent(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase.rpc("mark_po_sent", { p_id: id });
  if (error) fail(id, error.message);
  done(id, "Marked as sent to the supplier.");
}

export async function confirmPo(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase.rpc("confirm_purchase_order", {
    p_id: id,
    p_supplier_ref: optional(form, "supplier_ref"),
    p_expected: optional(form, "expected_date"),
  });
  if (error) fail(id, error.message);
  done(id, "Supplier confirmation recorded. Product costs updated from these prices.");
}

export async function cancelPo(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase.rpc("cancel_purchase_order", { p_id: id });
  if (error) fail(id, error.message);
  done(id, "Purchase order cancelled.");
}
