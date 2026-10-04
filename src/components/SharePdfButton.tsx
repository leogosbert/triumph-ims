"use client";

import { useTr } from "@/lib/tr-client";
import { useState } from "react";

/** Shares the PDF through the phone's share sheet (WhatsApp, email…), or downloads it on a computer. */
export function SharePdfButton({ href, fileName, title }: { href: string; fileName: string; title: string }) {
  const tr = useTr();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onShare() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const file = new File([blob], fileName, { type: "application/pdf" });
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError("Could not prepare the PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={onShare} disabled={busy}>
        {busy ? tr("Preparing…") : tr("Share PDF")}
      </button>
      {error && <span className="small text-warn">{error}</span>}
    </>
  );
}
