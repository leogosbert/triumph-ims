"use server";

import { AI_TIMEOUT_MS, aiReady, callClaude, type AiBlock } from "@/lib/ai/claude";
import { checkDocument, DOCUMENT_SCHEMA, DOCUMENT_SYSTEM, documentInstruction, extractJson, type DocumentCheck } from "@/lib/ai/document";
import { getAppContext } from "@/lib/context";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/sales";

/** A picture sent with the form (Next.js keeps request bodies to about 1 MB; the browser shrinks photos first). */
const MAX_SENT = 950 * 1024;
/** A file already in the library: larger is slow to read within the time limit. */
const MAX_STORED = 3.5 * 1024 * 1024;
const READABLE = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

export type ReadDocumentResult = { ok: true; check: DocumentCheck } | { ok: false; error: string };

const TOO_SLOW = "The AI took too long. Try a clearer or smaller photo, or fill in the form by hand.";
const NOT_READ = "The document could not be read. Fill in the form by hand.";

/**
 * "Read with AI" for documents: a certificate, licence, permit, registration, contract, tax clearance,
 * insurance policy, SDS or CoA. Send either `file` (a photo or PDF) or `document_id` (read the file
 * already stored in the documents library). Returns the details read, checked against the company's
 * name and TIN. Nothing is saved: the form is filled in and the person checks and saves it.
 */
export async function readDocument(form: FormData): Promise<ReadDocumentResult> {
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeDocuments")) return { ok: false, error: "Your role cannot use the documents library." };
  if (!aiReady()) return { ok: false, error: "Reading documents with AI is not switched on." };

  let bytes: Buffer;
  let type: string;
  const docId = form.get("document_id");
  const file = form.get("file");
  if (typeof docId === "string" && docId) {
    if (!/^[0-9a-f-]{36}$/i.test(docId)) return { ok: false, error: "Not allowed." };
    const { data: d } = await supabase.from("documents").select("file_path, file_type, file_size").eq("id", docId).eq("company_id", company.id).maybeSingle();
    if (!d?.file_path) return { ok: false, error: "This document has no file yet." };
    if (!READABLE.includes(String(d.file_type))) return { ok: false, error: "AI can read photos and PDFs only. Fill in the details by hand." };
    if (Number(d.file_size ?? 0) > MAX_STORED) return { ok: false, error: "The file is too large to read quickly. Upload a smaller photo or PDF." };
    type = String(d.file_type);
    bytes = Buffer.alloc(0); // read after the allowance check below
    const allowed = await allowance(supabase, company.id);
    if (allowed) return allowed;
    const { data: blob, error } = await supabase.storage.from("documents").download(d.file_path);
    if (error || !blob) return { ok: false, error: "The file could not be opened." };
    if (blob.size > MAX_STORED) return { ok: false, error: "The file is too large to read quickly. Upload a smaller photo or PDF." };
    bytes = Buffer.from(await blob.arrayBuffer());
  } else {
    if (!(file instanceof Blob) || file.size === 0) return { ok: false, error: "Choose a photo or PDF of the document first." };
    type = file.type;
    if (!READABLE.includes(type)) return { ok: false, error: "AI can read photos and PDFs only. Fill in the details by hand." };
    if (file.size > MAX_SENT) return { ok: false, error: "The file is too large to read. Take a photo of the document instead." };
    const allowed = await allowance(supabase, company.id);
    if (allowed) return allowed;
    bytes = Buffer.from(await file.arrayBuffer());
  }

  const data = bytes.toString("base64");
  const picture: AiBlock =
    type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: type as "image/jpeg" | "image/png" | "image/webp", data } };
  const today = todayTz();
  const res = await callClaude({
    system: DOCUMENT_SYSTEM,
    content: [picture, { type: "text", text: documentInstruction(today) }],
    maxTokens: 1000,
    timeoutMs: AI_TIMEOUT_MS,
    schema: DOCUMENT_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
  });
  if (!res.ok) {
    if (res.reason === "refused") return { ok: false, error: "This does not look like a business document. Check the picture." };
    return { ok: false, error: res.reason === "timeout" ? TOO_SLOW : NOT_READ };
  }
  const raw = extractJson(res.text);
  if (raw && typeof raw === "object" && (raw as { is_document?: unknown }).is_document === false) {
    return { ok: false, error: "This does not look like a business document. Check the picture." };
  }
  const check = checkDocument(raw, { name: company.name, legalName: company.legal_name, tin: company.tin }, today);
  if (!check) return { ok: false, error: NOT_READ };
  return { ok: true, check };
}

/** The daily allowance per person: null when allowed, otherwise the message to show. */
async function allowance(supabase: Awaited<ReturnType<typeof getAppContext>>["supabase"], companyId: string): Promise<ReadDocumentResult | null> {
  const { data, error } = await supabase.rpc("use_ai_document", { p_company: companyId });
  if (error) {
    return {
      ok: false,
      error: /function|does not exist|schema cache/i.test(error.message) ? "This is not available yet. Ask LeMo Tech to run the latest database update." : "Not allowed.",
    };
  }
  return data === true ? null : { ok: false, error: "You have read many documents with AI today. Fill in the form by hand, or try again tomorrow." };
}
