"use client";

import { useEffect, useState } from "react";
import { LOCK_OPTIONS, LOCK_PREF_KEY, readLockPref } from "@/lib/applock";
import { useTr } from "@/lib/tr-client";

/** Your account → Security: when to ask for the password again on this phone or computer. */
export function LockPreference() {
  const tr = useTr();
  const [value, setValue] = useState<number>(0);
  const [saved, setSaved] = useState(false);
  useEffect(() => setValue(readLockPref()), []);
  return (
    <div className="field" style={{ marginTop: 14 }}>
      <label htmlFor="lock-pref">{tr("Ask for my password when I return to the app")}</label>
      <select
        id="lock-pref"
        value={String(value)}
        onChange={(e) => {
          const v = Number(e.target.value);
          setValue(v);
          try {
            localStorage.setItem(LOCK_PREF_KEY, String(v));
            setSaved(true);
          } catch {
            /* private mode */
          }
        }}
      >
        {LOCK_OPTIONS.map((o) => (
          <option key={o.v} value={o.v}>
            {tr(o.label)}
          </option>
        ))}
      </select>
      <span className="hint">{saved ? tr("Saved for this device.") : tr("This setting is for this device only.")}</span>
    </div>
  );
}
