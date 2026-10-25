"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTr } from "@/lib/tr-client";
import type { RfqDetail } from "@/lib/portal/types";
import { answerRfq } from "../actions";
import { PORTAL_FILE_TYPES, uploadPortalFile } from "./upload";

const num = (v: number | null | undefined) => (v == null ? "" : String(Number(v)));

/** The supplier's prices for one request: per line, plus lead time, validity, terms and attachments. */
export function AnswerRfq({ rfq, currency }: { rfq: RfqDetail; currency: string }) {
  const tr = useTr();
  const router = useRouter();
  const [prices, setPrices] = useState<Record<string, { unit_price: string; notes: string }>>(() =>
    Object.fromEntries(rfq.lines.map((l) => [l.id, { unit_price: num(l.unit_price), notes: l.notes ?? "" }])),
  );
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send(form: HTMLFormElement, decline: boolean) {
    const f = new FormData(form);
    const g = (k: string) => String(f.get(k) ?? "").trim();
    setError(null);
    setOk(null);
    start(async () => {
      const r = await answerRfq(rfq.id, {
        decline,
        currency: g("currency"),
        lead_time_days: g("lead_time_days"),
        valid_until: g("valid_until"),
        payment_terms: g("payment_terms"),
        incoterms: g("incoterms"),
        freight: g("freight").replace(/[\s,]/g, ""),
        supplier_ref: g("supplier_ref"),
        notes: g("notes"),
        lines: decline
          ? []
          : rfq.lines.map((l) => ({ line_id: l.id, unit_price: (prices[l.id]?.unit_price ?? "").replace(/[\s,]/g, ""), notes: prices[l.id]?.notes ?? "" })),
      });
      if (r.error) return setError(r.error);
      if (!decline) {
        for (const file of files) {
          const u = await uploadPortalFile(file, { purpose: "rfq_quote", srfq_supplier_id: rfq.id });
          if (!u.ok) return setError(`${file.name}: ${tr(u.error)}`);
        }
        setFiles([]);
      }
      setOk(r.ok ?? "");
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send(e.currentTarget, false);
      }}
    >
      {error && <p className="notice notice-error" role="alert">{tr(error)}</p>}
      {ok && <p className="notice notice-ok" role="status">{tr(ok)}</p>}
      <fieldset className="plain" disabled={pending}>
        <ul className="lines">
          {rfq.lines.map((l) => (
            <li key={l.id} className="portal-price-line">
              <div>
                <strong>{l.description}</strong>
                <div className="small muted">
                  {Number(l.quantity)} {l.unit}
                </div>
              </div>
              <div className="portal-price-inputs">
                <label className="small">
                  {tr("Unit price")} ({currency})
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={prices[l.id]?.unit_price ?? ""}
                    onChange={(e) => setPrices((p) => ({ ...p, [l.id]: { ...p[l.id], unit_price: e.target.value } }))}
                  />
                </label>
                <label className="small">
                  {tr("Note")}
                  <input
                    type="text"
                    maxLength={500}
                    placeholder={tr("Brand, pack size…")}
                    value={prices[l.id]?.notes ?? ""}
                    onChange={(e) => setPrices((p) => ({ ...p, [l.id]: { ...p[l.id], notes: e.target.value } }))}
                  />
                </label>
              </div>
            </li>
          ))}
        </ul>
        <p className="hint">{tr("Leave a price empty if you cannot offer that item.")}</p>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="ar-ccy">{tr("Currency")}</label>
            <input id="ar-ccy" name="currency" type="text" maxLength={3} defaultValue={currency} style={{ textTransform: "uppercase" }} />
          </div>
          <div className="field">
            <label htmlFor="ar-lead">{tr("Lead time (days)")}</label>
            <input id="ar-lead" name="lead_time_days" type="number" min={0} max={730} defaultValue={rfq.lead_time_days ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="ar-valid">{tr("Prices valid until")}</label>
            <input id="ar-valid" name="valid_until" type="date" defaultValue={rfq.valid_until ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="ar-freight">
              {tr("Freight")} <span className="hint">{tr("optional")}</span>
            </label>
            <input id="ar-freight" name="freight" type="text" inputMode="decimal" defaultValue={Number(rfq.freight) ? num(rfq.freight) : ""} />
          </div>
          <div className="field">
            <label htmlFor="ar-terms">{tr("Payment terms")}</label>
            <input id="ar-terms" name="payment_terms" type="text" maxLength={200} defaultValue={rfq.payment_terms ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="ar-inco">{tr("Incoterms")}</label>
            <input id="ar-inco" name="incoterms" type="text" maxLength={40} defaultValue={rfq.incoterms ?? ""} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ar-ref">
            {tr("Your quotation number")} <span className="hint">{tr("optional")}</span>
          </label>
          <input id="ar-ref" name="supplier_ref" type="text" maxLength={120} defaultValue={rfq.supplier_ref ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="ar-notes">
            {tr("Notes")} <span className="hint">{tr("optional")}</span>
          </label>
          <textarea id="ar-notes" name="notes" maxLength={2000} defaultValue={rfq.answer_notes ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="ar-files">
            {tr("Attach your quotation or datasheets")} <span className="hint">{tr("PDF, photo, Word or Excel · up to 15 MB each")}</span>
          </label>
          <input id="ar-files" type="file" multiple accept={PORTAL_FILE_TYPES} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        </div>
        <button type="submit" className="btn btn-primary btn-block">
          {pending ? tr("Sending…") : tr("Send prices")}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-block"
          style={{ marginTop: 8 }}
          onClick={(e) => {
            if (window.confirm(tr("Tell us you cannot quote this request?"))) send(e.currentTarget.form!, true);
          }}
        >
          {tr("We cannot quote")}
        </button>
      </fieldset>
    </form>
  );
}
