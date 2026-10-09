"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { can } from "@/lib/roles";

function refresh(id?: string) {
  revalidatePath("/expenses");
  revalidatePath("/finance");
  revalidatePath("/profit-loss");
  revalidatePath("/reconcile");
  if (id) revalidatePath(`/expenses/${id}`);
}

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

/** The editable fields of an expense, checked. Returns an error message instead of values when something is wrong. */
function expenseValues(form: FormData, base: string): { values?: Record<string, unknown>; error?: string } {
  const currency = str(form, "currency") || base;
  const amount = toNumber(str(form, "amount"));
  const vat = toNumber(str(form, "vat_amount")) ?? 0;
  const rate = toNumber(str(form, "exchange_rate"));
  const description = str(form, "description");
  const category = str(form, "category_id");
  if (!category) return { error: "Choose a category." };
  if (description.length < 2) return { error: "Say what the money was spent on." };
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "Enter the amount paid." };
  if (Number.isNaN(vat) || vat < 0) return { error: "VAT cannot be negative." };
  if (vat > amount) return { error: "The VAT part cannot be more than the amount paid." };
  if (currency !== base && (rate === null || Number.isNaN(rate) || rate <= 0)) return { error: "Enter the exchange rate." };
  const method = str(form, "method") || "cash";
  const values: Record<string, unknown> = {
    category_id: category,
    spent_on: str(form, "spent_on") || undefined,
    payee: optional(form, "payee"),
    description,
    amount,
    vat_amount: vat,
    currency,
    exchange_rate: currency === base ? 1 : rate,
    method,
    reference: optional(form, "reference"),
    notes: optional(form, "notes"),
  };
  if (form.has("provider")) values.provider = method === "mobile_money" ? optional(form, "provider") : null;
  return { values };
}

/** Called from the new-expense form (the receipt photo is uploaded afterwards, once the expense has an id). */
export async function createExpense(form: FormData): Promise<{ id?: string; error?: string }> {
  const { supabase, company } = await getAppContext();
  const { values, error } = expenseValues(form, company.base_currency);
  if (error) return { error };
  const { data, error: dbError } = await supabase
    .from("expenses")
    .insert({ company_id: company.id, ...values })
    .select("id")
    .single();
  if (dbError) return { error: friendlyError(dbError.message) };
  refresh(data.id);
  return { id: data.id };
}

/** Link an uploaded receipt photo (receipts/<company>/<expense>/<file>) to the expense. */
export async function attachReceipt(id: string, path: string | null): Promise<{ error?: string }> {
  const { supabase, company } = await getAppContext();
  const { data: old } = await supabase.from("expenses").select("receipt_path").eq("id", id).eq("company_id", company.id).maybeSingle();
  const { data, error } = await supabase
    .from("expenses")
    .update({ receipt_path: path })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) return { error: friendlyError(error?.message ?? "0 rows") };
  // The old photo is no longer needed (best effort; storage may refuse, which is harmless).
  if (old?.receipt_path && old.receipt_path !== path) await supabase.storage.from("receipts").remove([old.receipt_path]);
  refresh(id);
  return {};
}

export async function saveExpense(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const back = `/expenses/${id}#details`;
  const { values, error } = expenseValues(form, company.base_currency);
  if (error) fail(back, error);
  const { data, error: dbError } = await supabase.from("expenses").update(values!).eq("id", id).eq("company_id", company.id).select("id");
  if (dbError || !data?.length) fail(back, dbError?.message ?? "0 rows");
  refresh(id);
  redirect(withNotice(`/expenses/${id}`, { msg: "Expense saved." }));
}

export async function voidExpense(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase.rpc("void_expense", { p_id: id, p_reason: str(form, "reason") });
  if (error) fail(`/expenses/${id}`, error.message);
  refresh(id);
  redirect(withNotice(`/expenses/${id}`, { msg: "Expense voided." }));
}

// ---- Categories (management and finance) ----

export async function addCategory(form: FormData) {
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "manageExpenses")) redirect("/expenses");
  const name = str(form, "name");
  if (name.length < 2) fail("/expenses/categories", "Enter a name of at least 2 letters.");
  const { error } = await supabase.from("expense_categories").insert({ company_id: company.id, name, sort: 1000 });
  if (error) fail("/expenses/categories", /duplicate|unique/i.test(error.message) ? "There is already a category with that name." : error.message);
  revalidatePath("/expenses/categories");
  redirect(withNotice("/expenses/categories", { msg: "Category added." }));
}

export async function updateCategory(form: FormData) {
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "manageExpenses")) redirect("/expenses");
  const id = str(form, "id");
  const patch: Record<string, unknown> = {};
  if (form.has("name")) {
    const name = str(form, "name");
    if (name.length < 2) fail("/expenses/categories", "Enter a name of at least 2 letters.");
    patch.name = name;
  }
  if (form.has("active")) patch.active = str(form, "active") === "true";
  const { data, error } = await supabase.from("expense_categories").update(patch).eq("id", id).eq("company_id", company.id).select("id");
  if (error || !data?.length) {
    fail("/expenses/categories", error && /duplicate|unique/i.test(error.message) ? "There is already a category with that name." : (error?.message ?? "0 rows"));
  }
  revalidatePath("/expenses/categories");
  revalidatePath("/expenses");
  redirect(withNotice("/expenses/categories", { msg: "Category saved." }));
}
