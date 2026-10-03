"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { kickOutbox } from "@/lib/outbox";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { can } from "@/lib/roles";

function header(form: FormData) {
  return {
    client_id: str(form, "client_id"),
    title: optional(form, "title"),
    contact_name: optional(form, "contact_name"),
    client_ref: optional(form, "client_ref"),
    received_via: str(form, "received_via") || "email",
    received_on: str(form, "received_on") || undefined,
    due_on: optional(form, "due_on"),
    assigned_to: optional(form, "assigned_to"),
    notes: optional(form, "notes"),
  };
}

export async function saveRfq(form: FormData) {
  kickOutbox(); // send any alerts this creates right after the response
  const { supabase, company, role, user } = await getAppContext();
  const id = str(form, "id");
  const back = id ? `/rfqs/${id}` : "/rfqs/new";
  if (!can(role, "editSales")) redirect(withNotice(back, { error: "You don't have permission to edit RFQs." }));
  const values = header(form);
  if (!values.client_id) redirect(withNotice(back, { error: "Please choose the client." }));

  if (id) {
    const { data, error } = await supabase
      .from("rfqs")
      .update(values)
      .eq("id", id)
      .eq("company_id", company.id)
      .select("id");
    if (error || !data?.length) redirect(withNotice(back, { error: friendlyError(error?.message ?? "0 rows") }));
    revalidatePath("/rfqs");
    redirect(withNotice(back, { msg: "RFQ saved." }));
  }
  const { data, error } = await supabase
    .from("rfqs")
    .insert({ ...values, company_id: company.id, assigned_to: values.assigned_to ?? user.id })
    .select("id")
    .single();
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath("/rfqs");
  redirect(withNotice(`/rfqs/${(data as { id: string }).id}`, { msg: "RFQ recorded. Now add the items requested." }));
}

export async function addRfqLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const rfqId = str(form, "rfq_id");
  const back = `/rfqs/${rfqId}#lines`;
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
  if (!description) redirect(withNotice(back, { error: "Describe the item, or choose a product." }));
  if (qty === null || Number.isNaN(qty) || qty <= 0) redirect(withNotice(back, { error: "Quantity must be more than zero." }));
  const { error } = await supabase.from("rfq_lines").insert({
    company_id: company.id,
    rfq_id: rfqId,
    product_id: productId,
    description,
    quantity: qty,
    unit: unit || "pcs",
    notes: optional(form, "notes"),
  });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath(`/rfqs/${rfqId}`);
  redirect(withNotice(back, { msg: "Item added." }));
}

export async function removeRfqLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const rfqId = str(form, "rfq_id");
  const { data, error } = await supabase
    .from("rfq_lines")
    .delete()
    .eq("id", str(form, "line_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length)
    redirect(withNotice(`/rfqs/${rfqId}#lines`, { error: friendlyError(error?.message ?? "0 rows") }));
  revalidatePath(`/rfqs/${rfqId}`);
  redirect(withNotice(`/rfqs/${rfqId}#lines`, { msg: "Item removed." }));
}

export async function cancelRfq(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const { data, error } = await supabase
    .from("rfqs")
    .update({ status: "cancelled" })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) redirect(withNotice(`/rfqs/${id}`, { error: friendlyError(error?.message ?? "0 rows") }));
  revalidatePath("/rfqs");
  redirect(withNotice(`/rfqs/${id}`, { msg: "RFQ cancelled." }));
}

export async function quoteFromRfq(form: FormData) {
  const { supabase, company } = await getAppContext();
  const rfqId = str(form, "rfq_id");
  const { data, error } = await supabase.rpc("create_quotation", {
    p_company: company.id,
    p_client: str(form, "client_id"),
    p_rfq: rfqId,
  });
  if (error) redirect(withNotice(`/rfqs/${rfqId}`, { error: friendlyError(error.message) }));
  revalidatePath("/rfqs");
  revalidatePath("/quotations");
  redirect(withNotice(`/quotations/${data as string}`, { msg: "Draft quotation created from the RFQ. Check the prices." }));
}
