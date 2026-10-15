"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { Suspense, useEffect, useRef, useState } from "react";

/** Marks the page as leaving (the current screen fades back) until the next one arrives. */
function leaving(on: boolean) {
  if (on) document.documentElement.dataset.nav = "leaving";
  else delete document.documentElement.dataset.nav;
}

/**
 * Thin teal bar across the top while the next screen loads, so every tap feels answered.
 * On a link tap the current screen also fades back, and the new one rises in (globals.css).
 */
function Bar() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new page arrived: finish the bar.
  useEffect(() => {
    setState((s) => (s === "loading" ? "done" : s));
    leaving(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 400);
  }, [pathname, search]);

  // Get the next screen ready the moment a finger touches a link (or the mouse rests on it for a
  // moment), so it is usually there by the time the tap completes.
  const router = useRouter();
  useEffect(() => {
    const done = new Map<string, number>();
    let hover: ReturnType<typeof setTimeout> | null = null;
    function target(e: Event): string | null {
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return null;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return null;
      // Files and links answered by the server directly (PDFs, notifications, templates) are not screens.
      if (/\/(pdf|api|templates)(\/|$|\?)|^\/(admin\/)?notifications\/[^/?]+/.test(href)) return null;
      if (href.split("#")[0] === location.pathname + location.search) return null;
      return href;
    }
    function warm(href: string) {
      const now = Date.now();
      if ((done.get(href) ?? 0) > now - 10_000) return;
      done.set(href, now);
      router.prefetch(href, { kind: "full" as PrefetchKind });
    }
    function onDown(e: PointerEvent) {
      const href = target(e);
      if (href) warm(href);
    }
    function onOver(e: MouseEvent) {
      const href = target(e);
      if (hover) clearTimeout(hover);
      if (href) hover = setTimeout(() => warm(href), 120);
    }
    document.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    document.addEventListener("mouseover", onOver, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown, { capture: true });
      document.removeEventListener("mouseover", onOver);
      if (hover) clearTimeout(hover);
    };
  }, [router]);

  // Start on taps on links to another page of the app.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      let url: URL;
      try {
        url = new URL(href, location.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin || /\/pdf(\?|$)/.test(url.pathname)) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      if (timer.current) clearTimeout(timer.current);
      setState("loading");
      leaving(true);
      // Never leave the screen faded if the next one does not come (offline, error).
      timer.current = setTimeout(() => leaving(false), 8000);
    }
    function onSubmit(e: SubmitEvent) {
      const f = e.target as HTMLFormElement | null;
      if (!f || f.target === "_blank") return;
      if (timer.current) clearTimeout(timer.current);
      setState("loading");
      // Server actions may stay on the same page: never leave the bar hanging.
      timer.current = setTimeout(() => setState("done"), 8000);
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      leaving(false);
    };
  }, []);

  return <div className={`navbar-progress ${state}`} aria-hidden="true" />;
}

export function NavProgress() {
  return (
    <Suspense fallback={null}>
      <Bar />
    </Suspense>
  );
}
