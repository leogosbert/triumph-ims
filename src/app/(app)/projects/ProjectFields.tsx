import { tr } from "@/lib/tr";
import { CURRENCIES } from "@/lib/lists";
import { PROJECT_BILLING, PROJECT_STATUS } from "@/lib/services";
import type { Project } from "./projectData";

type Option = { id: string; name: string };

export function ProjectFields({
  p = {},
  clients,
  people,
  currency,
  editing = false,
}: {
  p?: Partial<Project>;
  clients: Option[];
  people: Option[];
  currency: string;
  editing?: boolean;
}) {
  const currencies = [...new Set([p.currency ?? currency, ...CURRENCIES])];
  return (
    <div className="grid grid-2">
      {!editing && (
        <div className="field">
          <label htmlFor="client_id">{tr("Client")}</label>
          <select id="client_id" name="client_id" required defaultValue={p.client_id ?? ""}>
            <option value="">{tr("— Choose —")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="name">{tr("Project name")}</label>
        <input id="name" name="name" type="text" required minLength={2} maxLength={200} defaultValue={p.name ?? ""} placeholder={tr("e.g. Water network design")} />
      </div>
      <div className="field">
        <label htmlFor="billing">{tr("How it is billed")}</label>
        <select id="billing" name="billing" defaultValue={p.billing ?? "time"}>
          {Object.entries(PROJECT_BILLING).map(([k, label]) => (
            <option key={k} value={k}>
              {tr(label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="currency">{tr("Currency")}</label>
        <select id="currency" name="currency" defaultValue={p.currency ?? currency}>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="budget_amount">{tr("Budget (amount)")}</label>
        <input id="budget_amount" name="budget_amount" type="text" inputMode="decimal" defaultValue={p.budget_amount ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="budget_hours">{tr("Budget (hours)")}</label>
        <input id="budget_hours" name="budget_hours" type="text" inputMode="decimal" defaultValue={p.budget_hours ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="default_rate">{tr("Hourly rate charged")}</label>
        <input id="default_rate" name="default_rate" type="text" inputMode="decimal" defaultValue={p.default_rate ?? ""} />
        <p className="hint">{tr("Leave empty to use each person's own rate.")}</p>
      </div>
      <div className="field">
        <label htmlFor="manager_id">{tr("Project manager")}</label>
        <select id="manager_id" name="manager_id" defaultValue={p.manager_id ?? ""}>
          <option value="">{tr("— None —")}</option>
          {people.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="starts_on">{tr("Starts on")}</label>
        <input id="starts_on" name="starts_on" type="date" defaultValue={p.starts_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="ends_on">{tr("Ends on")}</label>
        <input id="ends_on" name="ends_on" type="date" defaultValue={p.ends_on ?? ""} />
      </div>
      {editing && (
        <div className="field">
          <label htmlFor="status">{tr("Status")}</label>
          <select id="status" name="status" defaultValue={p.status ?? "active"}>
            {Object.entries(PROJECT_STATUS).map(([k, s]) => (
              <option key={k} value={k}>
                {tr(s.label)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="description">{tr("Description")}</label>
        <textarea id="description" name="description" maxLength={4000} defaultValue={p.description ?? ""} />
      </div>
    </div>
  );
}
