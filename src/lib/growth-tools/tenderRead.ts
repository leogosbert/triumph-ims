import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_TIMEOUT_MS, aiReady, callClaude } from "@/lib/ai/claude";
import { checkTenderReading, TENDER_SCHEMA, TENDER_SYSTEM, tenderInstruction } from "./tenderAi";
import { scoreTender, type MatchContext } from "./tenderMatch";
import { extractTenderRules, mergeFields, type TenderFields } from "./tenderText";

/**
 * Reading one notice: AI when allowed (within the time limit), the rules otherwise or to fill gaps,
 * then the bid / no-bid score against the company's keywords, products, papers and past tenders.
 * Server only (it can call the AI service). Used by the app (Read again) and the scheduled job.
 */

export type TenderContext = MatchContext & { company: string | null };

export function toContext(raw: unknown): TenderContext {
  const r = (raw ?? {}) as Record<string, unknown>;
  const s = (r.settings ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    company: typeof r.company === "string" ? r.company : null,
    today: typeof r.today === "string" ? r.today : undefined,
    settings: {
      keywords: arr(s.keywords),
      exclude_keywords: arr(s.exclude_keywords),
      categories: arr(s.categories),
      buyers: arr(s.buyers),
      min_score: typeof s.min_score === "number" ? s.min_score : 40,
    },
    product_categories: arr(r.product_categories),
    products: Array.isArray(r.products) ? (r.products as MatchContext["products"]) : [],
    compliance: r.compliance && typeof r.compliance === "object" ? (r.compliance as Record<string, string>) : {},
    licences: arr(r.licences),
    buyers: Array.isArray(r.buyers) ? (r.buyers as MatchContext["buyers"]) : [],
    clients: arr(r.clients),
  };
}

export type Reading = {
  fields: TenderFields;
  by: "ai" | "rules";
  aiReason: "off" | "timeout" | "refused" | "failed" | "not_tender" | null;
  payload: Record<string, unknown>;
  score: number;
  decision: string;
};

/** Reads and scores (no database writes). `useAi`: the caller already checked the allowance. */
export async function readTender(
  notice: { title: string | null; raw_text: string | null; url?: string | null },
  ctx: TenderContext,
  opts: { useAi: boolean; timeoutMs?: number; now?: Date },
): Promise<Reading> {
  const text = (notice.raw_text ?? "").slice(0, 20000);
  const rules = extractTenderRules(text, notice.title);
  let fields = rules;
  let by: Reading["by"] = "rules";
  let aiFit: number | null = null;
  let aiReason: Reading["aiReason"] = null;
  let fitReason: string | null = null;
  if (opts.useAi && aiReady() && text.trim().length >= 20) {
    const res = await callClaude({
      system: TENDER_SYSTEM,
      content: [
        {
          type: "text",
          text: `${tenderInstruction(ctx.today ?? new Date().toISOString().slice(0, 10), { name: ctx.company ?? "the company", keywords: ctx.settings.keywords, categories: [...ctx.settings.categories, ...ctx.product_categories] })}\n\n<notice>\n${notice.title ? `${notice.title}\n\n` : ""}${text.slice(0, 12000)}\n</notice>`,
        },
      ],
      maxTokens: 900,
      timeoutMs: Math.min(opts.timeoutMs ?? AI_TIMEOUT_MS, AI_TIMEOUT_MS),
      schema: TENDER_SCHEMA as unknown as Record<string, unknown>,
      effort: "low",
    });
    if (res.ok) {
      const ai = checkTenderReading(res.text);
      if (ai) {
        fields = mergeFields(ai.fields, rules);
        by = "ai";
        aiFit = ai.isTender ? ai.fit : 0;
        fitReason = ai.fitReason;
        if (!ai.isTender) aiReason = "not_tender";
        if (ai.items.length && fields.summary && !fields.summary.includes(ai.items[0])) {
          fields = { ...fields, summary: `${fields.summary}\nItems: ${ai.items.join("; ")}`.slice(0, 2000) };
        }
      } else aiReason = "failed";
    } else aiReason = res.reason;
  } else if (opts.useAi) aiReason = "off";
  const m = scoreTender(fields, ctx, { aiFit, now: opts.now });
  const reasons = [...m.reasons];
  if (fitReason && by === "ai") reasons.splice(1, 0, { kind: "fit", ok: (aiFit ?? 0) >= 5, text: `AI: ${fitReason}` });
  if (aiReason === "not_tender") reasons.unshift({ kind: "fit", ok: false, text: "The AI thinks this is not a tender notice" });
  return {
    fields,
    by,
    aiReason,
    score: m.score,
    decision: m.decision,
    payload: { ...fields, extracted_by: by, score: m.score, decision: m.decision, reasons: reasons.slice(0, 12), matched: m.matched },
  };
}

/** The scheduled job: read and save the notices waiting, within the time left. Returns how many. */
export async function readWaitingNotices(
  admin: SupabaseClient,
  deadline: number,
  opts: { aiDaily?: number; limit?: number } = {},
): Promise<{ read: number; ai: number; errors: string[] }> {
  const out = { read: 0, ai: 0, errors: [] as string[] };
  const { data, error } = await admin.rpc("tender_notices_waiting", { p_limit: opts.limit ?? 10 });
  if (error) {
    out.errors.push(`notices: ${error.message}`);
    return out;
  }
  const contexts = new Map<string, TenderContext>();
  for (const n of (data ?? []) as { id: string; company_id: string; title: string | null; raw_text: string | null; url: string | null }[]) {
    const left = deadline - Date.now();
    if (left < 1200) break;
    let ctx = contexts.get(n.company_id);
    if (!ctx) {
      const { data: c, error: e } = await admin.rpc("tender_context_internal", { p_company: n.company_id });
      if (e) {
        out.errors.push(`context: ${e.message}`);
        continue;
      }
      ctx = toContext(c);
      contexts.set(n.company_id, ctx);
    }
    let useAi = false;
    if (aiReady() && left > 4000) {
      const { data: ok } = await admin.rpc("tender_ai_take", { p_company: n.company_id, p_daily: opts.aiDaily ?? 40 });
      useAi = ok === true;
    }
    const r = await readTender(n, ctx, { useAi, timeoutMs: Math.max(1000, Math.min(AI_TIMEOUT_MS, deadline - Date.now() - 800)) });
    const { error: se } = await admin.rpc("tender_notice_save_job", { p_notice: n.id, p: r.payload });
    if (se) out.errors.push(`save: ${se.message}`);
    else {
      out.read++;
      if (r.by === "ai") out.ai++;
    }
  }
  return out;
}
