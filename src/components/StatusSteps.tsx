import { tr } from "@/lib/tr";

export type StatusStep = { label: string; done: boolean };

/**
 * A small step line for the top of a record: Quoted → Accepted → Ordered → Delivered → Paid.
 * Done steps get a tick, the first step not done is the current one, the rest are still to come.
 * On phones the steps wrap onto a second line rather than squeezing or hiding labels.
 */
export function StatusSteps({ steps, label, stopped }: { steps: StatusStep[]; label?: string; stopped?: string | null }) {
  if (!steps.length) return null;
  const current = steps.findIndex((s) => !s.done);
  return (
    <div className="status-steps" role="group" aria-label={label ?? tr("Progress")}>
      <ol>
        {steps.map((s, i) => {
          const state = s.done ? "done" : i === current && !stopped ? "now" : "todo";
          return (
            <li key={s.label} className={`ss-${state}`} aria-current={state === "now" ? "step" : undefined}>
              <span className="ss-dot" aria-hidden="true">
                {state === "done" ? "✓" : i + 1}
              </span>
              <span className="ss-label">{tr(s.label)}</span>
              <span className="sr-only">
                {" "}
                ({state === "done" ? tr("done") : state === "now" ? tr("current step") : tr("to come")})
              </span>
            </li>
          );
        })}
        {stopped && (
          <li className="ss-stopped">
            <span className="ss-dot" aria-hidden="true">
              ✕
            </span>
            <span className="ss-label">{tr(stopped)}</span>
          </li>
        )}
      </ol>
    </div>
  );
}
