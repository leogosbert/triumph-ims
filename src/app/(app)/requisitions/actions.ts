"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function refresh(id?: string) {
  revalidatePath("/requisitions");
  revalidatePath("/stock/reorder");
  revalidatePath("/");
  if (id) revalidatePath(`/requisitions/${id}`);
}

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

export async function createRequisition(form: FormData) {
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase
    .from("requisitions")
    .insert({
      company_id: company.id,
      needed_by: optional(form, "needed_by"),
      warehouse_id: optional(form, "warehouse_id"),
      reason: optional(form, "reason"),
      notes: optional(form, "notes"),
    })
    .select("id")
    .single();
  if (error) fail("/requisitions/new", error.message);
  refresh(data.id);
  redirect(withNotice(`/requisitions/${data.id}#items`, { msg: "Request started. Add the items you need." }));
}

export async function saveRequisition(form: FormData) {
  const id = str(form, "id");
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase
    .from("requisitions")
    .update({ needed_by: optional(form, "needed_by"), warehouse_id: optional(form, "warehouse_id"), reason: optional(form, "reason"), notes: optional(form, "notes") })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(`/requisitions/${id}`, error?.message ?? "0 rows");
  refresh(id);
  redirect(withNotice(`/requisitions/${id}`, { msg: "Saved." }));
}

export async function addRequisitionLine(form: FormData) {
  const id = str(form, "requisition_id");
  const path = `/requisitions/${id}#items`;
  const product = str(form, "product_id") || null;
  const description = str(form, "description");
  const qty = toNumber(str(form, "quantity"));
  if (!product && !description) fail(path, "Choose a product or describe the item.");
  if (qty === null || Number.isNaN(qty) || qty <= 0) fail(path, "Quantity must be more than zero.");
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("requisition_lines").insert({
    company_id: company.id,
    requisition_id: id,
    product_id: product,
    description,
    quantity: qty,
    unit: str(form, "unit") || "pcs",
    note: optional(form, "note"),
  });
  if (error) fail(path, error.message);
  refresh(id);
  redirect(path);
}

export async function removeRequisitionLine(form: FormData) {
  const id = str(form, "requisition_id");
  const path = `/requisitions/${id}#items`;
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("requisition_lines").delete().eq("id", str(form, "line_id")).eq("company_id", company.id);
  if (error) fail(path, error.message);
  refresh(id);
  redirect(path);
}

export async function submitRequisition(form: FormData) {
  const id = str(form, "id");
  const { supabase } = await getAppContext();
  const { data, error } = await supabase.rpc("submit_requisition", { p_id: id });
  if (error) fail(`/requisitions/${id}`, error.message);
  refresh(id);
  redirect(
    withNotice(`/requisitions/${id}`, {
      msg: data === "approved" ? "Approved. Procurement has been told to order it." : "Sent to management for approval.",
    }),
  );
}

export async function decideRequisition(form: FormData) {
  const id = str(form, "id");
  const approve = str(form, "decision") === "approve";
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("decide_requisition", { p_id: id, p_approve: approve, p_note: optional(form, "note") });
  if (error) fail(`/requisitions/${id}`, error.message);
  refresh(id);
  redirect(withNotice(`/requisitions/${id}`, { msg: approve ? "Approved. Procurement has been told to order it." : "Rejected. The requester has been told why." }));
}

export async function orderRequisition(form: FormData) {
  const id = str(form, "id");
  const supplier = str(form, "supplier_id");
  if (!supplier) fail(`/requisitions/${id}#order`, "Choose the supplier.");
  const { supabase } = await getAppContext();
  const { data, error } = await supabase.rpc("requisition_to_po", { p_id: id, p_supplier: supplier });
  if (error) fail(`/requisitions/${id}#order`, error.message);
  refresh(id);
  revalidatePath("/purchase-orders");
  redirect(withNotice(`/purchase-orders/${data as string}#lines`, { msg: "Draft purchase order made from the request, at last known cost. Check the prices." }));
}

export async function cancelRequisition(form: FormData) {
  const id = str(form, "id");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("cancel_requisition", { p_id: id });
  if (error) fail(`/requisitions/${id}`, error.message);
  refresh(id);
  redirect(withNotice(`/requisitions/${id}`, { msg: "Request cancelled." }));
}
