// Netlify scheduled function: every 15 minutes, ask the app to send queued TRA receipts (VFD) and the
// payment reminders that are due. Reminders only go out between each company's send hour and 20:00
// Tanzania time, and only for companies that switched them on.

// Same rule as isAdminHost in src/lib/hosts.ts (kept inline: Netlify bundles this file on its own).
// The LeMoSp ADMIN site is built from the same code, so it has this job too: it must do nothing
// there, or reminders would go out twice.
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
  const base = process.env.URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (isAdminHost(process.env.URL) || isAdminHost(process.env.NEXT_PUBLIC_SITE_URL)) {
    return new Response("Admin site: scheduled jobs run on the company app only", { status: 200 });
  }
  const secret = process.env.OUTBOX_SECRET;
  if (!base || !secret || !process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response("Not configured", { status: 200 });
  const res = await fetch(`${base.replace(/\/$/, "")}/api/money/cron`, { headers: { Authorization: `Bearer ${secret}` } });
  return new Response(await res.text(), { status: res.status });
};

export const config = { schedule: "*/15 * * * *" };
