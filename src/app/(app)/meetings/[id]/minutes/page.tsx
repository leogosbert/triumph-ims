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
import { buildMinutesDoc, minutesText } from "@/lib/meetings/minutes-format";
import { transcriptionReady } from "@/lib/meetings/recording-core";
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
  RECORDING_COLUMNS,
  type Meeting,
  type Recording,
  type Point,
  type Proposal,
} from "@/lib/meetings/model";
import { addProposal, approveMinutes, decideProposal, deletePoint, editProposal, savePoint, saveTexts, writeMinutes } from "../../actions";
import { CopyMinutes } from "../../CopyMinutes";
import { MinutesDocument } from "../../MinutesDocument";
import { Recordings } from "../../Recordings";
import { MeetingBadge, StageBar, whenRange } from "../../parts";
import { ProposalFields } from "./ProposalFields";
import { RefreshWhile } from "./RefreshWhile";
import styles from "../../meetings.module.css";
import { BackLink } from "@/components/BackLink";

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
  const { supabase, company, roles, user, isManager } = await getAppContext();
  const { data } = await supabase.from("meetings").select(MEETING_COLUMNS).eq("id", id).maybeSingle();
  if (!data) notFound();
  const m = data as unknown as Meeting;
  const manage = canManage(m, user.id, roles);
  const approve = canApprove(m, user.id, roles);
  const [pts, props, texts, people, recs, att] = await Promise.all([
    supabase.from("meeting_points").select("*").eq("meeting_id", id).order("sort"),
    supabase.from("meeting_proposals").select("*").eq("meeting_id", id).order("created_at"),
    manage ? supabase.from("meeting_texts").select("transcript, notes").eq("meeting_id", id).maybeSingle() : Promise.resolve({ data: null }),
    companyPeople(supabase, company.id),
    // Missing before the v1.25 SQL is run: then there are no recordings.
    supabase.from("meeting_recordings").select(RECORDING_COLUMNS).eq("meeting_id", id).order("started_at"),
    supabase.from("meeting_attendees").select("user_id, guest_name, joined_at, present").eq("meeting_id", id),
  ]);
  const recordings = (recs.error ? [] : (recs.data ?? [])) as unknown as Recording[];
  const { data: keep } = recs.error ? { data: null } : await supabase.from("meeting_settings").select("recording_days").eq("company_id", company.id).maybeSingle();
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
  const doc = buildMinutesDoc(s, points, (uid) => nameOf.get(uid));
  const present = ((att.data ?? []) as { user_id: string | null; guest_name: string | null; joined_at: string | null; present: boolean }[])
    .filter((a) => a.joined_at || a.present)
    .map((a) => (a.user_id ? nameOf.get(a.user_id) : a.guest_name))
    .filter((x): x is string => !!x);
  const plain = minutesText(doc, {
    company: company.name,
    title: m.title,
    when: whenRange(m),
    attendees: present,
    approved: approved && m.approved_at ? `${nameOf.get(m.approved_by ?? "") ?? ""} ${formatDateTime(m.approved_at)}`.trim() : null,
  });
  const transcribing = recordings.some((r) => r.transcript_status === "writing");
  const pointTitle = new Map(points.map((p, i) => [p.id, `${i + 1}. ${p.body.slice(0, 60)}`]));

  // Last time's items that these minutes mention.
  const fuIds = (s.follow_up ?? []).map((f) => f.point_id);
  const { data: fuRows } = fuIds.length ? await supabase.from("meeting_points").select("id, body").in("id", fuIds) : { data: [] };
  const fuBody = new Map(((fuRows ?? []) as { id: string; body: string }[]).map((r) => [r.id, r.body]));

  return (
    <>
      <BackLink href={`/meetings/${id}`} label={m.title} />
      {(writing || transcribing) && <RefreshWhile />}
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

      <StageBar m={m} />

      <section className={`card ${styles.nextStep}`}>
        <div>
          <h2>{tr(MINUTES_STATUS[m.minutes_status]?.label ?? "Minutes")}</h2>
          <p className="small muted">
            {m.status !== "held"
              ? tr("The minutes are written after the meeting ends.")
              : writing
                ? transcribing
                  ? tr("The recording is being written down, then the AI writes the minutes. This page updates by itself.")
                  : tr("The AI is writing the minutes. This page updates by itself.")
                : m.minutes_status === "none"
                  ? aiReady()
                    ? tr("The AI reads the transcript, the recording and the notes (Kiswahili, English or both) and writes the minutes in English.")
                    : tr("AI is not switched on: the app writes the minutes from the typed notes.")
                  : approved
                    ? `${tr("Approved by")} ${nameOf.get(m.approved_by ?? "") ?? ""}${m.approved_at ? ` · ${formatDateTime(m.approved_at)}` : ""}`
                    : approve
                      ? tr("Read them, correct any point below, then approve: action owners are told and the dates go on the calendar.")
                      : tr("Management or the chair approves the minutes.")}
          </p>
          {m.minutes_by && (
            <span className="badge tone-off" style={{ marginTop: 6 }}>
              {m.minutes_by === "ai" ? tr("Written by AI") : m.minutes_by === "app" ? tr("From the typed notes") : tr("Written by hand")}
            </span>
          )}
        </div>
        <div className={styles.nextActions}>
          {m.status === "held" && m.minutes_status === "ready" && approve && (
            <form action={approveMinutes}>
              <input type="hidden" name="id" value={id} />
              <SubmitButton className="btn btn-primary" pendingText={tr("Approving…")}>
                {tr("Approve the minutes")}
              </SubmitButton>
            </form>
          )}
          {m.status === "held" && manage && !approved && !writing && (
            <form action={writeMinutes} className="inline-form" style={{ gap: 8 }}>
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="transcribe" value="1" />
              <label className="small" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" name="swahili_summary" value="1" defaultChecked={!!s.summary_sw} /> {tr("Also write a Kiswahili summary")}
              </label>
              <SubmitButton className={`btn ${m.minutes_status === "none" || m.minutes_status === "failed" ? "btn-primary" : ""}`} pendingText={tr("Writing…")}>
                {m.minutes_status === "none" ? tr("Write the minutes") : tr("Write them again")}
              </SubmitButton>
            </form>
          )}
          {!doc.empty && <CopyMinutes text={plain} />}
        </div>
        {m.minutes_error && <p className="small banner warn" style={{ width: "100%", margin: 0 }}>{tr(m.minutes_error)}</p>}
      </section>

      {!doc.empty && (
        <section className="card">
          <h2>{tr("Minutes")}: {m.title}</h2>
          <p className="small muted">
            {whenRange(m)}
            {present.length > 0 && ` · ${tr("Present")}: ${present.join(", ")}`}
          </p>
          <MinutesDocument doc={doc} approved={approved} />
        </section>
      )}

      <Recordings
        recordings={recordings}
        names={nameOf}
        manage={manage}
        ai={aiReady()}
        transcription={transcriptionReady()}
        back={`/meetings/${id}/minutes#recordings`}
        keepDays={Number(keep?.recording_days ?? 30)}
      />

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
        <h2>{approved ? tr("Issues, decisions and actions") : tr("Check the points")}</h2>
        {!approved && points.length > 0 && editable && <p className="small muted">{tr("Each point becomes final when the minutes are approved. Set the owner and the date of every action.")}</p>}
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
            <SubmitButton className="btn btn-primary" pendingText={tr("Approving…")}>
              {tr("Approve the minutes")}
            </SubmitButton>
            <p className="small muted">{tr("The points become final, each action owner is told and finds it under My actions, and action dates go on the calendar.")}</p>
          </form>
        )}
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
