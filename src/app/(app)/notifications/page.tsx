import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { PushSetup } from "@/components/PushSetup";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { markAllRead, saveNotificationSettings, sendTestNotification } from "./actions";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

type N = { id: string; title: string; body: string | null; severity: string; created_at: string; read_at: string | null };

export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, user, company } = await getAppContext();
  await supabase.rpc("refresh_alerts", { p_company: company.id });
  const [{ data, error }, { data: settings }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, title, body, severity, created_at, read_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("notification_settings").select("email_alerts, push_alerts").eq("user_id", user.id).maybeSingle(),
  ]);
  if (error) {
    return (
      <>
        <h1>{tr("Notifications")}</h1>
        <p className="card muted">{tr("Notifications are not switched on yet. Management needs to run the Stage 7 database update.")}</p>
      </>
    );
  }
  const rows = (data ?? []) as N[];
  const unread = rows.filter((r) => !r.read_at).length;
  const emailOn = settings?.email_alerts ?? true;
  const pushOn = settings?.push_alerts ?? true;

  return (
    <>
      <div className="page-head">
        <h1>{tr("Notifications")}</h1>
        {unread > 0 && (
          <form action={markAllRead}>
            <SubmitButton className="btn btn-small" pendingText="…">{tr("Mark all read")}</SubmitButton>
          </form>
        )}
      </div>
      <Notice {...notice} />
      {rows.length === 0 ? (
        <p className="card muted">{tr("Nothing yet. You'll be told here when something needs you: approvals, new RFQs, deliveries, overdue invoices, stock alerts.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => (
            <li key={r.id} className={r.read_at ? "read" : "unread"}>
              <a href={`/notifications/${r.id}`}>
                <div className="main">
                  <div className="title">
                    {r.severity === "critical" && <span className="dot-critical" aria-label={tr("Urgent")} />}
                    {tr(String(r.title ?? ""))}
                  </div>
                  <div className="sub">
                    {r.body && <>{r.body} · </>}
                    {formatDateTime(r.created_at)}
                  </div>
                </div>
                {!r.read_at && (
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
        <h2>{tr("How you are told")}</h2>
        <p className="small muted">{tr("Everything appears here. Urgent things (approvals, new RFQs, deliveries, overdue invoices, expiring stock) can also reach your phone and email.")}</p>
        <form action={saveNotificationSettings}>
          <label className="check">
            <input type="checkbox" name="push_alerts" defaultChecked={pushOn} />{" "}{tr("Phone notifications")}</label>
          <label className="check">
            <input type="checkbox" name="email_alerts" defaultChecked={emailOn} />{" "}{tr("Emails to")}{" "}{user.email}
          </label>
          <SubmitButton className="btn btn-small" pendingText={tr("Saving…")}>{tr("Save")}</SubmitButton>
        </form>
        <h3 style={{ marginTop: 16 }}>{tr("This device")}</h3>
        <PushSetup vapidKey={process.env.VAPID_PUBLIC_KEY ?? null} />
        <form action={sendTestNotification} style={{ marginTop: 12 }}>
          <SubmitButton className="btn btn-small" pendingText={tr("Sending…")}>{tr("Send me a test")}</SubmitButton>
        </form>
        <p className="small" style={{ marginTop: 12 }}>
          <Link href="/settings/notifications">{tr("Server setup for phone and email alerts →")}</Link>
        </p>
      </section>
    </>
  );
}
