import { todayTz } from "@/lib/services";

/** A YYYY-MM-DD date moved by a number of days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday of the week holding a date (today in Dar es Salaam when none or not a date). */
export function mondayOf(date?: string | null): string {
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? date : todayTz();
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

export function hoursText(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 });
}
