/**
 * Meeting recordings on the server: speech to text for a recording (OpenAI's transcription API, only when
 * OPENAI_API_KEY is set; nothing else is used), and the prompt, answer shape and check for "Summarize this
 * recording" (Claude, through the same Messages API call as the minutes).
 *
 *   OPENAI_API_KEY             optional. Without it the app says "Transcription is not set up" and relies on the
 *                              live speech capture in the browser and the typed notes.
 *   OPENAI_TRANSCRIBE_MODEL    optional, default whisper-1 (gives timestamps). gpt-4o-transcribe also works.
 *
 * Shared by the server actions and the Netlify background function (netlify/functions/meeting-recording-background.mts),
 * so no "@/" imports. Keys never reach the browser.
 */

import { callClaudeLong, paragraphs, parseJsonReply, SWAHILI_GUIDE } from "./minutes-core";
import { TRANSCRIBE_MAX_BYTES } from "./recording-shared";
export { extFor, fileNameFor, RECORDING_BUCKET, RECORDING_ROLLOVER_MS, RECORDING_SLICE_MS, TRANSCRIBE_MAX_BYTES } from "./recording-shared";


export type CaptureLang = "sw" | "en" | "mixed";

export function transcriptionReady(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.OPENAI_API_KEY;
}

export function transcribeModel(env: Record<string, string | undefined> = process.env): string {
  return env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
}

/** The language hint: Kiswahili for Kiswahili and for mixed meetings (it copes with English words), English for English. */
export function transcribeLanguage(lang: string | null | undefined): "sw" | "en" {
  return lang === "en" ? "en" : "sw";
}

/**
 * The prompt that steers speech to text: the style of the meeting and the names and words it will hear, so they are
 * spelled right (the model reads the last ~200 words of it).
 */
export function transcribePrompt(o: { company: string; title: string; names: string[]; lang: string | null | undefined; words?: string[] }): string {
  const names = [...new Set(o.names.map((n) => n.trim()).filter((n) => n.length >= 2))].slice(0, 30);
  const words = [...new Set((o.words ?? []).map((n) => n.trim()).filter((n) => n.length >= 2))].slice(0, 30);
  const style =
    o.lang === "en"
      ? `Business meeting of ${o.company} in Tanzania, in English with some Kiswahili.`
      : `Mkutano wa ${o.company} (Tanzania). Tunazungumza Kiswahili, mara nyingi tukichanganya na English, kwa mfano: "Tumekubaliana tutapeleka order ya Geita Ijumaa, na Juma ata-follow up invoice kesho."`;
  const parts = [
    style,
    `Topic: ${o.title}.`,
    names.length ? `Names: ${names.join(", ")}.` : "",
    `Words: TZS, shilingi, invoice, quotation, LPO, delivery, TRA, EFD, stock, supplier, mteja, mzigo, malipo${words.length ? `, ${words.join(", ")}` : ""}.`,
  ];
  return parts.filter(Boolean).join(" ").slice(0, 900);
}

const hms = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/** Segments with their start times -> "[00:01:05] text" lines (empty segments dropped). */
export function segmentLines(segments: { start?: number; text?: string }[], offsetSec = 0): string {
  return segments
    .map((x) => ({ at: Number(x.start ?? 0) + offsetSec, t: String(x.text ?? "").replace(/\s+/g, " ").trim() }))
    .filter((x) => x.t)
    .map((x) => `[${hms(x.at)}] ${x.t}`)
    .join("\n");
}

export type TranscribeResult = { ok: true; text: string } | { ok: false; reason: "off" | "too_big" | "timeout" | "failed"; status?: number };

/** One recording file -> text (with timestamps when the model gives them). */
export async function transcribeAudio(o: {
  apiKey: string;
  model: string;
  file: Blob;
  filename: string;
  language: "sw" | "en";
  prompt: string;
  timeoutMs: number;
}): Promise<TranscribeResult> {
  if (!o.apiKey) return { ok: false, reason: "off" };
  if (o.file.size > TRANSCRIBE_MAX_BYTES) return { ok: false, reason: "too_big" };
  const verbose = o.model.startsWith("whisper");
  const form = new FormData();
  form.append("file", o.file, o.filename);
  form.append("model", o.model);
  form.append("language", o.language);
  form.append("prompt", o.prompt);
  form.append("response_format", verbose ? "verbose_json" : "json");
  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${o.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(o.timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: "failed", status: res.status };
    const j = (await res.json()) as { text?: string; segments?: { start?: number; text?: string }[] };
    const text = verbose && Array.isArray(j.segments) && j.segments.length ? segmentLines(j.segments) : String(j.text ?? "").trim();
    return { ok: true, text };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "failed" };
  }
}

export function transcribeFailReason(r: TranscribeResult): string {
  if (r.ok) return "";
  switch (r.reason) {
    case "off":
      return "Transcription is not set up (OPENAI_API_KEY). Use the live speech capture or the typed notes.";
    case "too_big":
      return "This recording is too long to write down in one go (over 24 MB).";
    case "timeout":
      return "Writing down the recording took too long. Try again.";
    default:
      return r.status === 401 ? "The transcription key was refused. Check OPENAI_API_KEY." : "The recording could not be written down. Try again later.";
  }
}

// ------------------------------------------------------------------ "Summarize this recording"

export const RECORDING_SUMMARY_SCHEMA = {
  type: "object",
  properties: { summary: { type: "string" }, summary_sw: { type: "string" } },
  required: ["summary", "summary_sw"],
  additionalProperties: false,
};

export const RECORDING_SUMMARY_SYSTEM = `You are the meeting secretary inside LeMoSp, the business app of a general supply company in Tanzania.
${SWAHILI_GUIDE}
You write for a colleague who missed the meeting and wants to catch up quickly, in clear, simple English paragraphs.
Use only what is in the transcript; never invent names, numbers, dates or decisions.`;

export type RecordingBrief = {
  company: string;
  title: string;
  date: string;
  staff: string[];
  guests: string[];
  agenda: string[];
  transcript: string;
  swahili: boolean;
};

export function recordingSummaryUser(b: RecordingBrief): string {
  const t = b.transcript.length > 120_000 ? `${b.transcript.slice(0, 80_000)}\n[... middle of the recording left out ...]\n${b.transcript.slice(-40_000)}` : b.transcript;
  return `Summarise this recording of the meeting "${b.title}" on ${b.date} (${b.company}). The transcript comes from speech recognition of Kiswahili, English or both; expect mistakes.
Give:
- summary: 2 to 5 paragraphs in English, separated by a blank line. The first paragraph says what the meeting was about and its main outcome. Then what was discussed, what was decided and why, and the actions agreed with who does them and by when. Keep names, amounts (TZS), dates and product names exactly as said. Where something was unclear, say "(not clear in the recording)".
- summary_sw: ${b.swahili ? "one paragraph in natural, correct Kiswahili with the same main points." : '"" (not asked for).'}

Staff: ${b.staff.join(", ") || "-"}
Guests: ${b.guests.join(", ") || "-"}
Agenda: ${b.agenda.join("; ") || "-"}

Transcript:
${t}`;
}

/** The checked answer, or null when it is not usable. */
export function validateRecordingSummary(raw: unknown, swahili: boolean): { summary: string; summary_sw: string } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const summary = paragraphs(r.summary, 20_000);
  if (summary.length < 20) return null;
  return { summary, summary_sw: swahili ? paragraphs(r.summary_sw, 10_000) : "" };
}

/** "Summarize this recording" with Claude (background function, or a short recording from a screen request). */
export async function callRecordingSummary(
  b: RecordingBrief,
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<{ ok: true; summary: string; summary_sw: string } | { ok: false; error: string }> {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: "AI is not switched on (ANTHROPIC_API_KEY)." };
  if (b.transcript.trim().length < 40) return { ok: false, error: "The recording has no transcript yet. Write it down first." };
  const res = await callClaudeLong({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.ANTHROPIC_MODEL || "claude-opus-5-5",
    system: RECORDING_SUMMARY_SYSTEM,
    user: recordingSummaryUser(b),
    schema: RECORDING_SUMMARY_SCHEMA,
    maxTokens: 6000,
    timeoutMs,
  });
  if (!res.ok) return { ok: false, error: res.reason === "timeout" ? "The AI took too long. Try again." : "The AI could not write the summary. Try again later." };
  const v = validateRecordingSummary(parseJsonReply(res.text), b.swahili);
  return v ? { ok: true, ...v } : { ok: false, error: "The AI's summary did not check out. Try again." };
}
