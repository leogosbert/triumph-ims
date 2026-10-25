"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import { finishUpload, startUpload } from "../actions";

/** Same list as portal_file_begin in the database. */
export const PORTAL_FILE_TYPES =
  "application/pdf,image/png,image/jpeg,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const PORTAL_MAX_BYTES = 15 * 1024 * 1024;

let storage: SupabaseClient | null = null;

/**
 * Sends one file from the portal: the server checks the supplier and hands back a one-time upload
 * address; the browser sends the file straight to storage with it (only the public anon key is used
 * here, and it cannot read anything); then the server confirms the file arrived.
 */
export async function uploadPortalFile(
  file: File,
  meta: { purpose: string; srfq_supplier_id?: string; submission_id?: string; bank_detail_id?: string; title?: string; reference?: string; expires_on?: string },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (file.size > PORTAL_MAX_BYTES) return { ok: false, error: "Files can be up to 15 MB." };
  const slot = await startUpload({ ...meta, file_name: file.name, content_type: file.type || "application/octet-stream", size: file.size });
  if ("error" in slot) return { ok: false, error: slot.error };
  storage ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await storage.storage.from("portal").uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
  if (error) return { ok: false, error: "The file could not be sent. Please try again." };
  const done = await finishUpload(slot.id);
  if (done.error) return { ok: false, error: done.error };
  return { ok: true, id: slot.id };
}
