"use client";

import { useFormStatus } from "react-dom";
import { exitDemo, restartDemo, setDemoRole } from "@/app/demo-actions";
import { useTr } from "@/lib/tr-client";

const ROLES: { value: string; label: string }[] = [
  { value: "management", label: "Management" },
  { value: "sales", label: "Sales" },
  { value: "procurement", label: "Procurement" },
  { value: "warehouse", label: "Warehouse" },
  { value: "driver", label: "Driver" },
  { value: "finance", label: "Finance" },
];

function Busy({ label, busy }: { label: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="demo-link" disabled={pending}>
      {pending ? busy : label}
    </button>
  );
}

/** Shown on every screen of a demo company: what this is, "view as" another role, start over, leave. */
export function DemoBar({ role, hoursLeft }: { role: string; hoursLeft: number }) {
  const tr = useTr();
  return (
    <div className="demo-bar" role="region" aria-label={tr("Demo")}>
      <span className="demo-pill">{tr("DEMO")}</span>
      <span className="demo-text">
        {tr("Sample data")} · {tr("deleted in")} {hoursLeft} h
      </span>
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
