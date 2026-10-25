import { createHmac } from "node:crypto";
import { mainUrl } from "@/lib/hosts";

/**
 * The online catalogue (server side): its public address, the visitor hash for the rate limit and the
 * checks on the enquiry form before the database checks it again (catalogue_enquiry).
 */

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** https://app.example.co.tz/c/<slug>, or a path when the app address is not set. */
export function catalogueUrl(slug: string): string {
  const base = mainUrl() ?? "";
  return `${base}/c/${slug}`;
}

/** Public web address of a catalogue photo (public bucket). */
export function cataloguePhotoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return base ? `${base}/storage/v1/object/public/catalogue/${path.split("/").map(encodeURIComponent).join("/")}` : null;
}

export function whatsappShare(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function emailShare(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Who sent it, without keeping the address: an HMAC of the network address and the browser, with a
 * server secret (CATALOGUE_HASH_SECRET, else OUTBOX_SECRET), so the rate limit works and nothing
 * personal is stored.
 */
export function senderHash(ip: string, userAgent: string): string {
  const secret = process.env.CATALOGUE_HASH_SECRET || process.env.OUTBOX_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "lemosp-catalogue";
  return createHmac("sha256", secret).update(`${ip}\n${userAgent.slice(0, 200)}`).digest("hex").slice(0, 48);
}

/** The visitor's address from the proxy headers (Netlify sets x-nf-client-connection-ip). */
export function clientIp(h: { get(name: string): string | null }): string {
  return (h.get("x-nf-client-connection-ip") || h.get("x-real-ip") || (h.get("x-forwarded-for") ?? "").split(",")[0] || "unknown").trim().slice(0, 64);
}

export type EnquiryInput = {
  kind: "enquiry" | "quote";
  name: string;
  company: string;
  email: string;
  phone: string;
  message: string;
  lines: { product_id: string; quantity: string }[];
};

export type EnquiryCheck = { ok: true; value: EnquiryInput } | { ok: false; error: string; spam?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

/**
 * The form, checked. `website` is the honeypot (hidden; people leave it empty); `started` is when the
 * form was shown (ms): sent in under 3 seconds or after a day means a robot or a stale page.
 */
export function checkEnquiryForm(form: FormData, now = Date.now()): EnquiryCheck {
  if (text(form.get("website"), 200)) return { ok: false, error: "Sent.", spam: true };
  const started = Number(form.get("started"));
  if (!Number.isFinite(started) || now - started < 3000) return { ok: false, error: "Please take a moment to check the form, then send it again.", spam: true };
  if (now - started > 24 * 3600 * 1000) return { ok: false, error: "This page is old. Reload it and send again." };
  const kind = form.get("kind") === "quote" ? "quote" : "enquiry";
  const name = text(form.get("name"), 120);
  const company = text(form.get("company"), 160);
  const email = text(form.get("email"), 200).toLowerCase();
  const phone = text(form.get("phone"), 20);
  const message = text(form.get("message"), 2000);
  if (name.length < 2) return { ok: false, error: "Enter your name." };
  if (email && !/^[^\s@<>()"',;]+@[^\s@<>()"',;]+\.[a-z]{2,}$/i.test(email)) return { ok: false, error: "Enter a valid email address." };
  if (phone && !/^\+?[0-9 ()-]{9,20}$/.test(phone)) return { ok: false, error: "Enter a valid phone number." };
  if (!email && !phone) return { ok: false, error: "Enter your email address or phone number so we can answer." };
  if (/(https?:\/\/|www\.)\S+/i.test(message) && (message.match(/https?:\/\//gi) ?? []).length > 2) {
    return { ok: false, error: "Please remove the links from your message.", spam: true };
  }
  const lines: EnquiryInput["lines"] = [];
  // Each chosen product: product_id=<id> and its quantity in qty_<id>.
  const ids = form.getAll("product_id");
  for (let i = 0; i < ids.length && lines.length < 31; i++) {
    const id = typeof ids[i] === "string" ? (ids[i] as string) : "";
    if (!UUID.test(id)) continue;
    const q = text(form.get(`qty_${id}`), 20) || "1";
    if (!/^\d{1,8}([.,]\d{1,3})?$/.test(q) || Number(q.replace(",", ".")) <= 0) return { ok: false, error: "Quantities must be numbers more than zero." };
    if (!lines.some((l) => l.product_id === id)) lines.push({ product_id: id, quantity: q.replace(",", ".") });
  }
  if (lines.length > 30) return { ok: false, error: "Choose at most 30 products." };
  if (kind === "quote" && !lines.length) return { ok: false, error: "Add at least one product to the request for quotation." };
  if (kind === "enquiry" && !message && !lines.length) return { ok: false, error: "Write your question." };
  return { ok: true, value: { kind, name, company, email, phone, message, lines } };
}

export const ENQUIRY_STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: "New", tone: "warn" },
  converted: { label: "RFQ made", tone: "ok" },
  closed: { label: "Closed", tone: "off" },
};

export const DOC_KIND_LABEL: Record<string, string> = {
  datasheet: "Data sheet",
  sds: "Safety data sheet",
  coa: "Certificate of analysis",
  certificate: "Certificate",
};
