import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchTenderSource } from "./fetchSource";
import { parseTenderListing } from "./listing";
import { readWaitingNotices } from "./tenderRead";

/**
 * The hourly job (netlify/functions/growth-tools-cron.mts -> /api/outbox/growth-tools), with the service
 * role key. Netlify stops a function at 10 s, so everything fits in a budget of about 8 s and the rest
 * waits for the next hour:
 *   1. the tender digest (from 07:00, once a day) and the LPO financing reminders: quick, always run;
 *   2. web sources that are due (at most 2 a run, one page each, robots.txt obeyed);
 *   3. notices waiting to be read (AI within each company's daily allowance, otherwise the rules).
 */

export type GrowthRun = {
  digest: number;
  financing: number;
  sources: { id: string; status: string; found: number; error?: string }[];
  read: number;
  ai: number;
  errors: string[];
  ms: number;
};

export async function runGrowthTools(admin: SupabaseClient, budgetMs = 8000): Promise<GrowthRun> {
  const started = Date.now();
  const deadline = started + budgetMs;
  const run: GrowthRun = { digest: 0, financing: 0, sources: [], read: 0, ai: 0, errors: [], ms: 0 };

  const [digest, financing] = await Promise.all([admin.rpc("tender_run_digest"), admin.rpc("financing_run_all_alerts")]);
  if (digest.error) run.errors.push(`digest: ${digest.error.message}`);
  else run.digest = Number(digest.data ?? 0);
  if (financing.error) run.errors.push(`financing: ${financing.error.message}`);
  else run.financing = Number(financing.data ?? 0);

  const { data: due, error: dueError } = await admin.rpc("tender_sources_due", { p_limit: 2 });
  if (dueError) run.errors.push(`sources: ${dueError.message}`);
  for (const s of (due ?? []) as { id: string; company_id: string; url: string; kind: "page" | "rss"; name: string }[]) {
    const left = deadline - Date.now();
    if (left < 3000) break;
    const res = await fetchTenderSource(s.url, Math.min(5000, left - 1500));
    let status: string = res.ok ? "ok" : res.status;
    let found = 0;
    let error: string | undefined = res.ok ? undefined : res.error;
    if (res.ok) {
      const items = parseTenderListing(res.body, res.url, s.kind).slice(0, 25);
      for (const it of items) {
        const { data: id, error: e } = await admin.rpc("tender_notice_ingest", {
          p_source: s.id,
          p: { title: it.title, url: it.url ?? res.url, raw_text: it.text, published_on: it.published },
        });
        if (e) {
          error = e.message.slice(0, 200);
          break;
        }
        if (id) found++;
      }
      if (!items.length) {
        status = "empty";
        error = "No tender adverts found on this page. Check the link points at the list of tenders.";
      }
    }
    await admin.rpc("tender_source_fetched", { p_source: s.id, p_status: status, p_error: error ?? null, p_found: found });
    run.sources.push({ id: s.id, status, found, ...(error ? { error } : {}) });
  }

  if (deadline - Date.now() > 2000) {
    const r = await readWaitingNotices(admin, deadline, { limit: 8 });
    run.read = r.read;
    run.ai = r.ai;
    run.errors.push(...r.errors);
  }
  run.ms = Date.now() - started;
  return run;
}
