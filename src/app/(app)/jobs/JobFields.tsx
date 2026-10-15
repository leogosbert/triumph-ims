import { tr } from "@/lib/tr";
import { JOB_KINDS, JOB_PRIORITIES, toLocalInput } from "@/lib/services";

export type JobValues = {
  title?: string;
  kind?: string;
  priority?: string;
  site?: string | null;
  contact?: string | null;
  scheduled_for?: string | null;
  due_by?: string | null;
  assigned_to?: string[];
  description?: string | null;
  price?: number | null;
  currency?: string;
  warehouse_id?: string | null;
  equipment_id?: string | null;
  project_id?: string | null;
};

type Option = { id: string; name: string };

/** The job fields shared by the new-job and edit forms (the client is chosen separately). */
export function JobFields({
  v = {},
  people,
  stores,
  equipment,
  projects,
  currencies,
}: {
  v?: JobValues;
  people: (Option & { role: string })[];
  stores: Option[];
  equipment: Option[];
  projects: Option[];
  currencies: string[];
}) {
  const assigned = new Set(v.assigned_to ?? []);
  return (
    <div className="grid grid-2">
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="title">{tr("What is the job?")}</label>
        <input id="title" name="title" type="text" required maxLength={200} defaultValue={v.title ?? ""} placeholder={tr("e.g. Install 110mm water line at the pump house")} />
      </div>
      <div className="field">
        <label htmlFor="kind">{tr("Type of work")}</label>
        <select id="kind" name="kind" defaultValue={v.kind ?? "installation"}>
          {Object.entries(JOB_KINDS).map(([k, label]) => (
            <option key={k} value={k}>
              {tr(label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="priority">{tr("Priority")}</label>
        <select id="priority" name="priority" defaultValue={v.priority ?? "normal"}>
          {Object.entries(JOB_PRIORITIES).map(([k, p]) => (
            <option key={k} value={k}>
              {tr(p.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="scheduled_for">{tr("When")}</label>
        <input id="scheduled_for" name="scheduled_for" type="datetime-local" defaultValue={toLocalInput(v.scheduled_for)} />
      </div>
      <div className="field">
        <label htmlFor="due_by">{tr("Must be done by")}</label>
        <input id="due_by" name="due_by" type="datetime-local" defaultValue={toLocalInput(v.due_by)} />
      </div>
      <div className="field">
        <label htmlFor="site">{tr("Site")}</label>
        <input id="site" name="site" type="text" maxLength={300} defaultValue={v.site ?? ""} placeholder={tr("e.g. Pump house, Ilemela")} />
      </div>
      <div className="field">
        <label htmlFor="contact">{tr("Contact on site")}</label>
        <input id="contact" name="contact" type="text" maxLength={200} defaultValue={v.contact ?? ""} placeholder={tr("Name and phone")} />
      </div>
      <fieldset className="field" style={{ gridColumn: "1 / -1" }}>
        <legend>{tr("Technicians")}</legend>
        {people.length === 0 ? (
          <p className="muted small">{tr("Invite your technicians in Team & roles first.")}</p>
        ) : (
          <div className="sj-checks">
            {people.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" name="assigned_to" value={p.id} defaultChecked={assigned.has(p.id)} /> {p.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="description">{tr("Work to do")}</label>
        <textarea id="description" name="description" maxLength={4000} defaultValue={v.description ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="price">{tr("Agreed price")}</label>
        <input id="price" name="price" type="text" inputMode="decimal" defaultValue={v.price ?? ""} />
        <span className="hint small muted">{tr("Leave empty to bill the materials, labour and hours used.")}</span>
      </div>
      <div className="field">
        <label htmlFor="currency">{tr("Currency")}</label>
        <select id="currency" name="currency" defaultValue={v.currency ?? currencies[0]}>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      {stores.length > 1 && (
        <div className="field">
          <label htmlFor="warehouse_id">{tr("Materials from store")}</label>
          <select id="warehouse_id" name="warehouse_id" defaultValue={v.warehouse_id ?? ""}>
            <option value="">{tr("Main store")}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {equipment.length > 0 && (
        <div className="field">
          <label htmlFor="equipment_id">{tr("Equipment")}</label>
          <select id="equipment_id" name="equipment_id" defaultValue={v.equipment_id ?? ""}>
            <option value="">{tr("— None —")}</option>
            {equipment.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {projects.length > 0 && (
        <div className="field">
          <label htmlFor="project_id">{tr("Project")}</label>
          <select id="project_id" name="project_id" defaultValue={v.project_id ?? ""}>
            <option value="">{tr("— None —")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
