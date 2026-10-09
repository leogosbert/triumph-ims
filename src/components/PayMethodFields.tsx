"use client";

import { useState } from "react";
import { MOBILE_MONEY, PAY_METHODS } from "@/lib/payMethods";
import { useTr } from "@/lib/tr-client";

/**
 * "How was it paid": method, the mobile-money service (shown for mobile money only) and the
 * reference / transaction code. Field names: method, provider, reference.
 */
export function PayMethodFields({
  method = "bank_transfer",
  provider = null,
  reference = null,
  withProvider = true,
  disabled = false,
}: {
  method?: string;
  provider?: string | null;
  reference?: string | null;
  /** False before the Stage 13 database update (the service cannot be saved yet). */
  withProvider?: boolean;
  disabled?: boolean;
}) {
  const tr = useTr();
  const [m, setM] = useState(method);
  const mobile = m === "mobile_money";
  const placeholder = mobile
    ? tr("Transaction code, e.g. QK71ABC2D")
    : m === "cheque"
      ? tr("Cheque number")
      : m === "cash"
        ? tr("Receipt number (if any)")
        : tr("Bank reference");
  return (
    <>
      <div className="field">
        <label htmlFor="method">{tr("How")}</label>
        <select id="method" name="method" value={m} onChange={(e) => setM(e.target.value)} disabled={disabled}>
          {Object.entries(PAY_METHODS).map(([k, v]) => (
            <option key={k} value={k}>
              {tr(v)}
            </option>
          ))}
        </select>
      </div>
      {mobile && withProvider && (
        <div className="field">
          <label htmlFor="provider">{tr("Mobile-money service")}</label>
          <select id="provider" name="provider" defaultValue={provider ?? "mpesa"} disabled={disabled}>
            {Object.entries(MOBILE_MONEY).map(([k, v]) => (
              <option key={k} value={k}>
                {tr(v)}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label htmlFor="reference">{mobile ? tr("Transaction code") : tr("Reference")}</label>
        <input id="reference" name="reference" type="text" defaultValue={reference ?? ""} placeholder={placeholder} disabled={disabled} />
      </div>
    </>
  );
}
