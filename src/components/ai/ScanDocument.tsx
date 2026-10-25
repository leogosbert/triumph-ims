"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { readDocument } from "@/lib/ai/document-actions";
import { documentValues, LIBRARY_FIELDS, renewalLabel, unsureFieldNames, type DocFieldMap, type DocumentCheck } from "@/lib/ai/document";
import { forAiReading } from "@/lib/ai/shrink";
import { useTr } from "@/lib/tr-client";

const READABLE = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const isReadable = (f: File) => READABLE.includes(f.type) || f.type.startsWith("image/");

export type DocumentScan = {
  busy: boolean;
  error: string | null;
  /** The last reading (checked), or null. */
  check: DocumentCheck | null;
  /** Read a photo or PDF the person picked. Photos are made smaller first. Returns the reading or null (see `error`). */
  scanFile: (file: File) => Promise<DocumentCheck | null>;
  /** Read the file already stored with a library document. */
  scanStored: (documentId: string) => Promise<DocumentCheck | null>;
  reset: () => void;
};

/**
 * The hook behind "Read with AI", for any screen that takes a certificate, licence or permit
 * (documents library, compliance licences, checklist uploads). It only reads: what to do with the
 * reading (fill a form, show it) is up to the caller. Nothing is saved.
 */
export function useDocumentScan(): DocumentScan {
  const tr = useTr();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<DocumentCheck | null>(null);

  const run = useCallback(
    async (form: FormData) => {
      setBusy(true);
      setError(null);
      try {
        const res = await readDocument(form);
        if (!res.ok) {
          setError(tr(res.error));
          return null;
        }
        setCheck(res.check);
        return res.check;
      } catch {
        setError(tr("The document could not be read. Fill in the form by hand."));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [tr],
  );

  const scanFile = useCallback(
    async (file: File) => {
      if (!isReadable(file)) {
        setError(tr("AI can read photos and PDFs only. Fill in the details by hand."));
        return null;
      }
      const { blob, error: sizeError } = await forAiReading(file, "document");
      if (sizeError) {
        setError(tr(sizeError));
        return null;
      }
      const form = new FormData();
      form.set("file", blob, file.name || "document");
      return run(form);
    },
    [run, tr],
  );

  const scanStored = useCallback(
    async (documentId: string) => {
      const form = new FormData();
      form.set("document_id", documentId);
      return run(form);
    },
    [run],
  );

  const reset = useCallback(() => {
    setCheck(null);
    setError(null);
  }, []);

  return useMemo(() => ({ busy, error, check, scanFile, scanStored, reset }), [busy, error, check, scanFile, scanStored, reset]);
}

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function fieldIn(form: HTMLFormElement, name: string): Field | null {
  const el = form.elements.namedItem(name);
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ? el : null;
}

function untouched(el: Field): boolean {
  if (el instanceof HTMLSelectElement) return [...el.options].every((o) => o.selected === o.defaultSelected);
  return el.value === el.defaultValue || el.value.trim() === "";
}

/** Removes the "check" outlines that fillFromDocument added. */
export function clearDocumentMarks(form: HTMLFormElement) {
  form.querySelectorAll<HTMLElement>("[data-ai-check]").forEach((el) => {
    el.style.outline = "";
    el.removeAttribute("data-ai-check");
    el.removeAttribute("title");
  });
}

/**
 * Fills a form's fields by name from a reading. A field the person has already changed is kept
 * (except notes, which are added to); empty readings leave fields alone; a select is set only to one
 * of its own options. Doubtful fields get a "check" outline that goes when the field is changed.
 * Returns the labels of the fields marked "check".
 */
export function fillFromDocument(form: HTMLFormElement, check: DocumentCheck, fields: DocFieldMap = LIBRARY_FIELDS, opts: { overwrite?: boolean } = {}): string[] {
  clearDocumentMarks(form);
  const notesEl = fields.notes ? fieldIn(form, fields.notes) : null;
  const values = documentValues(check.reading, fields, notesEl?.value ?? "");
  for (const [name, value] of Object.entries(values)) {
    const el = fieldIn(form, name);
    if (!el || el.disabled || ("readOnly" in el && el.readOnly) || !value) continue;
    if (el === notesEl) el.value = value;
    else if (!opts.overwrite && !untouched(el)) continue;
    else if (el instanceof HTMLSelectElement) {
      if (![...el.options].some((o) => o.value === value)) continue;
      el.value = value;
    } else el.value = el instanceof HTMLInputElement && el.maxLength > 0 ? value.slice(0, el.maxLength) : value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  const labels: string[] = [];
  for (const name of unsureFieldNames(check, fields)) {
    const el = fieldIn(form, name);
    if (!el) continue;
    el.style.outline = "2px solid var(--warn)";
    el.style.outlineOffset = "1px";
    el.setAttribute("data-ai-check", "1");
    el.setAttribute("title", "Check");
    const clear = () => {
      el.style.outline = "";
      el.removeAttribute("data-ai-check");
      el.removeAttribute("title");
    };
    el.addEventListener("input", clear, { once: true });
    el.addEventListener("change", clear, { once: true });
    const label = el.id ? form.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
    const text = label?.firstChild?.textContent?.trim() || label?.textContent?.trim() || name;
    if (!labels.includes(text)) labels.push(text);
  }
  return labels;
}

/**
 * "Read with AI" for a form that takes a certificate, licence or permit. Put it inside the <form>.
 *
 * - `watchFile`: the name of a file input in the same form. When a photo or PDF is chosen there, it is
 *   read straight away and the form is filled ("When documents are uploaded, the system fills the data").
 * - `documentId`: a library document whose stored file can be read (edit screens).
 * - Without either, the button opens a picker for a photo or PDF.
 * - `fields`: which form field each detail goes to (default: the documents library names).
 * - `onRead`: called with the reading (and the picked file, if any), after the form is filled.
 *
 * Nothing is saved: the person checks the fields and saves. Without the AI key it shows disabled.
 */
export function ScanDocument({
  enabled,
  isManager = false,
  fields = LIBRARY_FIELDS,
  watchFile,
  documentId,
  onRead,
  overwrite = false,
  autoRead = false,
}: {
  enabled: boolean;
  isManager?: boolean;
  fields?: DocFieldMap;
  watchFile?: string;
  documentId?: string;
  onRead?: (check: DocumentCheck, file: File | null) => void;
  /** Replace fields the person already changed (default: keep them). */
  overwrite?: boolean;
  /** With `documentId`: read the stored file once as soon as the screen opens (after an upload). */
  autoRead?: boolean;
}) {
  const tr = useTr();
  const scan = useDocumentScan();
  const { scanFile, scanStored } = scan;
  const box = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [marked, setMarked] = useState<string[]>([]);
  const [shown, setShown] = useState(true);
  const [lastFile, setLastFile] = useState<File | null>(null);

  const apply = useCallback(
    (check: DocumentCheck | null, file: File | null) => {
      if (!check) return;
      const form = box.current?.closest("form");
      setMarked(form ? fillFromDocument(form, check, fields, { overwrite: overwrite || !!documentId }) : []);
      setShown(true);
      onRead?.(check, file);
    },
    [fields, overwrite, documentId, onRead],
  );

  const readFile = useCallback(
    async (file: File) => {
      setLastFile(file);
      apply(await scanFile(file), file);
    },
    [apply, scanFile],
  );

  // Read automatically when a photo or PDF is chosen in the form's own file field.
  useEffect(() => {
    if (!enabled || !watchFile) return;
    const form = box.current?.closest("form");
    const input = form?.elements.namedItem(watchFile);
    if (!(input instanceof HTMLInputElement)) return;
    const onChange = () => {
      const f = input.files?.[0];
      if (f && isReadable(f)) void readFile(f);
    };
    input.addEventListener("change", onChange);
    return () => input.removeEventListener("change", onChange);
  }, [enabled, watchFile, readFile]);

  // After an upload: read the stored file once.
  const autoDone = useRef(false);
  useEffect(() => {
    if (!enabled || !autoRead || !documentId || autoDone.current) return;
    autoDone.current = true;
    void scanStored(documentId).then((c) => apply(c, null));
  }, [enabled, autoRead, documentId, scanStored, apply]);

  async function onClick() {
    if (documentId) return apply(await scan.scanStored(documentId), null);
    if (watchFile && lastFile) return readFile(lastFile);
    const form = box.current?.closest("form");
    const input = watchFile ? form?.elements.namedItem(watchFile) : null;
    const f = input instanceof HTMLInputElement ? input.files?.[0] : undefined;
    if (f) return readFile(f);
    picker.current?.click();
  }

  const check = scan.check;
  return (
    <div ref={box} className="field" style={{ gridColumn: "1 / -1" }}>
      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn" disabled={!enabled || scan.busy} aria-busy={scan.busy} onClick={onClick}>
          <Icon name="doc" size={18} /> {scan.busy ? tr("Reading the document…") : check ? tr("Read again with AI") : documentId ? tr("Read the file with AI") : tr("Read with AI")}
        </button>
        <span className="hint">
          {!enabled
            ? isManager
              ? tr("Reading documents with AI is off. Add ANTHROPIC_API_KEY in Netlify (Site configuration → Environment variables) to switch it on.")
              : tr("Reading documents with AI is off. Management can switch it on.")
            : watchFile
              ? tr("Choose a photo or PDF and AI fills in the details. Check them before saving.")
              : documentId
                ? tr("AI reads the stored file and fills in the details below. Check them before saving.")
                : tr("Take a photo of the document and AI fills in the details. Check them before saving.")}
        </span>
      </div>
      {!watchFile && !documentId && (
        <input
          ref={picker}
          type="file"
          accept="image/*,application/pdf"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void readFile(f);
          }}
        />
      )}
      {scan.error && (
        <p className="small text-warn" role="alert">
          {scan.error}
        </p>
      )}
      {check && shown && <DocumentReadNote check={check} marked={marked} onDismiss={() => setShown(false)} />}
    </div>
  );
}

/** "Read by AI — check before saving": what was read, the fields to check and any warnings. */
export function DocumentReadNote({ check, marked = [], onDismiss }: { check: DocumentCheck; marked?: string[]; onDismiss?: () => void }) {
  const tr = useTr();
  const r = check.reading;
  const conf = r.confidence;
  const facts = [
    r.authority && `${tr("Issued by")}: ${r.authority}`,
    r.holder && `${tr("Holder")}: ${r.holder}`,
    r.renewal && r.renewal !== "none" && `${tr("Renewal")}: ${tr(renewalLabel(r.renewal))}`,
    r.tin && `TIN: ${r.tin}`,
    r.registration_no && `${tr("Registration no.")}: ${r.registration_no}`,
  ].filter(Boolean) as string[];
  return (
    <div className="banner warn small" role="status" style={{ marginTop: 8 }}>
      <strong>{tr("Read by AI — check before saving")}</strong>{" "}
      <span className={`badge tone-${conf === "high" ? "ok" : conf === "medium" ? "warn" : "bad"}`}>
        {conf === "high" ? tr("Clear picture") : conf === "medium" ? tr("Partly clear") : tr("Hard to read")}
      </span>
      {r.summary && <p style={{ margin: "6px 0 0" }}>{r.summary}</p>}
      {facts.length > 0 && <p style={{ margin: "4px 0 0" }}>{facts.join(" · ")}</p>}
      {marked.length > 0 && (
        <p style={{ margin: "6px 0 0" }}>
          {tr("Check")}: {marked.join(", ")}
        </p>
      )}
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
