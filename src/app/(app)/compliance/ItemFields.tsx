import { tr } from "@/lib/tr";
import { COMPLIANCE_CATEGORIES } from "@/lib/compliance/catalogue";
import { FREQUENCIES, type ComplianceItem } from "@/lib/compliance/model";

type Option = { id: string; name: string };

/** The editable details of a checklist item (new and edit). Server component; the page calls primeLang(). */
export function ItemFields({
  v,
  people,
  licences,
  categories,
  fromCatalogue = false,
}: {
  v: Partial<ComplianceItem>;
  people: Option[];
  licences: Option[];
  /** Limit the category choice (finance: tax and social security only). */
  categories?: string[];
  fromCatalogue?: boolean;
}) {
  const cats = COMPLIANCE_CATEGORIES.filter((c) => !categories || categories.includes(c.key));
  return (
    <div className="grid grid-2">
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="name">{tr("Name")}</label>
        <input id="name" name="name" type="text" required minLength={2} maxLength={160} defaultValue={v.name ?? ""} placeholder={tr("e.g. Renew vendor registration with the mine")} />
      </div>
      <div className="field">
        <label htmlFor="category">{tr("Area")}</label>
        <select id="category" name="category" defaultValue={v.category ?? cats[0]?.key}>
          {cats.map((c) => (
            <option key={c.key} value={c.key}>
              {tr(c.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="authority">{tr("Authority or who it is for")}</label>
        <input id="authority" name="authority" type="text" maxLength={160} defaultValue={v.authority ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="due_on">
          {tr("Due date")} <span className="hint">· {tr("for one-off or yearly items")}</span>
        </label>
        <input id="due_on" name="due_on" type="date" defaultValue={v.due_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="owner_id">{tr("Responsible")}</label>
        <select id="owner_id" name="owner_id" defaultValue={v.owner_id ?? ""}>
          <option value="">{tr("— None —")}</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      {licences.length > 0 && (
        <div className="field">
          <label htmlFor="licence_id">{tr("Licence in the register")}</label>
          <select id="licence_id" name="licence_id" defaultValue={v.licence_id ?? ""}>
            <option value="">{tr("— None —")}</option>
            {licences.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <details className="field" style={{ gridColumn: "1 / -1" }} open={!!v.frequency && v.frequency !== "none" && !fromCatalogue}>
        <summary>{tr("Repeats (puts it on the tax & filing calendar)")}</summary>
        <div className="grid grid-2" style={{ marginTop: 8 }}>
          <div className="field">
            <label htmlFor="frequency">{tr("How often")}</label>
            <select id="frequency" name="frequency" defaultValue={v.frequency ?? "none"}>
              {Object.entries(FREQUENCIES).map(([k, label]) => (
                <option key={k} value={k}>
                  {tr(label)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="due_day">
              {tr("Due on day")} <span className="hint">· {tr("31 = last day of the month")}</span>
            </label>
            <input id="due_day" name="due_day" type="number" min={1} max={31} defaultValue={v.due_day ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="due_offset_months">
              {tr("Months after the period")} <span className="hint">· {tr("1 = the following month, 0 = the last month of the period")}</span>
            </label>
            <input id="due_offset_months" name="due_offset_months" type="number" min={-11} max={12} defaultValue={v.due_offset_months ?? 1} />
          </div>
          <div className="field">
            <label htmlFor="calendar_from">
              {tr("Calendar starts on")} <span className="hint">· {tr("empty = the day it was added")}</span>
            </label>
            <input id="calendar_from" name="calendar_from" type="date" defaultValue={v.calendar_from ?? ""} />
          </div>
        </div>
      </details>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" maxLength={2000} defaultValue={v.notes ?? ""} />
      </div>
    </div>
  );
}
