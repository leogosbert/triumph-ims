import { tr } from "@/lib/tr";
import type { ClientOption, ProductOption } from "@/lib/options";

export type Equipment = {
  id: string;
  client_id: string;
  product_id: string | null;
  name: string;
  serial_no: string | null;
  location: string | null;
  installed_on: string | null;
  warranty_until: string | null;
  service_every_months: number | null;
  last_service_on: string | null;
  next_service_on: string | null;
  notes: string | null;
  active: boolean;
};

export function EquipmentFields({
  e,
  clients,
  products,
  clientId,
}: {
  e?: Equipment;
  clients: ClientOption[];
  products: ProductOption[];
  clientId?: string;
}) {
  const editing = !!e;
  return (
    <div className="grid grid-2">
      <div className="field">
        <label htmlFor="client_id">{tr("Client")}</label>
        <select id="client_id" name="client_id" required defaultValue={e?.client_id ?? clientId ?? ""}>
          <option value="" disabled>
            {tr("— Choose —")}
          </option>
          {clients.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="product_id">{tr("Product (optional)")}</label>
        <select id="product_id" name="product_id" defaultValue={e?.product_id ?? ""}>
          <option value="">{tr("— None —")}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.sku ? ` · ${p.sku}` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="name">{tr("Name")}</label>
        <input id="name" name="name" type="text" maxLength={200} defaultValue={e?.name ?? ""} placeholder={tr("e.g. Generator 60 kVA")} />
        {!editing && <span className="muted small">{tr("Empty: the product's name.")}</span>}
      </div>
      <div className="field">
        <label htmlFor="serial_no">{tr("Serial number")}</label>
        <input id="serial_no" name="serial_no" type="text" maxLength={120} defaultValue={e?.serial_no ?? ""} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="location">{tr("Location")}</label>
        <input id="location" name="location" type="text" maxLength={300} defaultValue={e?.location ?? ""} placeholder={tr("e.g. Mikocheni branch, plant room")} />
      </div>
      <div className="field">
        <label htmlFor="installed_on">{tr("Installed on")}</label>
        <input id="installed_on" name="installed_on" type="date" defaultValue={e?.installed_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="warranty_until">{tr("Warranty until")}</label>
        <input id="warranty_until" name="warranty_until" type="date" defaultValue={e?.warranty_until ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="service_every_months">{tr("Service every (months)")}</label>
        <input id="service_every_months" name="service_every_months" type="text" inputMode="numeric" defaultValue={e?.service_every_months ?? ""} placeholder={tr("e.g. 6")} />
      </div>
      <div className="field">
        <label htmlFor="next_service_on">{tr("Next service")}</label>
        <input id="next_service_on" name="next_service_on" type="date" defaultValue={e?.next_service_on ?? ""} />
        {!editing && <span className="muted small">{tr("Empty: counted from the installation date.")}</span>}
      </div>
      {editing && (
        <div className="field">
          <label htmlFor="last_service_on">{tr("Last service")}</label>
          <input id="last_service_on" name="last_service_on" type="date" defaultValue={e?.last_service_on ?? ""} />
        </div>
      )}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" maxLength={2000} defaultValue={e?.notes ?? ""} />
      </div>
    </div>
  );
}
