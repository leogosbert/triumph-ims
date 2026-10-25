import { formatMoney } from "@/lib/money";

/**
 * Payment reminder texts in English and Kiswahili (pure: used by the server job and the preview).
 * Four tones by step: before the due date, on the day, overdue, and firmly overdue (14 days or more).
 * Please have a native speaker review the Kiswahili.
 */

export type ReminderLang = "en" | "sw" | "both";
export type ReminderTone = "before" | "due" | "overdue" | "firm";

export type ReminderData = {
  companyName: string;
  companyPhone: string | null;
  clientName: string;
  contactName: string | null;
  invoiceNumber: string;
  currency: string;
  balance: number;
  dueDate: string; // YYYY-MM-DD
  step: number; // days from the due date (negative = before)
  payUrl: string | null;
  bankDetails: string | null;
  mobileMoneyDetails: string | null;
};

export function toneFor(step: number): ReminderTone {
  if (step < 0) return "before";
  if (step === 0) return "due";
  if (step < 14) return "overdue";
  return "firm";
}

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_SW = ["Jan", "Feb", "Mac", "Apr", "Mei", "Jun", "Jul", "Ago", "Sep", "Okt", "Nov", "Des"];

function day(iso: string, lang: "en" | "sw"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${(lang === "sw" ? MONTHS_SW : MONTHS_EN)[Number(m[2]) - 1]} ${m[1]}`;
}

function greetingName(d: ReminderData): string {
  return (d.contactName || d.clientName).trim();
}

function enText(d: ReminderData): string {
  const amt = formatMoney(d.balance, d.currency);
  const due = day(d.dueDate, "en");
  const n = Math.abs(d.step);
  const lead: Record<ReminderTone, string> = {
    before: `This is a friendly reminder that invoice ${d.invoiceNumber} for ${amt} is due on ${due} (in ${n} day${n === 1 ? "" : "s"}).`,
    due: `Invoice ${d.invoiceNumber} for ${amt} is due today, ${due}.`,
    overdue: `Invoice ${d.invoiceNumber} for ${amt} was due on ${due} and is now ${n} day${n === 1 ? "" : "s"} overdue.`,
    firm: `Invoice ${d.invoiceNumber} for ${amt} is ${n} days overdue (due ${due}). Please pay it now or tell us when it will be paid.`,
  };
  const out = [`Dear ${greetingName(d)},`, "", lead[toneFor(d.step)]];
  if (d.payUrl) out.push("", `Pay by mobile money or card: ${d.payUrl}`);
  if (d.mobileMoneyDetails) out.push("", `Mobile money: ${d.mobileMoneyDetails}`);
  if (d.bankDetails) out.push("", `Bank: ${d.bankDetails}`);
  out.push("", "If you have already paid, thank you, and please ignore this message.", "", d.companyName);
  if (d.companyPhone) out.push(d.companyPhone);
  return out.join("\n");
}

function swText(d: ReminderData): string {
  const amt = formatMoney(d.balance, d.currency);
  const due = day(d.dueDate, "sw");
  const n = Math.abs(d.step);
  const lead: Record<ReminderTone, string> = {
    before: `Tunakukumbusha kwa heshima kwamba ankara ${d.invoiceNumber} ya ${amt} inapaswa kulipwa tarehe ${due} (baada ya siku ${n}).`,
    due: `Ankara ${d.invoiceNumber} ya ${amt} inapaswa kulipwa leo, tarehe ${due}.`,
    overdue: `Ankara ${d.invoiceNumber} ya ${amt} ilipaswa kulipwa tarehe ${due} na sasa imechelewa siku ${n}.`,
    firm: `Ankara ${d.invoiceNumber} ya ${amt} imechelewa siku ${n} (ilipaswa kulipwa ${due}). Tafadhali ilipe sasa au utujulishe itakapolipwa.`,
  };
  const out = [`Ndugu ${greetingName(d)},`, "", lead[toneFor(d.step)]];
  if (d.payUrl) out.push("", `Lipa kwa simu au kadi: ${d.payUrl}`);
  if (d.mobileMoneyDetails) out.push("", `Pesa kwa simu: ${d.mobileMoneyDetails}`);
  if (d.bankDetails) out.push("", `Benki: ${d.bankDetails}`);
  out.push("", "Kama umeshalipa, asante, na tafadhali puuza ujumbe huu.", "", d.companyName);
  if (d.companyPhone) out.push(d.companyPhone);
  return out.join("\n");
}

export function reminderSubject(d: ReminderData, lang: ReminderLang): string {
  const t = toneFor(d.step);
  const en = { before: "Payment reminder", due: "Payment due today", overdue: "Overdue invoice", firm: "Overdue invoice: please pay now" }[t];
  const sw = { before: "Kikumbusho cha malipo", due: "Malipo yanadaiwa leo", overdue: "Ankara iliyochelewa", firm: "Ankara iliyochelewa: tafadhali lipa sasa" }[t];
  const head = lang === "sw" ? sw : lang === "both" ? `${en} / ${sw}` : en;
  return `${head}: ${d.invoiceNumber} (${d.companyName})`.slice(0, 200);
}

/** The long text (email, WhatsApp). */
export function reminderText(d: ReminderData, lang: ReminderLang): string {
  if (lang === "sw") return swText(d);
  if (lang === "both") return `${swText(d)}\n\n— — —\n\n${enText(d)}`;
  return enText(d);
}

/** The SMS text: short, one language ("both" sends Kiswahili, which most phones read). */
export function reminderSms(d: ReminderData, lang: ReminderLang): string {
  const amt = formatMoney(d.balance, d.currency);
  const n = Math.abs(d.step);
  const t = toneFor(d.step);
  const company = d.companyName.slice(0, 40);
  let text: string;
  if (lang === "en") {
    const what = {
      before: `is due ${day(d.dueDate, "en")}`,
      due: "is due today",
      overdue: `is ${n} day${n === 1 ? "" : "s"} overdue`,
      firm: `is ${n} days overdue, please pay now`,
    }[t];
    text = `${company}: invoice ${d.invoiceNumber} of ${amt} ${what}.${d.payUrl ? ` Pay: ${d.payUrl}` : ""} Ignore if paid.`;
  } else {
    const what = {
      before: `inadaiwa ${day(d.dueDate, "sw")}`,
      due: "inadaiwa leo",
      overdue: `imechelewa siku ${n}`,
      firm: `imechelewa siku ${n}, tafadhali lipa sasa`,
    }[t];
    text = `${company}: ankara ${d.invoiceNumber} ya ${amt} ${what}.${d.payUrl ? ` Lipa: ${d.payUrl}` : ""} Puuza kama umelipa.`;
  }
  return text.slice(0, 306);
}

/** Simple HTML for the email (the text with line breaks and the pay link as a button). */
export function reminderHtml(d: ReminderData, lang: ReminderLang): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const body = esc(reminderText(d, lang)).replace(/\n/g, "<br>");
  const button = d.payUrl
    ? `<p style="margin:20px 0"><a href="${esc(d.payUrl)}" style="background:#0f766e;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${lang === "en" ? "Pay now" : lang === "sw" ? "Lipa sasa" : "Lipa sasa / Pay now"}</a></p>`
    : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">${body}${button}</div>`;
}
