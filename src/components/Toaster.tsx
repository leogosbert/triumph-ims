"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTr } from "@/lib/tr-client";
import { startListening, stopListening, TOAST_DISMISS_EVENT, TOAST_EVENT, type ToastItem } from "@/lib/toast";

type Shown = ToastItem & { leaving?: boolean };

const LEAVE_MS = 260;
const MAX = 3;

/**
 * Where the small pop-ups appear: bottom of the screen above the bottom bar on phones, top right
 * on laptops. The live region is always on the page, so screen readers announce each new message
 * (aria-live="polite": after what they are reading). Mounted once in the root layout.
 */
export function Toaster() {
  const tr = useTr();
  const [items, setItems] = useState<Shown[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const recent = useRef(new Map<string, number>());

  const remove = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
    setItems((list) => list.map((i) => (i.id === id ? { ...i, leaving: true } : i)));
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), LEAVE_MS);
  }, []);

  const arm = useCallback(
    (id: number, ms: number) => {
      const old = timers.current.get(id);
      if (old) clearTimeout(old);
      if (ms > 0) timers.current.set(id, setTimeout(() => remove(id), ms));
    },
    [remove],
  );

  useEffect(() => {
    function onShow(e: Event) {
      const item = (e as CustomEvent<ToastItem>).detail;
      if (!item?.text) return;
      // The same note twice in a row (a screen drawn twice, or two notices on one screen) shows once.
      const now = Date.now();
      if (!item.action && now - (recent.current.get(item.text) ?? 0) < 1500) return;
      recent.current.set(item.text, now);
      setItems((list) => [...list.filter((i) => !i.leaving), item].slice(-MAX));
      arm(item.id, item.duration ?? 3000);
    }
    function onDismiss(e: Event) {
      remove((e as CustomEvent<number>).detail);
    }
    window.addEventListener(TOAST_EVENT, onShow);
    window.addEventListener(TOAST_DISMISS_EVENT, onDismiss);
    startListening().forEach((item) => onShow(new CustomEvent(TOAST_EVENT, { detail: item })));
    const all = timers.current;
    return () => {
      stopListening();
      window.removeEventListener(TOAST_EVENT, onShow);
      window.removeEventListener(TOAST_DISMISS_EVENT, onDismiss);
      all.forEach((t) => clearTimeout(t));
      all.clear();
    };
  }, [arm, remove]);

  // Hovering or focusing a toast keeps it open; it hides a moment after the pointer or focus leaves.
  const hold = (i: Shown) => (i.duration ? arm(i.id, 0) : undefined);
  const release = (i: Shown) => (i.duration ? arm(i.id, 1500) : undefined);

  return (
    <div className="toaster" aria-live="polite" aria-relevant="additions">
      {items.map((i) => (
        <div
          key={i.id}
          className={`toast toast-${i.tone ?? "ok"}${i.leaving ? " leaving" : ""}${i.action ? " has-action" : ""}`}
          onMouseEnter={() => hold(i)}
          onMouseLeave={() => release(i)}
          onFocus={() => hold(i)}
          onBlur={() => release(i)}
        >
          <span className="toast-icon" aria-hidden>
            {i.tone === "info" ? "↺" : "✓"}
          </span>
          <span className="toast-text">{i.text}</span>
          {i.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                i.action?.onClick();
                remove(i.id);
              }}
            >
              {i.action.label}
            </button>
          )}
          {!i.action && (
            <button type="button" className="toast-close" onClick={() => remove(i.id)} aria-label={tr("Close")}>
              ×
            </button>
          )}
          {i.countdown ? <span className="toast-timer" style={{ animationDuration: `${i.countdown}ms` }} aria-hidden /> : null}
        </div>
      ))}
    </div>
  );
}
