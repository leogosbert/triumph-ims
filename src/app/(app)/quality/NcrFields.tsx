"use client";

import { useState } from "react";
import { useTr } from "@/lib/tr-client";
import { NCR_DISPOSITIONS, NCR_SOURCES, type Ncr, type Option } from "@/lib/hse";

export type NcrOptions = { suppliers: Option[]; clients: Option[]; products: Option[]; orders: Option[]; deliveries: Option[] };

type LinkKey = "supplier_id" | "client_id" | "product_id" | "purchase_order_id" | "delivery_id";

const LINKS: { key: LinkKey; label: string; list: keyof NcrOptions }[] = [
  { key: "supplier_id", label: "Supplier", list: "suppliers" },
  { key: "purchase_order_id", label: "Purchase order", list: "orders" },
  { key: "client_id", label: "Client", list: "clients" },
  { key: "delivery_id", label: "Delivery", list: "deliveries" },
  { key: "product_id", label: "Product", list: "products" },
];

// The links that matter most for each source come first.
const ORDER: Record<string, LinkKey[]> = {
  supplier: ["supplier_id", "purchase_order_id", "product_id", "client_id", "delivery_id"],
  client_complaint: ["client_id", "delivery_id", "product_id", "supplier_id", "purchase_order_id"],
};

const wide = { gridColumn: "1 / -1" } as const;

export function NcrFields({
  v = {},
  options,
  base,
  today,
  editing = false,
}: {
  v?: Partial<Ncr>;
  options: NcrOptions;
  base: string;
  today: string;
  editing?: boolean;
}) {
  const tr = useTr();
  const [source, setSource] = useState(v.source ?? "supplier");
  const order = ORDER[source] ?? ["product_id", "supplier_id", "purchase_order_id", "client_id", "delivery_id"];
  const links = order.map((k) => LINKS.find((l) => l.key === k)!).filter((l) => options[l.list].length > 0);

  return (
    <div className="grid grid-2">
      <div className="field">
        <label htmlFor="source">{tr("Source")}</label>
        <select id="source" name="source" value={source} onChange={(e) => setSource(e.target.value)}>
          {Object.entries(NCR_SOURCES).map(([k, label]) => (
            <option key={k} value={k}>
              {tr(label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="raised_on">{tr("Date")}</label>
        <input id="raised_on" name="raised_on" type="date" required defaultValue={v.raised_on ?? today} />
      </div>
      <div className="field" style={wide}>
        <label htmlFor="title">{tr("Short title")}</label>
        <input id="title" name="title" type="text" required minLength={3} maxLength={160} defaultValue={v.title ?? ""} placeholder={tr("e.g. Valves leaking at test pressure")} />
      </div>
      <div className="field" style={wide}>
        <label htmlFor="description">{tr("What is wrong")}</label>
        <textarea id="description" name="description" required minLength={3} maxLength={4000} defaultValue={v.description ?? ""} />
      </div>
      {links.map((l) => (
        <div className="field" key={l.key}>
          <label htmlFor={l.key}>{tr(l.label)}</label>
          <select id={l.key} name={l.key} defaultValue={v[l.key] ?? ""}>
            <option value="">{tr("— None —")}</option>
            {options[l.list].map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      ))}
      <div className="field">
        <label htmlFor="quantity_affected">{tr("Quantity affected")}</label>
        <input id="quantity_affected" name="quantity_affected" type="text" inputMode="decimal" defaultValue={v.quantity_affected ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="disposition">{tr("What to do with it")}</label>
        <select id="disposition" name="disposition" defaultValue={v.disposition ?? ""}>
          <option value="">{tr("— Not decided —")}</option>
          {Object.entries(NCR_DISPOSITIONS).map(([k, label]) => (
            <option key={k} value={k}>
              {tr(label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="cost">
          {tr("Cost")} ({base})
        </label>
        <input id="cost" name="cost" type="text" inputMode="decimal" defaultValue={v.cost ? String(v.cost) : ""} placeholder="0" />
      </div>
      {editing && (
        <div className="field" style={wide}>
          <label htmlFor="root_cause">{tr("Root cause")}</label>
          <textarea id="root_cause" name="root_cause" maxLength={2000} defaultValue={v.root_cause ?? ""} />
        </div>
      )}
    </div>
  );
}
