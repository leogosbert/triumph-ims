import { daysUntil } from "@/lib/stock";

/** Fleet lists (client-safe). English labels are keys; screens translate them with tr(). */
export const VEHICLE_KINDS: Record<string, string> = {
  truck: "Truck",
  pickup: "Pick-up",
  van: "Van",
  car: "Car",
  motorcycle: "Motorcycle",
  other: "Other",
};

export const LOG_KINDS: Record<string, string> = {
  fuel: "Fuel",
  service: "Service",
  repair: "Repair",
  tyres: "Tyres",
  insurance: "Insurance",
  inspection: "Inspection",
  odometer: "Kilometres reading",
  other: "Other",
};

/** Kinds a driver may record (the rest are for management and the store). */
export const DRIVER_LOG_KINDS = ["fuel", "odometer", "repair", "other"];

/** "T 482 DKL" and "t482dkl" are the same plate. */
export function plateKey(plate: string | null | undefined) {
  return (plate ?? "").replace(/\s+/g, "").toUpperCase();
}

export type Vehicle = {
  id: string;
  plate: string;
  name: string | null;
  kind: string;
  driver_id: string | null;
  insurance_expires: string | null;
  inspection_expires: string | null;
  service_due_on: string | null;
  service_due_km: number | null;
  odometer_km: number | null;
  remind_days: number;
  active: boolean;
};

/** The dates that are passed or coming up, most urgent first. */
export function dueSoon(v: Vehicle) {
  const out: { label: string; on: string; days: number }[] = [];
  const add = (label: string, on: string | null) => {
    if (!on) return;
    const d = daysUntil(on);
    if (d <= v.remind_days) out.push({ label, on, days: d });
  };
  add("Insurance", v.insurance_expires);
  add("Inspection", v.inspection_expires);
  add("Service", v.service_due_on);
  if (v.service_due_km != null && v.odometer_km != null && v.service_due_km - v.odometer_km <= 500) {
    out.push({ label: "Service", on: "", days: v.service_due_km <= v.odometer_km ? -1 : 0 });
  }
  return out.sort((a, b) => a.days - b.days);
}
