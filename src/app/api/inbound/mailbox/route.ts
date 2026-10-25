import { timingSafeEqual } from "node:crypto";
import { pollMailbox } from "@/lib/inbox/server";

export const dynamic = "force-dynamic";

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Company-mailbox mode: reads new mail in the company mailbox (IMAP) into the Inbox.
 * Called every 5 minutes by netlify/functions/inbox-mailbox-cron.mts with OUTBOX_SECRET.
 */
async function handle(req: Request) {
  const secret = process.env.OUTBOX_SECRET ?? "";
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !same(given, secret)) return Response.json({ error: "Not allowed" }, { status: 401 });
  const result = await pollMailbox();
  if (result.error) console.warn(`inbox mailbox: ${result.error}`);
  return Response.json(result, { status: result.status === "error" ? 502 : 200 });
}

export const GET = handle;
export const POST = handle;
