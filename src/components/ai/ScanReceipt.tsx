"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { readReceipt } from "@/lib/ai/receipt-actions";
import type { ReceiptCheck } from "@/lib/ai/receipt";
import { RECEIPT_TYPES } from "@/lib/image";
import { forAiReading } from "@/lib/ai/shrink";
import { useTr } from "@/lib/tr-client";

/**
 * "Scan receipt": pick or take a photo (or a PDF), the server reads it with AI, and `onRead` gets the
 * checked details plus the original file (to attach as the receipt). Nothing is saved here.
 * Without the AI service set up the button shows disabled, with how to switch it on.
 */
export function ScanReceipt({
  enabled,
  purpose,
  onRead,
  isManager = false,
}: {
  enabled: boolean;
  purpose: "expense" | "bill";
  onRead: (check: ReceiptCheck, file: File) => void;
  isManager?: boolean;
}) {
  const tr = useTr();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (!RECEIPT_TYPES.includes(file.type) && !file.type.startsWith("image/")) return setError(tr("Please choose a photo (JPG, PNG, WebP) or a PDF."));
    setBusy(true);
    try {
      const { blob, error: sizeError } = await forAiReading(file, "receipt");
      if (sizeError) return setError(tr(sizeError));
      const form = new FormData();
      form.set("purpose", purpose);
      form.set("file", blob, file.name || "receipt");
      const res = await readReceipt(form);
      if (!res.ok) return setError(tr(res.error));
      onRead(res.check, file);
    } catch {
      setError(tr("The receipt could not be read. Fill in the form by hand."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field" style={{ gridColumn: "1 / -1" }}>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn" disabled={!enabled || busy} aria-busy={busy} onClick={() => input.current?.click()}>
          <Icon name="receipt" size={18} /> {busy ? tr("Reading the receipt…") : tr("Scan receipt")}
        </button>
        <span className="hint">
          {enabled
            ? tr("Take a photo of the receipt and AI fills in the form. Check it before saving.")
            : isManager
              ? tr("Reading receipts with AI is off. Add ANTHROPIC_API_KEY in Netlify (Site configuration → Environment variables) to switch it on.")
              : tr("Reading receipts with AI is off. Management can switch it on.")}
        </span>
      </div>
      <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={onPick} />
      {error && <p className="small text-warn" role="alert">{error}</p>}
    </div>
  );
}

/** "Read by AI — check before saving", with the notes from the check. */
export function AiReadNote({ check, onDismiss }: { check: ReceiptCheck; onDismiss?: () => void }) {
  const tr = useTr();
  const conf = check.reading.confidence;
  return (
    <div className="banner warn small" role="status" style={{ gridColumn: "1 / -1" }}>
      <strong>{tr("Read by AI — check before saving")}</strong>{" "}
      <span className={`badge tone-${conf === "high" ? "ok" : conf === "medium" ? "warn" : "bad"}`}>
        {conf === "high" ? tr("Clear picture") : conf === "medium" ? tr("Partly clear") : tr("Hard to read")}
      </span>
      {check.unsure.length > 0 && <p style={{ margin: "6px 0 0" }}>{tr("Fields marked “check” could not be read for sure.")}</p>}
      {check.warnings.length > 0 && (
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {check.warnings.map((w) => (
            <li key={w}>{tr(w)}</li>
          ))}
        </ul>
      )}
      {onDismiss && (
        <button type="button" className="btn btn-small" style={{ marginTop: 6 }} onClick={onDismiss}>
          {tr("Hide")}
        </button>
      )}
    </div>
  );
}
