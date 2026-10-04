import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import "../suggestions.css";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { SuggestionBadge } from "@/components/suggestions/SuggestionBadge";
import { categoryLabel, isMissingSql } from "@/components/suggestions/meta";
import { getAppContext } from "@/lib/context";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople, namesFor } from "@/lib/people";
import { commentSuggestion, resubmitSuggestion, reviewSuggestion, updateMyAssignment } from "../actions";

export const metadata = { title: "Suggestion" };

type Suggestion = {
  id: string;
  company_id: string;
  number: string | null;
  created_by: string | null;
  category: string;
  title: string;
  body: string | null;
  status: string;
  assigned_to: string | null;
  department: string | null;
  is_internal: boolean;
  about_app: boolean;
  manager_note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string | null;
};

type Comment = { id: string; author_id: string | null; body: string; created_at: string };

const STEPS = [
  { key: "sent", label: "Sent" },
  { key: "review", label: "Reviewed" },
  { key: "decision", label: "Decision" },
  { key: "done", label: "Implemented" },
];

function stepIndex(status: string): number {
  if (status === "submitted") return 0;
  if (status === "under_review" || status === "needs_clarification") return 1;
  if (status === "approved" || status === "assigned" || status === "rejected") return 2;
  if (status === "implemented") return 3;
  return 2; // archived
}

/** Manager decision buttons, hiding the one that matches the current status. */
const DECISIONS = [
  { status: "under_review", label: "Under review", cls: "btn" },
  { status: "approved", label: "Approve", cls: "btn btn-primary" },
  { status: "needs_clarification", label: "Ask for clarification", cls: "btn" },
  { status: "implemented", label: "Mark implemented", cls: "btn" },
  { status: "rejected", label: "Reject", cls: "btn btn-danger" },
  { status: "archived", label: "Archive", cls: "btn" },
];

function NotFoundCard() {
  return (
    <>
      <p className="small">
        <Link href="/suggestions">{tr("← Suggestion Box")}</Link>
      </p>
      <div className="card sg-empty">
        <p>{tr("This suggestion was not found, or you do not have permission to see it.")}</p>
      </div>
    </>
  );
}

export default async function SuggestionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, user, isManager } = await getAppContext();

  if (!/^[0-9a-f-]{36}$/i.test(id)) return <NotFoundCard />;
  const { data, error } = await supabase
    .from("suggestions")
    .select("*")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (error && isMissingSql(error)) {
    return (
      <>
        <p className="small">
          <Link href="/suggestions">{tr("← Suggestion Box")}</Link>
        </p>
        <div className="banner warn">{tr("The Suggestion Box needs the Stage 11 database update. Run it in Supabase, then refresh this page.")}</div>
      </>
    );
  }
  if (!data) return <NotFoundCard />;
  const s = data as Suggestion;

  const [{ data: commentData }, people] = await Promise.all([
    supabase.from("suggestion_comments").select("id, author_id, body, created_at").eq("suggestion_id", s.id).order("created_at"),
    isManager ? companyPeople(supabase, company.id) : Promise.resolve([]),
  ]);
  const comments = (commentData ?? []) as Comment[];
  const names = await namesFor(supabase, [s.created_by, s.assigned_to, s.decided_by, ...comments.map((c) => c.author_id)]);
  const who = (uid: string | null) => (!uid ? "" : uid === user.id ? tr("You") : (names.get(uid) ?? tr("Team member")));

  const isAuthor = s.created_by === user.id;
  const isAssignee = s.assigned_to === user.id;
  const closed = s.status === "archived";
  const canComment = (isAuthor || isAssignee || isManager) && !closed;
  const step = stepIndex(s.status);
  const assigneeCanAct = isAssignee && ["assigned", "approved", "under_review"].includes(s.status);

  return (
    <>
      <p className="small">
        <Link href="/suggestions">{tr("← Suggestion Box")}</Link>
      </p>
      <div className="page-head">
        <h1>{s.title}</h1>
        <SuggestionBadge status={s.status} />
      </div>
      <p className="muted small">
        {s.number ?? ""} · {tr(categoryLabel(s.category))}
        {s.is_internal && (
          <>
            {" · "}
            {tr("Internal improvement")}
          </>
        )}
        {s.about_app && (
          <>
            {" · "}
            {tr("About the app")}
          </>
        )}
      </p>
      <Notice {...notice} />

      <ol className="sg-steps" aria-label={tr("Progress")}>
        {STEPS.map((st, i) => {
          let label = st.label;
          if (i === 2 && step >= 2) label = s.status === "rejected" ? "Not taken forward" : s.status === "assigned" ? "Assigned" : "Approved";
          if (i === 1 && s.status === "needs_clarification") label = "Needs clarification";
          const state = s.status === "rejected" && i === 3 ? "skip" : i < step ? "done" : i === step ? "now" : "todo";
          return (
            <li key={st.key} className={`sg-step sg-step-${state}`}>
              <span className="sg-dot" aria-hidden />
              <span>{tr(label)}</span>
            </li>
          );
        })}
      </ol>
      {closed && <div className="banner warn small">{tr("This suggestion has been archived.")}</div>}

      <section className="card">
        <dl className="kv">
          <dt>{tr("From")}</dt>
          <dd>{who(s.created_by) || "—"}</dd>
          <dt>{tr("Sent")}</dt>
          <dd>{formatDate(s.created_at)}</dd>
          {s.assigned_to && (
            <>
              <dt>{tr("Assigned to")}</dt>
              <dd>{who(s.assigned_to)}</dd>
            </>
          )}
          {s.department && (
            <>
              <dt>{tr("Department")}</dt>
              <dd>{s.department}</dd>
            </>
          )}
          {s.decided_at && (
            <>
              <dt>{tr("Last decision")}</dt>
              <dd>
                {formatDate(s.decided_at)}
                {s.decided_by ? ` · ${who(s.decided_by)}` : ""}
              </dd>
            </>
          )}
        </dl>
        {s.body ? <p className="sg-body">{s.body}</p> : <p className="muted small">{tr("No details were added.")}</p>}
      </section>

      {s.manager_note && (
        <section className={`card sg-note${s.status === "needs_clarification" ? " sg-note-ask" : ""}`}>
          <h2>{tr("Note from management")}</h2>
          <p className="sg-body">{s.manager_note}</p>
        </section>
      )}

      {/* ---------- Author: answer a request for clarification ---------- */}
      {isAuthor && s.status === "needs_clarification" && (
        <section className="card" id="clarify">
          <h2>{tr("Add the clarification")}</h2>
          <p className="muted small">{tr("Update your suggestion with the details management asked for, then send it again.")}</p>
          <form action={resubmitSuggestion}>
            <input type="hidden" name="id" value={s.id} />
            <div className="field">
              <textarea name="body" rows={6} maxLength={4000} defaultValue={s.body ?? ""} required aria-label={tr("Details")} />
            </div>
            <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Sending…")}>
              {tr("Send again")}
            </SubmitButton>
          </form>
        </section>
      )}

      {/* ---------- Assignee: report progress ---------- */}
      {assigneeCanAct && (
        <section className="card" id="mywork">
          <h2>{tr("Your task")}</h2>
          <p className="muted small">{tr("Let management know how it is going.")}</p>
          <form action={updateMyAssignment}>
            <input type="hidden" name="id" value={s.id} />
            <div className="field">
              <label htmlFor="sg-mynote">{tr("Note (optional)")}</label>
              <textarea id="sg-mynote" name="note" rows={2} maxLength={2000} />
            </div>
            <div className="actions-bar">
              {s.status !== "under_review" && (
                <SubmitButton className="btn" name="status" value="under_review" pendingText={tr("Saving…")}>
                  {tr("Working on it")}
                </SubmitButton>
              )}
              <SubmitButton className="btn btn-primary" name="status" value="implemented" pendingText={tr("Saving…")}>
                {tr("Implemented")}
              </SubmitButton>
            </div>
          </form>
        </section>
      )}

      {/* ---------- Management decisions ---------- */}
      {isManager && (
        <>
          <section className="card" id="decide">
            <h2>{tr("Decide")}</h2>
            <form action={reviewSuggestion}>
              <input type="hidden" name="id" value={s.id} />
              <div className="field">
                <label htmlFor="sg-note">{tr("Note to the author")}</label>
                <textarea id="sg-note" name="note" rows={3} maxLength={2000} placeholder={tr("Needed when asking for clarification or rejecting.")} />
              </div>
              <div className="actions-bar sg-decisions">
                {DECISIONS.filter((d) => d.status !== s.status).map((d) => (
                  <SubmitButton key={d.status} className={`${d.cls} btn-small`} name="status" value={d.status} pendingText={tr("Saving…")}>
                    {tr(d.label)}
                  </SubmitButton>
                ))}
              </div>
            </form>
          </section>

          <section className="card" id="assign">
            <h2>{s.assigned_to ? tr("Reassign") : tr("Assign to…")}</h2>
            {people.length === 0 ? (
              <p className="muted small">{tr("No active team members found.")}</p>
            ) : (
              <form action={reviewSuggestion}>
                <input type="hidden" name="id" value={s.id} />
                <input type="hidden" name="status" value="assigned" />
                <div className="field">
                  <label htmlFor="sg-assignee">{tr("Team member")}</label>
                  <select id="sg-assignee" name="assign_to" required defaultValue={s.assigned_to ?? ""}>
                    <option value="" disabled>
                      {tr("Choose a person")}
                    </option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="sg-adept">{tr("Department (optional)")}</label>
                  <input id="sg-adept" name="department" maxLength={80} defaultValue={s.department ?? ""} placeholder={tr("e.g. Stores, Sales, Finance")} />
                </div>
                <div className="field">
                  <label htmlFor="sg-anote">{tr("Note (optional)")}</label>
                  <textarea id="sg-anote" name="note" rows={2} maxLength={2000} />
                </div>
                <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Saving…")}>
                  {tr("Assign")}
                </SubmitButton>
              </form>
            )}
          </section>
        </>
      )}

      {/* ---------- Comments ---------- */}
      <section className="card" id="comments">
        <h2>{tr("Comments")}</h2>
        {comments.length === 0 ? (
          <p className="muted small">{tr("No comments yet.")}</p>
        ) : (
          <ul className="sg-comments">
            {comments.map((c) => (
              <li key={c.id} className={c.author_id === user.id ? "sg-mine" : undefined}>
                <div className="sg-comment-head">
                  <strong>{who(c.author_id) || tr("Team member")}</strong>
                  <span className="small muted">{formatDateTime(c.created_at)}</span>
                </div>
                <p className="sg-body">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        {canComment && (
          <form action={commentSuggestion} className="sg-comment-form">
            <input type="hidden" name="id" value={s.id} />
            <textarea name="body" rows={2} maxLength={2000} required placeholder={tr("Write a comment…")} aria-label={tr("Comment")} />
            <SubmitButton className="btn btn-primary btn-small" pendingText={tr("Sending…")}>
              {tr("Send")}
            </SubmitButton>
          </form>
        )}
      </section>
    </>
  );
}
