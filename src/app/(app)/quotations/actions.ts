"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function back(id: string, anchor = "") {
  return `/quotations/${id}${anchor}`;
}

function done(id: string, msg: string, anchor = ""): never {
  revalidatePath("/quotations");
  revalidatePath(`/quotations/${id}`);
  revalidatePath("/sales");
  revalidatePath("/");
  redirect(withNotice(back(id, anchor), { msg }));
}

function fail(id: string, error: string, anchor = ""): never {
  redirect(withNotice(back(id, anchor), { error: friendlyError(error) }));
}

export async function newQuotation(form: FormData) {
  const { supabase, company } = await getAppContext();
  const clientId = str(form, "client_id");
  if (!clientId) redirect(withNotice("/quotations/new", { error: "Please choose the client." }));
  const { data, error } = await supabase.rpc("create_quotation", { p_company: company.id, p_client: clientId, p_rfq: null });
  if (error) redirect(withNotice("/quotations/new", { error: friendlyError(error.message) }));
  done(data as string, "Draft quotation created. Add the items.", "#lines");
}

export async function saveQuoteHeader(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const rate = toNumber(str(form, "exchange_rate"));
  const vat = toNumber(str(form, "vat_rate"));
  if (rate === null || Number.isNaN(rate) || rate <= 0) fail(id, "Exchange rate must be more than zero.", "#details");
  if (vat === null || Number.isNaN(vat) || vat < 0 || vat > 100) fail(id, "VAT rate must be between 0 and 100.", "#details");
  const currency = str(form, "currency");
  const { data, error } = await supabase
    .from("quotations")
    .update({
      contact_name: optional(form, "contact_name"),
      client_ref: optional(form, "client_ref"),
      currency,
      exchange_rate: currency === company.base_currency ? 1 : rate,
      issue_date: str(form, "issue_date") || undefined,
      valid_until: optional(form, "valid_until"),
      delivery_time: optional(form, "delivery_time"),
      payment_terms: optional(form, "payment_terms"),
      incoterms: optional(form, "incoterms"),
      vat_rate: vat,
      notes: optional(form, "notes"),
      terms: optional(form, "terms"),
    })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(id, error?.message ?? "0 rows", "#details");
  done(id, "Quotation details saved.", "#details");
}

export async function addQuoteLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "quotation_id");
  const productId = str(form, "product_id") || null;
  let description = str(form, "description");
  let unit = str(form, "unit");
  let price = toNumber(str(form, "unit_price"));
  const qty = toNumber(str(form, "quantity"));
  const discount = toNumber(str(form, "discount_pct")) ?? 0;

  if (productId) {
    const [{ data: p }, { data: q }] = await Promise.all([
      supabase.from("products").select("name, unit, brand, mfr_part_no, selling_price").eq("id", productId).maybeSingle(),
      supabase.from("quotations").select("exchange_rate").eq("id", id).maybeSingle(),
    ]);
    if (p) {
      description ||= [p.name, p.brand, p.mfr_part_no].filter(Boolean).join(" · ");
      unit ||= p.unit;
      if (price === null && p.selling_price != null) {
        // Catalogue prices are in the base currency; convert for foreign-currency quotes.
        price = Math.round((Number(p.selling_price) / Number(q?.exchange_rate ?? 1)) * 100) / 100;
      }
    }
  }
  if (!description) fail(id, "Describe the item, or choose a product.", "#lines");
  if (qty === null || Number.isNaN(qty) || qty <= 0) fail(id, "Quantity must be more than zero.", "#lines");
  if (price === null || Number.isNaN(price) || price < 0) fail(id, "Enter a unit price (this item has no catalogue price).", "#lines");
  if (Number.isNaN(discount) || discount < 0 || discount > 100) fail(id, "Discount must be between 0 and 100%.", "#lines");

  const { error } = await supabase.from("quotation_lines").insert({
    company_id: company.id,
    quotation_id: id,
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

export async function updateQuoteLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "quotation_id");
  const qty = toNumber(str(form, "quantity"));
  const price = toNumber(str(form, "unit_price"));
  const discount = toNumber(str(form, "discount_pct")) ?? 0;
  if (qty === null || Number.isNaN(qty) || qty <= 0) fail(id, "Quantity must be more than zero.", "#lines");
  if (price === null || Number.isNaN(price) || price < 0) fail(id, "Unit price must be zero or more.", "#lines");
  if (Number.isNaN(discount) || discount < 0 || discount > 100) fail(id, "Discount must be between 0 and 100%.", "#lines");
  const { data, error } = await supabase
    .from("quotation_lines")
    .update({ quantity: qty, unit_price: price, discount_pct: discount })
    .eq("id", str(form, "line_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(id, error?.message ?? "0 rows", "#lines");
  done(id, "Line updated.", "#lines");
}

export async function removeQuoteLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "quotation_id");
  const { data, error } = await supabase
    .from("quotation_lines")
    .delete()
    .eq("id", str(form, "line_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(id, error?.message ?? "0 rows", "#lines");
  done(id, "Line removed.", "#lines");
}

export async function submitQuote(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { data, error } = await supabase.rpc("submit_quotation", { p_id: id });
  if (error) fail(id, error.message);
  done(id, data === "approved" ? "Approved. You can now download the PDF and send it." : "Sent to management for approval.");
}

export async function reviewQuote(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const approve = str(form, "decision") === "approve";
  const { error } = await supabase.rpc("review_quotation", { p_id: id, p_approve: approve, p_note: optional(form, "note") });
  if (error) fail(id, error.message);
  done(id, approve ? "Quotation approved." : "Sent back to the salesperson with your note.");
}

export async function markSent(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase.rpc("mark_quotation_sent", { p_id: id });
  if (error) fail(id, error.message);
  done(id, "Marked as sent to the client.");
}

export async function recordOutcome(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const accepted = str(form, "outcome") === "accepted";
  const { error } = await supabase.rpc("record_quotation_outcome", {
    p_id: id,
    p_accepted: accepted,
    p_reason: optional(form, "reason"),
  });
  if (error) fail(id, error.message);
  done(id, accepted ? "Great — marked as accepted." : "Marked as rejected.");
}

export async function reviseQuote(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { data, error } = await supabase.rpc("revise_quotation", { p_id: id });
  if (error) fail(id, error.message);
  done(data as string, "New revision created as a draft. Make your changes and submit it.");
}

export async function cancelQuote(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase.rpc("cancel_quotation", { p_id: id });
  if (error) fail(id, error.message);
  done(id, "Quotation cancelled.");
}
