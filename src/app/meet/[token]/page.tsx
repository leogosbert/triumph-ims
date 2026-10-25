import { primeLang, tr } from "@/lib/tr";
import { AppBackground } from "@/components/AppBackground";
import { LangSwitch } from "@/components/LangSwitch";
import { SubmitButton } from "@/components/SubmitButton";
import { inboxAdmin } from "@/lib/inbox/server";
import { joinOpen } from "@/lib/meetings/model";
import { guestJoin } from "./actions";

export const metadata = { title: "Join the meeting", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type View = {
  company: string;
  logo_path: string | null;
  title: string;
  starts_at: string;
  minutes: number;
  status: string;
  guest_name: string | null;
  can_join: boolean;
  video_provider: string;
};

/**
 * A guest's meeting page (/meet/<token>), no account needed. It shows only the meeting's title and time, our
 * company's name and logo, and Join. The token is checked in the database (only its SHA-256 is stored); it
 * expires after the meeting and stops when a new link is made or the meeting is cancelled.
 */
export default async function GuestMeetingPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await primeLang();
  const { token } = await params;
  const sp = await searchParams;
  const db = inboxAdmin();
  let v: View | null = null;
  if (db && /^[0-9a-f]{64}$/.test(token)) {
    const { data } = await db.rpc("meeting_guest_view", { p_token: token });
    v = (data as View | null) ?? null;
  }
  const logo = v?.logo_path && db ? db.storage.from("branding").getPublicUrl(v.logo_path).data.publicUrl : null;
  const fmt = (opts: Intl.DateTimeFormatOptions) => (v ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", ...opts }).format(new Date(v.starts_at)) : "");
  const open = v ? v.can_join || joinOpen({ status: v.status, starts_at: v.starts_at }) : false;

  return (
    <div className="auth-wrap">
      <AppBackground kind="architecture" />
      <div style={{ position: "absolute", top: 12, right: 12 }}>
        <LangSwitch />
      </div>
      <div className="auth-card">
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
            <h1 style={{ marginTop: 12 }}>{v.title}</h1>
            <p>
              {fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              <br />
              {fmt({ hour: "2-digit", minute: "2-digit", hour12: false })} {tr("Tanzania time")} · {v.minutes} {tr("min")}
            </p>
            {v.guest_name && (
              <p className="small muted">
                {tr("Invited")}: {v.guest_name}
              </p>
            )}
            {sp.error && <p className="notice notice-error">{tr(sp.error)}</p>}
            {v.status === "held" ? (
              <p className="muted">{tr("This meeting has ended. Thank you.")}</p>
            ) : open ? (
              <form action={guestJoin}>
                <input type="hidden" name="token" value={token} />
                <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Opening…")}>
                  {tr("Join the meeting")}
                </SubmitButton>
                <p className="small muted" style={{ marginTop: 8 }}>
                  {v.video_provider === "external" ? tr("It opens in Zoom, Teams or Google Meet.") : tr("Allow the camera and microphone when your browser asks.")}
                </p>
              </form>
            ) : (
              <>
                <p className="muted">{tr("You can join from 15 minutes before the start. Open this page again then.")}</p>
                <a href={`/meet/${token}`} className="btn btn-block">
                  {tr("Check again")}
                </a>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
