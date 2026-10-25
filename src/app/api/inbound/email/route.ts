import { after } from "next/server";
import { fromGeneric, fromResend, isGenericEmail, isResendEvent, resendPendingFiles, type InboundRecord, type PendingFile } from "@/lib/inbox/email";
import { fetchResendEmail, inboxAdmin, recordInbound, saveEmailFiles } from "@/lib/inbox/server";
import { readCappedBody, svixHeadersFrom, verifySha256Header, verifySvix } from "@/lib/inbox/signatures";

export const dynamic = "force-dynamic";

/** Resend's webhook is metadata only; the generic shape may carry files inline (Netlify allows ~6 MB). */
const MAX_BODY = 6 * 1024 * 1024;

const json = (body: unknown, status = 200) => Response.json(body, { status });

/**
 * Inbound email webhook: https://<site>/api/inbound/email
 * - Resend inbound ("email.received"), signed with Svix (RESEND_WEBHOOK_SECRET).
 * - Any other provider: generic JSON signed with X-Inbound-Signature (INBOUND_EMAIL_SECRET); see src/lib/inbox/email.ts.
 * Unsigned or wrongly signed requests get 401. Message bodies are never logged.
 */
export async function POST(req: Request) {
  const raw = await readCappedBody(req, MAX_BODY);
  if (raw === null) return json({ error: "Too large" }, 413);

  const svix = svixHeadersFrom(req.headers);
  const generic = req.headers.get("x-inbound-signature");
  let source: "resend" | "generic";
  if (svix.signature) {
    if (!verifySvix(process.env.RESEND_WEBHOOK_SECRET ?? "", svix, raw)) return json({ error: "Bad signature" }, 401);
    source = "resend";
  } else if (generic) {
    if (!verifySha256Header(process.env.INBOUND_EMAIL_SECRET ?? "", generic, raw)) return json({ error: "Bad signature" }, 401);
    source = "generic";
  } else {
    return json({ error: "Not signed" }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return json({ error: "Not JSON" }, 400);
  }

  const db = inboxAdmin();
  if (!db) return json({ error: "Inbox is not set up on the server (SUPABASE_SERVICE_ROLE_KEY)." }, 503);

  let record: InboundRecord;
  let files: PendingFile[];
  let providerEmailId = "";
  if (source === "resend") {
    if (!isResendEvent(payload)) return json({ error: "Unknown payload" }, 400);
    if (payload.type !== "email.received") return json({ status: "ignored", reason: payload.type });
    if (!payload.data.email_id) return json({ error: "No email id" }, 400);
    providerEmailId = payload.data.email_id;
    // The webhook has no body or headers: fetch them (skipped when the event already carries them).
    const full = payload.data.text || payload.data.html ? null : await fetchResendEmail(providerEmailId);
    record = fromResend(payload, full);
    files = resendPendingFiles(record);
  } else {
    if (!isGenericEmail(payload)) return json({ error: "Unknown payload" }, 400);
    ({ record, files } = fromGeneric(payload));
    providerEmailId = record.provider_message_id;
  }
  if (!record.from) return json({ status: "ignored", reason: "no sender" });

  try {
    const result = await recordInbound(db, record);
    if (result.status === "recorded" && files.length) {
      after(async () => {
        const errors = await saveEmailFiles(db, result, providerEmailId, files);
        if (errors.length) console.warn(`inbox email ${result.message_id}: ${errors.length} file(s) not saved: ${errors.join("; ")}`);
      });
    }
    return json({ status: result.status, conversation_id: result.conversation_id ?? null });
  } catch (e) {
    console.error(`inbox email ${record.provider}:${record.provider_message_id}: ${(e as Error).message}`);
    return json({ error: "Could not record the message" }, 500); // the provider retries
  }
}

export function GET() {
  return json({ ok: true, endpoint: "inbound email", method: "POST" });
}
