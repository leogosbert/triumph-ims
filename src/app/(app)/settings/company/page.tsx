import Link from "next/link";
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
  const notice = await readNotice(searchParams);
  const { supabase, company: c, isManager } = await getAppContext();
  const logo = brandingUrl(supabase, c.logo_path);

  return (
    <>
      <p className="small">
        <Link href="/settings">← Settings</Link>
      </p>
      <h1>Company details</h1>
      {!isManager && <p className="muted">Only management can change these details.</p>}
      <Notice {...notice} />

      {isManager && (
        <section className="card" id="branding">
          <h2>Logo</h2>
          <LogoUpload companyId={c.id} currentUrl={logo} />
        </section>
      )}

      <form action={updateCompany}>
        <fieldset disabled={!isManager} style={{ border: 0, padding: 0, margin: 0 }}>
          <section className="card">
            <h2>Registration</h2>
            <Field name="name" label="Trading name" value={c.name} required />
            <Field name="legal_name" label="Registered name" value={c.legal_name} hint="as on BRELA certificate" />
            <div className="grid grid-2">
              <Field name="tin" label="TIN" value={c.tin} />
              <Field name="vrn" label="VRN" value={c.vrn} hint="if VAT registered" />
            </div>
            <Field name="registration_no" label="Registration number" value={c.registration_no} />
          </section>

          <section className="card">
            <h2>Contact</h2>
            <Field name="address" label="Address" value={c.address} textarea />
            <div className="grid grid-2">
              <Field name="phone" label="Phone" value={c.phone} type="tel" />
              <Field name="email" label="Email" value={c.email} type="email" />
            </div>
            <Field name="website" label="Website" value={c.website} />
          </section>

          <section className="card">
            <h2>Currencies</h2>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="base_currency">Main currency</label>
                <select id="base_currency" name="base_currency" defaultValue={c.base_currency}>
                  {CURRENCIES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="second_currency">Second currency</label>
                <select id="second_currency" name="second_currency" defaultValue={c.second_currency ?? ""}>
                  <option value="">None</option>
                  {CURRENCIES.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>Colours</h2>
            <p className="muted small">Used in the app and on your documents.</p>
            <div className="swatches">
              <div className="field">
                <input id="primary_color" name="primary_color" type="color" defaultValue={c.primary_color} />
                <label htmlFor="primary_color">Main colour</label>
              </div>
              <div className="field">
                <input id="accent_color" name="accent_color" type="color" defaultValue={c.accent_color} />
                <label htmlFor="accent_color">Dark colour (top bar)</label>
              </div>
            </div>
          </section>

          <section className="card" id="documents">
            <h2>On your documents</h2>
            <Field
              name="bank_details"
              label="Bank details"
              value={c.bank_details}
              textarea
              hint="bank, branch, account name and numbers, SWIFT"
            />
            <Field
              name="document_footer"
              label="Footer text"
              value={c.document_footer}
              textarea
              hint="appears at the bottom of quotations and invoices"
            />
          </section>

          <section className="card" id="quotations">
            <h2>Quotations</h2>
            <div className="grid grid-2">
              <Field name="vat_rate" label="VAT rate %" value={String(c.vat_rate ?? 18)} hint="0 is used automatically for exempt clients" />
              <Field name="quote_validity_days" label="Quotations valid for (days)" value={String(c.quote_validity_days ?? 30)} />
              <Field name="quote_min_margin_pct" label="Minimum margin %" value={String(c.quote_min_margin_pct ?? 12)} hint="below this needs approval" />
              <Field
                name="quote_approval_above"
                label={`Approval needed above (${c.base_currency})`}
                value={Number(c.quote_approval_above ?? 25000000).toLocaleString("en-GB")}
                hint="incl. VAT"
              />
            </div>
            <Field name="quote_terms" label="Standard terms and conditions" value={c.quote_terms} textarea hint="printed on every quotation" />
          </section>

          <section className="card" id="purchasing">
            <h2>Purchase orders</h2>
            <Field
              name="po_approval_above"
              label={`Approval needed above (${c.base_currency})`}
              value={Number(c.po_approval_above ?? 2500000).toLocaleString("en-GB")}
              hint="for POs raised by procurement"
            />
            <Field name="po_terms" label="Standard PO terms" value={c.po_terms} textarea hint="printed on every purchase order" />
          </section>

          {isManager && (
            <SubmitButton className="btn btn-primary btn-block">Save company details</SubmitButton>
          )}
        </fieldset>
      </form>
    </>
  );
}
