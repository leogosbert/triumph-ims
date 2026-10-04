"use client";

import { useEffect } from "react";

/**
 * Makes headline figures count up when a screen opens (e.g. "TZS 485,000,000").
 * Works on already-formatted text: only the number part moves, the rest stays.
 */
export function CountUp({ selector }: { selector: string }) {
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const jobs = els
      .map((el) => {
        const text = el.textContent ?? "";
        const m = text.match(/-?\d[\d,]*(\.\d+)?/);
        if (!m || m.index === undefined) return null;
        const raw = m[0];
        const target = Number(raw.replace(/,/g, ""));
        if (!Number.isFinite(target) || target === 0) return null;
        const decimals = m[1] ? m[1].length - 1 : 0;
        const commas = raw.includes(",");
        return { el, text, start: m.index, raw, target, decimals, commas };
      })
      .filter((j): j is NonNullable<typeof j> => j !== null);
    if (jobs.length === 0) return;

    const fmt = (v: number, d: number, commas: boolean) =>
      commas
        ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })
        : v.toFixed(d);
    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      for (const j of jobs) {
        const shown = p === 1 ? j.raw : fmt(j.target * e, j.decimals, j.commas);
        j.el.textContent = j.text.slice(0, j.start) + shown + j.text.slice(j.start + j.raw.length);
      }
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      for (const j of jobs) j.el.textContent = j.text;
    };
  }, [selector]);
  return null;
}
