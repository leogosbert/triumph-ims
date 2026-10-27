import { waDigits } from "@/lib/inbox/whatsapp";

/**
 * SMS through Beem Africa (https://beem.africa). Server only.
 *
 * Settings (Netlify → Environment variables, secret):
 *   BEEM_API_KEY, BEEM_SECRET   from the Beem dashboard (Profile → Authentication information)
 *   BEEM_SENDER_ID              the approved sender name (e.g. "TRIUMPH"); Beem's default "INFO" works for tests
 *   BEEM_BASE_URL               optional, default https://apisms.beem.africa/v1/send
 *
 * NOT VERIFIED AGAINST BEEM'S LIVE SERVICE (request layout from Beem's API documentation).
 */

type BeemEnv = { key: string; secret: string; sender: string; url: string };

export function beemEnv(e: NodeJS.ProcessEnv = process.env): BeemEnv | null {
  const key = e.BEEM_API_KEY?.trim();
  const secret = e.BEEM_SECRET?.trim();
  const sender = e.BEEM_SENDER_ID?.trim();
  if (!key || !secret || !sender) return null;
  return { key, secret, sender, url: e.BEEM_BASE_URL?.trim() || "https://apisms.beem.africa/v1/send" };
}

export const beemConfigured = (e: NodeJS.ProcessEnv = process.env) => beemEnv(e) !== null;

/** The JSON body Beem expects (pure, for the tests). Null when the phone number is not usable. */
export function beemPayload(sender: string, to: string, text: string, recipientId = 1): Record<string, unknown> | null {
  const digits = waDigits(to);
  if (!digits) return null;
  return {
    source_addr: sender,
    schedule_time: "",
    encoding: 0,
    message: text.slice(0, 918),
    recipients: [{ recipient_id: recipientId, dest_addr: digits }],
  };
}

export function beemAuthHeader(key: string, secret: string): string {
  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

export async function sendBeemSms(to: string, text: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const env = beemEnv();
  if (!env) return { ok: false, error: "SMS is not set up on the server (BEEM_API_KEY, BEEM_SECRET, BEEM_SENDER_ID)." };
  const body = beemPayload(env.sender, to, text);
  if (!body) return { ok: false, error: "The phone number is not valid." };
  try {
    const res = await fetch(env.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: beemAuthHeader(env.key, env.secret) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { successful?: boolean; request_id?: number | string; code?: number; message?: string };
    if (!res.ok || json.successful === false || !json.request_id) return { ok: false, error: (json.message ?? `Beem: HTTP ${res.status}`).slice(0, 300) };
    return { ok: true, id: String(json.request_id) };
  } catch (e) {
    return { ok: false, error: `Beem: ${(e as Error).message}`.slice(0, 300) };
  }
}
