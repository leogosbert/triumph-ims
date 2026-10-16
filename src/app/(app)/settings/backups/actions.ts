"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/context";
import { friendlyError, withNotice } from "@/lib/messages";

/** "Back up now": a copy by hand (up to 5 a day). */
export async function backupNow() {
  const { supabase, company } = await requireManager();
  const back = "/settings/backups";
  const { error } = await supabase.rpc("backup_now", { p_company: company.id });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath(back);
  redirect(withNotice(back, { msg: "Backup done. Your data is safe." }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ask LeMo Tech to put this backup back (the person confirmed it is them first). */
export async function requestRestore(form: FormData) {
  const { supabase } = await requireManager();
  const id = String(form.get("backup_id") ?? "");
  if (!UUID.test(id)) redirect("/settings/backups");
  const back = `/settings/backups/${id}`;
  const note = String(form.get("note") ?? "").trim().slice(0, 500);
  const { error } = await supabase.rpc("request_backup_restore", { p_backup: id, p_note: note || null });
  if (error) {
    const reauth = error.hint === "reauth" || error.code === "28000";
    redirect(withNotice(back, { error: reauth ? "Please confirm it is you first." : friendlyError(error.message) }));
  }
  revalidatePath("/settings/backups");
  redirect(withNotice("/settings/backups", { msg: "Restore requested. LeMo Tech has been told and will contact you before anything is changed." }));
}

/** Cancel an open restore request. */
export async function cancelRestore(form: FormData) {
  const { supabase } = await requireManager();
  const id = String(form.get("request_id") ?? "");
  if (!UUID.test(id)) redirect("/settings/backups");
  const { error } = await supabase.rpc("cancel_backup_restore", { p_request: id });
  if (error) redirect(withNotice("/settings/backups", { error: friendlyError(error.message) }));
  revalidatePath("/settings/backups");
  redirect(withNotice("/settings/backups", { msg: "Restore request cancelled." }));
}
