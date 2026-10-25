/**
 * Tax & legal rules: the numbers the Legal & compliance screens use (thresholds, due days, penalties, record keeping,
 * data protection). They start at Tanzania mainland law as we understand it and the owner can change any of them
 * (Legal & compliance → Tax & legal rules), with one tap back to these defaults. The company's own values are kept
 * in compliance_settings.legal_rules (compliance_save_rules); the due days of the usual TRA filings follow them.
 *
 * Guidance, not legal advice: rules change with each Finance Act. Every number carries `verify` so the screen says
 * "check before you rely on it" where we are not certain. Mirrors the Cocozania legalRules design, adapted to a
 * general supply company on the mainland.
 */

export type LegalRules = {
  vat_threshold_12m: number;
  vat_threshold_6m: number;
  vat_register_days: number;
  vat_due_day: number;
  paye_due_day: number;
  wht_due_day: number;
  /** months after the year end to file the final income tax return */
  return_months: number;
  /** a deadline on a Saturday, Sunday or public holiday moves to the next working day */
  next_working_day: boolean;
  late_filing_pct: number;
  late_filing_min: number;
  efd_threshold: number;
  wht_rent: number;
  wht_interest: number;
  service_levy_pct: number;
  records_years: number;
  licence_remind_days: number;
  marketing_consent: boolean;
  breach_hours: number;
  dpo_name: string;
};

export const TZ_LEGAL: LegalRules = {
  vat_threshold_12m: 200_000_000,
  vat_threshold_6m: 100_000_000,
  vat_register_days: 30,
  vat_due_day: 20,
  paye_due_day: 7,
  wht_due_day: 7,
  return_months: 6,
  next_working_day: true,
  late_filing_pct: 2.5,
  late_filing_min: 300_000,
  efd_threshold: 11_000_000,
  wht_rent: 10,
  wht_interest: 10,
  service_levy_pct: 0.3,
  records_years: 5,
  licence_remind_days: 60,
  marketing_consent: true,
  breach_hours: 72,
  dpo_name: "",
};

export type RuleKey = keyof LegalRules;
export type RuleDef = {
  key: RuleKey;
  label: string;
  hint?: string;
  unit?: "TZS" | "%" | "days" | "day" | "months" | "years" | "hours";
  min?: number;
  max?: number;
  /** true: we are not certain of the figure; confirm it with TRA, the council or an adviser */
  verify: boolean;
};
export type RuleGroup = { key: string; title: string; law: string; rules: RuleDef[] };

export const RULE_GROUPS: RuleGroup[] = [
  {
    key: "vat",
    title: "VAT",
    law: "Value Added Tax Act 2014 and TRA guidance",
    rules: [
      { key: "vat_threshold_12m", label: "Register for VAT when taxable sales in 12 months pass", unit: "TZS", verify: false },
      { key: "vat_threshold_6m", label: "… or in 6 months pass", unit: "TZS", verify: false },
      { key: "vat_register_days", label: "Days to apply after passing the threshold", unit: "days", min: 1, max: 90, verify: true },
      { key: "vat_due_day", label: "VAT return and payment due on day", hint: "of the month after the period", unit: "day", min: 1, max: 31, verify: false },
    ],
  },
  {
    key: "employer",
    title: "Employer taxes and withholding",
    law: "Income Tax Act Cap 332 (PAYE, withholding tax); VETA Act (SDL)",
    rules: [
      { key: "paye_due_day", label: "PAYE and SDL due on day", hint: "of the month after the salaries", unit: "day", min: 1, max: 31, verify: false },
      { key: "wht_due_day", label: "Withholding tax due on day", hint: "of the month after the payment", unit: "day", min: 1, max: 31, verify: true },
      { key: "wht_rent", label: "Withholding tax on rent you pay", hint: "the rate on your service invoices is in Settings → Company", unit: "%", min: 0, max: 30, verify: true },
      { key: "wht_interest", label: "Withholding tax on interest", unit: "%", min: 0, max: 30, verify: true },
    ],
  },
  {
    key: "deadlines",
    title: "Returns, deadlines and penalties",
    law: "Tax Administration Act 2015; Income Tax Act Cap 332",
    rules: [
      { key: "return_months", label: "Final income tax return: months after the year end", unit: "months", min: 1, max: 12, verify: false },
      { key: "next_working_day", label: "A deadline on a weekend or public holiday moves to the next working day", verify: true },
      { key: "late_filing_pct", label: "Late filing penalty, each month or part of a month", hint: "of the tax due", unit: "%", min: 0, max: 100, verify: true },
      { key: "late_filing_min", label: "… but not less than", unit: "TZS", verify: true },
      { key: "efd_threshold", label: "Issue EFD/VFD receipts once yearly sales reach", unit: "TZS", verify: true },
      { key: "records_years", label: "Keep books, receipts and returns for", unit: "years", min: 1, max: 20, verify: false },
    ],
  },
  {
    key: "local",
    title: "Council and licences",
    law: "Local Government Finances Act Cap 290 (service levy); Business Licensing Act Cap 208",
    rules: [
      { key: "service_levy_pct", label: "Council service levy, of turnover", unit: "%", min: 0, max: 5, verify: true },
      { key: "licence_remind_days", label: "Suggested reminder before a licence expires", hint: "new licences start with this", unit: "days", min: 0, max: 365, verify: false },
    ],
  },
  {
    key: "data",
    title: "Personal data",
    law: "Personal Data Protection Act 2022 and its 2023 regulations",
    rules: [
      { key: "marketing_consent", label: "Ask for consent before marketing messages to clients", verify: true },
      { key: "breach_hours", label: "Report a data breach to the PDPC within", unit: "hours", min: 1, max: 720, verify: true },
      { key: "dpo_name", label: "Person responsible for personal data", hint: "the name the PDPC and clients see", verify: false },
    ],
  },
];

export const RULE_DEFS: RuleDef[] = RULE_GROUPS.flatMap((g) => g.rules);

/** The company's rules: its own values over the defaults (unknown or wrong-typed values are ignored). */
export function legalRules(saved: unknown): LegalRules {
  const out: LegalRules = { ...TZ_LEGAL };
  if (!saved || typeof saved !== "object") return out;
  const s = saved as Record<string, unknown>;
  for (const k of Object.keys(TZ_LEGAL) as RuleKey[]) {
    const v = s[k];
    if (v !== undefined && v !== null && typeof v === typeof TZ_LEGAL[k]) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** The rules that differ from the defaults (shown as "changed"). */
export function changedRules(r: LegalRules): RuleKey[] {
  return (Object.keys(TZ_LEGAL) as RuleKey[]).filter((k) => r[k] !== TZ_LEGAL[k]);
}

/** TRA's late filing penalty for one month or part of a month: a share of the tax, with a minimum. */
export function lateFilingPenalty(tax: number, r: Pick<LegalRules, "late_filing_pct" | "late_filing_min">): number {
  return Math.max((Math.max(tax, 0) * r.late_filing_pct) / 100, r.late_filing_min);
}

/** Months or part months a filing is late on a given day (0 when not late). */
export function monthsLate(dueOn: string, on: string): number {
  if (on <= dueOn) return 0;
  const d = new Date(`${dueOn}T00:00:00Z`);
  const t = new Date(`${on}T00:00:00Z`);
  let n = (t.getUTCFullYear() - d.getUTCFullYear()) * 12 + (t.getUTCMonth() - d.getUTCMonth());
  if (t.getUTCDate() > d.getUTCDate()) n += 1;
  return Math.max(n, 1);
}

// ------------------------------------------------------------------ working days

/** Easter Sunday (Gregorian), for Good Friday and Easter Monday. */
function easter(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const FIXED_HOLIDAYS = ["01-01", "01-12", "04-07", "04-26", "05-01", "07-07", "08-08", "10-14", "12-09", "12-25", "12-26"];

/**
 * Public holidays with a fixed date (mainland), plus Good Friday and Easter Monday. Eid and Maulid follow the moon
 * and are announced each year, so they are not counted: check the official notice for those weeks.
 */
export function isPublicHoliday(day: string): boolean {
  if (FIXED_HOLIDAYS.includes(day.slice(5))) return true;
  const e = new Date(`${easter(Number(day.slice(0, 4)))}T00:00:00Z`);
  const shift = (n: number) => new Date(e.getTime() + n * 86_400_000).toISOString().slice(0, 10);
  return day === shift(-2) || day === shift(1);
}

/** The first working day on or after this date (weekends and the public holidays above move forward). */
export function workingDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  for (let i = 0; i < 10; i++) {
    const iso = d.toISOString().slice(0, 10);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6 && !isPublicHoliday(iso)) return iso;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return day;
}

/** The date a filing is really due under the company's rules. */
export function effectiveDue(dueOn: string, r: Pick<LegalRules, "next_working_day">): string {
  return r.next_working_day ? workingDay(dueOn) : dueOn;
}
