/**
 * General ledger (Accounts): types, labels, date ranges and the statements built from
 * the trial balance (rpc gl_trial_balance, debit-positive). Screens translate labels with tr().
 */
import { todayTz } from "@/lib/services";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export type TbRow = {
  account_id: string;
  code: string;
  name: string;
  type: AccountType;
  system_key: string | null;
  active: boolean;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
};

export type Account = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  system_key: string | null;
  active: boolean;
  notes: string | null;
};

export type Journal = {
  id: string;
  number: string;
  entry_date: string;
  doc_date: string | null;
  memo: string | null;
  source: string;
  source_id: string | null;
  source_ref: string | null;
  reverses: string | null;
  reversed_by: string | null;
  created_by: string | null;
  created_at: string;
};

/** Account types in chart order, with their group names. */
export const ACCOUNT_TYPES: { key: AccountType; label: string; one: string }[] = [
  { key: "asset", label: "Assets", one: "Asset" },
  { key: "liability", label: "Liabilities", one: "Liability" },
  { key: "equity", label: "Equity", one: "Equity" },
  { key: "income", label: "Income", one: "Income" },
  { key: "expense", label: "Expenses", one: "Expense" },
];

export function typeLabel(t: string): string {
  return ACCOUNT_TYPES.find((x) => x.key === t)?.one ?? t;
}

/** Assets and expenses are naturally debit; the rest credit. */
export function isDebitNature(t: string): boolean {
  return t === "asset" || t === "expense";
}

/** A debit-positive amount turned to the account's natural sign. */
export function natural(t: string, debitPositive: number): number {
  return isDebitNature(t) ? debitPositive : -debitPositive;
}

/** Normalises rpc rows (numeric comes back as number or string). */
export function toTbRows(data: unknown): TbRow[] {
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    account_id: String(r.account_id),
    code: String(r.code),
    name: String(r.name),
    type: r.type as AccountType,
    system_key: (r.system_key as string | null) ?? null,
    active: r.active !== false,
    opening: Number(r.opening ?? 0),
    debit: Number(r.debit ?? 0),
    credit: Number(r.credit ?? 0),
    closing: Number(r.closing ?? 0),
  }));
}

// ---------------------------------------------------------------------------------------------
// Journal sources
// ---------------------------------------------------------------------------------------------
export const SOURCES: { key: string; label: string }[] = [
  { key: "manual", label: "Journal by hand" },
  { key: "opening", label: "Opening balances" },
  { key: "invoices", label: "Invoices" },
  { key: "payments", label: "Payments received" },
  { key: "supplier_bills", label: "Supplier bills" },
  { key: "supplier_payments", label: "Supplier payments" },
  { key: "expenses", label: "Expenses" },
  { key: "payroll", label: "Payroll" },
  { key: "payroll_payment", label: "Salaries and taxes paid" },
  { key: "fixed_asset", label: "Asset bought" },
  { key: "depreciation", label: "Depreciation" },
  { key: "asset_disposal", label: "Asset sold or scrapped" },
];

export function sourceLabel(s: string): string {
  return SOURCES.find((x) => x.key === s)?.label ?? s;
}

/**
 * Where the document behind a journal (or a posting problem) lives.
 * Supplier payments open their bill, so pass `billOf` (supplier payment id → bill id) when known.
 */
export function sourceHref(source: string, id: string | null, billOf?: Map<string, string>): string | null {
  if (source === "depreciation") return "/accounts/assets";
  if (!id) return null;
  switch (source) {
    case "invoices":
      return `/invoices/${id}`;
    case "payments":
      return `/payments/${id}`;
    case "supplier_bills":
      return `/bills/${id}`;
    case "supplier_payments": {
      const bill = billOf?.get(id);
      return bill ? `/bills/${bill}` : null;
    }
    case "expenses":
      return `/expenses/${id}`;
    case "payroll":
    case "payroll_payment":
      return `/payroll/${id}`;
    case "fixed_asset":
    case "asset_disposal":
      return `/accounts/assets/${id}`;
    default:
      return null;
  }
}

/** Manual and opening journals are the only ones reversed by hand. */
export function canReverseByHand(j: Pick<Journal, "source" | "reverses" | "reversed_by">): boolean {
  return (j.source === "manual" || j.source === "opening") && !j.reverses && !j.reversed_by;
}

// ---------------------------------------------------------------------------------------------
// Fixed assets
// ---------------------------------------------------------------------------------------------
export const ASSET_CATEGORIES: { key: string; label: string }[] = [
  { key: "land_buildings", label: "Land and buildings" },
  { key: "vehicles", label: "Vehicles" },
  { key: "machinery", label: "Machinery" },
  { key: "equipment", label: "Equipment" },
  { key: "computers", label: "Computers" },
  { key: "furniture", label: "Furniture" },
  { key: "other", label: "Other" },
];

export function assetCategoryLabel(c: string): string {
  return ASSET_CATEGORIES.find((x) => x.key === c)?.label ?? c;
}

export const PAID_FROM: { key: string; label: string }[] = [
  { key: "bank", label: "Bank" },
  { key: "cash", label: "Cash" },
  { key: "mobile_money", label: "Mobile money" },
  { key: "payable", label: "Owed to the supplier" },
  { key: "bill", label: "Already entered as a supplier bill" },
  { key: "opening", label: "Owned before we started using LeMoSp" },
];

export const DISPOSAL_METHODS: { key: string; label: string }[] = [
  { key: "bank", label: "Bank" },
  { key: "cash", label: "Cash" },
  { key: "mobile_money", label: "Mobile money" },
];

export type FixedAsset = {
  id: string;
  number: string;
  name: string;
  category: string;
  serial_no: string | null;
  location: string | null;
  vehicle_id: string | null;
  bought_on: string;
  cost: number;
  residual_value: number;
  life_months: number;
  paid_from: string;
  accumulated_dep: number;
  status: "active" | "disposed";
  disposed_on: string | null;
  disposal_amount: number | null;
  notes: string | null;
  created_at: string;
};

export function monthlyDepreciation(a: Pick<FixedAsset, "cost" | "residual_value" | "life_months">): number {
  return Math.round(((Number(a.cost) - Number(a.residual_value)) / a.life_months) * 100) / 100;
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v: unknown): v is string {
  return typeof v === "string" && ISO.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`));
}

function d(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
function iso(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}
export function addDays(date: string, n: number): string {
  const dt = d(date);
  dt.setUTCDate(dt.getUTCDate() + n);
  return iso(dt);
}
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}
export function monthEnd(date: string): string {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  return iso(new Date(Date.UTC(y, m, 0)));
}
/** First day of the month `n` months after the month of `date`. */
export function addMonths(date: string, n: number): string {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  return iso(new Date(Date.UTC(y, m - 1 + n, 1)));
}
export function yearStart(date: string): string {
  return `${date.slice(0, 4)}-01-01`;
}
export function quarterStart(date: string): string {
  const [y, m] = date.slice(0, 7).split("-").map(Number);
  return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
}
/** End of last month: the usual day to close the books to. */
export function endOfLastMonth(today = todayTz()): string {
  return addDays(monthStart(today), -1);
}

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 2026" from "2026-10" or a date; pass tr to translate the month. */
export function monthLabel(ym: string, t: (s: string) => string = (s) => s): string {
  const m = Number(ym.slice(5, 7));
  return `${t(MONTH_SHORT[m - 1] ?? "")} ${ym.slice(0, 4)}`;
}

export type PeriodKey = "this_month" | "last_month" | "this_quarter" | "this_year" | "last_year" | "custom";

export const PERIOD_PRESETS: { key: Exclude<PeriodKey, "custom">; label: string }[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "this_quarter", label: "This quarter" },
  { key: "this_year", label: "This year" },
  { key: "last_year", label: "Last year" },
];

export type Period = { key: PeriodKey; from: string; to: string };

export function presetRange(key: Exclude<PeriodKey, "custom">, today = todayTz()): { from: string; to: string } {
  switch (key) {
    case "last_month": {
      const from = addMonths(today, -1);
      return { from, to: monthEnd(from) };
    }
    case "this_quarter":
      return { from: quarterStart(today), to: today };
    case "this_year":
      return { from: yearStart(today), to: today };
    case "last_year": {
      const y = Number(today.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    default:
      return { from: monthStart(today), to: today };
  }
}

/** Reads ?p=preset or ?from=&to= (custom) from the query string; this month by default. */
export function readPeriod(sp: Record<string, string | string[] | undefined>, fallback: Exclude<PeriodKey, "custom"> = "this_month"): Period {
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const from = pick(sp.from);
  const to = pick(sp.to);
  if (isIsoDate(from) && isIsoDate(to) && from <= to) return { key: "custom", from, to };
  const p = pick(sp.p);
  const key = PERIOD_PRESETS.some((x) => x.key === p) ? (p as Exclude<PeriodKey, "custom">) : fallback;
  return { key, ...presetRange(key) };
}

/** The period of the same length just before (whole months stay whole months). */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  if (from === monthStart(from) && to === monthEnd(to)) {
    const months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
    const pFrom = addMonths(from, -months);
    return { from: pFrom, to: addDays(from, -1) };
  }
  const days = Math.round((d(to).getTime() - d(from).getTime()) / 86400000) + 1;
  return { from: addDays(from, -days), to: addDays(from, -1) };
}

export function readMonth(v: string | string[] | undefined, fallback: string): string {
  const s = Array.isArray(v) ? v[0] : v;
  return s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s) ? s : fallback;
}

// ---------------------------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------------------------
export type StLine = { id: string; code: string; name: string; amount: number; compare?: number };
export type StGroup = { label: string; lines: StLine[]; total: number; compareTotal?: number };

function lineOf(r: TbRow, amount: number, compare?: number): StLine {
  return { id: r.account_id, code: r.code, name: r.name, amount, compare };
}

const SALES_KEYS = ["sales_goods", "sales_services"];
const GAIN_KEYS = ["disposal_gain_loss", "fx_gain_loss"];
const COST_KEYS = ["cost_of_sales", "other_purchases"];

/** Movement in the period in the account's natural sign. */
function moved(r: TbRow): number {
  return natural(r.type, r.debit - r.credit);
}

function group(label: string, rows: TbRow[], value: (r: TbRow) => number, cmp?: Map<string, number>): StGroup {
  const lines = rows
    .map((r) => lineOf(r, value(r), cmp ? (cmp.get(r.account_id) ?? 0) : undefined))
    .filter((l) => Math.abs(l.amount) >= 0.005 || Math.abs(l.compare ?? 0) >= 0.005)
    .sort((a, b) => a.code.localeCompare(b.code));
  return {
    label,
    lines,
    total: lines.reduce((s, l) => s + l.amount, 0),
    compareTotal: cmp ? lines.reduce((s, l) => s + (l.compare ?? 0), 0) : undefined,
  };
}

export type ProfitLoss = {
  sales: StGroup;
  otherIncome: StGroup;
  gains: StGroup;
  costOfSales: StGroup;
  expenses: StGroup;
  totalIncome: number;
  grossProfit: number;
  netProfit: number;
};

function pnlOf(rows: TbRow[], cmp?: Map<string, number>): ProfitLoss {
  const income = rows.filter((r) => r.type === "income");
  const expense = rows.filter((r) => r.type === "expense");
  const sales = group("Sales", income.filter((r) => SALES_KEYS.includes(r.system_key ?? "")), moved, cmp);
  const gains = group("Gains and losses", income.filter((r) => GAIN_KEYS.includes(r.system_key ?? "")), moved, cmp);
  const otherIncome = group(
    "Other income",
    income.filter((r) => !SALES_KEYS.includes(r.system_key ?? "") && !GAIN_KEYS.includes(r.system_key ?? "")),
    moved,
    cmp,
  );
  const costOfSales = group("Cost of sales", expense.filter((r) => COST_KEYS.includes(r.system_key ?? "")), moved, cmp);
  const expenses = group("Expenses", expense.filter((r) => !COST_KEYS.includes(r.system_key ?? "")), moved, cmp);
  const totalIncome = sales.total + otherIncome.total + gains.total;
  const grossProfit = sales.total - costOfSales.total;
  return {
    sales,
    otherIncome,
    gains,
    costOfSales,
    expenses,
    totalIncome,
    grossProfit,
    netProfit: totalIncome - costOfSales.total - expenses.total,
  };
}

/** Profit & loss from a trial balance run over the period; `previous` adds a comparison column. */
export function buildProfitLoss(rows: TbRow[], previous?: TbRow[]): { current: ProfitLoss; previous?: ProfitLoss } {
  if (!previous) return { current: pnlOf(rows) };
  const prevMap = new Map(previous.map((r) => [r.account_id, moved(r)]));
  // Accounts that only moved in the previous period still need a row.
  const ids = new Set(rows.map((r) => r.account_id));
  const all = [...rows, ...previous.filter((r) => !ids.has(r.account_id)).map((r) => ({ ...r, debit: 0, credit: 0 }))];
  return { current: pnlOf(all, prevMap), previous: pnlOf(previous) };
}

/** Headline figures from a trial balance over a period (closing = as at its end). */
export function headline(rows: TbRow[]) {
  const p = pnlOf(rows);
  const bal = (keys: string[]) => rows.filter((r) => keys.includes(r.system_key ?? "")).reduce((s, r) => s + r.closing, 0);
  return {
    sales: p.sales.total,
    grossProfit: p.grossProfit,
    netProfit: p.netProfit,
    money: bal(["cash", "bank", "mobile_money"]),
    clientsOwe: bal(["receivable"]),
    weOwe: -bal(["payable"]),
    vatToPay: -bal(["vat_output"]) - bal(["vat_input"]),
  };
}

const CURRENT_ASSET_KEYS = ["cash", "bank", "mobile_money", "receivable", "wht_receivable", "inventory", "vat_input", "prepayments"];
const FIXED_ASSET_KEYS = ["fixed_assets", "accum_depreciation"];
const LIABILITY_ORDER = [
  "payable",
  "vat_output",
  "paye_payable",
  "nssf_payable",
  "sdl_payable",
  "wcf_payable",
  "salaries_payable",
  "deductions_payable",
  "loans",
];
const EQUITY_ORDER = ["capital", "opening_balance", "retained_earnings"];

function ordered(rows: TbRow[], order: string[]): TbRow[] {
  const rank = (r: TbRow) => {
    const i = order.indexOf(r.system_key ?? "");
    return i < 0 ? order.length : i;
  };
  return [...rows].sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
}

function closingGroup(label: string, rows: TbRow[], order: string[]): StGroup {
  const lines = ordered(rows, order)
    .map((r) => lineOf(r, natural(r.type, r.closing)))
    .filter((l) => Math.abs(l.amount) >= 0.005);
  return { label, lines, total: lines.reduce((s, l) => s + l.amount, 0) };
}

export type BalanceSheet = {
  current: StGroup;
  fixed: StGroup;
  totalAssets: number;
  liabilities: StGroup;
  equity: StGroup;
  profitToDate: number;
  totalEquity: number;
  totalLiabilitiesEquity: number;
  difference: number;
};

/** Balance sheet from a trial balance as at a date (closing column). */
export function buildBalanceSheet(rows: TbRow[]): BalanceSheet {
  const assets = rows.filter((r) => r.type === "asset");
  const fixedRows = assets.filter((r) => FIXED_ASSET_KEYS.includes(r.system_key ?? ""));
  const currentRows = assets.filter((r) => !FIXED_ASSET_KEYS.includes(r.system_key ?? ""));
  const current = closingGroup("Current assets", currentRows, CURRENT_ASSET_KEYS);
  const fixed = closingGroup("Fixed assets", fixedRows, FIXED_ASSET_KEYS);
  const liabilities = closingGroup("Liabilities", rows.filter((r) => r.type === "liability"), LIABILITY_ORDER);
  const equity = closingGroup("Equity", rows.filter((r) => r.type === "equity"), EQUITY_ORDER);
  // All income minus all expenses to date, not yet moved to retained earnings.
  const profitToDate = -rows.filter((r) => r.type === "income" || r.type === "expense").reduce((s, r) => s + r.closing, 0);
  const totalAssets = current.total + fixed.total;
  const totalEquity = equity.total + profitToDate;
  const totalLiabilitiesEquity = liabilities.total + totalEquity;
  return {
    current,
    fixed,
    totalAssets,
    liabilities,
    equity,
    profitToDate,
    totalEquity,
    totalLiabilitiesEquity,
    difference: Math.round((totalAssets - totalLiabilitiesEquity) * 100) / 100,
  };
}

/** Database messages that carry a date or an amount, reduced to a fixed sentence that can be translated. */
export function ledgerError(message: string | null | undefined): string {
  const m = message ?? "";
  if (/^The books are closed up to/.test(m)) return "The books are closed up to that date. Choose a later date.";
  if (/^The journal does not balance/.test(m)) return "The journal does not balance: the debits and credits must be equal.";
  if (/gl_accounts_company_id_code_key|duplicate key.*code/.test(m)) return "Another account already uses that code.";
  if (/gl_accounts_code_check/.test(m)) return "The account code must be 3 to 6 digits.";
  if (/gl_accounts_name_check/.test(m)) return "The account name must be 2 to 120 characters.";
  if (/fixed_assets_check|residual_value < cost/.test(m)) return "The value at the end must be less than the cost.";
  if (/fixed_assets_life_months_check/.test(m)) return "The useful life must be between 1 and 1,200 months.";
  if (/fixed_assets_cost_check/.test(m)) return "The cost must be above zero.";
  if (/fixed_assets_name_check/.test(m)) return "The name must be 2 to 120 characters.";
  if (/invalid input syntax for type uuid/.test(m)) return "Choose an account on every line.";
  return m;
}

export function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
