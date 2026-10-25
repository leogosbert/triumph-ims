import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { rankAgenda } from "@/lib/ai/meetings";
import { canManage, MEETING_COLUMNS, type AgendaCandidate, type Meeting } from "@/lib/meetings/model";
import { addSuggested } from "../../actions";
import styles from "../../meetings.module.css";

export const metadata = { title: "Suggest topics" };
export const maxDuration = 10;

/**
 * "Suggest topics": business items from the company's own data (open actions from earlier meetings, money owed,
 * bills due, low stock, late deliveries and orders, filings and licences, safety and quality, unanswered messages,
 * pipeline follow-ups). The AI phrases and ranks them when it is switched on; the organiser ticks what goes on.
 */
export default async function SuggestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user } = await getAppContext();
  const { data } = await supabase.from("meetings").select(MEETING_COLUMNS).eq("id", id).maybeSingle();
  if (!data) notFound();
  const m = data as unknown as Meeting;
  if (!canManage(m, user.id, role) || !["planned", "live"].includes(m.status)) redirect(`/meetings/${id}`);

  const [{ data: cand, error }, { data: onAgenda }] = await Promise.all([
    supabase.rpc("meeting_agenda_candidates", { p_company: company.id }),
    supabase.from("meeting_agenda_items").select("source_ref").eq("meeting_id", id).not("source_ref", "is", null),
  ]);
  if (error) throw new Error(error.message);
  const taken = new Set(((onAgenda ?? []) as { source_ref: string }[]).map((x) => x.source_ref));
  const fresh = ((cand ?? []) as AgendaCandidate[]).filter((c) => !taken.has(c.ref));
  const ranked = await rankAgenda(fresh, { title: m.title, topics: m.topics ?? [], kind: m.kind });
  // Topics the meeting covers come first, ticked.
  const covers = (c: AgendaCandidate) => !m.topics?.length || m.topics.includes(c.topic);

  return (
    <>
      <div className="page-head">
        <h1>{tr("Suggest topics")}</h1>
      </div>
      <p className="small muted">
        {m.title} · {ranked.by === "ai" ? tr("Ranked by the AI from your business data. Tick what goes on the agenda.") : tr("Found in your business data, most urgent first. Tick what goes on the agenda.")}
      </p>
      {ranked.note && <p className="small muted">{tr(ranked.note)}</p>}
      <Notice {...notice} />
      <form action={addSuggested} className="card">
        <input type="hidden" name="meeting_id" value={id} />
        {ranked.items.length === 0 ? (
          <p className="muted">{tr("Nothing found that needs the team's attention. Add your own items on the meeting page.")}</p>
        ) : (
          ranked.items.map((c) => (
            <label key={c.key} className={styles.checkRow}>
              <input type="checkbox" name="pick" value={JSON.stringify({ title: c.title, detail: [c.why, c.detail].filter(Boolean).join(" · ") || null, topic: c.topic, ref: c.ref, source: c.source })} defaultChecked={c.weight >= 3 && covers(c)} />
              <span>
                <strong>{tr(c.title)}</strong>
                <span className="badge tone-info" style={{ marginLeft: 6 }}>
                  {tr(c.topic)}
                </span>
                {c.weight >= 3 && (
                  <span className="badge tone-warn" style={{ marginLeft: 6 }}>
                    {tr("Urgent")}
                  </span>
                )}
                {c.why && <div className="small">{c.why}</div>}
                {c.detail && <div className="small muted">{c.detail}</div>}
              </span>
            </label>
          ))
        )}
        <div className="inline-form" style={{ marginTop: 12 }}>
          <SubmitButton>{tr("Add the ticked topics")}</SubmitButton>
          <Link href={`/meetings/${id}#agenda`} className="btn">
            {tr("Back")}
          </Link>
        </div>
      </form>
    </>
  );
}
