"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useTr } from "@/lib/tr-client";

/**
 * Phones: pull the home screen or a list down from the very top to load it again
 * (router.refresh(): fresh figures from the server, nothing typed is lost).
 *
 * ui-phone.css sets overscroll-behavior on the page while this is mounted, so the browser's own
 * pull-to-refresh (a full reload) does not fire as well. Screens that are mostly typing (Ask,
 * settings, account) and the offline driver screen are left alone.
 */
const PULL_AT = 72; // px of (damped) pull that refreshes
const MAX_PULL = 110;
const SKIP = new Set(["assistant", "account", "settings", "search", "more", "driver", "guide", "help", "import", "onboarding"]);

export function pullEnabled(pathname: string) {
  if (pathname === "/") return true;
  const m = /^\/([a-z-]+)\/?$/.exec(pathname);
  return Boolean(m && !SKIP.has(m[1]));
}

export function PullToRefresh() {
  const tr = useTr();
  const router = useRouter();
  const pathname = usePathname();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const pullRef = useRef(0);
  const enabled = pullEnabled(pathname);

  useEffect(() => {
    if (!enabled) return;
    const phone = window.matchMedia("(max-width: 1023px) and (pointer: coarse)");
    let startY: number | null = null;
    let startX = 0;
    let active = false;

    const blocked = (t: EventTarget | null) => {
      const el = t instanceof Element ? t : null;
      if (!el) return true;
      // Not from inside a sheet, a dialog, the bottom bar, a field, or something that scrolls itself.
      if (el.closest("[role='dialog'], [aria-modal='true'], .bottomnav, .msheet, .csheet, input, textarea, select, [contenteditable='true']")) return true;
      for (let n: Element | null = el; n && n !== document.body; n = n.parentElement) {
        if (n.scrollTop > 0) return true;
      }
      // A sheet open somewhere (the page behind it is locked).
      return document.body.style.overflow === "hidden" || document.documentElement.style.overflow === "hidden";
    };
    const set = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };
    const onStart = (e: TouchEvent) => {
      if (!phone.matches || e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) {
        startY = null;
        return;
      }
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      active = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      const dx = Math.abs(e.touches[0].clientX - startX);
      if (!active) {
        // Only a downward pull from the top; a sideways swipe (tabs, carousels) is not one.
        if (dy < 8 || dx > dy || window.scrollY > 0) {
          if (dy < -4 || dx > 12) startY = null;
          return;
        }
        active = true;
      }
      set(Math.min(MAX_PULL, Math.max(0, (dy - 8) * 0.5)));
    };
    const onEnd = () => {
      if (startY === null) return;
      startY = null;
      const v = pullRef.current;
      if (active && v >= PULL_AT) {
        try {
          navigator.vibrate?.(10);
        } catch {
          /* no haptics here */
        }
        setBusy(true);
        startTransition(() => router.refresh());
      }
      active = false;
      set(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, router]);

  // Keep the spinner up a moment so a quick refresh is still seen.
  useEffect(() => {
    if (!busy || pending) return;
    const t = setTimeout(() => setBusy(false), 350);
    return () => clearTimeout(t);
  }, [busy, pending]);

  if (!enabled) return null;
  const shown = busy ? PULL_AT : pull;
  const ready = busy || pull >= PULL_AT;
  return (
    <div
      className={`ptr${shown > 0 ? " ptr-on" : ""}${busy ? " ptr-busy" : ""}${ready ? " ptr-ready" : ""}`}
      style={{ "--ptr": `${shown}px` } as React.CSSProperties}
      aria-hidden={!busy}
    >
      <span className="ptr-ball">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={busy ? undefined : { transform: `rotate(${shown * 3}deg)` }}>
          <path d="M20 12a8 8 0 1 1-2.34-5.66" />
          <path d="M20 4v4h-4" />
        </svg>
      </span>
      <span className="sr-only" role="status">{busy ? tr("Refreshing…") : ""}</span>
    </div>
  );
}
