"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { aiReady } from "@/lib/ai/claude";
import { getAppContext, noAccess } from "@/lib/context";
import { optional, str } from "@/lib/format";
import { readTender, toContext } from "@/lib/growth-tools/tenderRead";
import { friendlyError, withNotice } from "@/lib/messages";
import { can } from "@/lib/roles";

const BASE = "/tenders/alerts";
const UUID = /^[0-9a-f-]{36}$/i;

function fail(path: string, error: string): never {
  redirect(withNotice(path, { error: friendlyError(error) }));
}

function refresh(id?: string) {
  revalidatePath(BASE);
  revalidatePath("/tenders");
  if (id) revalidatePath(`${BASE}/${id}`);
}

async function ctx() {
  const c = await getAppContext();
  if (!can(c.roles, "seeCrm")) noAccess();
  return c;
}

/** Comma or new-line separated words -> a clean list (at most `max`, each up to 80 characters). */
function words(form: FormData, key: string, max: number): string[] {
  const out: string[] = [];
  for (const w of str(form, key).split(/[\n,;]+/)) {
    const t = w.replace(/\s+/g, " ").trim().slice(0, 80);
    if (t.length >= 2 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Reads one notice and saves the fields and the score. AI only when it is switched on and the
 * person's daily allowance (shared with "Read with AI" for documents) is not used up.
 */
async function readAndSave(noticeId: string, wantAi: boolean): Promise<{ by: string; note: string | null }> {
  const { supabase, company } = await getAppContext();
  const [{ data: n, error }, { data: raw, error: ce }] = await Promise.all([
    supabase.from("tender_notices").select("id, title, raw_text, url, status").eq("id", noticeId).eq("company_id", company.id).maybeSingle(),
    supabase.rpc("tender_context", { p_company: company.id }),
  ]);
  if (error || !n) throw new Error(error?.message ?? "Notice not found.");
  if (ce) throw new Error(ce.message);
  let useAi = false;
  let note: string | null = null;
  if (wantAi && aiReady()) {
    const { data: ok } = await supabase.rpc("use_ai_document", { p_company: company.id });
    useAi = ok === true;
    if (!useAi) note = "Today's AI allowance is used up: read with the built-in rules.";
  }
  const r = await readTender(n, toContext(raw), { useAi });
  if (useAi && r.by === "rules") note = r.aiReason === "timeout" ? "The AI took too long: read with the built-in rules." : "The AI could not read it: read with the built-in rules.";
  if (r.aiReason === "not_tender") note = "The AI thinks this is not a tender notice. Check it, or dismiss it.";
  const { error: se } = await supabase.rpc("tender_notice_save", { p_notice: noticeId, p: r.payload });
  if (se) throw new Error(se.message);
  return { by: r.by, note };
}

export async function addNotice(form: FormData) {
  const { supabase, company } = await ctx();
  const back = `${BASE}/new`;
  const url = optional(form, "url");
  if (url && !/^https?:\/\/\S+$/i.test(url)) fail(back, "The link must start with http:// or https://");
  const { data: id, error } = await supabase.rpc("tender_notice_add", {
    p_company: company.id,
    p: { raw_text: str(form, "raw_text").slice(0, 20000), title: optional(form, "title"), url },
  });
  if (error) fail(back, error.message);
  let note: string | null = null;
  try {
    note = (await readAndSave(id as string, true)).note;
  } catch (e) {
    note = `Saved, but not read yet: ${(e as Error).message}`;
  }
  refresh(id as string);
  redirect(withNotice(`${BASE}/${id}`, note ? { error: note } : { msg: "Read and scored. Check the details, then decide." }));
}

export async function readAgain(form: FormData) {
  const id = str(form, "id");
  const path = `${BASE}/${id}`;
  if (!UUID.test(id)) fail(BASE, "Not allowed.");
  await ctx();
  let res: { by: string; note: string | null };
  try {
    res = await readAndSave(id, str(form, "ai") === "1");
  } catch (e) {
    fail(path, (e as Error).message);
  }
  refresh(id);
  redirect(withNotice(path, res.note ? { error: res.note } : { msg: res.by === "ai" ? "Read again with AI." : "Read again." }));
}

/** A person corrects the details: saved as theirs, then scored again with the rules. */
export async function saveNotice(form: FormData) {
  const id = str(form, "id");
  const path = `${BASE}/${id}`;
  const { supabase, company } = await ctx();
  const date = str(form, "closing_date");
  const time = str(form, "closing_time");
  const closing = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T${/^\d{2}:\d{2}$/.test(time) ? time : "10:00"}:00+03:00` : "";
  const docs = str(form, "documents_required")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 30);
  const fields = {
    title: optional(form, "title"),
    buyer: optional(form, "buyer"),
    reference: optional(form, "reference"),
    category: optional(form, "category"),
    location: optional(form, "location"),
    closing_at: closing,
    bid_security: optional(form, "bid_security"),
    documents_required: docs,
  };
  const { data: raw, error: ce } = await supabase.rpc("tender_context", { p_company: company.id });
  if (ce) fail(path, ce.message);
  const { data: cur } = await supabase.from("tender_notices").select("summary, published_on").eq("id", id).eq("company_id", company.id).maybeSingle();
  const { scoreTender } = await import("@/lib/growth-tools/tenderMatch");
  const m = scoreTender(
    {
      title: fields.title,
      buyer: fields.buyer,
      reference: fields.reference,
      category: fields.category,
      location: fields.location,
      summary: cur?.summary ?? null,
      published_on: cur?.published_on ?? null,
      closing_at: closing || null,
      documents_required: docs,
      bid_security: fields.bid_security,
    },
    toContext(raw),
  );
  const { error } = await supabase.rpc("tender_notice_save", {
    p_notice: id,
    p: { ...fields, extracted_by: "person", score: m.score, decision: m.decision, reasons: m.reasons, matched: m.matched },
  });
  if (error) fail(path, error.message);
  refresh(id);
  redirect(withNotice(path, { msg: "Saved and scored again." }));
}

export async function dismissNotice(form: FormData) {
  const id = str(form, "id");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("tender_notice_dismiss", { p_notice: id, p_reason: optional(form, "reason") });
  if (error) fail(`${BASE}/${id}`, error.message);
  refresh(id);
  redirect(withNotice(str(form, "back") === "list" ? BASE : `${BASE}/${id}`, { msg: "Dismissed. It stays under Done if you change your mind." }));
}

export async function restoreNotice(form: FormData) {
  const id = str(form, "id");
  const { supabase } = await ctx();
  const { error } = await supabase.rpc("tender_notice_restore", { p_notice: id });
  if (error) fail(`${BASE}/${id}`, error.message);
  refresh(id);
  redirect(withNotice(`${BASE}/${id}`, { msg: "Back in the list." }));
}

export async function makeTender(form: FormData) {
  const id = str(form, "id");
  const path = `${BASE}/${id}`;
  const { supabase } = await ctx();
  const date = str(form, "closing_date");
  const time = str(form, "closing_time");
  const closing = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T${/^\d{2}:\d{2}$/.test(time) ? time : "10:00"}:00+03:00` : null;
  const client = str(form, "client_id");
  const { data, error } = await supabase.rpc("tender_notice_to_tender", {
    p_notice: id,
    p_client: UUID.test(client) ? client : null,
    p_closing_at: closing,
  });
  if (error) fail(path, error.message);
  refresh(id);
  redirect(withNotice(`/tenders/${data}`, { msg: "Tender made with the usual checklist and the papers the notice asks for." }));
}

/** From the Inbox: this email is a tender notice. */
export async function noticeFromInbox(form: FormData) {
  const message = str(form, "message_id");
  const back = str(form, "back").startsWith("/inbox") ? str(form, "back") : "/inbox";
  const { supabase } = await ctx();
  const { data: id, error } = await supabase.rpc("tender_notice_from_inbox", { p_message: message });
  if (error) fail(back, error.message);
  let note: string | null = null;
  try {
    const { data: n } = await supabase.from("tender_notices").select("extracted_at").eq("id", id as string).maybeSingle();
    if (!n?.extracted_at) note = (await readAndSave(id as string, true)).note;
  } catch (e) {
    note = (e as Error).message;
  }
  refresh(id as string);
  redirect(withNotice(`${BASE}/${id}`, note ? { error: note } : { msg: "Read as a tender notice." }));
}

export async function saveAlertSettings(form: FormData) {
  const path = `${BASE}/settings`;
  const { supabase, company } = await ctx();
  const min = Number(str(form, "min_score"));
  const { error } = await supabase.rpc("tender_save_settings", {
    p_company: company.id,
    p: {
      keywords: words(form, "keywords", 60),
      exclude_keywords: words(form, "exclude_keywords", 40),
      categories: words(form, "categories", 40),
      buyers: words(form, "buyers", 40),
      min_score: Number.isFinite(min) ? Math.max(0, Math.min(100, Math.round(min))) : 40,
      digest_on: form.get("digest_on") === "on",
      inbox_pick: form.get("inbox_pick") === "on",
    },
  });
  if (error) fail(path, error.message);
  refresh();
  redirect(withNotice(path, { msg: "Saved. New notices are scored with these words." }));
}

export async function addSource(form: FormData) {
  const path = `${BASE}/settings#sources`;
  const { supabase, company, isManager } = await ctx();
  if (!isManager) fail(path, "Only management can add web sources.");
  const url = str(form, "url");
  if (!/^https?:\/\/[a-zA-Z0-9.-]+(:[0-9]{2,5})?(\/\S*)?$/.test(url) || url.length > 500) fail(path, "Enter the full link of the page that lists the tenders, starting with https://");
  const hours = Number(str(form, "interval_hours"));
  const { error } = await supabase.from("tender_sources").insert({
    company_id: company.id,
    name: str(form, "name").slice(0, 120) || new URL(url).hostname,
    url,
    kind: str(form, "kind") === "rss" ? "rss" : "page",
    interval_hours: Number.isFinite(hours) ? Math.max(6, Math.min(168, Math.round(hours))) : 24,
  });
  if (error) fail(path, error.code === "23505" ? "This page is already a source." : error.message);
  refresh();
  redirect(withNotice(path, { msg: "Source added. It is read within the next hour, then once a day." }));
}

export async function toggleSource(form: FormData) {
  const path = `${BASE}/settings#sources`;
  const { supabase, company } = await ctx();
  const { data, error } = await supabase
    .from("tender_sources")
    .update({ active: str(form, "active") === "1" })
    .eq("id", str(form, "id"))
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "Only management can change web sources.");
  refresh();
  redirect(path);
}

export async function removeSource(form: FormData) {
  const path = `${BASE}/settings#sources`;
  const { supabase, company } = await ctx();
  const { data, error } = await supabase.from("tender_sources").delete().eq("id", str(form, "id")).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "Only management can remove web sources.");
  refresh();
  redirect(withNotice(path, { msg: "Source removed. Notices already found stay." }));
}
