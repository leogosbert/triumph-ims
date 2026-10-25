import { tr } from "@/lib/tr";
import { toLocalInput } from "@/lib/services";

type Person = { id: string; name: string };

const ID_KEYS = ["client_id", "opportunity_id", "quotation_id", "invoice_id", "item_id", "source_kind", "source_id"];
const CAL_KINDS: Record<string, string> = {
  meeting: "Meeting",
  delivery: "Delivery",
  follow_up: "Follow-up",
  event: "Event",
  payment: "Payment",
  supplies: "Supplies arriving",
  task: "Task",
  other: "Other",
};

/**
 * The fields of a proposed update that a manager may change before approving. The records it points to
 * (client, quotation, compliance item...) stay as they are; the database checks every value again.
 */
export function ProposalFields({ target, payload, people }: { target: string; payload: Record<string, unknown>; people: Person[] }) {
  const v = (k: string) => (payload[k] === undefined || payload[k] === null ? "" : String(payload[k]));
  const text = (k: string, label: string, max = 300) => (
    <label className="field" key={k}>
      <span>{tr(label)}</span>
      <input name={`f_${k}`} defaultValue={v(k)} maxLength={max} />
    </label>
  );
  const date = (k: string, label: string) => (
    <label className="field" key={k}>
      <span>{tr(label)}</span>
      <input type="date" name={`f_${k}`} defaultValue={v(k)} />
    </label>
  );
  const owner = (k = "owner_id", label = "Who") => (
    <label className="field" key={k}>
      <span>{tr(label)}</span>
      <select name={`f_${k}`} defaultValue={v(k)}>
        <option value="">{tr("Not set")}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
  const hidden = ID_KEYS.filter((k) => v(k)).map((k) => <input key={k} type="hidden" name={`f_${k}`} value={v(k)} />);

  let fields: React.ReactNode[] = [];
  switch (target) {
    case "crm_note":
      fields = [text("summary", "Note", 2000), text("next_action", "Next step"), date("next_on", "Next date")];
      break;
    case "followup":
      fields = [text("note", "Note", 1000), date("next_on", "Next date")];
      break;
    case "opportunity_stage":
      fields = [
        <label className="field" key="stage">
          <span>{tr("New stage")}</span>
          <select name="f_stage" defaultValue={v("stage")}>
            {["lead", "qualified", "quoted", "negotiation", "won", "lost"].map((s) => (
              <option key={s} value={s}>
                {tr(s[0].toUpperCase() + s.slice(1))}
              </option>
            ))}
          </select>
        </label>,
        text("reason", "Reason (needed when lost)", 500),
      ];
      break;
    case "requisition": {
      const lines = Array.isArray(payload.lines) ? (payload.lines as Record<string, unknown>[]) : [];
      fields = [
        text("reason", "Why", 500),
        date("needed_by", "Needed by"),
        <label className="field" key="lines">
          <span>{tr("What to buy: one per line, e.g. 20 pail Grease 18kg")}</span>
          <textarea name="f_lines" rows={Math.max(2, lines.length)} defaultValue={lines.map((l) => [l.quantity, l.unit, l.description].filter(Boolean).join(" ")).join("\n")} />
        </label>,
        <input key="lines_json" type="hidden" name="f_lines_json" value={JSON.stringify(lines)} />,
      ];
      break;
    }
    case "compliance_date":
      fields = [date("due_on", "New due date")];
      break;
    case "corrective_action":
      fields = [text("action", "Action", 1000), owner(), date("due_on", "Due")];
      break;
    case "calendar_entry":
      fields = [
        text("title", "Title", 200),
        <label className="field" key="kind">
          <span>{tr("Kind")}</span>
          <select name="f_kind" defaultValue={v("kind") || "other"}>
            {Object.entries(CAL_KINDS).map(([k, l]) => (
              <option key={k} value={k}>
                {tr(l)}
              </option>
            ))}
          </select>
        </label>,
        date("starts_on", "Date"),
        date("ends_on", "Until (optional)"),
        <label className="field" key="at_time">
          <span>{tr("Time")}</span>
          <input type="time" name="f_at_time" defaultValue={v("at_time")} />
        </label>,
        owner("owner_id", "Who is reminded"),
        text("notes", "Notes", 1000),
        <input key="phrase" type="hidden" name="f_phrase" value={v("phrase")} />,
      ];
      break;
    case "next_meeting":
      fields = [
        <label className="field" key="starts_at">
          <span>{tr("Date and time")}</span>
          <input type="datetime-local" name="f_starts_at" defaultValue={toLocalInput(v("starts_at"))} required />
        </label>,
        text("title", "Title", 160),
      ];
      break;
    case "task":
      fields = [text("text", "Task", 1000), owner(), date("due_on", "Due")];
      break;
  }
  return (
    <>
      {hidden}
      {fields}
    </>
  );
}
