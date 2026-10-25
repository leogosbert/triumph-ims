import type { InboundRecord } from "./email";

/**
 * WhatsApp Business Cloud API (Meta) helpers.
 *
 * Webhook body (field "messages"):
 * { "object": "whatsapp_business_account",
 *   "entry": [{ "id": "<WABA id>", "changes": [{ "field": "messages", "value": {
 *       "messaging_product": "whatsapp",
 *       "metadata": { "display_phone_number": "255700000001", "phone_number_id": "1098765432" },
 *       "contacts": [{ "profile": { "name": "Asha" }, "wa_id": "255754111222" }],
 *       "messages": [{ "from": "255754111222", "id": "wamid.X", "timestamp": "1730000000", "type": "text",
 *                      "text": { "body": "Habari" } }],
 *       "statuses": [ ... delivery receipts, ignored ... ] } }] }] }
 * Media messages (image, document, audio, video, sticker) carry { id, mime_type, caption?, filename? }.
 */

export const GRAPH_VERSION = "v21.0";

type WaMedia = { id?: string; mime_type?: string; caption?: string; filename?: string };
type WaMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: WaMedia;
  document?: WaMedia;
  audio?: WaMedia;
  video?: WaMedia;
  sticker?: WaMedia;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  contacts?: unknown[];
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  reaction?: { emoji?: string };
  context?: { id?: string };
};
export type WaWebhook = {
  object?: string;
  entry?: {
    id?: string;
    changes?: {
      field?: string;
      value?: {
        metadata?: { display_phone_number?: string; phone_number_id?: string };
        contacts?: { profile?: { name?: string }; wa_id?: string }[];
        messages?: WaMessage[];
      };
    }[];
  }[];
};

export type WaInbound = { record: InboundRecord; media: { mediaId: string; fileName: string; mimeType: string | null }[] };

const MEDIA_KINDS = ["image", "document", "audio", "video", "sticker"] as const;

/** Every customer message in a webhook body, ready for inbox_record_inbound(). Receipts are skipped. */
export function parseWhatsAppWebhook(body: unknown): WaInbound[] {
  const out: WaInbound[] = [];
  const b = body as WaWebhook;
  if (!b || typeof b !== "object" || !Array.isArray(b.entry)) return out;
  for (const entry of b.entry) {
    for (const ch of entry?.changes ?? []) {
      if (ch?.field !== "messages" || !ch.value) continue;
      const phoneNumberId = ch.value.metadata?.phone_number_id ?? "";
      const names = new Map((ch.value.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name ?? null]));
      for (const m of ch.value.messages ?? []) {
        if (!m?.id || !m.from || !phoneNumberId) continue;
        const media: WaInbound["media"] = [];
        let text = "";
        if (m.type === "text") text = m.text?.body ?? "";
        else if (m.type && (MEDIA_KINDS as readonly string[]).includes(m.type)) {
          const md = m[m.type as (typeof MEDIA_KINDS)[number]];
          text = md?.caption ?? `[${m.type}]`;
          if (md?.id) {
            const ext = (md.mime_type ?? "").split("/")[1]?.split(";")[0] ?? "bin";
            media.push({ mediaId: md.id, fileName: md.filename ?? `${m.type}-${md.id.slice(-6)}.${ext}`, mimeType: md.mime_type ?? null });
          }
        } else if (m.type === "location" && m.location) {
          const l = m.location;
          text = `[location] ${[l.name, l.address].filter(Boolean).join(", ")} https://maps.google.com/?q=${l.latitude},${l.longitude}`;
        } else if (m.type === "button") text = m.button?.text ?? "[button]";
        else if (m.type === "interactive") text = m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "[reply]";
        else if (m.type === "reaction") text = `[reaction] ${m.reaction?.emoji ?? ""}`.trim();
        else text = `[${m.type ?? "message"}]`;
        out.push({
          record: {
            channel: "whatsapp",
            provider: "whatsapp",
            provider_message_id: m.id.slice(0, 300),
            from: m.from,
            from_name: names.get(m.from) ?? null,
            to: [],
            cc: [],
            phone_number_id: phoneNumberId,
            subject: null,
            text: text.slice(0, 20_000),
            html: null,
            message_id: null,
            in_reply_to: null,
            references: [],
            attachments: media.map((x) => ({ file_name: x.fileName, content_type: x.mimeType, size: null, provider_attachment_id: x.mediaId })),
          },
          media,
        });
      }
    }
  }
  return out;
}

/** wa.me number: 0712 345 678 -> 255712345678 (same rule as reminders.ts). */
export function waDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(d)) return null;
  if (d.length === 10 && d.startsWith("0")) return `255${d.slice(1)}`;
  if (d.length === 9 && /^[67]/.test(d)) return `255${d}`;
  if (d.length >= 11 && d.length <= 15) return d;
  return null;
}

/** Click-to-chat link that opens WhatsApp with the text filled in. */
export function waLink(phone: string, text: string): string | null {
  const d = waDigits(phone);
  return d ? `https://wa.me/${d}?text=${encodeURIComponent(text)}` : null;
}

/** Sends a text through the Cloud API. Works inside the 24-hour window after the customer's last message. */
export async function sendWhatsAppText(
  phoneNumberId: string,
  to: string,
  text: string,
  token = process.env.WHATSAPP_TOKEN ?? "",
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const digits = waDigits(to);
  if (!token) return { ok: false, error: "WhatsApp is not connected." };
  if (!digits) return { ok: false, error: "The phone number is not valid." };
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: digits, type: "text", text: { preview_url: true, body: text.slice(0, 4096) } }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok || !json.messages?.[0]?.id) {
      const code = json.error?.code;
      // 131047: more than 24 hours since the customer's last message: only approved templates may be sent.
      const msg = code === 131047 ? "More than 24 hours since their last message: WhatsApp only allows approved templates. Use Open WhatsApp instead." : json.error?.message ?? `HTTP ${res.status}`;
      return { ok: false, error: msg.slice(0, 300) };
    }
    return { ok: true, id: json.messages[0].id! };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 300) };
  }
}

/** Downloads a media file sent to us (two steps: look up the URL, then fetch it with the token). */
export async function fetchWhatsAppMedia(mediaId: string, maxBytes: number, token = process.env.WHATSAPP_TOKEN ?? ""):
  Promise<{ bytes: Buffer; contentType: string | null } | null> {
  if (!token) return null;
  const meta = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!meta.ok) return null;
  const info = (await meta.json()) as { url?: string; mime_type?: string; file_size?: number };
  if (!info.url || (info.file_size ?? 0) > maxBytes) return null;
  const file = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!file.ok) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > maxBytes) return null;
  return { bytes, contentType: info.mime_type ?? file.headers.get("content-type") };
}
