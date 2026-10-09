"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTr } from "@/lib/tr-client";
import { createExpense } from "./actions";
import { type Category, ExpenseFields, type ExpenseValues } from "./ExpenseFields";
import { uploadReceipt } from "./ReceiptPicker";

export function NewExpenseForm({
  companyId,
  base,
  categories,
  start,
  withProvider,
}: {
  companyId: string;
  base: string;
  categories: Category[];
  start: ExpenseValues;
  withProvider: boolean;
}) {
  const tr = useTr();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const file = fileRef.current?.files?.[0] ?? null;
    form.delete("receipt");
    setBusy(tr("Saving…"));
    const res = await createExpense(form);
    if (res.error || !res.id) {
      setBusy(null);
      return setError(res.error ?? "Something went wrong.");
    }
    if (file) {
      setBusy(tr("Uploading the receipt…"));
      const up = await uploadReceipt(companyId, res.id, file);
      if (up.error) {
        // The expense is saved; the photo can be added again on its page.
        router.push(`/expenses/${res.id}?error=${encodeURIComponent(`${tr("Expense saved, but the receipt did not upload:")} ${tr(up.error)}`)}`);
        return;
      }
    }
    router.push(`/expenses/${res.id}?msg=${encodeURIComponent("Expense recorded.")}`);
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <ExpenseFields v={start} base={base} categories={categories} withProvider={withProvider} />
      <div className="field">
        <label htmlFor="receipt">{tr("Receipt photo")}</label>
        <input
          ref={fileRef}
          id="receipt"
          name="receipt"
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
        <span className="hint">{fileName ? fileName : tr("Take a photo of the receipt, or choose a file (optional).")}</span>
      </div>
      {error && <div className="banner warn small">{tr(error)}</div>}
      <button type="submit" className="btn btn-primary btn-block" disabled={!!busy} aria-busy={!!busy}>
        {busy ?? tr("Save expense")}
      </button>
    </form>
  );
}
