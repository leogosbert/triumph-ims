import Link from "next/link";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { FREQUENCY, WEEKDAYS } from "@/lib/meetings/model";
import { MeetingTabs } from "../parts";
import type { Series } from "./SeriesForm";

export const metadata = { title: "Regular meetings" };

export default async function SeriesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, isManager } = await getAppContext();
  const { data, error } = await supabase.from("meeting_series").select("*").eq("company_id", company.id).order("active", { ascending: false }).order("title");
  if (isMissingTable(error)) return <NotReady title="Meetings" />;
  const rows = (data ?? []) as Series[];
  const names = await namesFor(supabase, rows.map((s) => s.chair_id));
  return (
    <>
      <div className="page-head">
        <h1>{tr("Regular meetings")}</h1>
        {isManager && (
          <Link href="/meetings/series/new" className="btn btn-small btn-primary">
            {tr("+ Regular meeting")}
          </Link>
        )}
      </div>
      <MeetingTabs current="/meetings/series" />
      <Notice {...notice} />
      <section className="card">
        {rows.length === 0 ? (
          <p className="muted">{isManager ? tr("No regular meetings yet. Set the weekly team meeting once and the app plans each one.") : tr("No regular meetings yet.")}</p>
        ) : (
          <ul className="rec-list">
            {rows.map((s) => (
              <li key={s.id}>
                <Link href={isManager ? `/meetings/series/${s.id}` : "/meetings"}>
                  <div className="line-head">
                    <strong>{s.title}</strong>
                    <span className={`badge tone-${s.active ? "ok" : "off"}`}>{s.active ? tr("Active") : tr("Stopped")}</span>
                  </div>
                  <div className="small muted">
                    {tr(FREQUENCY[s.frequency] ?? s.frequency)}
                    {(s.frequency === "weekly" || s.frequency === "fortnightly") && s.weekday !== null && ` · ${tr(WEEKDAYS[s.weekday])}`}
                    {s.frequency === "monthly" && s.month_day && ` · ${tr("day")} ${s.month_day}`} · {s.start_time.slice(0, 5)} · {s.minutes} {tr("min")}
                    {s.chair_id && ` · ${tr("Chair")}: ${names.get(s.chair_id) ?? ""}`}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="small muted">{tr("The meetings of the next two weeks are planned by themselves; each one can still be changed or cancelled.")}</p>
    </>
  );
}
