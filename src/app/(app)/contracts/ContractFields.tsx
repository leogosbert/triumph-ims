import { tr } from "@/lib/tr";
import { CONTRACT_KINDS } from "@/lib/crm";
import { CURRENCIES, PAYMENT_TERMS } from "@/lib/lists";

export type ContractValues = {
  client_id?: string | null;
  title?: string;
  reference?: string | null;
  kind?: string;
  start_date?: string;
  end_date?: string;
  currency?: string;
  value_cap?: number | null;
  payment_terms?: string | null;
  remind_days?: number;
  notes?: string | null;
  tender_id?: string | null;
};

export function ContractFields({
  v,
  clients,
  tenders,
  base,
  creating,
}: {
  v: ContractValues;
  clients: { id: string; name: string }[];
  tenders: { id: string; number: string; title: string }[];
  base: string;
  creating: boolean;
}) {
  return (
    <div className="grid grid-2">
      {creating && (
        <div className="field">
          <label htmlFor="client_id">{tr("Client")}</label>
          <select id="client_id" name="client_id" required defaultValue={v.client_id ?? ""}>
            <option value="" disabled>
              {tr("Choose a client")}
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="title">{tr("Contract name")}</label>
        <input id="title" name="title" type="text" required minLength={2} maxLength={200} defaultValue={v.title ?? ""} placeholder={tr("e.g. Framework agreement for lubricants 2027")} />
      </div>
      <div className="field">
        <label htmlFor="reference">{tr("Contract number")}</label>
        <input id="reference" name="reference" type="text" maxLength={120} defaultValue={v.reference ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="kind">{tr("Type")}</label>
        <select id="kind" name="kind" defaultValue={v.kind ?? "framework"}>
          {CONTRACT_KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {tr(k.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="start_date">{tr("Starts")}</label>
        <input id="start_date" name="start_date" type="date" required defaultValue={v.start_date ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="end_date">{tr("Ends")}</label>
        <input id="end_date" name="end_date" type="date" required defaultValue={v.end_date ?? ""} />
      </div>
      {creating ? (
        <div className="field">
          <label htmlFor="currency">{tr("Currency")}</label>
          <select id="currency" name="currency" defaultValue={v.currency ?? base}>
            {[...new Set([base, ...CURRENCIES])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="value_cap">
          {tr("Contract value")} <span className="hint">· {tr("optional ceiling")}</span>
        </label>
        <input id="value_cap" name="value_cap" type="text" inputMode="decimal" defaultValue={v.value_cap ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="payment_terms">{tr("Payment terms")}</label>
        <input id="payment_terms" name="payment_terms" type="text" list="pay-terms" maxLength={200} defaultValue={v.payment_terms ?? ""} />
        <datalist id="pay-terms">
          {PAYMENT_TERMS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
      </div>
      <div className="field">
        <label htmlFor="remind_days">{tr("Remind me (days before the end)")}</label>
        <input id="remind_days" name="remind_days" type="number" min={0} max={180} defaultValue={v.remind_days ?? 30} />
      </div>
      {tenders.length > 0 && (
        <div className="field">
          <label htmlFor="tender_id">{tr("From tender")}</label>
          <select id="tender_id" name="tender_id" defaultValue={v.tender_id ?? ""}>
            <option value="">{tr("— None —")}</option>
            {tenders.map((t) => (
              <option key={t.id} value={t.id}>
                {t.number} · {t.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" maxLength={2000} defaultValue={v.notes ?? ""} />
      </div>
    </div>
  );
}
