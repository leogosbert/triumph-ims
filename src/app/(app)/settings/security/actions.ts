"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { friendlyError, withNotice } from "@/lib/messages";

export async function saveSecurity(form: FormData) {
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) redirect("/");
  const requireMfa = form.get("require_mfa") === "on";
  const idle = Number(form.get("idle") ?? 0);
  const { error } = await supabase.rpc("set_company_security", {
    p_company: company.id,
    p_require_mfa: requireMfa,
    p_idle_minutes: idle,
  });
  if (error) redirect(withNotice("/settings/security", { error: friendlyError(error.message) }));
  revalidatePath("/", "layout");
  redirect(withNotice("/settings/security", { msg: "Security settings saved." }));
}

/** A member lost their phone: remove their authenticator so they can set up a new one. */
export async function resetMemberMfa(form: FormData) {
  const { supabase, isManager } = await getAppContext();
  if (!isManager) redirect("/");
  const id = String(form.get("membership_id") ?? "");
  const { error } = await supabase.rpc("reset_member_mfa", { p_membership: id });
  if (error) redirect(withNotice("/settings/security", { error: friendlyError(error.message) }));
  redirect(withNotice("/settings/security", { msg: "Two-step verification was reset. They will set up a new authenticator at their next sign-in." }));
}
