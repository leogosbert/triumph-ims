"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { crumbMenu, crumbTrail } from "@/lib/crumbs";
import { pageTitle, whenTitled } from "@/lib/recent-items";
import { useTr } from "@/lib/tr-client";

/**
 * The quiet trail above the back link on laptops ("Sell › Quotations › QT-2026-0012"), from the menu
 * groups, the address and the page's heading. Rendered by BackLink, so every inner screen has it;
 * hidden on phones (ui-nav.css), where the back link alone stays.
 */
export function Crumbs({ backHref, backLabel }: { backHref: string; backLabel: string }) {
  const tr = useTr();
  const pathname = usePathname() ?? "";
  const [title, setTitle] = useState("");
  useEffect(() => {
    setTitle(pageTitle());
    return whenTitled((t) => setTitle(t));
  }, [pathname]);
  const trail = crumbTrail(crumbMenu(), pathname, { href: backHref, label: backLabel }, title);
  if (trail.length < 2) return null;
  return (
    <nav className="crumbs no-print" aria-label={tr("Breadcrumb")}>
      <ol>
        {trail.map((c, i) => (
          <li key={`${c.href ?? ""}-${i}`}>
            {c.current ? (
              <span aria-current="page">{tr(c.label)}</span>
            ) : c.href ? (
              <Link href={c.href}>{tr(c.label)}</Link>
            ) : (
              <span>{tr(c.label)}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
