import type { SupabaseClient } from "@supabase/supabase-js";
import { inboxAdmin, sendEmailReply } from "@/lib/inbox/server";
import { GRAPH_VERSION, sendWhatsAppText, waDigits } from "@/lib/inbox/whatsapp";
import { payLinkUrl } from "./common";
import { reminderHtml, reminderSms, reminderSubject, reminderText, type ReminderData, type ReminderLang } from "./reminder-text";
import { sendBeemSms } from "./sms-beem";
import { vfdEnv, vfdPostReceipt, vfdPostZReport, vfdRegister, vfdToken, type ReceiptJob, type VfdEnv, type ZJob } from "./tra-vfd";

/**
 * The server jobs of "Getting paid" (called by /api/money/cron every 15 minutes and from the screens).
 * They use the service role (inboxAdmin) and the secrets in the environment; nothing here reaches the browser.
 */

type VfdConfig = {
  settings: { company_id: string; mode: string; tin: string | null; cert_serial: string | null; vfd_serial: string | null; reg_id: string | null; routing_key: string | null };
  secrets: { vfd_username: string | null; vfd_password: string | null; access_token: string | null; token_expires_at: string | null } | null;
};

const tokenPath = () => process.env.TRA_VFD_TOKEN_PATH?.trim() || "/vfdtoken";

/** A valid TRA token for the company (asks TRA for a new one when it is missing or about to expire). */
async function tokenFor(db: SupabaseClient, v: VfdEnv, companyId: string): Promise<{ ok: true; token: string; cfg: VfdConfig } | { ok: false; error: string }> {
  const { data, error } = await db.rpc("fiscal_vfd_config", { p_company: companyId });
  if (error || !data) return { ok: false, error: error?.message ?? "No TRA settings." };
  const cfg = data as VfdConfig;
  const s = cfg.secrets;
  if (s?.access_token && s.token_expires_at && Date.parse(s.token_expires_at) > Date.now() + 60_000) return { ok: true, token: s.access_token, cfg };
  if (!s?.vfd_username || !s.vfd_password) return { ok: false, error: "Not registered with TRA yet (press Register)." };
  const t = await vfdToken(v, s.vfd_username, s.vfd_password, tokenPath());
  if (!t.ok) return t;
  await db.rpc("fiscal_save_token", { p_company: companyId, p_token: t.token, p_expires_at: t.expiresAt.toISOString() });
  return { ok: true, token: t.token, cfg };
}

/** Sends queued receipts and Z reports to TRA. Does nothing until TRA_VFD_* are set. */
export async function runFiscalQueue(limit = 20): Promise<{ status: string; posted: number; failed: number }> {
  const v = vfdEnv();
  const db = inboxAdmin();
  if (!v || !db) return { status: "not_configured", posted: 0, failed: 0 };
  const { data, error } = await db.rpc("fiscal_claim", { p_limit: limit });
  if (error) return { status: `error: ${error.message}`, posted: 0, failed: 0 };
  const jobs = (data ?? []) as ({ job: "receipt"; settings: VfdConfig["settings"] } & ReceiptJob | { job: "zreport"; settings: VfdConfig["settings"] & ZJob["settings"] } & ZJob)[];
  let posted = 0;
  let failed = 0;
  const tokens = new Map<string, Awaited<ReturnType<typeof tokenFor>>>();
  for (const j of jobs) {
    const id = j.job === "receipt" ? j.receipt.id : j.zreport.id;
    const companyId = j.settings.company_id;
    const fail = async (msg: string, code: string | null = null, ackMsg: string | null = null) => {
      failed++;
      await db.rpc("fiscal_result", { p_job: j.job, p_id: id, p_ok: false, p_ack_code: code, p_ack_message: ackMsg, p_error: msg });
    };
    // The certificate on this server belongs to one TIN: no other company may post with it.
    if ((j.settings.tin ?? "") !== v.tin) {
      await fail("The TRA certificate on the server belongs to another TIN.");
      continue;
    }
    if (!j.settings.cert_serial) {
      await fail("The certificate serial is missing (TRA receipts settings).");
      continue;
    }
    if (!tokens.has(companyId)) tokens.set(companyId, await tokenFor(db, v, companyId));
    const tok = tokens.get(companyId)!;
    if (!tok.ok) {
      await fail(tok.error);
      continue;
    }
    try {
      const ack =
        j.job === "receipt"
          ? await vfdPostReceipt(v, tok.token, j.settings.cert_serial, j.settings.routing_key ?? "vfdrct", j)
          : await vfdPostZReport(v, tok.token, j.settings.cert_serial, j);
      if (ack.httpStatus === 401) tokens.delete(companyId);
      if (ack.ok) {
        posted++;
        await db.rpc("fiscal_result", { p_job: j.job, p_id: id, p_ok: true, p_ack_code: ack.code, p_ack_message: ack.message, p_error: null });
      } else {
        const why = ack.signatureOk === false ? "TRA's answer did not carry a valid TRA signature." : ack.message ?? `TRA: HTTP ${ack.httpStatus}`;
        await fail(why, ack.code, ack.message);
      }
    } catch (e) {
      await fail(`TRA: ${(e as Error).message}`.slice(0, 300));
    }
  }
  return { status: "ok", posted, failed };
}

/** Registers the company's VFD with TRA (once, after the settings are saved). */
export async function vfdRegisterCompany(companyId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = vfdEnv();
  const db = inboxAdmin();
  if (!v) return { ok: false, error: "VFD is not set up on the server (TRA_VFD_PRIVATE_KEY and TRA_VFD_TIN)." };
  if (!db) return { ok: false, error: "The server is missing SUPABASE_SERVICE_ROLE_KEY." };
  const { data, error } = await db.rpc("fiscal_vfd_config", { p_company: companyId });
  if (error || !data) return { ok: false, error: "Save the TRA settings first." };
  const cfg = data as VfdConfig;
  if (cfg.settings.mode !== "vfd") return { ok: false, error: "Choose VFD first." };
  if (cfg.settings.tin !== v.tin) return { ok: false, error: "The TRA certificate on the server belongs to another TIN." };
  if (!cfg.settings.cert_serial || !cfg.settings.vfd_serial) return { ok: false, error: "Enter the certificate serial and the VFD serial first." };
  try {
    const r = await vfdRegister(v, cfg.settings.cert_serial, cfg.settings.vfd_serial);
    if (r.ackCode !== "0" || !r.reg_id || !r.username || !r.password) {
      return { ok: false, error: `TRA did not register the device: ${r.ackMessage ?? `HTTP ${r.httpStatus}`}`.slice(0, 300) };
    }
    const save = await db.rpc("fiscal_save_registration", {
      p_company: companyId,
      p: {
        reg_id: r.reg_id,
        uin: r.uin,
        receipt_code: r.receipt_code,
        serial: r.serial,
        tax_office: r.tax_office,
        routing_key: r.routing_key,
        gc: r.gc,
        username: r.username,
        password: r.password,
      },
    });
    if (save.error) return { ok: false, error: save.error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `TRA: ${(e as Error).message}`.slice(0, 300) };
  }
}

// ---------------------------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------------------------
export type ReminderJob = {
  id: string;
  channel: "email" | "sms" | "whatsapp";
  to: string;
  language: ReminderLang;
  step: number;
  company: { id: string; name: string; phone: string | null; email: string | null; bank_details: string | null; mobile_money_details: string | null };
  invoice: { id: string; number: string; currency: string; total: number; paid: number; balance: number; due_date: string; contact_name: string | null };
  client: { id: string; name: string };
  pay_code: string | null;
  whatsapp_phone_number_id: string | null;
  reply_to: string | null;
};

export function reminderData(j: ReminderJob): ReminderData {
  return {
    companyName: j.company.name,
    companyPhone: j.company.phone,
    clientName: j.client.name,
    contactName: j.invoice.contact_name,
    invoiceNumber: j.invoice.number,
    currency: j.invoice.currency,
    balance: Number(j.invoice.balance),
    dueDate: j.invoice.due_date,
    step: j.step,
    payUrl: j.pay_code ? payLinkUrl(j.pay_code) : null,
    bankDetails: j.company.bank_details,
    mobileMoneyDetails: j.company.mobile_money_details,
  };
}

/**
 * The WhatsApp template body (an approved template is needed outside the 24-hour window).
 * WHATSAPP_REMINDER_TEMPLATE names it; its body takes {{1}} client, {{2}} invoice, {{3}} amount,
 * {{4}} due date, {{5}} pay link. WHATSAPP_REMINDER_LANG is its language code (default en).
 */
export function whatsappTemplateBody(to: string, template: string, lang: string, d: ReminderData) {
  const amount = `${d.currency} ${Math.round(d.balance).toLocaleString("en-GB")}`;
  return {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: lang },
      components: [
        {
          type: "body",
          parameters: [d.contactName || d.clientName, d.invoiceNumber, amount, d.dueDate, d.payUrl ?? "-"].map((text) => ({ type: "text", text: String(text).slice(0, 200) })),
        },
      ],
    },
  };
}

async function sendWhatsAppTemplate(phoneNumberId: string, to: string, d: ReminderData): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const token = process.env.WHATSAPP_TOKEN ?? "";
  const template = process.env.WHATSAPP_REMINDER_TEMPLATE?.trim() ?? "";
  const digits = waDigits(to);
  if (!token) return { ok: false, error: "WhatsApp is not connected." };
  if (!digits) return { ok: false, error: "The phone number is not valid." };
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(whatsappTemplateBody(digits, template, process.env.WHATSAPP_REMINDER_LANG?.trim() || "en", d)),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string } };
    if (!res.ok || !json.messages?.[0]?.id) return { ok: false, error: (json.error?.message ?? `HTTP ${res.status}`).slice(0, 300) };
    return { ok: true, id: json.messages[0].id! };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 300) };
  }
}

async function sendOne(j: ReminderJob): Promise<{ ok: boolean | null; id: string | null; error: string | null; body: string }> {
  const d = reminderData(j);
  if (j.channel === "sms") {
    const body = reminderSms(d, j.language);
    const r = await sendBeemSms(j.to, body);
    return r.ok ? { ok: true, id: r.id, error: null, body } : { ok: false, id: null, error: r.error, body };
  }
  if (j.channel === "whatsapp") {
    const body = reminderText(d, j.language);
    if (!j.whatsapp_phone_number_id) return { ok: false, id: null, error: "WhatsApp is not connected for this company (Inbox settings).", body };
    const r = process.env.WHATSAPP_REMINDER_TEMPLATE?.trim()
      ? await sendWhatsAppTemplate(j.whatsapp_phone_number_id, j.to, d)
      : await sendWhatsAppText(j.whatsapp_phone_number_id, j.to, body);
    return r.ok ? { ok: true, id: r.id, error: null, body } : { ok: false, id: null, error: r.error, body };
  }
  const body = reminderText(d, j.language);
  const r = await sendEmailReply(
    {
      to: [j.to],
      cc: [],
      subject: reminderSubject(d, j.language),
      text: body,
      html: reminderHtml(d, j.language),
      replyTo: j.reply_to ?? j.company.email,
      fromName: j.company.name,
      inReplyTo: null,
      references: [],
    },
    j.reply_to,
  );
  return r.ok ? { ok: true, id: r.id, error: null, body } : { ok: false, id: null, error: r.error, body };
}

/**
 * Sends the reminders that are due now. REMINDERS_DRY_RUN=1 writes them to the log as "Not sent"
 * without sending anything (to try the schedule first).
 */
export async function runReminders(limit = 50, budgetMs = 20_000): Promise<{ status: string; sent: number; failed: number; skipped: number }> {
  const db = inboxAdmin();
  if (!db) return { status: "not_configured", sent: 0, failed: 0, skipped: 0 };
  const started = Date.now();
  const { data, error } = await db.rpc("reminder_claim", { p_limit: limit, p_at: new Date().toISOString() });
  if (error) return { status: `error: ${error.message}`, sent: 0, failed: 0, skipped: 0 };
  const jobs = (data ?? []) as ReminderJob[];
  const dry = process.env.REMINDERS_DRY_RUN === "1";
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const j of jobs) {
    if (Date.now() - started > budgetMs) break; // the rest are retried after 30 minutes
    if (dry) {
      const d = reminderData(j);
      await db.rpc("reminder_mark", {
        p_id: j.id,
        p_ok: null,
        p_provider_id: null,
        p_error: "Trial run (REMINDERS_DRY_RUN): not sent",
        p_body: j.channel === "sms" ? reminderSms(d, j.language) : reminderText(d, j.language),
      });
      skipped++;
      continue;
    }
    const r = await sendOne(j);
    await db.rpc("reminder_mark", { p_id: j.id, p_ok: r.ok, p_provider_id: r.id, p_error: r.error, p_body: r.body });
    if (r.ok) sent++;
    else failed++;
  }
  return { status: "ok", sent, failed, skipped };
}
