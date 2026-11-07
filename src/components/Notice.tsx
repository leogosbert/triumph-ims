"use client";

import { useEffect } from "react";
import { useTr } from "@/lib/tr-client";
import { showToast } from "@/lib/toast";

/**
 * Result of the last action (from ?msg= / ?error=). Problems stay on the page as a banner until
 * dealt with, so they are not missed; "done" messages ("Saved", "Sent to client") become a small
 * pop-up (<Toaster>, root layout) that hides after about 3 seconds.
 */
export function Notice({ msg, error }: { msg?: string; error?: string }) {
  const tr = useTr();

  useEffect(() => {
    if (msg && !error) showToast({ text: tr(msg) });
  }, [msg, error, tr]);

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
  return null;
}
