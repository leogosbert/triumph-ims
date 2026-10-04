"use client";

import { useFormStatus } from "react-dom";
import { exitDemo, restartDemo, setDemoRole, switchDemoLevel } from "@/app/demo-actions";
import { TourButton } from "@/components/tour/TourButton";
import type { Level } from "@/lib/levels";
import { useTr } from "@/lib/tr-client";

const ROLES: { value: string; label: string }[] = [
  { value: "management", label: "Management" },
  { value: "sales", label: "Sales" },
  { value: "procurement", label: "Procurement" },
  { value: "warehouse", label: "Warehouse" },
  { value: "driver", label: "Driver" },
  { value: "finance", label: "Finance" },
];

const LEVEL_OPTIONS: { value: Level; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "enterprise", label: "Enterprise" },
];

const LEVEL_NAMES: Record<Level, string> = {
  small: "Small business demo",
  medium: "Medium business demo",
  enterprise: "Enterprise demo",
};

function Busy({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="demo-link" disabled={pending}>
      {pending ? busy : label}
    </button>
  );
}

/** The demo-level picker: submits on change and shows that the new demo is being built. */
function LevelSelect({ level }: { level: Level }) {
  const tr = useTr();
  const { pending } = useFormStatus();
  return (
    <>
      <label htmlFor="demo-level">{pending ? tr("Switching…") : tr("Switch demo")}</label>
      <select
        key={level}
        id="demo-level"
        name="level"
        defaultValue={level}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        {LEVEL_OPTIONS.map((l) => (
          <option key={l.value} value={l.value}>
            {tr(l.label)}
          </option>
        ))}
      </select>
    </>
  );
}

/**
 * Shown on every screen of a demo company: which demo this is, switch to another level,
 * take the guided tour, "view as" another role, start over, leave.
 */
export function DemoBar({ role, hoursLeft, level }: { role: string; hoursLeft: number; level?: Level | null }) {
  const tr = useTr();
  const current: Level = level ?? "medium";
  return (
    <div className="demo-bar" role="region" aria-label={tr("Demo")}>
      <span className="demo-pill">{tr("DEMO")}</span>
      <span className="demo-text">
        {level ? (
          <>
            <strong className="demo-level-name">{tr(LEVEL_NAMES[level])}</strong> ·{" "}
          </>
        ) : null}
        {tr("Sample data")} · {tr("deleted in")} {hoursLeft} h
      </span>
      <TourButton tour={current} className="demo-link demo-tour" />
      <form action={switchDemoLevel} className="demo-role">
        <LevelSelect level={current} />
      </form>
      <form action={setDemoRole} className="demo-role">
        <label htmlFor="demo-role">{tr("View as")}</label>
        <select id="demo-role" name="role" defaultValue={role} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {tr(r.label)}
            </option>
          ))}
        </select>
      </form>
      <form action={restartDemo}>
        <Busy label={tr("Start over")} busy={tr("Resetting…")} />
      </form>
      <form action={exitDemo}>
        <Busy label={tr("Exit demo")} busy={tr("Leaving…")} />
      </form>
    </div>
  );
}
