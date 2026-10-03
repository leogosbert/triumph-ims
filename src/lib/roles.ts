export const ROLES = ["management", "sales", "procurement", "warehouse", "driver", "finance"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  management: "Management",
  sales: "Sales",
  procurement: "Procurement",
  warehouse: "Warehouse",
  driver: "Driver",
  finance: "Finance",
};

export const ROLE_HINTS: Record<Role, string> = {
  management: "Sees everything, approves, manages settings and the team",
  sales: "Clients, RFQs, quotations and orders",
  procurement: "Suppliers, supplier prices and purchase orders",
  warehouse: "Stock, goods received and dispatches",
  driver: "Assigned deliveries and proof of delivery",
  finance: "Invoices, payments, receivables and payables",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}
