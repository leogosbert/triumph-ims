"use client";

import { useMemo, useState } from "react";
import { useTr } from "@/lib/tr-client";

export type Choice = "on" | "off" | "default";
export type SwitchItem = { key: string; name: string; note: string; current: Choice; enabled: boolean | null; levelGives: boolean };
export type SwitchGroup = { category: string; items: SwitchItem[] };

const CHOICES: Choice[] = ["on", "off", "default"];

/** One sliding On / Off / Default selector. Nothing is saved until Save is pressed. */
function Slider({ value, onChange, label }: { value: Choice; onChange: (v: Choice) => void; label: string }) {
  const tr = useTr();
  const idx = CHOICES.indexOf(value);
  return (
    <div className="fseg" role="radiogroup" aria-label={label} style={{ "--fseg-i": idx } as React.CSSProperties}>
      <span className={`fseg-thumb fseg-thumb-${value}`} aria-hidden />
      {CHOICES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          className={value === c ? "is-on" : undefined}
          onClick={() => onChange(c)}
        >
          {tr(c === "on" ? "On" : c === "off" ? "Off" : "Default")}
        </button>
      ))}
    </div>
  );
}

/**
 * Features for one company in LeMoSp ADMIN: slide each feature (or a whole category) to On, Off or
 * Default, then press Save once. The page reloads only on Save.
 */
export function FeatureSwitches({
  companyId,
  groups,
  action,
}: {
  companyId: string;
  groups: SwitchGroup[];
  action: (form: FormData) => void | Promise<void>;
}) {
  const tr = useTr();
  const initial = useMemo(() => new Map(groups.flatMap((g) => g.items.map((i) => [i.key, i.current] as const))), [groups]);
  const [choice, setChoice] = useState<Map<string, Choice>>(() => new Map(initial));
  const [saving, setSaving] = useState(false);
  const changes = [...choice].filter(([k, v]) => initial.get(k) !== v);
  const set = (keys: string[], v: Choice) =>
    setChoice((prev) => {
      const next = new Map(prev);
      keys.forEach((k) => next.set(k, v));
      return next;
    });
  // What the company will have after saving (Default = what the level gives).
  const willBeOn = (i: SwitchItem) => {
    const c = choice.get(i.key) ?? i.current;
    return c === "on" ? true : c === "off" ? false : i.levelGives;
  };

  return (
    <form
      action={action}
      onSubmit={() => setSaving(true)}
      className="fs-form"
    >
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="changes" value={JSON.stringify(Object.fromEntries(changes))} />
      {groups.map((g) => {
        const keys = g.items.map((i) => i.key);
        const onCount = g.items.filter(willBeOn).length;
        return (
          <div key={g.category} className="adm-module">
            <div className="adm-cat-head">
              <h3>
                {tr(g.category)}
                <span className="adm-cat-count">
                  {onCount}/{g.items.length} {tr("on")}
                </span>
              </h3>
              <div className="fs-cat-actions" aria-label={`${tr("Whole category")}: ${tr(g.category)}`}>
                <button type="button" className="btn btn-small" onClick={() => set(keys, "on")}>
                  {tr("All on")}
                </button>
                <button type="button" className="btn btn-small" onClick={() => set(keys, "off")}>
                  {tr("All off")}
                </button>
                <button type="button" className="btn btn-small" onClick={() => set(keys, "default")}>
                  {tr("Default")}
                </button>
              </div>
            </div>
            <ul className="list">
              {g.items.map((i) => {
                const v = choice.get(i.key) ?? i.current;
                const changed = initial.get(i.key) !== v;
                return (
                  <li key={i.key} className={changed ? "fs-changed" : undefined}>
                    <div className="row adm-feature-row">
                      <span>
                        <span className={`badge ${willBeOn(i) ? "tone-ok" : "tone-off"}`}>{willBeOn(i) ? tr("On") : tr("Off")}</span> {i.name}{" "}
                        <span className="small muted">{i.note}</span>
                        {changed && <span className="small fs-dot"> · {tr("not saved yet")}</span>}
                      </span>
                      <Slider value={v} onChange={(c) => set([i.key], c)} label={i.name} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <div className={`fs-bar${changes.length ? " is-dirty" : ""}`} role="region" aria-label={tr("Save changes")}>
        <span>
          {changes.length === 0
            ? tr("No changes")
            : changes.length === 1
              ? tr("1 change not saved")
              : tr("{n} changes not saved").replace("{n}", String(changes.length))}
        </span>
        <button type="button" className="btn btn-small" disabled={!changes.length || saving} onClick={() => setChoice(new Map(initial))}>
          {tr("Undo")}
        </button>
        <button type="submit" className="btn btn-primary btn-small" disabled={!changes.length || saving}>
          {saving ? tr("Saving…") : tr("Save")}
        </button>
      </div>
    </form>
  );
}
