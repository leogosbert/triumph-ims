"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { sectionFor, SECTIONS, type Section } from "@/lib/scenes";

/**
 * Tells the page which section is open (data-section on <html>), so the Glass style can blend
 * to that section's accent shades (src/app/glass.css). It also sets --page-dx: the next screen
 * slides in from the side of the menu you moved towards (down the menu: from the right). Draws nothing.
 */
export function SectionTracker({ section }: { section?: Section }) {
  const pathname = usePathname();
  const prev = useRef<number | null>(null);
  useEffect(() => {
    const d = document.documentElement;
    const now = section ?? sectionFor(pathname ?? "/");
    const order = SECTIONS.indexOf(now);
    const narrow = window.innerWidth <= 720;
    const dir = prev.current === null || order === prev.current ? 0 : order > prev.current ? 1 : -1;
    d.style.setProperty("--page-dx", `${dir * (narrow ? 10 : 18)}px`);
    d.setAttribute("data-section", now);
    prev.current = order;
  }, [pathname, section]);
  return null;
}
