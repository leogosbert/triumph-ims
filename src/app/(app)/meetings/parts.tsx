import Link from "next/link";
import { tr } from "@/lib/tr";
import { formatWhen, toLocalInput } from "@/lib/services";
import { LANGUAGES, MEETING_KINDS, MEETING_STATUS, MEETING_TOPICS, meetingStage, MINUTES_STATUS, type Meeting } from "@/lib/meetings/model";
import { SubmitButton } from "@/components/SubmitButton";
import styles from "./meetings.module.css";

const TABS = [
  { href: "/meetings", label: "Upcoming" },
  { href: "/meetings?tab=held", label: "Held" },
  { href: "/meetings/invitations", label: "Invitations" },
  { href: "/meetings/actions", label: "My actions" },
  { href: "/meetings/series", label: "Regular meetings" },
  { href: "/calendar", label: "Calendar" },
] as const;

/** The tabs of the Meetings area. */
export function MeetingTabs({ current, invitations = true }: { current: string; invitations?: boolean }) {
  return (
    <nav className="tabs-row" aria-label={tr("Meetings")}>
      {TABS.filter((t) => invitations || t.href !== "/meetings/invitations").map((t) => (
        <Link key={t.href} href={t.href} aria-current={t.href === current ? "page" : undefined}>
          {tr(t.label)}
        </Link>
      ))}
    </nav>
  );
}

export function MeetingBadge({ m }: { m: Pick<Meeting, "status" | "minutes_status"> }) {
  const s = MEETING_STATUS[m.status] ?? { label: m.status, tone: "off" };
  return (
    <>
      <span className={`badge tone-${s.tone}`}>
        {m.status === "live" && <span className={styles.liveDot} aria-hidden="true" />}
        {tr(s.label)}
      </span>
      {m.status === "held" && m.minutes_status !== "approved" && (
        <span className={`badge tone-${MINUTES_STATUS[m.minutes_status]?.tone ?? "off"}`}>{tr(MINUTES_STATUS[m.minutes_status]?.label ?? m.minutes_status)}</span>
      )}
    </>
  );
}

/** One meeting in a list. */
export function MeetingRow({ m, names }: { m: Meeting; names: Map<string, string> }) {
  const video = m.video_provider === "external" ? tr("Their link") : m.video_provider === "none" ? null : tr("Video in the app");
  return (
    <li>
      <Link href={m.status === "live" ? `/meetings/${m.id}/room` : `/meetings/${m.id}`}>
        <div className="line-head">
          <strong>{m.title}</strong>
          <span>
            <MeetingBadge m={m} />
          </span>
        </div>
        <div className={styles.meta}>
          <span className={styles.when}>{formatWhen(m.starts_at)}</span>
          <span>{tr(MEETING_KINDS[m.kind] ?? m.kind)}</span>
          {m.place && <span>{m.place}</span>}
          {video && <span>{video}</span>}
          {m.chair_id && (
            <span>
              {tr("Chair")}: {names.get(m.chair_id) ?? ""}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

type Person = { id: string; name: string; role: string };
type Named = { id: string; name: string };

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

/** The new / edit meeting form: the essentials first, everything else under "More options". */
export function MeetingForm({
  action,
  people,
  clients,
  suppliers,
  m,
  attendees,
  me,
}: {
  action: (form: FormData) => Promise<void>;
  people: Person[];
  clients: Named[];
  suppliers: Named[];
  m?: Meeting;
  attendees?: string[];
  me: string;
}) {
  const chosen = new Set(attendees ?? []);
  const durations = m && !DURATIONS.includes(m.minutes) ? [...DURATIONS, m.minutes].sort((a, b) => a - b) : DURATIONS;
  const others = people.filter((p) => p.id !== me);
  return (
    <form action={action} className="card">
      {m && <input type="hidden" name="id" value={m.id} />}
      <label className="field">
        <span>{tr("What is the meeting about?")}</span>
        <input name="title" required minLength={2} maxLength={160} defaultValue={m?.title ?? ""} placeholder={tr("e.g. Weekly sales meeting")} />
      </label>
      <div className={styles.formRow}>
        <label className="field">
          <span>{tr("Date and time")}</span>
          <input type="datetime-local" name="starts_at" required defaultValue={m ? toLocalInput(m.starts_at) : ""} />
        </label>
        <label className="field">
          <span>{tr("How long")}</span>
          <select name="minutes" defaultValue={String(m?.minutes ?? 30)}>
            {durations.map((d) => (
              <option key={d} value={d}>
                {d < 60 ? `${d} ${tr("min")}` : d % 60 ? `${Math.floor(d / 60)} h ${d % 60} ${tr("min")}` : `${d / 60} h`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        <span>{tr("Where")}</span>
        <input name="place" maxLength={200} defaultValue={m?.place ?? ""} placeholder={tr("Office, site, or leave empty for a video call in the app")} />
      </label>
      {others.length > 0 && (
        <fieldset className="field">
          <legend>{tr("Who attends")}</legend>
          <div className={styles.chips}>
            {others.map((p) => (
              <label key={p.id} className={styles.chip}>
                <input type="checkbox" name="attendees" value={p.id} defaultChecked={chosen.has(p.id)} /> {p.name}
              </label>
            ))}
          </div>
          <p className="small muted">{tr("You attend the meetings you organise. Add client or supplier guests on the meeting page.")}</p>
        </fieldset>
      )}

      <details className={styles.more} open={!!m && (m.kind !== "internal" || !!m.external_link)}>
        <summary>{tr("More options: client or supplier, their video link, topics, chair, language")}</summary>
        <div className={styles.formRow}>
          <label className="field">
            <span>{tr("Kind")}</span>
            <select name="kind" defaultValue={m?.kind ?? "internal"}>
              {Object.entries(MEETING_KINDS).map(([k, l]) => (
                <option key={k} value={k}>
                  {tr(l)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{tr("Client")}</span>
            <select name="client_id" defaultValue={m?.client_id ?? ""}>
              <option value="">{tr("None")}</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{tr("Supplier")}</span>
            <select name="supplier_id" defaultValue={m?.supplier_id ?? ""}>
              <option value="">{tr("None")}</option>
              {suppliers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>{tr("Their meeting link (Zoom, Teams, Google Meet), if they host it")}</span>
          <input type="url" name="external_link" maxLength={500} defaultValue={m?.external_link ?? ""} placeholder="https://" />
        </label>
        <label className="field">
          <span>{tr("Purpose")}</span>
          <textarea name="purpose" rows={2} maxLength={2000} defaultValue={m?.purpose ?? ""} />
        </label>
        <fieldset className="field">
          <legend>{tr("Topics")}</legend>
          <div className={styles.chips}>
            {MEETING_TOPICS.map((t) => (
              <label key={t} className={styles.chip}>
                <input type="checkbox" name="topics" value={t} defaultChecked={m?.topics?.includes(t)} /> {tr(t)}
              </label>
            ))}
          </div>
        </fieldset>
        <div className={styles.formRow}>
          <label className="field">
            <span>{tr("Chair")}</span>
            <select name="chair_id" defaultValue={m?.chair_id ?? ""}>
              <option value="">{tr("Not set")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{tr("Presenter")}</span>
            <select name="presenter_id" defaultValue={m?.presenter_id ?? ""}>
              <option value="">{tr("Not set")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.formRow}>
          <label className="field">
            <span>{tr("Language spoken")}</span>
            <select name="language" defaultValue={m?.language ?? "both"}>
              {Object.entries(LANGUAGES).map(([k, l]) => (
                <option key={k} value={k}>
                  {tr(l)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{tr("Who can see it")}</span>
            <select name="open_to_team" defaultValue={m ? (m.open_to_team ? "1" : "0") : "1"}>
              <option value="1">{tr("The whole team")}</option>
              <option value="0">{tr("Only the people invited")}</option>
            </select>
          </label>
          <label className="field">
            <span>{tr("Write down what is said")}</span>
            <select name="record" defaultValue={m ? (m.record ? "1" : "0") : "1"}>
              <option value="1">{tr("Yes (everyone is told first)")}</option>
              <option value="0">{tr("No, typed notes only")}</option>
            </select>
          </label>
        </div>
      </details>
      <SubmitButton className="btn btn-primary">{m ? tr("Save") : tr("Plan the meeting")}</SubmitButton>
    </form>
  );
}

const STAGES = ["Plan", "Meet", "Minutes", "Follow up"] as const;

/** Where the meeting is: plan, meet, minutes, follow up (the current stage is marked). */
export function StageBar({ m }: { m: Pick<Meeting, "status" | "minutes_status"> }) {
  if (m.status === "cancelled") return null;
  const at = meetingStage(m);
  return (
    <ol className={styles.stages} aria-label={tr("Meeting progress")}>
      {STAGES.map((s, i) => (
        <li key={s} className={i < at ? styles.stageDone : i === at ? styles.stageNow : ""} aria-current={i === at ? "step" : undefined}>
          <span className={styles.stageNum} aria-hidden="true">
            {i < at ? "✓" : i + 1}
          </span>
          {tr(s)}
        </li>
      ))}
    </ol>
  );
}

/** "Mon 3 Nov, 09:00 – 09:30". */
export function whenRange(m: Pick<Meeting, "starts_at" | "minutes">): string {
  const f = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", ...opts }).format(d);
  const a = new Date(m.starts_at);
  const b = new Date(a.getTime() + m.minutes * 60_000);
  return `${f(a, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}, ${f(a, { hour: "2-digit", minute: "2-digit", hour12: false })} – ${f(b, { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}
