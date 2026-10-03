"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function done(id: string, msg: string, anchor = ""): never {
  revalidatePath("/deliveries");
  revalidatePath(`/deliveries/${id}`);
  revalidatePath("/stock");
  revalidatePath("/driver");
  redirect(withNotice(`/deliveries/${id}${anchor}`, { msg }));
}
function fail(id: string, error: string, anchor = ""): never {
  redirect(withNotice(`/deliveries/${id}${anchor}`, { error: friendlyError(error) }));
}

export async function newDelivery(form: FormData) {
  const { supabase, company } = await getAppContext();
  const quotation = str(form, "quotation_id") || null;
  const client = str(form, "client_id") || null;
  const back = quotation ? `/quotations/${quotation}` : "/deliveries/new";
  if (!quotation && !client) redirect(withNotice(back, { error: "Choose the client." }));
  const { data, error } = await supabase.rpc("create_delivery", {
    p_company: company.id,
    p_client: client,
    p_quotation: quotation,
    p_warehouse: str(form, "warehouse_id") || null,
  });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  done(data as string, quotation ? "Delivery note created with what is still to deliver. Assign a driver and dispatch." : "Delivery note created. Add the items.");
}

export async function saveDelivery(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const values: Record<string, unknown> = {
    planned_date: optional(form, "planned_date"),
    driver_id: optional(form, "driver_id"),
    vehicle: optional(form, "vehicle"),
  };
  if (form.has("delivery_site")) {
    Object.assign(values, {
      warehouse_id: str(form, "warehouse_id"),
      delivery_site: optional(form, "delivery_site"),
      contact_name: optional(form, "contact_name"),
      contact_phone: optional(form, "contact_phone"),
      notes: optional(form, "notes"),
    });
  }
  const { data, error } = await supabase.from("deliveries").update(values).eq("id", id).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(id, error?.message ?? "0 rows", "#details");
  done(id, "Saved.", "#details");
}

export async function addDeliveryLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "delivery_id");
  const productId = str(form, "product_id") || null;
  let description = str(form, "description");
  let unit = str(form, "unit");
  if (productId && (!description || !unit)) {
    const { data: p } = await supabase.from("products").select("name, unit, brand, mfr_part_no").eq("id", productId).maybeSingle();
    if (p) {
      description ||= [p.name, p.brand, p.mfr_part_no].filter(Boolean).join(" · ");
      unit ||= p.unit;
    }
  }
  const qty = toNumber(str(form, "quantity"));
  if (!description) fail(id, "Describe the item, or choose a product.", "#lines");
  if (qty === null || Number.isNaN(qty) || qty <= 0) fail(id, "Quantity must be more than zero.", "#lines");
  const { error } = await supabase
    .from("delivery_lines")
    .insert({ company_id: company.id, delivery_id: id, product_id: productId, description, quantity: qty, unit: unit || "pcs" });
  if (error) fail(id, error.message, "#lines");
  done(id, "Item added.", "#lines");
}

export async function updateDeliveryLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "delivery_id");
  const qty = toNumber(str(form, "quantity"));
  if (qty === null || Number.isNaN(qty) || qty <= 0) fail(id, "Quantity must be more than zero.", "#lines");
  const { data, error } = await supabase
    .from("delivery_lines")
    .update({ quantity: qty })
    .eq("id", str(form, "line_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(id, error?.message ?? "0 rows", "#lines");
  done(id, "Quantity updated.", "#lines");
}

export async function removeDeliveryLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "delivery_id");
  const { data, error } = await supabase
    .from("delivery_lines")
    .delete()
    .eq("id", str(form, "line_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(id, error?.message ?? "0 rows", "#lines");
  done(id, "Item removed.", "#lines");
}

export async function dispatchDelivery(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase.rpc("dispatch_delivery", { p_id: id });
  if (error) fail(id, error.message);
  done(id, "Dispatched. Stock has been taken out of the store, oldest expiry first.");
}

export async function failDelivery(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase.rpc("fail_delivery", { p_id: id, p_reason: str(form, "reason") });
  if (error) fail(id, error.message);
  done(id, "Recorded as failed. The goods are back in stock.");
}

export async function cancelDelivery(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase.rpc("cancel_delivery", { p_id: id });
  if (error) fail(id, error.message);
  done(id, "Delivery note cancelled.");
}
