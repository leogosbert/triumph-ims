"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/context";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { isStepUpError } from "@/lib/security";
import { tr, primeLang } from "@/lib/tr";

/** Creates a key and hands it back once; only its hash is kept. */
export async function createApiKey(name: string): Promise<{ key?: string; error?: string; stepUp?: boolean }> {
  await primeLang();
  const { supabase, company } = await requireManager();
  const { data, error } = await supabase.rpc("create_api_key", { p_company: company.id, p_name: String(name ?? "").slice(0, 80) });
  if (error) return isStepUpError(error) ? { stepUp: true, error: tr("Please confirm it is you first.") } : { error: tr(friendlyError(error.message)) };
  revalidatePath("/integrations");
  return { key: String(data) };
}

export async function revokeApiKey(form: FormData) {
  const { supabase } = await requireManager();
  const { error } = await supabase.rpc("revoke_api_key", { p_id: str(form, "id") });
  if (error) redirect(withNotice("/integrations", { error: friendlyError(error.message) }));
  revalidatePath("/integrations");
  redirect(withNotice("/integrations#keys", { msg: "Key switched off. Systems using it can no longer read your data." }));
}
