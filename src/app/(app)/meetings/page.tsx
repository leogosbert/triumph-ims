import Link from "next/link";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { canOrganise, MEETING_COLUMNS, type Meeting, type MeetingSummary } from "@/lib/meetings/model";
import { MeetingRow, MeetingTabs } from "./parts";

export const metadata = { title: "Meetings" };

export default async function MeetingsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const sp = (await searchParams) ?? {};
  const tab = sp.tab === "held" ? "held" : "upcoming";
  const { supabase, company, role } = await getAppContext();

  // The regular meetings of the next two weeks are made first (harmless when nothing is due).
  const sched = await supabase.rpc("meeting_schedule_series", { p_company: company.id, p_days: 14 });
  if (isMissingTable(sched.error)) return <NotReady title="Meetings" />;
  const { data: sumData, error } = await supabase.rpc("meeting_summary", { p_company: company.id });
  if (isMissingTable(error)) return <NotReady title="Meetings" />;
  if (error) throw new Error(error.message);
  const s = sumData as MeetingSummary;

  const since = new Date(Date.now() - 3 * 3600_000).toISOString();
  const q = supabase.from("meetings").select(MEETING_COLUMNS).eq("company_id", company.id);
  const { data } =
    tab === "held"
      ? await q.in("status", ["held", "cancelled"]).order("starts_at", { ascending: false }).limit(60)
      : await q.in("status", ["planned", "live"]).gte("starts_at", since).order("starts_at").limit(60);
  // A live meeting that started earlier than three hours ago still shows.
  const { data: live } = tab === "upcoming" ? await supabase.from("meetings").select(MEETING_COLUMNS).eq("company_id", company.id).eq("status", "live").lt("starts_at", since) : { data: [] };
  const meetings = [...((live ?? []) as unknown as Meeting[]), ...((data ?? []) as unknown as Meeting[])];
  const names = await namesFor(supabase, meetings.map((m) => m.chair_id));

  const tiles = [
    { n: s.live, l: "Live now", href: "/meetings", alert: s.live > 0, show: true },
    { n: s.my_actions, l: "My open actions", href: "/meetings/actions", alert: s.my_overdue > 0, show: true },
    { n: s.to_approve, l: "Minutes to finish", href: "/meetings?tab=held", alert: false, show: s.can_organise },
    { n: s.requests, l: "Meeting requests", href: "/meetings/invitations", alert: s.requests > 0, show: s.is_manager },
    { n: s.proposals, l: "Updates to review", href: "/meetings?tab=held", alert: s.proposals > 0, show: s.is_manager },
  ].filter((t) => t.show);

  return (
    <>
      <div className="page-head">
        <h1>{tr("Meetings")}</h1>
        {canOrganise(role) && (
          <Link href="/meetings/new" className="btn btn-small btn-primary">
            {tr("+ Meeting")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("Plan, meet in the room or by video, record, and let the AI write the minutes (it understands Kiswahili and English).")}</p>
      <MeetingTabs current={tab === "held" ? "/meetings?tab=held" : "/meetings"} invitations={canOrganise(role)} />
      <Notice {...notice} />

      {s.next?.status === "live" && (
        <p className="banner ok">
          <strong>{tr("Live now")}:</strong> {s.next.title} <Link href={`/meetings/${s.next.id}/room`}>{tr("Join now →")}</Link>
        </p>
      )}

      <div className="stat-grid">
        {tiles.map((t) => (
          <Link key={t.l} href={t.href} className={`stat ${t.alert ? "alert" : ""}`}>
            <div className="n">{t.n}</div>
            <div className="l">{tr(t.l)}</div>
          </Link>
        ))}
      </div>

      {s.my_overdue > 0 && (
        <p className="banner warn">
          {tr("You have overdue actions from meetings.")} <Link href="/meetings/actions">{tr("Open my actions →")}</Link>
        </p>
      )}

      <section className="card">
        <h2>{tab === "held" ? tr("Held and cancelled") : tr("Coming up")}</h2>
        {meetings.length === 0 ? (
          <p className="muted">
            {tab === "held" ? tr("No meetings held yet.") : tr("No meetings planned.")}{" "}
            {canOrganise(role) && tab !== "held" && <Link href="/meetings/new">{tr("Plan one →")}</Link>}
          </p>
        ) : (
          <ul className="rec-list">
            {meetings.map((m) => (
              <MeetingRow key={m.id} m={m} names={names} />
            ))}
          </ul>
        )}
      </section>

      {s.is_manager && (
        <p className="small">
          <Link href="/meetings/settings">{tr("Meeting settings: recordings, AI, client request page →")}</Link>
        </p>
      )}
    </>
  );
}
