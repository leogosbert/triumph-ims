import { tr } from "@/lib/tr";
import { CURRENCIES } from "@/lib/lists";

export type BillValues = {
  supplier_invoice_no: string | null;
  bill_date: string;
  due_date: string | null;
  currency: string;
  exchange_rate: number;
  subtotal: number;
  vat_amount: number;
  notes: string | null;
};

const fmt = (v: number) => (v ? String(v) : "");

export function BillFields({ v, base }: { v: BillValues; base: string }) {
  return (
    <div className="grid grid-2">
      <div className="field">
        <label htmlFor="supplier_invoice_no">{tr("Supplier's invoice no.")}</label>
        <input id="supplier_invoice_no" name="supplier_invoice_no" type="text" defaultValue={v.supplier_invoice_no ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="bill_date">{tr("Invoice date")}</label>
        <input id="bill_date" name="bill_date" type="date" defaultValue={v.bill_date} />
      </div>
      <div className="field">
        <label htmlFor="due_date">{tr("Due date")}</label>
        <input id="due_date" name="due_date" type="date" defaultValue={v.due_date ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="currency">{tr("Currency")}</label>
        <select id="currency" name="currency" defaultValue={v.currency}>
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="exchange_rate">{tr("Exchange rate")}{" "}<span className="hint">· {base}{" "}{tr("per 1 unit")}</span>
        </label>
        <input id="exchange_rate" name="exchange_rate" type="text" inputMode="decimal" defaultValue={String(v.exchange_rate)} />
      </div>
      <div className="field">
        <label htmlFor="subtotal">{tr("Amount before VAT")}</label>
        <input id="subtotal" name="subtotal" type="text" inputMode="decimal" defaultValue={fmt(v.subtotal)} required />
      </div>
      <div className="field">
        <label htmlFor="vat_amount">{tr("VAT amount")}</label>
        <input id="vat_amount" name="vat_amount" type="text" inputMode="decimal" defaultValue={fmt(v.vat_amount) || "0"} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" defaultValue={v.notes ?? ""} />
      </div>
    </div>
  );
}
