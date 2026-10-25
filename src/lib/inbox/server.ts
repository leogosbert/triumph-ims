import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/env";
import type { InboundRecord, PendingFile, ResendAttachmentList, ResendReceivedEmail } from "./email";
import { safeFileName } from "./sanitize";
import { fetchWhatsAppMedia } from "./whatsapp";

/**
 * Server-only inbox code: the webhooks' database client (service role) and the providers' APIs.
 * Never import this from a "use client" file: SUPABASE_SERVICE_ROLE_KEY must stay on the server.
 *
 * Settings (Netlify → Site configuration → Environment variables):
 *   SUPABASE_SERVICE_ROLE_KEY   Supabase → Project settings → API keys → service_role (secret)
 *   RESEND_API_KEY, EMAIL_FROM  already used for alerts; also sends inbox replies
 *   RESEND_WEBHOOK_SECRET       Resend → Webhooks → your endpoint → Signing secret (whsec_…)
 *   INBOUND_EMAIL_DOMAIN        the receiving domain, e.g. abc123.resend.app or in.yourdomain.co.tz
 *   INBOUND_EMAIL_SECRET        optional: another email provider signs with this (X-Inbound-Signature)
 *   WHATSAPP_TOKEN              Meta → WhatsApp → API setup → permanent (system user) access token
 *   WHATSAPP_APP_SECRET         Meta → App settings → Basic → App secret
 *   WHATSAPP_VERIFY_TOKEN       any long random text; the same text goes in Meta's webhook form
 *   WHATSAPP_PHONE_NUMBER_ID    optional: suggested on the setup page for the company's own number
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type InboxChannels = {
  database: boolean;
  emailReceive: boolean;
  emailSend: boolean;
  whatsappReceive: boolean;
  whatsappSend: boolean;
  inboundDomain: string | null;
};

/** What is switched on in the server settings (never the values). */
export function inboxChannels(): InboxChannels {
  const e = process.env;
  return {
    database: Boolean(e.SUPABASE_SERVICE_ROLE_KEY),
    emailReceive: Boolean(e.SUPABASE_SERVICE_ROLE_KEY && (e.RESEND_WEBHOOK_SECRET || e.INBOUND_EMAIL_SECRET)),
    emailSend: Boolean(e.RESEND_API_KEY && e.EMAIL_FROM),
    whatsappReceive: Boolean(e.SUPABASE_SERVICE_ROLE_KEY && e.WHATSAPP_APP_SECRET && e.WHATSAPP_VERIFY_TOKEN),
    whatsappSend: Boolean(e.WHATSAPP_TOKEN),
    inboundDomain: e.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase() || null,
  };
}

let admin: SupabaseClient | null = null;

/** Database client for the webhooks (service role). Null when the key is not set. */
export function inboxAdmin(): SupabaseClient | null {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !SUPABASE_URL) return null;
  admin ??= createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export type RecordResult = {
  status: "recorded" | "duplicate" | "no_company" | "ignored";
  company_id?: string;
  conversation_id?: string;
  message_id?: string;
  attachments?: { id: string; file_name: string; provider_attachment_id: string | null }[];
};

export async function recordInbound(db: SupabaseClient, rec: InboundRecord): Promise<RecordResult> {
  const { data, error } = await db.rpc("inbox_record_inbound", { p_msg: rec });
  if (error) throw new Error(`inbox_record_inbound: ${error.code ?? ""} ${error.message}`);
  return data as RecordResult;
}

async function store(db: SupabaseClient, r: RecordResult, attachmentId: string, fileName: string, bytes: Buffer, contentType: string | null) {
  const path = `${r.company_id}/${r.conversation_id}/${attachmentId.slice(0, 8)}-${safeFileName(fileName)}`;
  const up = await db.storage.from("inbox").upload(path, bytes, { contentType: contentType ?? "application/octet-stream", upsert: true });
  if (up.error) throw new Error(`upload: ${up.error.message}`);
  const { error } = await db.rpc("inbox_attachment_stored", { p_attachment: attachmentId, p_path: path });
  if (error) throw new Error(`inbox_attachment_stored: ${error.message}`);
}

/** Resend: the full email (body and headers). Null when it cannot be fetched. */
export async function fetchResendEmail(emailId: string): Promise<ResendReceivedEmail | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok ? ((await res.json()) as ResendReceivedEmail) : null;
  } catch {
    return null;
  }
}

/** Saves the files of a recorded email into inbox/<company>/<conversation>/. Errors are returned, not thrown. */
export async function saveEmailFiles(db: SupabaseClient, r: RecordResult, emailId: string, files: PendingFile[]): Promise<string[]> {
  const errors: string[] = [];
  if (r.status !== "recorded" || !r.attachments?.length || !files.length) return errors;
  const byProvider = new Map(r.attachments.map((a) => [a.provider_attachment_id, a.id]));
  let resendList: ResendAttachmentList | null = null;
  for (const f of files) {
    const attId = byProvider.get(f.providerId);
    if (!attId) continue;
    try {
      if (f.kind === "inline") {
        const bytes = Buffer.from(f.base64, "base64");
        if (bytes.length > MAX_ATTACHMENT_BYTES) continue;
        await store(db, r, attId, f.fileName, bytes, f.contentType);
        continue;
      }
      if (!resendList) {
        const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments`, {
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY ?? ""}` },
          signal: AbortSignal.timeout(8_000),
        });
        resendList = res.ok ? ((await res.json()) as ResendAttachmentList) : { data: [] };
      }
      const item = resendList.data?.find((a) => a.id === f.providerId);
      if (!item?.download_url || (item.size ?? 0) > MAX_ATTACHMENT_BYTES) continue;
      const file = await fetch(item.download_url, { signal: AbortSignal.timeout(20_000) });
      if (!file.ok) throw new Error(`download HTTP ${file.status}`);
      const bytes = Buffer.from(await file.arrayBuffer());
      if (bytes.length > MAX_ATTACHMENT_BYTES) continue;
      await store(db, r, attId, f.fileName, bytes, item.content_type ?? null);
    } catch (e) {
      errors.push((e as Error).message.slice(0, 200));
    }
  }
  return errors;
}

/** Saves WhatsApp photos and documents. */
export async function saveWhatsAppFiles(db: SupabaseClient, r: RecordResult, media: { mediaId: string; fileName: string; mimeType: string | null }[]) {
  const errors: string[] = [];
  if (r.status !== "recorded" || !r.attachments?.length) return errors;
  for (const m of media) {
    const attId = r.attachments.find((a) => a.provider_attachment_id === m.mediaId)?.id;
    if (!attId) continue;
    try {
      const got = await fetchWhatsAppMedia(m.mediaId, MAX_ATTACHMENT_BYTES);
      if (got) await store(db, r, attId, m.fileName, got.bytes, got.contentType ?? m.mimeType);
    } catch (e) {
      errors.push((e as Error).message.slice(0, 200));
    }
  }
  return errors;
}

/** "Company <x@y>" for From, using the company's name. */
function fromHeader(name: string, address: string) {
  const clean = name.replace(/["<>\r\n]/g, "").trim().slice(0, 80);
  return clean ? `${clean} <${address}>` : address;
}

export type EmailReply = {
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
  replyTo: string | null;
  fromName: string;
  inReplyTo: string | null;
  references: string[];
};

/**
 * Sends an email through Resend. From: EMAIL_FROM's address with the company's name (the sending
 * domain must be verified in Resend). Reply-To: the company's inbox address (alias+<conversation>@domain),
 * so the client's answer comes back into the same conversation.
 */
export async function sendEmailReply(m: EmailReply): Promise<{ ok: true; id: string; from: string } | { ok: false; error: string }> {
  const key = process.env.RESEND_API_KEY;
  const fromEnv = process.env.EMAIL_FROM;
  if (!key || !fromEnv) return { ok: false, error: "Email sending is not set up (RESEND_API_KEY and EMAIL_FROM)." };
  const fromAddress = /<([^>]+)>/.exec(fromEnv)?.[1] ?? fromEnv.trim();
  const from = fromHeader(m.fromName, fromAddress);
  const headers: Record<string, string> = {};
  if (m.inReplyTo) headers["In-Reply-To"] = m.inReplyTo;
  if (m.references.length) headers["References"] = m.references.slice(-20).join(" ");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: m.to,
        ...(m.cc.length ? { cc: m.cc } : {}),
        subject: m.subject,
        text: m.text,
        html: m.html,
        ...(m.replyTo ? { reply_to: m.replyTo } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok || !json.id) return { ok: false, error: (json.message ?? `HTTP ${res.status}`).slice(0, 300) };
    return { ok: true, id: json.id, from };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 300) };
  }
}
