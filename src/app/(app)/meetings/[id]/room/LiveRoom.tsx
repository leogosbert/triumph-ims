"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTr } from "@/lib/tr-client";
import { addLine, joinedMeeting, roomTexts } from "../../actions";
import styles from "../../meetings.module.css";

type Video = { kind: "daily"; url: string; embed: true } | { kind: "jitsi" | "external"; url: string; embed: false } | { kind: "none" };

// The browser's speech recognition (Chrome and Edge on Android and laptops; Safari on iPhone 14.5+ in some languages).
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

const MARKS = [
  { k: "Action", label: "Action" },
  { k: "Decision", label: "Decision" },
  { k: "Issue", label: "Issue" },
  { k: "Note", label: "Note" },
] as const;

export function LiveRoom({
  meetingId,
  live,
  canNote,
  record,
  language,
  video,
  myName,
  initialTranscript,
  initialNotes,
}: {
  meetingId: string;
  live: boolean;
  canNote: boolean;
  record: boolean;
  language: string;
  video: Video;
  myName: string;
  initialTranscript: string;
  initialNotes: string;
}) {
  const tr = useTr();
  const router = useRouter();
  const [transcript, setTranscript] = useState(initialTranscript);
  const [notes, setNotes] = useState(initialNotes);
  const [inCall, setInCall] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [lang, setLang] = useState(language === "en" ? "en-US" : "sw-TZ");
  const [speaker, setSpeaker] = useState(myName);
  const [mark, setMark] = useState<(typeof MARKS)[number]["k"]>("Note");
  const [line, setLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<Rec | null>(null);
  const wantRef = useRef(false);
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;

  useEffect(() => {
    setSupported(!!makeRecognition());
  }, []);

  // What others said and typed, every few seconds while the meeting is live.
  useEffect(() => {
    if (!live) return;
    let stop = false;
    const tick = async () => {
      const r = await roomTexts(meetingId).catch(() => null);
      if (stop || !r) return;
      setTranscript(r.transcript);
      setNotes(r.notes);
      if (r.status !== "live") router.refresh();
    };
    const t = setInterval(tick, 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [live, meetingId, router]);

  const send = useCallback(
    async (kind: "speech" | "typed", text: string, who: string | null) => {
      const res = await addLine(meetingId, kind, text, who);
      if (!res.ok) setError(res.error ?? tr("Not saved."));
      else setError(null);
      const r = await roomTexts(meetingId).catch(() => null);
      if (r) {
        setTranscript(r.transcript);
        setNotes(r.notes);
      }
    },
    [meetingId, tr],
  );

  const startListening = () => {
    const rec = makeRecognition();
    if (!rec) {
      setSupported(false);
      return;
    }
    rec.lang = lang;
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
      setError(tr("Speech recognition could not start. Type the notes instead."));
    }
  };

  const stopListening = () => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
    setInterim("");
  };

  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.stop();
  }, []);

  const joinVideo = async () => {
    await joinedMeeting(meetingId).catch(() => undefined);
    if (video.kind === "daily") setInCall(true);
    else if (video.kind !== "none") window.open(video.url, "_blank", "noopener,noreferrer");
  };

  return (
    <>
      {video.kind !== "none" && (
        <section className="card">
          <div className="line-head">
            <h2 style={{ margin: 0 }}>{tr("Video")}</h2>
            {!inCall && (
              <button type="button" className="btn btn-primary" onClick={joinVideo} disabled={!live && video.kind === "daily"}>
                {video.kind === "external" ? tr("Join with their link") : tr("Join the video call")}
              </button>
            )}
            {inCall && (
              <button type="button" className="btn btn-small" onClick={() => setInCall(false)}>
                {tr("Leave the call")}
              </button>
            )}
          </div>
          {video.kind === "jitsi" && <p className="small muted">{tr("The call opens in a new tab or the Jitsi Meet app.")}</p>}
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
          <h2>{tr("Notes")}</h2>
          {record && (
            <>
              <div className="inline-form" style={{ alignItems: "flex-end" }}>
                <label className="field">
                  <span>{tr("Who is speaking (on this phone)")}</span>
                  <input value={speaker} onChange={(e) => setSpeaker(e.target.value)} maxLength={60} />
                </label>
                <label className="field">
                  <span>{tr("Language heard")}</span>
                  <select value={lang} onChange={(e) => setLang(e.target.value)} disabled={listening}>
                    <option value="sw-TZ">{tr("Kiswahili")}</option>
                    <option value="en-US">{tr("English")}</option>
                  </select>
                </label>
                {listening ? (
                  <button type="button" className="btn" onClick={stopListening}>
                    <span className={styles.liveDot} aria-hidden="true" />
                    {tr("Stop writing down")}
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={startListening} disabled={!supported}>
                    {tr("Write down what is said")}
                  </button>
                )}
              </div>
              {!supported && <p className="small muted">{tr("This browser cannot write down speech. Use Chrome or Edge, or type the notes below.")}</p>}
              {interim && <p className={`small ${styles.interim}`}>{interim}</p>}
            </>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const t = line.trim();
              if (!t) return;
              void send("typed", mark === "Note" ? t : `${mark}: ${t}`, null);
              setLine("");
            }}
          >
            <div className="inline-form" style={{ gap: 6 }}>
              {MARKS.map((m) => (
                <button key={m.k} type="button" className={`btn btn-small ${mark === m.k ? "btn-primary" : ""}`} onClick={() => setMark(m.k)} aria-pressed={mark === m.k}>
                  {tr(m.label)}
                </button>
              ))}
            </div>
            <label className="field">
              <span>{tr("Type a point (for an action, name who does it and when)")}</span>
              <input value={line} onChange={(e) => setLine(e.target.value)} maxLength={2000} placeholder={tr("e.g. Juma to deliver the oil to Geita on Friday")} />
            </label>
            <button className="btn btn-small btn-primary" type="submit">
              {tr("Add")}
            </button>
          </form>
          {error && <p className="small" style={{ color: "var(--bad, #c0392b)" }}>{error}</p>}
        </section>
      )}

      {(transcript || notes) && (
        <section className="card">
          {notes && (
            <>
              <h2>{tr("Typed notes")}</h2>
              <div className={styles.transcript}>{notes}</div>
            </>
          )}
          {transcript && (
            <>
              <h2 style={{ marginTop: 12 }}>{tr("What was said")}</h2>
              <div className={styles.transcript}>{transcript}</div>
            </>
          )}
        </section>
      )}
    </>
  );
}
