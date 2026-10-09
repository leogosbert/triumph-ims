"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES, shrinkImage } from "@/lib/image";
import { useTr } from "@/lib/tr-client";
import { attachReceipt } from "./actions";

/** Upload a receipt photo (or PDF) for an expense that already exists, and link it. */
export async function uploadReceipt(companyId: string, expenseId: string, file: File): Promise<{ error?: string }> {
  if (!RECEIPT_TYPES.includes(file.type)) return { error: "Please choose a photo (JPG, PNG, WebP) or a PDF." };
  const { blob, type, ext } = await shrinkImage(file);
  if (blob.size > RECEIPT_MAX_BYTES) return { error: "The receipt must be smaller than 5 MB." };
  const path = `${companyId}/${expenseId}/receipt-${Date.now()}.${ext}`;
  const { error } = await createClient().storage.from("receipts").upload(path, blob, { contentType: type, upsert: false });
  if (error) return { error: `Upload failed: ${error.message}` };
  return attachReceipt(expenseId, path);
}

/** Replace or remove the receipt on the expense page. */
export function ReceiptPicker({ companyId, expenseId, hasReceipt }: { companyId: string; expenseId: string; hasReceipt: boolean }) {
  const tr = useTr();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy(true);
    const res = await uploadReceipt(companyId, expenseId, file);
    setBusy(false);
    if (res.error) return setError(tr(res.error));
    router.refresh();
  }

  async function onRemove() {
    setBusy(true);
    const res = await attachReceipt(expenseId, null);
    setBusy(false);
    if (res.error) return setError(tr(res.error));
    router.refresh();
  }

  return (
    <div>
      <div className="actions" style={{ marginTop: 0 }}>
        <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? tr("Working…") : hasReceipt ? tr("Replace receipt") : tr("Add receipt photo")}
        </button>
        {hasReceipt && (
          <button type="button" className="btn btn-danger" disabled={busy} onClick={onRemove}>
            {tr("Remove")}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*,application/pdf" hidden onChange={onPick} />
      {error && <p className="small text-warn">{error}</p>}
    </div>
  );
}
