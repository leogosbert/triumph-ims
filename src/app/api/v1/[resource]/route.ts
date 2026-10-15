import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });

/**
 * The LeMoSp data API (read only): GET /api/v1/{resource}?since=ISO-date&limit=100&offset=0
 * with "Authorization: Bearer lmsp_…". The key is checked in the database (public.api_read),
 * which also limits every answer to the key's company.
 */
export async function GET(req: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  const auth = req.headers.get("authorization") ?? "";
  const key = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? "";
  if (!key) return json({ error: "Missing API key. Send the header: Authorization: Bearer <your key>." }, 401);

  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw).toISOString() : null;
  if (sinceRaw && !since) return json({ error: "since must be a date, for example 2026-10-01 or 2026-10-01T08:00:00Z." }, 400);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  if (!Number.isInteger(limit) || !Number.isInteger(offset) || limit < 1 || offset < 0) {
    return json({ error: "limit (1 to 500) and offset must be whole numbers." }, 400);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("api_read", {
    p_key: key,
    p_resource: resource,
    p_since: since,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) {
    const status = error.code === "28000" ? 401 : error.code === "42501" ? 403 : error.code === "22023" ? 400 : error.code === "PGRST202" ? 503 : 500;
    return json({ error: status === 500 ? "Something went wrong. Try again later." : status === 503 ? "The API is not set up yet." : error.message }, status);
  }
  return json(data);
}
