// Netlify background function (the "-background" name lets it run up to 15 minutes): writes a meeting's minutes
// with the AI for long meetings, which do not fit in one 10-second screen request.
//
// Called by the app's server action (src/app/(app)/meetings/actions.ts) with the signed-in person's own access
// token, so every read and write goes through the database rules as that person: only someone who manages the
// meeting can save its minutes, and only while it waits for them ("writing"). The AI's answer is checked by
// src/lib/meetings/minutes-core.ts and again by public.meeting_save_minutes. When the AI does not answer, the app's
// plain minutes (from the typed notes) are saved instead and the reason is shown.
//
// Needs ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL) in Netlify's environment variables; the key never
// reaches the phone. Bundled on its own by Netlify: relative imports only.

import { callClaudeLong, failReason, MINUTES_SCHEMA, MINUTES_SYSTEM, minutesUserText, parseJsonReply, plainMinutes, validateMinutes, type MinutesBrief } from "../../src/lib/meetings/minutes-core";

const ID = /^[0-9a-f-]{36}$/;

export default async (req: Request) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const auth = req.headers.get("authorization") ?? "";
  if (req.method !== "POST" || !url || !anon || !/^Bearer [A-Za-z0-9._-]{20,}$/.test(auth)) return;
  let body: { meeting_id?: string; brief?: MinutesBrief };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return;
  }
  const id = String(body.meeting_id ?? "");
  const brief = body.brief;
  if (!ID.test(id) || !brief || brief.meeting?.id !== id) return;

  const h = { apikey: anon, authorization: auth, "content-type": "application/json" };
  const rpc = (fn: string, args: Record<string, unknown>) => fetch(`${url}/rest/v1/rpc/${fn}`, { method: "POST", headers: h, body: JSON.stringify(args) });

  // Only while this meeting waits for its minutes (and as someone who may write them).
  const check = await fetch(`${url}/rest/v1/meetings?id=eq.${id}&select=minutes_status,minutes_requested_at`, { headers: h });
  const rows = check.ok ? ((await check.json()) as { minutes_status: string; minutes_requested_at: string | null }[]) : [];
  const row = rows[0];
  if (!row || row.minutes_status !== "writing" || !row.minutes_requested_at || Date.now() - Date.parse(row.minutes_requested_at) > 20 * 60_000) return;

  const key = process.env.ANTHROPIC_API_KEY;
  let reason = "AI is not switched on. The app wrote plain minutes from the notes.";
  if (key) {
    const res = await callClaudeLong({
      apiKey: key,
      model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
      system: MINUTES_SYSTEM,
      user: minutesUserText(brief),
      schema: MINUTES_SCHEMA,
      maxTokens: 16000,
      timeoutMs: 12 * 60_000,
    });
    if (res.ok) {
      const minutes = validateMinutes(parseJsonReply(res.text), brief);
      if (minutes) {
        const saved = await rpc("meeting_save_minutes", { p_meeting: id, p: minutes });
        if (saved.ok) return;
        reason = "The AI's minutes could not be saved. The app wrote plain minutes from the notes instead.";
      } else {
        reason = "The AI's answer did not check out. The app wrote plain minutes from the notes instead.";
      }
    } else {
      reason = failReason(res);
    }
  }
  // Plain minutes, with the reason kept for the organiser. After saving, state 'failed' keeps the minutes ready and
  // only records why the AI was not used; if even the plain minutes could not be saved, the meeting shows "failed".
  await rpc("meeting_save_minutes", { p_meeting: id, p: plainMinutes(brief) });
  await rpc("meeting_minutes_state", { p_meeting: id, p_state: "failed", p_error: reason });
};
