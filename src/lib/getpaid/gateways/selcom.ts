import { createHmac, timingSafeEqual } from "node:crypto";
import { channelToMethod, type CheckoutRequest, type CheckoutResult, type GatewayEvent, type PaymentGateway, type WebhookCheck } from "./types";

/**
 * Selcom checkout (Selcom Paygate / "Checkout API"): one hosted page where the client pays by M-Pesa,
 * Airtel Money, Mixx by Yas (Tigo Pesa), HaloPesa, cards and Selcom Pesa.
 *
 * Every request is signed: headers
 *   Authorization: SELCOM <base64(API key)>   Digest-Method: HS256   Timestamp: 2026-10-25T10:49:31+03:00
 *   Signed-Fields: vendor,order_id,...         Digest: base64(HMAC-SHA256(API secret, "timestamp=<ts>&vendor=<v>&order_id=<o>..."))
 * Selcom signs its webhook the same way. Before a payment is recorded the server also asks Selcom for
 * the order's state (order-status), so a forged webhook can never record money.
 *
 * NOT VERIFIED AGAINST SELCOM'S LIVE SERVICE (field names from Selcom's API documentation; test with the
 * sandbox keys first). If Selcom's webhook signature turns out different in practice, set
 * SELCOM_WEBHOOK_VERIFY=status: the webhook is then only a nudge and the order-status answer decides.
 *
 * Settings (Netlify → Environment variables, secret):
 *   SELCOM_API_KEY, SELCOM_API_SECRET, SELCOM_VENDOR   from the Selcom merchant portal (vendor = till / vendor id)
 *   SELCOM_BASE_URL         optional, default https://apigw.selcommobile.com/v1
 *   SELCOM_WEBHOOK_VERIFY   optional: "digest" (default) or "status"
 *   SELCOM_DEFAULT_EMAIL    optional: buyer email when the client has none (Selcom asks for one)
 */

const TOLERANCE_MS = 15 * 60 * 1000;

type SelcomEnv = { key: string; secret: string; vendor: string; base: string; verify: "digest" | "status"; defaultEmail: string | null };

export function selcomEnv(e: NodeJS.ProcessEnv = process.env): SelcomEnv | null {
  const key = e.SELCOM_API_KEY?.trim();
  const secret = e.SELCOM_API_SECRET?.trim();
  const vendor = e.SELCOM_VENDOR?.trim();
  if (!key || !secret || !vendor) return null;
  return {
    key,
    secret,
    vendor,
    base: (e.SELCOM_BASE_URL?.trim() || "https://apigw.selcommobile.com/v1").replace(/\/$/, ""),
    verify: e.SELCOM_WEBHOOK_VERIFY === "status" ? "status" : "digest",
    defaultEmail: e.SELCOM_DEFAULT_EMAIL?.trim() || null,
  };
}

/** 2026-10-25T10:49:31+03:00 (Tanzania time, as Selcom's examples show it). */
export function selcomTimestamp(now = new Date()): string {
  const d = new Date(now.getTime() + 3 * 3600 * 1000);
  return `${d.toISOString().slice(0, 19)}+03:00`;
}

/** The text Selcom signs: timestamp first, then each signed field in the order listed. */
export function selcomSignedText(timestamp: string, fields: string[], data: Record<string, unknown>): string {
  return [`timestamp=${timestamp}`, ...fields.map((f) => `${f}=${data[f] === undefined || data[f] === null ? "" : String(data[f])}`)].join("&");
}

export function selcomDigest(secret: string, timestamp: string, fields: string[], data: Record<string, unknown>): string {
  return createHmac("sha256", secret).update(selcomSignedText(timestamp, fields, data)).digest("base64");
}

export function selcomHeaders(env: Pick<SelcomEnv, "key" | "secret">, data: Record<string, unknown>, now = new Date()): Record<string, string> {
  const ts = selcomTimestamp(now);
  const fields = Object.keys(data);
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `SELCOM ${Buffer.from(env.key).toString("base64")}`,
    "Digest-Method": "HS256",
    Digest: selcomDigest(env.secret, ts, fields, data),
    Timestamp: ts,
    "Signed-Fields": fields.join(","),
  };
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** The body of create-order-minimal (exported for the tests). */
export function selcomOrderBody(env: Pick<SelcomEnv, "vendor" | "defaultEmail">, req: CheckoutRequest): Record<string, string | number> {
  const phone = (req.buyer.phone ?? "").replace(/\D/g, "");
  return {
    vendor: env.vendor,
    order_id: req.orderId,
    buyer_email: req.buyer.email || env.defaultEmail || "payments@example.com",
    buyer_name: req.buyer.name.slice(0, 100),
    buyer_phone: phone,
    amount: Math.round(req.amount),
    currency: req.currency,
    buyer_remarks: req.description.slice(0, 100),
    merchant_remarks: req.description.slice(0, 100),
    no_of_items: 1,
    redirect_url: b64(req.returnUrl),
    cancel_url: b64(req.cancelUrl),
    webhook: b64(req.webhookUrl),
  };
}

function sameB64(a: string, b: string): boolean {
  try {
    const x = Buffer.from(a, "base64");
    const y = Buffer.from(b, "base64");
    return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
  } catch {
    return false;
  }
}

function statusOf(paymentStatus: unknown, resultcode: unknown): GatewayEvent["status"] {
  const s = String(paymentStatus ?? "").toUpperCase();
  if (s === "COMPLETED" || s === "SUCCESS" || s === "SUCCESSFUL") return "success";
  if (/CANCEL|REJECT|FAIL|EXPIRE/.test(s)) return "failed";
  if (!s && String(resultcode ?? "") !== "000" && resultcode !== undefined) return "failed";
  return "pending";
}

/** Checks a webhook from Selcom (headers and raw JSON body). */
export function verifySelcomWebhook(env: SelcomEnv, headers: Headers, rawBody: string, nowMs = Date.now()): WebhookCheck {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "not_json", orderId: null };
  }
  const orderId = typeof body.order_id === "string" || typeof body.order_id === "number" ? String(body.order_id) : null;
  if (!orderId || !/^[A-Za-z0-9-]{6,60}$/.test(orderId)) return { ok: false, reason: "no_order", orderId: null };

  if (env.verify === "digest") {
    const auth = headers.get("authorization") ?? "";
    const digest = headers.get("digest") ?? "";
    const ts = headers.get("timestamp") ?? "";
    const signed = (headers.get("signed-fields") ?? "").split(",").map((f) => f.trim()).filter(Boolean);
    if (auth !== `SELCOM ${Buffer.from(env.key).toString("base64")}`) return { ok: false, reason: "bad_key", orderId };
    const when = Date.parse(ts);
    if (!Number.isFinite(when) || Math.abs(nowMs - when) > TOLERANCE_MS) return { ok: false, reason: "old_timestamp", orderId };
    // The fields that matter must be signed.
    for (const f of ["order_id", "payment_status"]) if (!signed.includes(f)) return { ok: false, reason: "unsigned_fields", orderId };
    if (!sameB64(digest, selcomDigest(env.secret, ts, signed, body))) return { ok: false, reason: "bad_signature", orderId };
  }

  const amount = Number(body.amount);
  const channel = typeof body.channel === "string" ? body.channel : null;
  const m = channelToMethod(channel);
  return {
    ok: true,
    event: {
      orderId,
      status: statusOf(body.payment_status, body.resultcode),
      amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      transactionId: body.transid ? String(body.transid).slice(0, 120) : null,
      reference: body.reference ? String(body.reference).slice(0, 120) : null,
      channel: channel ? channel.slice(0, 40) : null,
      method: m.method,
      mmProvider: m.mmProvider,
      phone: body.phone ? String(body.phone).replace(/\D/g, "").slice(0, 15) : null,
      message: body.message ? String(body.message).slice(0, 200) : null,
    },
  };
}

export const selcom: PaymentGateway = {
  id: "selcom",
  label: "Selcom",
  methods: ["M-Pesa", "Airtel Money", "Mixx by Yas", "HaloPesa", "Card"],
  configured: () => selcomEnv() !== null,

  async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
    const env = selcomEnv();
    if (!env) return { ok: false, error: "Selcom is not set up on the server." };
    if (!/^255\d{9}$/.test((req.buyer.phone ?? "").replace(/\D/g, ""))) return { ok: false, error: "Enter the phone number that will pay (e.g. 0754 123 456)." };
    const body = selcomOrderBody(env, req);
    try {
      const res = await fetch(`${env.base}/checkout/create-order-minimal`, {
        method: "POST",
        headers: selcomHeaders(env, body),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as {
        resultcode?: string;
        result?: string;
        message?: string;
        reference?: string;
        data?: { payment_gateway_url?: string }[];
      };
      const enc = json.data?.[0]?.payment_gateway_url;
      if (!res.ok || json.resultcode !== "000" || !enc) return { ok: false, error: (json.message ?? `Selcom: HTTP ${res.status}`).slice(0, 300) };
      const url = /^https?:\/\//.test(enc) ? enc : Buffer.from(enc, "base64").toString("utf8");
      if (!/^https:\/\//.test(url)) return { ok: false, error: "Selcom did not return a payment page." };
      return { ok: true, url, reference: json.reference ?? null };
    } catch (e) {
      return { ok: false, error: `Selcom: ${(e as Error).message}`.slice(0, 300) };
    }
  },

  verifyWebhook(headers: Headers, rawBody: string, nowMs?: number): WebhookCheck {
    const env = selcomEnv();
    if (!env) return { ok: false, reason: "not_configured", orderId: null };
    return verifySelcomWebhook(env, headers, rawBody, nowMs);
  },

  async confirm(orderId: string) {
    const env = selcomEnv();
    if (!env) return null;
    const q = { order_id: orderId };
    try {
      const res = await fetch(`${env.base}/checkout/order-status?order_id=${encodeURIComponent(orderId)}`, {
        headers: selcomHeaders(env, q),
        signal: AbortSignal.timeout(15_000),
      });
      const json = (await res.json().catch(() => ({}))) as { resultcode?: string; data?: { payment_status?: string; amount?: string | number }[] };
      if (!res.ok || !json.data?.[0]) return null;
      const amount = Number(json.data[0].amount);
      return { status: statusOf(json.data[0].payment_status, json.resultcode), amount: Number.isFinite(amount) ? amount : null };
    } catch {
      return null;
    }
  },
};
