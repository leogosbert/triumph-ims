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
  seeFinance: ["management", "finance"],
  seeInvoices: ["management", "finance", "sales"],
  editInvoices: ["management", "finance"],
  voidPayments: ["management"],
  seeBills: ["management", "finance", "procurement"],
  editBills: ["management", "finance"],
  seeProfit: ["management", "finance"],
  editOrderCosts: ["management", "finance", "procurement"],
  /** Expenses: everyone records their own; these roles see, change and void all of them. */
  manageExpenses: ["management", "finance"],
  /** Tick payments and expenses as checked against the bank or mobile-money statement. */
  reconcile: ["management", "finance"],
  followUpQuotes: ["management", "sales"],
  followUpInvoices: ["management", "finance", "sales"],
  /** Pipeline, client activities and dates, tenders; adding and changing contracts. */
  seeCrm: ["management", "sales"],
  /** Contracts and contract prices can be read by finance too. */
  seeContracts: ["management", "sales", "finance"],
  /** Stock transfers between stores: prepared, sent and received by these roles (everyone who sees stock can follow them). */
  moveStock: ["management", "warehouse"],
  /** Purchase requests: everyone except drivers asks; management approves; procurement orders. */
  requestPurchases: ["management", "sales", "procurement", "warehouse", "finance"],
  seeAllRequests: ["management", "procurement"],
  /** Reorder suggestions (what to buy, how much). */
  seeReorder: ["management", "procurement", "warehouse"],
  /** Business insights: supplier performance, slow stock, quotation conversion, cross-selling. */
  seeInsights: ["management"],
  /** The documents library: everyone except drivers. */
  seeDocuments: ["management", "sales", "procurement", "warehouse", "finance"],
  /** Budgets vs actual and the cash-flow forecast. */
  planFinance: ["management", "finance"],
  /** Purchase planning from sales history. */
  planPurchases: ["management", "procurement", "warehouse"],
  /** Fleet: seen by these roles; vehicles kept by management and warehouse; drivers add fuel and kilometres. */
  seeFleet: ["management", "warehouse", "finance", "driver"],
  editFleet: ["management", "warehouse"],
  logFleet: ["management", "warehouse", "driver"],
  /** Branches: add them, put stores and people in them, move documents between them. */
  manageBranches: ["management"],
  /** Approval steps for purchase orders. */
  setApprovals: ["management"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
