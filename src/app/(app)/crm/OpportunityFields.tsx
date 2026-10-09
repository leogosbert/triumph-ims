import { tr } from "@/lib/tr";
import { OPP_SOURCES } from "@/lib/crm";
import { CURRENCIES } from "@/lib/lists";

export type OppValues = {
  title?: string;
  client_id?: string | null;
  prospect_name?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  contact_email?: string | null;
  source?: string;
  value?: number;
  currency?: string;
  expected_close?: string | null;
  owner_id?: string | null;
  next_action?: string | null;
  next_on?: string | null;
  notes?: string | null;
};

/** The fields of an opportunity (new and edit). */
export function OpportunityFields({
  v,
  clients,
  people,
  base,
}: {
  v: OppValues;
  clients: { id: string; name: string }[];
  people: { id: string; name: string }[];
  base: string;
}) {
  return (
    <div className="grid grid-2">
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="title">{tr("What the client needs")}</label>
        <input id="title" name="title" type="text" required minLength={2} maxLength={200} defaultValue={v.title ?? ""} placeholder={tr("e.g. Hydraulic oil for the new crushing plant")} />
      </div>
      <div className="field">
        <label htmlFor="client_id">{tr("Client")}</label>
        <select id="client_id" name="client_id" defaultValue={v.client_id ?? ""}>
          <option value="">{tr("— Not a client yet (new prospect) —")}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="prospect_name">
          {tr("Prospect name")} <span className="hint">· {tr("if not a client yet")}</span>
        </label>
        <input id="prospect_name" name="prospect_name" type="text" maxLength={200} defaultValue={v.prospect_name ?? ""} placeholder={tr("Company or person")} />
      </div>
      <div className="field">
        <label htmlFor="contact_name">{tr("Contact person")}</label>
        <input id="contact_name" name="contact_name" type="text" maxLength={120} defaultValue={v.contact_name ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="contact_phone">{tr("Phone")}</label>
        <input id="contact_phone" name="contact_phone" type="tel" maxLength={40} defaultValue={v.contact_phone ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="contact_email">{tr("Email")}</label>
        <input id="contact_email" name="contact_email" type="email" maxLength={200} defaultValue={v.contact_email ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="source">{tr("How we found it")}</label>
        <select id="source" name="source" defaultValue={v.source ?? "other"}>
          {OPP_SOURCES.map((s) => (
            <option key={s.key} value={s.key}>
              {tr(s.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="value">{tr("Expected value")}</label>
        <input id="value" name="value" type="text" inputMode="decimal" defaultValue={v.value ? String(v.value) : ""} placeholder="0" />
      </div>
      <div className="field">
        <label htmlFor="currency">{tr("Currency")}</label>
        <select id="currency" name="currency" defaultValue={v.currency ?? base}>
          {[...new Set([base, ...CURRENCIES])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="expected_close">{tr("Expected order date")}</label>
        <input id="expected_close" name="expected_close" type="date" defaultValue={v.expected_close ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="owner_id">{tr("Responsible")}</label>
        <select id="owner_id" name="owner_id" defaultValue={v.owner_id ?? ""}>
          <option value="">{tr("Me")}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="next_action">{tr("Next step")}</label>
        <input id="next_action" name="next_action" type="text" maxLength={300} defaultValue={v.next_action ?? ""} placeholder={tr("e.g. Call to arrange a site visit")} />
      </div>
      <div className="field">
        <label htmlFor="next_on">{tr("Next step on")}</label>
        <input id="next_on" name="next_on" type="date" defaultValue={v.next_on ?? ""} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" maxLength={2000} defaultValue={v.notes ?? ""} />
      </div>
    </div>
  );
}
