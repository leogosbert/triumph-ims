"use client";

import { useEffect, useState } from "react";
import { LOCK_OPTIONS, lockLabel, readLockPref, saveLockPref, DEFAULT_LOCK_SECONDS } from "@/lib/applock";
import { useTr } from "@/lib/tr-client";

function duration(minutes: number, tr: (s: string) => string) {
  if (minutes < 60) return `${minutes} ${tr("minutes")}`;
  const h = minutes / 60;
  return `${h} ${tr(h === 1 ? "hour" : "hours")}`;
}

/**
 * When to ask for the password again on this phone or computer (Your account, near the top).
 * `idleMinutes`: the company's automatic sign-out, shown alongside so the two are not confused.
 */
export function LockPreference({ idleMinutes = 0 }: { idleMinutes?: number }) {
  const tr = useTr();
  const [value, setValue] = useState<number>(DEFAULT_LOCK_SECONDS);
  const [saved, setSaved] = useState<boolean | null>(null);
  useEffect(() => setValue(readLockPref()), []);
  const options = LOCK_OPTIONS.some((o) => o.v === value) ? LOCK_OPTIONS : [...LOCK_OPTIONS, { v: value, label: lockLabel(value) }];
  const idleFirst = idleMinutes > 0 && (value < 0 || value >= idleMinutes * 60);
  return (
    <div className="field lock-pref">
      <label htmlFor="lock-pref">{tr("Ask for my password again")}</label>
      <select
        id="lock-pref"
        value={String(value)}
        aria-describedby="lock-pref-hint"
        onChange={(e) => {
          const v = Number(e.target.value);
          setValue(v);
          setSaved(saveLockPref(v));
        }}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {tr(o.label)}
          </option>
        ))}
      </select>
      <span className="hint" id="lock-pref-hint">
        {saved === true ? `${tr("Saved for this device.")} ` : saved === false ? `${tr("This browser cannot save settings (private mode?).")} ` : ""}
        {tr("For this phone or computer only. Coming back sooner never asks for the password.")}
        {idleMinutes > 0 && (
          <>
            {" "}
            {tr("Separately, your company signs everyone out after")} {duration(idleMinutes, tr)} {tr("without use (Settings → Security, set by management).")}
            {idleFirst && ` ${tr("That sign-out comes first.")}`}
          </>
        )}
      </span>
    </div>
  );
}
