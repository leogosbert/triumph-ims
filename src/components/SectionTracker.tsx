"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { sectionFor, type Section } from "@/lib/scenes";

/**
 * Tells the page which section is open (data-section on <html>), so the Glass style can blend
 * to that section's accent shades (src/app/glass.css). Draws nothing.
 */
export function SectionTracker({ section }: { section?: Section }) {
  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.setAttribute("data-section", section ?? sectionFor(pathname ?? "/"));
  }, [pathname, section]);
  return null;
}
