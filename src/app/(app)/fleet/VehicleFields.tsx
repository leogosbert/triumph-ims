import { tr } from "@/lib/tr";
import { VEHICLE_KINDS } from "@/lib/fleet";

export type VehicleValues = {
  plate?: string;
  name?: string | null;
  kind?: string;
  capacity_kg?: number | null;
  driver_id?: string | null;
  insurance_expires?: string | null;
  inspection_expires?: string | null;
  service_due_on?: string | null;
  service_due_km?: number | null;
  odometer_km?: number | null;
  active?: boolean;
  notes?: string | null;
};

export function VehicleFields({ v = {}, drivers, editing = false }: { v?: VehicleValues; drivers: { id: string; name: string }[]; editing?: boolean }) {
  return (
    <div className="grid grid-2">
      <div className="field">
        <label htmlFor="plate">{tr("Number plate")}</label>
        <input id="plate" name="plate" type="text" required maxLength={20} defaultValue={v.plate ?? ""} placeholder={tr("e.g. T 482 DKL")} />
      </div>
      <div className="field">
        <label htmlFor="name">{tr("Name")}</label>
        <input id="name" name="name" type="text" maxLength={80} defaultValue={v.name ?? ""} placeholder={tr("e.g. Isuzu FRR (blue)")} />
      </div>
      <div className="field">
        <label htmlFor="kind">{tr("Type")}</label>
        <select id="kind" name="kind" defaultValue={v.kind ?? "truck"}>
          {Object.entries(VEHICLE_KINDS).map(([k, label]) => (
            <option key={k} value={k}>
              {tr(label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="capacity_kg">{tr("Load capacity (kg)")}</label>
        <input id="capacity_kg" name="capacity_kg" type="text" inputMode="decimal" defaultValue={v.capacity_kg ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="driver_id">{tr("Usual driver")}</label>
        <select id="driver_id" name="driver_id" defaultValue={v.driver_id ?? ""}>
          <option value="">{tr("— None —")}</option>
          {drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="odometer_km">{tr("Kilometres now")}</label>
        <input id="odometer_km" name="odometer_km" type="text" inputMode="numeric" defaultValue={v.odometer_km ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="insurance_expires">{tr("Insurance expires")}</label>
        <input id="insurance_expires" name="insurance_expires" type="date" defaultValue={v.insurance_expires ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="inspection_expires">{tr("Inspection / road licence expires")}</label>
        <input id="inspection_expires" name="inspection_expires" type="date" defaultValue={v.inspection_expires ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="service_due_on">{tr("Next service date")}</label>
        <input id="service_due_on" name="service_due_on" type="date" defaultValue={v.service_due_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="service_due_km">{tr("Next service at (km)")}</label>
        <input id="service_due_km" name="service_due_km" type="text" inputMode="numeric" defaultValue={v.service_due_km ?? ""} />
      </div>
      {editing && (
        <div className="field">
          <label htmlFor="active">{tr("Status")}</label>
          <select id="active" name="active" defaultValue={String(v.active ?? true)}>
            <option value="true">{tr("In use")}</option>
            <option value="false">{tr("Sold or off the road")}</option>
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
