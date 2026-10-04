"use client";

import { useEffect, useState } from "react";
import { useTr } from "@/lib/tr-client";

/**
 * Result of the last action. Problems stay on the page until dealt with;
 * "done" messages appear as a small pop-up at the bottom and fade after a few seconds.
 */
export function Notice({ msg, error }: { msg?: string; error?: string }) {
  const tr = useTr();
  const [state, setState] = useState<"open" | "leaving" | "closed">("open");

  useEffect(() => {
    setState("open");
    if (!msg || error) return;
    const t = setTimeout(() => setState("leaving"), 6000);
    return () => clearTimeout(t);
  }, [msg, error]);

  useEffect(() => {
    if (state !== "leaving") return;
    const t = setTimeout(() => setState("closed"), 260);
    return () => clearTimeout(t);
  }, [state]);

  if (error) {
    return (
      <p className="notice notice-error" role="alert">
        <span className="notice-icon" aria-hidden>
          !
        </span>
        <span>{tr(error)}</span>
      </p>
    );
  }
  if (msg && state !== "closed") {
    return (
      <div className={`toast${state === "leaving" ? " leaving" : ""}`} role="status">
        <span className="toast-icon" aria-hidden>
          ✓
        </span>
        <span className="toast-text">{tr(msg)}</span>
        <button type="button" className="toast-close" onClick={() => setState("leaving")} aria-label={tr("Close")}>
          ×
        </button>
      </div>
    );
  }
  return null;
}
