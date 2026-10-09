import { tr } from "@/lib/tr";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDate, formatDateTime } from "@/lib/format";
import { logFollowup } from "@/lib/followupActions";
import { FOLLOWUP_CHANNELS } from "@/lib/reminders";

export type FollowUp = { id: string; channel: string; note: string | null; next_on: string | null; created_at: string; by: string | null };

/** Log a follow-up (quotation) or reminder (invoice) and see the earlier ones. */
export function FollowUps({
  kind,
  id,
  items,
  canLog,
  today,
  defaultNext,
}: {
  kind: "quotation" | "invoice";
  id: string;
  items: FollowUp[];
  canLog: boolean;
  today: string;
  defaultNext: string;
}) {
  const invoice = kind === "invoice";
  const max = new Date(Date.parse(`${today}T12:00:00Z`) + 365 * 86400000).toISOString().slice(0, 10);
  return (
    <>
      {canLog && (
        <details style={{ marginTop: 12 }}>
          <summary>
            <strong>{invoice ? tr("+ Log a reminder or promise to pay") : tr("+ Log a follow-up")}</strong>
          </summary>
          <form action={logFollowup} style={{ marginTop: 10 }}>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor={`fu_channel_${kind}`}>{tr("How")}</label>
                <select id={`fu_channel_${kind}`} name="channel" defaultValue="whatsapp">
                  {Object.entries(FOLLOWUP_CHANNELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {tr(v)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`fu_next_${kind}`}>{invoice ? tr("Client promised to pay by") : tr("Follow up again on")}</label>
                <input id={`fu_next_${kind}`} name="next_on" type="date" min={today} max={max} defaultValue={invoice ? "" : defaultNext} />
                <span className="hint">{invoice ? tr("leave empty if no promise; reminders pause until this date") : tr("leave empty to use the usual interval")}</span>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor={`fu_note_${kind}`}>{tr("What was said")}</label>
                <textarea id={`fu_note_${kind}`} name="note" maxLength={1000} rows={2} />
              </div>
            </div>
            <SubmitButton pendingText={tr("Saving…")}>{tr("Save")}</SubmitButton>
          </form>
        </details>
      )}
      {items.length > 0 && (
        <ul className="list" style={{ marginTop: 12 }}>
          {items.map((f) => (
            <li key={f.id}>
              <div className="row">
                <strong className="small">
                  {tr(FOLLOWUP_CHANNELS[f.channel] ?? f.channel)}
                  {f.by ? ` · ${f.by}` : ""}
                </strong>
                <span className="small muted">{formatDateTime(f.created_at)}</span>
              </div>
              {f.note && <div className="small">{f.note}</div>}
              {f.next_on && (
                <div className="small muted">
                  {invoice ? tr("Promised to pay by") : tr("Next follow-up")} {formatDate(f.next_on)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
