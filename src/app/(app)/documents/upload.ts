import { createClient } from "@/lib/supabase/client";
import { DOC_MAX_BYTES, DOC_TYPES } from "@/lib/crm";
import { shrinkImage } from "@/lib/image";
import { attachDocumentFile } from "./actions";

/** Upload a file into a document's folder (documents/<company>/<document>/…) and link it. Browser only. */
export async function uploadDocumentFile(companyId: string, documentId: string, file: File): Promise<{ error?: string }> {
  if (!DOC_TYPES.includes(file.type)) return { error: "Please choose a PDF, a photo, or a Word or Excel file." };
  // Photos of certificates are made smaller; PDFs and office files go as they are.
  const shrunk = file.type.startsWith("image/") ? await shrinkImage(file, 2200, 0.85) : { blob: file as Blob, type: file.type, ext: "" };
  if (shrunk.blob.size > DOC_MAX_BYTES) return { error: "The file must be smaller than 20 MB." };
  const clean = file.name.replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_").slice(-80) || "file";
  const name = shrunk.type !== file.type && shrunk.ext ? clean.replace(/\.[^.]*$/, "") + `.${shrunk.ext}` : clean;
  const path = `${companyId}/${documentId}/${Date.now()}-${name}`;
  const { error } = await createClient().storage.from("documents").upload(path, shrunk.blob, { contentType: shrunk.type, upsert: false });
  if (error) return { error: `Upload failed: ${error.message}` };
  return attachDocumentFile(documentId, { path, name: file.name, type: shrunk.type, size: shrunk.blob.size });
}
