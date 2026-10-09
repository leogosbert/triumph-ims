import type { createClient } from "@/lib/supabase/server";
import { stage13Ready, type Company } from "@/lib/context";
import type { Features } from "@/lib/features";
import { can, type Role } from "@/lib/roles";
import { todayTz } from "@/lib/sales";
import { isPreset, resolvePeriod, shortDate, type Period } from "@/lib/reports/dates";
import { KIND_LABELS, MAX_ROWS, METHOD_LABELS, REPORTS, type Cell, type Col, type FilterKey, type ReportDef, type Row } from "@/lib/reports/defs";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type SP = Record<string, string | string[] | undefined>;

export type ReportParams = {
  period: Period;
  cols: string[];
  sort: string;
  dir: "asc" | "desc";
  filters: Partial<Record<FilterKey, string>>;
  q: string;
};

const FILTER_KEYS: FilterKey[] = ["client", "supplier", "warehouse", "status", "method", "kind", "category"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reports this person may open (their role and the company's switched-on features). */
export function reportsFor(role: Role, features: Pick<Features, "on">) {
  return REPORTS.filter((r) => (!r.perm || can(role, r.perm)) && features.on(r.feature));
}

/** Can this person open this report? */
export function mayOpen(def: ReportDef, role: Role, features: Pick<Features, "on">) {
  return (!def.perm || can(role, def.perm)) && features.on(def.feature);
}

function first(v: string | string[] | undefined) {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function parseParams(def: ReportDef, sp: SP): ReportParams {
  const preset = isPreset(first(sp.p)) ? (first(sp.p) as Period["preset"]) : def.defaultPreset;
  const period = resolvePeriod(preset, first(sp.from) || null, first(sp.to) || null);
  // A report "as at" a day only needs the end date.
  if (def.date.asAt) {
    period.from = null;
    if (!period.to) period.to = todayTz();
  }
  const raw = ([] as string[]).concat(sp.cols ?? []).flatMap((c) => c.split(","));
  const keys = new Set(def.cols.map((c) => c.key));
  let cols = def.cols.filter((c) => raw.includes(c.key)).map((c) => c.key);
  if (cols.length === 0) cols = def.cols.filter((c) => !c.off).map((c) => c.key);
  const sort = keys.has(first(sp.sort)) ? first(sp.sort) : def.sort.key;
  const dir = first(sp.dir) === "asc" || first(sp.dir) === "desc" ? (first(sp.dir) as "asc" | "desc") : sort === def.sort.key ? def.sort.dir : "asc";
  const filters: ReportParams["filters"] = {};
  for (const k of FILTER_KEYS) {
    if (!def.filters.includes(k)) continue;
    const v = first(sp[k]).trim().slice(0, 120);
    if (!v) continue;
    if ((k === "client" || k === "supplier" || k === "warehouse") && !UUID.test(v)) continue;
    filters[k] = v;
  }
  return { period, cols, sort, dir, filters, q: first(sp.q).trim().slice(0, 100) };
}

/** The same choices as a query string, for the PDF / Excel links and saved reports. */
export function toQuery(def: ReportDef, p: ReportParams) {
  const u = new URLSearchParams();
  u.set("p", p.period.preset);
  if (p.period.preset === "custom") {
    if (p.period.from) u.set("from", p.period.from);
    if (p.period.to) u.set("to", p.period.to);
  }
  const defaults = def.cols.filter((c) => !c.off).map((c) => c.key);
  if (p.cols.join(",") !== defaults.join(",")) u.set("cols", p.cols.join(","));
  if (p.sort !== def.sort.key || p.dir !== def.sort.dir) {
    u.set("sort", p.sort);
    u.set("dir", p.dir);
  }
  for (const [k, v] of Object.entries(p.filters)) if (v) u.set(k, v);
  if (p.q) u.set("q", p.q);
  return u.toString();
}

export type ReportResult = {
  rows: Row[];
  cols: Col[];
  totals: Row | null;
  /** The loader hit the row limit: the report may be incomplete. */
  capped: boolean;
};

function compare(a: Cell, b: Cell) {
  if (a === null || a === "") return b === null || b === "" ? 0 : 1;
  if (b === null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

export async function runReport(
  def: ReportDef,
  supabase: Supabase,
  company: Pick<Company, "id" | "base_currency" | "quote_followup_days">,
  p: ReportParams,
): Promise<ReportResult> {
  const loaded = await def.load({
    supabase,
    companyId: company.id,
    base: company.base_currency,
    from: p.period.from,
    to: p.period.to,
    today: todayTz(),
    filters: p.filters,
    stage13: stage13Ready(company),
  });
  let rows = loaded;
  for (const [k, v] of Object.entries(p.filters) as [FilterKey, string][]) {
    const field = `_${k}`;
    if (k === "status") continue;
    rows = rows.filter((r) => !(field in r) || String(r[field] ?? "") === v);
  }
  if (def.statuses) {
    const chosen = p.filters.status;
    const allowed = chosen === "*" ? null : chosen ? [chosen] : (def.defaultStatuses ?? null);
    if (allowed) rows = rows.filter((r) => allowed.includes(String(r._status ?? "")));
  }
  const cols = p.cols.map((k) => def.cols.find((c) => c.key === k)!).filter(Boolean);
  if (p.q) {
    const q = p.q.toLowerCase();
    const textCols = def.cols.filter((c) => c.type === "text" || c.type === "label");
    rows = rows.filter((r) => textCols.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q)));
  }
  const sign = p.dir === "asc" ? 1 : -1;
  rows = [...rows].sort((a, b) => sign * compare(a[p.sort], b[p.sort]));

  let totals: Row | null = null;
  if (def.cols.some((c) => c.total)) {
    totals = {};
    for (const c of def.cols) if (c.total) totals[c.key] = Math.round(rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0) * 1000) / 1000;
    def.finishTotals?.(totals);
  }
  return { rows, cols, totals, capped: loaded.length >= MAX_ROWS };
}

/** Choices for the filter boxes. */
export async function filterOptions(def: ReportDef, supabase: Supabase, companyId: string) {
  const opt = (data: unknown) => ((data ?? []) as { id: string; name: string }[]).map((x) => ({ value: x.id, label: x.name }));
  const out: Partial<Record<FilterKey, { value: string; label: string }[]>> = {};
  const jobs: Promise<void>[] = [];
  if (def.filters.includes("client"))
    jobs.push(Promise.resolve(supabase.from("clients").select("id, name").eq("company_id", companyId).order("name").limit(3000)).then(({ data }) => void (out.client = opt(data))));
  if (def.filters.includes("supplier"))
    jobs.push(Promise.resolve(supabase.from("suppliers").select("id, name").eq("company_id", companyId).order("name").limit(3000)).then(({ data }) => void (out.supplier = opt(data))));
  if (def.filters.includes("warehouse"))
    jobs.push(Promise.resolve(supabase.from("warehouses").select("id, name").eq("company_id", companyId).order("name").limit(500)).then(({ data }) => void (out.warehouse = opt(data))));
  if (def.filters.includes("category") && def.key.startsWith("expense"))
    jobs.push(
      Promise.resolve(supabase.from("expense_categories").select("id, name").eq("company_id", companyId).order("sort").limit(500)).then(
        ({ data }) => void (out.category = opt(data)),
      ),
    );
  else if (def.filters.includes("category"))
    jobs.push(
      Promise.resolve(supabase.from("products").select("category").eq("company_id", companyId).not("category", "is", null).limit(10000)).then(({ data }) => {
        const cats = [...new Set(((data ?? []) as { category: string }[]).map((x) => x.category).filter(Boolean))].sort();
        out.category = cats.map((c) => ({ value: c, label: c }));
      }),
    );
  if (def.filters.includes("method")) out.method = Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label }));
  if (def.filters.includes("kind")) out.kind = Object.entries(KIND_LABELS[def.key] ?? {}).map(([value, label]) => ({ value, label }));
  await Promise.all(jobs);
  return out;
}

export const FILTER_LABELS: Record<FilterKey, string> = {
  client: "Client",
  supplier: "Supplier",
  warehouse: "Store",
  status: "Status",
  method: "Payment method",
  kind: "Type",
  category: "Category",
};

/** Column heading in the person's language, with the base currency filled in. */
export function colLabel(c: Col, base: string, t: (s: string) => string) {
  return t(c.label).replace("{base}", base);
}

/** "1 Oct 2026 – 31 Oct 2026", "All dates", or "At the end of 7 Oct 2026". */
export function periodText(def: ReportDef, p: Period, t: (s: string) => string) {
  if (def.date.asAt) return `${t("At the end of")} ${shortDate(p.to!)}`;
  if (!p.from && !p.to) return t("All dates");
  if (p.from && p.to) return p.from === p.to ? shortDate(p.from) : `${shortDate(p.from)} – ${shortDate(p.to)}`;
  return p.from ? `${t("From")} ${shortDate(p.from)}` : `${t("Up to")} ${shortDate(p.to!)}`;
}

/** The filters in words, for the printed header ("Client: Barrick · Status: Paid"). */
export function filterText(def: ReportDef, p: ReportParams, opts: Awaited<ReturnType<typeof filterOptions>>, t: (s: string) => string) {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(p.filters) as [FilterKey, string][]) {
    let label = v;
    if (k === "status") label = v === "*" ? t("All") : t(def.statuses?.[v] ?? v);
    else label = opts[k]?.find((o) => o.value === v)?.label ?? v;
    parts.push(`${t(FILTER_LABELS[k])}: ${k === "method" || k === "kind" ? t(label) : label}`);
  }
  if (!p.filters.status && def.statuses && def.defaultStatuses) parts.push(`${t("Status")}: ${t(def.defaultLabel ?? "Default")}`);
  if (p.q) parts.push(`${t("Search")}: “${p.q}”`);
  return parts.join(" · ");
}

/** Formats a cell for the screen and the PDF. */
export function cellText(c: Col, v: Cell, t: (s: string) => string): string {
  if (v === null || v === undefined || v === "") return "";
  switch (c.type) {
    case "label":
      return t(String(v));
    case "date":
      return shortDate(String(v));
    case "datetime":
      return new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(String(v)));
    case "money":
      return Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "qty":
      return Number(v).toLocaleString("en-GB", { maximumFractionDigits: 3 });
    case "int":
      return Number(v).toLocaleString("en-GB", { maximumFractionDigits: 0 });
    case "percent":
      return `${Number(v).toFixed(1)}%`;
    default:
      return String(v);
  }
}

