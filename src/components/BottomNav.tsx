"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/Icon";
import { isActive, type NavItem } from "@/lib/nav";

/** Phone navigation: a floating bar at the bottom. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="bottomnav" aria-label="Main">
      {items.map((it) => {
        const active = isActive(it, pathname);
        const body = (
          <>
            <Icon name={it.icon} strokeWidth={active ? 2.1 : 1.8} />
            <span>{it.label}</span>
          </>
        );
        // The driver screen is a plain link so the phone can open it offline.
        return it.plain ? (
          <a key={it.href} href={it.href} aria-current={active ? "page" : undefined}>
            {body}
          </a>
        ) : (
          <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}>
            {body}
          </Link>
        );
      })}
    </nav>
  );
}

/** Laptop navigation: a navy sidebar. */
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
  const pathname = usePathname();
  return (
    <aside className="sidenav" aria-label="Sections">
      <div className="sidenav-brand">
        {logo ? <img src={logo} alt="" /> : <span className="mark">{initials}</span>}
        <strong>{company}</strong>
      </div>
      <nav>
        {items.map((it) => {
          const active = isActive(it, pathname);
          const body = (
            <>
              <Icon name={it.icon} size={19} />
              {it.label}
            </>
          );
          return it.plain ? (
            <a key={it.href} href={it.href} aria-current={active ? "page" : undefined}>
              {body}
            </a>
          ) : (
            <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}>
              {body}
            </Link>
          );
        })}
      </nav>
      <a className="powered" href="/help">
        <span>{poweredBy}</span>
        <img src="/brand/lemo-ims-on-dark.svg" alt="LeMo IMS" />
      </a>
    </aside>
  );
}
