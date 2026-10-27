"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { displayName, getAppContext, type Profile } from "@/lib/context";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { aiReady } from "@/lib/ai/claude";
import { recordingSummaryInline } from "@/lib/ai/meetings";
import { RECORDING_COLUMNS, type Recording } from "@/lib/meetings/model";
import {
  callRecordingSummary,
  fileNameFor,
  RECORDING_BUCKET,
  transcribeAudio,
  transcribeFailReason,
  transcribeLanguage,
  transcribeModel,
  transcribePrompt,
  transcriptionReady,
  type RecordingBrief,
} from "@/lib/meetings/recording-core";
import { backgroundReady, dispatchBackground } from "./background";

const isId = (v: string | null | undefined): v is string => !!v && /^[0-9a-f-]{36}$/.test(v);

function back(form: FormData): string {
  const b = str(form, "back");
  return b.startsWith("/meetings/") && !b.startsWith("//") ? b : `/meetings/${str(form, "meeting_id")}`;
}

function finish(path: string, msg: string, error = false): never {
  revalidatePath("/meetings", "layout");
  redirect(withNotice(path, error ? { error: friendlyError(msg) } : { msg }));
}

/** Signed links (one hour) to a recording's pieces, in order, for the player. Only for people who may play it. */
export async function recordingFiles(recordingId: string): Promise<{ urls: string[]; mime: string } | { error: string }> {
  if (!isId(recordingId)) return { error: "Recording not found." };
  const { supabase } = await getAppContext();
  const { data: r } = await supabase.from("meeting_recordings").select("id, mime, deleted_at").eq("id", recordingId).maybeSingle();
  if (!r || r.deleted_at) return { error: "This recording is no longer available." };
  const { data: parts } = await supabase.from("meeting_recording_parts").select("storage_path").eq("recording_id", recordingId).order("seq").limit(1000);
  const paths = ((parts ?? []) as { storage_path: string }[]).map((p) => p.storage_path);
  if (!paths.length) return { error: "This recording is empty." };
  const { data: signed, error } = await supabase.storage.from(RECORDING_BUCKET).createSignedUrls(paths, 3600);
  if (error || !signed) return { error: "The recording could not be opened. Try again." };
  const urls = signed.map((x) => x.signedUrl).filter((u): u is string => !!u);
  if (urls.length !== paths.length) return { error: "Part of the recording could not be opened." };
  return { urls, mime: String(r.mime) };
}

/** Who was in the meeting and what it covered, for the transcription prompt and the summary. */
async function meetingContext(supabase: Awaited<ReturnType<typeof getAppContext>>["supabase"], meetingId: string) {
  const [{ data: m }, { data: att }, { data: agenda }] = await Promise.all([
    supabase.from("meetings").select("id, title, meeting_date").eq("id", meetingId).maybeSingle(),
    supabase.from("meeting_attendees").select("user_id, guest_name, guest_org").eq("meeting_id", meetingId),
    supabase.from("meeting_agenda_items").select("title").eq("meeting_id", meetingId).order("sort"),
  ]);
  const rows = (att ?? []) as { user_id: string | null; guest_name: string | null; guest_org: string | null }[];
  const ids = rows.map((a) => a.user_id).filter((x): x is string => !!x);
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id, full_name, email, phone").in("id", ids) : { data: [] };
  return {
    title: String(m?.title ?? ""),
    date: String(m?.meeting_date ?? ""),
    staff: ((profiles ?? []) as Profile[]).map((p) => displayName(p)),
    guests: rows.filter((a) => !a.user_id && a.guest_name).map((a) => [a.guest_name, a.guest_org].filter(Boolean).join(" · ")),
    agenda: ((agenda ?? []) as { title: string }[]).map((a) => a.title),
  };
}

/** "Write down the recording": server-side speech to text (needs OPENAI_API_KEY). */
export async function transcribeRecording(form: FormData) {
  const id = str(form, "recording_id");
  const path = back(form);
  if (!isId(id)) finish(path, "Recording not found.", true);
  if (!transcriptionReady()) finish(path, "Transcription is not set up yet. Ask the person who runs the app to add OPENAI_API_KEY.", true);
  const { supabase, company } = await getAppContext();
  const { data } = await supabase.from("meeting_recordings").select(RECORDING_COLUMNS).eq("id", id).maybeSingle();
  if (!data) finish(path, "Recording not found.", true);
  const r = data as unknown as Recording;
  const st = await supabase.rpc("meeting_recording_state", { p_recording: id, p_what: "transcript", p_state: "writing", p_error: null });
  if (st.error) finish(path, st.error.message, true);
  const ctx = await meetingContext(supabase, r.meeting_id);
  const prompt = { company: company.name, title: ctx.title, names: [...ctx.staff, ...ctx.guests.map((g) => g.split(" · ")[0])] };

  if (await dispatchBackground(supabase, "meeting-recording-background", { action: "transcribe", recording_ids: [id], prompt })) {
    finish(path, "The recording is being written down. This page updates when it is ready (a few minutes for a long meeting).");
  }
  if (backgroundReady()) {
    await supabase.rpc("meeting_recording_state", { p_recording: id, p_what: "transcript", p_state: "failed", p_error: "Writing down the recording could not start. Try again." });
    finish(path, "Writing down the recording could not start. Try again.", true);
  }
  // Not on Netlify (a local copy): within this request.
  const { data: parts } = await supabase.from("meeting_recording_parts").select("storage_path").eq("recording_id", id).order("seq").limit(1000);
  const blobs: Blob[] = [];
  for (const p of (parts ?? []) as { storage_path: string }[]) {
    const { data: b } = await supabase.storage.from(RECORDING_BUCKET).download(p.storage_path);
    if (b) blobs.push(b);
  }
  const res = await transcribeAudio({
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: transcribeModel(),
    file: new Blob(blobs, { type: r.mime.split(";")[0] }),
    filename: fileNameFor(r.mime),
    language: transcribeLanguage(r.language),
    prompt: transcribePrompt({ ...prompt, lang: r.language }),
    timeoutMs: 9 * 60_000,
  });
  if (res.ok && res.text) {
    await supabase.rpc("meeting_recording_save_transcript", { p_recording: id, p_text: res.text });
    finish(path, "The recording was written down.");
  }
  const why = res.ok ? "Nothing could be heard in the recording." : transcribeFailReason(res);
  await supabase.rpc("meeting_recording_state", { p_recording: id, p_what: "transcript", p_state: "failed", p_error: why });
  finish(path, why, true);
}

/** "Summarize this recording": English paragraphs from its transcript (and a Kiswahili paragraph when ticked). */
export async function summarizeRecording(form: FormData) {
  const id = str(form, "recording_id");
  const path = back(form);
  if (!isId(id)) finish(path, "Recording not found.", true);
  if (!aiReady()) finish(path, "AI is not switched on, so recordings cannot be summarised yet.", true);
  const { supabase, company } = await getAppContext();
  const { data } = await supabase.from("meeting_recordings").select(RECORDING_COLUMNS).eq("id", id).maybeSingle();
  if (!data) finish(path, "Recording not found.", true);
  const r = data as unknown as Recording;
  if (r.transcript.trim().length < 40) finish(path, "This recording has no transcript yet. Press Write down the recording first.", true);
  const ctx = await meetingContext(supabase, r.meeting_id);
  const brief: RecordingBrief = { company: company.name, title: ctx.title, date: ctx.date, staff: ctx.staff, guests: ctx.guests, agenda: ctx.agenda, transcript: r.transcript, swahili: str(form, "swahili_summary") === "1" };
  const st = await supabase.rpc("meeting_recording_state", { p_recording: id, p_what: "summary", p_state: "writing", p_error: null });
  if (st.error) finish(path, st.error.message, true);

  // Every AI run is counted by the database (5 per meeting, 30 per company a day); the background function reads
  // the brief from there. Before the security SQL is run (PGRST202) only the in-request path runs.
  const run = await supabase.rpc("meeting_ai_run_start", { p_meeting: r.meeting_id, p_brief: brief, p_kind: "summary" });
  if (run.error && run.error.code !== "PGRST202") {
    await supabase.rpc("meeting_recording_state", { p_recording: id, p_what: "summary", p_state: "failed", p_error: run.error.message });
    finish(path, run.error.message, true);
  }
  const runId = (run.data as string | null) ?? null;
  const bg = { action: "summarize", recording_id: id, run_id: runId };
  // Short recordings fit in this request; longer ones go to the background function on Netlify.
  const short = r.transcript.length < 6000;
  if (!short && runId && (await dispatchBackground(supabase, "meeting-recording-background", bg))) {
    finish(path, "The AI is summarising the recording. This page updates when it is ready.");
  }
  const res = short || !backgroundReady() ? await (short ? recordingSummaryInline(brief) : callRecordingSummary(brief, process.env, 9 * 60_000)) : null;
  if (res?.ok) {
    const saved = await supabase.rpc("meeting_recording_save_summary", { p_recording: id, p_summary: res.summary, p_summary_sw: res.summary_sw });
    if (!saved.error) finish(path, "Summary written.");
  }
  // A short one that timed out gets a second chance in the background.
  if (short && runId && (await dispatchBackground(supabase, "meeting-recording-background", bg))) {
    finish(path, "The AI is summarising the recording. This page updates when it is ready.");
  }
  const why = res && !res.ok ? ("error" in res ? res.error : res.reason === "timeout" ? "The AI took too long. Try again." : "The AI could not write the summary. Try again later.") : "The summary could not be written. Try again.";
  await supabase.rpc("meeting_recording_state", { p_recording: id, p_what: "summary", p_state: "failed", p_error: why });
  finish(path, why, true);
}

/** "Delete now": the recording can no longer be played, and its files are removed from storage. */
export async function deleteRecording(form: FormData) {
  const id = str(form, "recording_id");
  const path = back(form);
  if (!isId(id)) finish(path, "Recording not found.", true);
  const { supabase } = await getAppContext();
  const { data: paths, error } = await supabase.rpc("meeting_recording_delete", { p_recording: id });
  if (error) finish(path, error.message, true);
  const list = (paths ?? []) as string[];
  for (let i = 0; i < list.length; i += 100) await supabase.storage.from(RECORDING_BUCKET).remove(list.slice(i, i + 100));
  const { data: cleared } = await supabase.rpc("meeting_recording_purged", { p_recording: id });
  finish(path, cleared ? "Recording deleted." : "Recording deleted. Its files are removed within the hour.");
}

/** "Delete meeting recordings after" (management). */
export async function setRecordingDays(form: FormData) {
  const days = Number(str(form, "days"));
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.rpc("meeting_set_recording_days", { p_company: company.id, p_days: days });
  if (error) finish("/meetings/settings", error.message, true);
  finish("/meetings/settings", days === 0 ? "Saved: recordings are kept until someone deletes them." : `Saved: recordings are deleted ${days === 365 ? "a year" : `${days} days`} after the meeting.`);
}
