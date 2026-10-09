/**
 * Lists for the pipeline, tenders, contracts and documents (Stage 14).
 * Client-safe: no server imports. English text is the key; screens translate with tr().
 */

export const OPP_STAGES = [
  { key: "lead", label: "Lead", hint: "First contact" },
  { key: "qualified", label: "Qualified", hint: "Real need and budget" },
  { key: "quoted", label: "Quoted", hint: "Quotation sent" },
  { key: "negotiation", label: "Negotiation", hint: "Agreeing price and terms" },
  { key: "won", label: "Won", hint: "Order received" },
  { key: "lost", label: "Lost", hint: "Went elsewhere" },
] as const;
export type OppStage = (typeof OPP_STAGES)[number]["key"];
export const OPEN_STAGES: OppStage[] = ["lead", "qualified", "quoted", "negotiation"];
export const stageLabel = (s: string) => OPP_STAGES.find((x) => x.key === s)?.label ?? s;

export const OPP_SOURCES = [
  { key: "referral", label: "Referral" },
  { key: "walk_in", label: "Walk-in" },
  { key: "phone", label: "Phone call" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "website", label: "Website" },
  { key: "tender", label: "Tender" },
  { key: "visit", label: "Site visit" },
  { key: "existing_client", label: "Existing client" },
  { key: "social_media", label: "Social media" },
  { key: "other", label: "Other" },
] as const;
export const sourceLabel = (s: string) => OPP_SOURCES.find((x) => x.key === s)?.label ?? s;

export const ACTIVITY_KINDS = [
  { key: "call", label: "Call", icon: "📞" },
  { key: "visit", label: "Visit", icon: "🚗" },
  { key: "meeting", label: "Meeting", icon: "🤝" },
  { key: "whatsapp", label: "WhatsApp", icon: "💬" },
  { key: "sms", label: "SMS", icon: "✉️" },
  { key: "email", label: "Email", icon: "📧" },
  { key: "note", label: "Note", icon: "📝" },
] as const;
export const activityKind = (k: string) => ACTIVITY_KINDS.find((x) => x.key === k) ?? { key: k, label: k, icon: "•" };

export const DATE_KINDS = [
  { key: "birthday", label: "Birthday" },
  { key: "anniversary", label: "Anniversary" },
  { key: "renewal", label: "Renewal" },
  { key: "licence", label: "Licence" },
  { key: "holiday", label: "Holiday" },
  { key: "other", label: "Other" },
] as const;
export const dateKindLabel = (k: string) => DATE_KINDS.find((x) => x.key === k)?.label ?? k;

export const TENDER_STATUSES = [
  { key: "preparing", label: "Preparing" },
  { key: "submitted", label: "Submitted" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "no_bid", label: "Not bidding" },
  { key: "cancelled", label: "Cancelled by buyer" },
] as const;
export const tenderStatusLabel = (s: string) => TENDER_STATUSES.find((x) => x.key === s)?.label ?? s;

export const CONTRACT_KINDS = [
  { key: "framework", label: "Framework agreement" },
  { key: "supply", label: "Supply contract" },
  { key: "service", label: "Service contract" },
  { key: "other", label: "Other" },
] as const;
export const contractKindLabel = (k: string) => CONTRACT_KINDS.find((x) => x.key === k)?.label ?? k;

export const DOC_KINDS = [
  { key: "certificate", label: "Certificate" },
  { key: "licence", label: "Licence or permit" },
  { key: "sds", label: "Safety data sheet (SDS)" },
  { key: "coa", label: "Certificate of analysis (CoA)" },
  { key: "datasheet", label: "Product datasheet" },
  { key: "contract", label: "Contract" },
  { key: "tender", label: "Tender paper" },
  { key: "insurance", label: "Insurance" },
  { key: "tax", label: "Tax (TIN, VAT, clearance)" },
  { key: "company", label: "Company registration" },
  { key: "other", label: "Other" },
] as const;
export const docKindLabel = (k: string) => DOC_KINDS.find((x) => x.key === k)?.label ?? k;

/** Files the documents library accepts (the storage bucket enforces the same list). */
export const DOC_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
export const DOC_MAX_BYTES = 20 * 1024 * 1024;

/** Whole days from today (Dar es Salaam) to a date: negative when it has passed. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Africa/Dar_es_Salaam" }));
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}

/** The Stage 14 tables are missing until that database update is run. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

/** Badge colours (for StatusBadge in sales.tsx). */
export const OPP_BADGE: Record<string, { label: string; tone: string }> = {
  lead: { label: "Lead", tone: "off" },
  qualified: { label: "Qualified", tone: "info" },
  quoted: { label: "Quoted", tone: "info" },
  negotiation: { label: "Negotiation", tone: "warn" },
  won: { label: "Won", tone: "ok" },
  lost: { label: "Lost", tone: "bad" },
};
export const TENDER_BADGE: Record<string, { label: string; tone: string }> = {
  preparing: { label: "Preparing", tone: "warn" },
  submitted: { label: "Submitted", tone: "info" },
  won: { label: "Won", tone: "ok" },
  lost: { label: "Lost", tone: "bad" },
  no_bid: { label: "Not bidding", tone: "off" },
  cancelled: { label: "Cancelled by buyer", tone: "off" },
};

/** A timestamp as date and time in Dar es Salaam ("2026-11-04", "10:00"), for date and time inputs. */
export function darParts(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { date, time };
}

/** "04 Nov 2026, 10:00" in Dar es Salaam time. */
export function darDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
