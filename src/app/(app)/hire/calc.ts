import { hirePeriods } from "@/lib/services";

export type HireLine = { id: string; product_id: string; description: string; quantity: number; rate: number };
export type Hire = {
  id: string;
  number: string;
  client_id: string;
  site: string | null;
  contact: string | null;
  out_on: string;
  due_back_on: string | null;
  returned_on: string | null;
  rate_period: string;
  deposit: number | null;
  currency: string;
  status: string;
  invoiced_until: string | null;
  return_note: string | null;
  notes: string | null;
  created_by: string | null;
  client: { name: string } | null;
  lines?: HireLine[];
};

/** Adds days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The stretch of time on hire not invoiced yet: from the day after invoiced_until (or out_on) to the return date (or today). */
export function unbilledSpan(h: Pick<Hire, "out_on" | "invoiced_until" | "returned_on">, today: string) {
  const from = h.invoiced_until ? addDays(h.invoiced_until, 1) : h.out_on;
  const to = h.returned_on ?? today;
  return { from, to, open: to >= from };
}

/** Charge per period for all lines (quantity × rate). */
export function perPeriod(lines: HireLine[] | undefined): number {
  return (lines ?? []).reduce((s, l) => s + Number(l.quantity) * Number(l.rate), 0);
}

/** What the time between two days comes to, for these lines. */
export function chargeBetween(lines: HireLine[] | undefined, from: string, to: string, period: string): { periods: number; amount: number } {
  if (to < from) return { periods: 0, amount: 0 };
  const periods = hirePeriods(from, to, period);
  return { periods, amount: Math.round(periods * perPeriod(lines) * 100) / 100 };
}

export const isOverdue = (h: Pick<Hire, "status" | "due_back_on">, today: string) => h.status === "out" && !!h.due_back_on && h.due_back_on < today;
