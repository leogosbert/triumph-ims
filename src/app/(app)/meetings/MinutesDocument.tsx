import { tr } from "@/lib/tr";
import { formatDue, type MinutesDoc } from "@/lib/meetings/minutes-format";
import { POINT_STATUS } from "@/lib/meetings/model";
import styles from "./meetings.module.css";

/**
 * The minutes as a readable document: the opening summary, one section per agenda item (discussion, then what was
 * decided and why), the action items as a table with owner and due date, issues and risks, the next meeting, and
 * the Kiswahili summary when one was asked for.
 */
export function MinutesDocument({ doc, approved, compact = false }: { doc: MinutesDoc; approved: boolean; compact?: boolean }) {
  if (doc.empty) return null;
  return (
    <div className={styles.doc}>
      {doc.opening.length > 0 && (
        <>
          <h3>{tr("Summary")}</h3>
          {doc.opening.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </>
      )}
      {!compact &&
        doc.sections.map((s, i) => (
          <div key={i}>
            <h3>
              {i + 1}. {s.title}
            </h3>
            {s.discussion.map((p, k) => (
              <p key={k}>{p}</p>
            ))}
            {s.decisions.length > 0 && (
              <div className={styles.docDecided}>
                <strong>{tr("Decided")}:</strong> {s.decisions.join(" ")}
              </div>
            )}
          </div>
        ))}

      {doc.actions.length > 0 && (
        <>
          <h3>{tr("Action items")}</h3>
          <div className={styles.tableWrap}>
            <table className={styles.actionTable}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>{tr("What")}</th>
                  <th>{tr("Who")}</th>
                  <th>{tr("By when")}</th>
                  {approved && <th>{tr("Status")}</th>}
                </tr>
              </thead>
              <tbody>
                {doc.actions.map((a) => (
                  <tr key={a.n}>
                    <td>{a.n}</td>
                    <td>
                      {a.what}
                      {a.uncertain && <span className="badge tone-warn" style={{ marginLeft: 6 }}>{tr("to confirm")}</span>}
                    </td>
                    <td>{a.owner ? `${a.owner}${a.matched ? "" : ` (${tr("not matched")})`}` : <span className="muted">{tr("Not set")}</span>}</td>
                    <td>{a.due ? formatDue(a.due) : <span className="muted">{tr("No date")}</span>}</td>
                    {approved && <td>{tr(POINT_STATUS[a.status]?.label ?? a.status)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {!compact && doc.decisions.length > 0 && (
        <>
          <h3>{tr("Decisions")}</h3>
          <ul>
            {doc.decisions.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </>
      )}
      {!compact && (doc.issues.length > 0 || doc.risks.length > 0) && (
        <>
          <h3>{tr("Issues and risks")}</h3>
          <ul>
            {doc.issues.map((x, i) => (
              <li key={`i${i}`}>
                {x.text}
                {x.severity && <span className={`badge tone-${x.severity === "high" ? "bad" : x.severity === "medium" ? "warn" : "off"}`} style={{ marginLeft: 6 }}>{tr(x.severity)}</span>}
              </li>
            ))}
            {doc.risks.map((r, i) => (
              <li key={`r${i}`}>{r}</li>
            ))}
          </ul>
        </>
      )}
      {doc.nextMeeting.length > 0 && (
        <>
          <h3>{tr("Next meeting")}</h3>
          {doc.nextMeeting.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </>
      )}
      {!compact && doc.suggestions.length > 0 && (
        <>
          <h3>{tr("Suggestions")}</h3>
          <ul>
            {doc.suggestions.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </>
      )}
      {doc.swahili.length > 0 && (
        <div className={styles.docSw} lang="sw">
          <h3>Muhtasari kwa Kiswahili</h3>
          {doc.swahili.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
      )}
      {!compact && doc.unclear.length > 0 && (
        <>
          <h3>{tr("Not clear in the recording")}</h3>
          <ul className="small">
            {doc.unclear.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </>
      )}
      {!compact && doc.languageNote && <p className="small muted">{doc.languageNote}</p>}
    </div>
  );
}
