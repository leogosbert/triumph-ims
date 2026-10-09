/** Scheduled reports: how often, and on which day of the week (ISO: 1 = Monday). */
export const FREQUENCIES = [
  { key: "daily", label: "Every day (yesterday's figures)" },
  { key: "weekly", label: "Every week (last Monday to Sunday)" },
  { key: "monthly", label: "Every month, on the 1st (last month)" },
] as const;

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

/** The report's own settings (filters, columns, sort) without the dates: the schedule sets those. */
export function scheduleQuery(query: string) {
  const u = new URLSearchParams(query);
  for (const k of ["p", "from", "to"]) u.delete(k);
  return u.toString();
}
