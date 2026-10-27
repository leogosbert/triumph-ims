// Netlify background function (runs up to 15 minutes) for meeting recordings:
//   transcribe  writes down one or more recordings with OpenAI's speech to text (language hint Kiswahili, or English),
//               saves each transcript, and then, when the app sent a minutes brief, writes the minutes with them.
//   summarize   "Summarize this recording": English paragraphs (and a Kiswahili paragraph when asked) from the
//               recording's transcript.
//
// Called by the app's server actions (src/app/(app)/meetings/recording-actions.ts) with the signed-in person's own
// access token: every read (the recording, its pieces in the private bucket) and every write goes through the
// database and storage rules as that person. Work starts only for recordings waiting for it ("writing").
//
// Needs OPENAI_API_KEY for transcription (optional OPENAI_TRANSCRIBE_MODEL) and ANTHROPIC_API_KEY for summaries and
// minutes. Keys never reach the phone. Bundled on its own by Netlify: relative imports only.

import { minutesJob, type MinutesBrief } from "../../src/lib/meetings/minutes-core";
import {
  callRecordingSummary,
  fileNameFor,
  RECORDING_BUCKET,
  transcribeAudio,
  transcribeFailReason,
  transcribeLanguage,
  transcribeModel,
  transcribePrompt,
  type RecordingBrief,
} from "../../src/lib/meetings/recording-core";

const ID = /^[0-9a-f-]{36}$/;

type Body = {
  action?: string;
  recording_ids?: string[];
  recording_id?: string;
  prompt?: { company: string; title: string; names: string[]; words?: string[] };
  brief?: MinutesBrief;
  summary?: RecordingBrief;
};

export default async (req: Request) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get("authorization") ?? "";
  if (req.method !== "POST" || !url || !anon || !/^Bearer [A-Za-z0-9._-]{20,}$/.test(auth)) return;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return;
  }
  const h = { apikey: anon, authorization: auth, "content-type": "application/json" };
  const rpc = (fn: string, args: Record<string, unknown>) => fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: h, body: JSON.stringify(args) });
  const get = async <T,>(path: string): Promise<T[]> => {
    const r = await fetch(`${url}/rest/v1/${path}`, { headers: h });
    return r.ok ? ((await r.json()) as T[]) : [];
  };
  const recent = (at: string | null) => !!at && Date.now() - Date.parse(at) < 30 * 60_000;

  if (body.action === "summarize") {
    const id = String(body.recording_id ?? "");
    if (!ID.test(id) || !body.summary) return;
    const [r] = await get<{ summary_status: string }>(`meeting_recordings?id=eq.${id}&select=summary_status`);
    if (!r || r.summary_status !== "writing") return;
    const res = await callRecordingSummary(body.summary, process.env, 10 * 60_000);
    if (res.ok) await rpc("meeting_recording_save_summary", { p_recording: id, p_summary: res.summary, p_summary_sw: res.summary_sw });
    else await rpc("meeting_recording_state", { p_recording: id, p_what: "summary", p_state: "failed", p_error: res.error });
    return;
  }

  if (body.action !== "transcribe") return;
  const ids = (body.recording_ids ?? []).filter((x) => ID.test(x)).slice(0, 10);
  const key = process.env.OPENAI_API_KEY ?? "";
  const texts: string[] = [];
  for (const [i, id] of ids.entries()) {
    const [r] = await get<{ id: string; mime: string; language: string; started_at: string; transcript_status: string; transcript_requested_at: string | null; transcript: string }>(
      `meeting_recordings?id=eq.${id}&deleted_at=is.null&select=id,mime,language,started_at,transcript_status,transcript_requested_at,transcript`,
    );
    if (!r) continue;
    if (r.transcript_status === "ready" && r.transcript) {
      texts.push(label(i, r.started_at, r.transcript));
      continue;
    }
    if (r.transcript_status !== "writing" || !recent(r.transcript_requested_at)) continue;
    const parts = await get<{ storage_path: string }>(`meeting_recording_parts?recording_id=eq.${id}&select=storage_path&order=seq`);
    const chunks: ArrayBuffer[] = [];
    let broken = false;
    for (const p of parts) {
      const f = await fetch(`${url}/storage/v1/object/authenticated/${RECORDING_BUCKET}/${p.storage_path.split("/").map(encodeURIComponent).join("/")}`, {
        headers: { apikey: anon, authorization: auth },
      }).catch(() => null);
      if (!f || !f.ok) {
        broken = true;
        break;
      }
      chunks.push(await f.arrayBuffer());
    }
    if (broken || !chunks.length) {
      await rpc("meeting_recording_state", { p_recording: id, p_what: "transcript", p_state: "failed", p_error: chunks.length ? "A piece of the recording could not be read." : "The recording is empty." });
      continue;
    }
    const type = r.mime.split(";")[0];
    const res = await transcribeAudio({
      apiKey: key,
      model: transcribeModel(process.env),
      file: new Blob(chunks, { type }),
      filename: fileNameFor(r.mime),
      language: transcribeLanguage(r.language),
      prompt: transcribePrompt({ ...(body.prompt ?? { company: "", title: "", names: [] }), lang: r.language }),
      timeoutMs: 8 * 60_000,
    });
    if (res.ok && res.text) {
      await rpc("meeting_recording_save_transcript", { p_recording: id, p_text: res.text });
      texts.push(label(i, r.started_at, res.text));
    } else {
      await rpc("meeting_recording_state", { p_recording: id, p_what: "transcript", p_state: "failed", p_error: res.ok ? "Nothing could be heard in the recording." : transcribeFailReason(res) });
    }
  }

  // Then the minutes, with what the recordings said (only while the meeting waits for them).
  const brief = body.brief;
  if (brief && ID.test(brief.meeting?.id ?? "")) {
    const [m] = await get<{ minutes_status: string; minutes_requested_at: string | null }>(`meetings?id=eq.${brief.meeting.id}&select=minutes_status,minutes_requested_at`);
    if (!m || m.minutes_status !== "writing" || !recent(m.minutes_requested_at)) return;
    // (texts holds every recording of the meeting that has a transcript, the ones written earlier too)
    await minutesJob({ ...brief, recording_transcript: texts.join("\n\n") || brief.recording_transcript || "" }, rpc, process.env);
  }
};

function label(i: number, startedAt: string, text: string): string {
  const at = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(startedAt));
  return `--- Recording ${i + 1} (started ${at}) ---\n${text}`;
}
