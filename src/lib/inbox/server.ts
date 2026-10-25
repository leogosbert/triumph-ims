import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/supabase/env";
import type { InboundRecord, PendingFile, ResendAttachmentList, ResendReceivedEmail } from "./email";
import { imapFetchNew, mailboxAddress, mailboxConfig, smtpSend } from "./mailbox";
import { addressHeader, buildMail, parseMail } from "./mime";
import { addressList, htmlToText, messageIds, parseAddress, safeFileName, sanitizeEmailHtml } from "./sanitize";
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
 * Or, instead of Resend, the company's own mailbox (no own domain needed; see mailbox.ts):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, IMAP_HOST, IMAP_PORT
 *   (read every 5 minutes by netlify/functions/inbox-mailbox-cron.mts, which uses OUTBOX_SECRET)
 */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type InboxChannels = {
  database: boolean;
  emailReceive: boolean;
  emailSend: boolean;
  whatsappReceive: boolean;
  whatsappSend: boolean;
  inboundDomain: string | null;
  /** The company mailbox (IMAP + SMTP) is set; it belongs to the company whose inbox address is this address. */
  mailbox: string | null;
};

/** What is switched on in the server settings (never the values). */
export function inboxChannels(): InboxChannels {
  const e = process.env;
  const mbox = mailboxConfig(e);
  const mailbox = mbox && mbox.smtpHost ? mailboxAddress(mbox) : null;
  return {
    database: Boolean(e.SUPABASE_SERVICE_ROLE_KEY),
    emailReceive: Boolean(e.SUPABASE_SERVICE_ROLE_KEY && (e.RESEND_WEBHOOK_SECRET || e.INBOUND_EMAIL_SECRET || mailbox)),
    emailSend: Boolean((e.RESEND_API_KEY && e.EMAIL_FROM) || mailbox),
    whatsappReceive: Boolean(e.SUPABASE_SERVICE_ROLE_KEY && e.WHATSAPP_APP_SECRET && e.WHATSAPP_VERIFY_TOKEN),
    whatsappSend: Boolean(e.WHATSAPP_TOKEN),
    inboundDomain: e.INBOUND_EMAIL_DOMAIN?.trim().toLowerCase() || null,
    mailbox,
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

export async function store(db: SupabaseClient, r: RecordResult, attachmentId: string, fileName: string, bytes: Buffer, contentType: string | null) {
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
export async function sendEmailReply(
  m: EmailReply,
  companyInbox: string | null,
): Promise<{ ok: true; id: string; from: string; messageId: string | null; via: "mailbox" | "resend" } | { ok: false; error: string }> {
  // The company's own mailbox (SMTP), when it is this company's inbox address.
  const mbox = mailboxConfig();
  const mbAddress = mailboxAddress(mbox);
  if (mbox && mbox.smtpHost && mbAddress && companyInbox && mbAddress === companyInbox.toLowerCase()) {
    const fromName = parseAddress(mbox.from)?.name ?? m.fromName;
    const from = addressHeader(fromName, mbAddress);
    const messageId = `<${crypto.randomUUID()}@${mbAddress.split("@")[1]}>`;
    try {
      const data = buildMail({
        from,
        to: m.to,
        cc: m.cc,
        replyTo: m.replyTo,
        subject: m.subject,
        text: m.text,
        html: m.html,
        messageId,
        inReplyTo: m.inReplyTo,
        references: m.references,
      });
      await smtpSend(mbox, { from: mbAddress, to: [...m.to, ...m.cc] }, data);
      return { ok: true, id: messageId, from, messageId, via: "mailbox" };
    } catch (e) {
      return { ok: false, error: (e as Error).message.slice(0, 300) };
    }
  }
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
    return { ok: true, id: json.id, from, messageId: null, via: "resend" };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 300) };
  }
}

/**
 * Company-mailbox mode: reads new mail over IMAP and records it. Safe to call often (the cursor and
 * the Message-ID make repeats harmless). Stops before `budgetMs` so the server call is not cut off.
 */
export async function pollMailbox(budgetMs = 7_000): Promise<{ status: string; recorded: number; more?: boolean; error?: string }> {
  const started = Date.now();
  const db = inboxAdmin();
  const cfg = mailboxConfig();
  const address = mailboxAddress(cfg);
  if (!db || !cfg || !address || !cfg.imapHost) return { status: "not set up", recorded: 0 };
  const { data: co, error } = await db
    .from("inbox_settings")
    .select("company_id, mailbox_uidvalidity, mailbox_last_uid")
    .eq("inbound_address", address)
    .maybeSingle();
  if (error) return { status: "error", recorded: 0, error: error.message };
  if (!co) return { status: `no company has ${address} as its inbox address`, recorded: 0 };
  let recorded = 0;
  try {
    const got = await imapFetchNew(
      cfg,
      { uidValidity: co.mailbox_uidvalidity == null ? null : Number(co.mailbox_uidvalidity), lastUid: co.mailbox_last_uid == null ? null : Number(co.mailbox_last_uid) },
      { max: 10, deadline: started + budgetMs - 2_500 },
    );
    let last = Number(co.mailbox_uidvalidity) === got.uidValidity ? Number(co.mailbox_last_uid ?? 0) : 0;
    for (const f of got.mails) {
      if (Date.now() - started > budgetMs) break;
      const p = parseMail(f.raw);
      const from = parseAddress(p.from);
      if (from) {
        const html = sanitizeEmailHtml(p.html);
        const text = (p.text.trim() || htmlToText(html)).slice(0, 200_000);
        const files = f.tooLarge ? [] : p.attachments.slice(0, 20);
        const rec: InboundRecord = {
          channel: "email",
          provider: "imap",
          provider_message_id: (p.messageId ?? `uid:${got.uidValidity}:${f.uid}`).slice(0, 300),
          from: from.address,
          from_name: from.name,
          to: addressList(p.to),
          cc: addressList(p.cc),
          delivered_to: [address, ...addressList(p.deliveredTo)],
          subject: p.subject.slice(0, 300) || null,
          text: f.tooLarge ? `${text}\n\n[This email is too large for the app. Open it in the company mailbox.]`.trim() : text,
          html: html || null,
          message_id: p.messageId,
          in_reply_to: p.inReplyTo,
          references: messageIds(p.references),
          attachments: files.map((a, i) => ({
            file_name: a.fileName.slice(0, 200),
            content_type: a.contentType,
            size: a.content.length,
            provider_attachment_id: `${f.uid}#${i}`,
          })),
        };
        const r = await recordInbound(db, rec);
        if (r.status === "recorded") {
          recorded++;
          for (const [i, a] of files.entries()) {
            const attId = r.attachments?.find((x) => x.provider_attachment_id === `${f.uid}#${i}`)?.id;
            if (!attId || a.content.length > MAX_ATTACHMENT_BYTES) continue;
            await store(db, r, attId, a.fileName, a.content, a.contentType).catch((e) =>
              console.warn(`inbox mailbox ${r.message_id}: file not saved: ${(e as Error).message.slice(0, 120)}`),
            );
          }
        }
      }
      last = f.uid;
      await db.rpc("inbox_mailbox_state", { p_company: co.company_id, p_uidvalidity: got.uidValidity, p_last_uid: last, p_error: null });
    }
    if (!got.mails.length) {
      // Nothing new: remember where the mailbox ends, so the next check only asks for newer mail.
      const end = last || (got.uidNext ? got.uidNext - 1 : null);
      await db.rpc("inbox_mailbox_state", { p_company: co.company_id, p_uidvalidity: got.uidValidity, p_last_uid: end, p_error: null });
    }
    return { status: "ok", recorded, more: got.more };
  } catch (e) {
    const msg = (e as Error).message.slice(0, 300);
    await db.rpc("inbox_mailbox_state", { p_company: co.company_id, p_uidvalidity: null, p_last_uid: null, p_error: msg });
    return { status: "error", recorded, error: msg };
  }
}
