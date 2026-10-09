import { tr } from "@/lib/tr";

/** How long until a tender closes, translated ("3 days left"); urgent within 2 days. Server only. */
export function closingIn(iso: string): { text: string; urgent: boolean } {
  const hours = (new Date(iso).getTime() - Date.now()) / 3_600_000;
  if (hours < 0) return { text: tr("closed"), urgent: false };
  if (hours < 24) return { text: `${Math.max(1, Math.round(hours))} ${tr("hours left")}`, urgent: true };
  const days = Math.floor(hours / 24);
  return { text: `${days} ${days === 1 ? tr("day left") : tr("days left")}`, urgent: days <= 2 };
}
