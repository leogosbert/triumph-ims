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

/** What each role may do. Mirrors the database rules, which are the real guard. */
const PERMISSIONS = {
  editClients: ["management", "sales", "finance"],
  setCreditLimit: ["management", "finance"],
  seeSuppliers: ["management", "procurement", "finance", "warehouse"],
  editSuppliers: ["management", "procurement"],
  editProducts: ["management", "procurement", "sales"],
  seeCosts: ["management", "procurement", "finance"],
  editCosts: ["management", "procurement"],
  importData: ["management"],
  seeSales: ["management", "sales", "procurement", "finance"],
  editSales: ["management", "sales"],
  approveQuotes: ["management"],
  seePurchasing: ["management", "procurement", "finance", "warehouse"],
  editPurchasing: ["management", "procurement"],
  approvePOs: ["management"],
  seeStock: ["management", "sales", "procurement", "warehouse", "finance"],
  adjustStock: ["management", "warehouse"],
  receiveGoods: ["management", "warehouse", "procurement"],
  seeDeliveries: ["management", "sales", "warehouse", "finance"],
  editDeliveries: ["management", "sales", "warehouse"],
  dispatch: ["management", "warehouse"],
  manageWarehouses: ["management"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
