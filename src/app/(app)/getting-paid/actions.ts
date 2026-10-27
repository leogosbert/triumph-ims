"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { can } from "@/lib/roles";
import { parseSchedule } from "@/lib/getpaid/common";
import { runFiscalQueue, runReminders, vfdRegisterCompany } from "@/lib/getpaid/jobs";
import { parseStatement } from "@/lib/getpaid/statement-parse";

const isId = (v: string | null | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Comes back to the screen it was sent from (only paths inside the app). */
function backTo(form: FormData, fallback: string): string {
  const b = str(form, "back");
  return /^\/(getting-paid|invoices|clients)(\/|$|\?)/.test(b) && !b.startsWith("//") ? b : fallback;
}

/** withNotice, keeping a #section at the end. */
function noticeUrl(path: string, n: { msg?: string; error?: string }): string {
  const [p, hash] = path.split("#");
  return withNotice(p, n) + (hash ? `#${hash}` : "");
}

function fail(path: string, message: string): never {
  redirect(noticeUrl(path, { error: friendlyError(message) }));
}

function done(path: string, msg: string): never {
  revalidatePath("/getting-paid", "layout");
  revalidatePath("/invoices", "layout");
  redirect(noticeUrl(path, { msg }));
}

// ------------------------------------------------------------------ TRA receipts

export async function saveFiscalSettings(form: FormData) {
  const path = "/getting-paid/tra";
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.rpc("fiscal_save_settings", {
    p_company: company.id,
    p: {
      mode: str(form, "mode") === "vfd" ? "vfd" : "manual",
      environment: str(form, "environment") === "live" ? "live" : "test",
      tin: str(form, "tin"),
      vrn: str(form, "vrn"),
      cert_serial: str(form, "cert_serial"),
      vfd_serial: str(form, "vfd_serial"),
      zero_tax_code: str(form, "zero_tax_code") || "5",
    },
  });
  if (error) fail(path, error.message);
  done(path, "TRA settings saved.");
}

export async function registerVfd() {
  const path = "/getting-paid/tra";
  const { company, isManager } = await getAppContext();
  if (!isManager) fail(path, "Only management can register with TRA.");
  const r = await vfdRegisterCompany(company.id);
  if (!r.ok) fail(path, r.error);
  done(path, "Registered with TRA. Waiting receipts are being sent.");
}

/** Types the EFD receipt of an invoice (or of a credit note). */
export async function recordFiscalReceipt(form: FormData) {
  const invoice = str(form, "invoice_id");
  const cn = str(form, "credit_note_id");
  const path = backTo(form, isId(invoice) ? `/invoices/${invoice}` : "/getting-paid/tra");
  if (!isId(invoice)) fail(path, "Invoice not found.");
  const date = str(form, "receipt_date");
  const time = str(form, "receipt_time");
  const at = isDate(date) ? `${date}T${/^\d{2}:\d{2}(:\d{2})?$/.test(time) ? (time.length === 5 ? `${time}:00` : time) : "12:00:00"}+03:00` : null;
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("fiscal_record_manual", {
    p_invoice: invoice,
    p_credit_note: isId(cn) ? cn : null,
    p_receipt_no: str(form, "receipt_no"),
    p_code: str(form, "verification_code"),
    p_receipt_at: at,
    p_z_number: str(form, "z_number") || null,
  });
  if (error) fail(path, error.message);
  done(path, "TRA receipt saved.");
}

/** Opens the receipt of an older invoice and, in VFD mode, sends it now. */
export async function startFiscal(form: FormData) {
  const invoice = str(form, "invoice_id");
  const path = backTo(form, `/invoices/${invoice}`);
  if (!isId(invoice)) fail(path, "Invoice not found.");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("fiscal_start", { p_invoice: invoice });
  if (error) fail(path, error.message);
  await runFiscalQueue(5);
  done(path, "Done.");
}

export async function retryFiscal(form: FormData) {
  const id = str(form, "id");
  const path = backTo(form, "/getting-paid/tra");
  if (!isId(id)) fail(path, "Receipt not found.");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("fiscal_retry", { p_id: id });
  if (error) fail(path, error.message);
  const r = await runFiscalQueue(10);
  done(path, r.status === "not_configured" ? "Queued. VFD is not set up on the server yet." : r.posted ? "Sent to TRA." : "Tried again: see the error below.");
}

export async function sendFiscalQueue(form: FormData) {
  const path = backTo(form, "/getting-paid/tra");
  const { roles } = await getAppContext();
  if (!can(roles, "editInvoices")) fail(path, "You don't have permission to do that.");
  const r = await runFiscalQueue(20);
  if (r.status === "not_configured") fail(path, "VFD is not set up on the server (TRA_VFD_PRIVATE_KEY and TRA_VFD_TIN).");
  done(path, `${r.posted} sent to TRA, ${r.failed} not accepted.`);
}

export async function issueCreditNote(form: FormData) {
  const invoice = str(form, "invoice_id");
  const path = backTo(form, `/invoices/${invoice}`);
  if (!isId(invoice)) fail(path, "Invoice not found.");
  const amount = toNumber(str(form, "amount"));
  if (amount === null || Number.isNaN(amount) || amount <= 0) fail(path, "Enter the amount of the credit note.");
  const on = str(form, "issued_on");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("issue_credit_note", {
    p_invoice: invoice,
    p_amount: amount,
    p_reason: str(form, "reason"),
    p_issued_on: isDate(on) ? on : null,
  });
  if (error) fail(path, error.message);
  done(path, "Credit note issued. The balance is reduced.");
}

export async function cancelCreditNote(form: FormData) {
  const id = str(form, "id");
  const path = backTo(form, "/getting-paid/tra");
  if (!isId(id)) fail(path, "Credit note not found.");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("cancel_credit_note", { p_id: id, p_reason: str(form, "reason") });
  if (error) fail(path, error.message);
  done(path, "Credit note cancelled. The invoice is owed again.");
}

// ------------------------------------------------------------------ Pay links

export async function savePaySettings(form: FormData) {
  const path = "/getting-paid/links";
  const { supabase, company } = await getAppContext();
  const provider = str(form, "provider");
  const { error } = await supabase.rpc("pay_save_settings", {
    p_company: company.id,
    p: { provider: provider || null, on_documents: form.get("on_documents") === "on", allow_partial: form.get("allow_partial") === "on" },
  });
  if (error) fail(path, error.message);
  done(path, "Pay link settings saved.");
}

export async function makePayLink(form: FormData) {
  const invoice = str(form, "invoice_id");
  const path = backTo(form, `/invoices/${invoice}`);
  if (!isId(invoice)) fail(path, "Invoice not found.");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("pay_link_get", { p_invoice: invoice });
  if (error) fail(path, error.message);
  done(path, "Pay link ready.");
}

export async function cancelPayLink(form: FormData) {
  const invoice = str(form, "invoice_id");
  const path = backTo(form, `/invoices/${invoice}`);
  if (!isId(invoice)) fail(path, "Invoice not found.");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("pay_link_cancel", { p_invoice: invoice });
  if (error) fail(path, error.message);
  done(path, "Pay link stopped. A new one is made the next time it is shared.");
}

export type MatchRow = {
  i: number;
  ref: string | null;
  amount: number | null;
  text: string;
  recorded: { payment_id: string; number: string; invoice_id: string; invoice_number: string } | null;
  invoice: { id: string; number: string; client: string; currency: string; balance: number } | null;
  why: "number" | "amount" | "client" | null;
};

/** Match references: reads the pasted text and suggests the invoice each line pays. Nothing is recorded. */
export async function suggestMatches(pasted: string): Promise<{ ok: true; rows: MatchRow[] } | { ok: false; error: string }> {
  const items = parseStatement(String(pasted ?? "").slice(0, 100_000));
  if (!items.length) return { ok: false, error: "Paste the SMS messages or statement lines first." };
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.rpc("pay_match_suggest", { p_company: company.id, p_items: items });
  if (error) return { ok: false, error: friendlyError(error.message) };
  const rows = ((data ?? []) as Omit<MatchRow, "text">[]).map((r) => ({ ...r, text: items[r.i - 1]?.text ?? "" }));
  return { ok: true, rows };
}

// ------------------------------------------------------------------ Reminders

export async function saveReminderSettings(form: FormData) {
  const path = "/getting-paid/reminders";
  const schedule = parseSchedule(str(form, "schedule"));
  if (!schedule) fail(path, "Write the days as numbers, e.g. -3, 0, 7, 14 (minus = before the due date).");
  const channels = form.getAll("channels").filter((c): c is string => typeof c === "string" && ["email", "sms", "whatsapp"].includes(c));
  if (!channels.length) fail(path, "Choose at least one way to send reminders.");
  const minBalance = toNumber(str(form, "min_balance"));
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.rpc("reminder_save_settings", {
    p_company: company.id,
    p: {
      enabled: form.get("enabled") === "on",
      schedule,
      channels,
      send_hour: Number(str(form, "send_hour") || "9"),
      language: ["en", "sw", "both"].includes(str(form, "language")) ? str(form, "language") : "en",
      include_pay_link: form.get("include_pay_link") === "on",
      min_balance: minBalance && !Number.isNaN(minBalance) ? minBalance : 0,
    },
  });
  if (error) fail(path, error.message);
  done(path, "Reminder settings saved.");
}

export async function setInvoiceReminders(form: FormData) {
  const invoice = str(form, "invoice_id");
  const path = backTo(form, `/invoices/${invoice}`);
  if (!isId(invoice)) fail(path, "Invoice not found.");
  const off = str(form, "off") === "1";
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("reminder_set_invoice", { p_invoice: invoice, p_off: off });
  if (error) fail(path, error.message);
  done(path, off ? "No automatic reminders for this invoice." : "Automatic reminders are on for this invoice.");
}

export async function setClientReminders(form: FormData) {
  const client = str(form, "client_id");
  const path = backTo(form, "/getting-paid/reminders");
  if (!isId(client)) fail(path, "Client not found.");
  const lang = str(form, "language");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("reminder_set_client", {
    p_client: client,
    p_opt_out: str(form, "opt_out") === "1",
    p_language: ["en", "sw", "both"].includes(lang) ? lang : null,
  });
  if (error) fail(path, error.message);
  done(path, "Saved.");
}

/** Sends the reminders that are due now (the same as the 15-minute job does). */
export async function sendRemindersNow() {
  const path = "/getting-paid/reminders";
  const { isManager } = await getAppContext();
  if (!isManager) fail(path, "Only management can do this.");
  const r = await runReminders(50);
  if (r.status === "not_configured") fail(path, "The server is missing SUPABASE_SERVICE_ROLE_KEY.");
  if (r.status !== "ok") fail(path, r.status);
  done(path, r.skipped ? `${r.skipped} written to the log only (trial run).` : `${r.sent} sent, ${r.failed} failed.`);
}
