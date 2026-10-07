"use client";

import { useState } from "react";
import { useTr } from "@/lib/tr-client";

/** Period picker for a report: a ready-made period, or "Choose dates" with from/to boxes. */
export function PeriodFields({
  options,
  preset,
  from,
  to,
  label,
  asAt,
}: {
  options: { key: string; label: string }[];
  preset: string;
  from: string;
  to: string;
  label: string;
  asAt: boolean;
}) {
  const t = useTr();
  const [value, setValue] = useState(preset);
  const custom = value === "custom";
  return (
    <div className="rep-period">
      <label className="rep-field">
        <span>{t(label)}</span>
        <select name="p" value={value} onChange={(e) => setValue(e.target.value)}>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {t(o.label)}
            </option>
          ))}
        </select>
      </label>
      {custom && !asAt && (
        <label className="rep-field">
          <span>{t("From")}</span>
          <input type="date" name="from" defaultValue={from} />
        </label>
      )}
      {custom && (
        <label className="rep-field">
          <span>{asAt ? t("Date") : t("To")}</span>
          <input type="date" name="to" defaultValue={to} />
        </label>
      )}
    </div>
  );
}
