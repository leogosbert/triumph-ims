"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AiReadNote, ScanReceipt } from "@/components/ai/ScanReceipt";
import { expensePrefill, type ReceiptCheck, type ReceiptField } from "@/lib/ai/receipt";
import { CURRENCIES } from "@/lib/lists";
import { useTr } from "@/lib/tr-client";
import { createExpense } from "./actions";
import { type Category, ExpenseFields, type ExpenseValues } from "./ExpenseFields";
import { uploadReceipt } from "./ReceiptPicker";

/** Which form field shows each part of a receipt reading (for the "check" marks). */
const FIELD_OF: Partial<Record<ReceiptField, string>> = {
  vendor: "payee",
  date: "spent_on",
  total: "amount",
  vat: "vat_amount",
  currency: "currency",
  category: "category_id",
  description: "description",
};

export function NewExpenseForm({
  companyId,
  base,
  categories,
  start,
  withProvider,
  aiOn = false,
  isManager = false,
}: {
  companyId: string;
  base: string;
  categories: Category[];
  start: ExpenseValues;
  withProvider: boolean;
  /** The AI service is set up on the server: "Scan receipt" works. */
  aiOn?: boolean;
  isManager?: boolean;
}) {
  const tr = useTr();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  // Filled in by a scan: the fields are drawn again with the values read (the key changes).
  const [values, setValues] = useState<ExpenseValues>(start);
  const [round, setRound] = useState(0);
  const [scanned, setScanned] = useState<{ check: ReceiptCheck; file: File } | null>(null);

  function current(): ExpenseValues {
    const f = formRef.current ? new FormData(formRef.current) : null;
    const s = (k: string) => (f?.get(k) == null ? null : String(f.get(k)));
    const num = (k: string) => {
      const x = Number((s(k) ?? "").replace(/,/g, ""));
      return Number.isFinite(x) && x > 0 ? x : null;
    };
    return {
      ...values,
      category_id: s("category_id") || values.category_id,
      spent_on: s("spent_on") || values.spent_on,
      payee: s("payee") || null,
      description: s("description") ?? values.description,
      amount: num("amount"),
      vat_amount: num("vat_amount") ?? 0,
      currency: s("currency") || values.currency,
      exchange_rate: num("exchange_rate") ?? values.exchange_rate,
      method: s("method") || values.method,
      provider: s("provider") || values.provider,
      reference: s("reference") || null,
      notes: s("notes") || null,
    };
  }

  function onRead(check: ReceiptCheck, file: File) {
    const now = current();
    const next = expensePrefill(check.reading, now, categories, [...new Set([base, ...CURRENCIES])]);
    setValues({ ...now, ...next });
    setRound((r) => r + 1);
    setScanned({ check, file });
    setFileName(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    // A file chosen in the receipt field wins; otherwise the scanned photo is attached.
    const file = fileRef.current?.files?.[0] ?? scanned?.file ?? null;
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

  const unsure = scanned ? scanned.check.unsure.map((f) => FIELD_OF[f]).filter((f): f is string => !!f) : [];

  return (
    <form ref={formRef} onSubmit={onSubmit} className="card">
      <ScanReceipt enabled={aiOn} purpose="expense" onRead={onRead} isManager={isManager} />
      {scanned && <AiReadNote check={scanned.check} />}
      <ExpenseFields key={round} v={values} base={base} categories={categories} withProvider={withProvider} unsure={unsure} />
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
        <span className="hint">
          {fileName
            ? fileName
            : scanned
              ? `${tr("The scanned receipt is attached:")} ${scanned.file.name || tr("Receipt photo")}`
              : tr("Take a photo of the receipt, or choose a file (optional).")}
        </span>
      </div>
      {error && <div className="banner warn small">{tr(error)}</div>}
      <button type="submit" className="btn btn-primary btn-block" disabled={!!busy} aria-busy={!!busy}>
        {busy ?? tr("Save expense")}
      </button>
    </form>
  );
}
