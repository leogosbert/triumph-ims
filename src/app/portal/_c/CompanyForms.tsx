"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTr } from "@/lib/tr-client";
import { requestBankChange } from "../actions";
import { PORTAL_FILE_TYPES, uploadPortalFile } from "./upload";

function useSender() {
  const tr = useTr();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const notices = (
    <>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {ok && <p className="notice notice-ok" role="status">{ok}</p>}
    </>
  );
  return { tr, router, setError, setOk, pending, start, notices };
}

/** New bank details: saved as a request for management to approve, with an optional bank letter. */
export function BankChange({ currency }: { currency: string }) {
  const { tr, router, setError, setOk, pending, start, notices } = useSender();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const input: Record<string, string> = {};
        for (const k of ["bank_name", "account_name", "account_number", "branch", "swift_code", "currency"]) input[k] = String(f.get(k) ?? "").trim();
        const letter = f.get("letter");
        setError(null);
        setOk(null);
        start(async () => {
          const r = await requestBankChange(input);
          if (r.error || !r.id) return setError(tr(r.error ?? "Something went wrong. Please try again."));
          if (letter instanceof File && letter.size > 0) {
            const u = await uploadPortalFile(letter, { purpose: "bank_letter", bank_detail_id: r.id, title: "Bank letter" });
            if (!u.ok) return setError(`${tr("The request was sent, but the bank letter was not:")} ${tr(u.error)}`);
          }
          form.reset();
          setOk(tr("Sent. Our management checks the new bank details before we use them; you will get an email."));
          router.refresh();
        });
      }}
    >
      {notices}
      <fieldset className="plain" disabled={pending}>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="bk-bank">{tr("Bank")}</label>
            <input id="bk-bank" name="bank_name" type="text" required maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="bk-branch">
              {tr("Branch")} <span className="hint">{tr("optional")}</span>
            </label>
            <input id="bk-branch" name="branch" type="text" maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="bk-name">{tr("Account name")}</label>
            <input id="bk-name" name="account_name" type="text" required maxLength={160} />
          </div>
          <div className="field">
            <label htmlFor="bk-no">{tr("Account number")}</label>
            <input id="bk-no" name="account_number" type="text" required maxLength={40} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="bk-swift">
              SWIFT <span className="hint">{tr("optional")}</span>
            </label>
            <input id="bk-swift" name="swift_code" type="text" maxLength={11} style={{ textTransform: "uppercase" }} />
          </div>
          <div className="field">
            <label htmlFor="bk-ccy">{tr("Currency")}</label>
            <input id="bk-ccy" name="currency" type="text" maxLength={3} defaultValue={currency} style={{ textTransform: "uppercase" }} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="bk-letter">
            {tr("Letter from your bank")} <span className="hint">{tr("recommended · PDF or photo")}</span>
          </label>
          <input id="bk-letter" name="letter" type="file" accept={PORTAL_FILE_TYPES} />
        </div>
        <button type="submit" className="btn btn-primary btn-block">
          {pending ? tr("Sending…") : tr("Send for approval")}
        </button>
      </fieldset>
    </form>
  );
}

/** A licence, TIN certificate or other company document. */
export function CompanyFile() {
  const { tr, router, setError, setOk, pending, start, notices } = useSender();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const file = f.get("file");
        if (!(file instanceof File) || file.size === 0) return setError(tr("Choose the file first."));
        const g = (k: string) => String(f.get(k) ?? "").trim();
        setError(null);
        setOk(null);
        start(async () => {
          const u = await uploadPortalFile(file, { purpose: g("purpose"), title: g("title"), reference: g("reference"), expires_on: g("expires_on") });
          if (!u.ok) return setError(tr(u.error));
          form.reset();
          setOk(tr("Document received. Thank you."));
          router.refresh();
        });
      }}
    >
      {notices}
      <fieldset className="plain" disabled={pending}>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="cf-purpose">{tr("Kind")}</label>
            <select id="cf-purpose" name="purpose" defaultValue="licence">
              <option value="licence">{tr("Licence")}</option>
              <option value="tin_certificate">{tr("TIN certificate")}</option>
              <option value="company_document">{tr("Company document")}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="cf-title">
              {tr("Title")} <span className="hint">{tr("optional")}</span>
            </label>
            <input id="cf-title" name="title" type="text" maxLength={200} />
          </div>
          <div className="field">
            <label htmlFor="cf-ref">
              {tr("Number")} <span className="hint">{tr("optional")}</span>
            </label>
            <input id="cf-ref" name="reference" type="text" maxLength={120} />
          </div>
          <div className="field">
            <label htmlFor="cf-exp">
              {tr("Expires")} <span className="hint">{tr("optional")}</span>
            </label>
            <input id="cf-exp" name="expires_on" type="date" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="cf-file">{tr("File")}</label>
          <input id="cf-file" name="file" type="file" required accept={PORTAL_FILE_TYPES} />
        </div>
        <button type="submit" className="btn btn-primary btn-block">
          {pending ? tr("Sending…") : tr("Send document")}
        </button>
      </fieldset>
    </form>
  );
}
