import type { getAppContext } from "@/lib/context";
import type { MinutesBrief } from "@/lib/meetings/minutes-core";

type Supabase = Awaited<ReturnType<typeof getAppContext>>["supabase"];

/** True on Netlify, where the background functions run (up to 15 minutes each). */
export function backgroundReady(): boolean {
  return !!process.env.NETLIFY && !!(process.env.URL || process.env.DEPLOY_PRIME_URL);
}

/**
 * Starts a Netlify background function with the signed-in person's own access token (so it reads and writes as
 * them, through the database rules). Returns false when it could not be started; the caller then works within the
 * request instead.
 */
export async function dispatchBackground(supabase: Supabase, name: "meeting-minutes-background" | "meeting-recording-background", body: unknown): Promise<boolean> {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!backgroundReady() || !base) return false;
  const { data: s } = await supabase.auth.getSession();
  const token = s.session?.access_token;
  if (!token) return false;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/.netlify/functions/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return res.status === 202 || res.ok;
  } catch {
    return false;
  }
}

/** The names and words speech to text should spell right: the staff, the guests, the clients and products named. */
export function transcribePromptFor(b: MinutesBrief): { company: string; title: string; names: string[]; words: string[] } {
  const first = (s: string) => s.split(/[\s·,]+/)[0] ?? "";
  return {
    company: b.company,
    title: b.meeting.title,
    names: [...b.staff.map((p) => p.name), ...b.guests.map(first)],
    words: [...b.records.clients.map((c) => c.label), ...b.records.suppliers.map((c) => c.label), ...b.records.products.map((p) => first(p.label))].slice(0, 30),
  };
}
