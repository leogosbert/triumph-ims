import Link from "next/link";
import { notFound } from "next/navigation";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople, namesFor } from "@/lib/people";
import { aiReady } from "@/lib/ai/claude";
import {
  canApprove,
  canManage,
  MEETING_COLUMNS,
  MEETING_TOPICS,
  MINUTES_STATUS,
  POINT_KIND,
  POINT_STATUS,
  PROPOSAL_LABEL,
  PROPOSAL_STATUS,
  PROPOSAL_TARGETS,
  proposalLines,
  type Meeting,
  type Point,
  type Proposal,
} from "@/lib/meetings/model";
import { addProposal, approveMinutes, decideProposal, deletePoint, editProposal, savePoint, saveTexts, writeMinutes } from "../../actions";
import { MeetingBadge, whenRange } from "../../parts";
import { ProposalFields } from "./ProposalFields";
import { RefreshWhile } from "./RefreshWhile";
import styles from "../../meetings.module.css";

export const metadata = { title: "Minutes" };
export const maxDuration = 10;

/** Labels for the records proposals point to (only those this person may read). */
async function recordLabels(supabase: Awaited<ReturnType<typeof getAppContext>>["supabase"], proposals: Proposal[]) {
  const ids = (k: string) => [...new Set(proposals.map((p) => p.payload?.[k]).filter((x): x is string => typeof x === "string"))];
  const map = new Map<string, string>();
  const src = proposals.filter((p) => p.target === "corrective_action");
  const [cl, op, qu, inv, ci, inc, ncr] = await Promise.all([
    ids("client_id").length ? supabase.from("clients").select("id, name").in("id", ids("client_id")) : null,
    ids("opportunity_id").length ? supabase.from("opportunities").select("id, title").in("id", ids("opportunity_id")) : null,
    ids("quotation_id").length ? supabase.from("quotations").select("id, number").in("id", ids("quotation_id")) : null,
    ids("invoice_id").length ? supabase.from("invoices").select("id, number").in("id", ids("invoice_id")) : null,
    ids("item_id").length ? supabase.from("compliance_items").select("id, name").in("id", ids("item_id")) : null,
    src.length ? supabase.from("hse_incidents").select("id, number, title").in("id", ids("source_id")) : null,
    src.length ? supabase.from("quality_ncrs").select("id, number, title").in("id", ids("source_id")) : null,
  ]);
  for (const r of (cl?.data ?? []) as { id: string; name: string }[]) map.set(r.id, r.name);
  for (const r of (op?.data ?? []) as { id: string; title: string }[]) map.set(r.id, r.title);
  for (const r of (qu?.data ?? []) as { id: string; number: string | null }[]) map.set(r.id, r.number ?? tr("Quotation"));
  for (const r of (inv?.data ?? []) as { id: string; number: string | null }[]) map.set(r.id, r.number ?? tr("Invoice"));
  for (const r of (ci?.data ?? []) as { id: string; name: string }[]) map.set(r.id, r.name);
  for (const r of [...((inc?.data ?? []) as { id: string; number: string | null; title: string }[]), ...((ncr?.data ?? []) as { id: string; number: string | null; title: string }[])])
    map.set(r.id, [r.number, r.title].filter(Boolean).join(" "));
  return map;
}

export default async function MinutesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user, isManager } = await getAppContext();
  const { data } = await supabase.from("meetings").select(MEETING_COLUMNS).eq("id", id).maybeSingle();
  if (!data) notFound();
  const m = data as unknown as Meeting;
  const manage = canManage(m, user.id, role);
  const approve = canApprove(m, user.id, role);
  const [pts, props, texts, people] = await Promise.all([
    supabase.from("meeting_points").select("*").eq("meeting_id", id).order("sort"),
    supabase.from("meeting_proposals").select("*").eq("meeting_id", id).order("created_at"),
    manage ? supabase.from("meeting_texts").select("transcript, notes").eq("meeting_id", id).maybeSingle() : Promise.resolve({ data: null }),
    companyPeople(supabase, company.id),
  ]);
  const points = (pts.data ?? []) as Point[];
  const proposals = (props.data ?? []) as Proposal[];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const extra = await namesFor(supabase, [...points.map((p) => p.owner_id), m.approved_by, ...proposals.map((p) => p.decided_by)].filter((x) => x && !nameOf.has(x)));
  for (const [k, v] of extra) nameOf.set(k, v);
  const labels = await recordLabels(supabase, proposals);
  const s = m.minutes_summary ?? {};
  const approved = m.minutes_status === "approved";
  const editable = manage && (!approved || isManager);
  const writing = m.minutes_status === "writing" && m.minutes_requested_at && Date.now() - Date.parse(m.minutes_requested_at) < 20 * 60_000;
  const kinds = ["decision", "action", "issue", "note"];
  const pointTitle = new Map(points.map((p, i) => [p.id, `${i + 1}. ${p.body.slice(0, 60)}`]));

  // Last time's items that these minutes mention.
  const fuIds = (s.follow_up ?? []).map((f) => f.point_id);
  const { data: fuRows } = fuIds.length ? await supabase.from("meeting_points").select("id, body").in("id", fuIds) : { data: [] };
  const fuBody = new Map(((fuRows ?? []) as { id: string; body: string }[]).map((r) => [r.id, r.body]));

  return (
    <>
      {writing && <RefreshWhile />}
      <div className="page-head">
        <h1>{tr("Minutes")}</h1>
        <span>
          <MeetingBadge m={m} />
        </span>
      </div>
      <p className="small muted">
        <Link href={`/meetings/${id}`}>{m.title}</Link> · {whenRange(m)}
      </p>
      <Notice {...notice} />

      <section className="card">
        <div className="line-head">
          <h2 style={{ margin: 0 }}>{tr(MINUTES_STATUS[m.minutes_status]?.label ?? "Minutes")}</h2>
          {m.minutes_by && <span className="badge tone-off">{m.minutes_by === "ai" ? tr("Written by AI") : m.minutes_by === "app" ? tr("From the typed notes") : tr("Written by hand")}</span>}
        </div>
        {m.minutes_error && <p className="small banner warn">{tr(m.minutes_error)}</p>}
        {writing && <p className="muted">{tr("The AI is writing the minutes. This page updates by itself.")}</p>}
        {approved && m.approved_at && (
          <p className="small muted">
            {tr("Approved by")} {nameOf.get(m.approved_by ?? "") ?? ""} · {formatDateTime(m.approved_at)}
          </p>
        )}
        {m.status !== "held" && <p className="muted">{tr("The minutes are written after the meeting ends.")}</p>}
        {m.status === "held" && manage && !approved && (
          <form action={writeMinutes} className="inline-form" style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton className={`btn ${m.minutes_status === "none" ? "btn-primary" : ""}`} pendingText={tr("Writing…")}>
              {m.minutes_status === "none" ? tr("Write the minutes") : tr("Write them again")}
            </SubmitButton>
            <span className="small muted">
              {aiReady() ? tr("The AI reads the transcript and notes. Points you added by hand are kept.") : tr("AI is not switched on: the app writes the minutes from the typed notes.")}
            </span>
          </form>
        )}
        {s.summary && <p style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{s.summary}</p>}
        {(s.topics ?? []).map((t) => (
          <div key={t.topic}>
            <h3 style={{ marginBottom: 4 }}>{tr(t.topic)}</h3>
            <ul>
              {t.points.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        ))}
        {(s.suggestions ?? []).length > 0 && (
          <>
            <h3>{tr("Suggestions")}</h3>
            <ul>
              {s.suggestions!.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </>
        )}
        {(s.unclear ?? []).length > 0 && (
          <>
            <h3>{tr("Not clear in the recording")}</h3>
            <ul className="small">
              {s.unclear!.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </>
        )}
        {s.language_note && <p className="small muted">{s.language_note}</p>}
      </section>

      {(s.follow_up ?? []).length > 0 && (
        <section className="card">
          <h2>{tr("From earlier meetings")}</h2>
          <ul className="rec-list">
            {s.follow_up!.map((f) => (
              <li key={f.point_id}>
                <div className="line-head">
                  <span>{fuBody.get(f.point_id) ?? tr("Earlier point")}</span>
                  <span className={`badge tone-${POINT_STATUS[f.status]?.tone ?? "off"}`}>{tr(POINT_STATUS[f.status]?.label ?? f.status)}</span>
                </div>
                {f.note && <div className="small muted">{f.note}</div>}
              </li>
            ))}
          </ul>
          {!approved && <p className="small muted">{tr("When the minutes are approved, these items are updated.")}</p>}
        </section>
      )}

      <section className="card" id="points">
        <h2>{tr("Issues, decisions and actions")}</h2>
        {points.length === 0 && <p className="muted small">{tr("No points yet.")}</p>}
        {kinds.map((k) => {
          const list = points.filter((p) => p.kind === k);
          if (!list.length) return null;
          return (
            <div key={k}>
              <h3 style={{ marginBottom: 4 }}>{tr(POINT_KIND[k] + "s")}</h3>
              <ul className="rec-list">
                {list.map((p) => (
                  <li key={p.id}>
                    <div className="line-head">
                      <span>{p.body}</span>
                      {approved && (k === "action" || k === "issue") && <span className={`badge tone-${POINT_STATUS[p.status]?.tone}`}>{tr(POINT_STATUS[p.status]?.label ?? p.status)}</span>}
                    </div>
                    <div className={styles.meta}>
                      {(p.owner_id || p.owner_name) && (
                        <span>
                          {tr("Owner")}: {p.owner_id ? nameOf.get(p.owner_id) : `${p.owner_name} (${tr("not matched")})`}
                        </span>
                      )}
                      {p.due_on && (
                        <span>
                          {tr("Due")} {formatDate(p.due_on)}
                        </span>
                      )}
                      {p.severity && <span>{tr(p.severity)}</span>}
                      {p.topic && <span>{tr(p.topic)}</span>}
                      {p.raised_by && (
                        <span>
                          {tr("Raised by")} {p.raised_by}
                        </span>
                      )}
                      {p.source !== "manual" && <span>{p.source === "ai" ? tr("AI") : p.source === "app" ? tr("from notes") : tr("approved update")}</span>}
                    </div>
                    {editable && (
                      <details>
                        <summary className="small">{tr("Change")}</summary>
                        <PointForm meetingId={id} p={p} people={people} />
                        <form action={deletePoint} style={{ marginTop: 6 }}>
                          <input type="hidden" name="meeting_id" value={id} />
                          <input type="hidden" name="point_id" value={p.id} />
                          <SubmitButton className="btn btn-small">{tr("Remove")}</SubmitButton>
                        </form>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {editable && (m.status === "held" || m.status === "live") && (
          <details>
            <summary>{tr("+ Add a point")}</summary>
            <PointForm meetingId={id} people={people} />
          </details>
        )}
        {m.status === "held" && m.minutes_status === "ready" && approve && (
          <form action={approveMinutes} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={id} />
            <SubmitButton pendingText={tr("Approving…")}>{tr("Approve the minutes")}</SubmitButton>
            <p className="small muted">{tr("The points become final, each action owner is told and finds it under My actions, and action dates go on the calendar.")}</p>
          </form>
        )}
        {m.status === "held" && m.minutes_status === "ready" && !approve && <p className="small muted">{tr("Management or the chair approves the minutes.")}</p>}
      </section>

      {(proposals.length > 0 || (manage && m.status === "held")) && (
        <section className="card" id="updates">
          <h2>{tr("Updates for other departments")}</h2>
          <p className="small muted">{tr("Changes the meeting agreed. Nothing changes until management approves each one; it is then made through that department's own rules.")}</p>
          {proposals.map((p) => (
            <div key={p.id} className={styles.proposal}>
              <div className="line-head">
                <strong>{p.title}</strong>
                <span className={`badge tone-${PROPOSAL_STATUS[p.status]?.tone}`}>{tr(PROPOSAL_STATUS[p.status]?.label ?? p.status)}</span>
              </div>
              <div className="small muted">
                {tr(PROPOSAL_LABEL[p.target] ?? p.target)}
                {p.point_id && pointTitle.get(p.point_id) ? ` · ${tr("from point")} ${pointTitle.get(p.point_id)}` : ""}
                {p.source === "ai" ? ` · ${tr("proposed by AI")}` : p.source === "app" ? ` · ${tr("found in the notes")}` : ""}
              </div>
              <ul className="small">
                {proposalLines(p, nameOf, labels).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
              {p.status !== "pending" && (
                <p className="small muted">
                  {p.status === "applied" ? tr("Approved by") : tr("Rejected by")} {nameOf.get(p.decided_by ?? "") ?? ""}
                  {p.decided_at && ` · ${formatDateTime(p.decided_at)}`}
                  {p.decision_note && ` · ${p.decision_note}`}
                </p>
              )}
              {p.status === "pending" && isManager && m.minutes_status !== "none" && m.minutes_status !== "writing" && (
                <>
                  <details>
                    <summary className="small">{tr("Change before approving")}</summary>
                    <form action={editProposal}>
                      <input type="hidden" name="meeting_id" value={id} />
                      <input type="hidden" name="proposal_id" value={p.id} />
                      <input type="hidden" name="target" value={p.target} />
                      <label className="field">
                        <span>{tr("Title")}</span>
                        <input name="title" defaultValue={p.title} maxLength={300} />
                      </label>
                      <ProposalFields target={p.target} payload={p.payload ?? {}} people={people} />
                      <SubmitButton className="btn btn-small">{tr("Save the change")}</SubmitButton>
                    </form>
                  </details>
                  <form action={decideProposal} style={{ marginTop: 6 }}>
                    <input type="hidden" name="meeting_id" value={id} />
                    <input type="hidden" name="proposal_id" value={p.id} />
                    <label className="field">
                      <span>{tr("Note (optional)")}</span>
                      <input name="note" maxLength={500} />
                    </label>
                    <div className="inline-form" style={{ gap: 6 }}>
                      <SubmitButton className="btn btn-small btn-primary" name="approve" value="1" pendingText={tr("Making the change…")}>
                        {tr("Approve and make it")}
                      </SubmitButton>
                      <SubmitButton className="btn btn-small" name="approve" value="0">
                        {tr("Reject")}
                      </SubmitButton>
                    </div>
                  </form>
                </>
              )}
            </div>
          ))}
          {manage && m.status === "held" && (
            <details>
              <summary>{tr("+ Propose an update")}</summary>
              <form action={addProposal}>
                <input type="hidden" name="meeting_id" value={id} />
                <label className="field">
                  <span>{tr("What")}</span>
                  <select name="target" defaultValue="calendar_entry">
                    {PROPOSAL_TARGETS.filter((t) => ["calendar_entry", "next_meeting", "task"].includes(t)).map((t) => (
                      <option key={t} value={t}>
                        {tr(PROPOSAL_LABEL[t])}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{tr("Title / task / date title")}</span>
                  <input name="f_title" maxLength={200} />
                </label>
                <input type="hidden" name="title" value="" />
                <div className="inline-form">
                  <label className="field">
                    <span>{tr("Date")}</span>
                    <input type="date" name="f_starts_on" />
                  </label>
                  <label className="field">
                    <span>{tr("Time")}</span>
                    <input type="time" name="f_at_time" />
                  </label>
                  <label className="field">
                    <span>{tr("Next meeting: date and time")}</span>
                    <input type="datetime-local" name="f_starts_at" />
                  </label>
                </div>
                <div className="inline-form">
                  <label className="field">
                    <span>{tr("Who")}</span>
                    <select name="f_owner_id" defaultValue="">
                      <option value="">{tr("Not set")}</option>
                      {people.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>{tr("Task due")}</span>
                    <input type="date" name="f_due_on" />
                  </label>
                </div>
                <label className="field">
                  <span>{tr("Task (for a task)")}</span>
                  <input name="f_text" maxLength={1000} />
                </label>
                <SubmitButton className="btn btn-small">{tr("Propose")}</SubmitButton>
              </form>
            </details>
          )}
        </section>
      )}

      {manage && !approved && m.status === "held" && (
        <details className="card">
          <summary>{tr("Correct the transcript and notes")}</summary>
          <form action={saveTexts}>
            <input type="hidden" name="id" value={id} />
            <label className="field">
              <span>{tr("Typed notes (lines starting Action:, Decision: or Issue: become those points)")}</span>
              <textarea name="notes" rows={8} defaultValue={String(texts.data?.notes ?? "")} maxLength={100000} />
            </label>
            <label className="field">
              <span>{tr("What was said")}</span>
              <textarea name="transcript" rows={10} defaultValue={String(texts.data?.transcript ?? "")} maxLength={400000} />
            </label>
            <SubmitButton className="btn btn-small">{tr("Save")}</SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}

function PointForm({ meetingId, p, people }: { meetingId: string; p?: Point; people: { id: string; name: string }[] }) {
  return (
    <form action={savePoint}>
      <input type="hidden" name="meeting_id" value={meetingId} />
      {p && <input type="hidden" name="point_id" value={p.id} />}
      {p?.client_id && <input type="hidden" name="client_id" value={p.client_id} />}
      {p?.supplier_id && <input type="hidden" name="supplier_id" value={p.supplier_id} />}
      {p?.quotation_id && <input type="hidden" name="quotation_id" value={p.quotation_id} />}
      {p?.purchase_order_id && <input type="hidden" name="purchase_order_id" value={p.purchase_order_id} />}
      <div className="inline-form">
        <label className="field">
          <span>{tr("Kind")}</span>
          <select name="kind" defaultValue={p?.kind ?? "action"}>
            {Object.entries(POINT_KIND).map(([k, l]) => (
              <option key={k} value={k}>
                {tr(l)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr("Topic")}</span>
          <select name="topic" defaultValue={p?.topic ?? ""}>
            <option value="">{tr("None")}</option>
            {MEETING_TOPICS.map((t) => (
              <option key={t} value={t}>
                {tr(t)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>{tr("Point")}</span>
        <textarea name="body" rows={2} required minLength={2} maxLength={1000} defaultValue={p?.body ?? ""} />
      </label>
      <div className="inline-form">
        <label className="field">
          <span>{tr("Owner")}</span>
          <select name="owner_id" defaultValue={p?.owner_id ?? ""}>
            <option value="">{tr("Not set")}</option>
            {people.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{tr("Due")}</span>
          <input type="date" name="due_on" defaultValue={p?.due_on ?? ""} />
        </label>
        <label className="field">
          <span>{tr("How serious")}</span>
          <select name="severity" defaultValue={p?.severity ?? ""}>
            <option value="">-</option>
            <option value="low">{tr("low")}</option>
            <option value="medium">{tr("medium")}</option>
            <option value="high">{tr("high")}</option>
          </select>
        </label>
      </div>
      <input type="hidden" name="owner_name" value={p?.owner_name ?? ""} />
      <input type="hidden" name="raised_by" value={p?.raised_by ?? ""} />
      <SubmitButton className="btn btn-small btn-primary">{tr("Save")}</SubmitButton>
    </form>
  );
}
