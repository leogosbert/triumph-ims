import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { findReport } from "@/lib/reports/defs";
import { TimingFields } from "@/components/reports/TimingFields";
import { WEEKDAYS } from "@/lib/schedules";
import { updateSchedule } from "./actions";

export const metadata = { title: "Scheduled reports" };

type Schedule = { id: string; name: string; report_key: string; query: string; frequency: string; weekday: number | null; active: boolean; last_sent_on: string | null };

export default async function ScheduledReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, user } = await getAppContext();
  const { data, error } = await supabase
    .from("report_schedules")
    .select("id, name, report_key, query, frequency, weekday, active, last_sent_on")
    .eq("company_id", company.id)
    .eq("user_id", user.id)
    .order("created_at");
  if (isMissingTable(error)) return <NotReady title="Scheduled reports" />;
  if (error) throw new Error(error.message);
  const list = (data ?? []) as Schedule[];
  const when = (s: Schedule) =>
    s.frequency === "weekly" ? `${tr("Every")} ${tr(WEEKDAYS[(s.weekday ?? 1) - 1])}` : tr(s.frequency === "daily" ? "Every day" : "Every month, on the 1st");

  return (
    <>
      <p className="small">
        <Link href="/reports">{tr("← Reports")}</Link>
      </p>
      <h1>{tr("Scheduled reports")}</h1>
      <p className="muted small">
        {tr("Reports sent to you by themselves: an alert in the app and an email (if you have emails on), from 7 in the morning, with a link to the report for the period just ended.")}
      </p>
      <Notice {...notice} />
      {list.length === 0 ? (
        <p className="card muted">
          {tr("Nothing scheduled yet. Open a report, set its filters, then choose “Email me this report”.")} <Link href="/reports">{tr("Reports")}</Link>
        </p>
      ) : (
        <ul className="list card">
          {list.map((s) => {
            const def = findReport(s.report_key);
            return (
              <li key={s.id}>
                <div className="line-head">
                  <div>
                    <strong>{s.name}</strong>
                    {!s.active && <span className="muted small"> · {tr("Paused")}</span>}
                    <div className="muted small">
                      {def ? tr(def.title) : s.report_key} · {when(s)}
                      {s.last_sent_on && ` · ${tr("last sent")} ${formatDate(s.last_sent_on)}`}
                    </div>
                  </div>
                  <Link className="btn btn-small" href={`/reports/${s.report_key}${s.query ? `?${s.query}` : ""}`}>
                    {tr("Open")}
                  </Link>
                </div>
                <details>
                  <summary className="small">{tr("Change")}</summary>
                  <form action={updateSchedule} style={{ marginTop: 8 }}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="action" value="timing" />
                    <TimingFields id={s.id} frequency={s.frequency} weekday={s.weekday} />
                    <SubmitButton className="btn btn-small">{tr("Save")}</SubmitButton>
                  </form>
                </details>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <form action={updateSchedule}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="action" value={s.active ? "pause" : "resume"} />
                    <SubmitButton className="btn btn-small" pendingText="…">
                      {s.active ? tr("Pause") : tr("Resume")}
                    </SubmitButton>
                  </form>
                  <form action={updateSchedule}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="action" value="remove" />
                    <SubmitButton className="btn btn-small btn-danger" pendingText="…">
                      {tr("Remove")}
                    </SubmitButton>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
