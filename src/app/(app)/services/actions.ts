"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { isMissingSql } from "@/components/suggestions/meta";
import { BILLING_MISSING } from "@/lib/billing";

const KEY_RE = /^[a-z][a-z0-9_-]{1,59}$/;
const safeBack = (v: string, fallback: string) => (v.startsWith("/") && !v.startsWith("//") ? v : fallback);

/** Ask LeMo Tech for a service, an add-on or a playbook. The database decides who may ask for what. */
export async function requestService(form: FormData) {
  const { supabase, company } = await getAppContext();
  const back = safeBack(str(form, "back"), "/services");
  const key = str(form, "item");
  if (!KEY_RE.test(key)) redirect(withNotice(back, { error: "Unknown service." }));
  const qty = Number(str(form, "quantity") || "1");
  const { error } = await supabase.rpc("request_service", {
    p_company: company.id,
    p_item: key,
    p_quantity: Number.isFinite(qty) && qty > 0 ? qty : 1,
    p_note: optional(form, "note"),
  });
  if (error) redirect(withNotice(back, { error: isMissingSql(error) ? BILLING_MISSING : friendlyError(error.message) }));
  revalidatePath("/services");
  revalidatePath("/playbooks", "layout");
  redirect(withNotice(back, { msg: "Request sent. The LeMo Tech team will reply in the app, usually within one working day." }));
}

export async function cancelRequest(form: FormData) {
  const { supabase } = await getAppContext();
  const back = safeBack(str(form, "back"), "/services");
  const id = str(form, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect(back);
  const { error } = await supabase.rpc("cancel_service_request", { p_id: id });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath("/services");
  revalidatePath("/playbooks", "layout");
  redirect(withNotice(back, { msg: "Request cancelled." }));
}
