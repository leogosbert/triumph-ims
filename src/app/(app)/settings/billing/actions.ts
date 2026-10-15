"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/context";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { isMissingSql } from "@/components/suggestions/meta";
import { BILLING_MISSING } from "@/lib/billing";

/** Management: the name, email and TIN LeMo Tech prints on its invoices to this company. */
export async function saveBillingDetails(form: FormData) {
  const { supabase, company } = await requireManager();
  const back = "/settings/billing";
  const { error } = await supabase.rpc("set_billing_details", {
    p_company: company.id,
    p_name: str(form, "billing_name"),
    p_email: str(form, "billing_email"),
    p_tin: str(form, "billing_tin"),
  });
  if (error) redirect(withNotice(`${back}#details`, { error: isMissingSql(error) ? BILLING_MISSING : friendlyError(error.message) }));
  revalidatePath(back);
  redirect(withNotice(`${back}#details`, { msg: "Billing details saved." }));
}
