"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { useTr } from "@/lib/tr-client";
import { addLine, endMeeting, joinedMeeting, roomTexts, type RoomState } from "../../actions";
import { Recorder } from "./Recorder";
import styles from "../../meetings.module.css";

type Video = { kind: "daily"; url: string; embed: true } | { kind: "jitsi" | "external"; url: string; embed: false } | { kind: "none" };

// The browser's speech recognition (Chrome and Edge on Android and laptops; Safari on iPhone in some languages).
type Rec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function makeRecognition(): Rec | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
}

/** What the note-taker hears, remembered on this device. Mixed meetings are captured as Kiswahili (it keeps English words). */
const LANGS = [
  { k: "sw", label: "Kiswahili", rec: "sw-TZ" },
  { k: "en", label: "English", rec: "en-US" },
  { k: "mixed", label: "Mixed", rec: "sw-TZ" },
] as const;
type LangKey = (typeof LANGS)[number]["k"];
const LANG_KEY = "lemosp.meetings.captureLang";

function savedLang(fallback: LangKey): LangKey {
  try {
    const v = window.localStorage.getItem(LANG_KEY);
    return v === "sw" || v === "en" || v === "mixed" ? v : fallback;
  } catch {
    return fallback;
  }
}

const MARKS = [
  { k: "Note", label: "Note" },
  { k: "Action", label: "Action" },
  { k: "Decision", label: "Decision" },
  { k: "Issue", label: "Issue" },
] as const;

const since = (iso: string, now: number) => {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ""}${String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function LiveRoom({
  meetingId,
  companyId,
  live,
  startedAt,
  canNote,
  canManage,
  canRecord,
  language,
  video,
  myName,
  transcription,
  initial,
}: {
  meetingId: string;
  companyId: string;
  live: boolean;
  startedAt: string | null;
  canNote: boolean;
  canManage: boolean;
  /** The recordings SQL is in place and this person may record. */
  canRecord: boolean;
  language: string;
  video: Video;
  myName: string;
  /** Server-side transcription is set up (OPENAI_API_KEY). */
  transcription: boolean;
  initial: RoomState;
}) {
  const tr = useTr();
  const router = useRouter();
  const [room, setRoom] = useState<RoomState>(initial);
  const [inCall, setInCall] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [lang, setLang] = useState<LangKey>(language === "en" ? "en" : "sw");
  const [speaker, setSpeaker] = useState(myName);
  const [mark, setMark] = useState<(typeof MARKS)[number]["k"]>("Note");
  const [line, setLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const recRef = useRef<Rec | null>(null);
  const stopRecRef = useRef<(() => Promise<void>) | null>(null);
  const wantRef = useRef(false);
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;

  useEffect(() => {
    setSupported(!!makeRecognition());
    setLang((l) => savedLang(l));
  }, []);

  const chooseLang = (k: LangKey) => {
    setLang(k);
    try {
      window.localStorage.setItem(LANG_KEY, k);
    } catch {
      /* private window: only for now */
    }
  };

  const refresh = useCallback(async () => {
    const r = await roomTexts(meetingId).catch(() => null);
    if (!r) return;
    setRoom(r);
    if (r.status !== "live" && live) router.refresh();
  }, [meetingId, live, router]);

  // What others said and typed, and whether someone records, every few seconds while the meeting is live.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(refresh, 8000);
    const c = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(t);
      clearInterval(c);
    };
  }, [live, refresh]);

  const send = useCallback(
    async (kind: "speech" | "typed", text: string, who: string | null) => {
      const res = await addLine(meetingId, kind, text, who);
      if (!res.ok) setError(res.error ?? tr("Not saved."));
      else setError(null);
      await refresh();
    },
    [meetingId, refresh, tr],
  );

  const startListening = () => {
    const rec = makeRecognition();
    if (!rec) {
      setSupported(false);
      return;
    }
    rec.lang = LANGS.find((l) => l.k === lang)?.rec ?? "sw-TZ";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let partial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        if (r.isFinal) {
          if (text) void send("speech", text, speakerRef.current || null);
        } else partial += `${text} `;
      }
      setInterim(partial.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantRef.current = false;
        setListening(false);
        setError(tr("The microphone is blocked. Allow it for this site in the browser settings, or type the notes."));
      } else if (e.error === "language-not-supported") {
        wantRef.current = false;
        setListening(false);
        setError(tr("This browser cannot write down this language. Record the meeting instead, or type the notes."));
      }
    };
    // Browsers stop listening after a pause: start again while the person still wants it.
    rec.onend = () => {
      if (wantRef.current) {
        try {
          rec.start();
        } catch {
          /* already starting */
        }
      } else setListening(false);
    };
    recRef.current = rec;
    wantRef.current = true;
    try {
      rec.start();
      setListening(true);
      setError(null);
    } catch {
      setError(tr("Speech capture could not start. Record the meeting or type the notes instead."));
    }
  };

  const stopListening = () => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
    setInterim("");
  };

  useEffect(
    () => () => {
      wantRef.current = false;
      recRef.current?.stop();
    },
    [],
  );

  const joinVideo = async () => {
    await joinedMeeting(meetingId).catch(() => undefined);
    if (video.kind === "daily") setInCall(true);
    else if (video.kind !== "none") window.open(video.url, "_blank", "noopener,noreferrer");
  };

  const recording = room.recording;

  return (
    <>
      {live && (
        <div className={styles.liveBar} role="status">
          <span className={styles.liveChip}>
            <span className={styles.liveDot} aria-hidden="true" />
            {tr("Live")}
            {startedAt && <span className={styles.when}> {since(startedAt, now)}</span>}
          </span>
          {recording && (
            <span className={styles.recBanner}>
              <span className={styles.recDot} aria-hidden="true" />
              {tr("Recording")} · {tr("this meeting is being recorded")}
            </span>
          )}
        </div>
      )}

      {video.kind !== "none" && (
        <section className="card">
          <div className="line-head">
            <h2 style={{ margin: 0 }}>{tr("Video call")}</h2>
            {!inCall ? (
              <button type="button" className="btn btn-primary" onClick={joinVideo} disabled={!live && video.kind === "daily"}>
                {video.kind === "external" ? tr("Join with their link") : tr("Join the call")}
              </button>
            ) : (
              <button type="button" className="btn btn-small" onClick={() => setInCall(false)}>
                {tr("Leave the call")}
              </button>
            )}
          </div>
          {video.kind === "jitsi" && <p className="small muted">{tr("The call opens in a new tab or the Jitsi Meet app. Keep this page open for notes and recording.")}</p>}
          {video.kind === "external" && <p className="small muted">{tr("This meeting uses the other side's link (Zoom, Teams or Google Meet). It opens in a new tab or their app.")}</p>}
          {video.kind === "daily" && !live && <p className="small muted">{tr("The call opens when the meeting starts.")}</p>}
          {inCall && video.kind === "daily" && (
            <iframe
              className={styles.videoFrame}
              src={video.url}
              title={tr("Video call")}
              allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          )}
        </section>
      )}

      {live && canNote && (
        <section className="card">
          <div className="line-head">
            <h2 style={{ margin: 0 }}>{tr("Capture")}</h2>
            <div className={styles.segmented} role="radiogroup" aria-label={tr("Language spoken")}>
              {LANGS.map((l) => (
                <button key={l.k} type="button" role="radio" aria-checked={lang === l.k} className={lang === l.k ? styles.segOn : ""} onClick={() => chooseLang(l.k)} disabled={listening}>
                  {tr(l.label)}
                </button>
              ))}
            </div>
          </div>
          <p className="small muted">{tr("Choose the language people speak. The AI understands Kiswahili, English and both mixed, and writes the minutes in English.")}</p>

          <div className={styles.captureRow}>
            {supported ? (
              listening ? (
                <button type="button" className="btn" onClick={stopListening}>
                  <span className={styles.liveDot} aria-hidden="true" />
                  {tr("Stop writing down")}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={startListening}>
                  {tr("Write down what is said")}
                </button>
              )
            ) : null}
            {canRecord && canManage && <Recorder meetingId={meetingId} companyId={companyId} language={lang} active={!!recording && !stopRecRef.current} onChange={refresh} bindStop={(f) => (stopRecRef.current = f)} />}
          </div>
          {!supported && (
            <p className="small muted">
              {transcription
                ? tr("This browser cannot write down speech live. Press Record: the recording is written down after the meeting.")
                : tr("This browser cannot write down speech live, and transcription of recordings is not set up. Record the meeting to listen later, and type the key points below.")}
            </p>
          )}
          {supported && (
            <label className="field" style={{ maxWidth: 320 }}>
              <span>{tr("Speaker on this device")}</span>
              <input value={speaker} onChange={(e) => setSpeaker(e.target.value)} maxLength={60} />
            </label>
          )}
          {interim && <p className={`small ${styles.interim}`}>{interim}</p>}

          <form
            className={styles.noteForm}
            onSubmit={(e) => {
              e.preventDefault();
              const t = line.trim();
              if (!t) return;
              void send("typed", mark === "Note" ? t : `${mark}: ${t}`, null);
              setLine("");
            }}
          >
            <div className={styles.segmented} role="radiogroup" aria-label={tr("Kind of point")}>
              {MARKS.map((m) => (
                <button key={m.k} type="button" role="radio" aria-checked={mark === m.k} className={mark === m.k ? styles.segOn : ""} onClick={() => setMark(m.k)}>
                  {tr(m.label)}
                </button>
              ))}
            </div>
            <div className={styles.noteInput}>
              <input
                value={line}
                onChange={(e) => setLine(e.target.value)}
                maxLength={2000}
                aria-label={tr("Type a point")}
                placeholder={mark === "Action" ? tr("Who does what by when, e.g. Juma delivers the oil to Geita on Friday") : tr("Type a point (Kiswahili or English)")}
              />
              <button className="btn btn-primary" type="submit" disabled={!line.trim()}>
                {tr("Add")}
              </button>
            </div>
          </form>
          {error && <p className="small text-warn">{error}</p>}
        </section>
      )}

      {(room.transcript || room.notes) && (
        <section className="card">
          {room.notes && (
            <>
              <h2>{tr("Typed notes")}</h2>
              <div className={styles.transcript}>{room.notes}</div>
            </>
          )}
          {room.transcript && (
            <>
              <h2 style={{ marginTop: room.notes ? 12 : 0 }}>{tr("What was said")}</h2>
              <div className={styles.transcript}>{room.transcript}</div>
            </>
          )}
        </section>
      )}

      {live && canManage && (
        <section className="card">
          <h2>{tr("End the meeting")}</h2>
          <form
            action={endMeeting}
            onSubmit={async (e) => {
              // Recording on this device: the last piece is saved before the meeting ends.
              const stopRec = stopRecRef.current;
              if (!stopRec) return;
              e.preventDefault();
              const form = e.currentTarget;
              stopRecRef.current = null;
              await stopRec();
              form.requestSubmit();
            }}
          >
            <input type="hidden" name="id" value={meetingId} />
            <input type="hidden" name="capture_language" value={lang} />
            <label className={styles.check}>
              <input type="checkbox" name="write" value="1" defaultChecked /> {tr("Write the minutes now")}
            </label>
            <label className={styles.check}>
              <input type="checkbox" name="swahili_summary" value="1" /> {tr("Also write a Kiswahili summary")}
            </label>
            {recording && <p className="small muted">{tr("The recording stops and is saved when the meeting ends.")}</p>}
            <SubmitButton className="btn btn-danger" pendingText={tr("Ending…")}>
              {tr("End meeting")}
            </SubmitButton>
          </form>
        </section>
      )}
    </>
  );
}
