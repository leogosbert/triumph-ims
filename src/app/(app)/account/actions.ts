"use server";

import { checkPassword } from "@/lib/password";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { LEAKED_MESSAGE, timesLeaked } from "@/lib/pwned";
import { recentAuthOk, recordEvent, STEP_UP_MESSAGE } from "@/lib/security";

export async function updateProfile(form: FormData) {
  const { supabase, user } = await getAppContext();
  const fullName = str(form, "full_name");
  if (fullName.length < 2) redirect(withNotice("/account", { error: "Please enter your full name." }));
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName, phone: optional(form, "phone") })
    .eq("id", user.id);
  if (error) redirect(withNotice("/account", { error: friendlyError(error.message) }));
  revalidatePath("/", "layout");
  redirect(withNotice("/account", { msg: "Your details are saved." }));
}

export async function changePassword(form: FormData) {
  const { supabase, profile, company } = await getAppContext();
  const password = str(form, "password");
  const confirm = str(form, "confirm");
  const rule = checkPassword(password, [profile.full_name ?? "", profile.email ?? "", company.name]);
  if (!rule.ok) redirect(withNotice("/account", { error: rule.problems[0] }));
  if (password !== confirm) redirect(withNotice("/account", { error: "The two passwords don't match." }));
  // Checked here too, so the rule cannot be skipped by a modified browser.
  if ((await timesLeaked(password)) > 0) redirect(withNotice("/account", { error: LEAKED_MESSAGE }));
  // Someone holding an unlocked phone must not be able to take over the account.
  if (!(await recentAuthOk(supabase))) redirect(withNotice("/account", { error: STEP_UP_MESSAGE }));
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(withNotice("/account", { error: friendlyError(error.message) }));
  await recordEvent(supabase, "password_changed", company.id);
  redirect(withNotice("/account", { msg: "Password changed." }));
}
