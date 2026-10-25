"use client";

import { useState } from "react";
import { PayMethodFields } from "@/components/PayMethodFields";
import { CURRENCIES } from "@/lib/lists";
import { useTr } from "@/lib/tr-client";

export type ExpenseValues = {
  category_id: string | null;
  spent_on: string;
  payee: string | null;
  description: string;
  amount: number | null;
  vat_amount: number;
  currency: string;
  exchange_rate: number;
  method: string;
  provider: string | null;
  reference: string | null;
  notes: string | null;
};

export type Category = { id: string; name: string; active: boolean };

const fmt = (v: number | null) => (v ? String(v) : "");

export function ExpenseFields({
  v,
  base,
  categories,
  withProvider,
  lockMoney = false,
  unsure = [],
}: {
  v: ExpenseValues;
  base: string;
  categories: Category[];
  withProvider: boolean;
  /** Checked against the statement: amount, date, currency and payment details are frozen. */
  lockMoney?: boolean;
  /** Field names a receipt scan could not read for sure: marked "check". */
  unsure?: string[];
}) {
  const tr = useTr();
  const [ccy, setCcy] = useState(v.currency);
  const flag = (name: string) => unsure.includes(name);
  const mark = (name: string) => (flag(name) ? <span className="hint text-warn"> · {tr("check")}</span> : null);
  const ring = (name: string): React.CSSProperties | undefined => (flag(name) ? { outline: "2px solid var(--warn)", outlineOffset: 1 } : undefined);
  const shown = categories.filter((c) => c.active || c.id === v.category_id);
  return (
    <div className="grid grid-2">
      <div className="field">
        <label htmlFor="category_id">{tr("Spending category")}{mark("category_id")}</label>
        <select id="category_id" name="category_id" required defaultValue={v.category_id ?? ""} style={ring("category_id")}>
          <option value="" disabled>
            {tr("Choose a category")}
          </option>
          {shown.map((c) => (
            <option key={c.id} value={c.id}>
              {tr(c.name)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="spent_on">{tr("Date paid")}{mark("spent_on")}</label>
        <input id="spent_on" name="spent_on" type="date" defaultValue={v.spent_on} readOnly={lockMoney} style={ring("spent_on")} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="description">{tr("What for")}{mark("description")}</label>
        <input id="description" name="description" type="text" required minLength={2} maxLength={300} defaultValue={v.description} style={ring("description")} placeholder={tr("e.g. Fuel for delivery to Arusha")} />
      </div>
      <div className="field">
        <label htmlFor="payee">{tr("Paid to")}{mark("payee")}</label>
        <input id="payee" name="payee" type="text" maxLength={200} defaultValue={v.payee ?? ""} style={ring("payee")} placeholder={tr("Shop, person or company")} />
      </div>
      <div className="field">
        <label htmlFor="amount">{tr("Amount paid (VAT included)")}{mark("amount")}</label>
        <input id="amount" name="amount" type="text" inputMode="decimal" required defaultValue={fmt(v.amount)} readOnly={lockMoney} style={ring("amount")} />
      </div>
      <div className="field">
        <label htmlFor="vat_amount">
          {tr("of which VAT")} <span className="hint">· {tr("0 if none")}</span>
          {mark("vat_amount")}
        </label>
        <input id="vat_amount" name="vat_amount" type="text" inputMode="decimal" defaultValue={fmt(v.vat_amount) || "0"} style={ring("vat_amount")} />
      </div>
      <div className="field">
        <label htmlFor="currency">{tr("Currency")}{mark("currency")}</label>
        {lockMoney ? (
          <input id="currency" name="currency" type="text" value={ccy} readOnly />
        ) : (
          <select id="currency" name="currency" value={ccy} onChange={(e) => setCcy(e.target.value)} style={ring("currency")}>
            {[...new Set([base, ...CURRENCIES])].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        )}
      </div>
      {ccy !== base && (
        <div className="field">
          <label htmlFor="exchange_rate">
            {tr("Exchange rate")} <span className="hint">· {base} {tr("per 1 unit")}</span>
          </label>
          <input id="exchange_rate" name="exchange_rate" type="text" inputMode="decimal" defaultValue={v.exchange_rate === 1 ? "" : String(v.exchange_rate)} readOnly={lockMoney} />
        </div>
      )}
      {lockMoney ? (
        <>
          <input type="hidden" name="method" value={v.method} />
          {v.provider && <input type="hidden" name="provider" value={v.provider} />}
          <input type="hidden" name="reference" value={v.reference ?? ""} />
        </>
      ) : (
        <PayMethodFields method={v.method} provider={v.provider} reference={v.reference} withProvider={withProvider} />
      )}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" maxLength={1000} defaultValue={v.notes ?? ""} />
      </div>
    </div>
  );
}
