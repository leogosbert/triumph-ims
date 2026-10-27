import { hasRole, type RoleSet } from "@/lib/roles";

/** Who adds and changes maintenance contracts. Mirrors the service_contracts insert/update policies. */
export const canKeepContracts = (role: RoleSet) => hasRole(role, "management", "sales");

/** Visits (and price periods) per month for each frequency. */
export const PER_MONTH: Record<string, number> = { monthly: 1, quarterly: 1 / 3, half_yearly: 1 / 6, yearly: 1 / 12 };

export type Contract = {
  id: string;
  number: string;
  client_id: string;
  title: string;
  frequency: string;
  starts_on: string;
  ends_on: string | null;
  next_visit_on: string | null;
  visit_title: string | null;
  checklist: unknown;
  response_hours: number | null;
  price: number | null;
  currency: string;
  equipment_id: string | null;
  site: string | null;
  status: string;
  notes: string | null;
};
