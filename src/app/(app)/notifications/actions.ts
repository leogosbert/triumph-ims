"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { friendlyError, withNotice } from "@/lib/messages";
import { kickOutbox } from "@/lib/outbox";

export async function markAllRead() {
  const { supabase, user } = await getAppContext();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null);
  revalidatePath("/", "layout");
  redirect("/notifications");
}

export async function saveNotificationSettings(form: FormData) {
  const { supabase, user } = await getAppContext();
  const values = { email_alerts: form.get("email_alerts") === "on", push_alerts: form.get("push_alerts") === "on" };
  const { data } = await supabase.from("notification_settings").select("user_id").eq("user_id", user.id).maybeSingle();
  const { error } = data
    ? await supabase.from("notification_settings").update(values).eq("user_id", user.id)
    : await supabase.from("notification_settings").insert(values);
  if (error) redirect(withNotice("/notifications#settings", { error: friendlyError(error.message) }));
  redirect(withNotice("/notifications#settings", { msg: "Notification settings saved." }));
}

export async function sendTestNotification() {
  kickOutbox();
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.rpc("send_test_notification", { p_company: company.id });
  if (error) redirect(withNotice("/notifications#settings", { error: friendlyError(error.message) }));
  revalidatePath("/", "layout");
  redirect(withNotice("/notifications#settings", { msg: "Test sent. It should reach this phone and your inbox within a minute (if they are set up)." }));
}

/** Called from the browser after the person allows notifications on this device. */
export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, userAgent: string) {
  const { supabase, user } = await getAppContext();
  if (!sub?.endpoint?.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) return { error: "Invalid subscription" };
  await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
  const { error } = await supabase
    .from("push_subscriptions")
    .insert({ user_id: user.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, user_agent: userAgent.slice(0, 300) });
  return error ? { error: friendlyError(error.message) } : { ok: true };
}

export async function removePushSubscription(endpoint: string) {
  const { supabase } = await getAppContext();
  await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  return { ok: true };
}
