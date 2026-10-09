import { tr } from "@/lib/tr";
import { SubmitButton } from "@/components/SubmitButton";
import { ACTIVITY_KINDS } from "@/lib/crm";
import { todayTz } from "@/lib/sales";
import { logActivity } from "./actions";

/** Log a call, visit or message, with the next step. On an opportunity or straight on a client. */
export function ActivityForm({ back, opportunityId, clientId }: { back: string; opportunityId?: string; clientId?: string | null }) {
  return (
    <form action={logActivity}>
      <input type="hidden" name="back" value={back} />
      {opportunityId && <input type="hidden" name="opportunity_id" value={opportunityId} />}
      {clientId && <input type="hidden" name="client_id" value={clientId} />}
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="kind">{tr("What")}</label>
          <select id="kind" name="kind" defaultValue="call">
            {ACTIVITY_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.icon} {tr(k.label)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="happened_on">{tr("When")}</label>
          <input id="happened_on" name="happened_on" type="date" defaultValue={todayTz()} max={todayTz()} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="summary">{tr("What was said or agreed")}</label>
          <textarea id="summary" name="summary" required minLength={2} maxLength={2000} />
        </div>
        <div className="field">
          <label htmlFor="act_next_action">{tr("Next step")}</label>
          <input id="act_next_action" name="next_action" type="text" maxLength={300} placeholder={tr("e.g. Send samples")} />
        </div>
        <div className="field">
          <label htmlFor="act_next_on">{tr("Next step on")}</label>
          <input id="act_next_on" name="next_on" type="date" min={todayTz()} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="location">
            {tr("Place")} <span className="hint">· {tr("for visits")}</span>
          </label>
          <input id="location" name="location" type="text" maxLength={200} />
        </div>
      </div>
      <SubmitButton>{tr("Save in the history")}</SubmitButton>
    </form>
  );
}

export type ActivityRow = {
  id: string;
  kind: string;
  happened_on: string;
  summary: string;
  location: string | null;
  next_action: string | null;
  next_on: string | null;
  created_by: string | null;
  opportunity_id?: string | null;
};
