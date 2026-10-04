import type { IconName } from "@/components/Icon";
import type { Dict } from "@/lib/i18n";
import { can, type Role } from "@/lib/roles";

export type NavItem = { href: string; label: string; icon: IconName; match: string[]; plain?: boolean };

const M = {
  home: ["/"],
  sales: ["/sales", "/rfqs", "/quotations"],
  clients: ["/clients"],
  products: ["/products"],
  purchasing: ["/purchasing", "/supplier-rfqs", "/purchase-orders", "/suppliers"],
  stock: ["/stock", "/warehouses", "/receiving", "/grns"],
  deliveries: ["/deliveries"],
  finance: ["/finance", "/invoices", "/payments", "/receivables", "/bills", "/payables", "/profit", "/rates"],
  more: ["/more", "/settings", "/account", "/import", "/activity", "/help", "/notifications", "/search"],
};

/** Phone bottom bar: at most five items, most-used first for each role. */
export function bottomNav(role: Role, t: Dict): NavItem[] {
  if (role === "driver") {
    return [
      { href: "/driver", label: t["nav.myDeliveries"], icon: "deliveries", match: ["/driver"], plain: true },
      { href: "/products", label: t["nav.products"], icon: "products", match: M.products },
      { href: "/more", label: t["nav.more"], icon: "more", match: M.more },
    ];
  }
  const all: NavItem[] = [
    { href: "/", label: t["nav.home"], icon: "home", match: M.home },
    can(role, "seeSales")
      ? { href: "/sales", label: t["nav.sales"], icon: "sales", match: [...M.sales, ...M.clients] }
      : role === "warehouse"
        ? { href: "/deliveries", label: t["nav.deliveries"], icon: "deliveries", match: M.deliveries }
        : { href: "/clients", label: t["nav.clients"], icon: "clients", match: M.clients },
    ...(can(role, "seeFinance") ? [{ href: "/finance", label: t["nav.finance"], icon: "finance" as const, match: M.finance }] : []),
    ...(can(role, "seePurchasing") ? [{ href: "/purchasing", label: t["nav.purchasing"], icon: "purchasing" as const, match: M.purchasing }] : []),
    ...(can(role, "seeStock")
      ? [{ href: "/stock", label: t["nav.stock"], icon: "stock" as const, match: role === "warehouse" ? M.stock : [...M.stock, ...M.deliveries] }]
      : []),
  ];
  const items = all.slice(0, 4);
  if (items.length < 4) items.push({ href: "/products", label: t["nav.products"], icon: "products", match: M.products });
  items.push({ href: "/more", label: t["nav.more"], icon: "more", match: M.more });
  return items;
}

/** Laptop sidebar: every section the role can open. */
export function sideNav(role: Role, t: Dict): NavItem[] {
  if (role === "driver") {
    return [
      { href: "/driver", label: t["nav.myDeliveries"], icon: "deliveries", match: ["/driver"], plain: true },
      { href: "/products", label: t["nav.products"], icon: "products", match: M.products },
      { href: "/help", label: t["nav.help"], icon: "help", match: ["/help"] },
      { href: "/more", label: t["nav.more"], icon: "more", match: M.more.filter((p) => p !== "/help") },
    ];
  }
  const out: NavItem[] = [{ href: "/", label: t["nav.home"], icon: "home", match: M.home }];
  if (can(role, "seeSales")) out.push({ href: "/sales", label: t["nav.sales"], icon: "sales", match: M.sales });
  out.push({ href: "/clients", label: t["nav.clients"], icon: "clients", match: M.clients });
  if (can(role, "seePurchasing")) out.push({ href: "/purchasing", label: t["nav.purchasing"], icon: "purchasing", match: M.purchasing });
  out.push({ href: "/products", label: t["nav.products"], icon: "products", match: M.products });
  if (can(role, "seeStock")) out.push({ href: "/stock", label: t["nav.stock"], icon: "stock", match: M.stock });
  if (can(role, "seeDeliveries")) out.push({ href: "/deliveries", label: t["nav.deliveries"], icon: "deliveries", match: M.deliveries });
  if (can(role, "seeFinance")) out.push({ href: "/finance", label: t["nav.finance"], icon: "finance", match: M.finance });
  else if (can(role, "seeInvoices")) out.push({ href: "/invoices", label: t["nav.finance"], icon: "finance", match: M.finance });
  out.push({ href: "/help", label: t["nav.help"], icon: "help", match: ["/help"] });
  out.push({ href: "/more", label: t["nav.more"], icon: "more", match: M.more.filter((p) => p !== "/help") });
  return out;
}

export function isActive(item: NavItem, pathname: string) {
  return item.match.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));
}
