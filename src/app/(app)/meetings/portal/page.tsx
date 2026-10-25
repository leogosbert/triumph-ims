import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { requireManager } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { siteUrl } from "@/lib/supabase/env";
import { setPortal } from "../actions";
import { MeetingTabs } from "../parts";
import styles from "../meetings.module.css";

export const metadata = { title: "Client request page" };

export default async function PortalPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company } = await requireManager();
  const { data } = await supabase.rpc("meeting_portal_link", { p_company: company.id });
  const p = data as { token: string; enabled: boolean; welcome: string | null } | null;
  const url = p ? `${siteUrl()}/meet/request/${p.token}` : null;
  return (
    <>
      <div className="page-head">
        <h1>{tr("Client request page")}</h1>
      </div>
      <MeetingTabs current="/meetings/invitations" />
      <Notice {...notice} />
      <section className="card">
        <p>{tr("A private page where clients and suppliers ask for a meeting with you: name, company, email, time, topic and, if they host it, their own Zoom, Teams or Google Meet link. Each request comes to management to accept or decline.")}</p>
        {url && p?.enabled ? (
          <>
            <p className="small muted">{tr("Share this link in your email signature, on WhatsApp or on your website:")}</p>
            <div className={styles.feedBox}>{url}</div>
          </>
        ) : (
          <p className="muted small">{p ? tr("The request page is switched off.") : tr("The request page is not set up yet.")}</p>
        )}
        <form action={setPortal} style={{ marginTop: 12 }}>
          <label className="field">
            <span>{tr("Welcome text on the page (optional)")}</span>
            <input name="welcome" maxLength={500} defaultValue={p?.welcome ?? ""} />
          </label>
          <div className="inline-form" style={{ gap: 6 }}>
            {(!p || !p.enabled) && (
              <SubmitButton className="btn btn-primary" name="enabled" value="1">
                {p ? tr("Switch it on") : tr("Make the link")}
              </SubmitButton>
            )}
            {p?.enabled && (
              <>
                <SubmitButton className="btn" name="enabled" value="1">
                  {tr("Save")}
                </SubmitButton>
                <SubmitButton className="btn" name="enabled" value="0">
                  {tr("Switch it off")}
                </SubmitButton>
              </>
            )}
          </div>
        </form>
        {p && (
          <form action={setPortal} style={{ marginTop: 8 }}>
            <input type="hidden" name="enabled" value={p.enabled ? "1" : "0"} />
            <input type="hidden" name="welcome" value={p.welcome ?? ""} />
            <input type="hidden" name="new" value="1" />
            <SubmitButton className="btn btn-small">{tr("Make a new link (the old one stops working)")}</SubmitButton>
          </form>
        )}
      </section>
      <p className="small muted">{tr("The page shows only your company's name and logo. Each person can send three requests an hour, and the company gets at most 40 a day.")}</p>
    </>
  );
}
