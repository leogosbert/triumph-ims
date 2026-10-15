import { primeLang, tr } from "@/lib/tr";
import { randomBytes } from "node:crypto";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { requireManager } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { generateVapidKeys, outboxStatus } from "@/lib/outbox";
import { runOutboxNow } from "./actions";
import { SettingsHead } from "../SettingsHead";

export const metadata = { title: "Alerts setup" };
export const dynamic = "force-dynamic";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="row">
      <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{label}</span>
      <span className={`badge ${ok ? "tone-ok" : "tone-warn"}`}>{ok ? tr("Connected") : tr("Not set")}</span>
    </li>
  );
}

export default async function AlertsSetupPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { company } = await requireManager();
  const status = outboxStatus();
  const keys = sp.keys === "1" ? generateVapidKeys() : null;
  const suggestedSecret = randomBytes(24).toString("base64url");
  const checked = (company as { alerts_checked_at?: string | null }).alerts_checked_at;

  const connected = [status.secret, status.push, status.email].filter(Boolean).length;

  return (
    <>
      <SettingsHead
        title={tr("Alerts setup")}
        icon="bell"
        lead={tr("Notifications always appear in the app (the bell at the top). This page connects the extras: phone notifications and alert emails, and the background job that checks for overdue invoices, expiring stock and so on every 5 minutes.")}
        side={<span className={`badge ${connected === 3 ? "tone-ok" : "tone-warn"}`}>{tr("{n} of 3 connected").replace("{n}", String(connected))}</span>}
      />
      <Notice {...notice} />

      <section className="card" id="status">
        <h2>{tr("Status")}</h2>
        <div className="st-progress" aria-hidden>
          <span style={{ width: `${Math.round((connected / 3) * 100)}%` }} />
        </div>
        <ul className="list st-rows">
          <Check ok={status.secret} label={tr("1. Server key (OUTBOX_SECRET)")} />
          <Check ok={status.push} label={tr("2. Phone notifications (VAPID keys)")} />
          <Check ok={status.email} label={tr("3. Email sending (Resend)")} />
        </ul>
        <p className="small muted">{tr("Last alert check:")}{" "}{checked ? formatDateTime(checked) : tr("never")}</p>
        {status.secret && (
          <form action={runOutboxNow}>
            <SubmitButton className="btn btn-block" pendingText={tr("Running…")}>{tr("Run the check and send now")}</SubmitButton>
          </form>
        )}
      </section>

      <section className="card" id="server-key">
        <div className="st-card-head">
          <span className="st-step" aria-hidden>1</span>
          <h2>{tr("Server key")}</h2>
          <span className={`badge ${status.secret ? "tone-ok" : "tone-warn"}`}>{status.secret ? tr("Connected") : tr("Not set")}</span>
        </div>
        <p className="small">{tr("In")}{" "}<strong>Supabase → SQL Editor</strong>{tr(", run this once (you can use the random text below, or your own of 24+ characters):")}</p>
        <pre className="code st-code">select public.set_outbox_secret(&apos;{suggestedSecret}&apos;);</pre>
        <p className="small" style={{ marginBottom: 0 }}>{tr("Then in")}{" "}<strong>Netlify → Site configuration → Environment variables</strong>{tr(", add")}{" "}<code>OUTBOX_SECRET</code>{" "}{tr("with exactly the same text, and redeploy. This lets the server send alerts without any database password.")}</p>
      </section>

      <section className="card" id="push">
        <div className="st-card-head">
          <span className="st-step" aria-hidden>2</span>
          <h2>{tr("Phone notifications")}</h2>
          <span className={`badge ${status.push ? "tone-ok" : "tone-warn"}`}>{status.push ? tr("Connected") : tr("Not set")}</span>
        </div>
        <p className="small">{tr("Add two more Netlify variables,")}{" "}<code>VAPID_PUBLIC_KEY</code>{" "}{tr("and")}{" "}<code>VAPID_PRIVATE_KEY</code>{tr(". Generate a pair here (it is not saved anywhere — copy both straight into Netlify, keep the private one secret):")}</p>
        {keys ? (
          <>
            <p className="small">
              <strong>VAPID_PUBLIC_KEY</strong>
            </p>
            <pre className="code st-code">{keys.publicKey}</pre>
            <p className="small">
              <strong>VAPID_PRIVATE_KEY</strong>
            </p>
            <pre className="code st-code">{keys.privateKey}</pre>
            <p className="hint">{tr("If you generate again, the old pair stops working and everyone has to turn notifications on again.")}</p>
          </>
        ) : (
          <Link href="/settings/notifications?keys=1" className="btn">{tr("Generate a key pair")}</Link>
        )}
        <p className="small" style={{ marginTop: 8, marginBottom: 0 }}>{tr("After redeploying, each person opens")}{" "}<Link href="/notifications#settings">{tr("Notifications")}</Link>{" "}{tr("on their phone and taps")}{" "}
          <em>{tr("Turn on notifications on this device")}</em>{tr(". On iPhone the app must first be added to the Home Screen.")}</p>
      </section>

      <section className="card" id="email">
        <div className="st-card-head">
          <span className="st-step" aria-hidden>3</span>
          <h2>{tr("Alert emails")}</h2>
          <span className={`badge ${status.email ? "tone-ok" : "tone-warn"}`}>{status.email ? tr("Connected") : tr("Not set")}</span>
        </div>
        <p className="small">{tr("Create a free account at")}{" "}<strong>resend.com</strong>{tr(", add and verify your domain (triumphsuppliers.co.tz), create an API key, and add to Netlify:")}</p>
        <ul className="small" style={{ overflowWrap: "anywhere" }}>
          <li>
            <code>RESEND_API_KEY</code>{" "}{tr("– the key")}</li>
          <li>
            <code>EMAIL_FROM</code> – e.g. <code>TRIUMPH Alerts &lt;alerts@triumphsuppliers.co.tz&gt;</code>
          </li>
        </ul>
        <p className="small muted" style={{ marginBottom: 0 }}>{tr("Each person gets at most one email every 5 minutes, listing their new urgent alerts. Anyone can switch emails off for themselves.")}</p>
      </section>
    </>
  );
}
