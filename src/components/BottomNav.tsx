"use client";

import { useTr } from "@/lib/tr-client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { CompanyButton } from "@/components/CompanySheet";
import { Icon } from "@/components/Icon";
import { MenuSheet } from "@/components/MenuSheet";
import type { MenuCategory } from "@/lib/menu";
import { isActive, type NavItem } from "@/lib/nav";
import { RAIL_KEY, type LookPref } from "@/lib/look";

/** Phone navigation: a floating bar at the bottom. "More" opens the slide-up menu. */
export function BottomNav({ items, menu, menuStart }: { items: NavItem[]; menu: MenuCategory[]; menuStart: string }) {
  const tr = useTr();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <>
    <nav className="bottomnav" aria-label={tr("Main")}>
      {items.map((it) => {
        const active = open ? it.href === "/more" : isActive(it, pathname);
        if (it.href === "/more") {
          return (
            <a
              key={it.href}
              href="/more"
              aria-current={active ? "page" : undefined}
              aria-expanded={open}
              aria-haspopup="dialog"
              onClick={(e) => {
                e.preventDefault();
                setOpen((o) => !o);
              }}
            >
              <Icon name={open ? "close" : it.icon} strokeWidth={active ? 2.1 : 1.8} />
              <span>{tr(String(it.label ?? ""))}</span>
            </a>
          );
        }
        const body = (
          <>
            <Icon name={it.icon} strokeWidth={active ? 2.1 : 1.8} />
            <span>{tr(String(it.label ?? ""))}</span>
          </>
        );
        // The driver screen is a plain link so the phone can open it offline.
        return it.plain ? (
          <a key={it.href} href={it.href} aria-current={active ? "page" : undefined}>
            {body}
          </a>
        ) : (
          <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}>
            {body}
          </Link>
        );
      })}
    </nav>
    <MenuSheet open={open} onClose={() => setOpen(false)} categories={menu} initial={menuStart} />
    </>
  );
}

/**
 * Laptop sidebar headings. A section the list does not name (a new one) joins the heading above it,
 * so adding a link to sideNav() needs no change here.
 */
const SIDE_GROUPS: [string, string[]][] = [
  ["Overview", ["/"]],
  ["Operations", ["/sales", "/clients", "/purchasing", "/products", "/stock", "/deliveries", "/driver"]],
  ["Finance & reports", ["/finance", "/invoices", "/reports"]],
  ["Support", ["/help", "/more"]],
];
/** The Glass sidebar groups the same links a little more finely. */
const GLASS_GROUPS: [string, string[]][] = [
  ["Overview", ["/", "/driver"]],
  ["Operations", ["/sales", "/clients", "/purchasing", "/products", "/stock", "/deliveries", "/jobs"]],
  ["People", ["/hr", "/compliance"]],
  ["Finance", ["/finance", "/invoices", "/reports"]],
  ["Company", ["/settings", "/help", "/more"]],
];
function sideGroup(href: string, groups = SIDE_GROUPS) {
  return groups.find(([, hrefs]) => hrefs.includes(href))?.[0] ?? null;
}

/**
 * Glass sidebar: folds to a rail of icons and back. The choice is kept on this device; the
 * attribute on <html> is also set before the first paint (LOOK_SCRIPT) so the page never jumps.
 */
function RailToggle() {
  const tr = useTr();
  const [rail, setRail] = useState(false);
  useEffect(() => setRail(document.documentElement.getAttribute("data-side") === "rail"), []);
  function toggle() {
    const next = !rail;
    setRail(next);
    const d = document.documentElement;
    if (next) d.setAttribute("data-side", "rail");
    else d.removeAttribute("data-side");
    try {
      localStorage.setItem(RAIL_KEY, next ? "1" : "0");
    } catch {
      /* private mode: remembered until the page is closed */
    }
    // The gliding pill measures the links again once the sidebar has finished resizing.
    setTimeout(() => window.dispatchEvent(new Event("resize")), 380);
  }
  return (
    <button
      type="button"
      className="side-rail-btn"
      onClick={toggle}
      aria-pressed={rail}
      aria-label={rail ? tr("Expand menu") : tr("Collapse menu")}
      title={rail ? tr("Expand menu") : tr("Collapse menu")}
    >
      <Icon name="chevron" size={18} strokeWidth={2.2} />
    </button>
  );
}

/** Laptop navigation: a navy sidebar with grouped sections. */
export function SideNav({
  items,
  company,
  logo,
  initials,
  poweredBy,
  look = "classic",
}: {
  items: NavItem[];
  company: string;
  logo: string | null;
  initials: string;
  poweredBy: string;
  look?: LookPref;
}) {
  const tr = useTr();
  const pathname = usePathname();
  const glass = look === "glass";
  const groups = glass ? GLASS_GROUPS : SIDE_GROUPS;
  return (
    <aside className="sidenav" aria-label={tr("Sections")}>
      <CompanyButton className="sidenav-brand" title={company}>
        {logo ? <img src={logo} alt="" /> : <span className="mark">{initials}</span>}
        <strong>{company}</strong>
      </CompanyButton>
      {glass && <RailToggle />}
      <nav>
        {items.map((it, i) => {
          const active = isActive(it, pathname);
          const group = sideGroup(it.href, groups);
          const heading = group && group !== items.slice(0, i).map((x) => sideGroup(x.href, groups)).filter(Boolean).pop() ? group : null;
          const label = tr(String(it.label ?? ""));
          // Glass: the icon sits on a small tile and the words can fold away (the title shows them on the rail).
          const body = glass ? (
            <>
              <span className="nav-ico">
                <Icon name={it.icon} size={18} />
              </span>
              <span className="nav-txt">{label}</span>
            </>
          ) : (
            <>
              <Icon name={it.icon} size={19} />
              {label}
            </>
          );
          const title = glass ? label : undefined;
          const link = it.plain ? (
            <a href={it.href} aria-current={active ? "page" : undefined} title={title}>
              {body}
            </a>
          ) : (
            <Link href={it.href} aria-current={active ? "page" : undefined} title={title}>
              {body}
            </Link>
          );
          return (
            <Fragment key={it.href}>
              {heading && <span className="nav-group">{tr(heading)}</span>}
              {link}
            </Fragment>
          );
        })}
      </nav>
      <a className="powered" href="/help">
        <span>{poweredBy}</span>
        <img src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
      </a>
    </aside>
  );
}
