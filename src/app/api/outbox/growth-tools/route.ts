import { timingSafeEqual } from "node:crypto";
import { runGrowthTools } from "@/lib/growth-tools/cron";
import { inboxAdmin } from "@/lib/inbox/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Called every hour by netlify/functions/growth-tools-cron.mts (Bearer OUTBOX_SECRET): the tender
 * digest, LPO financing reminders, public tender pages that are due and notices waiting to be read.
 * Needs SUPABASE_SERVICE_ROLE_KEY. Under /api/outbox, so the admin address never runs it.
 */
async function handle(req: Request) {
  const secret = process.env.OUTBOX_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !same(given, secret)) return Response.json({ error: "Not allowed" }, { status: 401 });
  const admin = inboxAdmin();
  if (!admin) return Response.json({ error: "SUPABASE_SERVICE_ROLE_KEY is not set" }, { status: 200 });
  try {
    const run = await runGrowthTools(admin, 8000);
    return Response.json(run, { status: run.errors.length && !run.read && !run.sources.length && !run.digest ? 500 : 200 });
  } catch (e) {
    return Response.json({ error: (e as Error).message?.slice(0, 300) ?? "failed" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
