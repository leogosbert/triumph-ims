import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext, noAccess } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { canUseInbox, suggestInboxAddress, type InboxSettings } from "@/lib/inbox/common";
import { formatDateTime } from "@/lib/format";
import { inboxChannels } from "@/lib/inbox/server";
import { readNotice, type SearchParams } from "@/lib/messages";
import { siteUrl } from "@/lib/supabase/env";
import { checkMailboxNow, saveInboxSettings } from "../actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Inbox setup" };

function Status({ on, label }: { on: boolean; label: string }) {
  return (
    <li style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
      <span>{tr(label)}</span>
      <span className={`badge ${on ? "tone-ok" : "tone-off"}`}>{on ? tr("connected") : tr("not yet")}</span>
    </li>
  );
}

const code: React.CSSProperties = { overflowWrap: "anywhere", wordBreak: "break-all" };

export default async function InboxSetupPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, isManager } = await getAppContext();
  if (!canUseInbox(roles)) noAccess();
  const { data, error } = await supabase.from("inbox_settings").select("*").eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Inbox setup" />;
  const s = (data ?? null) as (InboxSettings & { mailbox_checked_at?: string | null; mailbox_error?: string | null }) | null;
  const ch = inboxChannels();
  const site = siteUrl();
  const suggested = ch.mailbox ?? suggestInboxAddress(company.name, ch.inboundDomain);
  const mailboxOurs = Boolean(ch.mailbox && s?.inbound_address === ch.mailbox);
  const waEnv = process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";

  return (
    <>
      <BackLink href="/inbox" label="Inbox" />
      <h1>{tr("Inbox setup")}</h1>
      <p className="muted small">
        {tr("When a client or supplier emails your company address or sends a WhatsApp to your business number, the message appears in the Inbox and management and sales get a notification on their phones. You reply from the app.")}
      </p>
      <Notice {...notice} />

      <section className="card">
        <h2>{tr("What is connected")}</h2>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }} className="small">
          <Status on={ch.database} label="Server key for the inbox (SUPABASE_SERVICE_ROLE_KEY)" />
          <Status on={mailboxOurs} label="Company mailbox (reads and sends from your own email)" />
          <Status on={ch.emailReceive && Boolean(s?.inbound_address)} label="Receiving emails" />
          <Status on={ch.emailSend} label="Sending email replies" />
          <Status on={ch.whatsappReceive && Boolean(s?.whatsapp_phone_number_id)} label="Receiving WhatsApp messages" />
          <Status on={ch.whatsappSend && Boolean(s?.whatsapp_phone_number_id)} label="Sending WhatsApp from the app" />
        </ul>
        <p className="small muted">
          {tr("Without WhatsApp Business connected you can still answer: the app opens WhatsApp on your phone with the text filled in, and notes it in the conversation.")}
        </p>
      </section>

      {ch.mailbox && (
        <section className="card">
          <h2>{tr("Company mailbox")}</h2>
          <p className="small">
            {tr("The server is set up to read and send from")} <strong style={code}>{ch.mailbox}</strong>.{" "}
            {mailboxOurs
              ? tr("New emails there are brought into the Inbox every 5 minutes; nothing is deleted or marked as read in the mailbox.")
              : tr("Save this address as your inbox email address below to use it for this company.")}
          </p>
          {mailboxOurs && (
            <p className="small muted">
              {s?.mailbox_checked_at ? `${tr("Last checked")} ${formatDateTime(s.mailbox_checked_at)}` : tr("Not checked yet.")}
              {s?.mailbox_error && <span className="text-warn"> · {s.mailbox_error}</span>}
            </p>
          )}
          {mailboxOurs && isManager && (
            <form action={checkMailboxNow}>
              <SubmitButton className="btn btn-small" pendingText={tr("Checking…")}>
                {tr("Check for new emails now")}
              </SubmitButton>
            </form>
          )}
        </section>
      )}

      <section className="card">
        <h2>{tr("Your company's inbox")}</h2>
        {isManager ? (
          <form action={saveInboxSettings}>
            <div className="field">
              <label htmlFor="s-address">{tr("Inbox email address")}</label>
              <input
                id="s-address"
                name="inbound_address"
                type="email"
                inputMode="email"
                maxLength={120}
                defaultValue={s?.inbound_address ?? suggested ?? ""}
                placeholder={ch.inboundDomain ? `name@${ch.inboundDomain}` : "info@yourcompany.co.tz"}
              />
              <p className="small muted">
                {tr("Emails sent to this address come into the Inbox. It must be on the receiving domain set up in Resend")}
                {ch.inboundDomain ? ` (${ch.inboundDomain})` : ""}.
              </p>
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="s-wa">{tr("WhatsApp phone number ID")}</label>
                <input id="s-wa" name="whatsapp_phone_number_id" type="text" inputMode="numeric" maxLength={30} defaultValue={s?.whatsapp_phone_number_id ?? waEnv} placeholder="1098765432…" />
              </div>
              <div className="field">
                <label htmlFor="s-wa-phone">{tr("WhatsApp business number")}</label>
                <input id="s-wa-phone" name="whatsapp_display_phone" type="tel" maxLength={40} defaultValue={s?.whatsapp_display_phone ?? ""} placeholder="+255 7xx xxx xxx" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="s-name">{tr("Name shown on emails")}</label>
              <input id="s-name" name="reply_name" type="text" maxLength={80} defaultValue={s?.reply_name ?? company.name} />
            </div>
            <div className="field">
              <label htmlFor="s-sig">{tr("Signature under email replies")}</label>
              <textarea id="s-sig" name="signature" rows={3} maxLength={1000} defaultValue={s?.signature ?? ""} placeholder={`${company.name}\n${company.phone ?? ""}`} />
            </div>
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        ) : (
          <p className="small">
            {tr("Inbox email address")}: <strong style={code}>{s?.inbound_address ?? "—"}</strong>
            <br />
            {tr("WhatsApp business number")}: <strong>{s?.whatsapp_display_phone ?? "—"}</strong>
            <br />
            <span className="muted">{tr("Only management can change these.")}</span>
          </p>
        )}
      </section>

      <details className="card" open={!ch.emailReceive}>
        <summary>{tr("Quickest: use the email you already have (no own domain needed)")}</summary>
        <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.55 }}>
          <li>
            {tr("Pick the mailbox clients already write to, for example your company Gmail. In Gmail: Google account → Security → turn on 2-Step Verification, then App passwords → create one called LeMoSp. (Outlook and most hosting mail work the same way; ask your email provider for the SMTP and IMAP server names.)")}
          </li>
          <li>
            {tr("In Netlify → Site configuration → Environment variables, add:")}
            <ul style={{ paddingLeft: 18 }}>
              <li><code>SMTP_HOST</code> — {tr("e.g.")} <code>smtp.gmail.com</code>; <code>SMTP_PORT</code> — <code>465</code></li>
              <li><code>SMTP_USER</code> — {tr("the full email address")}; <code>SMTP_PASS</code> — {tr("the app password")}</li>
              <li><code>SMTP_FROM</code> — {tr("optional, e.g.")} <code>Triumph Sales &lt;yourname@gmail.com&gt;</code></li>
              <li><code>IMAP_HOST</code> — {tr("e.g.")} <code>imap.gmail.com</code> ({tr("optional when it is the SMTP name with imap. in front")})</li>
              <li><code>SUPABASE_SERVICE_ROLE_KEY</code> {tr("and")} <code>OUTBOX_SECRET</code> ({tr("already there if phone alerts work")})</li>
            </ul>
            {tr("Then redeploy the site (Deploys → Trigger deploy).")}
          </li>
          <li>{tr("Come back here and save the same email address as your inbox email address. Press Check for new emails now to try it.")}</li>
          <li>
            {tr("From then on the app reads new emails every 5 minutes (it never deletes or marks them read), tells management and sales, and replies go out from that same mailbox, so they also appear in its Sent folder.")}
          </li>
        </ol>
        <p className="small muted">{tr("The password stays on the server; the app and your team never see it.")}</p>
      </details>

      <details className="card">
        <summary>{tr("Or: receive through Resend (instant, needs a receiving domain)")}</summary>
        <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.55 }}>
          <li>
            {tr("Database: LeMo Tech runs the inbox update once in Supabase → SQL Editor")} (<code style={code}>supabase/migrations/20261026000200_inbox.sql</code>).
          </li>
          <li>
            {tr("Open resend.com (the same account that sends your alerts). Go to Emails → Receiving. Resend gives you a receiving address domain like")}{" "}
            <code style={code}>abc123.resend.app</code>. {tr("You can start with it today, before you have your own domain.")}
          </li>
          <li>
            {tr("Later, with your own domain (for example yourcompany.co.tz, bought from a .tz registrar): in Resend → Domains add it and copy the DNS records Resend shows into your domain's DNS: the TXT records (SPF and DKIM) let the app send from your domain, and the MX record brings mail in. If your normal email (Gmail, Outlook) already uses the main domain, add the MX record on a sub-domain such as")}{" "}
            <code style={code}>in.yourcompany.co.tz</code> {tr("so your current mailbox keeps working.")}
          </li>
          <li>
            {tr("In Resend → Webhooks → Add endpoint, paste this address and choose the event email.received:")}
            <br />
            <code style={code}>{site}/api/inbound/email</code>
            <br />
            {tr("Then copy the Signing secret (it starts with whsec_).")}
          </li>
          <li>
            {tr("In Netlify → Site configuration → Environment variables, add:")}
            <ul style={{ paddingLeft: 18 }}>
              <li><code>RESEND_WEBHOOK_SECRET</code> — {tr("the signing secret")}</li>
              <li><code>SUPABASE_SERVICE_ROLE_KEY</code> — {tr("Supabase → Project settings → API keys → service_role (keep it secret)")}</li>
              <li><code>INBOUND_EMAIL_DOMAIN</code> — {tr("the receiving domain, e.g.")} <code style={code}>abc123.resend.app</code></li>
              <li><code>RESEND_API_KEY</code>, <code>EMAIL_FROM</code> — {tr("already there if alerts are emailed; the domain of EMAIL_FROM must be verified in Resend")}</li>
            </ul>
            {tr("Then redeploy the site (Deploys → Trigger deploy).")}
          </li>
          <li>{tr("Come back here, save your inbox email address above, and send a test email to it from your phone.")}</li>
          <li>
            {tr("Tell clients the address, put it on your quotations, or set your current mailbox to forward to it. Replies from the app carry a reply address that brings the client's answer back to the same conversation.")}
          </li>
        </ol>
      </details>

      <details className="card" open={ch.emailReceive && !ch.whatsappReceive}>
        <summary>{tr("Step by step: WhatsApp Business")}</summary>
        <ol className="small" style={{ paddingLeft: 18, lineHeight: 1.55 }}>
          <li>{tr("Create or open your Meta Business account at business.facebook.com and verify the business.")}</li>
          <li>
            {tr("At developers.facebook.com create an app (type Business) and add the WhatsApp product. Add your business phone number and verify it with the SMS code. The number cannot be used in the normal WhatsApp app at the same time.")}
          </li>
          <li>{tr("In WhatsApp → API setup copy the Phone number ID and save it above.")}</li>
          <li>
            {tr("Make a permanent access token: Business settings → Users → System users → Add, give it the app, then Generate token with the permissions whatsapp_business_messaging and whatsapp_business_management.")}
          </li>
          <li>{tr("In App settings → Basic copy the App secret.")}</li>
          <li>
            {tr("In WhatsApp → Configuration → Webhook press Edit. Callback URL:")}
            <br />
            <code style={code}>{site}/api/inbound/whatsapp</code>
            <br />
            {tr("Verify token: any long random text, the same as WHATSAPP_VERIFY_TOKEN below. Press Verify and save, then subscribe to the field messages.")}
          </li>
          <li>
            {tr("In Netlify add:")} <code>WHATSAPP_TOKEN</code>, <code>WHATSAPP_APP_SECRET</code>, <code>WHATSAPP_VERIFY_TOKEN</code>{" "}
            {tr("(and optionally")} <code>WHATSAPP_PHONE_NUMBER_ID</code>), {tr("then redeploy. Add the verify token before pressing Verify in Meta.")}
          </li>
          <li>
            {tr("WhatsApp allows free replies from the app for 24 hours after the customer's last message. After that, use Open WhatsApp (or an approved template). Meta may charge for conversations beyond the free allowance.")}
          </li>
        </ol>
      </details>
    </>
  );
}
