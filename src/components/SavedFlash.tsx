"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

const HOLD_MS = 1600;

/**
 * After a save (the address has ?msg= and no ?error=), softly highlights what was saved: the element
 * named by the address's #anchor, or one marked data-saved. The glow comes in and goes out in under
 * 250 ms each (src/app/ui-look.css); with "reduce motion" it simply shows and hides, without moving.
 * A done badge or tick inside it gets a small check-mark pop. Nothing is drawn by this component.
 */
function Flash() {
  const pathname = usePathname();
  const search = useSearchParams();
  const msg = search?.get("msg");
  const error = search?.get("error");

  useEffect(() => {
    if (!msg || error) return;
    let target: HTMLElement | null = null;
    let raf = 0;
    let off: ReturnType<typeof setTimeout> | undefined;
    // Wait one frame so the new screen is in place before we look for the element.
    raf = requestAnimationFrame(() => {
      let id = "";
      try {
        id = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        id = "";
      }
      const byId = id ? document.getElementById(id) : null;
      target = byId ?? document.querySelector<HTMLElement>("[data-saved]");
      if (!target) return;
      target.classList.add("ui-just-saved");
      off = setTimeout(() => target?.classList.remove("ui-just-saved"), HOLD_MS);
    });
    return () => {
      cancelAnimationFrame(raf);
      if (off) clearTimeout(off);
      target?.classList.remove("ui-just-saved");
    };
  }, [pathname, msg, error]);

  return null;
}

export function SavedFlash() {
  return (
    <Suspense fallback={null}>
      <Flash />
    </Suspense>
  );
}
