import Link from "next/link";
import { tr } from "@/lib/tr";
import { formatDate } from "@/lib/format";
import type { getAppContext } from "@/lib/context";
import { POINT_STATUS, type Meeting, type Point } from "@/lib/meetings/model";
import styles from "./meetings.module.css";

type Supabase = Awaited<ReturnType<typeof getAppContext>>["supabase"];

export type LastTimeData = {
  meeting: Pick<Meeting, "id" | "title" | "meeting_date" | "minutes_status">;
  points: Point[];
};

/**
 * "Last time": for a regular meeting (one of a series), the meeting of the same series that was held
 * before it, with what it decided, the actions it gave out (as they stand today) and the issues left open.
 * Only approved minutes count, as everywhere else; null when there is no earlier meeting.
 */
export async function loadLastTime(supabase: Supabase, m: Pick<Meeting, "id" | "series_id" | "meeting_date">): Promise<LastTimeData | null> {
  if (!m.series_id) return null;
  const { data: prev } = await supabase
    .from("meetings")
    .select("id, title, meeting_date, minutes_status")
    .eq("series_id", m.series_id)
    .eq("status", "held")
    .lt("meeting_date", m.meeting_date)
    .neq("id", m.id)
    .order("meeting_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prev) return null;
  const meeting = prev as LastTimeData["meeting"];
  if (meeting.minutes_status !== "approved") return { meeting, points: [] };
  const { data: pts } = await supabase
    .from("meeting_points")
    .select("*")
    .eq("meeting_id", meeting.id)
    .eq("approved", true)
    .in("kind", ["decision", "action", "issue"])
    .order("sort")
    .limit(60);
  return { meeting, points: (pts ?? []) as Point[] };
}

/** The "Last time" card. `today` marks overdue actions; `names` turns owner ids into names. */
export function LastTime({ data, names, today, compact = false }: { data: LastTimeData; names: Map<string, string>; today: string; compact?: boolean }) {
  const { meeting, points } = data;
  const decisions = points.filter((p) => p.kind === "decision");
  const actions = points.filter((p) => p.kind === "action");
  const issues = points.filter((p) => p.kind === "issue" && (p.status === "open" || p.status === "in_progress"));
  const doneCount = actions.filter((p) => p.status === "done").length;
  const owner = (p: Point) => (p.owner_id ? names.get(p.owner_id) : p.owner_name) ?? null;

  const body =
    meeting.minutes_status !== "approved" ? (
      <p className="muted small">
        {tr("The minutes of the last meeting are not approved yet.")} <Link href={`/meetings/${meeting.id}/minutes`}>{tr("Open them →")}</Link>
      </p>
    ) : points.length === 0 ? (
      <p className="muted small">{tr("Nothing was decided or given out at the last meeting.")}</p>
    ) : (
      <>
        {decisions.length > 0 && (
          <>
            <h3 className={styles.lastHead}>{tr("What we decided")}</h3>
            <ul className={styles.lastList}>
              {decisions.map((p) => (
                <li key={p.id}>{p.body}</li>
              ))}
            </ul>
          </>
        )}
        {actions.length > 0 && (
          <>
            <h3 className={styles.lastHead}>
              {tr("Actions")} <span className="muted small">{`${doneCount} / ${actions.length} ${tr("done")}`}</span>
            </h3>
            <ul className="rec-list">
              {actions.map((p) => {
                const late = !!p.due_on && p.due_on < today && (p.status === "open" || p.status === "in_progress");
                return (
                  <li key={p.id}>
                    <div className="line-head">
                      <span>{p.body}</span>
                      <span className={`badge tone-${late ? "bad" : (POINT_STATUS[p.status]?.tone ?? "off")}`}>{late ? tr("Overdue") : tr(POINT_STATUS[p.status]?.label ?? p.status)}</span>
                    </div>
                    {(owner(p) || p.due_on || p.done_note) && (
                      <div className={styles.meta}>
                        {owner(p) && <span>{owner(p)}</span>}
                        {p.due_on && (
                          <span>
                            {tr("Due")} {formatDate(p.due_on)}
                          </span>
                        )}
                        {p.done_note && <span>{p.done_note}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {issues.length > 0 && (
          <>
            <h3 className={styles.lastHead}>{tr("Issues still open")}</h3>
            <ul className={styles.lastList}>
              {issues.map((p) => (
                <li key={p.id}>{p.body}</li>
              ))}
            </ul>
          </>
        )}
      </>
    );

  const title = (
    <>
      {tr("Last time")} <span className="muted small">· {formatDate(meeting.meeting_date)}</span>
    </>
  );
  const more = (
    <Link href={`/meetings/${meeting.id}/minutes`} className="small">
      {tr("Full minutes →")}
    </Link>
  );

  if (compact) {
    return (
      <details className="card" id="last-time">
        <summary>
          <strong>{title}</strong>
        </summary>
        {body}
        <p style={{ marginBottom: 0 }}>{more}</p>
      </details>
    );
  }
  return (
    <section className="card" id="last-time">
      <div className="line-head">
        <h2 style={{ margin: 0 }}>{title}</h2>
        {more}
      </div>
      {body}
    </section>
  );
}
