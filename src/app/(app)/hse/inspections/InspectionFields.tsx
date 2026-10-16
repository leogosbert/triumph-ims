import { tr } from "@/lib/tr";
import { INSPECTION_KINDS, INSPECTION_RESULTS, type Inspection, type Option } from "@/lib/hse";
import { todayTz } from "@/lib/services";
import { LinkSelect } from "../IncidentFields";

const wide = { gridColumn: "1 / -1" } as const;

export function InspectionFields({
  v = {},
  options,
}: {
  v?: Partial<Inspection>;
  options: { projects: Option[]; jobs: Option[]; vehicles: Option[] };
}) {
  return (
    <div className="grid grid-2">
      <div className="field">
        <label htmlFor="kind">{tr("What kind")}</label>
        <select id="kind" name="kind" defaultValue={v.kind ?? "site"}>
          {Object.entries(INSPECTION_KINDS).map(([k, label]) => (
            <option key={k} value={k}>
              {tr(label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="inspected_on">{tr("Date")}</label>
        <input id="inspected_on" name="inspected_on" type="date" required defaultValue={v.inspected_on ?? todayTz()} />
      </div>
      <div className="field">
        <label htmlFor="site">{tr("Where")}</label>
        <input id="site" name="site" type="text" maxLength={200} defaultValue={v.site ?? ""} placeholder={tr("e.g. Kurasini yard")} />
      </div>
      <div className="field">
        <label htmlFor="topic">{tr("Topic (toolbox talks)")}</label>
        <input id="topic" name="topic" type="text" maxLength={200} defaultValue={v.topic ?? ""} placeholder={tr("e.g. Working at height")} />
      </div>
      <LinkSelect name="vehicle_id" label="Vehicle" options={options.vehicles} value={v.vehicle_id} />
      <LinkSelect name="project_id" label="Project" options={options.projects} value={v.project_id} />
      <LinkSelect name="job_id" label="Service job" options={options.jobs} value={v.job_id} />
      <div className="field">
        <label htmlFor="result">{tr("Result")}</label>
        <select id="result" name="result" defaultValue={v.result ?? "pass"}>
          {Object.entries(INSPECTION_RESULTS).map(([k, r]) => (
            <option key={k} value={k}>
              {tr(r.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={wide}>
        <label htmlFor="findings">{tr("Findings")}</label>
        <textarea id="findings" name="findings" maxLength={4000} defaultValue={v.findings ?? ""} />
      </div>
      <div className="field" style={wide}>
        <label htmlFor="attendees">{tr("Attendees")}</label>
        <textarea id="attendees" name="attendees" maxLength={2000} defaultValue={v.attendees ?? ""} placeholder={tr("Names, one per line")} />
      </div>
      <div className="field">
        <label htmlFor="attendee_count">{tr("Number of attendees")}</label>
        <input id="attendee_count" name="attendee_count" type="text" inputMode="numeric" defaultValue={v.attendee_count ?? ""} />
      </div>
    </div>
  );
}
