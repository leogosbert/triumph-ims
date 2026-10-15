import { daysFromToday } from "@/lib/services";

export type EquipmentBadge = { label: string; tone: string };

/** "Service due" (within 14 days or past) and the warranty state. English labels; screens translate them. */
export function equipmentBadges(e: { active: boolean; next_service_on: string | null; warranty_until: string | null }): EquipmentBadge[] {
  if (!e.active) return [{ label: "Not in use", tone: "off" }];
  const out: EquipmentBadge[] = [];
  const s = daysFromToday(e.next_service_on);
  if (s !== null && s <= 14) out.push({ label: s < 0 ? "Service overdue" : "Service due", tone: s < 0 ? "bad" : "warn" });
  const w = daysFromToday(e.warranty_until);
  if (w !== null && w >= 0) out.push(w <= 30 ? { label: "Warranty ends soon", tone: "warn" } : { label: "Under warranty", tone: "ok" });
  return out;
}
