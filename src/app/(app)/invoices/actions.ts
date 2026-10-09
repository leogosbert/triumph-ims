"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { kickOutbox } from "@/lib/outbox";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function back(id: string, anchor = "") {
  return `/invoices/${id}${anchor}`;
}

function refresh(id?: string) {
  revalidatePath("/invoices");
  revalidatePath("/finance");
  revalidatePath("/receivables");
  revalidatePath("/payments");
  revalidatePath("/");
  if (id) revalidatePath(`/invoices/${id}`);
}

function done(id: string, msg: string, anchor = ""): never {
  refresh(id);
  redirect(withNotice(back(id, anchor), { msg }));
}

function fail(id: string, error: string, anchor = ""): never {
  redirect(withNotice(back(id, anchor), { error: friendlyError(error) }));
}

/** Only allow redirects back into the app. */
function safePath(p: string, fallback: string) {
  return p.startsWith("/") && !p.startsWith("//") ? p : fallback;
}

export async function newInvoice(form: FormData) {
  const { supabase, company } = await getAppContext();
  const from = safePath(str(form, "back"), "/invoices/new");
  const client = str(form, "client_id") || null;
  const quotation = str(form, "quotation_id") || null;
  const delivery = str(form, "delivery_id") || null;
  if (!client && !quotation && !delivery) redirect(withNotice(from, { error: "Choose the client." }));
  const { data, error } = await supabase.rpc("create_invoice", {
    p_company: company.id,
    p_client: client,
    p_quotation: quotation,
    p_delivery: delivery,
  });
  if (error) redirect(withNotice(from, { error: friendlyError(error.message) }));
  if (quotation) revalidatePath(`/quotations/${quotation}`);
  if (delivery) revalidatePath(`/deliveries/${delivery}`);
  done(
    data as string,
    quotation || delivery ? "Draft invoice created from the order. Check it, then issue it." : "Draft invoice created. Add the items.",
  );
}

export async function saveInvoiceHeader(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const rate = toNumber(str(form, "exchange_rate"));
  const vat = toNumber(str(form, "vat_rate"));
  const currency = str(form, "currency");
  if (currency !== company.base_currency && (rate === null || Number.isNaN(rate) || rate <= 0))
    fail(id, "Exchange rate must be more than zero.", "#details");
  if (vat === null || Number.isNaN(vat) || vat < 0 || vat > 100) fail(id, "VAT rate must be between 0 and 100.", "#details");
  const { data, error } = await supabase
    .from("invoices")
    .update({
      currency,
      exchange_rate: currency === company.base_currency ? 1 : rate,
      issue_date: optional(form, "issue_date"),
      due_date: optional(form, "due_date"),
      client_ref: optional(form, "client_ref"),
      contact_name: optional(form, "contact_name"),
      payment_terms: optional(form, "payment_terms"),
      vat_rate: vat,
      notes: optional(form, "notes"),
      terms: optional(form, "terms"),
    })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(id, error?.message ?? "0 rows", "#details");
  done(id, "Invoice details saved.", "#details");
}

export async function addInvoiceLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "invoice_id");
  const productId = str(form, "product_id") || null;
  let description = str(form, "description");
  let unit = str(form, "unit");
  let price = toNumber(str(form, "unit_price"));
  const qty = toNumber(str(form, "quantity"));
  const discount = toNumber(str(form, "discount_pct")) ?? 0;

  if (productId) {
    const [{ data: p }, { data: inv }] = await Promise.all([
      supabase.from("products").select("name, unit, brand, mfr_part_no, selling_price").eq("id", productId).maybeSingle(),
      supabase.from("invoices").select("exchange_rate").eq("id", id).maybeSingle(),
    ]);
    if (p) {
      description ||= [p.name, p.brand, p.mfr_part_no].filter(Boolean).join(" · ");
      unit ||= p.unit;
      if (price === null && p.selling_price != null) {
        price = Math.round((Number(p.selling_price) / Number(inv?.exchange_rate ?? 1)) * 100) / 100;
      }
    }
  }
  if (!description) fail(id, "Describe the item, or choose a product.", "#lines");
  if (qty === null || Number.isNaN(qty) || qty <= 0) fail(id, "Quantity must be more than zero.", "#lines");
  if (price === null || Number.isNaN(price) || price < 0) fail(id, "Enter a unit price (this item has no catalogue price).", "#lines");
  if (Number.isNaN(discount) || discount < 0 || discount > 100) fail(id, "Discount must be between 0 and 100%.", "#lines");

  const { error } = await supabase.from("invoice_lines").insert({
    company_id: company.id,
    invoice_id: id,
    product_id: productId,
    description,
    quantity: qty,
    unit: unit || "pcs",
    unit_price: price,
    discount_pct: discount,
  });
  if (error) fail(id, error.message, "#lines");
  done(id, "Line added.", "#lines");
}

export async function updateInvoiceLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "invoice_id");
  const qty = toNumber(str(form, "quantity"));
  const price = toNumber(str(form, "unit_price"));
  const discount = toNumber(str(form, "discount_pct")) ?? 0;
  if (qty === null || Number.isNaN(qty) || qty <= 0) fail(id, "Quantity must be more than zero.", "#lines");
  if (price === null || Number.isNaN(price) || price < 0) fail(id, "Unit price must be zero or more.", "#lines");
  if (Number.isNaN(discount) || discount < 0 || discount > 100) fail(id, "Discount must be between 0 and 100%.", "#lines");
  const { data, error } = await supabase
    .from("invoice_lines")
    .update({ quantity: qty, unit_price: price, discount_pct: discount })
    .eq("id", str(form, "line_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(id, error?.message ?? "0 rows", "#lines");
  done(id, "Line updated.", "#lines");
}

export async function removeInvoiceLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "invoice_id");
  const { data, error } = await supabase
    .from("invoice_lines")
    .delete()
    .eq("id", str(form, "line_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(id, error?.message ?? "0 rows", "#lines");
  done(id, "Line removed.", "#lines");
}

export async function issueInvoice(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { data, error } = await supabase.rpc("issue_invoice", { p_id: id });
  if (error) fail(id, error.message);
  done(id, `Invoice ${data as string} issued. Share the PDF with the client.`);
}

export async function cancelInvoice(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase.rpc("cancel_invoice", { p_id: id, p_reason: str(form, "reason") });
  if (error) fail(id, error.message);
  done(id, "Invoice cancelled.");
}

export async function recordPayment(form: FormData) {
  kickOutbox(); // send any alerts this creates right after the response
  const { supabase } = await getAppContext();
  const id = str(form, "invoice_id");
  const amount = toNumber(str(form, "amount"));
  const rate = toNumber(str(form, "exchange_rate"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) fail(id, "Enter the amount received.", "#payments");
  if (rate !== null && (Number.isNaN(rate) || rate <= 0)) fail(id, "Exchange rate must be more than zero.", "#payments");
  const { error } = await supabase.rpc("record_payment", {
    p_invoice: id,
    p_received_on: optional(form, "received_on"),
    p_amount: amount,
    p_method: str(form, "method") || "bank_transfer",
    p_reference: str(form, "reference"),
    p_exchange_rate: rate,
    p_notes: str(form, "notes"),
    ...(form.has("provider") ? { p_provider: str(form, "method") === "mobile_money" ? str(form, "provider") || null : null } : {}),
  });
  if (error) fail(id, error.message, "#payments");
  done(id, "Payment recorded.", "#payments");
}

export async function voidPayment(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "invoice_id");
  const { error } = await supabase.rpc("void_payment", { p_id: str(form, "payment_id"), p_reason: str(form, "reason") });
  if (error) fail(id, error.message, "#payments");
  done(id, "Payment voided. The amount is owed again.", "#payments");
}
