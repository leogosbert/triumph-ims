import { siteUrl } from "@/lib/supabase/env";

/**
 * Getting paid: shared names and small helpers (no server imports, no secrets: also used by
 * client components). Server code lives in tra-vfd.ts, gateways/, sms-beem.ts and jobs.ts.
 */

export const FISCAL_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Receipt to enter", tone: "warn" },
  queued: { label: "Sending to TRA", tone: "info" },
  posting: { label: "Sending to TRA", tone: "info" },
  posted: { label: "Accepted by TRA", tone: "ok" },
  failed: { label: "Not sent yet", tone: "bad" },
  recorded: { label: "EFD receipt entered", tone: "ok" },
  void: { label: "Not needed", tone: "off" },
};

export const PAY_ORDER_STATUS: Record<string, { label: string; tone: string }> = {
  created: { label: "Started", tone: "info" },
  pending: { label: "Waiting for the client", tone: "info" },
  paid: { label: "Paid", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export const REMINDER_STATUS: Record<string, { label: string; tone: string }> = {
  sending: { label: "Sending", tone: "info" },
  sent: { label: "Sent", tone: "ok" },
  failed: { label: "Failed", tone: "bad" },
  skipped: { label: "Not sent", tone: "off" },
};

export const REMINDER_CHANNELS: Record<string, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp" };

/** The public address of an invoice's pay link. */
export function payLinkUrl(code: string, base = siteUrl()): string {
  return `${base.replace(/\/$/, "")}/pay/${code}`;
}

/** "3 days before the due date", "On the due date", "7 days after the due date". */
export function stepLabel(step: number): string {
  if (step === 0) return "On the due date";
  const n = Math.abs(step);
  return step < 0 ? `${n} day${n === 1 ? "" : "s"} before the due date` : `${n} day${n === 1 ? "" : "s"} after the due date`;
}

/** "-3, 0, 7, 14" → [-3, 0, 7, 14] (sorted, unique, within -30..120). Null when it cannot be read. */
export function parseSchedule(text: string): number[] | null {
  const parts = text
    .split(/[,;\s]+/)
    .map((p) => p.trim().replace(/^\+/, "").replace(/[−–]/g, "-"))
    .filter(Boolean);
  if (!parts.length || parts.length > 8) return null;
  const out = new Set<number>();
  for (const p of parts) {
    if (!/^-?\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < -30 || n > 120) return null;
    out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}
