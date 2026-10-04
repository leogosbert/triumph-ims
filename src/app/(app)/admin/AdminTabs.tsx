"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTr } from "@/lib/tr-client";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/companies", label: "Companies" },
  { href: "/admin/features", label: "Features" },
  { href: "/admin/rules", label: "Growth rules" },
  { href: "/admin/feedback", label: "Feedback" },
];

export function AdminTabs() {
  const tr = useTr();
  const path = usePathname() ?? "/admin";
  const current = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
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
