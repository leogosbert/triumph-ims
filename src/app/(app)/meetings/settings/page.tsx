import Link from "next/link";
import { redirect } from "next/navigation";
import { primeLang, tr } from "@/lib/tr";
import { BackLink } from "@/components/BackLink";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { aiReady } from "@/lib/ai/claude";
import { RECORDING_DAYS } from "@/lib/meetings/model";
import { transcriptionReady } from "@/lib/meetings/recording-core";
import { setRecordingDays } from "../recording-actions";
import { MeetingTabs } from "../parts";
import styles from "../meetings.module.css";

export const metadata = { title: "Meeting settings" };

/** Management: how long meeting recordings are kept, and what is switched on for meetings. */
export default async function MeetingSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) redirect("/meetings");
  const { data, error } = await supabase.from("meeting_settings").select("recording_days").eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Meeting settings" />;
  const days = Number(data?.recording_days ?? 30);
  const ai = aiReady();
  const stt = transcriptionReady();
  return (
    <>
      <BackLink href="/meetings" label="Meetings" />
      <div className="page-head">
        <h1>{tr("Meeting settings")}</h1>
      </div>
      <MeetingTabs current="" />
      <Notice {...notice} />

      <section className="card">
        <h2>{tr("Recordings")}</h2>
        <p className="small muted">{tr("Recordings are private to your company: only people who can see the meeting can play them. They are deleted automatically after the time you choose; the minutes and the written transcript stay.")}</p>
        <form action={setRecordingDays}>
          <fieldset className="field">
            <legend>{tr("Delete meeting recordings after")}</legend>
            <div className={styles.chips}>
              {RECORDING_DAYS.map(([d, l]) => (
                <label key={d} className={styles.chip}>
                  <input type="radio" name="days" value={d} defaultChecked={d === days} /> {tr(l)}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="small muted">{tr("Recordings already made follow the new setting; none is deleted sooner than a day from now.")}</p>
          <SubmitButton className="btn btn-primary">{tr("Save")}</SubmitButton>
        </form>
      </section>

      <section className="card">
        <h2>{tr("AI and transcription")}</h2>
        <ul className="rec-list">
          <li>
            <div className="line-head">
              <span>{tr("AI minutes and summaries (Kiswahili, English or both)")}</span>
              <span className={`badge tone-${ai ? "ok" : "off"}`}>{ai ? tr("On") : tr("Not set up")}</span>
            </div>
            {!ai && <div className="small muted">{tr("Without AI the app writes plain minutes from the typed notes.")}</div>}
          </li>
          <li>
            <div className="line-head">
              <span>{tr("Writing down recordings (speech to text)")}</span>
              <span className={`badge tone-${stt ? "ok" : "off"}`}>{stt ? tr("On") : tr("Not set up")}</span>
            </div>
            <div className="small muted">
              {stt
                ? tr("When the live capture in the browser caught little, the recording is written down after the meeting and used for the minutes.")
                : tr("Transcription is not set up: recordings can be played, and the live capture in the browser and the typed notes are used for the minutes.")}
            </div>
          </li>
        </ul>
      </section>

      <p className="small">
        <Link href="/meetings/portal">{tr("Client request page: let clients ask for a meeting →")}</Link>
      </p>
    </>
  );
}
