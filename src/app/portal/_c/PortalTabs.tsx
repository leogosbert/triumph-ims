"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** The portal's sections: a row of tabs that scrolls sideways on a phone. */
export function PortalTabs({ tabs }: { tabs: { href: string; label: string; count?: number }[] }) {
  const path = usePathname() ?? "";
  return (
    <nav className="portal-tabs" aria-label="Portal">
      {tabs.map((t) => {
        const on = path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}>
            {t.label}
            {t.count ? <span className="portal-count">{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
