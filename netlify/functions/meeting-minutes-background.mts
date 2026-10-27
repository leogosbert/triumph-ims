// Netlify background function (the "-background" name lets it run up to 15 minutes): writes a meeting's minutes
// with the AI, which does not fit in one 10-second screen request.
//
// Called by the app's server action (src/app/(app)/meetings/actions.ts) with the signed-in person's own access
// token, so every read and write goes through the database rules as that person: only someone who manages the
// meeting can save its minutes, and only while it waits for them ("writing"). The request names an AI run that the
// database counted (public.meeting_ai_run_start: 5 per meeting, 30 per company a day); the brief is read from that
// run once (meeting_ai_run_take), never taken from the request. The AI's answer is checked by
// src/lib/meetings/minutes-core.ts and again by public.meeting_save_minutes. When the AI does not answer, the app's
// plain minutes (from the typed notes) are saved instead and the reason is shown.
//
// Needs ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL) in Netlify's environment variables; the key never
// reaches the phone. Bundled on its own by Netlify: relative imports only.

import { minutesJob, type MinutesBrief } from "../../src/lib/meetings/minutes-core";

const ID = /^[0-9a-f-]{36}$/;

export default async (req: Request) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get("authorization") ?? "";
  if (req.method !== "POST" || !url || !anon || !/^Bearer [A-Za-z0-9._-]{20,}$/.test(auth)) return;
  let body: { meeting_id?: string; run_id?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return;
  }
  const id = String(body.meeting_id ?? "");
  const runId = String(body.run_id ?? "");
  if (!ID.test(id) || !ID.test(runId)) return;

  const h = { apikey: anon, authorization: auth, "content-type": "application/json" };
  const rpc = (fn: string, args: Record<string, unknown>) => fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: h, body: JSON.stringify(args) });

  // The run the app counted (public.meeting_ai_run_start): its brief, read once from the database, never from the request.
  const taken = await rpc("meeting_ai_run_take", { p_run: runId });
  const run = taken.ok ? ((await taken.json()) as { meeting_id?: string; brief?: MinutesBrief } | null) : null;
  const brief = run?.brief;
  if (!run || run.meeting_id !== id || !brief || brief.meeting?.id !== id) return;

  // Only while this meeting waits for its minutes (and as someone who may write them).
  const check = await fetch(`${url}/rest/v1/meetings?id=eq.${id}&select=minutes_status,minutes_requested_at`, { headers: h });
  const rows = check.ok ? ((await check.json()) as { minutes_status: string; minutes_requested_at: string | null }[]) : [];
  const row = rows[0];
  if (!row || row.minutes_status !== "writing" || !row.minutes_requested_at || Date.now() - Date.parse(row.minutes_requested_at) > 20 * 60_000) return;

  await minutesJob(brief, rpc, process.env);
};
