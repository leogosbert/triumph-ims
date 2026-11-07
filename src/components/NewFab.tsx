"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTr } from "@/lib/tr-client";

/**
 * The one big round "+" on phone lists (ui-phone.css hides it on laptops).
 *
 * Rendered once by the (app) layout. It copies the screen's own "+ New …" button (the primary
 * button in the page head, or in the list search bar, that links to …/new), so it shows exactly
 * where that screen already shows its New button: the page decides with its roles, as before,
 * and the round button follows. The page's own button stays where it is.
 */
export const NEW_BUTTON_SELECTOR = [
  "main.page .page-head a.btn-primary[href$='/new']",
  "main.page .toolbar a.btn-primary[href$='/new']",
].join(", ");

type Target = { href: string; label: string };

function readTarget(): Target | null {
  const a = document.querySelector<HTMLAnchorElement>(NEW_BUTTON_SELECTOR);
  if (!a) return null;
  const href = a.getAttribute("href");
  if (!href) return null;
  const label = (a.textContent ?? "").replace(/^\s*\+\s*/, "").replace(/\s+/g, " ").trim();
  return { href, label };
}

export function NewFab() {
  const tr = useTr();
  const pathname = usePathname();
  const [target, setTarget] = useState<Target | null>(null);

  useEffect(() => {
    const main = document.querySelector("main.page");
    let frame = 0;
    const check = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const next = readTarget();
        setTarget((prev) => (prev?.href === next?.href && prev?.label === next?.label ? prev : next));
      });
    };
    check();
    // A screen streams in, or a same-screen save re-renders it: look again.
    const mo = main ? new MutationObserver(check) : null;
    mo?.observe(main!, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      mo?.disconnect();
    };
  }, [pathname]);

  if (!target) return null;
  // "+ New quotation" reads as is; a short "+ Invoice" reads "New: Invoice".
  const name = /^(new|add)\b/i.test(target.label) ? target.label : `${tr("New")}: ${target.label}`;
  // Straight into the frame (.shell, which carries the company colours), so no glass card or
  // page animation (transform) around the page's own button moves a fixed one.
  return createPortal(
    <Link href={target.href} className="new-fab" aria-label={name} title={name}>
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </Link>,
    document.querySelector(".shell") ?? document.body,
  );
}
