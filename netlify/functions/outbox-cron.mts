// Netlify scheduled function: every 5 minutes, ask the app to check alerts and
// send pending push notifications and emails.
export default async () => {
  const base = process.env.URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.OUTBOX_SECRET;
  if (!base || !secret) return new Response("Not configured", { status: 200 });
  const res = await fetch(`${base.replace(/\/$/, "")}/api/outbox`, { headers: { Authorization: `Bearer ${secret}` } });
  return new Response(await res.text(), { status: res.status });
};

export const config = { schedule: "*/5 * * * *" };
