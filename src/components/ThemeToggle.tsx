"use client";

import { useRef } from "react";
import { useTr } from "@/lib/tr-client";
import { Icon } from "@/components/Icon";
import { setTheme } from "@/app/theme-actions";

/**
 * Glass top bar: one tap between light and dark. The colours change at once; the choice is then
 * saved like Account → Appearance (which also offers Auto).
 */
export function ThemeToggle() {
  const tr = useTr();
  const input = useRef<HTMLInputElement>(null);
  return (
    <form action={setTheme}>
      <input ref={input} type="hidden" name="theme" defaultValue="dark" />
      <button
        type="submit"
        className="icon-btn theme-btn"
        aria-label={tr("Light or dark")}
        title={tr("Light or dark")}
        onClick={() => {
          const d = document.documentElement;
          const next = d.getAttribute("data-theme") === "dark" ? "light" : "dark";
          if (input.current) input.current.value = next;
          d.setAttribute("data-theme", next);
          d.setAttribute("data-theme-pref", next);
        }}
      >
        <Icon name="moon" size={20} />
      </button>
    </form>
  );
}
