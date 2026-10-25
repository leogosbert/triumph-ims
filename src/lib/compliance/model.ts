import type { Role } from "@/lib/roles";
import { ACTIVITY_GUIDES, COMPLIANCE_CATALOGUE, requirement, type ActivityGuide, type Requirement } from "./catalogue";

/**
 * Types, labels and small rules for the Legal & compliance screens. The database
 * (supabase/migrations/20261026000100_compliance.sql) is the real guard; these mirror it.
 */

export type ItemStatus = "not_started" | "in_progress" | "done" | "not_applicable";
export type LicenceStatus = "planned" | "applied" | "active" | "expired" | "suspended";
export type DeadlineStatus = "open" | "filed" | "not_required";

export type ComplianceItem = {
  id: string;
  code: string | null;
  name: string;
  category: string;
  authority: string | null;
  frequency: "none" | "monthly" | "quarterly" | "annual";
  due_day: number | null;
  due_offset_months: number | null;
  calendar_from: string | null;
  due_on: string | null;
  status: ItemStatus;
  status_note: string | null;
  done_on: string | null;
  done_by: string | null;
  owner_id: string | null;
  licence_id: string | null;
  finance_ok: boolean;
  notes: string | null;
  sort: number;
  created_at: string;
};
export const ITEM_FIELDS =
  "id, code, name, category, authority, frequency, due_day, due_offset_months, calendar_from, due_on, status, status_note, done_on, done_by, owner_id, licence_id, finance_ok, notes, sort, created_at";

export type Licence = {
  id: string;
  name: string;
  authority: string | null;
  catalogue_code: string | null;
  licence_no: string | null;
  category: string | null;
  product_scope: string | null;
  status: LicenceStatus;
  applied_on: string | null;
  issued_on: string | null;
  expires_on: string | null;
  remind_days: number;
  conditions: string | null;
  cost: number | null;
  currency: string;
  notes: string | null;
  created_at: string;
};
export const LICENCE_FIELDS =
  "id, name, authority, catalogue_code, licence_no, category, product_scope, status, applied_on, issued_on, expires_on, remind_days, conditions, cost, currency, notes, created_at";

export type Deadline = {
  id: string;
  item_id: string;
  period_start: string;
  period_end: string;
  due_on: string;
  status: DeadlineStatus;
  filed_on: string | null;
  reference: string | null;
  note: string | null;
  filed_by: string | null;
  amount: number | null;
  control_number: string | null;
  paid_on: string | null;
};
export const DEADLINE_FIELDS = "id, item_id, period_start, period_end, due_on, status, filed_on, reference, note, filed_by, amount, control_number, paid_on";

export type Director = {
  id: string;
  full_name: string;
  role: "director" | "managing_director" | "chairperson" | "secretary" | "shareholder";
  id_type: "nida" | "passport" | "other";
  id_number: string | null;
  nationality: string | null;
  tin: string | null;
  appointed_on: string | null;
  resigned_on: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  share_percent: number | null;
  shares_held: number | null;
  notes: string | null;
  sort: number;
};
export const DIRECTOR_FIELDS =
  "id, full_name, role, id_type, id_number, nationality, tin, appointed_on, resigned_on, phone, email, address, share_percent, shares_held, notes, sort";

export type ComplianceSettings = {
  year_end_month: number;
  incorporated_on: string | null;
  shares_decided: boolean;
  shares_decided_at: string | null;
  shareholding_note: string | null;
  board_note: string | null;
  legal_rules: Record<string, unknown>;
};

/** compliance_summary(): counts for the overview and the home card. */
export type ComplianceSummary = {
  ready: boolean;
  set_up: boolean;
  can_manage: boolean;
  items: number;
  applicable: number;
  done: number;
  in_progress: number;
  not_started: number;
  not_applicable: number;
  score: number;
  overdue: number;
  due_soon: number;
  items_overdue: number;
  items_due_soon: number;
  filings_overdue: number;
  filings_due_soon: number;
  missing_docs: number;
  licences: number;
  licences_active: number;
  licences_pending: number;
  licences_expiring: number;
  licences_expired: number;
  licences_suspended: number;
  documents_expiring: number;
  directors: number;
  shares_decided: boolean;
  next_filings: { id: string; item_id: string; name: string; due_on: string; period: string }[];
};

export const ITEM_STATUS: Record<ItemStatus, { label: string; tone: string }> = {
  not_started: { label: "Not started", tone: "off" },
  in_progress: { label: "In progress", tone: "warn" },
  done: { label: "Done", tone: "ok" },
  not_applicable: { label: "Does not apply", tone: "off" },
};

export const LICENCE_STATUS: Record<LicenceStatus, { label: string; tone: string }> = {
  planned: { label: "To apply for", tone: "off" },
  applied: { label: "Applied", tone: "info" },
  active: { label: "Active", tone: "ok" },
  expired: { label: "Expired", tone: "bad" },
  suspended: { label: "Suspended", tone: "bad" },
};

export const DEADLINE_STATUS: Record<DeadlineStatus, { label: string; tone: string }> = {
  open: { label: "To file", tone: "warn" },
  filed: { label: "Filed", tone: "ok" },
  not_required: { label: "Nothing to file", tone: "off" },
};

export const FREQUENCIES: Record<ComplianceItem["frequency"], string> = {
  none: "Once / when needed",
  monthly: "Every month",
  quarterly: "Every quarter",
  annual: "Every year",
};

export const DIRECTOR_ROLES: Record<Director["role"], string> = {
  managing_director: "Managing director",
  chairperson: "Chairperson",
  director: "Director",
  secretary: "Company secretary",
  shareholder: "Shareholder (not a director)",
};

export const ID_TYPES: Record<Director["id_type"], string> = { nida: "NIDA", passport: "Passport", other: "Other ID" };

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Readers: everyone except drivers. */
export function canSeeCompliance(role: Role): boolean {
  return role !== "driver";
}

/** Who may change an item (or mark its filings): management; finance for tax and social-security items. */
export function canWriteItem(role: Role, financeOk: boolean): boolean {
  return role === "management" || (financeOk && role === "finance");
}

/** "Due on the 7th of the following month" from the calendar rule of an item. */
export function dueRuleText(i: Pick<ComplianceItem, "frequency" | "due_day" | "due_offset_months">): string | null {
  if (i.frequency === "none" || !i.due_day) return null;
  const day = i.due_day >= 31 ? "the last day" : `day ${i.due_day}`;
  const off = i.due_offset_months ?? 1;
  const period = i.frequency === "monthly" ? "month" : i.frequency === "quarterly" ? "quarter" : "financial year";
  if (off === 0) return `${day} of the last month of each ${period}`;
  if (off > 0) return `${day} of the ${ordinal(off)} month after each ${period}`;
  return `${day} of the ${ordinal(12 + off)} month of each ${period}`;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Where a company stands on one requirement (for the guide and the checklist). */
export type Standing = "have" | "no_copy" | "in_progress" | "missing" | "not_applicable" | "not_added";

export const STANDING_LABEL: Record<Standing, { label: string; tone: string }> = {
  have: { label: "You have it", tone: "ok" },
  no_copy: { label: "Done: upload the copy", tone: "warn" },
  in_progress: { label: "In progress", tone: "info" },
  missing: { label: "Missing", tone: "bad" },
  not_applicable: { label: "Does not apply", tone: "off" },
  not_added: { label: "Not on your checklist", tone: "off" },
};

export function standingOf(
  code: string,
  items: Map<string, Pick<ComplianceItem, "id" | "status">>,
  docCount: Map<string, number>,
  activeLicenceCodes: Set<string>,
): Standing {
  const item = items.get(code);
  const req = requirement(code);
  if (activeLicenceCodes.has(code)) return "have";
  if (!item) return "not_added";
  if (item.status === "not_applicable") return "not_applicable";
  if (item.status === "done") {
    const needsCopy = req ? req.kind === "registration" || req.kind === "licence" : false;
    return needsCopy && !(docCount.get(item.id) ?? 0) ? "no_copy" : "have";
  }
  if (item.status === "in_progress") return "in_progress";
  return "missing";
}

/** Plain search over the catalogue and the guides (names, authorities, purposes, documents, keywords). */
export function searchCompliance(query: string): { requirements: Requirement[]; guides: ActivityGuide[] } {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP.has(w));
  if (!words.length) return { requirements: [], guides: [] };
  const score = (text: string) => words.reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
  const reqs = COMPLIANCE_CATALOGUE.map((r) => ({
    r,
    s:
      score(`${r.name} ${r.authority} ${(r.keywords ?? []).join(" ")} ${r.code.replace(/_/g, " ")}`.toLowerCase()) * 3 +
      score(`${r.purpose} ${r.condition ?? ""} ${r.documentsNeeded.join(" ")} ${r.tags.join(" ")}`.toLowerCase()),
  }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.r.sort - b.r.sort)
    .slice(0, 12)
    .map((x) => x.r);
  const guides = ACTIVITY_GUIDES.map((g) => ({ g, s: score(`${g.question} ${g.title} ${g.summary}`.toLowerCase()) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.g);
  return { requirements: reqs, guides };
}

const STOP = new Set(["the", "what", "do", "we", "need", "to", "for", "and", "of", "a", "an", "how", "our", "is", "are", "in", "on", "with", "it", "be", "you", "my"]);

export const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0) || 0);

/** "Oct 2026" for a month, "Jan 2026 – Mar 2026" for a quarter or year. */
export function periodLabel(start: string, end: string): string {
  const fmt = (d: string) => new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  if (start.slice(0, 7) === end.slice(0, 7)) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

/** A date (YYYY-MM-DD) plus n days. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
