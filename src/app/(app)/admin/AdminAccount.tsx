"use client";

import { useEffect, useRef } from "react";
import { signOut } from "@/app/actions";
import { useTr } from "@/lib/tr-client";

/** The signed-in admin: initials in the bar, and a small menu with the company app and Sign out. */
export function AdminAccount({ name, companyApp, newTab, canSignOut }: { name: string; companyApp: string | null; newTab: boolean; canSignOut: boolean }) {
  const tr = useTr();
  const ref = useRef<HTMLDetailsElement>(null);
  const initials =
    name
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "A";

  // Close on a tap outside or Escape, like any menu.
  useEffect(() => {
    const close = (e: Event) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="adm-acct">
      <summary aria-label={tr("Your account")}>
        <span className="adm-avatar" aria-hidden>
          {initials}
        </span>
        <span className="adm-acct-name">{name}</span>
        <svg className="adm-acct-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <div className="adm-acct-menu" role="menu">
        <p className="adm-acct-who">
          <span className="adm-avatar adm-avatar-lg" aria-hidden>
            {initials}
          </span>
          <span>
            <strong>{name}</strong>
            <span className="small">{tr("Platform admin")}</span>
          </span>
        </p>
        {companyApp && (
          <a href={companyApp} role="menuitem" {...(newTab ? { target: "_blank", rel: "noopener" } : {})}>
            {tr("Open company app")}
          </a>
        )}
        <a href="/two-step" role="menuitem">
          {tr("Two-step verification")}
        </a>
        {canSignOut && (
          <form action={signOut}>
            <button type="submit" role="menuitem">
              {tr("Sign out")}
            </button>
          </form>
        )}
      </div>
    </details>
  );
}
