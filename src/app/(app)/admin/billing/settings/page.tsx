import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { BILLING_MISSING, loadBillingSettings } from "@/lib/billing";
import { readNotice, type SearchParams } from "@/lib/messages";
import { platformAdmin } from "../../guard";
import { saveBillingSettings } from "../actions";

export const metadata = { title: "LeMo Tech details" };

/** LeMo Tech's own details: printed on every invoice to a company and on "How to pay". */
export default async function AdminBillingSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const notice = await readNotice(searchParams);
  const s = await loadBillingSettings(admin.supabase);
  if (!s) return <p className="card muted">{tr(BILLING_MISSING)}</p>;
  const field = (name: keyof typeof s, label: string, opts: { area?: boolean; hint?: string; mode?: "decimal" | "numeric" } = {}) => (
    <>
      <label htmlFor={name}>{tr(label)}</label>
      {opts.area ? (
        <textarea id={name} name={name} defaultValue={String(s[name] ?? "")} maxLength={600} />
      ) : (
        <input id={name} name={name} defaultValue={String(s[name] ?? "")} inputMode={opts.mode} />
      )}
      {opts.hint && <p className="hint">{tr(opts.hint)}</p>}
    </>
  );
  return (
    <>
      <Notice {...notice} />
      <section className="card">
        <h2>{tr("LeMo Tech details")}</h2>
        <p className="muted small">{tr("Printed on every invoice to a company and shown under How to pay in each company's Plan & billing.")}</p>
        <form action={saveBillingSettings} className="stack">
          {field("legal_name", "Business name")}
          {field("tin", "TIN")}
          {field("vrn", "VRN (when VAT-registered)")}
          {field("address", "Address")}
          {field("phone", "Phone")}
          {field("email", "Email")}
          {field("mobile_money", "Mobile money (Lipa Namba, till numbers)", { area: true, hint: "For example: M-Pesa Lipa Namba 123456, name LEMO TECH SOLUTIONS" })}
          {field("bank_details", "Bank details", { area: true, hint: "Bank, branch, account name and number; SWIFT for USD payments." })}
          {field("vat_rate", "VAT rate %", { mode: "decimal", hint: "0 until LeMo Tech is VAT-registered; then 18. Applies to new invoices only." })}
          {field("usd_rate", "Pricing rate (TZS for 1 USD)", { mode: "decimal", hint: "Reviewed each quarter. USD prices in the price book are set item by item." })}
          {field("payment_days", "Days to pay after an invoice is issued", { mode: "numeric" })}
          {field("invoice_note", "Note on every invoice", { area: true })}
          <SubmitButton className="btn btn-primary" pendingText={tr("Saving…")}>
            {tr("Save")}
          </SubmitButton>
        </form>
      </section>
    </>
  );
}
