import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { requirement } from "@/lib/compliance/catalogue";
import { legalRules } from "@/lib/compliance/rules";
import { createLicence } from "../../actions";
import { LicenceFields } from "../../LicenceFields";
import { RequirementFacts } from "../../parts";

export const metadata = { title: "New licence" };

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function NewLicencePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) redirect("/compliance/licences");
  const req = requirement(pick(sp.code));
  const itemId = pick(sp.item);
  const set = await supabase.from("compliance_settings").select("legal_rules").eq("company_id", company.id).maybeSingle();
  if (isMissingTable(set.error)) return <NotReady title="New licence" />;
  const rules = legalRules(set.data?.legal_rules);

  return (
    <>
      <p className="small">
        <Link href="/compliance/licences">{tr("← Licences")}</Link>
      </p>
      <h1>{tr("New licence")}</h1>
      <p className="muted small">{tr("Record it as soon as you plan to apply: you can follow it from To apply for, to Applied, to Active.")}</p>
      <Notice {...notice} />
      {req && (
        <details className="card">
          <summary>{tr(req.name)}</summary>
          <RequirementFacts r={req} />
        </details>
      )}
      <form action={createLicence} className="card">
        {itemId && /^[0-9a-f-]{36}$/.test(itemId) && <input type="hidden" name="item_id" value={itemId} />}
        {/* ScanDocument goes here: it fills the named inputs below (name, authority, licence_no, issued_on, expires_on, product_scope, notes) */}
        <LicenceFields
          v={{
            name: req ? tr(req.name) : "",
            authority: req ? req.authority.slice(0, 160) : "",
            catalogue_code: req?.code ?? null,
            remind_days: rules.licence_remind_days,
            currency: company.base_currency || "TZS",
          }}
        />
        <div className="field">
          <label htmlFor="status">{tr("Where it stands")}</label>
          <select id="status" name="status" defaultValue="planned">
            <option value="planned">{tr("To apply for")}</option>
            <option value="applied">{tr("Applied")}</option>
            <option value="active">{tr("Active (we hold it)")}</option>
          </select>
        </div>
        <SubmitButton className="btn btn-primary btn-block">{tr("Add the licence")}</SubmitButton>
      </form>
    </>
  );
}
