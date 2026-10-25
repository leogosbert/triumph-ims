import { tr } from "@/lib/tr";
import { COMPLIANCE_CATALOGUE } from "@/lib/compliance/catalogue";
import type { Licence } from "@/lib/compliance/model";

const LICENCE_REQS = COMPLIANCE_CATALOGUE.filter((r) => r.kind === "licence" || r.kind === "registration");

/** The editable details of a licence (new and edit). Server component; the page calls primeLang(). */
export function LicenceFields({ v }: { v: Partial<Licence> }) {
  return (
    <div className="grid grid-2">
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="name">{tr("Name")}</label>
        <input id="name" name="name" type="text" required minLength={2} maxLength={160} defaultValue={v.name ?? ""} placeholder={tr("e.g. GCLA chemical dealer registration")} />
      </div>
      <div className="field">
        <label htmlFor="authority">{tr("Authority")}</label>
        <input id="authority" name="authority" type="text" maxLength={160} defaultValue={v.authority ?? ""} placeholder={tr("e.g. GCLA, EWURA, the council, a mine")} />
      </div>
      <div className="field">
        <label htmlFor="licence_no">{tr("Licence or certificate number")}</label>
        <input id="licence_no" name="licence_no" type="text" maxLength={80} defaultValue={v.licence_no ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="catalogue_code">{tr("Requirement in the catalogue")}</label>
        <select id="catalogue_code" name="catalogue_code" defaultValue={v.catalogue_code ?? ""}>
          <option value="">{tr("— Own licence —")}</option>
          {LICENCE_REQS.map((r) => (
            <option key={r.code} value={r.code}>
              {tr(r.name)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="category">{tr("Kind")}</label>
        <input id="category" name="category" type="text" maxLength={80} defaultValue={v.category ?? ""} placeholder={tr("e.g. chemicals, petroleum, vendor, premises")} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="product_scope">
          {tr("What it covers")} <span className="hint">· {tr("products, sites or clients")}</span>
        </label>
        <input id="product_scope" name="product_scope" type="text" maxLength={500} defaultValue={v.product_scope ?? ""} placeholder={tr("e.g. industrial lubricants and greases; Geita site")} />
      </div>
      <div className="field">
        <label htmlFor="applied_on">{tr("Applied on")}</label>
        <input id="applied_on" name="applied_on" type="date" defaultValue={v.applied_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="issued_on">{tr("Issued on")}</label>
        <input id="issued_on" name="issued_on" type="date" defaultValue={v.issued_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="expires_on">{tr("Expires on")}</label>
        <input id="expires_on" name="expires_on" type="date" defaultValue={v.expires_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="remind_days">{tr("Remind me this many days before")}</label>
        <input id="remind_days" name="remind_days" type="number" min={0} max={365} defaultValue={v.remind_days ?? 60} />
      </div>
      <div className="field">
        <label htmlFor="cost">{tr("Cost")}</label>
        <input id="cost" name="cost" type="number" min={0} step="0.01" defaultValue={v.cost ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="currency">{tr("Currency")}</label>
        <input id="currency" name="currency" type="text" maxLength={3} defaultValue={v.currency ?? "TZS"} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="conditions">{tr("Conditions")}</label>
        <textarea id="conditions" name="conditions" maxLength={2000} defaultValue={v.conditions ?? ""} placeholder={tr("What the licence requires you to do, for example yearly inspection or storage rules")} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" maxLength={2000} defaultValue={v.notes ?? ""} />
      </div>
    </div>
  );
}
