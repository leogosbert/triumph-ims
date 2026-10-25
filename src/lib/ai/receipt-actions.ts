"use server";

import { AI_TIMEOUT_MS, aiReady, callClaude, type AiBlock } from "@/lib/ai/claude";
import { checkReceipt, extractJson, receiptInstruction, RECEIPT_SCHEMA, RECEIPT_SYSTEM, type ReceiptCheck } from "@/lib/ai/receipt";
import { getAppContext } from "@/lib/context";
import { RECEIPT_TYPES } from "@/lib/image";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/sales";

/** What a server action can receive (Next.js keeps request bodies to about 1 MB): the form shrinks photos first. */
const MAX_BYTES = 950 * 1024;

export type ReadReceiptResult = { ok: true; check: ReceiptCheck } | { ok: false; error: string };

/**
 * "Scan receipt": sends one receipt photo or PDF to the AI service and returns the details it read,
 * checked. Nothing is saved: the form is filled in and the person checks and saves it.
 * purpose "expense": the company's spending categories are offered for a best guess.
 * purpose "bill": for the supplier-bill form (people who may record bills only).
 */
export async function readReceipt(form: FormData): Promise<ReadReceiptResult> {
  const { supabase, company, role } = await getAppContext();
  const purpose = form.get("purpose") === "bill" ? "bill" : "expense";
  if (purpose === "bill" && !can(role, "editBills")) return { ok: false, error: "Your role cannot record supplier bills." };
  if (!aiReady()) return { ok: false, error: "Reading receipts with AI is not switched on." };

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) return { ok: false, error: "Choose a photo of the receipt first." };
  const type = file.type;
  if (!RECEIPT_TYPES.includes(type)) return { ok: false, error: "Please choose a photo (JPG, PNG, WebP) or a PDF." };
  if (file.size > MAX_BYTES) return { ok: false, error: "The file is too large to read. Take a photo of the receipt instead." };

  // The daily allowance per person (so a stuck button or a script cannot run up the bill).
  const { data: allowed, error: limitError } = await supabase.rpc("use_ai_receipt", { p_company: company.id });
  if (limitError) {
    return {
      ok: false,
      error: /function|does not exist|schema cache/i.test(limitError.message)
        ? "This is not available yet. Ask LeMo Tech to run the latest database update."
        : "Not allowed.",
    };
  }
  if (allowed !== true) return { ok: false, error: "You have read many receipts with AI today. Fill in the form by hand, or try again tomorrow." };

  let categories: string[] = [];
  if (purpose === "expense") {
    const { data } = await supabase.from("expense_categories").select("name").eq("company_id", company.id).eq("active", true).order("sort").limit(60);
    categories = (data ?? []).map((c) => String(c.name));
  }

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const picture: AiBlock =
    type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
      : { type: "image", source: { type: "base64", media_type: type as "image/jpeg" | "image/png" | "image/webp", data } };
  const today = todayTz();
  const res = await callClaude({
    system: RECEIPT_SYSTEM,
    content: [picture, { type: "text", text: receiptInstruction(categories, company.base_currency, today) }],
    maxTokens: 1500,
    timeoutMs: AI_TIMEOUT_MS,
    schema: RECEIPT_SCHEMA as unknown as Record<string, unknown>,
    effort: "low",
  });
  if (!res.ok) {
    if (res.reason === "refused") return { ok: false, error: "This does not look like a receipt. Check the picture." };
    return {
      ok: false,
      error: res.reason === "timeout" ? "The AI took too long. Try a clearer or smaller photo, or fill in the form by hand." : "The receipt could not be read. Fill in the form by hand.",
    };
  }
  const check = checkReceipt(extractJson(res.text), categories, today);
  if (!check) return { ok: false, error: "The receipt could not be read. Fill in the form by hand." };
  return { ok: true, check };
}
