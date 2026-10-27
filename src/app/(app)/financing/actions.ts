"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext, noAccess } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { can } from "@/lib/roles";

const UUID = /^[0-9a-f-]{36}$/i;

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

async function ctx() {
  const c = await getAppContext();
  if (!can(c.roles, "seeFinance")) noAccess();
  return c;
}

function refresh(id?: string) {
  revalidatePath("/financing");
  if (id) revalidatePath(`/financing/${id}`);
}

/** Amount text -> number string for the database; "" when empty; "bad" when not a number. */
function amount(form: FormData, key: string): string | "bad" {
  const raw = str(form, key);
  if (!raw) return "";
  const n = toNumber(raw);
  return n === null || Number.isNaN(n) || n < 0 ? "bad" : String(n);
}

function details(form: FormData): { values?: Record<string, unknown>; error?: string } {
  const bank = str(form, "bank_name");
  if (bank.length < 2) return { error: "Enter the bank's name." };
  const nums: Record<string, string> = {};
  for (const k of ["amount", "lpo_amount", "interest_rate"]) {
    const v = amount(form, k);
    if (v === "bad") return { error: "Amounts must be numbers." };
    nums[k] = v;
  }
  if (nums.interest_rate && Number(nums.interest_rate) > 100) return { error: "The interest rate is a yearly % from 0 to 100." };
  const tenor = Math.round(Number(str(form, "tenor_days") || 90));
  if (!Number.isFinite(tenor) || tenor < 7 || tenor > 365) return { error: "The tenor is 7 to 365 days." };
  const remind = Math.round(Number(str(form, "remind_days") || 7));
  const doc = str(form, "lpo_document_id");
  const facility = str(form, "facility");
  return {
    values: {
      bank_name: bank.slice(0, 120),
      bank_branch: optional(form, "bank_branch"),
      bank_contact: optional(form, "bank_contact"),
      facility: ["lpo_finance", "invoice_discounting", "overdraft", "other"].includes(facility) ? facility : "lpo_finance",
      amount: nums.amount,
      tenor_days: String(tenor),
      interest_rate: nums.interest_rate,
      lpo_number: optional(form, "lpo_number"),
      lpo_date: /^\d{4}-\d{2}-\d{2}$/.test(str(form, "lpo_date")) ? str(form, "lpo_date") : "",
      lpo_amount: nums.lpo_amount,
      lpo_document_id: UUID.test(doc) ? doc : "",
      purpose: optional(form, "purpose"),
      remind_days: String(Number.isFinite(remind) ? Math.max(0, Math.min(60, remind)) : 7),
      notes: optional(form, "notes"),
    },
  };
}

export async function createRequest(form: FormData) {
  const quotation = str(form, "quotation_id");
  const back = `/financing/new?quotation=${encodeURIComponent(quotation)}`;
  const { supabase } = await ctx();
  if (!UUID.test(quotation)) fail("/financing/new", "Choose the order first.");
  const { values, error } = details(form);
  if (error) fail(back, error);
  const { data, error: dbError } = await supabase.rpc("financing_create", { p_quotation: quotation, p: values });
  if (dbError) fail(back, dbError.message);
  refresh(data as string);
  redirect(withNotice(`/financing/${data}`, { msg: "Request saved. Download the pack, check it and send it to the bank." }));
}

export async function saveRequest(form: FormData) {
  const id = str(form, "id");
  const path = `/financing/${id}`;
  const { supabase, company } = await ctx();
  const { values, error } = details(form);
  if (error) fail(path, error);
  const v = values!;
  const row: Record<string, unknown> = {
    bank_name: v.bank_name,
    bank_branch: v.bank_branch,
    bank_contact: v.bank_contact,
    facility: v.facility,
    tenor_days: Number(v.tenor_days),
    interest_rate: v.interest_rate === "" ? null : Number(v.interest_rate),
    lpo_number: v.lpo_number,
    lpo_date: v.lpo_date || null,
    lpo_amount: v.lpo_amount === "" ? null : Number(v.lpo_amount),
    lpo_document_id: v.lpo_document_id || null,
    purpose: v.purpose,
    remind_days: Number(v.remind_days),
    notes: v.notes,
    repayment_source: optional(form, "repayment_source") ?? "Payment of the invoice by the client",
  };
  if (v.amount !== "") row.amount = Number(v.amount);
  const { data, error: dbError } = await supabase.from("financing_requests").update(row).eq("id", id).eq("company_id", company.id).select("id");
  if (dbError || !data?.length) fail(path, dbError?.message ?? "Not allowed.");
  refresh(id);
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function setRequestStatus(form: FormData) {
  const id = str(form, "id");
  const path = `/financing/${id}`;
  const { supabase } = await ctx();
  const approved = amount(form, "approved_amount");
  if (approved === "bad") fail(path, "Amounts must be numbers.");
  const invoice = str(form, "invoice_id");
  const { error } = await supabase.rpc("financing_set_status", {
    p_id: id,
    p_status: str(form, "status"),
    p: {
      on: /^\d{4}-\d{2}-\d{2}$/.test(str(form, "on")) ? str(form, "on") : "",
      approved_amount: approved,
      bank_reference: optional(form, "bank_reference"),
      note: optional(form, "note"),
      ...(UUID.test(invoice) ? { invoice_id: invoice } : {}),
    },
  });
  if (error) fail(path, error.message);
  refresh(id);
  revalidatePath("/notifications");
  redirect(withNotice(path, { msg: "Updated." }));
}

export async function deleteRequest(form: FormData) {
  const id = str(form, "id");
  const { supabase, company, isManager } = await ctx();
  if (!isManager) fail(`/financing/${id}`, "Only management can delete a request.");
  const { data, error } = await supabase.from("financing_requests").delete().eq("id", id).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(`/financing/${id}`, error?.message ?? "Only draft or cancelled requests can be deleted.");
  refresh();
  redirect(withNotice("/financing", { msg: "Request deleted." }));
}
