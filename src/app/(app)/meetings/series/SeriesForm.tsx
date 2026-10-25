import { tr } from "@/lib/tr";
import { SubmitButton } from "@/components/SubmitButton";
import { AUDIENCES, FREQUENCY, LANGUAGES, MEETING_TOPICS, PRESENTER_MODES, WEEKDAYS } from "@/lib/meetings/model";
import { ROLE_LABELS, ROLES } from "@/lib/roles";
import { todayTz } from "@/lib/services";
import { saveSeries } from "../actions";
import styles from "../meetings.module.css";

export type Series = {
  id: string;
  title: string;
  purpose: string | null;
  frequency: string;
  weekday: number | null;
  month_day: number | null;
  start_date: string;
  end_date: string | null;
  start_time: string;
  minutes: number;
  place: string | null;
  topics: string[];
  audience: string;
  audience_roles: string[];
  audience_people: string[];
  chair_id: string | null;
  presenter_mode: string;
  presenter_id: string | null;
  rotation: string[];
  record: boolean;
  language: string;
  active: boolean;
};

/** The regular meeting form (management). */
export function SeriesForm({ s, people }: { s?: Series; people: { id: string; name: string }[] }) {
  const pick = (name: string, chosen: string[]) => (
    <div className={styles.chips}>
      {people.map((p) => (
        <label key={p.id} className={styles.chip}>
          <input type="checkbox" name={name} value={p.id} defaultChecked={chosen.includes(p.id)} /> {p.name}
        </label>
      ))}
    </div>
  );
  return (
    <form action={saveSeries} className="card">
      {s && <input type="hidden" name="id" value={s.id} />}
      <label className="field">
        <span>{tr("Title")}</span>
        <input name="title" required minLength={2} maxLength={160} defaultValue={s?.title ?? ""} placeholder={tr("e.g. Monday team meeting")} />
      </label>
      <label className="field">
        <span>{tr("Purpose")}</span>
        <input name="purpose" maxLength={1000} defaultValue={s?.purpose ?? ""} />
      </label>
      <div className="inline-form">
        <label className="field">
          <span>{tr("How often")}</span>
          <select name="frequency" defaultValue={s?.frequency ?? "weekly"}>
            {Object.entries(FREQUENCY).map(([k, l]) => (
              <option key={k} value={k}>
                {tr(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr("Day of the week (weekly)")}</span>
          <select name="weekday" defaultValue={String(s?.weekday ?? 1)}>
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {tr(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr("Day of the month (monthly)")}</span>
          <input type="number" name="month_day" min={1} max={31} defaultValue={s?.month_day ?? 1} />
        </label>
      </div>
      <div className="inline-form">
        <label className="field">
          <span>{tr("Starts on")}</span>
          <input type="date" name="start_date" defaultValue={s?.start_date ?? todayTz()} />
        </label>
        <label className="field">
          <span>{tr("Ends on (optional)")}</span>
          <input type="date" name="end_date" defaultValue={s?.end_date ?? ""} />
        </label>
        <label className="field">
          <span>{tr("Time")}</span>
          <input type="time" name="start_time" defaultValue={(s?.start_time ?? "09:00").slice(0, 5)} />
        </label>
        <label className="field">
          <span>{tr("Minutes")}</span>
          <input type="number" name="minutes" min={5} max={600} step={5} defaultValue={s?.minutes ?? 30} />
        </label>
      </div>
      <label className="field">
        <span>{tr("Place")}</span>
        <input name="place" maxLength={200} defaultValue={s?.place ?? ""} />
      </label>
      <fieldset className="field">
        <legend>{tr("Topics")}</legend>
        <div className={styles.chips}>
          {MEETING_TOPICS.map((t) => (
            <label key={t} className={styles.chip}>
              <input type="checkbox" name="topics" value={t} defaultChecked={s?.topics?.includes(t)} /> {tr(t)}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="field">
        <span>{tr("Who attends")}</span>
        <select name="audience" defaultValue={s?.audience ?? "everyone"}>
          {Object.entries(AUDIENCES).map(([k, l]) => (
            <option key={k} value={k}>
              {tr(l)}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="field">
        <legend>{tr("Roles (for Some roles)")}</legend>
        <div className={styles.chips}>
          {ROLES.map((r) => (
            <label key={r} className={styles.chip}>
              <input type="checkbox" name="audience_roles" value={r} defaultChecked={s?.audience_roles?.includes(r)} /> {tr(ROLE_LABELS[r])}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="field">
        <legend>{tr("People (for Chosen people)")}</legend>
        {pick("audience_people", s?.audience_people ?? [])}
      </fieldset>
      <div className="inline-form">
        <label className="field">
          <span>{tr("Chair")}</span>
          <select name="chair_id" defaultValue={s?.chair_id ?? ""}>
            <option value="">{tr("Not set")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr("Presenter")}</span>
          <select name="presenter_mode" defaultValue={s?.presenter_mode ?? "chosen"}>
            {Object.entries(PRESENTER_MODES).map(([k, l]) => (
              <option key={k} value={k}>
                {tr(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr("Always presents (fixed)")}</span>
          <select name="presenter_id" defaultValue={s?.presenter_id ?? ""}>
            <option value="">{tr("Not set")}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="field">
        <legend>{tr("Take turns (in this order)")}</legend>
        {pick("rotation", s?.rotation ?? [])}
      </fieldset>
      <div className="inline-form">
        <label className="field">
          <span>{tr("Language")}</span>
          <select name="language" defaultValue={s?.language ?? "both"}>
            {Object.entries(LANGUAGES).map(([k, l]) => (
              <option key={k} value={k}>
                {tr(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr("Write down what is said")}</span>
          <select name="record" defaultValue={s ? (s.record ? "1" : "0") : "1"}>
            <option value="1">{tr("Yes (everyone is told first)")}</option>
            <option value="0">{tr("No, typed notes only")}</option>
          </select>
        </label>
        {s && (
          <label className="field">
            <span>{tr("Status")}</span>
            <select name="active" defaultValue={s.active ? "1" : "0"}>
              <option value="1">{tr("Active")}</option>
              <option value="0">{tr("Stopped")}</option>
            </select>
          </label>
        )}
      </div>
      <SubmitButton>{tr("Save")}</SubmitButton>
    </form>
  );
}
