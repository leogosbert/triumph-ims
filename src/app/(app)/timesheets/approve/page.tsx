import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext, noAccess } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/format";
import { WEEK_STATUS } from "@/lib/hr";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { addDays, hoursText } from "../week";
import { decideWeek, reopenWeek } from "./actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Approve timesheets" };

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TABS = [
  { key: "waiting", status: "submitted", label: "Waiting" },
  { key: "returned", status: "returned", label: "Sent back" },
  { key: "approved", status: "approved", label: "Approved" },
];

type Week = { id: string; user_id: string; week_start: string; status: string; hours: number; submitted_at: string; decided_by: string | null; decided_at: string | null; note: string | null };
type Line = {
  id: string;
  user_id: string;
  work_date: string;
  hours: number;
  billable: boolean;
  description: string | null;
  project: { number: string; name: string } | null;
  job: { number: string; title: string } | null;
  client: { name: string } | null;
};

function what(l: Line): string {
  if (l.job) return `${l.job.number} · ${l.job.title}`;
  if (l.project) return `${l.project.number} · ${l.project.name}`;
  if (l.client) return l.client.name;
  return tr("Internal work");
}

export default async function ApproveTimesheetsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!can(roles, "manageHr")) noAccess();
  const tab = TABS.find((t) => t.key === pick(sp.tab)) ?? TABS[0];
  const back = tab.key === "waiting" ? "/timesheets/approve" : `/timesheets/approve?tab=${tab.key}`;

  const { data, error } = await supabase
    .from("timesheet_weeks")
    .select("id, user_id, week_start, status, hours, submitted_at, decided_by, decided_at, note")
    .eq("company_id", company.id)
    .eq("status", tab.status)
    .order("week_start", { ascending: tab.key === "waiting" })
    .limit(100);
  if (isMissingTable(error)) return <NotReady title="Approve timesheets" />;
  if (error) throw new Error(error.message);
  const weeks = (data ?? []) as Week[];

  // The lines of every week shown, in one request.
  let lines: Line[] = [];
  if (weeks.length) {
    const starts = weeks.map((w) => w.week_start).sort();
    const { data: lineData } = await supabase
      .from("timesheets")
      .select("id, user_id, work_date, hours, billable, description, project:projects(number, name), job:service_jobs(number, title), client:clients(name)")
      .eq("company_id", company.id)
      .in("user_id", [...new Set(weeks.map((w) => w.user_id))])
      .gte("work_date", starts[0])
      .lte("work_date", addDays(starts[starts.length - 1], 6))
      .order("work_date")
      .order("created_at")
      .limit(5000);
    lines = (lineData ?? []) as unknown as Line[];
  }
  const names = await namesFor(supabase, weeks.flatMap((w) => [w.user_id, w.decided_by]));

  return (
    <>
      <BackLink href="/timesheets" label="Timesheets" />
      <h1>{tr("Approve timesheets")}</h1>
      <p className="muted small">{tr("Check each week and approve it, or send it back with a note. Approved weeks are locked.")}</p>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === "waiting" ? "/timesheets/approve" : `/timesheets/approve?tab=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined}>
            {tr(t.label)}
          </Link>
        ))}
      </nav>
      {weeks.length === 0 ? (
        <p className="card muted">{tab.key === "waiting" ? tr("No weeks waiting for approval.") : tr("No weeks here.")}</p>
      ) : (
        <section className="card">
          <ul className="lines">
            {weeks.map((w) => {
              const sunday = addDays(w.week_start, 6);
              const list = lines.filter((l) => l.user_id === w.user_id && l.work_date >= w.week_start && l.work_date <= sunday);
              const now = list.reduce((s, l) => s + Number(l.hours), 0);
              const billable = list.filter((l) => l.billable).reduce((s, l) => s + Number(l.hours), 0);
              return (
                <li key={w.id}>
                  <details>
                    <summary>
                      <span className="line-head" style={{ display: "inline-flex", width: "calc(100% - 24px)" }}>
                        <span>
                          <span className="desc">{names.get(w.user_id) ?? tr("Former member")}</span>
                          <span className="muted small" style={{ display: "block" }}>
                            {formatDate(w.week_start)} – {formatDate(sunday)}
                          </span>
                        </span>
                        <strong style={{ whiteSpace: "nowrap" }}>{hoursText(Number(w.hours))} h</strong>
                      </span>
                    </summary>
                    <p className="muted small">
                      <StatusBadge map={WEEK_STATUS} status={w.status} /> {tr("Submitted")} {formatDateTime(w.submitted_at)}
                      {w.decided_at && ` · ${w.decided_by ? (names.get(w.decided_by) ?? "") : ""} ${formatDateTime(w.decided_at)}`}
                      {` · ${tr("Billable")} ${hoursText(billable)} h`}
                    </p>
                    {w.note && (
                      <p className="banner warn small">
                        {tr("Note")}: {w.note}
                      </p>
                    )}
                    {Math.abs(now - Number(w.hours)) > 0.001 && (
                      <p className="banner warn small">
                        {tr("The hours have changed since the week was submitted. Hours now:")} {hoursText(now)} h
                      </p>
                    )}
                    {list.length === 0 ? (
                      <p className="muted small">{tr("No hours recorded this week.")}</p>
                    ) : (
                      <ul className="lines">
                        {list.map((l) => (
                          <li key={l.id} className="small">
                            <div className="line-head">
                              <span>
                                {formatDate(l.work_date)} · {what(l)}
                                {l.description && <span className="muted"> · {l.description}</span>}
                                <span className="muted"> · {l.billable ? tr("billable") : tr("not billable")}</span>
                              </span>
                              <strong style={{ whiteSpace: "nowrap" }}>{hoursText(Number(l.hours))} h</strong>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    {w.status === "submitted" && (
                      <form action={decideWeek} style={{ marginTop: 8 }}>
                        <input type="hidden" name="week_id" value={w.id} />
                        <input type="hidden" name="back" value={back} />
                        <div className="field">
                          <input name="note" type="text" maxLength={500} placeholder={tr("What needs to change (needed to send back)")} aria-label={tr("Note")} />
                        </div>
                        <div className="actions-bar" style={{ marginBottom: 0 }}>
                          <SubmitButton className="btn btn-small btn-primary" name="decision" value="approve" pendingText={tr("Saving…")}>
                            {tr("Approve")}
                          </SubmitButton>
                          <SubmitButton className="btn btn-small" name="decision" value="return" pendingText={tr("Saving…")}>
                            {tr("Send back")}
                          </SubmitButton>
                        </div>
                      </form>
                    )}
                    {w.status === "approved" && (
                      <form action={reopenWeek} style={{ marginTop: 8 }}>
                        <input type="hidden" name="week_id" value={w.id} />
                        <input type="hidden" name="back" value={back} />
                        <SubmitButton className="btn btn-small" pendingText={tr("Saving…")}>
                          {tr("Open again")}
                        </SubmitButton>
                      </form>
                    )}
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
