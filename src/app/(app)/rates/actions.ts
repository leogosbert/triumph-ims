"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

export async function saveRate(form: FormData) {
  const { supabase, company } = await getAppContext();
  const currency = str(form, "currency").toUpperCase();
  const rate = toNumber(str(form, "rate"));
  if (!/^[A-Z]{3}$/.test(currency)) redirect(withNotice("/rates", { error: "Currency must be a 3-letter code like USD." }));
  if (rate === null || Number.isNaN(rate) || rate <= 0) redirect(withNotice("/rates", { error: "Enter a rate above zero." }));
  const { data: existing } = await supabase.from("exchange_rates").select("id").eq("company_id", company.id).eq("currency", currency).maybeSingle();
  const { error } = existing
    ? await supabase.from("exchange_rates").update({ rate }).eq("id", existing.id)
    : await supabase.from("exchange_rates").insert({ company_id: company.id, currency, rate });
  if (error) redirect(withNotice("/rates", { error: friendlyError(error.message) }));
  revalidatePath("/rates");
  redirect(withNotice("/rates", { msg: `${currency} rate saved.` }));
}

export async function removeRate(form: FormData) {
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("exchange_rates").delete().eq("id", str(form, "id")).eq("company_id", company.id);
  if (error) redirect(withNotice("/rates", { error: friendlyError(error.message) }));
  revalidatePath("/rates");
  redirect(withNotice("/rates", { msg: "Rate removed." }));
}
