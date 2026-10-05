import { createClient } from "@supabase/supabase-js";
import { after } from "next/server";
import webpush from "web-push";
import { adminUrl } from "@/lib/hosts";
import { SUPABASE_ANON_KEY, SUPABASE_URL, siteUrl } from "@/lib/supabase/env";

/**
 * Sends pending alerts as phone push notifications and emails.
 * Needs these settings on the server (Netlify → Environment variables):
 *   OUTBOX_SECRET                      same text as set_outbox_secret() in the database
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY phone push (generate in the app: Settings → Notifications)
 *   RESEND_API_KEY, EMAIL_FROM          email (resend.com), e.g. "TRIUMPH Alerts <alerts@yourdomain.co.tz>"
 * Anything missing is simply skipped.
 * Also sends the LeMoSp ADMIN notifications (claim_platform_outbox) and creates the admins' 08:00 daily
 * summary. The admin site needs only VAPID_PUBLIC_KEY (for phones to subscribe), never the private key.
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

/** An admin notification for one platform admin (claim_platform_outbox). */
type PlatformClaimed = {
  notification_id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  title: string;
  body: string | null;
  link: string | null;
  severity: string;
  created_at: string;
  want_email: boolean;
  subscriptions: { endpoint: string; p256dh: string; auth: string }[];
};

type PushJob = { tag: string; title: string; body: string; url: string; urgent: boolean; subs: Claimed["subscriptions"] };

function setVapid() {
  webpush.setVapidDetails(
    `mailto:${process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "alerts@example.com"}`,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
}

/** One push per job per phone; phones that are gone are forgotten (drop_push_endpoints). */
async function sendPushes(
  supabase: ReturnType<typeof db>,
  secret: string,
  jobs: PushJob[],
  result: { pushed: number; removed: number; errors: string[] },
) {
  const dead = new Set<string>();
  await Promise.all(
    jobs.flatMap((j) =>
      j.subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: j.title, body: j.body, url: j.url, tag: j.tag }),
            { TTL: 60 * 60 * 24, urgency: j.urgent ? "high" : "normal" },
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
    result.removed += Number(n ?? 0);
  }
}

function db() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type EmailItem = { title: string; body: string | null; link: string | null; severity: string };

async function sendEmail(
  to: string,
  name: string | null,
  company: string,
  items: EmailItem[],
  site = siteUrl(),
  footer = `${company} · You can turn these emails off in the app under Your account.`,
) {
  const subject = items.length === 1 ? items[0].title : `${items.length} alerts from ${company}`;
  const rows = items
    .map(
      (i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e3e8ef">
        <div style="font-weight:600;color:${i.severity === "critical" || i.severity === "urgent" ? "#b53228" : "#15202e"}">${esc(i.title)}</div>
        ${i.body ? `<div style="color:#5b6675;font-size:14px">${esc(i.body)}</div>` : ""}
        ${i.link ? `<a href="${site}${esc(i.link)}" style="color:#1c4c9b;font-size:14px">Open in the app</a>` : ""}
      </td></tr>`,
    )
    .join("");
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
    <p>Hello ${esc(name?.split(" ")[0] ?? "")},</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="color:#5b6675;font-size:12px;margin-top:20px">${esc(footer)}</p></div>`;
  const text = items.map((i) => `${i.title}\n${i.body ?? ""}\n${i.link ? site + i.link : ""}`).join("\n\n");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject, html, text }),
  });
  return res.ok;
}

/**
 * Automatic backups: a few companies per scheduled run, after the alerts.
 * Each step is its own short database call (saved on its own), because Supabase stops a
 * server call after a few seconds and a stopped call undoes everything it did:
 * claim the next company → take its backup → … then the once-a-day "backup overdue" check.
 * Errors never stop the alerts; quiet until the backups SQL has been run.
 */
async function runBackups(
  supabase: ReturnType<typeof db>,
  secret: string,
  result: { backups: number; backupError: string | undefined },
) {
  const started = Date.now();
  const missing = (e: { code?: string } | null) => e?.code === "PGRST202";
  for (let i = 0; i < 3 && Date.now() - started < 6000; i++) {
    try {
      const claim = await supabase.rpc("claim_company_backup", { p_secret: secret });
      if (claim.error) {
        if (!missing(claim.error)) result.backupError = `claim: ${claim.error.message}`;
        break;
      }
      const company = claim.data as string | null;
      if (!company) break;
      const take = await supabase.rpc("take_claimed_backup", { p_secret: secret, p_company: company });
      if (take.error) result.backupError = `backup: ${take.error.message}`;
      else if (take.data) result.backups++;
    } catch (e) {
      result.backupError = (e as Error).message;
    }
  }
  try {
    const overdue = await supabase.rpc("check_overdue_backups", { p_secret: secret });
    if (overdue.error && !missing(overdue.error)) result.backupError = `overdue check: ${overdue.error.message}`;
  } catch (e) {
    result.backupError = (e as Error).message;
  }
}

/**
 * Deleting accounts and closing companies when their date has come: a few per scheduled run,
 * after the backups. Same pattern: claim one (the attempt is saved on its own) → finish it, each
 * a short separate call, so a time-out on one big company never undoes or blocks the rest.
 * Errors never stop the alerts; quiet until the deletion SQL has been run.
 */
async function runDeletions(
  supabase: ReturnType<typeof db>,
  secret: string,
  result: { deletions: number; deletionError: string | undefined },
  runStarted: number,
) {
  // Short on purpose: the whole scheduled run must finish within the host's time limit.
  // Deletions are rare and can wait for the next run (every 5 minutes).
  for (let i = 0; i < 2 && Date.now() - runStarted < 8000; i++) {
    try {
      const claim = await supabase.rpc("claim_due_deletion", { p_secret: secret });
      if (claim.error) {
        if (claim.error.code !== "PGRST202") result.deletionError = `claim: ${claim.error.message}`;
        break;
      }
      const job = claim.data as { kind: string; id: string } | null;
      if (!job) break;
      const done = await supabase.rpc("finish_deletion", { p_secret: secret, p_kind: job.kind, p_id: job.id });
      if (done.error) result.deletionError = `${job.kind}: ${done.error.message}`;
      else if (done.data) result.deletions++;
    } catch (e) {
      result.deletionError = (e as Error).message;
    }
  }
}

/**
 * LeMoSp ADMIN notifications (platform team). Isolated steps: an error here never stops the
 * company alerts. Sent from the company site, which has the private push key; phones subscribed
 * in the admin app open the link on the admin address (the service worker opens it relative to
 * its own address).
 */
async function runPlatformDailySummary(supabase: ReturnType<typeof db>, secret: string, result: { platformError: string | undefined }) {
  try {
    const { error } = await supabase.rpc("run_platform_daily_summary", { p_secret: secret });
    if (error && error.code !== "PGRST202") result.platformError = `daily summary: ${error.message}`;
  } catch (e) {
    result.platformError = (e as Error).message;
  }
}

async function runPlatformOutbox(
  supabase: ReturnType<typeof db>,
  secret: string,
  status: OutboxStatus,
  result: { platformClaimed: number; pushed: number; emailed: number; removed: number; errors: string[]; platformError: string | undefined },
) {
  // Without push and email there is nothing to send: leave them for when it is set up.
  if (!status.push && !status.email) return;
  try {
    const { data, error } = await supabase.rpc("claim_platform_outbox", { p_secret: secret, p_limit: 100 });
    if (error) {
      if (error.code !== "PGRST202") result.platformError = `claim: ${error.message}`;
      return;
    }
    const items = (data ?? []) as PlatformClaimed[];
    result.platformClaimed = items.length;
    if (!items.length) return;
    if (status.push) {
      setVapid();
      await sendPushes(
        supabase,
        secret,
        items.map((i) => ({
          tag: `adm-${i.notification_id}`,
          title: i.title,
          body: i.body ?? "",
          url: `/admin/notifications/${i.notification_id}`,
          urgent: i.severity === "urgent",
          subs: i.subscriptions,
        })),
        result,
      );
    }
    if (status.email) {
      const site = adminUrl() ?? siteUrl();
      const byAdmin = new Map<string, PlatformClaimed[]>();
      for (const i of items) if (i.want_email && i.email) byAdmin.set(i.user_id, [...(byAdmin.get(i.user_id) ?? []), i]);
      for (const list of byAdmin.values()) {
        try {
          const ok = await sendEmail(
            list[0].email!,
            list[0].full_name,
            "LeMoSp ADMIN",
            list.map((i) => ({ ...i, link: `/admin/notifications/${i.notification_id}` })),
            site,
            "LeMoSp ADMIN · You can turn these emails off in LeMoSp ADMIN under Notifications.",
          );
          if (ok) result.emailed++;
          else result.errors.push("email: rejected by provider");
        } catch (e) {
          result.errors.push(`email: ${(e as Error).message}`);
        }
      }
    }
  } catch (e) {
    result.platformError = (e as Error).message;
  }
}

/**
 * Emails to one person that belong to no company (e.g. "Your LeMoSp account will be deleted").
 * Only claimed when email sending is set up (otherwise they wait, and are dropped after 3 days).
 */
async function runAccountEmails(
  supabase: ReturnType<typeof db>,
  secret: string,
  status: OutboxStatus,
  result: { emailed: number; errors: string[] },
) {
  if (!status.email) return;
  try {
    const { data, error } = await supabase.rpc("claim_account_emails", { p_secret: secret, p_limit: 50 });
    if (error) {
      if (error.code !== "PGRST202") result.errors.push(`account emails: ${error.message}`);
      return;
    }
    for (const m of (data ?? []) as { id: string; email: string; subject: string; body: string }[]) {
      try {
        const html = `<div style="font-family:Arial,sans-serif;max-width:560px"><p>${esc(m.body)}</p>
          <p><a href="${siteUrl()}/login" style="color:#1c4c9b">Open LeMoSp</a></p>
          <p style="color:#5b6675;font-size:12px;margin-top:20px">LeMoSp · LeMo Tech Solutions</p></div>`;
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [m.email], subject: m.subject, html, text: m.body }),
        });
        if (res.ok) result.emailed++;
        else result.errors.push("account email: rejected by provider");
      } catch (e) {
        result.errors.push(`account email: ${(e as Error).message}`);
      }
    }
  } catch (e) {
    result.errors.push(`account emails: ${(e as Error).message}`);
  }
}

/** Collects pending alerts once and delivers them. Safe to call often. */
export async function processOutbox(runAlerts = false) {
  const secret = process.env.OUTBOX_SECRET;
  const status = outboxStatus();
  const result = {
    alerts: 0,
    claimed: 0,
    pushed: 0,
    emailed: 0,
    removed: 0,
    errors: [] as string[],
    backups: 0,
    backupError: undefined as string | undefined,
    deletions: 0,
    deletionError: undefined as string | undefined,
    platformClaimed: 0,
    platformError: undefined as string | undefined,
  };
  if (!secret) {
    result.errors.push("OUTBOX_SECRET is not set");
    return result;
  }
  const supabase = db();
  const runStarted = Date.now();
  if (runAlerts) {
    const { data, error } = await supabase.rpc("run_all_alerts", { p_secret: secret });
    if (error) result.errors.push(`alerts: ${error.message}`);
    else result.alerts = Number(data ?? 0);
    await runBackups(supabase, secret, result);
    await runDeletions(supabase, secret, result, runStarted);
    await runPlatformDailySummary(supabase, secret, result);
  }
  await runPlatformOutbox(supabase, secret, status, result);
  await runAccountEmails(supabase, secret, status, result);
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
    setVapid();
    await sendPushes(
      supabase,
      secret,
      items
        .filter((i) => i.want_push)
        .map((i) => ({
          tag: i.notification_id,
          title: i.title,
          body: i.body ?? "",
          url: i.link ?? "/notifications",
          urgent: i.severity === "critical",
          subs: i.subscriptions,
        })),
      result,
    );
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
