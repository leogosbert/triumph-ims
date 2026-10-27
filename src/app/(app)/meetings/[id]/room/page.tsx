import Link from "next/link";
import { notFound } from "next/navigation";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { displayName, getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { ANNOUNCE, canManage, endsAt, joinOpen, MEETING_COLUMNS, recordingActive, type Meeting, type Recording } from "@/lib/meetings/model";
import { transcriptionReady } from "@/lib/meetings/recording-core";
import { dailyReady, dailyToken, ensureDailyRoom, jitsiUrl, withToken, type VideoJoin } from "@/lib/meetings/video";
import { startMeeting } from "../../actions";
import { MeetingBadge, StageBar, whenRange } from "../../parts";
import { LiveRoom } from "./LiveRoom";
import styles from "../../meetings.module.css";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Meeting room" };
export const dynamic = "force-dynamic";

/** The video room for this person: Daily (embedded, with their own token), Jitsi, or the other side's link. */
async function videoFor(
  supabase: Awaited<ReturnType<typeof getAppContext>>["supabase"],
  m: Meeting,
  me: { id: string; name: string; owner: boolean },
): Promise<VideoJoin> {
  if (m.video_provider === "external" && m.external_link) return { kind: "external", url: m.external_link, embed: false };
  if (m.video_provider === "none") return { kind: "none" };
  if (dailyReady() && joinOpen(m)) {
    const exp = new Date(Date.parse(endsAt(m)) + 6 * 3600_000);
    let url = m.video_provider === "daily" ? m.video_url : null;
    if (!url) {
      url = await ensureDailyRoom(m.video_room, exp);
      if (url) await supabase.rpc("meeting_set_video", { p_meeting: m.id, p_provider: "daily", p_room: m.video_room, p_url: url });
    }
    if (url) {
      const token = await dailyToken(m.video_room, { name: me.name, owner: me.owner, userId: me.id, expiresAt: new Date(Date.parse(endsAt(m)) + 2 * 3600_000) });
      if (token) return { kind: "daily", url: withToken(url, token), embed: true };
    }
  }
  return { kind: "jitsi", url: jitsiUrl(m.video_room), embed: false };
}

export default async function RoomPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, role, user, profile, company } = await getAppContext();
  const { data } = await supabase.from("meetings").select(MEETING_COLUMNS).eq("id", id).maybeSingle();
  if (!data) notFound();
  const m = data as unknown as Meeting;
  const manage = canManage(m, user.id, role);
  const [{ data: texts }, { data: mine }, rec] = await Promise.all([
    supabase.from("meeting_texts").select("transcript, notes").eq("meeting_id", id).maybeSingle(),
    supabase.from("meeting_attendees").select("id").eq("meeting_id", id).eq("user_id", user.id).maybeSingle(),
    // Missing before the v1.25 SQL is run: then there is no Record button.
    supabase.from("meeting_recordings").select("id, started_by, started_at, last_part_at, status, deleted_at").eq("meeting_id", id).eq("status", "recording").maybeSingle(),
  ]);
  const recordingsReady = !rec.error;
  const recNow = recordingsReady && rec.data && recordingActive(rec.data as Pick<Recording, "status" | "deleted_at" | "last_part_at" | "started_at">) ? (rec.data as Recording) : null;
  const live = m.status === "live";
  const canNote = manage || !!mine;
  const name = displayName(profile);
  const video = m.status === "cancelled" || m.status === "held" ? ({ kind: "none" } as const) : await videoFor(supabase, m, { id: user.id, name, owner: manage });

  return (
    <>
      <BackLink href={`/meetings/${id}`} label="Meeting" />
      <div className="page-head">
        <h1>{m.title}</h1>
        <span>
          <MeetingBadge m={m} />
        </span>
      </div>
      <p className="small muted">
        {whenRange(m)} · <Link href={`/meetings/${id}`}>{tr("Agenda and people")}</Link>
      </p>
      <StageBar m={m} />
      <Notice {...notice} />

      {m.status === "planned" && (
        <section className={`card ${styles.startCard}`}>
          {manage ? (
            <form action={startMeeting}>
              <input type="hidden" name="id" value={id} />
              <h2>{tr("Ready to start?")}</h2>
              {m.record && (
                <>
                  <p className="small muted">{tr("Read this out first, so everyone knows what is written down:")}</p>
                  <p className={styles.announce} lang="sw">
                    {ANNOUNCE.sw}
                  </p>
                  <p className={styles.announce} lang="en">
                    {ANNOUNCE.en}
                  </p>
                  <label className={styles.check}>
                    <input type="checkbox" name="announced" value="1" required /> {tr("I told everyone")}
                  </label>
                </>
              )}
              <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Starting…")}>
                {tr("Start meeting")}
              </SubmitButton>
              <p className="small muted">{tr("Everyone invited gets a notification with a Join button.")}</p>
            </form>
          ) : (
            <p className="muted">{tr("The meeting has not started yet. You get a notification when it does.")}</p>
          )}
        </section>
      )}

      {m.status === "held" && (
        <p className="banner ok">
          {tr("This meeting has ended.")} <Link href={`/meetings/${id}/minutes`}>{tr("Open the minutes →")}</Link>
        </p>
      )}
      {m.status === "cancelled" && <p className="banner warn">{tr("This meeting was cancelled.")}</p>}

      {(m.status === "planned" || live) && (
        <LiveRoom
          meetingId={id}
          companyId={company.id}
          live={live}
          startedAt={m.started_at}
          canNote={canNote}
          canManage={manage}
          canRecord={recordingsReady}
          language={m.language}
          video={video.kind === "daily" ? video : video.kind === "none" ? video : { kind: video.kind, url: video.url, embed: false }}
          myName={name}
          transcription={transcriptionReady()}
          initial={{
            transcript: String(texts?.transcript ?? "").slice(-20000),
            notes: String(texts?.notes ?? "").slice(-20000),
            status: m.status,
            recording: recNow ? { id: recNow.id, by: recNow.started_by, since: recNow.started_at } : null,
          }}
        />
      )}
    </>
  );
}
