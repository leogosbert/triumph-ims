"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTr } from "@/lib/tr-client";
import { uploadDocumentFile } from "./upload";

/** Add or replace the file of a library document. */
export function FilePicker({ companyId, documentId, hasFile, readAfter = false }: { companyId: string; documentId: string; hasFile: boolean; readAfter?: boolean }) {
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
    // With AI on, a new photo or PDF is read straight away and fills the details (the person checks and saves).
    if (readAfter && (file.type === "application/pdf" || file.type.startsWith("image/"))) router.replace(`/documents/${documentId}?read=1#details`);
    else router.refresh();
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
