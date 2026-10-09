import { tr } from "@/lib/tr";
import Link from "next/link";
import { activityKind } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import type { ActivityRow } from "./ActivityForm";

/** Calls, visits and messages, newest first. */
export function Timeline({ rows, names, oppTitles }: { rows: ActivityRow[]; names: Map<string, string>; oppTitles?: Map<string, string> }) {
  if (rows.length === 0) return <p className="muted small">{tr("Nothing logged yet.")}</p>;
  return (
    <ul className="timeline">
      {rows.map((a) => {
        const k = activityKind(a.kind);
        return (
          <li key={a.id}>
            <div className="small muted">
              {k.icon} {tr(k.label)} · {formatDate(a.happened_on)}
              {a.created_by && names.get(a.created_by) && ` · ${names.get(a.created_by)}`}
              {a.location && ` · ${a.location}`}
              {oppTitles && a.opportunity_id && oppTitles.get(a.opportunity_id) && (
                <>
                  {" · "}
                  <Link href={`/crm/${a.opportunity_id}`}>{oppTitles.get(a.opportunity_id)}</Link>
                </>
              )}
            </div>
            <div style={{ whiteSpace: "pre-wrap" }}>{a.summary}</div>
            {(a.next_action || a.next_on) && (
              <div className="small">
                → {a.next_action ?? tr("Next step")}
                {a.next_on && ` · ${formatDate(a.next_on)}`}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
