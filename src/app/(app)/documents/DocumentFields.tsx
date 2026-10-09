"use client";

import { DOC_KINDS } from "@/lib/crm";
import { useTr } from "@/lib/tr-client";

export type DocValues = {
  title?: string;
  kind?: string;
  reference?: string | null;
  issued_on?: string | null;
  expires_on?: string | null;
  remind_days?: number;
  notes?: string | null;
  product_id?: string | null;
  supplier_id?: string | null;
  client_id?: string | null;
  tender_id?: string | null;
  contract_id?: string | null;
};

export type Option = { id: string; name: string };
export type LinkOptions = { products: Option[]; suppliers: Option[]; clients: Option[]; tenders: Option[]; contracts: Option[] };

const LINK_FIELDS = [
  { key: "product_id", label: "Product", list: "products" },
  { key: "supplier_id", label: "Supplier", list: "suppliers" },
  { key: "client_id", label: "Client", list: "clients" },
  { key: "tender_id", label: "Tender", list: "tenders" },
  { key: "contract_id", label: "Contract", list: "contracts" },
] as const;

/** The details of a library document and what it belongs to (new and edit). */
export function DocumentFields({ v, links }: { v: DocValues; links: LinkOptions }) {
  const tr = useTr();
  return (
    <div className="grid grid-2">
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="title">{tr("Document name")}</label>
        <input id="title" name="title" type="text" required minLength={2} maxLength={200} defaultValue={v.title ?? ""} placeholder={tr("e.g. Business licence 2026")} />
      </div>
      <div className="field">
        <label htmlFor="kind">{tr("Type")}</label>
        <select id="kind" name="kind" defaultValue={v.kind ?? "other"}>
          {DOC_KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {tr(k.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="reference">{tr("Number")}</label>
        <input id="reference" name="reference" type="text" maxLength={120} defaultValue={v.reference ?? ""} placeholder={tr("Certificate or licence number")} />
      </div>
      <div className="field">
        <label htmlFor="issued_on">{tr("Issued on")}</label>
        <input id="issued_on" name="issued_on" type="date" defaultValue={v.issued_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="expires_on">
          {tr("Expires on")} <span className="hint">· {tr("leave empty if it does not expire")}</span>
        </label>
        <input id="expires_on" name="expires_on" type="date" defaultValue={v.expires_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="remind_days">{tr("Remind me (days before)")}</label>
        <input id="remind_days" name="remind_days" type="number" min={0} max={180} defaultValue={v.remind_days ?? 30} />
      </div>
      {LINK_FIELDS.map((f) =>
        links[f.list].length > 0 || v[f.key] ? (
          <div className="field" key={f.key}>
            <label htmlFor={f.key}>{tr(f.label)}</label>
            <select id={f.key} name={f.key} defaultValue={v[f.key] ?? ""}>
              <option value="">{tr("— None —")}</option>
              {links[f.list].map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        ) : null,
      )}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" maxLength={1000} defaultValue={v.notes ?? ""} />
      </div>
    </div>
  );
}
