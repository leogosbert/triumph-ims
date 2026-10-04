"use server";

import { checkPassword } from "@/lib/password";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

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
  const { supabase } = await getAppContext();
  const password = str(form, "password");
  const confirm = str(form, "confirm");
  const { profile, company } = await getAppContext();
  const rule = checkPassword(password, [profile.full_name ?? "", profile.email ?? "", company.name]);
  if (!rule.ok) redirect(withNotice("/account", { error: rule.problems[0] }));
  if (password !== confirm) redirect(withNotice("/account", { error: "The two passwords don't match." }));
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect(withNotice("/account", { error: friendlyError(error.message) }));
  redirect(withNotice("/account", { msg: "Password changed." }));
}
