import { addressList, htmlToText, messageIds, parseAddress, sanitizeEmailHtml } from "./sanitize";

/**
 * Inbound email adapters (pure: no network here; the route fetches what is missing).
 *
 * 1. Resend inbound ("email.received" webhook, signed with Svix). Per Resend's docs the webhook
 *    carries only metadata (email_id, from, to, cc, bcc, subject, message_id, attachments
 *    [{id, filename, content_type, content_disposition, content_id}]); the body and headers come
 *    from GET https://api.resend.com/emails/receiving/{email_id} (html, text, headers, ...), and the
 *    files from GET /emails/receiving/{email_id}/attachments ({data: [{id, filename, size,
 *    content_type, download_url, expires_at}]}). If a field is renamed by Resend, only this file
 *    needs to change.
 *
 * 2. Generic JSON (any other provider, or a small forwarding script), signed with
 *    X-Inbound-Signature: sha256=<hex HMAC of the raw body with INBOUND_EMAIL_SECRET>:
 *    {
 *      "id": "provider-unique-id",            // required: used to ignore repeats
 *      "from": "Asha <asha@client.co.tz>",
 *      "to": ["triumph@in.example.co.tz"], "cc": [],
 *      "subject": "RFQ", "text": "…", "html": "<p>…</p>",
 *      "message_id": "<…>", "in_reply_to": "<…>", "references": "<…> <…>",
 *      "attachments": [{ "filename": "spec.pdf", "content_type": "application/pdf", "content_base64": "…" }]
 *    }
 */

export type ResendEmailReceivedEvent = {
  type: "email.received" | string;
  created_at?: string;
  data: {
    email_id: string;
    created_at?: string;
    from: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    received_for?: string[];
    subject?: string | null;
    message_id?: string | null;
    // Not in the webhook today, but used when present (saves a round trip).
    text?: string | null;
    html?: string | null;
    headers?: Record<string, string | string[]> | null;
    attachments?: { id: string; filename?: string; content_type?: string; content_disposition?: string; content_id?: string; size?: number }[];
  };
};

/** GET /emails/receiving/{id} (only the fields used). */
export type ResendReceivedEmail = {
  id: string;
  from?: string;
  to?: string[];
  cc?: string[];
  subject?: string | null;
  html?: string | null;
  text?: string | null;
  message_id?: string | null;
  headers?: Record<string, string | string[]> | null;
  attachments?: { id: string; filename?: string; content_type?: string; size?: number }[];
};

export type ResendAttachmentList = {
  data?: { id: string; filename?: string; size?: number; content_type?: string; download_url?: string; expires_at?: string }[];
};

export type GenericInboundEmail = {
  id: string;
  from: string;
  to?: string[] | string;
  cc?: string[] | string;
  delivered_to?: string[] | string;
  subject?: string | null;
  text?: string | null;
  html?: string | null;
  message_id?: string | null;
  in_reply_to?: string | null;
  references?: string[] | string | null;
  attachments?: { filename?: string; content_type?: string; content_base64?: string; size?: number }[];
};

/** What the database function inbox_record_inbound() takes (see the migration). */
export type InboundRecord = {
  channel: "email" | "whatsapp";
  provider: string;
  provider_message_id: string;
  from: string;
  from_name: string | null;
  to: string[];
  cc: string[];
  delivered_to?: string[];
  phone_number_id?: string;
  subject: string | null;
  text: string;
  html: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  references: string[];
  attachments: { file_name: string; content_type: string | null; size: number | null; provider_attachment_id: string | null }[];
};

/** Files waiting to be fetched (Resend: by id; generic: inline base64). */
export type PendingFile =
  | { kind: "resend"; providerId: string; fileName: string }
  | { kind: "inline"; providerId: string; fileName: string; contentType: string | null; base64: string };

export function isResendEvent(p: unknown): p is ResendEmailReceivedEvent {
  const x = p as ResendEmailReceivedEvent;
  return !!x && typeof x === "object" && typeof x.type === "string" && !!x.data && typeof x.data === "object";
}

export function isGenericEmail(p: unknown): p is GenericInboundEmail {
  const x = p as GenericInboundEmail;
  return !!x && typeof x === "object" && typeof x.id === "string" && x.id.length > 0 && typeof x.from === "string";
}

function header(h: Record<string, string | string[]> | null | undefined, name: string): string | null {
  if (!h) return null;
  const key = Object.keys(h).find((k) => k.toLowerCase() === name);
  if (!key) return null;
  const v = h[key];
  return Array.isArray(v) ? v.join(" ") : typeof v === "string" ? v : null;
}

function cap(s: string | null | undefined, n: number): string {
  return (s ?? "").slice(0, n);
}

function bodies(text: string | null | undefined, html: string | null | undefined) {
  const clean = sanitizeEmailHtml(html);
  const plain = (text ?? "").trim() || htmlToText(clean);
  return { text: cap(plain, 200_000), html: clean || null };
}

/** Resend webhook (+ the full email from the API, when fetched). */
export function fromResend(ev: ResendEmailReceivedEvent, full: ResendReceivedEmail | null): InboundRecord {
  const d = ev.data;
  const from = parseAddress(full?.from ?? d.from);
  const { text, html } = bodies(full?.text ?? d.text, full?.html ?? d.html);
  const headers = full?.headers ?? d.headers ?? null;
  const files = full?.attachments ?? d.attachments ?? [];
  return {
    channel: "email",
    provider: "resend",
    provider_message_id: d.email_id,
    from: from?.address ?? "",
    from_name: from?.name ?? null,
    to: addressList(full?.to ?? d.to),
    cc: addressList(full?.cc ?? d.cc),
    delivered_to: addressList(d.received_for ?? []),
    subject: cap(full?.subject ?? d.subject, 300) || null,
    text,
    html,
    message_id: messageIds(full?.message_id ?? d.message_id ?? header(headers, "message-id"))[0] ?? null,
    in_reply_to: messageIds(header(headers, "in-reply-to"))[0] ?? null,
    references: messageIds(header(headers, "references")),
    attachments: files.slice(0, 20).map((a) => ({
      file_name: cap(a.filename, 200) || "attachment",
      content_type: a.content_type ?? null,
      size: typeof a.size === "number" ? a.size : null,
      provider_attachment_id: a.id ?? null,
    })),
  };
}

export function resendPendingFiles(rec: InboundRecord): PendingFile[] {
  return rec.attachments
    .filter((a) => a.provider_attachment_id)
    .map((a) => ({ kind: "resend" as const, providerId: a.provider_attachment_id!, fileName: a.file_name }));
}

export function fromGeneric(p: GenericInboundEmail): { record: InboundRecord; files: PendingFile[] } {
  const from = parseAddress(p.from);
  const { text, html } = bodies(p.text, p.html);
  const atts = (p.attachments ?? []).slice(0, 20).map((a, i) => ({
    file_name: cap(a.filename, 200) || "attachment",
    content_type: a.content_type ?? null,
    size: typeof a.size === "number" ? a.size : a.content_base64 ? Math.floor((a.content_base64.length * 3) / 4) : null,
    provider_attachment_id: `${p.id}#${i}`,
    base64: a.content_base64 ?? "",
  }));
  return {
    record: {
      channel: "email",
      provider: "generic",
      provider_message_id: cap(p.id, 300),
      from: from?.address ?? "",
      from_name: from?.name ?? null,
      to: addressList(p.to),
      cc: addressList(p.cc),
      delivered_to: addressList(p.delivered_to),
      subject: cap(p.subject, 300) || null,
      text,
      html,
      message_id: messageIds(p.message_id)[0] ?? null,
      in_reply_to: messageIds(p.in_reply_to)[0] ?? null,
      references: messageIds(p.references),
      attachments: atts.map(({ base64: _b, ...rest }) => rest),
    },
    files: atts
      .filter((a) => a.base64)
      .map((a) => ({ kind: "inline" as const, providerId: a.provider_attachment_id, fileName: a.file_name, contentType: a.content_type, base64: a.base64 })),
  };
}
