"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useTr } from "@/lib/tr-client";

const TABS: { href: string; label: string; short: string; icon: IconName }[] = [
  { href: "/admin", label: "Overview", short: "Overview", icon: "home" },
  { href: "/admin/companies", label: "Companies", short: "Companies", icon: "building" },
  { href: "/admin/features", label: "Features", short: "Features", icon: "settings" },
  { href: "/admin/billing", label: "Billing & services", short: "Billing", icon: "cash" },
  { href: "/admin/rules", label: "Growth rules", short: "Rules", icon: "activity" },
  { href: "/admin/feedback", label: "Feedback", short: "Feedback", icon: "inbox" },
  { href: "/admin/backups", label: "Backups", short: "Backups", icon: "inbox" },
  { href: "/admin/deletions", label: "Deletions", short: "Deletions", icon: "close" },
];

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The tab that is current. A tapped tab lights up at once (before the next page has loaded),
 * so the bar answers the finger instead of waiting for the server.
 */
export function useCurrentTab(isCurrent: (path: string, href: string) => boolean, fallback = "/admin") {
  const path = usePathname() ?? fallback;
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [path]);
  return {
    path,
    current: (href: string) => (pending ? pending === href : isCurrent(path, href)),
    press: (href: string) => setPending(href),
  };
}

/** A pill that slides under the current link of a nav (the nav gets --ind-* custom properties). */
export function useSlidingPill<T extends HTMLElement>(key: string) {
  const ref = useRef<T>(null);
  useIsoLayoutEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    const place = () => {
      const a = nav.querySelector<HTMLElement>('a[aria-current="page"]');
      nav.style.setProperty("--ind-o", a ? "1" : "0");
      if (!a) return;
      nav.style.setProperty("--ind-x", `${a.offsetLeft}px`);
      nav.style.setProperty("--ind-y", `${a.offsetTop}px`);
      nav.style.setProperty("--ind-w", `${a.offsetWidth}px`);
      nav.style.setProperty("--ind-h", `${a.offsetHeight}px`);
    };
    place();
    // Glide only after the first placement, so the pill does not fly in when the page opens.
    const frame = requestAnimationFrame(() => (nav.dataset.ready = "1"));
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [key]);
  return ref;
}

const isAdminTab = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));

/** Laptops and tablets: the section tabs under the admin header. */
export function AdminTabs() {
  const tr = useTr();
  const { current, press } = useCurrentTab(isAdminTab);
  const key = TABS.find((t) => current(t.href))?.href ?? "";
  const ref = useSlidingPill<HTMLElement>(key);
  return (
    <nav ref={ref} className="tabs-row adm-tabs adm-slide" aria-label={tr("Admin sections")}>
      <span className="adm-ind" aria-hidden />
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} aria-current={current(t.href) ? "page" : undefined} onClick={() => press(t.href)}>
          <Icon name={t.icon} size={16} strokeWidth={current(t.href) ? 2.1 : 1.8} />
          {tr(t.label)}
        </Link>
      ))}
    </nav>
  );
}

/** Phones: the LeMoSp ADMIN bottom bar (replaces the company app's bar on admin pages). */
export function AdminBottomNav() {
  const tr = useTr();
  const { current, press } = useCurrentTab(isAdminTab);
  const key = TABS.find((t) => current(t.href))?.href ?? "";
  const ref = useSlidingPill<HTMLElement>(key);
  return (
    <nav ref={ref} className="adm-bottomnav adm-slide" aria-label={tr("Admin sections")}>
      <span className="adm-ind" aria-hidden />
      {TABS.map((t) => {
        const on = current(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined} onClick={() => press(t.href)}>
            <Icon name={t.icon} strokeWidth={on ? 2.1 : 1.8} />
            <span>{tr(t.short)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
