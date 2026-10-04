"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { LEVELS, LEVEL_ORDER, type Level } from "@/lib/levels";
import { useTr } from "@/lib/tr-client";

/**
 * Three level cards with the comparison. The current level is highlighted; choosing another
 * asks for confirmation and explains that nothing is lost.
 */
export function LevelPicker({
  current,
  action,
  disabled = false,
}: {
  current: Level;
  action: (form: FormData) => void | Promise<void>;
  disabled?: boolean;
}) {
  const tr = useTr();
  const [pick, setPick] = useState<Level | null>(null);
  return (
    <div className="lvl-picker">
      <div className="lvl-grid" role="radiogroup" aria-label={tr("Business level")}>
        {LEVEL_ORDER.map((l) => {
          const info = LEVELS[l];
          const isCurrent = l === current;
          const chosen = pick === l;
          return (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={isCurrent}
              className={`lvl-card${isCurrent ? " current" : ""}${chosen ? " chosen" : ""}`}
              disabled={disabled}
              onClick={() => setPick(isCurrent ? null : l)}
            >
              <span className="lvl-card-top">
                <strong>{tr(info.title)}</strong>
                {isCurrent && <span className="badge tone-ok">{tr("Current")}</span>}
              </span>
              <span className="lvl-promise">{tr(info.promise)}</span>
              <span className="lvl-for">{tr(info.forWho)}</span>
              <ul>
                {info.modules.map((m) => (
                  <li key={m}>{tr(m)}</li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      {pick && pick !== current && (
        <div className="lvl-confirm" role="alertdialog" aria-labelledby="lvl-confirm-title">
          <strong id="lvl-confirm-title">
            {pick === "small"
              ? tr("Switch to Small level?")
              : pick === "medium"
                ? tr("Switch to Medium level?")
                : tr("Switch to Enterprise level?")}
          </strong>
          <p className="small">
            {tr(
              "Nothing is deleted: all customers, products, quotations, invoices and other records stay. The menus show the tools of the new level, and features you switched on or off yourself keep your choice. You can change back at any time.",
            )}
          </p>
          <form action={action} className="actions">
            <input type="hidden" name="level" value={pick} />
            <input type="hidden" name="back" value="/settings/features" />
            <SubmitButton className="btn btn-primary" pendingText={tr("Switching…")}>
              {pick === "small" ? tr("Yes, switch to Small") : pick === "medium" ? tr("Yes, switch to Medium") : tr("Yes, switch to Enterprise")}
            </SubmitButton>
            <button type="button" className="btn" onClick={() => setPick(null)}>
              {tr("Cancel")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
