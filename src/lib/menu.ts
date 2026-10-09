import type { IconName } from "@/components/Icon";
import { featureForRoute, type FeatureRow } from "@/lib/features";
import { can, type Role } from "@/lib/roles";
import { adminUrl } from "@/lib/hosts";

/**
 * `feature`: hidden when that feature is switched off (defaults to the feature of the link's route).
 * `soon`: shown muted (a planned feature, in the "Grow" category).
 */
export type MenuItem = { href: string; title: string; sub: string; icon: IconName; plain?: boolean; feature?: string; soon?: boolean };
export type MenuCategory = { key: string; label: string; icon: IconName; items: MenuItem[] };

/**
 * Everything a person can open, grouped for the slide-up menu (phones) and the More page.
 * English text is the key; screens translate it with tr().
 */
export type MenuOptions = {
  /** Is a feature switched on? (getAppContext().features.on) */
  on?: (key?: string | null) => boolean;
  /** LeMo Tech staff see "Platform admin". */
  isPlatformAdmin?: boolean;
  /** The company's feature list (empty before the Stage 11 SQL): fills the "Grow" category. */
  features?: FeatureRow[];
};

export function moreMenu(role: Role, isManager: boolean, opts: MenuOptions = {}): MenuCategory[] {
  const on = opts.on ?? (() => true);
  const c = (perm: Parameters<typeof can>[1]) => can(role, perm);
  type Draft = { key: string; label: string; icon: IconName; items: (MenuItem | false)[] };
  const drafts: Draft[] = [
    {
      key: "sales",
      label: "Sales",
      icon: "sales",
      items: [
        c("seeCrm") && { href: "/crm", title: "Pipeline", sub: "Opportunities from first call to order, follow-ups", icon: "activity" },
        c("seeSales") && { href: "/rfqs", title: "Client RFQs", sub: "Requests for quotation from clients", icon: "inbox" },
        c("seeSales") && { href: "/quotations", title: "Quotations", sub: "Prices sent to clients, approvals", icon: "doc" },
        { href: "/clients", title: "Clients", sub: "Search, view and edit clients and their contacts", icon: "clients" },
        c("seeCrm") && { href: "/tenders", title: "Tenders", sub: "Bids with closing dates, checklist of papers, results", icon: "doc" },
        c("seeContracts") && { href: "/contracts", title: "Contracts", sub: "Framework agreements and agreed prices", icon: "doc" },
        c("seeSales") && { href: "/sales", title: "Sales overview", sub: "Client RFQs, quotations, approvals", icon: "sales" },
      ],
    },
    {
      key: "purchasing",
      label: "Purchasing",
      icon: "purchasing",
      items: [
        c("requestPurchases") && { href: "/requisitions", title: "Purchase requests", sub: "Ask for goods to buy; approve and turn into orders", icon: "inbox" },
        c("seePurchasing") && { href: "/supplier-rfqs", title: "Supplier RFQs", sub: "Ask suppliers for prices and compare", icon: "inbox" },
        c("seePurchasing") && { href: "/purchase-orders", title: "Purchase orders", sub: "Orders to suppliers, approvals", icon: "doc" },
        c("seeSuppliers") && { href: "/suppliers", title: "Suppliers", sub: "Search, view and edit suppliers", icon: "truck" },
        c("receiveGoods") && { href: "/receiving", title: "Receive goods", sub: "Record goods arriving against purchase orders", icon: "inbox" },
        c("seeBills") && { href: "/purchasing/match", title: "Order, receipt and bill check", sub: "Compare what was ordered, received and billed", icon: "check" },
        c("seePurchasing") && { href: "/purchasing", title: "Purchasing overview", sub: "Supplier RFQs and purchase orders", icon: "purchasing" },
      ],
    },
    {
      key: "stock",
      label: "Stock & delivery",
      icon: "stock",
      items: [
        role === "driver" && { href: "/driver", title: "My deliveries", sub: "Deliveries assigned to you, record proof of delivery", icon: "deliveries", plain: true },
        { href: "/products", title: "Products", sub: "Search, view and edit the catalogue", icon: "products" },
        c("seeStock") && { href: "/stock", title: "Stock", sub: "Stock on hand, batches, expiry, adjustments", icon: "stock" },
        c("seeReorder") && { href: "/stock/reorder", title: "What to reorder", sub: "Low stock with suggested quantities, order in one tap", icon: "purchasing" },
        c("seeStock") && { href: "/transfers", title: "Stock transfers", sub: "Move stock between stores", icon: "warehouse" },
        c("seeDeliveries") && { href: "/deliveries", title: "Deliveries", sub: "Delivery notes and proof of delivery", icon: "deliveries" },
        c("seeDeliveries") && { href: "/backorders", title: "Still to deliver", sub: "Accepted orders not fully delivered, with stock on hand", icon: "deliveries" },
        c("manageWarehouses") && { href: "/warehouses", title: "Stores", sub: "Warehouses and store locations", icon: "warehouse" },
      ],
    },
    {
      key: "finance",
      label: "Finance",
      icon: "finance",
      items: [
        c("seeInvoices") && { href: "/invoices", title: "Invoices", sub: "Invoices and what clients owe", icon: "receipt" },
        c("seeFinance") && { href: "/payments", title: "Payments received", sub: "Money received from clients", icon: "cash" },
        c("seeFinance") && { href: "/receivables", title: "Money owed to us", sub: "Who owes what, and for how long", icon: "finance" },
        c("seeBills") && { href: "/bills", title: "Supplier bills", sub: "Suppliers' invoices and payments", icon: "receipt" },
        c("seeFinance") && { href: "/payables", title: "Money we owe", sub: "What we owe suppliers, and when", icon: "finance" },
        c("seeProfit") && { href: "/profit", title: "Profit", sub: "Profit by order, client and month", icon: "activity" },
        c("manageExpenses") && { href: "/expenses", title: "Expenses", sub: "Day-to-day spending, with receipt photos", icon: "cash" },
        c("seeProfit") && { href: "/profit-loss", title: "Profit & loss", sub: "Sales, cost of goods, expenses and profit by month", icon: "report" },
        c("seeFinance") && { href: "/statements", title: "Statements", sub: "Statements of account for clients and suppliers", icon: "doc" },
        c("reconcile") && { href: "/reconcile", title: "Check payments", sub: "Tick payments against the mobile-money or bank statement", icon: "check" },
        c("seeFinance") && { href: "/rates", title: "Exchange rates", sub: "Rates used for foreign-currency documents", icon: "cash" },
      ],
    },
    {
      key: "reports",
      label: "Reports",
      icon: "report",
      items: [
        c("seeInsights") && { href: "/insights", title: "Business insights", sub: "Win rates, supplier punctuality, slow stock, items bought together", icon: "activity" },
        role !== "driver" && { href: "/reports", title: "Reports", sub: "Choose a report and dates, then print or download PDF or Excel", icon: "report" },
      ],
    },
    {
      key: "add",
      label: "Add new",
      icon: "plus",
      items: [
        c("seeCrm") && { href: "/crm/new", title: "+ New opportunity", sub: "A possible order to follow up", icon: "plus" },
        c("editSales") && { href: "/rfqs/new", title: "+ New client RFQ", sub: "Record a request from a client", icon: "plus" },
        c("editSales") && { href: "/quotations/new", title: "+ New quotation", sub: "Prepare prices for a client", icon: "plus" },
        c("requestPurchases") && { href: "/requisitions/new", title: "+ New purchase request", sub: "Ask for goods to be bought", icon: "plus" },
        c("editPurchasing") && { href: "/purchase-orders/new", title: "+ New purchase order", sub: "Order from a supplier", icon: "plus" },
        c("editInvoices") && { href: "/invoices/new", title: "+ New invoice", sub: "Bill a client", icon: "plus" },
        c("editClients") && { href: "/clients/new", title: "+ New client", sub: "Company, industry, TIN/VRN, sites, terms", icon: "plus" },
        c("editSuppliers") && { href: "/suppliers/new", title: "+ New supplier", sub: "Contact, country, currency, lead time, terms", icon: "plus" },
        c("editProducts") && { href: "/products/new", title: "+ New product", sub: "SKU, brand, part number, unit, price, safety", icon: "plus" },
        { href: "/expenses/new", title: "+ New expense", sub: "Fuel, rent, airtime… with a photo of the receipt", icon: "plus" },
        c("seeDocuments") && { href: "/documents/new", title: "+ New document", sub: "Certificate, licence, SDS or other paper", icon: "plus" },
        c("importData") && { href: "/import", title: "Import from spreadsheet", sub: "Load many records at once from the template", icon: "upload" },
      ],
    },
    {
      key: "company",
      label: "Company & account",
      icon: "building",
      items: [
        {
          href: "/settings/company",
          title: "Company details & branding",
          sub: isManager ? "Name, TIN, VRN, logo, colours, bank details" : "View the company's details",
          icon: "building",
        },
        c("seeDocuments") && { href: "/documents", title: "Documents", sub: "Certificates, licences, SDS and other papers, with expiry reminders", icon: "doc" },
        isManager && { href: "/settings/team", title: "Team & roles", sub: "Invite people, change roles", icon: "team" },
        isManager && { href: "/settings/security", title: "Security", sub: "Two-step verification, automatic sign-out, password rules", icon: "lock" },
        isManager && { href: "/activity", title: "Activity log", sub: "Every change, who made it and when", icon: "activity" },
        isManager && { href: "/settings/backups", title: "Backups", sub: "Automatic daily copies of your data, back up now, download", icon: "lock" },
        !c("manageExpenses") && { href: "/expenses", title: "My expenses", sub: "Money you spent for the business", icon: "cash" },
        { href: "/suggestions", title: "Suggestion Box", sub: "Share an idea to improve the business", icon: "inbox", feature: "suggestions" },
        isManager && { href: "/growth", title: "Growth & recommendations", sub: "Your business level and features that could help", icon: "activity" },
        isManager && { href: "/settings/features", title: "Features & business level", sub: "Switch features on or off, change your level", icon: "check" },
        { href: "/notifications", title: "Notifications", sub: "Your alerts, phone notifications and emails", icon: "bell" },
        isManager && { href: "/settings/notifications", title: "Alerts setup", sub: "Connect phone push and email sending", icon: "settings" },
        isManager && { href: "/settings/go-live", title: "Go-live checklist", sub: "What is ready and what is left", icon: "check" },
        { href: "/help", title: "Help", sub: "Short guide for your role, step by step", icon: "help" },
        { href: "/guide", title: "App guide", sub: "Every function, where to find it and how to use it", icon: "help" },
        { href: "/account", title: "Your account", sub: "Your details, password, appearance, sign out", icon: "user" },
        { href: "/account#password", title: "Change password", sub: "Put a new password for signing in", icon: "lock" },
        opts.isPlatformAdmin === true && platformAdminItem(),
      ],
    },
  ];
  // Drivers always keep their deliveries screen.
  const visible = (i: MenuItem) => (role === "driver" && i.href === "/driver") || on(i.feature ?? featureForRoute(i.href));
  const cats: MenuCategory[] = drafts.map((cat) => ({
    ...cat,
    items: cat.items.filter((i): i is MenuItem => Boolean(i)).filter(visible),
  }));
  const grow = role === "driver" ? null : growCategory(opts.features ?? []);
  if (grow) cats.push(grow);
  return cats.filter((cat) => cat.items.length > 0);
}

/**
 * "Platform admin": LeMoSp ADMIN on its own address once NEXT_PUBLIC_ADMIN_URL is set (a plain
 * link, since it is another site), otherwise /admin inside this app as before.
 */
function platformAdminItem(): MenuItem {
  const admin = adminUrl();
  return admin
    ? { href: `${admin}/admin`, title: "Platform admin", sub: "LeMo Tech: companies, features, feedback", icon: "settings", plain: true }
    : { href: "/admin", title: "Platform admin", sub: "LeMo Tech: companies, features, feedback", icon: "settings" };
}

/** The label shown under a feature the company does not have switched on. */
export function availabilityLabel(f: Pick<FeatureRow, "status" | "default_level">): string {
  if (f.status === "planned") return "Coming soon";
  if (f.default_level === "enterprise") return "Available in Enterprise Mode";
  if (f.default_level === "medium") return "Available in Medium Mode";
  return "Available — switched off";
}

/** "Grow": features that are not switched on yet (live ones first), each linking to its place on /growth. */
function growCategory(features: FeatureRow[]): MenuCategory | null {
  const off = features.filter((f) => !f.enabled);
  if (off.length === 0) return null;
  const ordered = [...off.filter((f) => f.status === "live"), ...off.filter((f) => f.status !== "live")];
  return {
    key: "grow",
    label: "Grow",
    icon: "activity",
    items: ordered.map((f) => ({
      href: `/growth#${f.key}`,
      title: f.name,
      sub: availabilityLabel(f),
      icon: f.status === "live" ? "plus" : "lock",
      soon: f.status !== "live",
    })),
  };
}

/** The category a role most likely wants first. */
export function defaultCategory(role: Role): string {
  return (
    { sales: "sales", procurement: "purchasing", warehouse: "stock", driver: "stock", finance: "finance", management: "sales" } as Record<Role, string>
  )[role];
}
