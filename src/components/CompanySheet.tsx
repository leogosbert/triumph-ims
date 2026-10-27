"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut, switchCompany } from "@/app/actions";
import { setTheme } from "@/app/theme-actions";
import { Icon, type IconName } from "@/components/Icon";
import { useTr } from "@/lib/tr-client";

export type CompanyCard = {
  name: string;
  logo: string | null;
  initials: string;
  role: string;
  details: { label: string; value: string }[];
  person: { name: string; email: string };
  isManager: boolean;
  others: { id: string; name: string; role: string }[];
  theme: "auto" | "light" | "dark";
};

const EVENT = "lemosp:company-sheet";

/** Where the tapped button sits, so on a laptop the panel opens right under it. */
type Anchor = { top: number; bottom: number; left: number; right: number };

const GAP = 8;
const EDGE = 10;

/**
 * Places the panel right under the tapped button, kept inside the window: it opens to the right
 * from a button on the left half (the logo) and to the left from one on the right half (your name).
 */
function placeAt(a: Anchor | null): React.CSSProperties | undefined {
  if (!a || typeof window === "undefined") return undefined;
  const vw = window.innerWidth;
  const width = Math.min(310, vw - 2 * EDGE);
  const top = Math.max(EDGE, Math.min(a.bottom + GAP, window.innerHeight - 220));
  const onRight = (a.left + a.right) / 2 > vw / 2;
  const v = onRight
    ? { "--cs-right": `${Math.max(EDGE, Math.min(vw - a.right, vw - width - EDGE))}px`, "--cs-left": "auto", "--cs-origin": "calc(100% - 24px) 0" }
    : { "--cs-left": `${Math.max(EDGE, Math.min(a.left, vw - width - EDGE))}px`, "--cs-right": "auto", "--cs-origin": "24px 0" };
  return { "--cs-top": `${top}px`, ...v } as React.CSSProperties;
}

/** Opens the company panel. Used by the logo in the top bar (phones) and the sidebar (laptops). */
export function CompanyButton({ className, title, children }: { className: string; title: string; children: React.ReactNode }) {
  return (
    <a
      href="/settings/company"
      className={className}
      title={title}
      aria-label={title}
      aria-haspopup="dialog"
      onClick={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        window.dispatchEvent(new CustomEvent<Anchor>(EVENT, { detail: { top: r.top, bottom: r.bottom, left: r.left, right: r.right } }));
      }}
    >
      {children}
    </a>
  );
}

/**
 * The company panel: slides down from the top when the logo is tapped.
 * Company details at a glance, then quick actions. Tap outside, swipe up or press Esc to close.
 */
export function CompanySheet({ card }: { card: CompanyCard }) {
  const tr = useTr();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const toggle = (e: Event) => {
      setAnchor((e as CustomEvent<Anchor | undefined>).detail ?? null);
      setOpen((o) => !o);
    };
    window.addEventListener(EVENT, toggle);
    return () => window.removeEventListener(EVENT, toggle);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const close = () => setOpen(false);
  function onDown(e: React.PointerEvent) {
    start.current = e.clientY;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  }
  function onMove(e: React.PointerEvent) {
    if (start.current !== null) setDrag(Math.min(0, e.clientY - start.current));
  }
  function onUp() {
    if (start.current === null) return;
    start.current = null;
    if (drag < -80) close();
    setDrag(0);
  }

  const links: { href: string; title: string; sub: string; icon: IconName }[] = [
    {
      href: "/settings/company",
      title: card.isManager ? "Company details & branding" : "Company details",
      sub: card.isManager ? "Name, TIN, VRN, logo, colours, bank details" : "View the company's details",
      icon: "building",
    },
    ...(card.isManager ? [{ href: "/settings/team", title: "Team & roles", sub: "Invite people, change roles", icon: "team" as IconName }] : []),
    { href: "/account", title: "Your account", sub: "Your details, password, appearance, sign out", icon: "user" },
    { href: "/account#password", title: "Change password", sub: "Put a new password for signing in", icon: "lock" },
    { href: "/help", title: "Help", sub: "Short guide for your role, step by step", icon: "help" },
    { href: "/guide", title: "App guide", sub: "Every function, where to find it and how to use it", icon: "help" },
  ];

  return (
    <div className={`csheet${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="csheet-backdrop" onClick={close} />
      <div
        ref={panel}
        className={`csheet-panel${drag ? " dragging" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={card.name}
        tabIndex={-1}
        style={{ ...placeAt(anchor), ...(drag ? { transform: `translateY(${drag}px)` } : null) }}
      >
        <div className="csheet-hero">
          {card.logo ? <img src={card.logo} alt="" className="csheet-logo" /> : <span className="csheet-logo mark">{card.initials}</span>}
          <div className="csheet-who">
            <strong>{card.name}</strong>
            <span>
              {card.person.name || card.person.email || tr("Demo guest")} · {card.role}
            </span>
          </div>
          <button type="button" className="csheet-x" onClick={close} aria-label={tr("Close")}>
            ×
          </button>
        </div>

        <div className="csheet-body">
          {card.details.length > 0 && (
            <dl className="csheet-facts">
              {card.details.map((d) => (
                <div key={d.label}>
                  <dt>{tr(d.label)}</dt>
                  <dd>{d.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <ul className="csheet-list">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} onClick={close}>
                  <span className="msheet-ico">
                    <Icon name={l.icon} size={20} />
                  </span>
                  <span className="msheet-txt">
                    <span className="t">{tr(l.title)}</span>
                    <span className="s">{tr(l.sub)}</span>
                  </span>
                  <Icon name="chevron" size={18} />
                </Link>
              </li>
            ))}
          </ul>

          <div className="csheet-row">
            <span>{tr("Appearance")}</span>
            <form action={setTheme} className="seg seg-sm">
              {(["auto", "light", "dark"] as const).map((v) => (
                <button key={v} type="submit" name="theme" value={v} aria-pressed={card.theme === v}>
                  {tr(v === "auto" ? "Auto" : v === "light" ? "Light" : "Dark")}
                </button>
              ))}
            </form>
          </div>

          {card.others.length > 0 && (
            <div className="csheet-switch">
              <span className="csheet-label">{tr("Switch company")}</span>
              {card.others.map((o) => (
                <form key={o.id} action={switchCompany}>
                  <input type="hidden" name="company_id" value={o.id} />
                  <button type="submit" className="csheet-co">
                    <strong>{o.name}</strong>
                    <span>{o.role}</span>
                  </button>
                </form>
              ))}
            </div>
          )}

          <form action={signOut}>
            <button type="submit" className="btn btn-block btn-danger csheet-out">
              {tr("Sign out")}
            </button>
          </form>
        </div>

        <div className="csheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <span className="msheet-handle" />
        </div>
      </div>
    </div>
  );
}
