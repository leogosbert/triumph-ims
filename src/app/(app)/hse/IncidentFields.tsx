import { tr } from "@/lib/tr";
import { INCIDENT_KINDS, SEVERITIES, type Incident, type Option } from "@/lib/hse";
import { toLocalInput } from "@/lib/services";
import type { LinkOptions } from "./options";

export function LinkSelect({ name, label, options, value }: { name: string; label: string; options: Option[]; value?: string | null }) {
  if (options.length === 0) return null;
  return (
    <div className="field">
      <label htmlFor={name}>{tr(label)}</label>
      <select id={name} name={name} defaultValue={value ?? ""}>
        <option value="">{tr("— None —")}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

const wide = { gridColumn: "1 / -1" } as const;

/** The incident form. `investigation` adds the fields management fills in later. */
export function IncidentFields({ v = {}, options, investigation = false }: { v?: Partial<Incident>; options: LinkOptions; investigation?: boolean }) {
  const now = toLocalInput(new Date().toISOString());
  return (
    <>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="occurred_at">{tr("When")}</label>
          <input id="occurred_at" name="occurred_at" type="datetime-local" required max={now} defaultValue={v.occurred_at ? toLocalInput(v.occurred_at) : now} />
        </div>
        <div className="field">
          <label htmlFor="site">{tr("Where")}</label>
          <input id="site" name="site" type="text" maxLength={200} defaultValue={v.site ?? ""} placeholder={tr("e.g. Kurasini yard")} />
        </div>
        <div className="field">
          <label htmlFor="kind">{tr("What kind")}</label>
          <select id="kind" name="kind" defaultValue={v.kind ?? "near_miss"}>
            {Object.entries(INCIDENT_KINDS).map(([k, label]) => (
              <option key={k} value={k}>
                {tr(label)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: "0 0 12px" }}>
        <legend>{tr("How serious")}</legend>
        {Object.entries(SEVERITIES).map(([k, s]) => (
          <label key={k} style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: "6px 0", fontWeight: "normal" }}>
            <input type="radio" name="severity" value={k} defaultChecked={(v.severity ?? "low") === k} style={{ width: "auto", marginTop: 3 }} />
            <span>
              <span className={`badge tone-${s.tone}`}>{tr(s.label)}</span> <span className="muted small">{tr(s.hint)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="grid grid-2">
        <div className="field" style={wide}>
          <label htmlFor="title">{tr("Short title")}</label>
          <input id="title" name="title" type="text" required minLength={3} maxLength={160} defaultValue={v.title ?? ""} placeholder={tr("e.g. Worker slipped on wet floor")} />
        </div>
        <div className="field" style={wide}>
          <label htmlFor="description">{tr("What happened")}</label>
          <textarea id="description" name="description" required minLength={3} maxLength={4000} defaultValue={v.description ?? ""} />
        </div>
        <div className="field" style={wide}>
          <label htmlFor="people_involved">{tr("People involved")}</label>
          <input id="people_involved" name="people_involved" type="text" maxLength={500} defaultValue={v.people_involved ?? ""} />
        </div>
        <LinkSelect name="employee_id" label="Employee involved" options={options.employees} value={v.employee_id} />
        <LinkSelect name="client_id" label="Client" options={options.clients} value={v.client_id} />
        <LinkSelect name="project_id" label="Project" options={options.projects} value={v.project_id} />
        <LinkSelect name="job_id" label="Service job" options={options.jobs} value={v.job_id} />
        <LinkSelect name="vehicle_id" label="Vehicle" options={options.vehicles} value={v.vehicle_id} />
        <div className="field" style={wide}>
          <label htmlFor="immediate_action">{tr("Immediate action taken")}</label>
          <textarea id="immediate_action" name="immediate_action" maxLength={2000} defaultValue={v.immediate_action ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="lost_days">{tr("Days lost")}</label>
          <input id="lost_days" name="lost_days" type="text" inputMode="decimal" defaultValue={v.lost_days ? String(v.lost_days) : ""} placeholder="0" />
        </div>
        {investigation && (
          <>
            <div className="field" style={wide}>
              <label htmlFor="root_cause">{tr("Root cause")}</label>
              <textarea id="root_cause" name="root_cause" maxLength={2000} defaultValue={v.root_cause ?? ""} />
            </div>
            <label className="field" style={{ display: "flex", gap: 8, alignItems: "center", ...wide }}>
              <input type="checkbox" name="reportable" defaultChecked={!!v.reportable} style={{ width: "auto" }} />
              <span>{tr("Reportable to OSHA")}</span>
            </label>
          </>
        )}
      </div>
    </>
  );
}
