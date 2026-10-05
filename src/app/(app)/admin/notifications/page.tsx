import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { PushSetup } from "@/components/PushSetup";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDate, formatDateTime } from "@/lib/format";
import { onAdminHost } from "@/lib/hosts-server";
import { readNotice, type SearchParams } from "@/lib/messages";
import { platformAdmin } from "../guard";
import { markAllAdminRead, saveAdminEmailSetting } from "./actions";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

type Item = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  severity: "info" | "attention" | "urgent";
  created_at: string;
  read_at: string | null;
};

const SEVERITY: Record<Item["severity"], { mark: string; label: string }> = {
  urgent: { mark: "!", label: "Urgent" },
  attention: { mark: "•", label: "Needs a look" },
  info: { mark: "i", label: "For your information" },
};

/** "Just now", "5 min ago", "3 h ago", "Yesterday", else the date (Tanzania time). */
function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return tr("Just now");
  if (min < 60) return `${min} ${tr("min ago")}`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ${tr("h ago")}`;
  if (h < 48) return tr("Yesterday");
  return formatDate(iso);
}

/** LeMoSp ADMIN: platform events for the LeMo Tech team (no company business data). */
export default async function AdminNotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const notice = await readNotice(searchParams);
  const [feed, email, adminHost] = await Promise.all([
    admin.supabase.rpc("platform_notification_feed", { p_limit: 150 }),
    admin.supabase.rpc("my_platform_notify_email"),
    onAdminHost(),
  ]);

  if (feed.error) {
    return (
      <section className="card">
        <h2 className="adm-title">{tr("Notifications")}</h2>
        <p className="muted">{tr("Admin notifications are not switched on yet: the platform notifications database update has not been run.")}</p>
      </section>
    );
  }
  const items = (feed.data ?? []) as Item[];
  const unread = items.filter((i) => !i.read_at).length;
  const now = Date.now();

  return (
    <>
      <div className="page-head">
        <h2 className="adm-title">{tr("Notifications")}</h2>
        {unread > 0 && (
          <form action={markAllAdminRead}>
            <SubmitButton className="btn btn-small" pendingText="…">{tr("Mark all read")}</SubmitButton>
          </form>
        )}
      </div>
      <Notice {...notice} />

      {items.length === 0 ? (
        <p className="card muted">{tr("Nothing yet. You will be told here about new companies, level changes, app feedback, deletions, overdue backups, and a daily summary at 8:00.")}</p>
      ) : (
        <ul className="rec-list adm-notes">
          {items.map((i) => (
            <li key={i.id} className={i.read_at ? "read" : "unread"}>
              <a href={`/admin/notifications/${i.id}`}>
                <span className={`adm-sev adm-sev-${i.severity}`} role="img" aria-label={tr(SEVERITY[i.severity].label)}>
                  {SEVERITY[i.severity].mark}
                </span>
                <div className="main">
                  <div className="title">{tr(i.title)}</div>
                  <div className="sub">
                    {i.body && <>{tr(i.body)} · </>}
                    <time dateTime={i.created_at} title={formatDateTime(i.created_at)}>
                      {ago(i.created_at, now)}
                    </time>
                  </div>
                </div>
                {!i.read_at && (
                  <div className="side">
                    <span className="badge tone-info">{tr("New")}</span>
                  </div>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}

      <section className="card" id="settings" style={{ marginTop: 20 }}>
        <h2 className="adm-title">{tr("Turn on notifications on this phone")}</h2>
        <p className="small muted">
          {adminHost
            ? tr("Get these alerts on this phone, even when LeMoSp ADMIN is closed. Do this on each phone or computer you use.")
            : tr("Get these alerts on this phone. Here the admin screens are part of the company app, so this phone gets the company app's alerts too.")}
        </p>
        {process.env.VAPID_PUBLIC_KEY ? (
          <PushSetup vapidKey={process.env.VAPID_PUBLIC_KEY} target="admin" />
        ) : (
          <p className="small muted">{tr("Phone alerts are not set up on this site yet: add the public phone-alert key in the hosting settings (see GO-LIVE, section 11).")}</p>
        )}
        {!email.error && (
          <form action={saveAdminEmailSetting} style={{ marginTop: 14 }}>
            <label className="check">
              <input type="checkbox" name="notify_email" defaultChecked={email.data === true} /> {tr("Email me too")}
            </label>
            <SubmitButton className="btn btn-small" pendingText={tr("Saving…")}>
              {tr("Save")}
            </SubmitButton>
          </form>
        )}
      </section>
    </>
  );
}
