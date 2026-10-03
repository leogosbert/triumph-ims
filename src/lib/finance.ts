import { todayTz } from "@/lib/sales";

export const INVOICE_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "off" },
  issued: { label: "Unpaid", tone: "info" },
  partly_paid: { label: "Part paid", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "off" },
  overdue: { label: "Overdue", tone: "bad" },
};

export const BILL_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Unpaid", tone: "info" },
  partly_paid: { label: "Part paid", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "off" },
  overdue: { label: "Overdue", tone: "bad" },
};

export const PAY_METHODS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  mobile_money: "Mobile money",
  cheque: "Cheque",
  other: "Other",
};

export const COST_KINDS: Record<string, string> = {
  freight: "Freight",
  insurance: "Insurance",
  duty: "Import duty",
  clearing: "Clearing & forwarding",
  port: "Port charges",
  transport: "Local transport",
  bank: "Bank charges",
  commission: "Commission",
  other: "Other",
};

export const n = (v: unknown) => Number(v ?? 0);

/** Open = issued or part paid (invoices), open or part paid (bills). */
export function isOpen(status: string) {
  return status === "issued" || status === "partly_paid" || status === "open";
}

/** Days past the due date (0 or less = not overdue). */
export function daysOverdue(due: string | null | undefined, today = todayTz()) {
  if (!due) return 0;
  return Math.round((Date.parse(today) - Date.parse(due)) / 864e5);
}

/** Status shown to people: open documents past their due date show as overdue. */
export function shownStatus(status: string, due: string | null | undefined) {
  return isOpen(status) && daysOverdue(due) > 0 ? "overdue" : status;
}

export const AGING = ["Current", "1–30 days", "31–60 days", "61–90 days", "Over 90 days"] as const;

export function agingBucket(due: string | null | undefined) {
  const d = daysOverdue(due);
  if (d <= 0) return 0;
  if (d <= 30) return 1;
  if (d <= 60) return 2;
  if (d <= 90) return 3;
  return 4;
}

/** Amount still owed, converted to the base currency at the document's rate. */
export function openBase(doc: { total: unknown; amount_paid: unknown; exchange_rate: unknown }) {
  return (n(doc.total) - n(doc.amount_paid)) * n(doc.exchange_rate);
}

export function monthRange(ym?: string | null) {
  const today = todayTz();
  const m = ym && /^\d{4}-\d{2}$/.test(ym) ? ym : today.slice(0, 7);
  const [y, mm] = m.split("-").map(Number);
  const start = `${m}-01`;
  const next = mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, "0")}-01`;
  const prev = mm === 1 ? `${y - 1}-12` : `${y}-${String(mm - 1).padStart(2, "0")}`;
  const after = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${start}T00:00:00Z`));
  return { month: m, start, next, prev, after, label, isCurrent: m === today.slice(0, 7) };
}
