import { tr } from "@/lib/tr";
import type { Store } from "@/lib/stock";

type Values = { needed_by?: string | null; warehouse_id?: string | null; reason?: string | null; notes?: string | null };

export function RequisitionFields({ stores, v = {} }: { stores: Store[]; v?: Values }) {
  return (
    <div className="grid grid-2">
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="reason">{tr("What is it for?")}</label>
        <input id="reason" name="reason" type="text" maxLength={500} required defaultValue={v.reason ?? ""} placeholder={tr("e.g. Gloves for the Mwanza site job")} />
      </div>
      <div className="field">
        <label htmlFor="needed_by">{tr("Needed by")}</label>
        <input id="needed_by" name="needed_by" type="date" defaultValue={v.needed_by ?? ""} />
      </div>
      {stores.length > 1 && (
        <div className="field">
          <label htmlFor="warehouse_id">{tr("Deliver to store")}</label>
          <select id="warehouse_id" name="warehouse_id" defaultValue={v.warehouse_id ?? ""}>
            <option value="">{tr("Main store")}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" maxLength={1000} defaultValue={v.notes ?? ""} />
      </div>
    </div>
  );
}
