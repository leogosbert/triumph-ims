"use client";

import { useFormStatus } from "react-dom";
import { exitDemo, restartDemo, setDemoRole, switchDemoLevel } from "@/app/demo-actions";
import { TourButton } from "@/components/tour/TourButton";
import { LEVEL_ORDER, type Level } from "@/lib/levels";
import { SCALE_NAME } from "@/lib/tours";
import { useTr } from "@/lib/tr-client";

const ROLES: { value: string; label: string }[] = [
  { value: "management", label: "Management" },
  { value: "sales", label: "Sales" },
  { value: "procurement", label: "Procurement" },
  { value: "warehouse", label: "Warehouse" },
  { value: "driver", label: "Driver" },
  { value: "finance", label: "Finance" },
];

const LEVEL_NAMES: Record<Level, string> = {
  small: "Small business demo",
  medium: "Medium business demo",
  enterprise: "Large (Enterprise) demo",
};

/** Short names on the scale switch (phone width). */
const SEG_NAMES: Record<Level, string> = { small: "Small", medium: "Medium", enterprise: "Large" };

function Busy({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="demo-link" disabled={pending}>
      {pending ? busy : label}
    </button>
  );
}

/** One button of the scale switch; the current scale is marked and cannot be pressed. */
function ScaleSeg({ level, current }: { level: Level; current: boolean }) {
  const tr = useTr();
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="demo-seg"
      aria-pressed={current}
      disabled={current || pending}
      aria-busy={pending}
      title={tr(SCALE_NAME[level])}
    >
      {pending ? tr("Preparing…") : tr(SEG_NAMES[level])}
    </button>
  );
}

/**
 * Shown on every screen of a demo company: which scale this demo is, switch to another scale
 * (its quick guide starts by itself), replay the quick guide, "view as" another role, start over, leave.
 */
export function DemoBar({ role, hoursLeft, level }: { role: string; hoursLeft: number; level?: Level | null }) {
  const tr = useTr();
  const current: Level = level ?? "medium";
  return (
    <div className="demo-bar" role="region" aria-label={tr("Demo")}>
      <span className="demo-pill">{tr("DEMO")}</span>
      <span className="demo-text">
        <strong className="demo-level-name">{tr(LEVEL_NAMES[current])}</strong> ·{" "}
        {tr("Sample data")} · {tr("deleted in")} {hoursLeft} h
      </span>
      <div className="demo-scale" role="group" aria-label={tr("Switch scale")}>
        <span className="demo-scale-label">{tr("Switch scale")}</span>
        <span className="demo-segs">
          {LEVEL_ORDER.map((l) => (
            <form key={l} action={switchDemoLevel}>
              <input type="hidden" name="level" value={l} />
              <ScaleSeg level={l} current={l === current} />
            </form>
          ))}
        </span>
      </div>
      <TourButton tour={current} label="Quick guide" className="demo-link demo-tour" />
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
