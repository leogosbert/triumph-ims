"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { recordKind, rememberRecent, setRecentScope, whenTitled } from "@/lib/recent-items";

/**
 * Remembers the records a person opens on this device (src/lib/recent-items.ts), from the address
 * and the page's own heading, so no record screen has to do anything. Sits once in the app layout.
 * A screen that shows "not found" or an error marks itself with data-no-recent and is skipped.
 */
export function RecentTracker({ scope }: { scope: string }) {
  setRecentScope(scope);
  const pathname = usePathname() ?? "";
  useEffect(() => {
    const kind = recordKind(pathname);
    if (!kind) return;
    return whenTitled((title, main) => {
      if (main?.querySelector("[data-no-recent]")) return;
      rememberRecent({ href: pathname, title, kind });
    });
  }, [pathname]);
  return null;
}
