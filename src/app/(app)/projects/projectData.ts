import { hasRole, type RoleSet } from "@/lib/roles";

/**
 * Who may add and change projects and their milestones. The database allows management and sales
 * (projects_insert / projects_update / project_milestones_* policies), so the buttons follow that.
 */
export const canKeepProjects = (role: RoleSet) => hasRole(role, "management", "sales");

export type Project = {
  id: string;
  number: string;
  client_id: string;
  name: string;
  description: string | null;
  billing: string;
  budget_amount: number | null;
  budget_hours: number | null;
  default_rate: number | null;
  currency: string;
  starts_on: string | null;
  ends_on: string | null;
  manager_id: string | null;
  status: string;
};

export type Milestone = {
  id: string;
  title: string;
  due_on: string | null;
  amount: number | null;
  status: string;
  invoice_id: string | null;
  sort: number;
};

export type Entry = {
  id: string;
  user_id: string;
  work_date: string;
  hours: number;
  billable: boolean;
  rate: number | null;
  invoice_id: string | null;
  description: string | null;
};

export type InvoiceRow = { id: string; number: string | null; status: string; total: number | null; currency: string };

/** Hours shown with up to two decimals, e.g. 7.5. */
export function hoursText(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 });
}

/** Sum of invoices that count (cancelled ones are left out). */
export function invoicedTotal(invoices: InvoiceRow[]): number {
  return invoices.filter((i) => i.status !== "cancelled").reduce((s, i) => s + Number(i.total ?? 0), 0);
}
