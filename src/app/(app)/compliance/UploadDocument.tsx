"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTr } from "@/lib/tr-client";
import { createDocument } from "../documents/actions";
import { uploadDocumentFile } from "../documents/upload";
import { linkComplianceDocument } from "./actions";
import { ScanDocument } from "@/components/ai/ScanDocument";

/**
 * Upload a certificate or receipt for a checklist item or licence. It goes into the documents
 * library (with its expiry reminder) and is linked here.
 */
export function UploadDocument({
  companyId,
  itemId,
  licenceId,
  defaultTitle,
  defaultKind,
  defaultExpiry,
  defaultReference,
  aiOn = false,
  isManager = false,
}: {
  companyId: string;
  itemId?: string;
  licenceId?: string;
  defaultTitle: string;
  defaultKind: string;
  defaultExpiry?: string | null;
  defaultReference?: string | null;
  aiOn?: boolean;
  isManager?: boolean;
}) {
  const tr = useTr();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const file = fileRef.current?.files?.[0] ?? null;
    form.delete("file");
    if (!file) return setError(tr("Choose the file to upload."));
    setBusy(tr("Saving…"));
    const res = await createDocument(form);
    if (res.error || !res.id) {
      setBusy(null);
      return setError(tr(res.error ?? "Something went wrong."));
    }
    setBusy(tr("Uploading the file…"));
    const up = await uploadDocumentFile(companyId, res.id, file);
    const link = await linkComplianceDocument({ itemId, licenceId }, res.id);
    setBusy(null);
    if (up.error) return setError(`${tr("Document saved, but the file did not upload:")} ${tr(up.error)}`);
    if (link.error) return setError(tr(link.error));
    formEl.reset();
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-small btn-primary" onClick={() => setOpen(true)}>
        {tr("Upload a document")}
      </button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="grid grid-2" style={{ marginTop: 8 }}>
      <input type="hidden" name="kind" value={defaultKind} />
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="cd-file">{tr("File")}</label>
        <input ref={fileRef} id="cd-file" name="file" type="file" accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" required />
        <span className="hint">{tr("PDF, photo, Word or Excel, up to 20 MB.")}</span>
      </div>
      <div style={{ gridColumn: "1 / -1" }}>
        <ScanDocument enabled={aiOn} isManager={isManager} watchFile="file" fields={{ title: "title", reference: "reference", issued_on: "issued_on", expires_on: "expires_on" }} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="cd-title">{tr("Document name")}</label>
        <input id="cd-title" name="title" type="text" required minLength={2} maxLength={200} defaultValue={defaultTitle} />
      </div>
      <div className="field">
        <label htmlFor="cd-ref">{tr("Number")}</label>
        <input id="cd-ref" name="reference" type="text" maxLength={120} defaultValue={defaultReference ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="cd-issued">{tr("Issued on")}</label>
        <input id="cd-issued" name="issued_on" type="date" />
      </div>
      <div className="field">
        <label htmlFor="cd-exp">
          {tr("Expires on")} <span className="hint">· {tr("leave empty if it does not expire")}</span>
        </label>
        <input id="cd-exp" name="expires_on" type="date" defaultValue={defaultExpiry ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="cd-remind">{tr("Remind me (days before)")}</label>
        <input id="cd-remind" name="remind_days" type="number" min={0} max={180} defaultValue={30} />
      </div>
      {error && (
        <div className="banner warn small" style={{ gridColumn: "1 / -1" }}>
          {error}
        </div>
      )}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="submit" className="btn btn-primary" disabled={!!busy} aria-busy={!!busy}>
          {busy ?? tr("Upload and link")}
        </button>
        <button type="button" className="btn" disabled={!!busy} onClick={() => setOpen(false)}>
          {tr("Cancel")}
        </button>
      </div>
    </form>
  );
}
