/**
 * AI for meetings, on the server only (uses src/lib/ai/claude.ts; ANTHROPIC_API_KEY never reaches the browser).
 *   rankAgenda     "Suggest topics": the business items found in the company's data, phrased and ranked by the AI
 *                  (8.5 s limit). Without AI, or when it does not answer, the items are ranked by weight.
 *   minutesInline  the minutes written within one screen request (8.5 s), only off Netlify or when the background
 *                  function cannot be reached. On Netlify the minutes are written by the background function
 *                  (netlify/functions/meeting-minutes-background.mts): paragraph minutes take longer than 8.5 s.
 * The prompts read Kiswahili, Sheng and mixed Kiswahili/English (SWAHILI_GUIDE in src/lib/meetings/minutes-core.ts).
 * The answers are checked by hand-written code before anything is shown or saved; nothing changes until a person
 * approves it.
 */

import { AI_TIMEOUT_MS, aiReady, callClaude } from "@/lib/ai/claude";
import type { AgendaCandidate } from "@/lib/meetings/model";
import { MINUTES_SCHEMA, MINUTES_SYSTEM, minutesUserText, parseJsonReply, validateMinutes, type MinutesBrief, type MinutesPayload } from "@/lib/meetings/minutes-core";
import { RECORDING_SUMMARY_SCHEMA, RECORDING_SUMMARY_SYSTEM, recordingSummaryUser, validateRecordingSummary, type RecordingBrief } from "@/lib/meetings/recording-core";

const AGENDA_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { key: { type: "string" }, title: { type: "string" }, why: { type: "string" } },
        required: ["key", "title", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

export const AGENDA_SYSTEM = `You help the manager of a general supply company in Tanzania prepare a meeting agenda.
You get business items found in the company's own data. Some were typed in Kiswahili, Sheng or mixed Kiswahili and English (for example "Mteja hajalipa invoice ya Oktoba", "mzigo wa grease umechelewa"); you understand them fluently.
Rank them by what most needs the team's attention now (money and safety first, then late work, then the rest) and rewrite each title in short, plain English (at most 12 words).
Give "why" as one short sentence on why it matters now. Keep names, amounts (TZS), dates and product names exactly as given. Use only the facts given; never invent numbers, names or items. Return only the keys you were given.`;

/** Ranked by the item's own weight (3 = urgent), follow-ups first within the same weight. */
export function rankByWeight(items: AgendaCandidate[]): AgendaCandidate[] {
  return [...items].sort((a, b) => b.weight - a.weight || Number(b.source === "follow_up") - Number(a.source === "follow_up"));
}

export async function rankAgenda(
  items: AgendaCandidate[],
  meeting: { title: string; topics: string[]; kind: string },
): Promise<{ items: AgendaCandidate[]; by: "ai" | "app"; note?: string }> {
  const fallback = rankByWeight(items);
  if (!aiReady() || items.length < 2) return { items: fallback, by: "app" };
  const brief = {
    meeting: { title: meeting.title, topics: meeting.topics, kind: meeting.kind },
    items: items.slice(0, 40).map((i) => ({ key: i.key, topic: i.topic, title: i.title, detail: i.detail, weight: i.weight })),
  };
  const res = await callClaude({
    system: AGENDA_SYSTEM,
    content: [{ type: "text", text: JSON.stringify(brief) }],
    maxTokens: 1500,
    timeoutMs: AI_TIMEOUT_MS,
    schema: AGENDA_SCHEMA,
    effort: "low",
  });
  if (!res.ok) return { items: fallback, by: "app", note: res.reason === "timeout" ? "The AI took too long; ranked by urgency instead." : undefined };
  const parsed = parseJsonReply(res.text) as { items?: unknown } | null;
  const byKey = new Map(items.map((i) => [i.key, i]));
  const out: AgendaCandidate[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(parsed?.items) ? parsed!.items : []) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const key = typeof r.key === "string" ? r.key : "";
    const base = byKey.get(key);
    if (!base || seen.has(key)) continue;
    seen.add(key);
    const title = typeof r.title === "string" ? r.title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    const why = typeof r.why === "string" ? r.why.replace(/\s+/g, " ").trim().slice(0, 300) : "";
    out.push({ ...base, title: title.length >= 4 ? title : base.title, why: why || undefined });
  }
  if (!out.length) return { items: fallback, by: "app" };
  // Anything the AI left out still shows, after its list.
  for (const i of fallback) if (!seen.has(i.key)) out.push(i);
  return { items: out, by: "ai" };
}

/** Short meetings: the minutes in one request (under the 8.5 s limit). Null when the AI is off or did not answer. */
export async function minutesInline(brief: MinutesBrief): Promise<{ ok: true; minutes: MinutesPayload } | { ok: false; reason: string }> {
  if (!aiReady()) return { ok: false, reason: "off" };
  const res = await callClaude({
    system: MINUTES_SYSTEM,
    content: [{ type: "text", text: minutesUserText(brief) }],
    maxTokens: 4000,
    timeoutMs: AI_TIMEOUT_MS,
    schema: MINUTES_SCHEMA,
    effort: "low",
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  const minutes = validateMinutes(parseJsonReply(res.text), brief);
  return minutes ? { ok: true, minutes } : { ok: false, reason: "failed" };
}

/** "Summarize this recording" within one screen request (short recordings, or off Netlify). */
export async function recordingSummaryInline(b: RecordingBrief): Promise<{ ok: true; summary: string; summary_sw: string } | { ok: false; reason: string }> {
  if (!aiReady()) return { ok: false, reason: "off" };
  const res = await callClaude({
    system: RECORDING_SUMMARY_SYSTEM,
    content: [{ type: "text", text: recordingSummaryUser(b) }],
    maxTokens: 1800,
    timeoutMs: AI_TIMEOUT_MS,
    schema: RECORDING_SUMMARY_SCHEMA,
    effort: "low",
  });
  if (!res.ok) return { ok: false, reason: res.reason };
  const v = validateRecordingSummary(parseJsonReply(res.text), b.swahili);
  return v ? { ok: true, ...v } : { ok: false, reason: "failed" };
}
