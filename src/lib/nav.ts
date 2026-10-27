import type { IconName } from "@/components/Icon";
import type { Dict } from "@/lib/i18n";
import { can, type Role } from "@/lib/roles";
import { canUseInbox } from "@/lib/inbox/common";

/** `feature`: hidden when that feature is switched off for the company (see src/lib/features.ts). */
export type NavItem = { href: string; label: string; icon: IconName; match: string[]; plain?: boolean; feature?: string };

/** Is a feature on? Before the Stage 11 SQL every feature counts as on. */
export type FeatureCheck = (key?: string | null) => boolean;
const allOn: FeatureCheck = () => true;

const M = {
  home: ["/"],
  my: ["/my"],
  sales: ["/inbox", "/portal-admin", "/catalogue", "/sales", "/rfqs", "/quotations", "/crm", "/tenders", "/contracts"],
  clients: ["/clients"],
  products: ["/products"],
  purchasing: ["/purchasing", "/supplier-rfqs", "/purchase-orders", "/suppliers", "/requisitions", "/approvals"],
  stock: ["/stock", "/warehouses", "/receiving", "/grns", "/transfers", "/planning"],
  deliveries: ["/deliveries", "/backorders", "/fleet"],
  finance: ["/finance", "/invoices", "/payments", "/receivables", "/bills", "/payables", "/profit", "/rates", "/expenses", "/profit-loss", "/statements", "/reconcile", "/budgets", "/cashflow", "/accounts", "/payroll", "/getting-paid", "/financing"],
  services: ["/jobs", "/maintenance", "/equipment", "/projects", "/timesheets", "/hire", "/service-reports"],
  reports: ["/reports", "/head-office", "/scheduled-reports"],
  admin: ["/hr", "/hse", "/quality", "/meetings", "/calendar"],
  more: ["/more", "/my", "/assistant", "/integrations", "/services", "/hr", "/hse", "/quality", "/guide", "/documents", "/compliance", "/meetings", "/calendar", "/insights", "/reports", "/settings", "/account", "/import", "/activity", "/help", "/notifications", "/search", "/growth", "/suggestions", "/admin", "/branches", "/head-office", "/scheduled-reports"],
};

/** The screens behind each menu section (read by src/lib/scenes.ts to colour and picture each section). */
export const NAV_PATHS: Readonly<Record<keyof typeof M, readonly string[]>> = M;

/** Phone bottom bar: at most five items, most-used first for each role. */
export function bottomNav(role: Role, t: Dict, on: FeatureCheck = allOn): NavItem[] {
  if (role === "driver") {
    // Drivers always keep their deliveries screen, whatever the feature switches say.
    return [
      { href: "/driver", label: t["nav.myDeliveries"], icon: "deliveries", match: ["/driver"], plain: true },
      ...(on("products") ? [{ href: "/products", label: t["nav.products"], icon: "products" as const, match: M.products }] : []),
      { href: "/more", label: t["nav.more"], icon: "more", match: M.more },
    ];
  }
  const all: NavItem[] = [
    { href: "/", label: t["nav.home"], icon: "home", match: M.home },
    can(role, "seeSales")
      ? { href: "/sales", label: t["nav.sales"], icon: "sales", match: [...M.sales, ...M.clients] }
      : role === "warehouse"
        ? { href: "/deliveries", label: t["nav.deliveries"], icon: "deliveries", match: M.deliveries, feature: "deliveries" }
        : { href: "/clients", label: t["nav.clients"], icon: "clients", match: M.clients, feature: "customers" },
    ...(can(role, "seeFinance") ? [{ href: "/finance", label: t["nav.finance"], icon: "finance" as const, match: M.finance }] : []),
    ...(can(role, "seePurchasing") ? [{ href: "/purchasing", label: t["nav.purchasing"], icon: "purchasing" as const, match: M.purchasing }] : []),
    ...(can(role, "seeStock")
      ? [{ href: "/stock", label: t["nav.stock"], icon: "stock" as const, match: role === "warehouse" ? M.stock : [...M.stock, ...M.deliveries], feature: "inventory" }]
      : []),
  ];
  const items = all.filter((i) => on(i.feature)).slice(0, 4);
  const fillers: NavItem[] = [
    { href: "/products", label: t["nav.products"], icon: "products", match: M.products, feature: "products" },
    { href: "/clients", label: t["nav.clients"], icon: "clients", match: M.clients, feature: "customers" },
  ];
  for (const f of fillers) {
    if (items.length >= 4) break;
    if (on(f.feature) && !items.some((i) => i.href === f.href)) items.push(f);
  }
  items.push({ href: "/more", label: t["nav.more"], icon: "more", match: M.more });
  return items;
}

/**
 * Laptop sidebar: every section the role can open (and the company has switched on), in the order of
 * the headings in SIDE_GROUPS (src/components/BottomNav.tsx): My work, Sell & buy, Stock & delivery,
 * Money & reports, Team & company.
 */
export function sideNav(role: Role, t: Dict, on: FeatureCheck = allOn, services = false, admin = false, settings = false): NavItem[] {
  const mine: NavItem = { href: "/my", label: "My page", icon: "user", match: M.my };
  if (role === "driver") {
    return [
      mine,
      { href: "/driver", label: t["nav.myDeliveries"], icon: "deliveries", match: ["/driver"], plain: true },
      ...(on("products") ? [{ href: "/products", label: t["nav.products"], icon: "products" as const, match: M.products }] : []),
      { href: "/help", label: t["nav.help"], icon: "help", match: ["/help"] },
      { href: "/more", label: t["nav.more"], icon: "more", match: M.more.filter((p) => p !== "/help" && p !== "/my") },
    ];
  }
  // Screens with their own sidebar link (My page, Inbox, Meetings, Calendar, Legal & compliance) are not also lit under Sales, People or More.
  const own = new Set(["/my", "/inbox", "/meetings", "/calendar", "/compliance"]);
  const rest = (paths: string[]) => paths.filter((p) => !own.has(p));
  // My work
  const out: NavItem[] = [mine, { href: "/", label: t["nav.home"], icon: "home", match: M.home }];
  if (canUseInbox(role)) out.push({ href: "/inbox", label: t["nav.inbox"], icon: "inbox", match: ["/inbox"], feature: "inbox" });
  out.push({ href: "/meetings", label: t["nav.meetings"], icon: "team", match: ["/meetings"], feature: "meetings" });
  out.push({ href: "/calendar", label: t["nav.calendar"], icon: "clock", match: ["/calendar"], feature: "calendar" });
  // Sell & buy
  if (can(role, "seeSales")) out.push({ href: "/sales", label: t["nav.sales"], icon: "sales", match: rest(M.sales) });
  out.push({ href: "/clients", label: t["nav.clients"], icon: "clients", match: M.clients, feature: "customers" });
  if (can(role, "seePurchasing")) out.push({ href: "/purchasing", label: t["nav.purchasing"], icon: "purchasing", match: M.purchasing });
  // Service jobs and the other service screens (only once the goods-and-services update is in and switched on).
  if (services && role !== "procurement") out.push({ href: "/jobs", label: t["nav.services"], icon: "tools", match: M.services });
  // Stock & delivery
  out.push({ href: "/products", label: t["nav.products"], icon: "products", match: M.products, feature: "products" });
  if (can(role, "seeStock")) out.push({ href: "/stock", label: t["nav.stock"], icon: "stock", match: M.stock, feature: "inventory" });
  if (can(role, "seeDeliveries")) out.push({ href: "/deliveries", label: t["nav.deliveries"], icon: "deliveries", match: M.deliveries, feature: "deliveries" });
  // Money & reports
  if (can(role, "seeFinance")) out.push({ href: "/finance", label: t["nav.finance"], icon: "finance", match: M.finance });
  else if (can(role, "seeInvoices")) out.push({ href: "/invoices", label: t["nav.finance"], icon: "finance", match: M.finance, feature: "invoices" });
  out.push({ href: "/reports", label: t["nav.reports"], icon: "report", match: M.reports });
  // Team & company: employees, leave, health & safety and quality (once that update is in and switched on).
  if (admin) out.push({ href: "/hr", label: "People", icon: "team", match: rest(M.admin) });
  if (can(role, "seeDocuments")) out.push({ href: "/compliance", label: t["nav.compliance"], icon: "shield", match: ["/compliance"], feature: "compliance" });
  // Settings for management (company details, team, security, features, backups...).
  if (settings) out.push({ href: "/settings", label: t["nav.settings"], icon: "settings", match: ["/settings"] });
  out.push({ href: "/help", label: t["nav.help"], icon: "help", match: ["/help", "/guide"] });
  out.push({
    href: "/more",
    label: t["nav.more"],
    icon: "more",
    match: rest(M.more).filter((p) => p !== "/help" && p !== "/guide" && p !== "/reports" && !(settings && p === "/settings") && !(admin && M.admin.includes(p))),
  });
  return out.filter((i) => on(i.feature));
}

export function isActive(item: NavItem, pathname: string) {
  return item.match.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));
}
