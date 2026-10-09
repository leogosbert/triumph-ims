import type { IconName } from "@/components/Icon";
import type { Dict } from "@/lib/i18n";
import { can, type Role } from "@/lib/roles";

/** `feature`: hidden when that feature is switched off for the company (see src/lib/features.ts). */
export type NavItem = { href: string; label: string; icon: IconName; match: string[]; plain?: boolean; feature?: string };

/** Is a feature on? Before the Stage 11 SQL every feature counts as on. */
export type FeatureCheck = (key?: string | null) => boolean;
const allOn: FeatureCheck = () => true;

const M = {
  home: ["/"],
  sales: ["/sales", "/rfqs", "/quotations", "/crm", "/tenders", "/contracts"],
  clients: ["/clients"],
  products: ["/products"],
  purchasing: ["/purchasing", "/supplier-rfqs", "/purchase-orders", "/suppliers", "/requisitions"],
  stock: ["/stock", "/warehouses", "/receiving", "/grns", "/transfers"],
  deliveries: ["/deliveries", "/backorders"],
  finance: ["/finance", "/invoices", "/payments", "/receivables", "/bills", "/payables", "/profit", "/rates", "/expenses", "/profit-loss", "/statements", "/reconcile"],
  reports: ["/reports"],
  more: ["/more", "/guide", "/documents", "/insights", "/reports", "/settings", "/account", "/import", "/activity", "/help", "/notifications", "/search", "/growth", "/suggestions", "/admin"],
};

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

/** Laptop sidebar: every section the role can open (and the company has switched on). */
export function sideNav(role: Role, t: Dict, on: FeatureCheck = allOn): NavItem[] {
  if (role === "driver") {
    return [
      { href: "/driver", label: t["nav.myDeliveries"], icon: "deliveries", match: ["/driver"], plain: true },
      ...(on("products") ? [{ href: "/products", label: t["nav.products"], icon: "products" as const, match: M.products }] : []),
      { href: "/help", label: t["nav.help"], icon: "help", match: ["/help"] },
      { href: "/more", label: t["nav.more"], icon: "more", match: M.more.filter((p) => p !== "/help") },
    ];
  }
  const out: NavItem[] = [{ href: "/", label: t["nav.home"], icon: "home", match: M.home }];
  if (can(role, "seeSales")) out.push({ href: "/sales", label: t["nav.sales"], icon: "sales", match: M.sales });
  out.push({ href: "/clients", label: t["nav.clients"], icon: "clients", match: M.clients, feature: "customers" });
  if (can(role, "seePurchasing")) out.push({ href: "/purchasing", label: t["nav.purchasing"], icon: "purchasing", match: M.purchasing });
  out.push({ href: "/products", label: t["nav.products"], icon: "products", match: M.products, feature: "products" });
  if (can(role, "seeStock")) out.push({ href: "/stock", label: t["nav.stock"], icon: "stock", match: M.stock, feature: "inventory" });
  if (can(role, "seeDeliveries")) out.push({ href: "/deliveries", label: t["nav.deliveries"], icon: "deliveries", match: M.deliveries, feature: "deliveries" });
  if (can(role, "seeFinance")) out.push({ href: "/finance", label: t["nav.finance"], icon: "finance", match: M.finance });
  else if (can(role, "seeInvoices")) out.push({ href: "/invoices", label: t["nav.finance"], icon: "finance", match: M.finance, feature: "invoices" });
  out.push({ href: "/reports", label: t["nav.reports"], icon: "report", match: M.reports });
  out.push({ href: "/help", label: t["nav.help"], icon: "help", match: ["/help", "/guide"] });
  out.push({ href: "/more", label: t["nav.more"], icon: "more", match: M.more.filter((p) => p !== "/help" && p !== "/guide" && p !== "/reports") });
  return out.filter((i) => on(i.feature));
}

export function isActive(item: NavItem, pathname: string) {
  return item.match.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));
}
