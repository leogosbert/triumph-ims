import { after } from "next/server";
import { inboxAdmin, recordInbound, saveWhatsAppFiles, type RecordResult } from "@/lib/inbox/server";
import { readCappedBody, sameText, verifySha256Header } from "@/lib/inbox/signatures";
import { parseWhatsAppWebhook } from "@/lib/inbox/whatsapp";

export const dynamic = "force-dynamic";

const MAX_BODY = 512 * 1024;
const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * WhatsApp Business Cloud API webhook: https://<site>/api/inbound/whatsapp
 * GET: Meta checks the address once (hub.mode=subscribe, hub.verify_token = WHATSAPP_VERIFY_TOKEN).
 * POST: messages, signed with X-Hub-Signature-256 (HMAC of the raw body with WHATSAPP_APP_SECRET).
 */
export function GET(req: Request) {
  const u = new URL(req.url);
  const mode = u.searchParams.get("hub.mode");
  const token = u.searchParams.get("hub.verify_token");
  const challenge = u.searchParams.get("hub.challenge") ?? "";
  if (mode === "subscribe" && sameText(token, process.env.WHATSAPP_VERIFY_TOKEN) && /^[\w-]{1,200}$/.test(challenge)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const raw = await readCappedBody(req, MAX_BODY);
  if (raw === null) return json({ error: "Too large" }, 413);
  if (!verifySha256Header(process.env.WHATSAPP_APP_SECRET ?? "", req.headers.get("x-hub-signature-256"), raw)) {
    return json({ error: "Bad signature" }, 401);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Not JSON" }, 400);
  }
  const messages = parseWhatsAppWebhook(payload);
  if (!messages.length) return json({ status: "ignored" }); // delivery receipts and other events
  const db = inboxAdmin();
  if (!db) return json({ error: "Inbox is not set up on the server (SUPABASE_SERVICE_ROLE_KEY)." }, 503);

  const results: { status: string }[] = [];
  const withMedia: { r: RecordResult; media: (typeof messages)[number]["media"] }[] = [];
  try {
    for (const m of messages.slice(0, 50)) {
      const r = await recordInbound(db, m.record);
      results.push({ status: r.status });
      if (r.status === "recorded" && m.media.length) withMedia.push({ r, media: m.media });
    }
  } catch (e) {
    console.error(`inbox whatsapp: ${(e as Error).message}`);
    return json({ error: "Could not record the message" }, 500); // Meta retries; repeats are ignored
  }
  if (withMedia.length) {
    after(async () => {
      for (const x of withMedia) {
        const errors = await saveWhatsAppFiles(db, x.r, x.media);
        if (errors.length) console.warn(`inbox whatsapp ${x.r.message_id}: ${errors.length} file(s) not saved: ${errors.join("; ")}`);
      }
    });
  }
  return json({ results });
}
