import { inboxAdmin } from "@/lib/inbox/server";
import { buildIcs, type CalItem } from "@/lib/meetings/ics";
import { siteUrl } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

/**
 * A person's private calendar feed (/api/calendar/<token>.ics) for Google Calendar, iPhone or Outlook.
 * The token is checked in the database (public.calendar_feed, service role only): it lists only the dates that
 * person may see, 30 days back and a year ahead, and stops when they make a new link or leave the company.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");
  const db = inboxAdmin();
  if (!db || !/^[0-9a-f]{64}$/.test(token)) return new Response("Not found", { status: 404 });
  const { data, error } = await db.rpc("calendar_feed", { p_token: token });
  if (error) return new Response("Try again later", { status: 503, headers: { "Retry-After": "600" } });
  const feed = data as { company: string; name: string; items: CalItem[] } | null;
  if (!feed) return new Response("Not found", { status: 404 });
  const body = buildIcs(`${feed.company} · ${feed.name}`, feed.items ?? [], { base: siteUrl() });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="lemosp.ics"',
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
    },
  });
}
