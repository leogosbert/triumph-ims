import { tr } from "@/lib/tr";
import { JOURNEY_STATUS, type OrderJourney } from "@/lib/orders";
import { SubmitButton } from "@/components/SubmitButton";

type Step = { label: string; done: boolean };
type Person = { id: string; name: string };

/**
 * Where an order stands, from quotation to payment: status, progress bar, the stage it is at and the
 * next one. Managers also see (and can change) who is responsible for each stage; nobody else does.
 * `steps` is the older, simpler view, used until the order-progress SQL has been run.
 */
export function OrderProgress({
  journey,
  steps,
  team = [],
  assign,
}: {
  journey?: OrderJourney | null;
  steps: Step[];
  team?: Person[];
  assign?: (form: FormData) => void | Promise<void>;
}) {
  const view: Step[] = journey ? journey.stages : steps;
  const current = view.findIndex((s) => !s.done);
  const at = current === -1 ? view.length - 1 : current;
  const done = view.filter((s) => s.done).length;
  const percent = journey ? journey.percent : Math.round((100 * done) / Math.max(view.length, 1));
  const status = journey ? JOURNEY_STATUS[journey.status] : null;
  const next = journey ? journey.next : current === -1 ? null : view[current];
  const now = journey ? journey.current : [...view].reverse().find((s) => s.done) ?? null;
  const showOwners = !!journey?.can_assign;

  return (
    <section className="card progress-card" aria-label={tr("Order progress")}>
      <div className="progress-head">
        <span>
          {tr("Order progress")}
          {status && (
            <>
              {" "}
              <span className={`badge ${status.tone} progress-status`}>{tr(status.label)}</span>
            </>
          )}
        </span>
        <span>
          {percent}% · {done} / {view.length}
        </span>
      </div>
      <ol className="progress-bar">
        {view.map((s, i) => (
          <li key={s.label} className={s.done ? "done" : i === at && next ? "now" : ""} title={tr(s.label)}>
            <span className="sr-only">
              {tr(s.label)}: {s.done ? tr("done") : i === at ? tr("next") : tr("to do")}
            </span>
          </li>
        ))}
      </ol>
      <ol className="progress-steps" aria-hidden>
        {view.map((s, i) => (
          <li key={s.label} className={s.done ? "done" : i === at && next ? "now" : ""}>
            {tr(s.label)}
          </li>
        ))}
      </ol>
      <div className="progress-labels">
        <span className="muted">
          {now ? (
            <>
              {tr("Now:")} {tr(now.label)} ✓
            </>
          ) : null}
        </span>
        {next ? (
          <strong>
            {tr("Next:")} {tr(next.label)}
            {showOwners && journey?.next && (
              <span className="progress-owner">
                {" "}
                · {journey.next.owner ?? tr("Nobody yet")}
              </span>
            )}
          </strong>
        ) : (
          journey?.status === "completed" && <strong className="text-ok">{tr("All done")}</strong>
        )}
      </div>

      {showOwners && journey && (
        <details className="progress-people">
          <summary>{tr("Who is responsible")}</summary>
          <p className="small muted">{tr("Only management can see this. If nobody is chosen, it is the person working on that step.")}</p>
          <ul className="list">
            {journey.stages.map((s) => (
              <li key={s.key} className="row progress-person">
                <span className={`progress-dot${s.done ? " done" : journey.next?.key === s.key ? " now" : ""}`} aria-hidden />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>{tr(s.label)}</strong>
                  <span className="small muted">
                    {" "}
                    · {s.owner ?? tr("Nobody yet")}
                    {s.owner && !s.assigned && ` (${tr("default")})`}
                  </span>
                </span>
                {assign && !s.done && (
                  <form action={assign} className="progress-assign">
                    <input type="hidden" name="quotation_id" value={journey.quotation_id} />
                    <input type="hidden" name="stage" value={s.key} />
                    <select name="user_id" defaultValue={s.assigned ? (s.owner_id ?? "") : ""} aria-label={`${tr("Responsible for")} ${tr(s.label)}`}>
                      <option value="">{tr("Default")}</option>
                      {team.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <SubmitButton className="btn btn-small" pendingText="…">
                      {tr("Save")}
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** A slim bar for lists: percentage, next stage and (managers only) who is responsible. */
export function OrderProgressMini({ journey }: { journey: OrderJourney }) {
  const status = JOURNEY_STATUS[journey.status];
  return (
    <div className="progress-mini" aria-label={`${tr("Order progress")}: ${journey.percent}%`}>
      <div className="progress-mini-track">
        <span style={{ width: `${journey.percent}%` }} />
      </div>
      <div className="small muted">
        {journey.next ? (
          <>
            {tr("Next:")} {tr(journey.next.label)}
            {journey.can_assign && ` · ${journey.next.owner ?? tr("Nobody yet")}`}
          </>
        ) : (
          tr(status.label)
        )}
      </div>
    </div>
  );
}
