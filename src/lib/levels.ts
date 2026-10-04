/**
 * Business levels: Small, Medium and Enterprise are progressive operating modes of the same app
 * (docs/PRODUCT-VISION.md). The level only sets the default experience; it is never a judgement
 * of the company, can be changed at any time and never deletes data.
 */

export type Level = "small" | "medium" | "enterprise";
export const LEVEL_ORDER: Level[] = ["small", "medium", "enterprise"];

export type LevelInfo = {
  key: Level;
  /** Short name, e.g. "Medium". */
  name: string;
  /** "Medium level" */
  title: string;
  /** One-line promise (the vision's wording). */
  promise: string;
  /** Who it is usually for. */
  forWho: string;
  /** Main modules a company gets at this level. */
  modules: string[];
  /** What to do first after choosing this level. */
  firstSteps: { label: string; href: string }[];
};

export const LEVELS: Record<Level, LevelInfo> = {
  small: {
    key: "small",
    name: "Small",
    title: "Small level",
    promise: "Essential tools for starting and organizing the business.",
    forWho: "New and small suppliers: a few people, a few dozen customers, one shop or store.",
    modules: ["Customers", "Products & stock", "Quotations", "Invoices & payments", "Who owes us", "Suppliers & purchases", "Deliveries"],
    firstSteps: [
      { label: "Add your company details and logo", href: "/settings/company" },
      { label: "Add your first customers and products", href: "/clients/new" },
      { label: "Send your first quotation", href: "/quotations/new" },
      { label: "Record an invoice and the payment", href: "/invoices/new" },
    ],
  },
  medium: {
    key: "medium",
    name: "Medium",
    title: "Medium level",
    promise: "Advanced tools for growing sales, inventory, procurement, customers, and employees.",
    forWho: "Growing suppliers with a team, corporate clients, several suppliers and more stock.",
    modules: [
      "Everything in Small",
      "Supplier quotations & comparison",
      "Goods received & supplier bills",
      "Multiple stores",
      "Credit limits & approvals",
      "Multiple currencies",
      "Profit analysis",
      "Driver app",
    ],
    firstSteps: [
      { label: "Invite your team and give each person a role", href: "/settings/team" },
      { label: "Set approval limits for quotations and purchase orders", href: "/settings/company" },
      { label: "Load your clients, suppliers and products from a spreadsheet", href: "/import" },
      { label: "Ask suppliers for prices and compare them", href: "/supplier-rfqs" },
    ],
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    title: "Enterprise level",
    promise: "Complete tools for complex operations, multiple locations, departments, and large-scale procurement and distribution.",
    forWho: "Large suppliers with branches, many stores, departments and high volumes.",
    modules: [
      "Everything in Medium",
      "Branches & business units",
      "Consolidated head-office reports",
      "Budgets & cash-flow forecasting",
      "Multi-level approvals",
      "Fleet tracking & integrations",
    ],
    firstSteps: [
      { label: "Invite your team and give each person a role", href: "/settings/team" },
      { label: "Set up your stores", href: "/warehouses" },
      { label: "Turn on two-step verification for everyone", href: "/settings/security" },
      { label: "See which features are on for your company", href: "/settings/features" },
    ],
  },
};

export function isLevel(v: unknown): v is Level {
  return v === "small" || v === "medium" || v === "enterprise";
}

export function levelRank(l: Level | null | undefined): number {
  return l === "small" ? 1 : l === "enterprise" ? 3 : 2;
}

export function nextLevel(l: Level): Level | null {
  return l === "small" ? "medium" : l === "medium" ? "enterprise" : null;
}

/** Answers from onboarding (companies.business_profile). All optional. */
export type BusinessProfile = {
  employees?: number;
  customers?: number;
  suppliers?: number;
  products?: number;
  warehouses?: number;
  branches?: number;
  monthly_sales?: number;
  monthly_transactions?: number;
  imports?: boolean;
  tenders?: boolean;
  corporate_clients?: boolean;
  services?: boolean;
  credit?: boolean;
  approvals?: boolean;
  activities?: string[];
};

export const ACTIVITIES: { key: string; label: string }[] = [
  { key: "general_supplier", label: "General supplier" },
  { key: "distributor", label: "Distributor" },
  { key: "wholesaler", label: "Wholesaler" },
  { key: "importer", label: "Importer" },
  { key: "retailer", label: "Retailer" },
  { key: "manufacturer_supplier", label: "Manufacturer-supplier" },
  { key: "contractor", label: "Contractor" },
  { key: "service_provider", label: "Service provider" },
];

/** Thresholds, kept here in one place so the recommendation is transparent. */
export const LEVEL_THRESHOLDS = {
  enterprise: { branches: 1, warehouses: 3, employees: 50, products: 5000, monthly_sales: 500_000_000, monthly_transactions: 2000 },
  medium: { employees: 5, customers: 50, products: 200, warehouses: 1, monthly_sales: 30_000_000, monthly_transactions: 100 },
} as const;

const fmt = (n: number) => n.toLocaleString("en-GB");

function fill(template: string, vars: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/**
 * Suggests a starting level from the onboarding answers, with plain reasons.
 * `t` translates the English templates (tr / useTr); numbers are filled in afterwards.
 */
export function recommendLevel(profile: BusinessProfile, t: (s: string) => string = (s) => s): { level: Level; reasons: string[] } {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const p = {
    employees: num(profile.employees),
    customers: num(profile.customers),
    products: num(profile.products),
    warehouses: num(profile.warehouses),
    branches: num(profile.branches),
    monthly_sales: num(profile.monthly_sales),
    monthly_transactions: num(profile.monthly_transactions),
  };
  const E = LEVEL_THRESHOLDS.enterprise;
  const M = LEVEL_THRESHOLDS.medium;
  const say = (tpl: string, vars: Record<string, string | number>) => fill(t(tpl), vars);

  const ent: string[] = [];
  if (p.branches > E.branches) ent.push(say("You have {n} branches (more than {limit}).", { n: fmt(p.branches), limit: fmt(E.branches) }));
  if (p.warehouses > E.warehouses) ent.push(say("You keep stock in {n} stores (more than {limit}).", { n: fmt(p.warehouses), limit: fmt(E.warehouses) }));
  if (p.employees > E.employees) ent.push(say("You have {n} employees (more than {limit}).", { n: fmt(p.employees), limit: fmt(E.employees) }));
  if (p.products > E.products) ent.push(say("You manage {n} products (more than {limit}).", { n: fmt(p.products), limit: fmt(E.products) }));
  if (p.monthly_sales > E.monthly_sales)
    ent.push(say("Monthly sales of about TZS {n} (more than TZS {limit}).", { n: fmt(p.monthly_sales), limit: fmt(E.monthly_sales) }));
  if (p.monthly_transactions > E.monthly_transactions)
    ent.push(say("About {n} transactions a month (more than {limit}).", { n: fmt(p.monthly_transactions), limit: fmt(E.monthly_transactions) }));
  if (ent.length) return { level: "enterprise", reasons: ent };

  const med: string[] = [];
  if (p.employees > M.employees) med.push(say("You have {n} employees (more than {limit}).", { n: fmt(p.employees), limit: fmt(M.employees) }));
  if (p.customers > M.customers) med.push(say("You serve {n} customers (more than {limit}).", { n: fmt(p.customers), limit: fmt(M.customers) }));
  if (p.products > M.products) med.push(say("You manage {n} products (more than {limit}).", { n: fmt(p.products), limit: fmt(M.products) }));
  if (p.warehouses > M.warehouses) med.push(say("You keep stock in {n} stores (more than {limit}).", { n: fmt(p.warehouses), limit: fmt(M.warehouses) }));
  if (p.monthly_sales > M.monthly_sales)
    med.push(say("Monthly sales of about TZS {n} (more than TZS {limit}).", { n: fmt(p.monthly_sales), limit: fmt(M.monthly_sales) }));
  if (p.monthly_transactions > M.monthly_transactions)
    med.push(say("About {n} transactions a month (more than {limit}).", { n: fmt(p.monthly_transactions), limit: fmt(M.monthly_transactions) }));
  if (profile.tenders) med.push(t("You take part in tenders."));
  if (profile.approvals) med.push(t("You need approval levels for quotations or purchases."));
  if (profile.imports) med.push(t("You import goods, so you need several currencies and landed costs."));
  if (profile.credit && profile.corporate_clients) med.push(t("You sell on credit to corporate clients, so credit limits and terms matter."));
  if (med.length) return { level: "medium", reasons: med };

  return {
    level: "small",
    reasons: [
      say("Your answers fit the essential tools: up to {e} employees, {c} customers and {p} products.", {
        e: fmt(M.employees),
        c: fmt(M.customers),
        p: fmt(M.products),
      }),
      t("You can switch on single features or move up whenever you need to."),
    ],
  };
}
