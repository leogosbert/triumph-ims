import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { StepUpForm } from "@/components/ConfirmIdentity";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { brandingUrl, getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { updateCompany } from "../actions";
import { LogoUpload } from "./LogoUpload";

export const metadata = { title: "Company details" };

const CURRENCIES = ["TZS", "USD", "EUR", "GBP", "ZAR", "KES", "UGX", "ZMW", "CNY", "INR", "AED"];

function Field(props: {
  name: string;
  label: string;
  value: string | null;
  hint?: string;
  type?: string;
  textarea?: boolean;
  required?: boolean;
}) {
  const { name, label, value, hint, type = "text", textarea, required } = props;
  return (
    <div className="field">
      <label htmlFor={name}>
        {label} {hint && <span className="hint">· {hint}</span>}
      </label>
      {textarea ? (
        <textarea id={name} name={name} defaultValue={value ?? ""} />
      ) : (
        <input id={name} name={name} type={type} defaultValue={value ?? ""} required={required} />
      )}
    </div>
  );
}

export default async function CompanyPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company: c, isManager } = await getAppContext();
  const logo = brandingUrl(supabase, c.logo_path);

  return (
    <>
      <p className="small">
        <Link href="/settings">{tr("← Settings")}</Link>
      </p>
      <h1>{tr("Company details")}</h1>
      {!isManager && <p className="muted">{tr("Only management can change these details.")}</p>}
      <Notice {...notice} />

      {isManager && (
        <section className="card" id="branding">
          <h2>{tr("Logo")}</h2>
          <LogoUpload companyId={c.id} currentUrl={logo} />
        </section>
      )}

      <StepUpForm action={updateCompany} onlyIfChanged="bank_details,document_footer,quote_terms,po_terms,invoice_terms">
        <fieldset disabled={!isManager} style={{ border: 0, padding: 0, margin: 0 }}>
          <section className="card">
            <h2>{tr("Registration")}</h2>
            <Field name="name" label={tr("Trading name")} value={c.name} required />
            <Field name="legal_name" label={tr("Registered name")} value={c.legal_name} hint={tr("as on BRELA certificate")} />
            <div className="grid grid-2">
              <Field name="tin" label={tr("TIN")} value={c.tin} />
              <Field name="vrn" label={tr("VRN")} value={c.vrn} hint={tr("if VAT registered")} />
            </div>
            <Field name="registration_no" label={tr("Registration number")} value={c.registration_no} />
          </section>

          <section className="card">
            <h2>{tr("Contact")}</h2>
            <Field name="address" label={tr("Address")} value={c.address} textarea />
            <div className="grid grid-2">
              <Field name="phone" label={tr("Phone")} value={c.phone} type="tel" />
              <Field name="email" label={tr("Email")} value={c.email} type="email" />
            </div>
            <Field name="website" label={tr("Website")} value={c.website} />
          </section>

          <section className="card">
            <h2>{tr("Currencies")}</h2>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="base_currency">{tr("Main currency")}</label>
                <select id="base_currency" name="base_currency" defaultValue={c.base_currency}>
                  {CURRENCIES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="second_currency">{tr("Second currency")}</label>
                <select id="second_currency" name="second_currency" defaultValue={c.second_currency ?? ""}>
                  <option value="">{tr("None")}</option>
                  {CURRENCIES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>{tr("Colours")}</h2>
            <p className="muted small">{tr("Used in the app and on your documents.")}</p>
            <div className="swatches">
              <div className="field">
                <input id="primary_color" name="primary_color" type="color" defaultValue={c.primary_color} />
                <label htmlFor="primary_color">{tr("Main colour")}</label>
              </div>
              <div className="field">
                <input id="accent_color" name="accent_color" type="color" defaultValue={c.accent_color} />
                <label htmlFor="accent_color">{tr("Dark colour (top bar)")}</label>
              </div>
            </div>
          </section>

          <section className="card" id="documents">
            <h2>{tr("On your documents")}</h2>
            <Field
              name="bank_details"
              label={tr("Bank details")}
              value={c.bank_details}
              textarea
              hint={tr("bank, branch, account name and numbers, SWIFT")}
            />
            <Field
              name="document_footer"
              label={tr("Footer text")}
              value={c.document_footer}
              textarea
              hint={tr("appears at the bottom of quotations and invoices")}
            />
          </section>

          <section className="card" id="quotations">
            <h2>{tr("Quotations")}</h2>
            <div className="grid grid-2">
              <Field name="vat_rate" label={tr("VAT rate %")} value={String(c.vat_rate ?? 18)} hint={tr("0 is used automatically for exempt clients")} />
              <Field name="quote_validity_days" label={tr("Quotations valid for (days)")} value={String(c.quote_validity_days ?? 30)} />
              <Field name="quote_min_margin_pct" label={tr("Minimum margin %")} value={String(c.quote_min_margin_pct ?? 12)} hint={tr("below this needs approval")} />
              <Field
                name="quote_approval_above"
                label={`Approval needed above (${c.base_currency})`}
                value={Number(c.quote_approval_above ?? 25000000).toLocaleString("en-GB")}
                hint={tr("incl. VAT")}
              />
            </div>
            <Field name="quote_terms" label={tr("Standard terms and conditions")} value={c.quote_terms} textarea hint={tr("printed on every quotation")} />
          </section>

          <section className="card" id="purchasing">
            <h2>{tr("Purchase orders")}</h2>
            <Field
              name="po_approval_above"
              label={`Approval needed above (${c.base_currency})`}
              value={Number(c.po_approval_above ?? 2500000).toLocaleString("en-GB")}
              hint={tr("for POs raised by procurement")}
            />
            <Field name="po_terms" label={tr("Standard PO terms")} value={c.po_terms} textarea hint={tr("printed on every purchase order")} />
          </section>

          {c.invoice_due_days !== undefined && (
            <section className="card" id="invoicing">
              <h2>{tr("Invoices")}</h2>
              <Field
                name="invoice_due_days"
                label={tr("Clients pay within (days)")}
                value={String(c.invoice_due_days ?? 30)}
                hint={tr("sets the due date when an invoice is issued")}
              />
              <Field name="invoice_terms" label={tr("Standard invoice terms")} value={c.invoice_terms ?? null} textarea hint={tr("printed on every invoice")} />
            </section>
          )}

          {isManager && (
            <SubmitButton className="btn btn-primary btn-block">{tr("Save company details")}</SubmitButton>
          )}
        </fieldset>
      </StepUpForm>

      {isManager && !c.is_demo && (
        <section className="card danger-zone" id="close">
          <h2>{tr("Close company account")}</h2>
          <p className="small muted">{tr("Stop using LeMoSp for this company and delete all its data after 30 days.")}</p>
          <Link href="/settings/company/close" className="btn btn-danger">
            {tr("Close company account")}
          </Link>
        </section>
      )}
    </>
  );
}
