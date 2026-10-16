/**
 * Payroll for Tanzania: types, labels and a copy of the PAYE / NSSF / SDL / WCF sums
 * used only to EXPLAIN figures on screen (the monthly estimate on the pay details form).
 * The database (supabase/migrations/20261025000300_payroll.sql) is the source of truth.
 * No server imports: also used by client components.
 */

export type PayeBand = { from: number; rate: number };

export type PayrollSettings = {
  paye_bands: PayeBand[];
  nssf_employee_pct: number;
  nssf_employer_pct: number;
  sdl_pct: number;
  sdl_min_employees: number;
  wcf_pct: number;
  overtime_after_hours: number;
  overtime_factor: number;
  monthly_hours: number;
};

/** The defaults in the SQL (Tanzania mainland, from July 2022). */
export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  paye_bands: [
    { from: 0, rate: 0 },
    { from: 270000, rate: 8 },
    { from: 520000, rate: 20 },
    { from: 760000, rate: 25 },
    { from: 1000000, rate: 30 },
  ],
  nssf_employee_pct: 10,
  nssf_employer_pct: 10,
  sdl_pct: 3.5,
  sdl_min_employees: 10,
  wcf_pct: 0.5,
  overtime_after_hours: 45,
  overtime_factor: 1.5,
  monthly_hours: 195,
};

/** A payroll_settings row (or nothing) as settings with numbers, falling back to the defaults. */
export function readSettings(row: Record<string, unknown> | null | undefined): PayrollSettings {
  const d = DEFAULT_PAYROLL_SETTINGS;
  if (!row) return d;
  const num = (k: keyof PayrollSettings, fallback: number) => {
    const v = Number(row[k]);
    return row[k] === null || row[k] === undefined || !Number.isFinite(v) ? fallback : v;
  };
  const bands = Array.isArray(row.paye_bands)
    ? (row.paye_bands as { from?: unknown; rate?: unknown }[])
        .map((b) => ({ from: Number(b.from), rate: Number(b.rate) }))
        .filter((b) => Number.isFinite(b.from) && Number.isFinite(b.rate))
    : d.paye_bands;
  return {
    paye_bands: bands.length ? bands : d.paye_bands,
    nssf_employee_pct: num("nssf_employee_pct", d.nssf_employee_pct),
    nssf_employer_pct: num("nssf_employer_pct", d.nssf_employer_pct),
    sdl_pct: num("sdl_pct", d.sdl_pct),
    sdl_min_employees: num("sdl_min_employees", d.sdl_min_employees),
    wcf_pct: num("wcf_pct", d.wcf_pct),
    overtime_after_hours: num("overtime_after_hours", d.overtime_after_hours),
    overtime_factor: num("overtime_factor", d.overtime_factor),
    monthly_hours: num("monthly_hours", d.monthly_hours),
  };
}

/** PAYE on a monthly taxable amount with marginal bands (same sum as public.paye_from_bands). */
export function payeFromBands(bands: PayeBand[], taxable: number): number {
  const sorted = [...bands].sort((a, b) => a.from - b.from);
  let total = 0;
  sorted.forEach((b, i) => {
    const upto = i + 1 < sorted.length ? sorted[i + 1].from : taxable;
    total += (Math.max(Math.min(taxable, upto) - b.from, 0) * b.rate) / 100;
  });
  return Math.round(total);
}

export type PayInputs = {
  basic: number;
  allowances: number;
  deduction: number;
  nssf_member: boolean;
  paye_exempt: boolean;
};

export type PayEstimate = {
  gross: number;
  nssf: number;
  taxable: number;
  paye: number;
  deduction: number;
  net: number;
  nssfEmployer: number;
  wcf: number;
  sdl: number;
};

/** A normal month (no overtime, bonus or unpaid leave). SDL only when the company has enough employees. */
export function estimatePay(p: PayInputs, s: PayrollSettings, sdlApplies: boolean): PayEstimate {
  const gross = Math.max(p.basic + p.allowances, 0);
  const nssf = p.nssf_member ? Math.round((gross * s.nssf_employee_pct) / 100) : 0;
  const taxable = gross - nssf;
  const paye = p.paye_exempt ? 0 : payeFromBands(s.paye_bands, taxable);
  return {
    gross,
    nssf,
    taxable,
    paye,
    deduction: p.deduction,
    net: gross - nssf - paye - p.deduction,
    nssfEmployer: p.nssf_member ? Math.round((gross * s.nssf_employer_pct) / 100) : 0,
    wcf: Math.round((gross * s.wcf_pct) / 100),
    sdl: sdlApplies ? Math.round((gross * s.sdl_pct) / 100) : 0,
  };
}

/** Badge colours (for StatusBadge in sales.tsx). */
export const PAYROLL_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "off" },
  approved: { label: "Approved", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

/** How an employee is paid (employee_pay.pay_method). */
export const EMPLOYEE_PAY_METHODS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  mobile_money: "Mobile money",
  cash: "Cash",
};

/** How a run's salaries or a statutory payment went out. */
export const RUN_PAY_METHODS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  mobile_money: "Mobile money",
  cheque: "Cheque",
};

export type StatutoryKind = "paye" | "nssf" | "sdl" | "wcf" | "deductions";

export type PayrollRun = {
  id: string;
  number: string;
  period: string;
  status: string;
  pay_date: string | null;
  employees: number;
  gross: number;
  nssf_employee: number;
  paye: number;
  deductions: number;
  net: number;
  nssf_employer: number;
  sdl: number;
  wcf: number;
  approved_at: string | null;
  paid_at: string | null;
  paid_method: string | null;
};

export type PayrollLine = {
  id: string;
  run_id: string;
  employee_id: string;
  employee_name: string;
  employee_no: string | null;
  job_title: string | null;
  basic: number;
  allowances: number;
  overtime_hours: number;
  overtime: number;
  bonus: number;
  unpaid_days: number;
  unpaid_deduction: number;
  gross: number;
  nssf_employee: number;
  taxable: number;
  paye: number;
  other_deductions: number;
  deduction_label: string | null;
  net: number;
  nssf_employer: number;
  sdl: number;
  wcf: number;
  pay_method: string | null;
  pay_account: string | null;
};

/** What to pay over after a run, with who to and by when (period = first of the month, YYYY-MM-DD). */
export function statutoryItems(run: PayrollRun): { kind: StatutoryKind; label: string; to: string; due: string; amount: number }[] {
  const [y, m] = run.period.slice(0, 10).split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1)); // first of next month
  const ny = next.getUTCFullYear();
  const nm = next.getUTCMonth() + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  const seventh = `${ny}-${pad(nm)}-07`;
  const endNext = new Date(Date.UTC(ny, nm, 0)).toISOString().slice(0, 10);
  const items: { kind: StatutoryKind; label: string; to: string; due: string; amount: number }[] = [
    { kind: "paye", label: "PAYE", to: "TRA", due: seventh, amount: Number(run.paye) },
    { kind: "nssf", label: "NSSF (employee + employer)", to: "NSSF", due: endNext, amount: Number(run.nssf_employee) + Number(run.nssf_employer) },
    { kind: "sdl", label: "SDL", to: "TRA", due: seventh, amount: Number(run.sdl) },
    { kind: "wcf", label: "WCF", to: "WCF", due: endNext, amount: Number(run.wcf) },
    { kind: "deductions", label: "Other deductions", to: "Lenders and others", due: endNext, amount: Number(run.deductions) },
  ];
  return items.filter((i) => i.amount > 0 || i.kind === "paye" || i.kind === "nssf");
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** "September 2026" for a period (YYYY-MM-DD); pass tr to translate the month name. */
export function monthLabel(period: string, t: (s: string) => string = (s) => s): string {
  const [y, m] = period.slice(0, 10).split("-").map(Number);
  return `${t(MONTHS[(m || 1) - 1])} ${y}`;
}

/** Database messages that carry a value are made general so they can be translated. */
export function payrollError(message: string): string {
  if (/^There is already a pay run for /.test(message)) return "There is already a pay run for that month.";
  if (/payroll_runs_period_key|duplicate key/.test(message)) return "There is already a pay run for that month.";
  return message;
}

/** A plain number for an input box (no thousands separators). */
export function plain(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? String(v) : "0";
}
