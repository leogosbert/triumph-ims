import { todayTz } from "@/lib/sales";

/** Ready-made periods for reports. "custom" uses the from/to dates the person typed. */
export const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "this_week", label: "This week" },
  { key: "last_week", label: "Last week" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_30", label: "Last 30 days" },
  { key: "this_quarter", label: "This quarter" },
  { key: "last_quarter", label: "Last quarter" },
  { key: "this_year", label: "This year" },
  { key: "last_year", label: "Last year" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Choose dates" },
] as const;

export type PresetKey = (typeof PRESETS)[number]["key"];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function d(iso: string) {
  return new Date(`${iso}T00:00:00Z`);
}
function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}
function addDays(s: string, days: number) {
  const x = d(s);
  x.setUTCDate(x.getUTCDate() + days);
  return iso(x);
}

/** A period: from and to are both included; null means no limit on that side. */
export type Period = { preset: PresetKey; from: string | null; to: string | null };

export function isPreset(v: unknown): v is PresetKey {
  return typeof v === "string" && PRESETS.some((p) => p.key === v);
}

export function resolvePeriod(preset: PresetKey, from?: string | null, to?: string | null, today = todayTz()): Period {
  const t = d(today);
  const y = t.getUTCFullYear();
  const m = t.getUTCMonth();
  const monday = addDays(today, -((t.getUTCDay() + 6) % 7));
  const q = Math.floor(m / 3);
  const first = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm, 1)));
  const last = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm + 1, 0)));
  switch (preset) {
    case "today":
      return { preset, from: today, to: today };
    case "yesterday":
      return { preset, from: addDays(today, -1), to: addDays(today, -1) };
    case "this_week":
      return { preset, from: monday, to: addDays(monday, 6) };
    case "last_week":
      return { preset, from: addDays(monday, -7), to: addDays(monday, -1) };
    case "this_month":
      return { preset, from: first(y, m), to: last(y, m) };
    case "last_month":
      return { preset, from: first(y, m - 1), to: last(y, m - 1) };
    case "last_30":
      return { preset, from: addDays(today, -29), to: today };
    case "this_quarter":
      return { preset, from: first(y, q * 3), to: last(y, q * 3 + 2) };
    case "last_quarter":
      return { preset, from: first(y, q * 3 - 3), to: last(y, q * 3 - 1) };
    case "this_year":
      return { preset, from: `${y}-01-01`, to: `${y}-12-31` };
    case "last_year":
      return { preset, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "all":
      return { preset, from: null, to: null };
    case "custom": {
      let f = from && ISO.test(from) ? from : null;
      let e = to && ISO.test(to) ? to : null;
      if (f && e && f > e) [f, e] = [e, f];
      return { preset, from: f, to: e };
    }
  }
}

/** Start of a day in Tanzania, for comparing with timestamps. */
export function dayStart(isoDate: string) {
  return `${isoDate}T00:00:00+03:00`;
}
/** Start of the next day in Tanzania (use with "less than"). */
export function nextDayStart(isoDate: string) {
  return `${addDays(isoDate, 1)}T00:00:00+03:00`;
}

/** The calendar day (in Tanzania) of a timestamp. */
export function localDay(ts: string | null | undefined) {
  if (!ts) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date(ts));
}

export function shortDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(d(isoDate.slice(0, 10)));
}
