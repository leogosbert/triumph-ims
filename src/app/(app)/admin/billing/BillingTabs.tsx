"use client";

import Link from "next/link";
import { useTr } from "@/lib/tr-client";
import { useCurrentTab, useSlidingPill } from "../AdminTabs";

const TABS = [
  { href: "/admin/billing", label: "Companies & invoices" },
  { href: "/admin/billing/requests", label: "Requests" },
  { href: "/admin/billing/prices", label: "Price book" },
  { href: "/admin/billing/settings", label: "LeMo Tech details" },
];

const isBillingTab = (path: string, href: string) =>
  href === "/admin/billing" ? path === href || /^\/admin\/billing\/[0-9a-f-]{36}/i.test(path) : path === href || path.startsWith(`${href}/`);

/** Sections of Billing & services in LeMoSp ADMIN. */
export function BillingTabs({ waiting }: { waiting: number }) {
  const tr = useTr();
  const { current, press } = useCurrentTab(isBillingTab, "/admin/billing");
  const ref = useSlidingPill<HTMLElement>(TABS.find((t) => current(t.href))?.href ?? "");
  return (
    <nav ref={ref} className="adm-subtabs adm-slide" aria-label={tr("Billing & services")}>
      <span className="adm-ind" aria-hidden />
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={current(t.href) ? "page" : undefined} onClick={() => press(t.href)}>
          {tr(t.label)}
          {t.href.endsWith("/requests") && waiting > 0 && <span className="adm-count">{waiting}</span>}
        </Link>
      ))}
    </nav>
  );
}
