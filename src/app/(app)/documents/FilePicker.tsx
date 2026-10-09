"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTr } from "@/lib/tr-client";
import { uploadDocumentFile } from "./upload";

/** Add or replace the file of a library document. */
export function FilePicker({ companyId, documentId, hasFile }: { companyId: string; documentId: string; hasFile: boolean }) {
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
    const res = await uploadDocumentFile(companyId, documentId, file);
    setBusy(false);
    if (res.error) return setError(tr(res.error));
    router.refresh();
  }

  return (
    <div>
      <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? tr("Uploading…") : hasFile ? tr("Upload a new version") : tr("Add the file")}
      </button>
      <input ref={input} type="file" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" hidden onChange={onPick} />
      {error && <p className="small text-warn">{error}</p>}
    </div>
  );
}
