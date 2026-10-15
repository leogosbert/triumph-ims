import type { createClient } from "@/lib/supabase/server";
import { isMissingSql } from "@/components/suggestions/meta";
import { formatMoney } from "@/lib/money";

/**
 * LeMoSp's own price book, service requests and billing (what LeMo Tech sells to each company).
 * Database: supabase/migrations/20261020000100_services_billing.sql.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const BILLING_MISSING =
  "This needs the services & billing database update (20261020000100_services_billing.sql). Run it in Supabase, then refresh this page.";

export type Category = "plan" | "extra" | "addon" | "usage" | "setup" | "training" | "support" | "service" | "playbook";
export type Unit = "month" | "once" | "hour" | "day" | "user_month" | "bundle" | "visit";

export type PriceItem = {
  key: string;
  category: Category;
  name: string;
  description: string;
  unit: Unit;
  price_tzs: number | null;
  price_usd: number | null;
  level: "small" | "medium" | "enterprise" | null;
  included_users: number | null;
  feature_keys: string[];
  playbook_id: string | null;
  requestable: boolean;
  public: boolean;
  active: boolean;
  sort: number;
};

export const CATEGORIES: { key: Category; title: string; lead: string }[] = [
  { key: "plan", title: "Plans", lead: "One monthly price per company, matching your business level." },
  { key: "extra", title: "Monthly extras", lead: "More people, branches, stores or storage than your plan includes." },
  { key: "addon", title: "Add-on modules", lead: "Features from a higher level, switched on one pack at a time." },
  { key: "usage", title: "Messages & AI bundles", lead: "SMS, WhatsApp and assistant questions, bought in bundles." },
  { key: "setup", title: "Setup & data", lead: "Getting started: onboarding, importing your lists, documents in your style." },
  { key: "training", title: "Training", lead: "Remote or on-site sessions for your team." },
  { key: "support", title: "Support", lead: "Faster answers and visits when you need them." },
  { key: "service", title: "Other services", lead: "Custom work, integrations, TRA fiscal receipts and hosting." },
  { key: "playbook", title: "Playbooks", lead: "Step-by-step guides with real situations and PDFs, given to your company on request." },
];

export const UNIT_LABEL: Record<Unit, string> = {
  month: "per month",
  once: "once",
  hour: "per hour",
  day: "per day",
  user_month: "per person, per month",
  bundle: "per bundle",
  visit: "per visit",
};

export type RequestStatus = "requested" | "approved" | "delivered" | "declined" | "cancelled" | "ended";

export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: "info" | "ok" | "warn" | "bad" | "off" }> = {
  requested: { label: "Waiting for LeMo Tech", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  delivered: { label: "Done", tone: "ok" },
  declined: { label: "Not approved", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "off" },
  ended: { label: "Ended", tone: "off" },
};

export type AccountStatus = "trial" | "active" | "grace" | "read_only" | "suspended" | "free";

export const ACCOUNT_STATUS: Record<AccountStatus, { label: string; tone: "info" | "ok" | "warn" | "bad" | "off"; help: string }> = {
  trial: { label: "Free trial", tone: "info", help: "Everything you enter now is kept when you start paying." },
  active: { label: "Active", tone: "ok", help: "Thank you. Your subscription is up to date." },
  grace: { label: "Payment overdue", tone: "warn", help: "An invoice is past its due date. Please pay to keep full access." },
  read_only: { label: "Read-only", tone: "bad", help: "Pay the overdue invoice to add and change records again. You can still view, print and export." },
  suspended: { label: "Suspended", tone: "bad", help: "Only management can sign in, to pay or export. Your data is safe." },
  free: { label: "Free account", tone: "ok", help: "LeMo Tech has given your company free use." },
};

export const INVOICE_STATUS: Record<string, { label: string; tone: "info" | "ok" | "warn" | "bad" | "off" }> = {
  draft: { label: "Draft", tone: "off" },
  issued: { label: "Due", tone: "warn" },
  paid: { label: "Paid", tone: "ok" },
  void: { label: "Cancelled", tone: "off" },
};

export type CompanyBilling = {
  company_id: string;
  currency: "TZS" | "USD";
  cycle: "monthly" | "quarterly" | "annual";
  discount_pct: number;
  founding: boolean;
  status: AccountStatus;
  trial_ends_on: string | null;
  next_invoice_on: string | null;
  billing_name: string | null;
  billing_email: string | null;
  billing_tin: string | null;
};

export type PlatformInvoice = {
  id: string;
  company_id: string;
  number: string | null;
  currency: "TZS" | "USD";
  status: "draft" | "issued" | "paid" | "void";
  issued_on: string | null;
  due_on: string | null;
  period_start: string | null;
  period_end: string | null;
  subtotal: number;
  discount_pct: number;
  discount: number;
  vat_rate: number;
  vat: number;
  total: number;
  paid_amount: number;
  paid_on: string | null;
  paid_method: string | null;
  paid_ref: string | null;
  notes: string | null;
  void_reason: string | null;
  created_at: string;
};

export type InvoiceLine = { id: string; item_key: string | null; description: string; quantity: number; unit_price: number; amount: number; sort: number };

export type BillingSettings = {
  legal_name: string;
  tin: string;
  vrn: string;
  address: string;
  phone: string;
  email: string;
  bank_details: string;
  mobile_money: string;
  vat_rate: number;
  usd_rate: number;
  payment_days: number;
  invoice_note: string;
};

export const CYCLE_LABEL: Record<CompanyBilling["cycle"], string> = { monthly: "Monthly", quarterly: "Quarterly (5% off)", annual: "Annual (2 months free)" };

export function priceOf(item: Pick<PriceItem, "price_tzs" | "price_usd">, currency: "TZS" | "USD"): number | null {
  const v = currency === "USD" ? item.price_usd : item.price_tzs;
  return v === null || v === undefined ? null : Number(v);
}

/** "TZS 50,000 per month", "Free", or "Price on request" (the words go through tr() by the caller). */
export function priceText(item: PriceItem, currency: "TZS" | "USD", t: (s: string) => string): string {
  const p = priceOf(item, currency);
  if (p === null) return t("Price on request");
  if (p === 0) return item.category === "playbook" ? t("Free on request") : t("Included");
  return `${formatMoney(p, currency)} ${t(UNIT_LABEL[item.unit])}`;
}

export function overdue(inv: Pick<PlatformInvoice, "status" | "due_on">, today = new Date().toISOString().slice(0, 10)) {
  return inv.status === "issued" && !!inv.due_on && inv.due_on < today;
}

/** The whole price book (active items for companies; every item for LeMo Tech). ready=false before the SQL. */
export async function loadPriceBook(supabase: Supabase): Promise<{ ready: boolean; items: PriceItem[] }> {
  const { data, error } = await supabase
    .from("price_items")
    .select("key, category, name, description, unit, price_tzs, price_usd, level, included_users, feature_keys, playbook_id, requestable, public, active, sort")
    .order("sort")
    .order("name");
  if (error) return { ready: !isMissingSql(error), items: [] };
  return {
    ready: true,
    items: ((data ?? []) as PriceItem[]).map((i) => ({
      ...i,
      price_tzs: i.price_tzs === null ? null : Number(i.price_tzs),
      price_usd: i.price_usd === null ? null : Number(i.price_usd),
      feature_keys: i.feature_keys ?? [],
    })),
  };
}

export async function loadBillingSettings(supabase: Supabase): Promise<BillingSettings | null> {
  const { data, error } = await supabase
    .from("platform_billing_settings")
    .select("legal_name, tin, vrn, address, phone, email, bank_details, mobile_money, vat_rate, usd_rate, payment_days, invoice_note")
    .maybeSingle();
  if (error || !data) return null;
  const s = data as BillingSettings;
  return { ...s, vat_rate: Number(s.vat_rate), usd_rate: Number(s.usd_rate) };
}

export function planFor(items: PriceItem[], level: string | null | undefined): PriceItem | null {
  return items.find((i) => i.category === "plan" && i.level === level) ?? null;
}

export function extraUserFor(items: PriceItem[], level: string | null | undefined): PriceItem | null {
  return items.find((i) => i.category === "extra" && i.level === level && i.unit === "user_month") ?? null;
}

export type EstimateLine = { key: string | null; description: string; quantity: number; unit_price: number; amount: number; requestId?: string };

/**
 * What a company's next regular bill would be: the plan for its level, people above the plan's
 * included users (drivers on the cheaper driver price), and approved monthly extras and add-ons.
 */
export function estimateMonthly(opts: {
  items: PriceItem[];
  level: string | null | undefined;
  currency: "TZS" | "USD";
  members: number;
  drivers: number;
  monthly: { key: string; quantity: number; requestId?: string }[];
}): EstimateLine[] {
  const { items, level, currency } = opts;
  const lines: EstimateLine[] = [];
  const plan = planFor(items, level);
  if (plan) {
    const p = priceOf(plan, currency) ?? 0;
    lines.push({ key: plan.key, description: plan.name, quantity: 1, unit_price: p, amount: p });
    const included = plan.included_users ?? 0;
    const office = Math.max(0, opts.members - opts.drivers);
    const extraOffice = Math.max(0, office - included);
    // Drivers fill free places first, then each costs the driver price.
    const freeLeft = Math.max(0, included - office);
    const extraDrivers = Math.max(0, opts.drivers - freeLeft);
    const extra = extraUserFor(items, level);
    if (extra && extraOffice > 0) {
      const u = priceOf(extra, currency) ?? 0;
      lines.push({ key: extra.key, description: extra.name, quantity: extraOffice, unit_price: u, amount: u * extraOffice });
    }
    const driver = items.find((i) => i.key === "extra_driver");
    if (driver && extraDrivers > 0) {
      const u = priceOf(driver, currency) ?? 0;
      lines.push({ key: driver.key, description: driver.name, quantity: extraDrivers, unit_price: u, amount: u * extraDrivers });
    }
  }
  for (const m of opts.monthly) {
    const item = items.find((i) => i.key === m.key);
    if (!item || (item.unit !== "month" && item.unit !== "user_month")) continue;
    // Add-ons already included in the plan's level are free.
    const u = priceOf(item, currency);
    if (u === null) continue;
    lines.push({ key: item.key, description: item.name, quantity: m.quantity, unit_price: u, amount: u * m.quantity, requestId: m.requestId });
  }
  return lines;
}

export const sum = (lines: { amount: number }[]) => lines.reduce((a, l) => a + l.amount, 0);
