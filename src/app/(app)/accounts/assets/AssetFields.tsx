import { tr } from "@/lib/tr";
import { ASSET_CATEGORIES, type FixedAsset } from "@/lib/ledger";

export type VehicleOpt = { id: string; plate: string; name: string | null };

/** The fields that can always be changed (name, type, serial, location, vehicle, notes). */
export function AssetFields({ a, vehicles }: { a?: Partial<FixedAsset>; vehicles: VehicleOpt[] }) {
  return (
    <div className="grid grid-2">
      <div className="field">
        <label htmlFor="name">{tr("Name")}</label>
        <input id="name" name="name" type="text" required minLength={2} maxLength={120} defaultValue={a?.name ?? ""} placeholder={tr("e.g. Toyota Hilux")} />
      </div>
      <div className="field">
        <label htmlFor="category">{tr("Asset type")}</label>
        <select id="category" name="category" defaultValue={a?.category ?? "equipment"}>
          {ASSET_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {tr(c.label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="serial_no">{tr("Serial number")}</label>
        <input id="serial_no" name="serial_no" type="text" maxLength={80} defaultValue={a?.serial_no ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="location">{tr("Location")}</label>
        <input id="location" name="location" type="text" maxLength={120} defaultValue={a?.location ?? ""} />
      </div>
      {vehicles.length > 0 && (
        <div className="field">
          <label htmlFor="vehicle_id">{tr("Vehicle (optional)")}</label>
          <select id="vehicle_id" name="vehicle_id" defaultValue={a?.vehicle_id ?? ""}>
            <option value="">{tr("— None —")}</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.plate}
                {v.name ? ` · ${v.name}` : ""}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" rows={2} maxLength={1000} defaultValue={a?.notes ?? ""} />
      </div>
    </div>
  );
}
