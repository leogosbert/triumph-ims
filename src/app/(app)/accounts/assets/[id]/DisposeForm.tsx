"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { useTr } from "@/lib/tr-client";
import { disposeAsset } from "../../actions";

function fmt(n: number, currency: string): string {
  const dec = currency === "TZS" ? 0 : 2;
  return `${currency} ${n.toLocaleString("en-GB", { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
}

/** Sell or scrap: shows the gain or loss against the book value before confirming. */
export function DisposeForm({
  id,
  bookValue,
  currency,
  today,
  methods,
}: {
  id: string;
  bookValue: number;
  currency: string;
  today: string;
  methods: { key: string; label: string }[];
}) {
  const tr = useTr();
  const [amount, setAmount] = useState("");
  const n = Number(amount.replace(/[,\s]/g, ""));
  const received = Number.isFinite(n) && n >= 0 ? n : 0;
  const diff = Math.round((received - bookValue) * 100) / 100;

  return (
    <form action={disposeAsset}>
      <input type="hidden" name="id" value={id} />
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="disposed_on">{tr("Date")}</label>
          <input id="disposed_on" name="disposed_on" type="date" required defaultValue={today} />
        </div>
        <div className="field">
          <label htmlFor="amount">
            {tr("Amount received")} ({currency})
          </label>
          <input id="amount" name="amount" type="text" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
        </div>
        <div className="field">
          <label htmlFor="method">{tr("Received in")}</label>
          <select id="method" name="method" defaultValue="bank">
            {methods.map((m) => (
              <option key={m.key} value={m.key}>
                {tr(m.label)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className={`banner ${diff < 0 ? "warn" : "ok"} small`}>
        {tr("Book value")}: {fmt(bookValue, currency)} · {diff >= 0 ? tr("Gain on sale") : tr("Loss on sale")}: <strong>{fmt(Math.abs(diff), currency)}</strong>
      </p>
      <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
        <input type="checkbox" name="confirm" value="yes" required /> {tr("Yes, take this asset out of the books")}
      </label>
      <SubmitButton className="btn btn-danger btn-small" pendingText={tr("Posting…")}>
        {tr("Sell or scrap")}
      </SubmitButton>
    </form>
  );
}
