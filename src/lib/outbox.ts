import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import webpush from "web-push";
import { SUPABASE_ANON_KEY, SUPABASE_URL, siteUrl } from "@/lib/supabase/env";

/**
 * Sends pending alerts as phone push notifications and emails.
 * Needs these settings on the server (Netlify → Environment variables):
 *   OUTBOX_SECRET                      same text as set_outbox_secret() in the database
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY phone push (generate in the app: Settings → Notifications)
 *   RESEND_API_KEY, EMAIL_FROM          email (resend.com), e.g. "TRIUMPH IMS <alerts@yourdomain.co.tz>"
 * Anything missing is simply skipped.
 */
export type OutboxStatus = { secret: boolean; push: boolean; email: boolean };

export function outboxStatus(): OutboxStatus {
  return {
    secret: Boolean(process.env.OUTBOX_SECRET),
    push: Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
  };
}

type Claimed = {
  notification_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  company_name: string;
  title: string;
  body: string | null;
  link: string | null;
  severity: string;
  created_at: string;
  want_email: boolean;
  want_push: boolean;
  subscriptions: { endpoint: string; p256dh: string; auth: string }[];
};

function db() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

async function sendEmail(to: string, name: string | null, company: string, items: Claimed[]) {
  const site = siteUrl();
  const subject = items.length === 1 ? items[0].title : `${items.length} alerts from ${company}`;
  const rows = items
    .map(
      (i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e3e8ef">
        <div style="font-weight:600;color:${i.severity === "critical" ? "#b53228" : "#15202e"}">${esc(i.title)}</div>
        ${i.body ? `<div style="color:#5b6675;font-size:14px">${esc(i.body)}</div>` : ""}
        ${i.link ? `<a href="${site}${esc(i.link)}" style="color:#1c4c9b;font-size:14px">Open in the app</a>` : ""}
      </td></tr>`,
    )
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
    <p>Hello ${esc(name?.split(" ")[0] ?? "")},</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="color:#5b6675;font-size:12px;margin-top:20px">${esc(company)} · You can turn these emails off in the app under Your account.</p></div>`;
  const text = items.map((i) => `${i.title}\n${i.body ?? ""}\n${i.link ? site + i.link : ""}`).join("\n\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html, text }),
  });
  return res.ok;
}

/** Collects pending alerts once and delivers them. Safe to call often. */
export async function processOutbox(runAlerts = false) {
  const secret = process.env.OUTBOX_SECRET;
  const status = outboxStatus();
  const result = { alerts: 0, claimed: 0, pushed: 0, emailed: 0, removed: 0, errors: [] as string[] };
  if (!secret) {
    result.errors.push("OUTBOX_SECRET is not set");
    return result;
  }
  const supabase = db();
  if (runAlerts) {
    const { data, error } = await supabase.rpc("run_all_alerts", { p_secret: secret });
    if (error) result.errors.push(`alerts: ${error.message}`);
    else result.alerts = Number(data ?? 0);
  }
  const { data, error } = await supabase.rpc("claim_outbox", { p_secret: secret, p_limit: 300 });
  if (error) {
    result.errors.push(`claim: ${error.message}`);
    return result;
  }
  const items = (data ?? []) as Claimed[];
  result.claimed = items.length;
  if (!items.length) return result;

  // Phone push: one message per alert per phone.
  if (status.push) {
    webpush.setVapidDetails(
      `mailto:${process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "alerts@example.com"}`,
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    const dead = new Set<string>();
    await Promise.all(
      items
        .filter((i) => i.want_push)
        .flatMap((i) =>
          i.subscriptions.map(async (s) => {
            try {
              await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                JSON.stringify({ title: i.title, body: i.body ?? "", url: i.link ?? "/notifications", tag: i.notification_id }),
                { TTL: 60 * 60 * 24, urgency: i.severity === "critical" ? "high" : "normal" },
              );
              result.pushed++;
            } catch (e) {
              const code = (e as { statusCode?: number }).statusCode;
              if (code === 404 || code === 410) dead.add(s.endpoint);
              else result.errors.push(`push: ${code ?? (e as Error).message}`);
            }
          }),
        ),
    );
    if (dead.size) {
      const { data: n } = await supabase.rpc("drop_push_endpoints", { p_secret: secret, p_endpoints: [...dead] });
      result.removed = Number(n ?? 0);
    }
  }

  // Email: one message per person per run, listing their alerts.
  if (status.email) {
    const byUser = new Map<string, Claimed[]>();
    for (const i of items) if (i.want_email && i.email) byUser.set(i.user_id, [...(byUser.get(i.user_id) ?? []), i]);
    for (const list of byUser.values()) {
      try {
        if (await sendEmail(list[0].email!, list[0].full_name, list[0].company_name, list)) result.emailed++;
        else result.errors.push("email: rejected by provider");
      } catch (e) {
        result.errors.push(`email: ${(e as Error).message}`);
      }
    }
  }
  return result;
}

/** Run the outbox after the response is sent, so new alerts go out within seconds. */
export function kickOutbox() {
  if (!process.env.OUTBOX_SECRET) return;
  try {
    after(async () => {
      try {
        await processOutbox(false);
      } catch {
        /* the scheduled job will retry */
      }
    });
  } catch {
    /* not in a request: ignore */
  }
}

export function generateVapidKeys() {
  return webpush.generateVAPIDKeys();
}
