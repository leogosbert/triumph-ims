"use client";

import { useTr } from "@/lib/tr-client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CompanyButton } from "@/components/CompanySheet";
import { Icon } from "@/components/Icon";
import { MenuSheet } from "@/components/MenuSheet";
import type { MenuCategory } from "@/lib/menu";
import { isActive, type NavItem } from "@/lib/nav";
import { RAIL_KEY, type LookPref } from "@/lib/look";
import { sectionFor } from "@/lib/scenes";

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
 * Laptop sidebar headings (both looks), in the order sideNav() lists the links. A section the list
 * does not name (a new one) joins the heading above it, so adding a link to sideNav() needs no change here.
 */
const SIDE_GROUPS: [string, string[]][] = [
  ["My work", ["/my", "/", "/driver", "/inbox", "/meetings", "/calendar"]],
  ["Sell & buy", ["/sales", "/clients", "/purchasing", "/jobs"]],
  ["Stock & delivery", ["/products", "/stock", "/deliveries"]],
  ["Money & reports", ["/finance", "/invoices", "/reports"]],
  ["Team & company", ["/hr", "/compliance", "/settings", "/help", "/more"]],
];
function sideGroup(href: string) {
  return SIDE_GROUPS.find(([, hrefs]) => hrefs.includes(href))?.[0] ?? null;
}

/**
 * Glass sidebar: folds to a rail of icons and back. The choice is kept on this device; the
 * attribute on <html> is also set before the first paint (LOOK_SCRIPT) so the page never jumps.
 * Small laptops and tablets (up to 1100px wide) always get the rail, as in the Cocozania ERP.
 */
const NARROW = "(max-width: 1100px)";
function savedRail() {
  try {
    return localStorage.getItem(RAIL_KEY) === "1";
  } catch {
    return false;
  }
}
function setRailAttr(on: boolean) {
  const d = document.documentElement;
  if (on) d.setAttribute("data-side", "rail");
  else d.removeAttribute("data-side");
  // The gliding pill measures the links again once the sidebar has finished resizing.
  setTimeout(() => window.dispatchEvent(new Event("resize")), 380);
}
function RailToggle() {
  const tr = useTr();
  const [rail, setRail] = useState(false);
  useEffect(() => {
    setRail(document.documentElement.getAttribute("data-side") === "rail");
    const q = window.matchMedia(NARROW);
    const follow = () => {
      const on = q.matches || savedRail();
      setRail(on);
      setRailAttr(on);
    };
    q.addEventListener("change", follow);
    return () => q.removeEventListener("change", follow);
  }, []);
  function toggle() {
    const next = !rail;
    setRail(next);
    setRailAttr(next);
    try {
      localStorage.setItem(RAIL_KEY, next ? "1" : "0");
    } catch {
      /* private mode: remembered until the page is closed */
    }
  }
  return (
    <button
      type="button"
      className="side-rail-btn"
      onClick={toggle}
      aria-pressed={rail}
      aria-label={rail ? tr("Show menu names") : tr("Show icons only")}
      title={rail ? tr("Show menu names") : tr("Show icons only")}
    >
      <Icon name="chevron" size={15} strokeWidth={2.4} />
      <Icon name="chevron" size={15} strokeWidth={2.4} />
    </button>
  );
}

/**
 * Folded sidebar: pointing at an icon (or tabbing to it) pops its name out beside it in a small glass
 * label, instead of the browser's slow plain tooltip. The label sits outside the sidebar, so the sidebar's
 * scrolling never clips it.
 */
function RailTips() {
  const [tip, setTip] = useState<{ text: string; top: number; left: number } | null>(null);
  useEffect(() => {
    const side = document.querySelector<HTMLElement>("aside.sidenav");
    if (!side) return;
    let held: HTMLElement | null = null;
    const release = () => {
      // The browser's own tooltip comes back once the label is gone.
      if (held?.dataset.tipTitle) {
        held.setAttribute("title", held.dataset.tipTitle);
        delete held.dataset.tipTitle;
      }
      held = null;
      setTip(null);
    };
    const show = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("nav a, .sidenav-brand");
      if (!el || !side.contains(el)) return;
      if (document.documentElement.getAttribute("data-side") !== "rail") return release();
      if (el === held) return;
      release();
      const text = (el.querySelector(".nav-txt, strong")?.textContent ?? el.getAttribute("title") ?? "").trim();
      if (!text) return;
      const title = el.getAttribute("title");
      if (title) {
        el.dataset.tipTitle = title;
        el.removeAttribute("title");
      }
      held = el;
      const r = el.getBoundingClientRect();
      setTip({ text, top: r.top + r.height / 2, left: side.getBoundingClientRect().right + 10 });
    };
    const hide = (e: Event) => {
      const to = (e as PointerEvent | FocusEvent).relatedTarget as Node | null;
      if (held && to && held.contains(to)) return;
      release();
    };
    side.addEventListener("pointerover", show);
    side.addEventListener("focusin", show);
    side.addEventListener("pointerout", hide);
    side.addEventListener("focusout", hide);
    side.addEventListener("click", release);
    side.addEventListener("scroll", release, true);
    window.addEventListener("resize", release);
    return () => {
      release();
      side.removeEventListener("pointerover", show);
      side.removeEventListener("focusin", show);
      side.removeEventListener("pointerout", hide);
      side.removeEventListener("focusout", hide);
      side.removeEventListener("click", release);
      side.removeEventListener("scroll", release, true);
      window.removeEventListener("resize", release);
    };
  }, []);
  if (!tip) return null;
  // Into <body>: the sidebar's frosted blur would otherwise hold the label inside the sidebar.
  return createPortal(
    <span className="rail-tip" role="presentation" style={{ top: tip.top, left: tip.left }}>
      {tip.text}
    </span>,
    document.body,
  );
}

/** Headings fold their group away (remembered on this device); the open screen's link stays. */
const CLOSED_KEY = "lemosp-side-closed-v2";
function useClosedGroups(): [string[], (g: string) => void] {
  const [closed, setClosed] = useState<string[]>([]);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]") as unknown;
      if (Array.isArray(v)) setClosed(v.filter((x): x is string => typeof x === "string"));
    } catch {
      /* nothing saved, or private mode */
    }
  }, []);
  const toggle = (g: string) => {
    setClosed((old) => {
      const next = old.includes(g) ? old.filter((x) => x !== g) : [...old, g];
      try {
        localStorage.setItem(CLOSED_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      return next;
    });
    setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
  };
  return [closed, toggle];
}

/** Laptop navigation: a navy sidebar with grouped sections (Glass: a floating frosted panel). */
export function SideNav({
  items,
  company,
  logo,
  initials,
  poweredBy,
  look = "classic",
}: {
  items: NavItem[];
  company: string;
  logo: string | null;
  initials: string;
  poweredBy: string;
  look?: LookPref;
}) {
  const tr = useTr();
  const pathname = usePathname();
  const glass = look === "glass";
  const [closed, toggleGroup] = useClosedGroups();
  // Each link's heading (a link the list does not name joins the heading above it).
  const groupOf: (string | null)[] = [];
  items.forEach((it, i) => groupOf.push(sideGroup(it.href) ?? (i > 0 ? groupOf[i - 1] : null)));
  // The heading of the open screen is marked, so you can see where you are even with groups folded.
  const here = groupOf[items.findIndex((it) => isActive(it, pathname))] ?? null;
  const brand = (
    <CompanyButton className="sidenav-brand" title={company}>
      {logo ? <img src={logo} alt="" /> : <span className="mark">{initials}</span>}
      <strong>{company}</strong>
    </CompanyButton>
  );
  return (
    <aside className="sidenav" aria-label={tr("Sections")}>
      {glass ? (
        <div className="side-brand-row">
          {brand}
          <RailToggle />
        </div>
      ) : (
        brand
      )}
      <nav>
        {items.map((it, i) => {
          const active = isActive(it, pathname);
          const group = groupOf[i];
          const heading = group && group !== (i > 0 ? groupOf[i - 1] : null) ? group : null;
          const shut = group !== null && closed.includes(group) && !active;
          const label = tr(String(it.label ?? ""));
          // Glass: the icon sits on a tile in its section's colour, and the words can fold away
          // (the title shows them on the rail).
          const body = glass ? (
            <>
              <span className="nav-ico">
                <Icon name={it.icon} size={18} />
              </span>
              <span className="nav-txt">{label}</span>
            </>
          ) : (
            <>
              <Icon name={it.icon} size={19} />
              {label}
            </>
          );
          const extra = glass ? { title: label, "data-section": sectionFor(it.href), hidden: shut || undefined } : { hidden: shut || undefined };
          const link = it.plain ? (
            <a href={it.href} aria-current={active ? "page" : undefined} {...extra}>
              {body}
            </a>
          ) : (
            <Link href={it.href} aria-current={active ? "page" : undefined} {...extra}>
              {body}
            </Link>
          );
          const open = heading ? !closed.includes(heading) : true;
          const head = heading && (
            <button
              type="button"
              className="nav-group"
              aria-expanded={open}
              data-here={heading === here || undefined}
              onClick={() => toggleGroup(heading)}
              title={open ? tr("Fold this group") : tr("Open this group")}
            >
              <span className="nav-group-name">{tr(heading)}</span>
              <span className="nav-group-state" aria-hidden="true">
                <Icon name="chevron" size={14} strokeWidth={2.4} />
              </span>
            </button>
          );
          return (
            <Fragment key={it.href}>
              {head}
              {link}
            </Fragment>
          );
        })}
      </nav>
      {glass && <RailTips />}
      <a className="powered" href="/help">
        <span>{poweredBy}</span>
        <img className="on-dark" src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
        {glass && <img className="on-light" src="/brand/lemosp.svg" alt="" />}
      </a>
    </aside>
  );
}
