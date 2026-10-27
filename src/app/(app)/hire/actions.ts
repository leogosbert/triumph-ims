"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { RATE_PERIODS, canInvoiceService, canPlanService } from "@/lib/services";

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function money(form: FormData, key: string, path: string, message: string) {
  const v = toNumber(str(form, key));
  if (v === null) return null;
  if (Number.isNaN(v) || v < 0) fail(path, message);
  return v;
}

export async function createHire(form: FormData) {
  const path = "/hire/new";
  const { supabase, company, roles } = await getAppContext();
  if (!canPlanService(roles)) fail(path, "You don't have permission to do that.");
  const client_id = str(form, "client_id");
  if (!client_id) fail(path, "Choose the client.");
  const out_on = str(form, "out_on");
  if (!DATE.test(out_on)) fail(path, "Enter the date out.");
  const due_back_on = optional(form, "due_back_on");
  if (due_back_on && due_back_on < out_on) fail(path, "The return date must be on or after the date out.");
  const rate_period = str(form, "rate_period");
  const { data, error } = await supabase
    .from("hire_agreements")
    .insert({
      company_id: company.id,
      client_id,
      site: optional(form, "site"),
      contact: optional(form, "contact"),
      out_on,
      due_back_on,
      rate_period: rate_period in RATE_PERIODS ? rate_period : "day",
      deposit: money(form, "deposit", path, "The deposit must be a number of zero or more."),
      currency: (str(form, "currency") || company.base_currency).toUpperCase(),
      notes: optional(form, "notes"),
    })
    .select("id")
    .single();
  if (error || !data) fail(path, error?.message ?? "0 rows");
  revalidatePath("/hire");
  redirect(withNotice(`/hire/${data.id}`, { msg: "Hire saved. Now add the items." }));
}

export async function saveHire(form: FormData) {
  const id = str(form, "id");
  const path = `/hire/${id}`;
  const { supabase, company, roles } = await getAppContext();
  if (!canPlanService(roles)) fail(path, "You don't have permission to do that.");
  const { data, error } = await supabase
    .from("hire_agreements")
    .update({
      site: optional(form, "site"),
      contact: optional(form, "contact"),
      due_back_on: optional(form, "due_back_on"),
      deposit: money(form, "deposit", path, "The deposit must be a number of zero or more."),
      notes: optional(form, "notes"),
    })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/hire");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function addHireLine(form: FormData) {
  const id = str(form, "agreement_id");
  const path = `/hire/${id}#items`;
  const { supabase, company, roles } = await getAppContext();
  if (!canPlanService(roles)) fail(path, "You don't have permission to do that.");
  const product_id = str(form, "product_id");
  if (!product_id) fail(path, "Choose the item.");
  const quantity = toNumber(str(form, "quantity"));
  if (quantity === null || Number.isNaN(quantity) || quantity <= 0) fail(path, "Quantity must be a number above zero.");
  const rate = money(form, "rate", path, "The rate must be a number of zero or more.") ?? 0;
  const { data: p } = await supabase.from("products").select("name").eq("id", product_id).eq("company_id", company.id).maybeSingle();
  if (!p) fail(path, "That record wasn't found, or you don't have permission to change it.");
  const { error } = await supabase.from("hire_lines").insert({
    company_id: company.id,
    agreement_id: id,
    product_id,
    description: optional(form, "description") ?? p.name,
    quantity,
    rate,
  });
  if (error) fail(path, error.message);
  revalidatePath(`/hire/${id}`);
  revalidatePath("/hire");
  redirect(withNotice(path, { msg: "Item added." }));
}

export async function removeHireLine(form: FormData) {
  const id = str(form, "agreement_id");
  const path = `/hire/${id}#items`;
  const { supabase, company, roles } = await getAppContext();
  if (!canPlanService(roles)) fail(path, "You don't have permission to do that.");
  const { data, error } = await supabase.from("hire_lines").delete().eq("id", str(form, "line_id")).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath(`/hire/${id}`);
  revalidatePath("/hire");
  redirect(withNotice(path, { msg: "Removed." }));
}

export async function returnHire(form: FormData) {
  const id = str(form, "id");
  const path = `/hire/${id}`;
  const { supabase, roles } = await getAppContext();
  if (!canPlanService(roles)) fail(path, "You don't have permission to do that.");
  const day = str(form, "returned_on");
  const { error } = await supabase.rpc("return_hire", {
    p_id: id,
    p_returned_on: DATE.test(day) ? day : null,
    p_note: optional(form, "note"),
  });
  if (error) fail(path, error.message);
  revalidatePath("/hire");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Return recorded." }));
}

export async function cancelHire(form: FormData) {
  const id = str(form, "id");
  const path = `/hire/${id}`;
  const { supabase, roles } = await getAppContext();
  if (!canPlanService(roles)) fail(path, "You don't have permission to do that.");
  const { error } = await supabase.rpc("cancel_hire", { p_id: id });
  if (error) fail(path, error.message);
  revalidatePath("/hire");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Hire cancelled." }));
}

export async function invoiceHire(form: FormData) {
  const id = str(form, "id");
  const path = `/hire/${id}`;
  const { supabase, roles } = await getAppContext();
  if (!canInvoiceService(roles)) fail(path, "You don't have permission to do that.");
  const until = str(form, "until");
  const { data, error } = await supabase.rpc("invoice_hire", { p_id: id, p_until: DATE.test(until) ? until : null });
  if (error || !data) fail(path, error?.message ?? "0 rows");
  revalidatePath("/hire");
  revalidatePath(path);
  revalidatePath("/invoices");
  redirect(withNotice(`/invoices/${data as string}`, { msg: "Draft invoice made." }));
}
