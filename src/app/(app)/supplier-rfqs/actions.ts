"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function done(path: string, msg: string): never {
  revalidatePath("/supplier-rfqs");
  revalidatePath("/purchasing");
  revalidatePath(path.split("#")[0]);
  redirect(withNotice(path, { msg }));
}
function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

export async function createSupplierRfq(form: FormData) {
  const { supabase, company } = await getAppContext();
  const quotation = str(form, "quotation_id") || null;
  const rfq = str(form, "rfq_id") || null;
  const back = quotation ? `/quotations/${quotation}` : rfq ? `/rfqs/${rfq}` : "/supplier-rfqs/new";
  const { data, error } = await supabase.rpc("create_supplier_rfq", { p_company: company.id, p_rfq: rfq, p_quotation: quotation });
  if (error) fail(back, error.message);
  const id = data as string;
  const title = optional(form, "title");
  const due = optional(form, "due_on");
  const location = optional(form, "delivery_location");
  if (title || due || location) {
    await supabase
      .from("supplier_rfqs")
      .update({ ...(title ? { title } : {}), ...(due ? { due_on: due } : {}), ...(location ? { delivery_location: location } : {}) })
      .eq("id", id);
  }
  done(`/supplier-rfqs/${id}`, quotation || rfq ? "Supplier RFQ created with the items. Now add the suppliers to ask." : "Supplier RFQ created. Add the items and suppliers.");
}

export async function saveSrfqHeader(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const { data, error } = await supabase
    .from("supplier_rfqs")
    .update({
      title: optional(form, "title"),
      due_on: optional(form, "due_on"),
      delivery_location: optional(form, "delivery_location"),
      notes: optional(form, "notes"),
    })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(`/supplier-rfqs/${id}`, error?.message ?? "0 rows");
  done(`/supplier-rfqs/${id}`, "Saved.");
}

export async function addSrfqLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "srfq_id");
  const back = `/supplier-rfqs/${id}#items`;
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
  if (!description) fail(back, "Describe the item, or choose a product.");
  if (qty === null || Number.isNaN(qty) || qty <= 0) fail(back, "Quantity must be more than zero.");
  const { error } = await supabase.from("supplier_rfq_lines").insert({
    company_id: company.id,
    srfq_id: id,
    product_id: productId,
    description,
    quantity: qty,
    unit: unit || "pcs",
  });
  if (error) fail(back, error.message);
  done(back, "Item added.");
}

export async function removeSrfqLine(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "srfq_id");
  const { data, error } = await supabase
    .from("supplier_rfq_lines")
    .delete()
    .eq("id", str(form, "line_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(`/supplier-rfqs/${id}#items`, error?.message ?? "0 rows");
  done(`/supplier-rfqs/${id}#items`, "Item removed.");
}

export async function inviteSupplier(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "srfq_id");
  const supplierId = str(form, "supplier_id");
  const back = `/supplier-rfqs/${id}#suppliers`;
  if (!supplierId) fail(back, "Choose a supplier.");
  const { data: sup } = await supabase
    .from("suppliers")
    .select("currency, payment_terms, incoterms, lead_time_days")
    .eq("id", supplierId)
    .maybeSingle();
  const { error } = await supabase.from("supplier_rfq_suppliers").insert({
    company_id: company.id,
    srfq_id: id,
    supplier_id: supplierId,
    currency: sup?.currency ?? company.base_currency,
    payment_terms: sup?.payment_terms ?? null,
    incoterms: sup?.incoterms ?? null,
    lead_time_days: sup?.lead_time_days ?? null,
  });
  if (error) fail(back, /duplicate key/.test(error.message) ? "That supplier is already on this RFQ." : error.message);
  done(back, "Supplier added. Share the RFQ PDF with them.");
}

export async function removeInvite(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "srfq_id");
  const { data, error } = await supabase
    .from("supplier_rfq_suppliers")
    .delete()
    .eq("id", str(form, "invite_id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(`/supplier-rfqs/${id}#suppliers`, error?.message ?? "0 rows");
  done(`/supplier-rfqs/${id}#suppliers`, "Supplier removed.");
}

export async function setDeclined(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "srfq_id");
  const declined = str(form, "declined") === "true";
  const { error } = await supabase
    .from("supplier_rfq_suppliers")
    .update({ status: declined ? "declined" : "invited" })
    .eq("id", str(form, "invite_id"))
    .eq("company_id", company.id);
  if (error) fail(`/supplier-rfqs/${id}#suppliers`, error.message);
  done(`/supplier-rfqs/${id}#suppliers`, declined ? "Marked as declined." : "Marked as waiting for price.");
}

export async function saveSupplierQuote(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "srfq_id");
  const inviteId = str(form, "invite_id");
  const back = `/supplier-rfqs/${id}/quote/${inviteId}`;
  const currency = str(form, "currency") || company.base_currency;
  const rate = currency === company.base_currency ? 1 : toNumber(str(form, "exchange_rate"));
  const freight = toNumber(str(form, "freight")) ?? 0;
  const lead = toNumber(str(form, "lead_time_days"));
  if (rate === null || Number.isNaN(rate) || rate <= 0)
    fail(back, `Enter the exchange rate: how many ${company.base_currency} for 1 ${currency}.`);
  if (Number.isNaN(freight) || freight < 0) fail(back, "Freight must be a number of zero or more.");
  if (lead !== null && (Number.isNaN(lead) || lead < 0 || !Number.isInteger(lead))) fail(back, "Lead time must be a whole number of days.");

  const prices: { srfq_line_id: string; unit_price: number | null }[] = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("price_")) continue;
    const n = toNumber(String(v));
    if (Number.isNaN(n) || (n !== null && n < 0)) fail(back, "Prices must be numbers (leave empty if not offered).");
    prices.push({ srfq_line_id: k.slice(6), unit_price: n });
  }
  const anyPrice = prices.some((p) => p.unit_price !== null);

  const { error } = await supabase
    .from("supplier_rfq_suppliers")
    .update({
      currency,
      exchange_rate: rate,
      freight,
      lead_time_days: lead,
      payment_terms: optional(form, "payment_terms"),
      incoterms: optional(form, "incoterms"),
      valid_until: optional(form, "valid_until"),
      supplier_ref: optional(form, "supplier_ref"),
      notes: optional(form, "notes"),
      received_on: optional(form, "received_on"),
      status: anyPrice ? "quoted" : "invited",
    })
    .eq("id", inviteId)
    .eq("company_id", company.id);
  if (error) fail(back, error.message);

  if (prices.length) {
    const { error: e2 } = await supabase.from("supplier_quote_lines").upsert(
      prices.map((p) => ({ ...p, company_id: company.id, srfq_supplier_id: inviteId })),
      { onConflict: "srfq_supplier_id,srfq_line_id" },
    );
    if (e2) fail(back, e2.message);
  }
  done(`/supplier-rfqs/${id}#compare`, "Supplier prices saved.");
}

export async function awardSupplier(form: FormData) {
  const { supabase } = await getAppContext();
  const id = str(form, "srfq_id");
  const { data, error } = await supabase.rpc("award_supplier_rfq", { p_srfq_supplier: str(form, "invite_id") });
  if (error) fail(`/supplier-rfqs/${id}#compare`, error.message);
  revalidatePath("/purchase-orders");
  done(`/purchase-orders/${data as string}`, "Draft purchase order created from the winning prices. Check it and submit.");
}

export async function cancelSrfq(form: FormData) {
  const { supabase, company } = await getAppContext();
  const id = str(form, "id");
  const { error } = await supabase.from("supplier_rfqs").update({ status: "cancelled" }).eq("id", id).eq("company_id", company.id);
  if (error) fail(`/supplier-rfqs/${id}`, error.message);
  done(`/supplier-rfqs/${id}`, "Supplier RFQ cancelled.");
}
