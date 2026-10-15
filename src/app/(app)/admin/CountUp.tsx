"use client";

import { useEffect, useRef } from "react";

/**
 * A number that counts up when the page opens. The server sends the final figure (so it is right
 * without JavaScript and for screen readers); the count only plays for people who allow motion.
 */
export function CountUp({ value, format = (n) => Math.round(n).toLocaleString("en-GB") }: { value: number; format?: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !Number.isFinite(value) || value === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const ms = Math.min(1100, 500 + Math.log10(Math.abs(value) + 1) * 200);
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = format(value * eased);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.textContent = format(value);
    };
    // format is a display helper; the count restarts only when the value changes.
  }, [value]);
  return <span ref={ref}>{format(value)}</span>;
}
