import { primeLang, tr } from "@/lib/tr";
import { AppBackground } from "@/components/AppBackground";
import { inboxAdmin } from "@/lib/inbox/server";
import { RequestForm } from "./RequestForm";

export const metadata = { title: "Ask for a meeting", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type PortalInfo = { company: string; logo_path: string | null; welcome: string | null };

/** The public page where a client or supplier asks a company for a meeting (/meet/request/<company link>). */
export default async function RequestMeetingPage({ params }: { params: Promise<{ token: string }> }) {
  await primeLang();
  const { token } = await params;
  const db = inboxAdmin();
  let info: PortalInfo | null = null;
  if (db && /^[0-9a-f]{40,64}$/.test(token)) {
    const { data } = await db.rpc("meeting_portal_info", { p_token: token });
    info = (data as PortalInfo | null) ?? null;
  }
  const logo = info?.logo_path && db ? db.storage.from("branding").getPublicUrl(info.logo_path).data.publicUrl : null;
  return (
    <div className="auth-wrap">
      <AppBackground kind="architecture" />
      <div className="auth-card">
        {!info ? (
          <>
            <h1>{tr("This page is not available")}</h1>
            <p className="muted">{tr("The link is not right or the page was switched off. Please contact the company directly.")}</p>
          </>
        ) : (
          <>
            <div className="brand">
              {logo ? <img src={logo} alt={info.company} style={{ maxHeight: 56, maxWidth: 200 }} /> : null}
              <strong>{info.company}</strong>
            </div>
            <h1 style={{ marginTop: 12 }}>{tr("Ask for a meeting")}</h1>
            <p className="muted small">{info.welcome ?? tr("Tell us when you would like to meet and what about. We answer by email.")}</p>
            <RequestForm token={token} shownAt={Date.now()} />
          </>
        )}
      </div>
    </div>
  );
}
