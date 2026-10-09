"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTr } from "@/lib/tr-client";
import { createDocument } from "./actions";
import { DocumentFields, type DocValues, type LinkOptions } from "./DocumentFields";
import { uploadDocumentFile } from "./upload";

export function NewDocumentForm({ companyId, start, links, back }: { companyId: string; start: DocValues; links: LinkOptions; back: string | null }) {
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
    form.delete("file");
    setBusy(tr("Saving…"));
    const res = await createDocument(form);
    if (res.error || !res.id) {
      setBusy(null);
      return setError(res.error ?? "Something went wrong.");
    }
    if (file) {
      setBusy(tr("Uploading the file…"));
      const up = await uploadDocumentFile(companyId, res.id, file);
      if (up.error) {
        router.push(`/documents/${res.id}?error=${encodeURIComponent(`${tr("Document saved, but the file did not upload:")} ${tr(up.error)}`)}`);
        return;
      }
    }
    router.push(back ? `${back}${back.includes("?") ? "&" : "?"}msg=${encodeURIComponent("Document added.")}` : `/documents/${res.id}?msg=${encodeURIComponent("Document added.")}`);
  }

  return (
    <form onSubmit={onSubmit} className="card">
      <div className="field">
        <label htmlFor="file">{tr("File")}</label>
        <input
          ref={fileRef}
          id="file"
          name="file"
          type="file"
          accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx"
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
        <span className="hint">{fileName ?? tr("PDF, photo, Word or Excel, up to 20 MB. You can also add the file later.")}</span>
      </div>
      <DocumentFields v={start} links={links} />
      {error && <div className="banner warn small">{tr(error)}</div>}
      <button type="submit" className="btn btn-primary btn-block" disabled={!!busy} aria-busy={!!busy}>
        {busy ?? tr("Save document")}
      </button>
    </form>
  );
}
