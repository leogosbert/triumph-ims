import { tr } from "@/lib/tr";
import { formatDate, formatDateTime } from "@/lib/format";
import { call, requireParty } from "@/lib/portal/server";
import type { SupplierProfile } from "@/lib/portal/types";
import { updateSupplier } from "../../actions";
import { ActionForm } from "../../_c/ActionForm";
import { BankChange, CompanyFile } from "../../_c/CompanyForms";

export const metadata = { title: "Your company" };

const PURPOSE: Record<string, string> = {
  licence: "Licence",
  tin_certificate: "TIN certificate",
  company_document: "Company document",
  bank_letter: "Bank letter",
};

/** The supplier's own details, bank account (changes need our approval) and company documents. */
export default async function PortalCompany() {
  const ctx = await requireParty("supplier");
  const p = await call<SupplierProfile>(ctx, "portal_supplier_profile");
  return (
    <>
      <div className="page-head">
        <h1>{p.name}</h1>
      </div>

      <section className="card">
        <h2>{tr("Company details")}</h2>
        <ActionForm action={updateSupplier}>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="sp-tin">{tr("TIN")}</label>
              <input id="sp-tin" name="tax_no" type="text" maxLength={40} defaultValue={p.tax_no ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="sp-phone">{tr("Phone")}</label>
              <input id="sp-phone" name="phone" type="tel" maxLength={40} defaultValue={p.phone ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="sp-city">{tr("City")}</label>
              <input id="sp-city" name="city" type="text" maxLength={80} defaultValue={p.city ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="sp-country">{tr("Country")}</label>
              <input id="sp-country" name="country" type="text" maxLength={80} defaultValue={p.country ?? ""} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="sp-certs">
              {tr("Certificates and licences")} <span className="hint">{tr("for example ISO 9001, TBS, OSHA")}</span>
            </label>
            <textarea id="sp-certs" name="certificates" maxLength={2000} rows={2} defaultValue={p.certificates ?? ""} />
          </div>
          <button type="submit" className="btn btn-primary">{tr("Save")}</button>
        </ActionForm>
      </section>

      <section className="card" id="bank">
        <h2>{tr("Bank details")}</h2>
        {p.bank ? (
          <dl className="kv">
            <dt>{tr("Bank")}</dt>
            <dd>
              {p.bank.bank_name}
              {p.bank.branch ? `, ${p.bank.branch}` : ""}
            </dd>
            <dt>{tr("Account name")}</dt>
            <dd>{p.bank.account_name}</dd>
            <dt>{tr("Account number")}</dt>
            <dd>{p.bank.account_number}</dd>
            {p.bank.swift_code && (
              <>
                <dt>SWIFT</dt>
                <dd>{p.bank.swift_code}</dd>
              </>
            )}
            <dt>{tr("Currency")}</dt>
            <dd>{p.bank.currency}</dd>
          </dl>
        ) : (
          <p className="muted small">{tr("We have no approved bank account for you yet.")}</p>
        )}
        {p.pending && (
          <p className="notice notice-ok">
            {tr("New bank details are waiting for our management's approval")}: {p.pending.bank_name} {p.pending.account_number} ({p.pending.currency}) ·{" "}
            {formatDateTime(p.pending.requested_at)}. {tr("We pay to the old account until then.")}
          </p>
        )}
        {!p.pending && p.last_decision?.status === "rejected" && (
          <p className="notice notice-error">
            {tr("Your last bank change was not approved")}
            {p.last_decision.note ? `: ${p.last_decision.note}` : "."}
          </p>
        )}
        <details className="portal-details">
          <summary>{p.bank || p.pending ? tr("Change bank details") : tr("Add bank details")}</summary>
          <p className="small muted">
            {tr("For your safety, a change is used only after our management approves it. We may call you on a number we already have to check it.")}
          </p>
          <BankChange currency={p.currency} />
        </details>
      </section>

      <section className="card">
        <h2>{tr("Company documents")}</h2>
        {p.files.length === 0 ? (
          <p className="muted small">{tr("Send us your TIN certificate, business licence and other documents here.")}</p>
        ) : (
          <ul className="list">
            {p.files.map((f) => (
              <li key={f.id} className="portal-row">
                <span>
                  <strong>{f.title || tr(PURPOSE[f.purpose] ?? "Document")}</strong>
                  <br />
                  <span className="small muted">
                    {tr(PURPOSE[f.purpose] ?? "Document")}
                    {f.reference ? ` · ${f.reference}` : ""}
                    {f.expires_on ? ` · ${tr("Expires")} ${formatDate(f.expires_on)}` : ""} · {formatDate(f.created_at)}
                  </span>
                </span>
                <a href={`/portal/download/file/${f.id}/file`} target="_blank" rel="noopener">
                  {tr("Open")}
                </a>
              </li>
            ))}
          </ul>
        )}
        <details className="portal-details">
          <summary>{tr("Send a document")}</summary>
          <CompanyFile />
        </details>
      </section>
    </>
  );
}
