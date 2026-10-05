"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACTIVE_COMPANY_COOKIE, getAppContext } from "@/lib/context";
import { str } from "@/lib/format";
import { LANG_COOKIE } from "@/lib/i18n";
import { friendlyError, withNotice } from "@/lib/messages";
import { kickOutbox } from "@/lib/outbox";
import { DEVICE_COOKIE, isStepUpError, STEP_UP_MESSAGE } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { THEME_COOKIE } from "@/lib/theme";
import { primeLang, tr } from "@/lib/tr";

const COOKIE_OPTS = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };

/** The word typed to confirm: DELETE, or its Kiswahili form, in any capitals. */
async function confirmedDelete(typed: string): Promise<boolean> {
  await primeLang();
  const t = typed.trim().toLowerCase();
  return t.length > 0 && (t === "delete" || t === "futa" || t === tr("DELETE").trim().toLowerCase());
}

/** "Delete my account": schedules the deletion (7 days), then signs out on every device. */
export async function requestAccountDeletion(form: FormData) {
  const back = "/delete-my-account";
  if (!(await confirmedDelete(str(form, "confirm")))) {
    redirect(withNotice(back, { error: "Type DELETE in the box to confirm." }));
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { error } = await supabase.rpc("request_account_deletion", {
    p_reason: str(form, "reason").slice(0, 500) || null,
    p_close_companies: form.get("close_companies") === "on",
  });
  if (error) {
    redirect(withNotice(back, { error: isStepUpError(error) ? STEP_UP_MESSAGE : friendlyError(error.message) }));
  }
  // The warning email goes out within seconds (the scheduled job would also send it).
  kickOutbox();
  // Signed out everywhere: every phone and computer has to sign in again (and then sees "Keep my account").
  await supabase.auth.signOut({ scope: "global" });
  (await cookies()).delete(ACTIVE_COMPANY_COOKIE);
  redirect(
    withNotice("/login", {
      msg: "Your account will be deleted in 7 days. Changed your mind? Sign in before then and choose Keep my account.",
    }),
  );
}

/** "Keep my account" during the 7 days. */
export async function keepMyAccount() {
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_account_deletion");
  if (error) redirect(withNotice("/account-deleting", { error: friendlyError(error.message) }));
  redirect(withNotice("/", { msg: "Welcome back. Your account is kept and everything is as before." }));
}

/** Open a page of one of the person's companies (switching to it first): Team, Backups or Close company. */
export async function openCompanyPage(form: FormData) {
  const id = str(form, "company_id");
  const to = str(form, "to");
  const allowed = ["/settings/team", "/settings/backups", "/settings/company/close"];
  if (!/^[0-9a-f-]{36}$/i.test(id) || !allowed.includes(to)) redirect("/delete-my-account");
  (await cookies()).set(ACTIVE_COMPANY_COOKIE, id, COOKIE_OPTS);
  redirect(to);
}

/** "Close company account": all the company's data is deleted after 30 days. */
export async function requestCompanyClosure(form: FormData) {
  const { supabase, company, isManager } = await getAppContext();
  const back = "/settings/company/close";
  if (!isManager) redirect(withNotice("/", { error: "Only management can close the company." }));
  if (str(form, "company_name") !== company.name.trim()) {
    redirect(withNotice(back, { error: "Type the company name exactly as shown to confirm." }));
  }
  const { error } = await supabase.rpc("request_company_closure", { p_company: company.id });
  if (error) {
    redirect(withNotice(back, { error: isStepUpError(error) ? STEP_UP_MESSAGE : friendlyError(error.message) }));
  }
  redirect("/");
}

/** "Cancel closure" on the closing screen. */
export async function cancelCompanyClosure() {
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.rpc("cancel_company_closure", { p_company: company.id });
  if (error) redirect(withNotice("/", { error: friendlyError(error.message) }));
  redirect(withNotice("/", { msg: "The closure is cancelled. Everyone has their access back." }));
}

/**
 * "Clear this device and sign out" (the browser clears its own storage first): signs this
 * device out and forgets the cookies this app keeps (company, device, theme, language).
 */
export async function signOutThisDevice(): Promise<{ ok: boolean }> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    /* already signed out */
  }
  const jar = await cookies();
  for (const name of [ACTIVE_COMPANY_COOKIE, DEVICE_COOKIE, THEME_COOKIE, LANG_COOKIE]) {
    try {
      jar.delete(name);
    } catch {
      /* not set */
    }
  }
  return { ok: true };
}
