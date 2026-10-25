import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signature checks (pure functions, no network, easy to test).
 *
 * - Resend signs webhooks with Svix: headers svix-id, svix-timestamp, svix-signature.
 *   The signed text is `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 with the base64 key after "whsec_",
 *   sent as one or more space-separated "v1,<base64>" values. (The same scheme is called
 *   "Standard Webhooks" with webhook-id / webhook-timestamp / webhook-signature headers: both accepted.)
 * - Meta (WhatsApp Cloud API) sends X-Hub-Signature-256: "sha256=<hex HMAC-SHA256 of the raw body with the app secret>".
 * - Any other email provider can sign with X-Inbound-Signature: "sha256=<hex HMAC-SHA256 of the raw body>"
 *   using INBOUND_EMAIL_SECRET (see the generic shape in email.ts).
 */

/** Requests older or newer than this are refused (replays). */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

function sameBytes(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export type SvixHeaders = { id: string | null; timestamp: string | null; signature: string | null };

/** Reads svix-* (or webhook-*) headers from a Headers object. */
export function svixHeadersFrom(h: Headers): SvixHeaders {
  return {
    id: h.get("svix-id") ?? h.get("webhook-id"),
    timestamp: h.get("svix-timestamp") ?? h.get("webhook-timestamp"),
    signature: h.get("svix-signature") ?? h.get("webhook-signature"),
  };
}

/** True when the Svix signature matches the raw body and the timestamp is recent. */
export function verifySvix(secret: string, headers: SvixHeaders, rawBody: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  if (!/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .some((part) => {
      try {
        return sameBytes(Buffer.from(part.slice(3), "base64"), expected);
      } catch {
        return false;
      }
    });
}

/** Signs like Svix does (used by the tests and to try the webhook by hand). */
export function signSvix(secret: string, id: string, timestamp: number, rawBody: string): string {
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64")}`;
}

/** "sha256=<hex>" HMAC of the raw body: Meta's X-Hub-Signature-256 and the generic X-Inbound-Signature. */
export function verifySha256Header(secret: string, header: string | null, rawBody: string | Buffer): boolean {
  if (!secret || !header) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return sameBytes(Buffer.from(m[1].toLowerCase(), "hex"), expected);
}

export function signSha256(secret: string, rawBody: string | Buffer): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

/** Constant-time comparison of two texts (the WhatsApp verify token). */
export function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return sameBytes(Buffer.from(a), Buffer.from(b));
}

/** Most webhook bodies are small; anything bigger than this is refused before it is parsed. */
export const MAX_WEBHOOK_BYTES = 1024 * 1024;

/**
 * Reads the raw body with a size cap (Content-Length is checked first, then the bytes read).
 * Returns null when it is too big.
 */
export async function readCappedBody(req: Request, maxBytes = MAX_WEBHOOK_BYTES): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}
