import { tr } from "@/lib/tr";
import { SubmitButton } from "@/components/SubmitButton";
import { addCorrectiveAction, finishCorrectiveAction, saveCorrectiveAction } from "@/app/(app)/hse/actions";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { ACTION_STATUS, type CorrectiveAction, type SourceKind } from "@/lib/hse";
import { companyPeople, namesFor } from "@/lib/people";
import { StatusBadge } from "@/lib/sales";
import { daysFromToday, todayTz } from "@/lib/services";
import { hasRole } from "@/lib/roles";

/**
 * Corrective actions on one incident, inspection or NCR. Management adds, changes and cancels them;
 * the owner (or management) marks one done with a note. The database checks every step.
 */
export async function CorrectiveActions({ sourceKind, sourceId, closed = false }: { sourceKind: SourceKind; sourceId: string; closed?: boolean }) {
  const { supabase, company, roles, user } = await getAppContext();
  const manager = hasRole(roles, "management");
  const { data, error } = await supabase
    .from("corrective_actions")
    .select("id, source_kind, source_id, action, owner_id, due_on, status, done_note, done_by, done_at, created_at")
    .eq("company_id", company.id)
    .eq("source_kind", sourceKind)
    .eq("source_id", sourceId)
    .order("created_at");
  if (isMissingTable(error)) return null;
  const actions = (data ?? []) as CorrectiveAction[];
  const [people, names] = await Promise.all([
    manager ? companyPeople(supabase, company.id) : Promise.resolve([]),
    namesFor(supabase, actions.flatMap((a) => [a.owner_id, a.done_by])),
  ]);
  const hidden = (id: string) => (
    <>
      <input type="hidden" name="source_kind" value={sourceKind} />
      <input type="hidden" name="source_id" value={sourceId} />
      <input type="hidden" name="action_id" value={id} />
    </>
  );
  const ownerSelect = (id: string, value: string | null) => (
    <div className="field">
      <label htmlFor={id}>{tr("Owner")}</label>
      <select id={id} name="owner_id" defaultValue={value ?? ""}>
        <option value="">{tr("— None —")}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <section className="card" id="actions">
      <h2>{tr("Corrective actions")}</h2>
      {actions.length === 0 ? (
        <p className="muted small">{tr("No actions yet.")}</p>
      ) : (
        <ul className="lines">
          {actions.map((a) => {
            const days = a.status === "open" ? daysFromToday(a.due_on) : null;
            const mine = a.owner_id === user.id;
            return (
              <li key={a.id}>
                <div className="line-head">
                  <div>
                    <div className="desc">{a.action}</div>
                    <div className="muted small">
                      {a.owner_id ? names.get(a.owner_id) ?? "—" : tr("No owner")}
                      {a.due_on && ` · ${tr("due")} ${formatDate(a.due_on)}`}
                      {a.done_at && ` · ${formatDate(a.done_at)}`}
                      {a.done_by && a.status !== "open" && ` · ${names.get(a.done_by) ?? ""}`}
                    </div>
                    {a.done_note && <div className="small">{a.done_note}</div>}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {days !== null && days < 0 && <span className="badge tone-bad">{tr("Overdue")}</span>}
                    <StatusBadge map={ACTION_STATUS} status={a.status} />
                  </div>
                </div>
                {a.status === "open" && (mine || manager) && (
                  <details>
                    <summary className="small">{tr("Mark done")}</summary>
                    <form action={finishCorrectiveAction} style={{ marginTop: 8 }}>
                      {hidden(a.id)}
                      <input type="hidden" name="done" value="true" />
                      <div className="field">
                        <label htmlFor={`note-${a.id}`}>{tr("What was done")}</label>
                        <input id={`note-${a.id}`} name="note" type="text" required maxLength={1000} />
                      </div>
                      <SubmitButton className="btn btn-primary btn-small">{tr("Mark done")}</SubmitButton>
                    </form>
                  </details>
                )}
                {a.status === "open" && manager && (
                  <details>
                    <summary className="small">{tr("Change or cancel")}</summary>
                    <form action={saveCorrectiveAction} style={{ marginTop: 8 }}>
                      {hidden(a.id)}
                      <div className="field">
                        <label htmlFor={`action-${a.id}`}>{tr("Action")}</label>
                        <input id={`action-${a.id}`} name="action" type="text" required minLength={3} maxLength={1000} defaultValue={a.action} />
                      </div>
                      <div className="grid grid-2">
                        {ownerSelect(`owner-${a.id}`, a.owner_id)}
                        <div className="field">
                          <label htmlFor={`due-${a.id}`}>{tr("Due date")}</label>
                          <input id={`due-${a.id}`} name="due_on" type="date" defaultValue={a.due_on ?? ""} />
                        </div>
                      </div>
                      <SubmitButton className="btn btn-small">{tr("Save")}</SubmitButton>
                    </form>
                    <form action={finishCorrectiveAction} style={{ marginTop: 8 }}>
                      {hidden(a.id)}
                      <input type="hidden" name="done" value="false" />
                      <SubmitButton className="btn btn-small" pendingText={tr("Cancelling…")}>
                        {tr("Cancel this action")}
                      </SubmitButton>
                    </form>
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {manager && !closed && (
        <details style={{ marginTop: 12 }}>
          <summary>{tr("+ Action")}</summary>
          <form action={addCorrectiveAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="source_kind" value={sourceKind} />
            <input type="hidden" name="source_id" value={sourceId} />
            <div className="field">
              <label htmlFor="new-action">{tr("Action")}</label>
              <input id="new-action" name="action" type="text" required minLength={3} maxLength={1000} placeholder={tr("e.g. Fit guard rails on the loading bay")} />
            </div>
            <div className="grid grid-2">
              {ownerSelect("new-owner", null)}
              <div className="field">
                <label htmlFor="new-due">{tr("Due date")}</label>
                <input id="new-due" name="due_on" type="date" min={todayTz()} />
              </div>
            </div>
            <SubmitButton className="btn btn-primary btn-small">{tr("Add action")}</SubmitButton>
          </form>
        </details>
      )}
    </section>
  );
}
