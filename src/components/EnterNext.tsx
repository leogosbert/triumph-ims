"use client";

import { useEffect } from "react";

/**
 * On a phone keyboard, a field marked enterKeyHint="next" shows "Next" on its Enter key. Some
 * phones then send a plain Enter, which would send the form half filled, so here Enter on such a
 * field moves to the next field of the same form instead. On the last field it sends the form as
 * usual. Laptops (a real keyboard) keep Enter = send.
 */
const FIELDS = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([disabled]):not([readonly]), select:not([disabled]), textarea:not([disabled])";

export function EnterNext() {
  useEffect(() => {
    const touch = window.matchMedia("(pointer: coarse)");
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.isComposing || e.defaultPrevented || !touch.matches) return;
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || el.enterKeyHint !== "next" || !el.form) return;
      const fields = Array.from(el.form.querySelectorAll<HTMLElement>(FIELDS)).filter((f) => f.offsetParent !== null);
      const next = fields[fields.indexOf(el) + 1];
      if (!next) return;
      e.preventDefault();
      next.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
