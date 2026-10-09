"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

const LINKS = ["product_id", "supplier_id", "client_id", "tender_id", "contract_id"] as const;
const LINK_PAGES: Record<(typeof LINKS)[number], string> = {
  product_id: "/products",
  supplier_id: "/suppliers",
  client_id: "/clients",
  tender_id: "/tenders",
  contract_id: "/contracts",
};

function refresh(id?: string, links?: Record<string, unknown>) {
  revalidatePath("/documents");
  if (id) revalidatePath(`/documents/${id}`);
  for (const k of LINKS) {
    const v = links?.[k];
    if (typeof v === "string" && v) revalidatePath(`${LINK_PAGES[k]}/${v}`);
  }
}

function docValues(form: FormData): { values?: Record<string, unknown>; error?: string } {
  const title = str(form, "title");
  if (title.length < 2) return { error: "Give the document a name." };
  const remind = Math.round(toNumber(str(form, "remind_days")) ?? 30);
  const values: Record<string, unknown> = {
    title,
    kind: str(form, "kind") || "other",
    reference: optional(form, "reference"),
    issued_on: optional(form, "issued_on"),
    expires_on: optional(form, "expires_on"),
    remind_days: Number.isNaN(remind) ? 30 : Math.min(Math.max(remind, 0), 180),
    notes: optional(form, "notes"),
  };
  for (const k of LINKS) if (form.has(k)) values[k] = optional(form, k);
  return { values };
}

/** Step 1 of adding a document (the file is uploaded next, into the document's own folder). */
export async function createDocument(form: FormData): Promise<{ id?: string; error?: string }> {
  const { supabase, company } = await getAppContext();
  const { values, error } = docValues(form);
  if (error) return { error };
  const { data, error: dbError } = await supabase.from("documents").insert({ company_id: company.id, ...values }).select("id").single();
  if (dbError) return { error: friendlyError(dbError.message) };
  refresh(data.id, values);
  return { id: data.id };
}

/** Step 2: link the uploaded file (documents/<company>/<document>/<file>). */
export async function attachDocumentFile(
  id: string,
  file: { path: string; name: string; type: string; size: number },
): Promise<{ error?: string }> {
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase
    .from("documents")
    .update({ file_path: file.path, file_name: file.name.slice(0, 200), file_type: file.type, file_size: file.size })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id, product_id, supplier_id, client_id, tender_id, contract_id");
  if (error || !data?.length) return { error: friendlyError(error?.message ?? "0 rows") };
  refresh(id, data[0]);
  return {};
}

export async function saveDocument(form: FormData) {
  const id = str(form, "id");
  const path = `/documents/${id}`;
  const { supabase, company } = await getAppContext();
  const { values, error } = docValues(form);
  if (error) redirect(withNotice(path, { error }));
  const { data, error: dbError } = await supabase.from("documents").update(values!).eq("id", id).eq("company_id", company.id).select("id");
  if (dbError || !data?.length) redirect(withNotice(path, { error: friendlyError(dbError?.message ?? "0 rows") }));
  refresh(id, values);
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function archiveDocument(form: FormData) {
  const id = str(form, "id");
  const archive = str(form, "archive") === "1";
  const path = `/documents/${id}`;
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase
    .from("documents")
    .update({ archived_at: archive ? new Date().toISOString() : null })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id, product_id, supplier_id, client_id, tender_id, contract_id");
  if (error || !data?.length) redirect(withNotice(path, { error: friendlyError(error?.message ?? "0 rows") }));
  refresh(id, data[0]);
  redirect(withNotice(path, { msg: archive ? "Moved to the archive. It no longer shows on linked pages or gives reminders." : "Back in the library." }));
}
