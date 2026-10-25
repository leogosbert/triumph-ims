import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/format";
import { REMINDER_CHANNELS, REMINDER_STATUS, stepLabel } from "@/lib/getpaid/common";
import { reminderSms, reminderText, type ReminderLang } from "@/lib/getpaid/reminder-text";
import { beemConfigured } from "@/lib/getpaid/sms-beem";
import { inboxChannels } from "@/lib/inbox/server";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";
import { primeLang, tr } from "@/lib/tr";
import { saveReminderSettings, sendRemindersNow, setClientReminders } from "../actions";
import { FeatureOff, GetPaidTabs, Ready } from "../parts";

export const metadata = { title: "Automatic reminders" };

type Settings = { enabled: boolean; schedule: number[]; channels: string[]; send_hour: number; language: ReminderLang; include_pay_link: boolean; min_balance: number };
type Upcoming = { invoice_id: string; number: string; client: string; due_date: string; balance: number; currency: string; step: number; send_on: string; blocked: string | null };
type Log = { id: string; step: number; channel: string; recipient: string | null; status: string; error: string | null; created_at: string; sent_at: string | null; invoice: { id: string; number: string } | null };
type Client = { id: string; name: string; reminders_opt_out: boolean; reminder_language: string | null };

const DEFAULTS: Settings = { enabled: false, schedule: [-3, 0, 7, 14], channels: ["email"], send_hour: 9, language: "en", include_pay_link: true, min_balance: 0 };

export default async function RemindersPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role, isManager, features } = await getAppContext();
  if (!can(role, "seeFinance")) redirect("/");

  const [setRes, upRes, logRes, optRes, wa] = await Promise.all([
    supabase.from("reminder_settings").select("*").eq("company_id", company.id).maybeSingle(),
    supabase.rpc("reminder_upcoming", { p_company: company.id, p_days: 14 }),
    supabase
      .from("reminder_log")
      .select("id, step, channel, recipient, status, error, created_at, sent_at, invoice:invoices(id, number)")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("clients").select("id, name, reminders_opt_out, reminder_language").eq("company_id", company.id).order("name").limit(500),
    supabase.from("inbox_settings").select("whatsapp_phone_number_id").eq("company_id", company.id).maybeSingle(),
  ]);
  if (isMissingTable(setRes.error)) return <NotReady title="Automatic reminders" />;
  const s: Settings = { ...DEFAULTS, ...((setRes.data as Partial<Settings> | null) ?? {}) };
  const upcoming = (upRes.data ?? []) as Upcoming[];
  const log = (logRes.data ?? []) as unknown as Log[];
  const clients = (optRes.data ?? []) as Client[];
  const special = clients.filter((c) => c.reminders_opt_out || c.reminder_language);
  const ch = inboxChannels();
  const waReady = ch.whatsappSend && Boolean((wa.data as { whatsapp_phone_number_id?: string | null } | null)?.whatsapp_phone_number_id);

  const sample = upcoming[0];
  const sampleData = {
    companyName: company.name,
    companyPhone: company.phone ?? null,
    clientName: sample?.client ?? "Client Ltd",
    contactName: null,
    invoiceNumber: sample?.number ?? "INV-2026-0001",
    currency: sample?.currency ?? "TZS",
    balance: Number(sample?.balance ?? 1250000),
    dueDate: sample?.due_date ?? todayTz(),
    step: sample?.step ?? 0,
    payUrl: s.include_pay_link && features.on("pay_links") ? "https://…/pay/…" : null,
    bankDetails: company.bank_details ?? null,
    mobileMoneyDetails: company.mobile_money_details ?? null,
  };

  return (
    <>
      <h1>{tr("Automatic reminders")}</h1>
      <p className="muted">{tr("Polite payment reminders go to clients on the days you choose, by email, SMS or WhatsApp, with the pay link.")}</p>
      <Notice msg={notice.msg} error={notice.error} />
      <GetPaidTabs current="/getting-paid/reminders" />
      {!features.on("auto_reminders") && <FeatureOff name="Automatic payment reminders" isManager={isManager} />}

      <section className="card">
        <h2>{tr("Settings")}</h2>
        <form action={saveReminderSettings}>
          <fieldset disabled={!isManager} style={{ border: 0, padding: 0, margin: 0 }}>
            <label className="check">
              <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> <strong>{tr("Send reminders automatically")}</strong>
            </label>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="schedule">
                  {tr("Days from the due date")} <span className="hint">· {tr("minus = before, e.g. -3, 0, 7, 14")}</span>
                </label>
                <input id="schedule" name="schedule" type="text" defaultValue={s.schedule.join(", ")} />
              </div>
              <div className="field">
                <label htmlFor="send_hour">{tr("Send from")}</label>
                <select id="send_hour" name="send_hour" defaultValue={String(s.send_hour)}>
                  {Array.from({ length: 11 }, (_, i) => i + 8).map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="language">{tr("Language")}</label>
                <select id="language" name="language" defaultValue={s.language}>
                  <option value="en">{tr("English")}</option>
                  <option value="sw">{tr("Kiswahili")}</option>
                  <option value="both">{tr("Both")}</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="min_balance">{tr("Do not remind below")}</label>
                <input id="min_balance" name="min_balance" type="text" inputMode="decimal" defaultValue={String(s.min_balance ?? 0)} />
              </div>
            </div>
            <div className="field">
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{tr("Send by")}</span>
              {Object.entries(REMINDER_CHANNELS).map(([k, label]) => (
                <label key={k} className="check">
                  <input type="checkbox" name="channels" value={k} defaultChecked={s.channels.includes(k)} /> {tr(label)}
                </label>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" name="include_pay_link" defaultChecked={s.include_pay_link} /> {tr("Include the pay link")}
            </label>
            {isManager && <SubmitButton pendingText={tr("Saving…")}>{tr("Save")}</SubmitButton>}
          </fieldset>
        </form>
        <ul className="list" style={{ marginTop: 12 }}>
          <Ready ok={ch.emailSend} label="Email sending" hint="RESEND_API_KEY and EMAIL_FROM (or the company mailbox) in Netlify." />
          <Ready ok={beemConfigured()} label="SMS (Beem)" hint="BEEM_API_KEY, BEEM_SECRET and BEEM_SENDER_ID in Netlify." />
          <Ready ok={waReady} label="WhatsApp" hint="Connect WhatsApp in the Inbox settings. Outside 24 hours after the client's last message WhatsApp needs an approved template (WHATSAPP_REMINDER_TEMPLATE)." />
        </ul>
        <p className="small muted">{tr("Reminders go out between the hour above and 20:00. A promised payment date pauses them. Clients and invoices marked Do not remind are skipped.")}</p>
        {isManager && (
          <form action={sendRemindersNow}>
            <SubmitButton className="btn" pendingText={tr("Sending…")}>{tr("Send the reminders due now")}</SubmitButton>
          </form>
        )}
      </section>

      <details className="card">
        <summary>
          <strong>{tr("Preview")}</strong>
        </summary>
        <p className="small muted">{tr("Email and WhatsApp")}</p>
        <pre className="small" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{reminderText(sampleData, s.language)}</pre>
        <p className="small muted">{tr("SMS")}</p>
        <pre className="small" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{reminderSms(sampleData, s.language)}</pre>
      </details>

      <section className="card">
        <h2>{tr("Coming up (14 days)")}</h2>
        {upcoming.length === 0 ? (
          <p className="muted small">{tr("No reminders due in the next 14 days.")}</p>
        ) : (
          <ul className="list">
            {upcoming.slice(0, 60).map((u) => (
              <li key={`${u.invoice_id}:${u.step}`}>
                <div className="row">
                  <span>
                    {formatDate(u.send_on)} · <Link href={`/invoices/${u.invoice_id}`}>{u.number}</Link> · {u.client} · {formatMoney(u.balance, u.currency)}
                    <div className="small muted">{tr(stepLabel(u.step))}</div>
                  </span>
                  {u.blocked ? <span className="badge tone-off">{tr(u.blocked)}</span> : <span className="badge tone-info">{tr("Will be sent")}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>{tr("Reminder log")}</h2>
        {log.length === 0 ? (
          <p className="muted small">{tr("No reminders sent yet.")}</p>
        ) : (
          <ul className="list">
            {log.map((l) => (
              <li key={l.id}>
                <div className="row">
                  <span>
                    {formatDateTime(l.sent_at ?? l.created_at)} · {l.invoice ? <Link href={`/invoices/${l.invoice.id}`}>{l.invoice.number}</Link> : "—"} · {tr(REMINDER_CHANNELS[l.channel] ?? l.channel)}
                    {l.recipient ? ` · ${l.recipient}` : ""}
                    <div className="small muted">{tr(stepLabel(l.step))}</div>
                  </span>
                  <StatusBadge map={REMINDER_STATUS} status={l.status} />
                </div>
                {l.error ? <div className="small text-warn">{l.error}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>{tr("Clients")}</h2>
        {special.length > 0 && (
          <ul className="list">
            {special.map((c) => (
              <li key={c.id}>
                <div className="row">
                  <span>
                    <Link href={`/clients/${c.id}`}>{c.name}</Link> ·{" "}
                    <span className="small muted">
                      {c.reminders_opt_out ? tr("Do not remind") : ""}
                      {c.reminders_opt_out && c.reminder_language ? " · " : ""}
                      {c.reminder_language ? tr(c.reminder_language === "sw" ? "Kiswahili" : c.reminder_language === "both" ? "Both" : "English") : ""}
                    </span>
                  </span>
                  <form action={setClientReminders}>
                    <input type="hidden" name="client_id" value={c.id} />
                    <input type="hidden" name="opt_out" value="0" />
                    <SubmitButton className="btn btn-small" pendingText="…">{tr("Back to normal")}</SubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
        {clients.length > 0 && (
          <form action={setClientReminders} style={{ marginTop: 12 }}>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="client_id">{tr("Client")}</label>
                <select id="client_id" name="client_id" required defaultValue="">
                  <option value="" disabled>
                    {tr("Choose a client")}
                  </option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="client_language">{tr("Language")}</label>
                <select id="client_language" name="language" defaultValue="">
                  <option value="">{tr("As the company setting")}</option>
                  <option value="en">{tr("English")}</option>
                  <option value="sw">{tr("Kiswahili")}</option>
                  <option value="both">{tr("Both")}</option>
                </select>
              </div>
            </div>
            <label className="check">
              <input type="checkbox" name="opt_out" value="1" /> {tr("The client asked not to be reminded")}
            </label>
            <SubmitButton className="btn" pendingText={tr("Saving…")}>{tr("Save for this client")}</SubmitButton>
          </form>
        )}
      </section>
    </>
  );
}
