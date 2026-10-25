import Link from "next/link";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { todayTz } from "@/lib/services";
import { POINT_STATUS, type Point } from "@/lib/meetings/model";
import { setPointStatus } from "../actions";
import { MeetingTabs } from "../parts";
import styles from "../meetings.module.css";

export const metadata = { title: "My actions" };

type Row = Point & { meeting: { id: string; title: string; meeting_date: string } | null };

export default async function MyActionsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const sp = (await searchParams) ?? {};
  const { supabase, company, user, isManager } = await getAppContext();
  const everyone = isManager && sp.who === "all";
  const showDone = sp.show === "done";
  let q = supabase
    .from("meeting_points")
    .select("*, meeting:meetings(id, title, meeting_date)")
    .eq("company_id", company.id)
    .eq("approved", true)
    .in("kind", ["action", "issue"])
    .in("status", showDone ? ["done", "cancelled"] : ["open", "in_progress"])
    .order("due_on", { ascending: true, nullsFirst: false })
    .limit(200);
  if (!everyone) q = q.eq("owner_id", user.id);
  const { data, error } = await q;
  if (isMissingTable(error)) return <NotReady title="Meetings" />;
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => everyone || r.kind === "action" || r.owner_id === user.id);
  const names = await namesFor(supabase, rows.map((r) => r.owner_id));
  const today = todayTz();
  const back = `/meetings/actions${everyone || showDone ? `?${new URLSearchParams({ ...(everyone ? { who: "all" } : {}), ...(showDone ? { show: "done" } : {}) })}` : ""}`;

  return (
    <>
      <div className="page-head">
        <h1>{everyone ? tr("Open actions") : tr("My actions")}</h1>
      </div>
      <MeetingTabs current="/meetings/actions" />
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/meetings/actions" aria-current={!everyone && !showDone ? "page" : undefined}>
          {tr("Mine, open")}
        </Link>
        <Link href="/meetings/actions?show=done" aria-current={!everyone && showDone ? "page" : undefined}>
          {tr("Mine, done")}
        </Link>
        {isManager && (
          <Link href="/meetings/actions?who=all" aria-current={everyone && !showDone ? "page" : undefined}>
            {tr("Everyone's open actions")}
          </Link>
        )}
      </nav>
      <section className="card">
        {rows.length === 0 ? (
          <p className="muted">{showDone ? tr("Nothing done yet.") : tr("No open actions. Actions from approved minutes show here.")}</p>
        ) : (
          <ul className="rec-list">
            {rows.map((r) => {
              const late = r.due_on && r.due_on < today && (r.status === "open" || r.status === "in_progress");
              return (
                <li key={r.id}>
                  <div className="line-head">
                    <span>
                      <span className={styles.pointKind}>{tr(r.kind === "issue" ? "Issue" : "Action")}</span> {r.body}
                    </span>
                    <span className={`badge tone-${late ? "bad" : POINT_STATUS[r.status]?.tone}`}>{late ? tr("Overdue") : tr(POINT_STATUS[r.status]?.label ?? r.status)}</span>
                  </div>
                  <div className={styles.meta}>
                    {r.due_on && (
                      <span>
                        {tr("Due")} {formatDate(r.due_on)}
                      </span>
                    )}
                    {everyone && <span>{r.owner_id ? names.get(r.owner_id) : (r.owner_name ?? tr("No owner"))}</span>}
                    {r.meeting && <Link href={`/meetings/${r.meeting.id}/minutes`}>{r.meeting.title}</Link>}
                  </div>
                  {r.done_note && <div className="small muted">{r.done_note}</div>}
                  {!showDone && (r.owner_id === user.id || isManager) && (
                    <form action={setPointStatus} className="inline-form" style={{ gap: 6, marginTop: 6 }}>
                      <input type="hidden" name="point_id" value={r.id} />
                      <input type="hidden" name="back" value={back} />
                      <input name="note" placeholder={tr("What was done (optional)")} maxLength={1000} style={{ flex: "1 1 180px" }} />
                      {r.status === "open" && (
                        <SubmitButton className="btn btn-small" name="status" value="in_progress">
                          {tr("Started")}
                        </SubmitButton>
                      )}
                      <SubmitButton className="btn btn-small btn-primary" name="status" value="done">
                        {tr("Done")}
                      </SubmitButton>
                      {isManager && (
                        <SubmitButton className="btn btn-small" name="status" value="cancelled">
                          {tr("Drop")}
                        </SubmitButton>
                      )}
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="small muted">{tr("Open actions come back on the agenda of the next meeting until they are done.")}</p>
    </>
  );
}
