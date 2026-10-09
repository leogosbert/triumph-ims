"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

export async function recordCash(form: FormData) {
  const amount = toNumber(str(form, "amount"));
  if (amount === null || Number.isNaN(amount)) redirect(withNotice("/cashflow", { error: "Enter the amount as a number." }));
  const { supabase, company } = await getAppContext();
  const { error } = await supabase
    .from("cash_positions")
    .insert({ company_id: company.id, amount, as_of: str(form, "as_of") || undefined, note: optional(form, "note") });
  if (error) redirect(withNotice("/cashflow", { error: friendlyError(error.message) }));
  revalidatePath("/cashflow");
  redirect(withNotice("/cashflow", { msg: "Cash today saved. The forecast starts from it." }));
}

export async function removeCash(form: FormData) {
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("cash_positions").delete().eq("id", str(form, "id")).eq("company_id", company.id);
  if (error) redirect(withNotice("/cashflow", { error: friendlyError(error.message) }));
  revalidatePath("/cashflow");
  redirect(withNotice("/cashflow", { msg: "Removed." }));
}
