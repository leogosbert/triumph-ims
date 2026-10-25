"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTr } from "@/lib/tr-client";
import { submitDocument } from "../actions";
import { PORTAL_FILE_TYPES, uploadPortalFile } from "./upload";

/** A delivery note or an invoice from the supplier, with the scanned document attached. */
export function SubmitDoc({ orders, defaultPo, currency }: { orders: { id: string; number: string; currency: string }[]; defaultPo: string; currency: string }) {
  const tr = useTr();
  const router = useRouter();
  const [kind, setKind] = useState<"invoice" | "delivery_note">("invoice");
  const [po, setPo] = useState(defaultPo);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ccy = orders.find((o) => o.id === po)?.currency ?? currency;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const file = f.get("file");
        if (!(file instanceof File) || file.size === 0) return setError(tr("Attach the document (a PDF or a photo)."));
        const input: Record<string, string> = { kind, po_id: po };
        for (const k of ["supplier_invoice_no", "reference", "doc_date", "due_date", "currency", "subtotal", "vat_amount", "notes"]) {
          input[k] = String(f.get(k) ?? "").trim();
        }
        input.subtotal = input.subtotal.replace(/[\s,]/g, "");
        input.vat_amount = input.vat_amount.replace(/[\s,]/g, "");
        setError(null);
        setOk(null);
        start(async () => {
          const r = await submitDocument(input);
          if (r.error || !r.id) return setError(tr(r.error ?? "Something went wrong. Please try again."));
          const u = await uploadPortalFile(file, { purpose: kind, submission_id: r.id });
          if (!u.ok) return setError(`${tr("The details were sent, but the file was not:")} ${tr(u.error)}`);
          form.reset();
          setOk(kind === "invoice" ? tr("Invoice sent. Our finance team checks it before it is booked.") : tr("Delivery note sent. Thank you."));
          router.refresh();
        });
      }}
    >
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {ok && <p className="notice notice-ok" role="status">{ok}</p>}
      <div className="seg portal-seg">
        <button type="button" aria-pressed={kind === "invoice"} onClick={() => setKind("invoice")}>
          {tr("Invoice")}
        </button>
        <button type="button" aria-pressed={kind === "delivery_note"} onClick={() => setKind("delivery_note")}>
          {tr("Delivery note")}
        </button>
      </div>
      <fieldset className="plain" disabled={pending}>
        <div className="field">
          <label htmlFor="sd-po">{tr("For purchase order")}</label>
          <select id="sd-po" value={po} onChange={(e) => setPo(e.target.value)}>
            <option value="">{tr("— No order number —")}</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.number}
              </option>
            ))}
          </select>
        </div>
        {kind === "invoice" ? (
          <>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="sd-no">{tr("Your invoice number")}</label>
                <input id="sd-no" name="supplier_invoice_no" type="text" required maxLength={80} />
              </div>
              <div className="field">
                <label htmlFor="sd-ccy">{tr("Currency")}</label>
                <input id="sd-ccy" key={ccy} name="currency" type="text" maxLength={3} defaultValue={ccy} style={{ textTransform: "uppercase" }} />
              </div>
              <div className="field">
                <label htmlFor="sd-date">{tr("Invoice date")}</label>
                <input id="sd-date" name="doc_date" type="date" />
              </div>
              <div className="field">
                <label htmlFor="sd-due">{tr("Due date")}</label>
                <input id="sd-due" name="due_date" type="date" />
              </div>
              <div className="field">
                <label htmlFor="sd-sub">{tr("Amount before VAT")}</label>
                <input id="sd-sub" name="subtotal" type="text" inputMode="decimal" required />
              </div>
              <div className="field">
                <label htmlFor="sd-vat">{tr("VAT")}</label>
                <input id="sd-vat" name="vat_amount" type="text" inputMode="decimal" />
              </div>
            </div>
          </>
        ) : (
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="sd-ref">{tr("Delivery note number")}</label>
              <input id="sd-ref" name="reference" type="text" maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="sd-ddate">{tr("Delivery date")}</label>
              <input id="sd-ddate" name="doc_date" type="date" />
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="sd-notes">
            {tr("Notes")} <span className="hint">{tr("optional")}</span>
          </label>
          <textarea id="sd-notes" name="notes" maxLength={2000} rows={2} />
        </div>
        <div className="field">
          <label htmlFor="sd-file">
            {tr("The document")} <span className="hint">{tr("PDF, photo, Word or Excel · up to 15 MB")}</span>
          </label>
          <input id="sd-file" name="file" type="file" required accept={PORTAL_FILE_TYPES} />
        </div>
        <button type="submit" className="btn btn-primary btn-block">
          {pending ? tr("Sending…") : kind === "invoice" ? tr("Send invoice") : tr("Send delivery note")}
        </button>
      </fieldset>
    </form>
  );
}
