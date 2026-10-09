"use client";

import { useTr } from "@/lib/tr-client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useState } from "react";
import { CompanyButton } from "@/components/CompanySheet";
import { Icon } from "@/components/Icon";
import { MenuSheet } from "@/components/MenuSheet";
import type { MenuCategory } from "@/lib/menu";
import { isActive, type NavItem } from "@/lib/nav";

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
function sideGroup(href: string) {
  return SIDE_GROUPS.find(([, hrefs]) => hrefs.includes(href))?.[0] ?? null;
}

/** Laptop navigation: a navy sidebar with grouped sections. */
export function SideNav({
  items,
  company,
  logo,
  initials,
  poweredBy,
}: {
  items: NavItem[];
  company: string;
  logo: string | null;
  initials: string;
  poweredBy: string;
}) {
  const tr = useTr();
  const pathname = usePathname();
  return (
    <aside className="sidenav" aria-label={tr("Sections")}>
      <CompanyButton className="sidenav-brand" title={company}>
        {logo ? <img src={logo} alt="" /> : <span className="mark">{initials}</span>}
        <strong>{company}</strong>
      </CompanyButton>
      <nav>
        {items.map((it, i) => {
          const active = isActive(it, pathname);
          const group = sideGroup(it.href);
          const heading = group && group !== items.slice(0, i).map((x) => sideGroup(x.href)).filter(Boolean).pop() ? group : null;
          const body = (
            <>
              <Icon name={it.icon} size={19} />
              {tr(String(it.label ?? ""))}
            </>
          );
          const link = it.plain ? (
            <a href={it.href} aria-current={active ? "page" : undefined}>
              {body}
            </a>
          ) : (
            <Link href={it.href} aria-current={active ? "page" : undefined}>
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
