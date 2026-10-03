"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

function safePath(p: string) {
  return p.startsWith("/") && !p.startsWith("//") ? p : "/finance";
}

export async function addOrderCost(form: FormData) {
  const { supabase, company } = await getAppContext();
  const back = safePath(str(form, "back"));
  const currency = str(form, "currency") || company.base_currency;
  const amount = toNumber(str(form, "amount"));
  const rate = toNumber(str(form, "exchange_rate"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) redirect(withNotice(back, { error: "Enter the cost amount." }));
  if (currency !== company.base_currency && (rate === null || Number.isNaN(rate) || rate <= 0))
    redirect(withNotice(back, { error: "Enter the exchange rate for the cost." }));
  const { error } = await supabase.from("order_costs").insert({
    company_id: company.id,
    quotation_id: str(form, "quotation_id") || null,
    po_id: str(form, "po_id") || null,
    kind: str(form, "kind") || "other",
    description: optional(form, "description"),
    amount,
    currency,
    exchange_rate: currency === company.base_currency ? 1 : rate,
    incurred_on: str(form, "incurred_on") || undefined,
  });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath(back.split("#")[0]);
  revalidatePath("/profit");
  redirect(withNotice(back, { msg: "Cost added." }));
}

export async function removeOrderCost(form: FormData) {
  const { supabase, company } = await getAppContext();
  const back = safePath(str(form, "back"));
  const { data, error } = await supabase.from("order_costs").delete().eq("id", str(form, "id")).eq("company_id", company.id).select("id");
  if (error || !data?.length) redirect(withNotice(back, { error: friendlyError(error?.message ?? "0 rows") }));
  revalidatePath(back.split("#")[0]);
  revalidatePath("/profit");
  redirect(withNotice(back, { msg: "Cost removed." }));
}

export async function applyLandedCost(form: FormData) {
  const { supabase, company } = await getAppContext();
  const po = str(form, "po_id");
  const back = `/purchase-orders/${po}#costs`;
  const { data, error } = await supabase.rpc("apply_landed_cost", { p_po: po });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath(`/purchase-orders/${po}`);
  revalidatePath("/products");
  const total = Number(data ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 });
  redirect(withNotice(back, { msg: `Landed cost ${company.base_currency} ${total} applied. Product costs updated.` }));
}
