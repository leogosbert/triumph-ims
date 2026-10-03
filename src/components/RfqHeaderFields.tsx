import type { ClientOption } from "@/lib/options";
import { RECEIVED_VIA } from "@/lib/sales";

type Values = {
  client_id?: string;
  title?: string | null;
  contact_name?: string | null;
  client_ref?: string | null;
  received_via?: string;
  received_on?: string;
  due_on?: string | null;
  assigned_to?: string | null;
  notes?: string | null;
};

export function RfqHeaderFields({
  values,
  clients,
  people,
}: {
  values: Values;
  clients: ClientOption[];
  people: { id: string; name: string }[];
}) {
  return (
    <div className="grid grid-2">
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="client_id">Client</label>
        <select id="client_id" name="client_id" defaultValue={values.client_id ?? ""} required>
          <option value="" disabled>
            Choose a client
          </option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="title">
          What they asked for <span className="hint">· short summary</span>
        </label>
        <input id="title" name="title" type="text" defaultValue={values.title ?? ""} placeholder="e.g. 20 drums hydraulic oil" />
      </div>
      <div className="field">
        <label htmlFor="contact_name">Client contact</label>
        <input id="contact_name" name="contact_name" type="text" defaultValue={values.contact_name ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="client_ref">
          Client&apos;s reference <span className="hint">· their RFQ / PR no.</span>
        </label>
        <input id="client_ref" name="client_ref" type="text" defaultValue={values.client_ref ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="received_via">Received by</label>
        <select id="received_via" name="received_via" defaultValue={values.received_via ?? "email"}>
          {RECEIVED_VIA.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="received_on">Received on</label>
        <input id="received_on" name="received_on" type="date" defaultValue={values.received_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="due_on">Quote due by</label>
        <input id="due_on" name="due_on" type="date" defaultValue={values.due_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="assigned_to">Assigned to</label>
        <select id="assigned_to" name="assigned_to" defaultValue={values.assigned_to ?? ""}>
          <option value="">Me</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">Notes</label>
        <textarea id="notes" name="notes" defaultValue={values.notes ?? ""} />
      </div>
    </div>
  );
}
