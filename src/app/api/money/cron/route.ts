import { timingSafeEqual } from "node:crypto";
import { runFiscalQueue, runReminders } from "@/lib/getpaid/jobs";

export const dynamic = "force-dynamic";

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Getting paid: sends queued TRA receipts (VFD) and the payment reminders that are due.
 * Called every 15 minutes by netlify/functions/money-cron.mts with OUTBOX_SECRET.
 */
async function handle(req: Request) {
  const secret = process.env.OUTBOX_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !same(given, secret)) return Response.json({ error: "Not allowed" }, { status: 401 });
  const fiscal = await runFiscalQueue().catch((e: Error) => ({ status: `error: ${e.message}`, posted: 0, failed: 0 }));
  const reminders = await runReminders().catch((e: Error) => ({ status: `error: ${e.message}`, sent: 0, failed: 0, skipped: 0 }));
  if (fiscal.status.startsWith("error")) console.warn(`money cron fiscal: ${fiscal.status}`);
  if (reminders.status.startsWith("error")) console.warn(`money cron reminders: ${reminders.status}`);
  return Response.json({ fiscal, reminders });
}

export const GET = handle;
export const POST = handle;
