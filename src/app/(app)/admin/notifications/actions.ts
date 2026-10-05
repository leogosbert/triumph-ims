"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { onAdminHost } from "@/lib/hosts-server";
import { friendlyError, withNotice } from "@/lib/messages";
import { platformAdmin } from "../guard";

const BACK = "/admin/notifications";

/** Only verified platform admins (the database functions check again). */
async function requireAdmin() {
  const { supabase, ok } = await platformAdmin();
  if (!ok) redirect(withNotice((await onAdminHost()) ? "/admin" : "/", { error: "That area is only for the LeMo Tech platform team." }));
  return supabase;
}

export async function markAllAdminRead() {
  const supabase = await requireAdmin();
  const { error } = await supabase.rpc("read_all_platform_notifications");
  if (error) redirect(withNotice(BACK, { error: friendlyError(error.message) }));
  revalidatePath("/admin", "layout");
  redirect(BACK);
}

export async function saveAdminEmailSetting(form: FormData) {
  const supabase = await requireAdmin();
  const on = form.get("notify_email") === "on";
  const { error } = await supabase.rpc("set_platform_notify_email", { p_on: on });
  if (error) redirect(withNotice(`${BACK}#settings`, { error: friendlyError(error.message) }));
  redirect(withNotice(`${BACK}#settings`, { msg: on ? "You will also get these by email." : "Emails switched off." }));
}

/**
 * Called from the browser after the admin allows notifications on this device.
 * On the LeMoSp ADMIN address the phone subscription belongs to the admin app only. Inside the
 * company app's address (no separate admin address yet) it is the same phone app, so it gets both.
 */
export async function saveAdminPushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string) {
  const { supabase, ok } = await platformAdmin();
  if (!ok) return { error: "That area is only for the LeMo Tech platform team." };
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return { error: "Invalid subscription" };
  const app = (await onAdminHost()) ? "admin" : "both";
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  const { error } = await supabase
    .from("push_subscriptions")
    .insert({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: String(userAgent ?? "").slice(0, 300), app });
  if (error && /push_subscriptions_service/.test(error.message)) return { error: "This browser's push service is not supported." };
  return error ? { error: friendlyError(error.message) } : { ok: true };
}

export async function removeAdminPushSubscription(endpoint: string) {
  const { supabase, ok } = await platformAdmin();
  if (!ok) return { ok: false };
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: true };
}
