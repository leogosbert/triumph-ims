import { tr } from "@/lib/tr";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDate } from "@/lib/format";
import { durationLabel, type Recording } from "@/lib/meetings/model";
import { splitParagraphs } from "@/lib/meetings/minutes-format";
import { deleteRecording, summarizeRecording, transcribeRecording } from "./recording-actions";
import { RecordingPlayer } from "./RecordingPlayer";
import { RefreshWhile } from "./[id]/minutes/RefreshWhile";
import styles from "./meetings.module.css";

const at = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
const mb = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const LANG: Record<string, string> = { sw: "Kiswahili", en: "English", mixed: "Kiswahili and English" };
const recent = (iso: string | null, minutes: number) => !!iso && Date.now() - Date.parse(iso) < minutes * 60_000;

/**
 * The meeting's recordings, to catch up: play, read what was said, read the summary. Whoever manages the meeting can
 * have a recording written down (server transcription, when set up), summarised by the AI, or deleted now.
 */
export function Recordings({
  recordings,
  names,
  manage,
  ai,
  transcription,
  back,
  keepDays,
}: {
  recordings: Recording[];
  names: Map<string, string>;
  manage: boolean;
  ai: boolean;
  transcription: boolean;
  back: string;
  keepDays: number;
}) {
  if (!recordings.length) return null;
  const busy = recordings.some((r) => (r.transcript_status === "writing" && recent(r.transcript_requested_at, 30)) || r.summary_status === "writing");
  return (
    <section className="card" id="recordings">
      {busy && <RefreshWhile seconds={10} />}
      <div className="line-head">
        <h2 style={{ margin: 0 }}>{recordings.length === 1 ? tr("Recording") : tr("Recordings")}</h2>
        <span className="small muted">{keepDays ? `${tr("Kept")} ${keepDays === 365 ? tr("1 year") : `${keepDays} ${tr("days")}`}` : tr("Kept until deleted")}</span>
      </div>
      {!transcription && manage && (
        <p className="small muted">{tr("Transcription is not set up, so recordings can be played but not written down by the app. The live capture and the typed notes are used for the minutes.")}</p>
      )}
      {recordings.map((r, i) => {
        const gone = !!r.deleted_at;
        const writing = r.transcript_status === "writing" && recent(r.transcript_requested_at, 30);
        const label = `${tr("Recording")} ${recordings.length > 1 ? i + 1 : ""} · ${at(r.started_at)}`.replace("  ", " ");
        return (
          <div key={r.id} className={styles.recItem}>
            <div className="line-head">
              <strong>{label}</strong>
              {r.status === "recording" ? (
                <span className="badge tone-bad">{tr("Recording now")}</span>
              ) : gone ? (
                <span className="badge tone-off">{r.delete_reason === "expired" ? tr("Audio deleted (expired)") : tr("Deleted")}</span>
              ) : null}
            </div>
            <div className={styles.recMeta}>
              <span>{durationLabel(r.duration_seconds)}</span>
              {r.size_bytes > 0 && <span>{mb(r.size_bytes)}</span>}
              <span>{tr(LANG[r.language] ?? r.language)}</span>
              {r.started_by && names.get(r.started_by) && (
                <span>
                  {tr("by")} {names.get(r.started_by)}
                </span>
              )}
              {!gone && r.expires_at && (
                <span>
                  {tr("Deleted on")} {formatDate(r.expires_at)}
                </span>
              )}
              {gone && r.deleted_at && (
                <span>
                  {tr("on")} {formatDate(r.deleted_at)}
                </span>
              )}
            </div>

            {!gone && r.parts > 0 && r.status !== "recording" && <RecordingPlayer recordingId={r.id} label={label} />}

            {r.summary && (
              <div className={styles.doc} style={{ marginTop: 10 }}>
                <h3>{tr("Summary")}</h3>
                {splitParagraphs(r.summary).map((p, k) => (
                  <p key={k}>{p}</p>
                ))}
                {r.summary_sw && (
                  <div className={styles.docSw} lang="sw">
                    {splitParagraphs(r.summary_sw).map((p, k) => (
                      <p key={k}>{p}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {r.summary_status === "writing" && <p className="small muted">{tr("The AI is summarising the recording…")}</p>}
            {r.summary_error && r.summary_status !== "writing" && <p className="small text-warn">{tr(r.summary_error)}</p>}

            {r.transcript && (
              <details style={{ marginTop: 8 }}>
                <summary className="small">{tr("What was said (written down from the recording)")}</summary>
                <div className={styles.transcript}>{r.transcript}</div>
              </details>
            )}
            {writing && <p className="small muted">{tr("The recording is being written down…")}</p>}
            {r.transcript_error && !writing && <p className="small text-warn">{tr(r.transcript_error)}</p>}

            {manage && r.status !== "recording" && (
              <div className={`${styles.nextActions} ${styles.noPrint}`} style={{ marginTop: 10 }}>
                {!gone && transcription && !r.transcript && !writing && r.parts > 0 && (
                  <form action={transcribeRecording}>
                    <input type="hidden" name="recording_id" value={r.id} />
                    <input type="hidden" name="meeting_id" value={r.meeting_id} />
                    <input type="hidden" name="back" value={back} />
                    <SubmitButton className="btn btn-small" pendingText={tr("Starting…")}>
                      {tr("Write down the recording")}
                    </SubmitButton>
                  </form>
                )}
                {ai && r.transcript && r.summary_status !== "writing" && r.delete_reason !== "manual" && (
                  <form action={summarizeRecording} className="inline-form" style={{ gap: 6 }}>
                    <input type="hidden" name="recording_id" value={r.id} />
                    <input type="hidden" name="meeting_id" value={r.meeting_id} />
                    <input type="hidden" name="back" value={back} />
                    <SubmitButton className="btn btn-small btn-primary" pendingText={tr("Summarising…")}>
                      {r.summary ? tr("Summarize again") : tr("Summarize this recording")}
                    </SubmitButton>
                    <label className="small" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <input type="checkbox" name="swahili_summary" value="1" defaultChecked={!!r.summary_sw} /> {tr("Also in Kiswahili")}
                    </label>
                  </form>
                )}
                {!gone && (
                  <details>
                    <summary className="small">{tr("Delete now")}</summary>
                    <form action={deleteRecording} style={{ marginTop: 6 }}>
                      <input type="hidden" name="recording_id" value={r.id} />
                      <input type="hidden" name="meeting_id" value={r.meeting_id} />
                      <input type="hidden" name="back" value={back} />
                      <p className="small muted">{tr("The audio, its transcript and its summary are deleted for everyone. The minutes stay.")}</p>
                      <SubmitButton className="btn btn-small btn-danger" pendingText={tr("Deleting…")}>
                        {tr("Delete this recording")}
                      </SubmitButton>
                    </form>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
