import type { Dict } from "@/lib/i18n";
import { moreMenu, type MenuCategory, type MenuOptions } from "@/lib/menu";
import { sideNav, type FeatureCheck, type NavItem } from "@/lib/nav";
import type { Role } from "@/lib/roles";

/**
 * Menus for someone with several roles (main role + extra roles): everything any of their roles
 * shows, once, in the usual order (management's menu, which has every link, gives the order).
 * With one role this is exactly sideNav() / moreMenu().
 */

function byReference<T>(lists: T[][], key: (x: T) => string, reference: T[]): T[] {
  const seen = new Map<string, T>();
  for (const list of lists) for (const x of list) if (!seen.has(key(x))) seen.set(key(x), x);
  const order = new Map(reference.map((x, i) => [key(x), i]));
  // Links only some roles have (e.g. a driver's own screen) keep their place at the start.
  return [...seen.values()].sort((a, b) => (order.get(key(a)) ?? -1) - (order.get(key(b)) ?? -1));
}

export function sideNavFor(roles: readonly Role[], t: Dict, on: FeatureCheck, services = false, admin = false, settings = false): NavItem[] {
  if (roles.length <= 1) return sideNav(roles[0], t, on, services, admin, settings);
  const lists = roles.map((r) => sideNav(r, t, on, services, admin, settings));
  let items = byReference(lists, (i) => i.href, sideNav("management", t, on, services, admin, settings));
  // Finance covers the invoices link.
  if (items.some((i) => i.href === "/finance")) items = items.filter((i) => i.href !== "/invoices");
  return items;
}

export function moreMenuFor(roles: readonly Role[], isManager: boolean, opts: MenuOptions = {}): MenuCategory[] {
  if (roles.length <= 1) return moreMenu(roles[0], isManager, opts);
  const menus = roles.map((r) => moreMenu(r, isManager, opts));
  const reference = moreMenu("management", true, opts);
  const cats = byReference(menus, (c) => c.key, reference);
  return cats.map((cat) => {
    const lists = menus.map((m) => m.find((c) => c.key === cat.key)?.items ?? []);
    const ref = reference.find((c) => c.key === cat.key)?.items ?? [];
    return { ...cat, items: byReference(lists, (i) => i.href, ref) };
  });
}
