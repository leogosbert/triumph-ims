"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { onAdminHost } from "@/lib/hosts-server";
import { friendlyError, withNotice } from "@/lib/messages";
import { platformAdmin } from "../guard";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BACK = "/admin/backups";

/** Put a company's backup back (the request a manager made). Platform admin, recent sign-in, company name typed. */
export async function restoreBackup(form: FormData) {
  const { supabase, ok } = await platformAdmin();
  if (!ok) redirect(withNotice((await onAdminHost()) ? "/admin" : "/", { error: "That area is only for the LeMo Tech platform team." }));
  const id = String(form.get("request_id") ?? "");
  if (!UUID.test(id)) redirect(BACK);
  const { data, error } = await supabase.rpc("restore_company_backup", {
    p_request: id,
    p_confirm: String(form.get("company_name") ?? "").trim(),
  });
  if (error) {
    const reauth = error.hint === "reauth" || error.code === "28000";
    const timeout = /statement timeout|canceling statement/i.test(error.message ?? "");
    redirect(
      withNotice(BACK, {
        error: reauth
          ? "Please confirm it is you first."
          : timeout
            ? "This company is too large to restore from here. Run the SQL shown on this page in the Supabase SQL editor."
            : friendlyError(error.message),
      }),
    );
  }
  revalidatePath(BACK);
  const failed = (data as { error?: string } | null)?.error;
  if (failed) redirect(withNotice(BACK, { error: `Restore not done, nothing was changed: ${failed}` }));
  redirect(withNotice(BACK, { msg: "Restored. The managers have been told, and a safety copy was taken first." }));
}
