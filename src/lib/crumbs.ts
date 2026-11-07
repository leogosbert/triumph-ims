import { moreMenu, type MenuCategory } from "@/lib/menu";
import { ERP_FEATURES, SERVICE_FEATURES, type FeatureRow } from "@/lib/features";

/**
 * The quiet trail above the back link on laptops ("Sell › Quotations › QT-2026-0012"), worked out
 * from the menu groups and the address, so no screen has to list its own. Pure: the menu, the
 * address, the back link and the page title come in, the crumbs go out.
 */

export type Crumb = { label: string; href?: string; current?: boolean };

/** Only the names matter here (the person is already on the screen): the full menu, every feature on. */
let names: MenuCategory[] | null = null;
export function crumbMenu(): MenuCategory[] {
  names ??= moreMenu("management", true, {
    features: [...SERVICE_FEATURES, ...ERP_FEATURES].map((key) => ({ key, enabled: true }) as FeatureRow),
  }).filter((c) => c.key !== "add" && c.key !== "grow");
  return names;
}

const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

/**
 * The trail for `pathname`: the menu group, the menu screen the address sits under (a link), the
 * back link's screen when it is between the two, and the page itself (its title). Empty when the
 * address is not under any menu screen and there is no back link.
 */
export function crumbTrail(menu: readonly MenuCategory[], pathname: string, back: { href: string; label: string } | null, title: string): Crumb[] {
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  let best: { cat: MenuCategory; href: string; title: string } | null = null;
  for (const cat of menu) {
    for (const i of cat.items) {
      if (!i.href.startsWith("/") || i.href.includes("#") || i.href === "/") continue;
      if (under(path, i.href) && (!best || i.href.length > best.href.length)) best = { cat, href: i.href, title: i.title };
    }
  }
  const backHref = back?.href.split(/[?#]/)[0];
  const backCrumb = (): Crumb | null => {
    if (!back || !backHref || backHref === path || backHref === "/") return null;
    const known = menu.flatMap((c) => c.items).find((i) => i.href === backHref);
    return { label: known?.title ?? back.label, href: backHref };
  };
  const page: Crumb[] = title ? [{ label: title, current: true }] : [];
  if (!best) {
    const b = backCrumb();
    return b && page.length ? [b, ...page] : [];
  }
  const out: Crumb[] = [{ label: best.cat.label }];
  const b = backCrumb();
  const onMenuScreen = path === best.href;
  // The back link's screen sits above the menu screen ("Stock" above "What to reorder").
  if (b && b.href && best.href.startsWith(`${b.href}/`)) out.push(b);
  out.push(onMenuScreen ? { label: best.title, current: true } : { label: best.title, href: best.href });
  // …or between the menu screen and this one (the PO above its "Receive goods" screen).
  if (b && b.href && b.href !== best.href && under(b.href, best.href) && under(path, b.href)) out.push(b);
  if (!onMenuScreen) out.push(...page);
  return out;
}
