import { formatMoney } from "@/lib/money";

/**
 * Ready-made messages for following up quotations and reminding clients about invoices, in
 * English and Kiswahili. People send them themselves (WhatsApp, SMS or email from their own
 * phone), so nothing leaves the app without them seeing it first.
 */

export const FOLLOWUP_CHANNELS: Record<string, string> = {
  call: "Phone call",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  visit: "Visit",
  other: "Other",
};

/** Digits for wa.me: Tanzanian numbers written 0712 345 678 become 255712345678. */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 10 && digits.startsWith("0")) return `255${digits.slice(1)}`;
  if (digits.length === 9 && /^[67]/.test(digits)) return `255${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

const longDate = (iso: string, lang: "en" | "sw") => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (lang === "sw") return `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
};

type Sender = { person: string | null; company: string; phone: string | null };

function signature(s: Sender, lang: "en" | "sw") {
  return [lang === "sw" ? "Asante," : "Thank you,", s.person, s.company, s.phone].filter(Boolean).join("\n");
}

export type InvoiceReminder = {
  greetingName: string;
  number: string;
  currency: string;
  total: number;
  paid: number;
  dueDate: string | null;
  daysLate: number;
  bankDetails: string | null;
  mobileMoney: string | null;
};

export function invoiceReminderText(inv: InvoiceReminder, sender: Sender, lang: "en" | "sw"): string {
  const balance = inv.total - inv.paid;
  const amount = formatMoney(balance, inv.currency);
  const lines: string[] = [];
  if (lang === "sw") {
    lines.push(`Ndugu ${inv.greetingName},`, "");
    let when = "";
    if (inv.dueDate && inv.daysLate > 0) when = ` ilitakiwa kulipwa tarehe ${longDate(inv.dueDate, lang)} (siku ${inv.daysLate} zilizopita)`;
    else if (inv.dueDate) when = ` inatakiwa kulipwa tarehe ${longDate(inv.dueDate, lang)}`;
    lines.push(`Tunakukumbusha kwa heshima kuwa ankara ${inv.number} yenye kiasi cha ${amount}${when}.`);
    if (inv.paid > 0) lines.push(`Tumeshapokea ${formatMoney(inv.paid, inv.currency)}; kiasi kilichobaki ni ${amount}.`);
    if (inv.bankDetails || inv.mobileMoney) {
      lines.push("", "Unaweza kulipa kupitia:");
      if (inv.bankDetails) lines.push(inv.bankDetails.trim());
      if (inv.mobileMoney) lines.push(inv.mobileMoney.trim());
    }
    lines.push("", `Tafadhali tumia ${inv.number} kama kumbukumbu ya malipo. Kama umeshalipa, tafadhali puuza ujumbe huu.`);
  } else {
    lines.push(`Dear ${inv.greetingName},`, "");
    let when = "";
    if (inv.dueDate && inv.daysLate > 0) when = ` was due on ${longDate(inv.dueDate, lang)} (${inv.daysLate} day${inv.daysLate === 1 ? "" : "s"} ago)`;
    else if (inv.dueDate) when = ` is due on ${longDate(inv.dueDate, lang)}`;
    lines.push(`This is a friendly reminder that invoice ${inv.number} for ${amount}${when}.`);
    if (inv.paid > 0) lines.push(`We have received ${formatMoney(inv.paid, inv.currency)} so far; the balance is ${amount}.`);
    if (inv.bankDetails || inv.mobileMoney) {
      lines.push("", "You can pay by:");
      if (inv.bankDetails) lines.push(inv.bankDetails.trim());
      if (inv.mobileMoney) lines.push(inv.mobileMoney.trim());
    }
    lines.push("", `Please quote ${inv.number} as the payment reference. If you have already paid, please ignore this message.`);
  }
  lines.push("", signature(sender, lang));
  return lines.join("\n");
}

export type QuoteFollowUp = {
  greetingName: string;
  number: string;
  issueDate: string;
  validUntil: string | null;
  currency: string;
  total: number;
  clientRef: string | null;
};

export function quoteFollowUpText(q: QuoteFollowUp, sender: Sender, lang: "en" | "sw"): string {
  const amount = formatMoney(q.total, q.currency);
  const lines: string[] = [];
  if (lang === "sw") {
    lines.push(`Ndugu ${q.greetingName},`, "");
    lines.push(
      `Nafuatilia nukuu yetu ya bei ${q.number} ya tarehe ${longDate(q.issueDate, lang)} yenye thamani ya ${amount}` +
        (q.clientRef ? ` (kumbukumbu yenu ${q.clientRef})` : "") +
        (q.validUntil ? `, ambayo ni halali hadi ${longDate(q.validUntil, lang)}.` : "."),
    );
    lines.push("Je, mmepata nafasi ya kuiangalia? Tuko tayari kujibu maswali yoyote au kuirekebisha kulingana na mahitaji yenu.");
  } else {
    lines.push(`Dear ${q.greetingName},`, "");
    lines.push(
      `I am following up on our quotation ${q.number} of ${longDate(q.issueDate, lang)} for ${amount}` +
        (q.clientRef ? ` (your reference ${q.clientRef})` : "") +
        (q.validUntil ? `, valid until ${longDate(q.validUntil, lang)}.` : "."),
    );
    lines.push("Have you had a chance to look at it? We are happy to answer any questions or adjust it to your needs.");
  }
  lines.push("", signature(sender, lang));
  return lines.join("\n");
}

export type Recipient = { label: string; phone: string | null; email: string | null };

/** Client contacts as message recipients, the preferred kind (finance for invoices, purchasing for quotations) first. */
export function recipientsFrom(
  contacts: { kind: string; name: string | null; phone: string | null; email: string | null }[],
  prefer: string,
): Recipient[] {
  return [...contacts]
    .filter((c) => c.phone || c.email)
    .sort((a, b) => Number(b.kind === prefer) - Number(a.kind === prefer))
    .map((c) => ({ label: c.name || c.email || c.phone || "", phone: c.phone, email: c.email }));
}
