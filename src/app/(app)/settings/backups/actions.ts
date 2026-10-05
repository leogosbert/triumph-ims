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
