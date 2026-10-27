/**
 * Goods and services (v1.21): service jobs, maintenance contracts, equipment, projects, timesheets
 * and hire. Client-safe lists and helpers; English labels are keys that screens translate with tr().
 * The database rules (supabase/migrations/20261021000100_service_business.sql) are the real guard.
 */
import { hasRole, type Role, type RoleSet } from "@/lib/roles";

/** Shown until the goods-and-services SQL has been run. */
export const SERVICES_MISSING = "Service jobs need the latest database update. Ask LeMo Tech to run it.";

export const BUSINESS_TYPES: Record<"goods" | "services" | "both", { label: string; hint: string }> = {
  goods: { label: "Goods", hint: "You buy and sell products: trading, supply, distribution, a shop." },
  services: { label: "Services", hint: "You do work for clients: installation, repair, maintenance, consulting, hire, transport." },
  both: { label: "Goods and services", hint: "You supply products and also install, maintain or advise, e.g. pipes plus installation." },
};

export const JOB_KINDS: Record<string, string> = {
  installation: "Installation",
  repair: "Repair",
  maintenance: "Maintenance",
  inspection: "Inspection",
  consultation: "Consultation",
  delivery_install: "Supply and install",
  other: "Other",
};

export const JOB_PRIORITIES: Record<string, { label: string; tone: string }> = {
  low: { label: "Low", tone: "off" },
  normal: { label: "Normal", tone: "info" },
  high: { label: "High", tone: "warn" },
  urgent: { label: "Urgent", tone: "bad" },
};

export const JOB_STATUS: Record<string, { label: string; tone: string }> = {
  scheduled: { label: "Scheduled", tone: "info" },
  in_progress: { label: "In progress", tone: "warn" },
  on_hold: { label: "On hold", tone: "off" },
  completed: { label: "Completed", tone: "ok" },
  invoiced: { label: "Invoiced", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export const OPEN_JOB = ["scheduled", "in_progress", "on_hold"];

export const LINE_KINDS: Record<string, string> = { material: "Material", labour: "Labour", other: "Other" };

export const FREQUENCIES: Record<string, string> = {
  monthly: "Every month",
  quarterly: "Every 3 months",
  half_yearly: "Every 6 months",
  yearly: "Every year",
};

export const CONTRACT_STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "ok" },
  paused: { label: "Paused", tone: "off" },
  ended: { label: "Ended", tone: "off" },
};

export const PROJECT_BILLING: Record<string, string> = {
  fixed: "Fixed price",
  milestone: "By milestone",
  time: "By time (hours)",
};

export const PROJECT_STATUS: Record<string, { label: string; tone: string }> = {
  active: { label: "Active", tone: "ok" },
  on_hold: { label: "On hold", tone: "off" },
  completed: { label: "Completed", tone: "info" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export const MILESTONE_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Not done yet", tone: "info" },
  done: { label: "Done", tone: "warn" },
  invoiced: { label: "Invoiced", tone: "ok" },
};

export const RATE_PERIODS: Record<string, { label: string; per: string }> = {
  day: { label: "Per day", per: "day" },
  week: { label: "Per week", per: "week" },
  month: { label: "Per month", per: "month" },
};

export const HIRE_STATUS: Record<string, { label: string; tone: string }> = {
  out: { label: "Out on hire", tone: "warn" },
  returned: { label: "Returned", tone: "info" },
  invoiced: { label: "Closed", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "off" },
};

/** Who plans and runs service work (jobs, contracts, equipment, hire). Mirrors public.service_roles(). */
export const SERVICE_ROLES: Role[] = ["management", "sales", "warehouse"];
export const canPlanService = (role: RoleSet) => hasRole(role, ...SERVICE_ROLES);
/** Sees every job, contract, hire and the reports. */
export const canSeeAllService = (role: RoleSet) => canPlanService(role) || hasRole(role, "finance");
/** Makes invoices from jobs, projects and hires; sets rates. */
export const canInvoiceService = (role: RoleSet) => hasRole(role, "management", "finance");

export type ChecklistItem = { text: string; done: boolean };

export function parseChecklist(v: unknown): ChecklistItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) =>
      typeof x === "string"
        ? { text: x, done: false }
        : x && typeof x === "object"
          ? { text: String((x as Record<string, unknown>).text ?? ""), done: Boolean((x as Record<string, unknown>).done) }
          : null,
    )
    .filter((x): x is ChecklistItem => !!x && x.text.trim() !== "");
}

/** One point per line of a textarea. */
export function checklistFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean)
    .slice(0, 60);
}

/** Today in Dar es Salaam, as YYYY-MM-DD. */
export function todayTz(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
}

/** Whole days from today to a date (negative when past). */
export function daysFromToday(date: string | null | undefined): number | null {
  if (!date) return null;
  const a = Date.parse(`${todayTz()}T00:00:00Z`);
  const b = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(b) ? Math.round((b - a) / 86400000) : null;
}

/** "2026-10-21T08:00" for a datetime-local input, in Dar es Salaam time. */
export function toLocalInput(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Dar_es_Salaam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour") === "24" ? "00" : g("hour")}:${g("minute")}`;
}

/** A datetime-local value typed in Dar es Salaam (UTC+3) as an ISO timestamp. */
export function fromLocalInput(v: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  return `${v}:00+03:00`;
}

/** Date and time for lists, e.g. "21 Oct 2026, 08:00". */
export function formatWhen(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** Rate periods charged between two dates (any part of a period counts in full). Mirrors public.hire_periods. */
export function hirePeriods(from: string, to: string, period: string): number {
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  const size = period === "week" ? 7 : period === "month" ? 30 : 1;
  return Math.max(Math.ceil(days / size), 0);
}

/** Withholding tax a client may deduct from the services on an invoice. */
export function withholding(servicesTotal: number, rate: number | null | undefined): number {
  return Math.round(servicesTotal * Number(rate ?? 0)) / 100;
}
