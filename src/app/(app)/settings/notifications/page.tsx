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

export const metadata = { title: "Alerts setup" };
export const dynamic = "force-dynamic";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className="row">
      <span>{label}</span>
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

  return (
    <>
      <p className="small">
        <Link href="/settings">{tr("← Settings")}</Link>
      </p>
      <h1>{tr("Alerts setup")}</h1>
      <p className="muted small">{tr("Notifications always appear in the app (the bell at the top). This page connects the extras: phone notifications and alert emails, and the background job that checks for overdue invoices, expiring stock and so on every 5 minutes.")}</p>
      <Notice {...notice} />

      <section className="card">
        <h2>{tr("Status")}</h2>
        <ul className="list">
          <Check ok={status.secret} label={tr("1. Server key (OUTBOX_SECRET)")} />
          <Check ok={status.push} label={tr("2. Phone notifications (VAPID keys)")} />
          <Check ok={status.email} label={tr("3. Email sending (Resend)")} />
        </ul>
        <p className="small muted">{tr("Last alert check:")}{" "}{checked ? formatDateTime(checked) : tr("never")}</p>
        {status.secret && (
          <form action={runOutboxNow}>
            <SubmitButton className="btn" pendingText={tr("Running…")}>{tr("Run the check and send now")}</SubmitButton>
          </form>
        )}
      </section>

      <section className="card">
        <h2>{tr("1. Server key")}</h2>
        <p className="small">{tr("In")}{" "}<strong>{tr("Supabase → SQL Editor")}</strong>{tr(", run this once (you can use the random text below, or your own of 24+ characters):")}</p>
        <pre className="code">select public.set_outbox_secret(&apos;{suggestedSecret}&apos;);</pre>
        <p className="small">{tr("Then in")}{" "}<strong>{tr("Netlify → Site configuration → Environment variables")}</strong>{tr(", add")}{" "}<code>OUTBOX_SECRET</code>{" "}{tr("with exactly the same text, and redeploy. This lets the server send alerts without any database password.")}</p>
      </section>

      <section className="card">
        <h2>{tr("2. Phone notifications")}</h2>
        <p className="small">{tr("Add two more Netlify variables,")}{" "}<code>VAPID_PUBLIC_KEY</code>{" "}{tr("and")}{" "}<code>VAPID_PRIVATE_KEY</code>{tr(". Generate a pair here (it is not saved anywhere — copy both straight into Netlify, keep the private one secret):")}</p>
        {keys ? (
          <>
            <p className="small">
              <strong>{tr("VAPID_PUBLIC_KEY")}</strong>
            </p>
            <pre className="code">{keys.publicKey}</pre>
            <p className="small">
              <strong>{tr("VAPID_PRIVATE_KEY")}</strong>
            </p>
            <pre className="code">{keys.privateKey}</pre>
            <p className="hint">{tr("If you generate again, the old pair stops working and everyone has to turn notifications on again.")}</p>
          </>
        ) : (
          <Link href="/settings/notifications?keys=1" className="btn">{tr("Generate a key pair")}</Link>
        )}
        <p className="small" style={{ marginTop: 8 }}>{tr("After redeploying, each person opens")}{" "}<Link href="/notifications#settings">{tr("Notifications")}</Link>{" "}{tr("on their phone and taps")}{" "}
          <em>{tr("Turn on notifications on this device")}</em>{tr(". On iPhone the app must first be added to the Home Screen.")}</p>
      </section>

      <section className="card">
        <h2>{tr("3. Alert emails")}</h2>
        <p className="small">{tr("Create a free account at")}{" "}<strong>{tr("resend.com")}</strong>{tr(", add and verify your domain (triumphsuppliers.co.tz), create an API key, and add to Netlify:")}</p>
        <ul className="small">
          <li>
            <code>RESEND_API_KEY</code>{" "}{tr("– the key")}</li>
          <li>
            <code>EMAIL_FROM</code> – e.g. <code>TRIUMPH IMS &lt;alerts@triumphsuppliers.co.tz&gt;</code>
          </li>
        </ul>
        <p className="small muted">{tr("Each person gets at most one email every 5 minutes, listing their new urgent alerts. Anyone can switch emails off for themselves.")}</p>
      </section>
    </>
  );
}
