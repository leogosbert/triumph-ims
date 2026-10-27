"use client";

import { useState } from "react";
import { useTr } from "@/lib/tr-client";

/** "Copy the minutes" (plain text for email or WhatsApp) and "Print or save as PDF". */
export function CopyMinutes({ text }: { text: string }) {
  const tr = useTr();
  const [copied, setCopied] = useState(false);
  return (
    <div className="inline-form" style={{ gap: 6 }}>
      <button
        type="button"
        className="btn btn-small"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            /* the browser refused: nothing else to do */
          }
        }}
      >
        {copied ? tr("Copied") : tr("Copy the minutes")}
      </button>
      <button type="button" className="btn btn-small" onClick={() => window.print()}>
        {tr("Print or save as PDF")}
      </button>
    </div>
  );
}
