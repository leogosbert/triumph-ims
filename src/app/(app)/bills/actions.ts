"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function refresh(id?: string, po?: string | null) {
  revalidatePath("/bills");
  revalidatePath("/payables");
  revalidatePath("/finance");
  revalidatePath("/");
  if (id) revalidatePath(`/bills/${id}`);
  if (po) revalidatePath(`/purchase-orders/${po}`);
}

function done(id: string, msg: string, anchor = ""): never {
  refresh(id);
  redirect(withNotice(`/bills/${id}${anchor}`, { msg }));
}

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

function billValues(form: FormData, base: string, back: string) {
  const currency = str(form, "currency") || base;
  const rate = toNumber(str(form, "exchange_rate"));
  const subtotal = toNumber(str(form, "subtotal"));
  const vat = toNumber(str(form, "vat_amount")) ?? 0;
  if (subtotal === null || Number.isNaN(subtotal) || subtotal <= 0) fail(back, "Enter the bill amount before VAT.");
  if (Number.isNaN(vat) || vat < 0) fail(back, "VAT cannot be negative.");
  if (currency !== base && (rate === null || Number.isNaN(rate) || rate <= 0)) fail(back, "Enter the exchange rate.");
  return {
    supplier_invoice_no: optional(form, "supplier_invoice_no"),
    bill_date: str(form, "bill_date") || undefined,
    due_date: optional(form, "due_date"),
    currency,
    exchange_rate: currency === base ? 1 : rate,
    subtotal,
    vat_amount: vat,
    notes: optional(form, "notes"),
  };
}

export async function newBill(form: FormData) {
  const { supabase, company } = await getAppContext();
  const po = str(form, "po_id") || null;
  const back = po ? `/bills/new?po=${po}` : "/bills/new";
  const supplier = str(form, "supplier_id");
  if (!supplier) fail(back, "Choose the supplier.");
  const { data, error } = await supabase
    .from("supplier_bills")
    .insert({ company_id: company.id, supplier_id: supplier, po_id: po, ...billValues(form, company.base_currency, back) })
    .select("id")
    .single();
  if (error) fail(back, error.message);
  refresh(data.id, po);
  redirect(withNotice(`/bills/${data.id}`, { msg: "Supplier bill recorded." }));
}

export async function saveBill(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const back = `/bills/${id}#details`;
  const { data, error } = await supabase
    .from("supplier_bills")
    .update(billValues(form, company.base_currency, back))
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(back, error?.message ?? "0 rows");
  done(id, "Bill saved.", "#details");
}

export async function payBill(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "bill_id");
  const amount = toNumber(str(form, "amount"));
  const rate = toNumber(str(form, "exchange_rate"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) fail(`/bills/${id}#payments`, "Enter the amount paid.");
  if (rate !== null && (Number.isNaN(rate) || rate <= 0)) fail(`/bills/${id}#payments`, "Exchange rate must be more than zero.");
  const { error } = await supabase.rpc("pay_supplier_bill", {
    p_bill: id,
    p_paid_on: optional(form, "paid_on"),
    p_amount: amount,
    p_method: str(form, "method") || "bank_transfer",
    p_reference: str(form, "reference"),
    p_exchange_rate: rate,
    p_notes: str(form, "notes"),
  });
  if (error) fail(`/bills/${id}#payments`, error.message);
  done(id, "Payment to supplier recorded.", "#payments");
}

export async function voidSupplierPayment(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "bill_id");
  const { error } = await supabase.rpc("void_supplier_payment", { p_id: str(form, "payment_id"), p_reason: str(form, "reason") });
  if (error) fail(`/bills/${id}#payments`, error.message);
  done(id, "Payment voided.", "#payments");
}

export async function cancelBill(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase.rpc("cancel_supplier_bill", { p_id: id });
  if (error) fail(`/bills/${id}`, error.message);
  done(id, "Bill cancelled.");
}
