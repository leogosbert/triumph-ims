import { timingSafeEqual } from "node:crypto";
import { processOutbox } from "@/lib/outbox";

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const dynamic = "force-dynamic";

/** Called every few minutes by the scheduled job: runs alert checks, then sends push and email. */
async function handle(req: Request) {
  const secret = process.env.OUTBOX_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !same(given, secret)) return Response.json({ error: "Not allowed" }, { status: 401 });
  const result = await processOutbox(true);
  return Response.json(result, { status: result.errors.length && !result.claimed ? 500 : 200 });
}

export const GET = handle;
export const POST = handle;
