"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/Icon";
import { useTr } from "@/lib/tr-client";

const TABS: { href: string; label: string; short: string; icon: IconName }[] = [
  { href: "/admin", label: "Overview", short: "Overview", icon: "home" },
  { href: "/admin/companies", label: "Companies", short: "Companies", icon: "building" },
  { href: "/admin/features", label: "Features", short: "Features", icon: "settings" },
  { href: "/admin/rules", label: "Growth rules", short: "Rules", icon: "activity" },
  { href: "/admin/feedback", label: "Feedback", short: "Feedback", icon: "inbox" },
  { href: "/admin/deletions", label: "Deletions", short: "Deletions", icon: "close" },
];

function useCurrent() {
  const path = usePathname() ?? "/admin";
  return (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
}

/** Laptops and tablets: the section tabs under the admin header. */
export function AdminTabs() {
  const tr = useTr();
  const current = useCurrent();
  return (
    <nav className="tabs-row adm-tabs" aria-label={tr("Admin sections")}>
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={current(t.href) ? "page" : undefined}>
          {tr(t.label)}
        </Link>
      ))}
    </nav>
  );
}

/** Phones: the LeMoSp ADMIN bottom bar (replaces the company app's bar on admin pages). */
export function AdminBottomNav() {
  const tr = useTr();
  const current = useCurrent();
  return (
    <nav className="adm-bottomnav" aria-label={tr("Admin sections")}>
      {TABS.map((t) => {
        const on = current(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}>
            <Icon name={t.icon} strokeWidth={on ? 2.1 : 1.8} />
            <span>{tr(t.short)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
