"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTr } from "@/lib/tr-client";

const TABS = [
  { href: "/admin/billing", label: "Companies & invoices" },
  { href: "/admin/billing/requests", label: "Requests" },
  { href: "/admin/billing/prices", label: "Price book" },
  { href: "/admin/billing/settings", label: "LeMo Tech details" },
];

/** Sections of Billing & services in LeMoSp ADMIN. */
export function BillingTabs({ waiting }: { waiting: number }) {
  const tr = useTr();
  const path = usePathname() ?? "/admin/billing";
  const current = (href: string) =>
    href === "/admin/billing" ? path === href || /^\/admin\/billing\/[0-9a-f-]{36}/i.test(path) : path === href || path.startsWith(`${href}/`);
  return (
    <nav className="adm-subtabs" aria-label={tr("Billing & services")}>
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={current(t.href) ? "page" : undefined}>
          {tr(t.label)}
          {t.href.endsWith("/requests") && waiting > 0 && <> · {waiting}</>}
        </Link>
      ))}
    </nav>
  );
}
