// Employees, certificates, leave and timesheet weeks (Administration package).
import { daysFromToday, todayTz } from "@/lib/services";

export const EMPLOYMENT_TYPES: Record<string, string> = {
  permanent: "Permanent",
  contract: "Contract",
  casual: "Casual",
  intern: "Intern",
};

export const LEAVE_KINDS: Record<string, string> = {
  annual: "Annual leave",
  sick: "Sick leave",
  maternity: "Maternity leave",
  paternity: "Paternity leave",
  compassionate: "Compassionate leave",
  study: "Study leave",
  unpaid: "Unpaid leave",
  other: "Other leave",
};

export const LEAVE_STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: "Waiting", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  declined: { label: "Declined", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export const WEEK_STATUS: Record<string, { label: string; tone: string }> = {
  submitted: { label: "Waiting for approval", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  returned: { label: "Sent back", tone: "bad" },
};

export type Employee = {
  id: string;
  employee_no: string;
  user_id: string | null;
  full_name: string;
  job_title: string | null;
  department: string | null;
  employment_type: string;
  start_date: string | null;
  probation_end: string | null;
  contract_end: string | null;
  end_date: string | null;
  status: "active" | "left";
  leaving_reason: string | null;
  phone: string | null;
  email: string | null;
  emergency_contact: string | null;
  emergency_phone: string | null;
  id_number: string | null;
  tin: string | null;
  nssf_no: string | null;
  annual_leave_days: number;
  notes: string | null;
};

export type Certificate = {
  id: string;
  employee_id: string;
  name: string;
  issuer: string | null;
  number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  notes: string | null;
};

export type LeaveRequest = {
  id: string;
  employee_id: string;
  kind: string;
  starts_on: string;
  ends_on: string;
  days: number;
  reason: string | null;
  status: string;
  decision_note: string | null;
  created_at: string;
};

export type LeaveBalance = {
  year: number;
  entitled: number;
  taken: number;
  waiting: number;
  left: number;
  by_kind: Record<string, number>;
};

export type AdminSummary = Partial<Record<string, number | boolean | string | null>> & { manager?: boolean };

/** Columns the screens write (all granted for insert and update). */
export const EMPLOYEE_FIELDS =
  "id, employee_no, user_id, full_name, job_title, department, employment_type, start_date, probation_end, contract_end, end_date, status, leaving_reason, phone, email, emergency_contact, emergency_phone, id_number, tin, nssf_no, annual_leave_days, notes";

/** Expiry of a certificate: expired (red), within 30 days (orange) or fine. */
export function certState(expires: string | null | undefined): { tone: "bad" | "warn" | "ok" | "off"; label: string; days: number | null } {
  const days = daysFromToday(expires);
  if (days === null) return { tone: "off", label: "No expiry", days };
  if (days < 0) return { tone: "bad", label: "Expired", days };
  if (days <= 30) return { tone: "warn", label: "Expires soon", days };
  return { tone: "ok", label: "Valid", days };
}

/** Things to look at on an employee: certificates, contract and probation ending, on leave today. */
export function employeeFlags(e: Employee, certs: Certificate[], onLeave: boolean): { tone: string; label: string }[] {
  const flags: { tone: string; label: string }[] = [];
  if (e.status !== "active") return flags;
  if (onLeave) flags.push({ tone: "info", label: "On leave today" });
  const states = certs.map((c) => certState(c.expires_on));
  if (states.some((s) => s.tone === "bad")) flags.push({ tone: "bad", label: "Certificate expired" });
  else if (states.some((s) => s.tone === "warn")) flags.push({ tone: "warn", label: "Certificate expiring" });
  const contract = daysFromToday(e.contract_end);
  if (contract !== null && contract >= 0 && contract <= 30) flags.push({ tone: "warn", label: "Contract ending" });
  const probation = daysFromToday(e.probation_end);
  if (probation !== null && probation >= 0 && probation <= 14) flags.push({ tone: "warn", label: "Probation ending" });
  return flags;
}

/** Number from a jsonb field (0 when missing). */
export function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function daysText(n: number): string {
  return (Math.round(Number(n) * 10) / 10).toLocaleString("en-GB", { maximumFractionDigits: 1 });
}

export function thisYear(): number {
  return Number(todayTz().slice(0, 4));
}
