import { primeLang, tr } from "@/lib/tr";
import { AppBackground } from "@/components/AppBackground";
import { inboxAdmin } from "@/lib/inbox/server";
import { joinOpen } from "@/lib/meetings/model";
import type { GuestView } from "./actions";
import { GuestJoin } from "./GuestJoin";
import styles from "../../(app)/meetings/meetings.module.css";

export const metadata = { title: "Join the meeting", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * A guest's meeting page (/meet/<token>), no account needed. It shows only the meeting's title and time, our
 * company's name and logo, a notice when the meeting is recorded, and Join. The token is checked in the database
 * (only its SHA-256 is stored); it expires after the meeting and stops when a new link is made or the meeting is
 * cancelled.
 */
export default async function GuestMeetingPage({ params }: { params: Promise<{ token: string }> }) {
  await primeLang();
  const { token } = await params;
  const db = inboxAdmin();
  let v: GuestView | null = null;
  if (db && /^[0-9a-f]{64}$/.test(token)) {
    const { data } = await db.rpc("meeting_guest_view", { p_token: token });
    v = (data as GuestView | null) ?? null;
  }
  const logo = v?.logo_path && db ? db.storage.from("branding").getPublicUrl(v.logo_path).data.publicUrl : null;
  const fmt = (opts: Intl.DateTimeFormatOptions) => (v ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", ...opts }).format(new Date(v.starts_at)) : "");
  const open = v ? v.can_join || joinOpen({ status: v.status, starts_at: v.starts_at }) : false;

  return (
    <div className="auth-wrap">
      <AppBackground kind="architecture" />
      <div className={`auth-card ${styles.guestCard}`}>
        {!v ? (
          <>
            <h1>{tr("This link does not work")}</h1>
            <p className="muted">{tr("The meeting is over, was cancelled, or the link was replaced. Ask the person who invited you for a new link.")}</p>
          </>
        ) : (
          <>
            <div className="brand">
              {logo ? <img src={logo} alt={v.company} style={{ maxHeight: 56, maxWidth: 200 }} /> : null}
              <strong>{v.company}</strong>
            </div>
            <p className="small muted" style={{ margin: "12px 0 0" }}>
              {v.guest_name ? `${tr("Invitation for")} ${v.guest_name}` : tr("Meeting invitation")}
            </p>
            <h1 style={{ marginTop: 4 }}>{v.title}</h1>
            <p>
              {fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              <br />
              {fmt({ hour: "2-digit", minute: "2-digit", hour12: false })} {tr("Tanzania time (EAT)")} · {v.minutes} {tr("min")}
            </p>
            {(v.record || v.recording) && v.status !== "held" && (
              <p className={styles.guestNotice}>
                <span className={styles.recDotIdle} aria-hidden="true" />
                <span>
                  {tr("This meeting may be recorded so the team can write accurate minutes and follow up. You will see a red Recording banner while it is recorded. Recordings are kept privately by")}{" "}
                  {v.company} {tr("and deleted after a set time.")}
                </span>
              </p>
            )}
            {v.status === "held" ? (
              <p className="muted">{tr("This meeting has ended. Thank you.")}</p>
            ) : open ? (
              <GuestJoin token={token} initialRecording={!!v.recording} external={v.video_provider === "external"} />
            ) : (
              <>
                <p className="muted">{tr("You can join from 15 minutes before the start. Open this page again then.")}</p>
                <a href={`/meet/${token}`} className="btn btn-block">
                  {tr("Check again")}
                </a>
              </>
            )}
            <p className="small muted" style={{ marginTop: 16 }}>
              {tr("No account is needed. This private link is only for you and stops working after the meeting.")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
