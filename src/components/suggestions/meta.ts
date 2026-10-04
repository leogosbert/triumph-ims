/**
 * Shared definitions for the Suggestion Box and the LeMo Tech admin platform (Stage 11).
 * Pure data: safe to import from server and client components.
 */

export type SuggestionCategory =
  | "sales"
  | "customers"
  | "procurement"
  | "suppliers"
  | "inventory"
  | "warehouse"
  | "finance"
  | "accounting"
  | "logistics"
  | "employees"
  | "technology"
  | "reporting"
  | "security"
  | "hse"
  | "business_growth"
  | "other";

export const SUGGESTION_CATEGORIES: { key: SuggestionCategory; label: string; help: string }[] = [
  { key: "sales", label: "Sales", help: "Win more orders, follow up quotations, price better." },
  { key: "customers", label: "Customers", help: "Serve customers better, faster answers, fewer complaints." },
  { key: "procurement", label: "Procurement", help: "Buy smarter: better prices, faster purchase orders." },
  { key: "suppliers", label: "Suppliers", help: "Find better suppliers, improve delivery times and quality." },
  { key: "inventory", label: "Inventory", help: "Avoid running out, reduce old or slow-moving stock." },
  { key: "warehouse", label: "Warehouse", help: "Store, find and issue goods more easily and safely." },
  { key: "finance", label: "Finance", help: "Collect money faster, reduce costs, improve cash flow." },
  { key: "accounting", label: "Accounting", help: "Cleaner records, invoices, receipts and tax work." },
  { key: "logistics", label: "Logistics", help: "Deliver on time, plan trips, reduce transport costs." },
  { key: "employees", label: "Employees", help: "Training, teamwork, working conditions and motivation." },
  { key: "technology", label: "Technology", help: "Better tools, phones, internet or use of this app." },
  { key: "reporting", label: "Reporting", help: "Reports and numbers that help us decide better." },
  { key: "security", label: "Security", help: "Protect money, stock, data and passwords." },
  { key: "hse", label: "Health, safety & environment", help: "Prevent accidents, handle chemicals safely, protect the environment." },
  { key: "business_growth", label: "Business growth", help: "New customers, new products, new markets." },
  { key: "other", label: "Other", help: "Anything else that would make us better." },
];

export const CATEGORY_KEYS = SUGGESTION_CATEGORIES.map((c) => c.key) as string[];

export function categoryLabel(key: string | null | undefined): string {
  return SUGGESTION_CATEGORIES.find((c) => c.key === key)?.label ?? key ?? "";
}

export type SuggestionStatus =
  | "submitted"
  | "under_review"
  | "needs_clarification"
  | "approved"
  | "rejected"
  | "assigned"
  | "implemented"
  | "archived";

export const SUGGESTION_STATUS: Record<string, { label: string; tone: string }> = {
  submitted: { label: "Submitted", tone: "info" },
  under_review: { label: "Under review", tone: "warn" },
  needs_clarification: { label: "Needs clarification", tone: "bad" },
  approved: { label: "Approved", tone: "ok" },
  assigned: { label: "Assigned", tone: "info" },
  rejected: { label: "Not taken forward", tone: "off" },
  implemented: { label: "Implemented", tone: "ok" },
  archived: { label: "Archived", tone: "off" },
};

export const LEVELS = ["small", "medium", "enterprise"] as const;
export type BusinessLevel = (typeof LEVELS)[number];

export const LEVEL_LABEL: Record<string, string> = {
  small: "Small",
  medium: "Medium",
  enterprise: "Enterprise",
};

/** Plain-English area of the product that a suggestion category points to (used by admin insights). */
export const CATEGORY_AREA: Record<string, string> = {
  sales: "the quotation and sales screens",
  customers: "customer records and follow-ups",
  procurement: "purchase orders and supplier quotations",
  suppliers: "supplier records and supplier performance",
  inventory: "the inventory module",
  warehouse: "stores, receiving and stock movements",
  finance: "invoices, payments and receivables",
  accounting: "accounting records and exports",
  logistics: "deliveries and the driver app",
  employees: "team roles and permissions",
  technology: "app speed, offline use and ease of use",
  reporting: "reports and dashboards",
  security: "sign-in and security settings",
  hse: "safety documents (SDS, certificates)",
  business_growth: "growth recommendations",
  other: "general usability",
};

/** True when the error means the Stage 11 SQL has not been run yet (table or function missing). */
export function isMissingSql(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (["PGRST202", "PGRST205", "42P01", "42883", "42704"].includes(code)) return true;
  return /does not exist|schema cache|could not find the (function|table)/i.test(error.message ?? "");
}

export const STAGE11_MISSING = "This needs the Stage 11 database update. Run it in Supabase, then refresh this page.";
