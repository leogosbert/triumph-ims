"use client";

import { useTr } from "@/lib/tr-client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/Icon";
import { isActive, type NavItem } from "@/lib/nav";

/** Phone navigation: a floating bar at the bottom. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const tr = useTr();
  const pathname = usePathname();
  return (
    <nav className="bottomnav" aria-label={tr("Main")}>
      {items.map((it) => {
        const active = isActive(it, pathname);
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
  const tr = useTr();
  const pathname = usePathname();
  return (
    <aside className="sidenav" aria-label={tr("Sections")}>
      <Link href="/settings/company" className="sidenav-brand" title={company}>
        {logo ? <img src={logo} alt="" /> : <span className="mark">{initials}</span>}
        <strong>{company}</strong>
      </Link>
      <nav>
        {items.map((it) => {
          const active = isActive(it, pathname);
          const body = (
            <>
              <Icon name={it.icon} size={19} />
              {tr(String(it.label ?? ""))}
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
        <img src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
      </a>
    </aside>
  );
}
