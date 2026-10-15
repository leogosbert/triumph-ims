import { tr } from "@/lib/tr";
import type { ClientOption } from "@/lib/options";
import { FREQUENCIES, parseChecklist } from "@/lib/services";
import type { Contract } from "./rules";

export type EquipmentOption = { id: string; name: string; serial_no: string | null; client_id: string; client: { name: string } | null };

/** New contract: every field. Editing: the client and start date stay as they are (the database keeps them). */
export function ContractFields({
  c,
  clients,
  equipment,
  currency,
  today,
}: {
  c?: Contract;
  clients?: ClientOption[];
  equipment: EquipmentOption[];
  currency: string;
  today: string;
}) {
  const editing = !!c;
  const checklist = parseChecklist(c?.checklist)
    .map((x) => x.text)
    .join("\n");
  const shown = editing ? equipment.filter((e) => e.client_id === c.client_id) : equipment;
  return (
    <div className="grid grid-2">
      {!editing && (
        <div className="field">
          <label htmlFor="client_id">{tr("Client")}</label>
          <select id="client_id" name="client_id" required defaultValue="">
            <option value="" disabled>
              {tr("— Choose —")}
            </option>
            {(clients ?? []).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="title">{tr("Title")}</label>
        <input id="title" name="title" type="text" required minLength={2} maxLength={200} defaultValue={c?.title ?? ""} placeholder={tr("e.g. Generator service contract")} />
      </div>
      <div className="field">
        <label htmlFor="frequency">{tr("Visits")}</label>
        <select id="frequency" name="frequency" defaultValue={c?.frequency ?? "quarterly"}>
          {Object.entries(FREQUENCIES).map(([k, label]) => (
            <option key={k} value={k}>
              {tr(label)}
            </option>
          ))}
        </select>
      </div>
      {!editing && (
        <div className="field">
          <label htmlFor="starts_on">{tr("Starts on")}</label>
          <input id="starts_on" name="starts_on" type="date" required defaultValue={today} />
        </div>
      )}
      <div className="field">
        <label htmlFor="ends_on">{tr("Ends on (optional)")}</label>
        <input id="ends_on" name="ends_on" type="date" defaultValue={c?.ends_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="next_visit_on">{tr("Next visit")}</label>
        <input id="next_visit_on" name="next_visit_on" type="date" defaultValue={c?.next_visit_on ?? ""} />
        {!editing && <span className="muted small">{tr("Empty: the start date.")}</span>}
      </div>
      <div className="field">
        <label htmlFor="visit_title">{tr("Title of each visit job")}</label>
        <input id="visit_title" name="visit_title" type="text" maxLength={200} defaultValue={c?.visit_title ?? ""} placeholder={tr("e.g. Quarterly generator service")} />
      </div>
      <div className="field">
        <label htmlFor="response_hours">{tr("Response time (hours)")}</label>
        <input id="response_hours" name="response_hours" type="text" inputMode="numeric" defaultValue={c?.response_hours ?? ""} placeholder={tr("e.g. 24")} />
      </div>
      <div className="field">
        <label htmlFor="price">{tr("Price per period")}</label>
        <input id="price" name="price" type="text" inputMode="decimal" defaultValue={c?.price ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="currency">{tr("Currency")}</label>
        <input id="currency" name="currency" type="text" maxLength={3} required defaultValue={c?.currency ?? currency} style={{ textTransform: "uppercase" }} />
      </div>
      <div className="field">
        <label htmlFor="equipment_id">{tr("Equipment (optional)")}</label>
        <select id="equipment_id" name="equipment_id" defaultValue={c?.equipment_id ?? ""}>
          <option value="">{tr("— None —")}</option>
          {shown.map((e) => (
            <option key={e.id} value={e.id}>
              {editing ? "" : `${e.client?.name ?? ""} · `}
              {e.name}
              {e.serial_no ? ` (${e.serial_no})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="site">{tr("Site")}</label>
        <input id="site" name="site" type="text" maxLength={300} defaultValue={c?.site ?? ""} placeholder={tr("Where the visits happen")} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="checklist">{tr("Checklist for each visit")}</label>
        <textarea id="checklist" name="checklist" rows={5} defaultValue={checklist} placeholder={tr("One point per line, e.g.\nCheck oil level\nClean filters")} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" maxLength={2000} defaultValue={c?.notes ?? ""} />
      </div>
    </div>
  );
}
