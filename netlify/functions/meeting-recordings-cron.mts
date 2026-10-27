// Netlify scheduled function: every hour, deletes meeting recordings past the company's "Delete meeting recordings
// after" setting (Meetings → Settings), and the files of recordings someone pressed "Delete now" on whose files could
// not be removed at once.
//
// public.meeting_recordings_expire() (service role only) marks the expired recordings deleted and returns their
// files; they are removed through the Storage API (newer Supabase refuses deleting storage files from SQL), then
// public.meeting_recordings_mark_purged() records which recordings have no file left.
//
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (already set for the inbox and getting paid).
// Bundled on its own by Netlify: no imports from the app.

// Same rule as isAdminHost in src/lib/hosts.ts (kept inline: Netlify bundles this file on its own).
// The LeMoSp ADMIN site is built from the same code, so it has this job too: it must do nothing there.
function isAdminHost(url: string | undefined): boolean {
  let host = "";
  try {
    host = url ? new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase() : "";
  } catch {
    return false;
  }
  if (!host) return false;
  const configured = process.env.NEXT_PUBLIC_ADMIN_URL;
  try {
    if (configured && new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`).hostname.toLowerCase() === host) return true;
  } catch {
    /* ignore a malformed setting */
  }
  return host.startsWith("admin.") || host.split(".")[0].endsWith("-admin");
}

export default async () => {
  if (isAdminHost(process.env.URL) || isAdminHost(process.env.NEXT_PUBLIC_SITE_URL)) {
    return new Response("Admin site: scheduled jobs run on the company app only", { status: 200 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return new Response("Not configured", { status: 200 });
  const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };

  const res = await fetch(`${url}/rest/v1/rpc/meeting_recordings_expire`, { method: "POST", headers: h, body: JSON.stringify({ p_limit: 1000 }) });
  if (!res.ok) {
    // Before the v1.25 SQL is run the function does not exist yet: nothing to do.
    return new Response(`expire: ${res.status}`, { status: 200 });
  }
  const rows = (await res.json()) as { recording_id: string; path: string }[];
  if (!rows.length) return new Response("Nothing to delete", { status: 200 });

  let removed = 0;
  let failed = 0;
  // The Storage API removes up to 1000 files per call; 100 at a time keeps each call short.
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100).map((r) => r.path);
    const del = await fetch(`${url}/storage/v1/object/meeting-recordings`, { method: "DELETE", headers: h, body: JSON.stringify({ prefixes: batch }) }).catch(() => null);
    if (del?.ok) removed += batch.length;
    else failed += batch.length;
  }
  const ids = [...new Set(rows.map((r) => r.recording_id))];
  const marked = await fetch(`${url}/rest/v1/rpc/meeting_recordings_mark_purged`, { method: "POST", headers: h, body: JSON.stringify({ p_ids: ids }) });
  const cleared = marked.ok ? Number(await marked.json()) : 0;
  if (failed) console.warn(`meeting recordings: ${failed} file(s) could not be removed; they are tried again next hour`);
  return new Response(JSON.stringify({ files_removed: removed, files_failed: failed, recordings_cleared: cleared }), { status: 200 });
};

export const config = { schedule: "17 * * * *" };
