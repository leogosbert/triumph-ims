"use client";

import { useEffect, useState } from "react";
import { checkPassword, MIN_PASSWORD, STRENGTH_LABELS } from "@/lib/password";
import { timesLeaked } from "@/lib/pwned";
import { useTr } from "@/lib/tr-client";

/**
 * New-password box with a show/hide button, a strength meter, the rules that are not met yet,
 * and a check against passwords exposed in data breaches. `context` = name, email, company (not allowed in the password).
 */
export function NewPasswordField({
  id,
  name,
  context = [],
  onValidity,
}: {
  id: string;
  name: string;
  context?: string[];
  onValidity?: (ok: boolean) => void;
}) {
  const tr = useTr();
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);
  const [leaked, setLeaked] = useState<number | null>(null);
  const check = checkPassword(value, context);

  useEffect(() => {
    setLeaked(null);
    if (!check.ok) return;
    const t = setTimeout(() => {
      timesLeaked(value)
        .then(setLeaked)
        .catch(() => setLeaked(0)); // offline: don't block
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const ok = check.ok && (leaked ?? 0) === 0;
  useEffect(() => onValidity?.(ok), [ok, onValidity]);
  const shown = value.length === 0 ? -1 : leaked ? 0 : check.score;

  return (
    <div className="newpw">
      <div className="password-wrap">
        <input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          minLength={MIN_PASSWORD}
          required
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={`${id}-help`}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? tr("Hide password") : tr("Show password")}
          aria-pressed={visible}
        >
          {visible ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c6 0 10 7 10 7a17.6 17.6 0 0 1-3.2 3.9M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 5.4-1.6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
          <span>{visible ? tr("Hide") : tr("Show")}</span>
        </button>
      </div>
      <div className={`pw-meter s${Math.max(shown, 0)}`} aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={shown > i ? "on" : ""} />
        ))}
      </div>
      <div id={`${id}-help`} className="pw-help" aria-live="polite">
        {value.length === 0 ? (
          <span>{tr("At least 10 characters, mixing letters, numbers and symbols.")}</span>
        ) : leaked ? (
          <span className="bad">{tr("This password has appeared in data breaches. Please choose a different one.")}</span>
        ) : check.ok ? (
          <span className="good">
            {tr(STRENGTH_LABELS[check.score])}
            {leaked === 0 ? ` · ${tr("not found in known breaches")}` : ""}
          </span>
        ) : (
          <ul>
            {check.problems.map((p) => (
              <li key={p}>{tr(p)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
