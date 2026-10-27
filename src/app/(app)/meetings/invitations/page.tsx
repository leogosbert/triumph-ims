import Link from "next/link";
import { redirect } from "next/navigation";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatWhen } from "@/lib/services";
import { canOrganise, INVITATION_STATUS, type Invitation } from "@/lib/meetings/model";
import { MeetingTabs } from "../parts";
import styles from "../meetings.module.css";

export const metadata = { title: "Meeting invitations" };

export default async function InvitationsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, isManager } = await getAppContext();
  if (!canOrganise(roles)) redirect("/meetings");
  const { data, error } = await supabase
    .from("meeting_invitations")
    .select("*")
    .eq("company_id", company.id)
    .order("status", { ascending: false })
    .order("proposed_at", { ascending: true })
    .limit(150);
  if (isMissingTable(error)) return <NotReady title="Meetings" />;
  const rows = (data ?? []) as Invitation[];
  const pending = rows.filter((r) => r.status === "pending");
  const rest = rows.filter((r) => r.status !== "pending");
  const item = (r: Invitation) => (
    <li key={r.id}>
      <Link href={r.status === "pending" || !r.meeting_id ? `/meetings/invitations/${r.id}` : `/meetings/${r.meeting_id}`}>
        <div className="line-head">
          <strong>{r.topic}</strong>
          <span className={`badge tone-${INVITATION_STATUS[r.status]?.tone}`}>{tr(INVITATION_STATUS[r.status]?.label ?? r.status)}</span>
        </div>
        <div className={styles.meta}>
          <span className={styles.when}>{formatWhen(r.proposed_at)}</span>
          <span>{[r.requester_name, r.requester_company].filter(Boolean).join(" · ")}</span>
          <span>{r.source === "portal" ? tr("Asked on our request page") : tr("Their invitation, added by staff")}</span>
          {r.external_link && <span>{tr("Their link")}</span>}
        </div>
      </Link>
    </li>
  );
  return (
    <>
      <div className="page-head">
        <h1>{tr("Invitations")}</h1>
        <Link href="/meetings/invitations/new" className="btn btn-small btn-primary">
          {tr("+ Add an invitation we got")}
        </Link>
      </div>
      <MeetingTabs current="/meetings/invitations" />
      <Notice {...notice} />
      {isManager && (
        <section className="card">
          <h2>{tr("Requests to answer")}</h2>
          {pending.length === 0 ? <p className="muted small">{tr("No requests waiting.")}</p> : <ul className="rec-list">{pending.map(item)}</ul>}
          <p className="small">
            <Link href="/meetings/portal">{tr("Our request page link →")}</Link>
          </p>
        </section>
      )}
      <section className="card">
        <h2>{tr("Answered and added")}</h2>
        {rest.length === 0 ? <p className="muted small">{tr("Nothing yet. When a client sends you a Zoom, Teams or Google Meet invitation, add it here so it is on the calendar with its link.")}</p> : <ul className="rec-list">{rest.map(item)}</ul>}
      </section>
    </>
  );
}
