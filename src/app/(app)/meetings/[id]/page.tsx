import Link from "next/link";
import { notFound } from "next/navigation";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { todayTz } from "@/lib/services";
import { companyPeople } from "@/lib/people";
import { aiReady } from "@/lib/ai/claude";
import { canManage, joinOpen, MEETING_COLUMNS, MEETING_KINDS, MEETING_TOPICS, RECORDING_COLUMNS, type AgendaItem, type Attendee, type Meeting, type Point, type Recording } from "@/lib/meetings/model";
import { buildMinutesDoc } from "@/lib/meetings/minutes-format";
import { transcriptionReady } from "@/lib/meetings/recording-core";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { addAgendaItem, addGuest, agendaItem, cancelMeeting, removeAttendee, respondMeeting } from "../actions";
import { GuestLinkButtons } from "../GuestLinkButtons";
import { LastTime, loadLastTime } from "../LastTime";
import { MinutesDocument } from "../MinutesDocument";
import { Recordings } from "../Recordings";
import { MeetingBadge, MeetingTabs, StageBar, whenRange } from "../parts";
import styles from "../meetings.module.css";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Meeting" };

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, user, roles } = await getAppContext();
  const { data } = await supabase.from("meetings").select(MEETING_COLUMNS).eq("id", id).maybeSingle();
  if (!data) notFound();
  const m = data as unknown as Meeting;
  const manage = canManage(m, user.id, roles);
  const held = m.status === "held";
  const [att, agenda, people, client, supplier, recs, pts, last] = await Promise.all([
    supabase.from("meeting_attendees").select("*").eq("meeting_id", id).order("created_at"),
    supabase.from("meeting_agenda_items").select("*").eq("meeting_id", id).order("sort"),
    companyPeople(supabase, company.id),
    m.client_id ? supabase.from("clients").select("id, name").eq("id", m.client_id).maybeSingle() : Promise.resolve({ data: null }),
    m.supplier_id ? supabase.from("suppliers").select("id, name").eq("id", m.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
    // Recordings (missing before the v1.25 SQL is run) and the points, to catch up on a meeting that was held.
    supabase.from("meeting_recordings").select(RECORDING_COLUMNS).eq("meeting_id", id).order("started_at"),
    held ? supabase.from("meeting_points").select("*").eq("meeting_id", id).order("sort") : Promise.resolve({ data: [] }),
    // A regular meeting still to come: what the one before it decided and gave out.
    ["planned", "live"].includes(m.status) ? loadLastTime(supabase, m) : Promise.resolve(null),
  ]);
  const recordings = (recs.error ? [] : (recs.data ?? [])) as unknown as Recording[];
  const { data: keep } = recs.error ? { data: null } : await supabase.from("meeting_settings").select("recording_days").eq("company_id", company.id).maybeSingle();
  const attendees = (att.data ?? []) as Attendee[];
  const items = (agenda.data ?? []) as AgendaItem[];
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const staff = attendees.filter((a) => a.user_id);
  const guests = attendees.filter((a) => !a.user_id);
  const mine = staff.find((a) => a.user_id === user.id);
  const open = ["planned", "live"].includes(m.status);
  const back = `/meetings/${id}`;
  const doc = held ? buildMinutesDoc(m.minutes_summary, (pts.data ?? []) as Point[], (uid) => nameOf.get(uid)) : null;
  const approved = m.minutes_status === "approved";

  // The one thing to do now, for this person.
  const next: { title: string; text: string; href?: string; label?: string } | null =
    m.status === "cancelled"
      ? null
      : m.status === "live"
        ? { title: tr("The meeting is live"), text: tr("Join to see the video, take notes and follow what is said."), href: `/meetings/${id}/room`, label: tr("Join now") }
        : m.status === "planned"
          ? manage
            ? {
                title: items.length ? tr("Ready when you are") : tr("Plan the agenda"),
                text: items.length ? tr("Open the room a few minutes early and press Start meeting.") : tr("Press Suggest topics to see what your business data says needs attention, or add items below."),
                href: items.length || joinOpen(m) ? `/meetings/${id}/room` : `/meetings/${id}/suggest`,
                label: items.length || joinOpen(m) ? tr("Open the room") : tr("Suggest topics"),
              }
            : { title: tr("Coming up"), text: joinOpen(m) ? tr("The room is open.") : tr("The room opens 15 minutes before the start. You get a notification when it starts."), href: joinOpen(m) ? `/meetings/${id}/room` : undefined, label: tr("Open the room") }
          : approved
            ? { title: tr("Minutes approved"), text: tr("Action owners were told; their actions are under My actions and on the calendar."), href: `/meetings/${id}/minutes`, label: tr("Read the minutes") }
            : m.minutes_status === "ready"
              ? { title: tr("Minutes ready to check"), text: manage ? tr("Read the minutes, correct any point and approve.") : tr("The minutes wait for approval."), href: `/meetings/${id}/minutes`, label: manage ? tr("Check and approve") : tr("Read the minutes") }
              : m.minutes_status === "writing"
                ? { title: tr("The minutes are being written"), text: tr("This usually takes a minute or two."), href: `/meetings/${id}/minutes`, label: tr("Open the minutes") }
                : { title: tr("Write the minutes"), text: tr("The AI writes them from what was said, the recording and the notes."), href: `/meetings/${id}/minutes`, label: manage ? tr("Write the minutes") : tr("Open the minutes") };

  return (
    <>
      <BackLink href="/meetings" label="Meetings" />
      <div className="page-head">
        <h1>{m.title}</h1>
        <span>
          <MeetingBadge m={m} />
        </span>
      </div>
      <MeetingTabs current="" />
      <StageBar m={m} />
      <Notice {...notice} />

      {next && (
        <section className={`card ${styles.nextStep}`}>
          <div>
            <h2>{next.title}</h2>
            <p className="small muted">{next.text}</p>
          </div>
          <div className={styles.nextActions}>
            {next.href && next.label && (
              <Link href={next.href} className="btn btn-primary">
                {next.label}
              </Link>
            )}
            {mine && mine.response === "pending" && open && (
              <form action={respondMeeting} className="inline-form" style={{ gap: 6 }}>
                <input type="hidden" name="id" value={id} />
                <span className="small">{tr("Will you attend?")}</span>
                <SubmitButton className="btn btn-small" name="accept" value="1">
                  {tr("Yes")}
                </SubmitButton>
                <SubmitButton className="btn btn-small" name="accept" value="0">
                  {tr("No")}
                </SubmitButton>
              </form>
            )}
          </div>
        </section>
      )}

      {held && (recordings.length > 0 || (doc && !doc.empty)) && (
        <div className={styles.catchup}>
          <Recordings
            recordings={recordings}
            names={nameOf}
            manage={manage}
            ai={aiReady()}
            transcription={transcriptionReady()}
            back={`/meetings/${id}#recordings`}
            keepDays={Number(keep?.recording_days ?? 30)}
          />
          {doc && !doc.empty && (
            <section className="card">
              <div className="line-head">
                <h2 style={{ margin: 0 }}>{approved ? tr("Minutes") : tr("Draft minutes")}</h2>
                <Link href={`/meetings/${id}/minutes`} className="small">
                  {tr("Full minutes →")}
                </Link>
              </div>
              <MinutesDocument doc={doc} approved={approved} compact />
            </section>
          )}
        </div>
      )}

      <section className="card">
        <dl className="kv">
          <dt>{tr("When")}</dt>
          <dd>{whenRange(m)}</dd>
          <dt>{tr("Kind")}</dt>
          <dd>
            {tr(MEETING_KINDS[m.kind] ?? m.kind)}
            {client.data && (
              <>
                {" · "}
                <Link href={`/clients/${client.data.id}`}>{client.data.name}</Link>
              </>
            )}
            {supplier.data && (
              <>
                {" · "}
                <Link href={`/suppliers/${supplier.data.id}`}>{supplier.data.name}</Link>
              </>
            )}
          </dd>
          {m.place && (
            <>
              <dt>{tr("Place")}</dt>
              <dd>{m.place}</dd>
            </>
          )}
          <dt>{tr("Video")}</dt>
          <dd>
            {m.video_provider === "external" && m.external_link ? (
              <a href={m.external_link} target="_blank" rel="noopener noreferrer">
                {tr("Their meeting link")}
              </a>
            ) : m.video_provider === "none" ? (
              tr("In person")
            ) : (
              tr("Video call in the app")
            )}
          </dd>
          {m.chair_id && (
            <>
              <dt>{tr("Chair")}</dt>
              <dd>{nameOf.get(m.chair_id) ?? ""}</dd>
            </>
          )}
          {m.presenter_id && (
            <>
              <dt>{tr("Presenter")}</dt>
              <dd>{nameOf.get(m.presenter_id) ?? ""}</dd>
            </>
          )}
          {m.topics?.length > 0 && (
            <>
              <dt>{tr("Topics")}</dt>
              <dd>{m.topics.map((t) => tr(t)).join(", ")}</dd>
            </>
          )}
          {m.purpose && (
            <>
              <dt>{tr("Purpose")}</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{m.purpose}</dd>
            </>
          )}
          {m.status === "cancelled" && m.cancel_reason && (
            <>
              <dt>{tr("Why cancelled")}</dt>
              <dd>{m.cancel_reason}</dd>
            </>
          )}
        </dl>
        {manage && open && (
          <div className="inline-form" style={{ marginTop: 10 }}>
            <Link href={`/meetings/${id}/edit`} className="btn btn-small">
              {tr("Change details")}
            </Link>
          </div>
        )}
      </section>

      {last && <LastTime data={last} names={nameOf} today={todayTz()} />}

      <section className="card" id="agenda">
        <div className="line-head">
          <h2 style={{ margin: 0 }}>{tr("Agenda")}</h2>
          {manage && open && (
            <Link href={`/meetings/${id}/suggest`} className="btn btn-small">
              {tr("Suggest topics")}
            </Link>
          )}
        </div>
        {items.length === 0 ? (
          <p className="muted small">{manage ? tr("No agenda yet. Press Suggest topics to see what your business data says needs attention.") : tr("No agenda yet.")}</p>
        ) : (
          <ol style={{ paddingLeft: 20 }}>
            {items.map((a) => (
              <li key={a.id} style={{ margin: "8px 0", textDecoration: a.done ? "line-through" : undefined }}>
                <strong>{a.title}</strong>
                {a.topic && <span className="badge tone-info" style={{ marginLeft: 6 }}>{tr(a.topic)}</span>}
                {a.source !== "manual" && <span className="badge tone-off" style={{ marginLeft: 6 }}>{a.source === "follow_up" ? tr("From last time") : tr("Suggested")}</span>}
                {a.detail && <div className="small muted">{a.detail}</div>}
                {(a.owner_id || a.minutes) && (
                  <div className="small muted">
                    {a.owner_id && `${tr("Leads")}: ${nameOf.get(a.owner_id) ?? ""}`} {a.minutes ? `· ${a.minutes} ${tr("min")}` : ""}
                  </div>
                )}
                {manage && open && (
                  <form action={agendaItem} className="inline-form" style={{ gap: 4, marginTop: 4 }}>
                    <input type="hidden" name="meeting_id" value={id} />
                    <input type="hidden" name="item_id" value={a.id} />
                    <input type="hidden" name="back" value={`${back}#agenda`} />
                    <button className="btn btn-small" name="action" value="up" aria-label={tr("Move up")}>
                      ↑
                    </button>
                    <button className="btn btn-small" name="action" value="down" aria-label={tr("Move down")}>
                      ↓
                    </button>
                    <button className="btn btn-small" name="action" value={a.done ? "undone" : "done"}>
                      {a.done ? tr("Not done") : tr("Done")}
                    </button>
                    <button className="btn btn-small" name="action" value="remove">
                      {tr("Remove")}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ol>
        )}
        {manage && open && (
          <details>
            <summary>{tr("+ Add an item")}</summary>
            <form action={addAgendaItem}>
              <input type="hidden" name="meeting_id" value={id} />
              <label className="field">
                <span>{tr("Item")}</span>
                <input name="title" required minLength={2} maxLength={300} />
              </label>
              <label className="field">
                <span>{tr("Details")}</span>
                <input name="detail" maxLength={1000} />
              </label>
              <div className="inline-form">
                <label className="field">
                  <span>{tr("Topic")}</span>
                  <select name="topic" defaultValue="">
                    <option value="">{tr("None")}</option>
                    {MEETING_TOPICS.map((t) => (
                      <option key={t} value={t}>
                        {tr(t)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{tr("Who leads it")}</span>
                  <select name="owner_id" defaultValue="">
                    <option value="">{tr("Not set")}</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{tr("Minutes")}</span>
                  <input type="number" name="minutes" min={1} max={240} />
                </label>
              </div>
              <SubmitButton className="btn btn-small btn-primary">{tr("Add")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      <section className="card" id="people">
        <h2>{tr("Team")}</h2>
        {m.open_to_team && <p className="small muted">{tr("Open to the whole team: anyone in the company can join.")}</p>}
        <ul className="rec-list">
          {staff.map((a) => (
            <li key={a.id}>
              <div className="line-head">
                <span>
                  {nameOf.get(a.user_id!) ?? tr("Former member")}
                  <span className="small muted"> · {tr(a.role === "chair" ? "Chair" : a.role === "presenter" ? "Presenter" : ROLE_LABELS[(people.find((p) => p.id === a.user_id)?.role ?? "sales") as Role] ?? "")}</span>
                </span>
                <span className={`badge tone-${a.joined_at ? "ok" : a.response === "declined" ? "off" : a.response === "accepted" ? "info" : "warn"}`}>
                  {a.joined_at ? `${tr("Joined")} ${formatDateTime(a.joined_at).slice(-5)}` : a.response === "declined" ? tr("Declined") : a.response === "accepted" ? tr("Coming") : tr("Not answered")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" id="guests">
        <h2>{tr("Guests")}</h2>
        {guests.length === 0 && <p className="muted small">{tr("No guests. Add the client's or supplier's people: they get a private link to join without an account.")}</p>}
        <ul className="rec-list">
          {guests.map((g) => (
            <li key={g.id}>
              <div className="line-head">
                <span>
                  <strong>{g.guest_name}</strong>
                  {g.guest_org && <span className="small muted"> · {g.guest_org}</span>}
                </span>
                <span className={`badge tone-${g.joined_at ? "ok" : "off"}`}>{g.joined_at ? `${tr("Joined")} ${formatDateTime(g.joined_at).slice(-5)}` : tr("Not joined")}</span>
              </div>
              <div className="small muted">{[g.guest_email, g.guest_phone ? `+${g.guest_phone}` : null].filter(Boolean).join(" · ")}</div>
              {manage && open && (
                <div style={{ marginTop: 6 }}>
                  <GuestLinkButtons attendeeId={g.id} hasEmail={!!g.guest_email} hasPhone={!!g.guest_phone} />
                  {!g.joined_at && (
                    <form action={removeAttendee} style={{ marginTop: 6 }}>
                      <input type="hidden" name="meeting_id" value={id} />
                      <input type="hidden" name="attendee_id" value={g.id} />
                      <SubmitButton className="btn btn-small">{tr("Remove")}</SubmitButton>
                    </form>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {manage && open && (
          <details open={guests.length === 0 && m.kind !== "internal"}>
            <summary>{tr("+ Add a guest")}</summary>
            <form action={addGuest}>
              <input type="hidden" name="meeting_id" value={id} />
              <label className="field">
                <span>{tr("Name")}</span>
                <input name="name" required minLength={2} maxLength={120} />
              </label>
              <div className="inline-form">
                <label className="field">
                  <span>{tr("Email")}</span>
                  <input type="email" name="email" maxLength={200} />
                </label>
                <label className="field">
                  <span>{tr("Phone (WhatsApp)")}</span>
                  <input type="tel" name="phone" maxLength={20} placeholder="0754 123 456" />
                </label>
              </div>
              <label className="field">
                <span>{tr("Company")}</span>
                <input name="org" maxLength={160} defaultValue={client.data?.name ?? supplier.data?.name ?? ""} />
              </label>
              <SubmitButton className="btn btn-small btn-primary">{tr("Add guest")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      {manage && m.status === "planned" && (
        <details className="card">
          <summary>{tr("Cancel this meeting")}</summary>
          <form action={cancelMeeting}>
            <input type="hidden" name="id" value={id} />
            <label className="field">
              <span>{tr("Why (everyone invited is told)")}</span>
              <input name="reason" maxLength={500} />
            </label>
            <SubmitButton className="btn btn-small">{tr("Cancel the meeting")}</SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}
