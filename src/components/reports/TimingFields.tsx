import { tr } from "@/lib/tr";
import { FREQUENCIES, WEEKDAYS } from "@/lib/schedules";

/** How often a scheduled report is sent, and on which day for weekly ones. */
export function TimingFields({ id, frequency, weekday }: { id: string; frequency: string; weekday: number | null }) {
  return (
    <div className="grid grid-2">
      <div className="field">
        <label htmlFor={`freq-${id}`}>{tr("How often")}</label>
        <select id={`freq-${id}`} name="frequency" defaultValue={frequency}>
          {FREQUENCIES.map((f) => (
            <option key={f.key} value={f.key}>
              {tr(f.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`day-${id}`}>
          {tr("Day")} <span className="hint">{tr("· for weekly")}</span>
        </label>
        <select id={`day-${id}`} name="weekday" defaultValue={String(weekday ?? 1)}>
          {WEEKDAYS.map((d, i) => (
            <option key={d} value={i + 1}>
              {tr(d)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
