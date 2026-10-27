"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTr } from "@/lib/tr-client";
import { extFor, RECORDING_BUCKET, RECORDING_ROLLOVER_MS, RECORDING_SLICE_MS } from "@/lib/meetings/recording-shared";
import styles from "../../meetings.module.css";

/** The first audio format this browser records: webm/opus (Chrome, Edge, Firefox, Android), mp4 (iPhone and Safari). */
function pickMime(): string | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") return null;
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/ogg;codecs=opus"]) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* next */
    }
  }
  return null;
}

type Piece = { seq: number; blob: Blob; ms: number; tries: number };
type Take = { id: string; prefix: string; mime: string; seq: number; last: number; queue: Piece[]; rec: MediaRecorder; stopped: Promise<void> };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  return `${h ? `${h}:` : ""}${String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Record: the meeting's audio from this phone or laptop's microphone, uploaded every 20 seconds to the company's
 * private recordings folder (so a closed tab or a dropped connection loses at most a few seconds). After 40 minutes
 * a new recording file starts by itself, so each one stays small enough to be written down later.
 * Everyone in the meeting sees the red Recording banner while it runs.
 */
export function Recorder({
  meetingId,
  companyId,
  language,
  active,
  onChange,
  bindStop,
}: {
  meetingId: string;
  companyId: string;
  language: string;
  /** Someone (maybe on another device) is recording now. */
  active: boolean;
  onChange: () => void;
  /** Gets the "stop and save" function while recording (so ending the meeting saves the last piece first). */
  bindStop?: (stop: (() => Promise<void>) | null) => void;
}) {
  const tr = useTr();
  const [state, setState] = useState<"idle" | "confirm" | "starting" | "recording" | "stopping">("idle");
  const [started, setStarted] = useState(0);
  const [now, setNow] = useState(0);
  const [waiting, setWaiting] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const streamRef = useRef<MediaStream | null>(null);
  const takeRef = useRef<Take | null>(null);
  const busyRef = useRef(false);
  const lockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const rollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const langRef = useRef(language);
  langRef.current = language;

  useEffect(() => {
    setSupported(!!pickMime() && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  useEffect(() => {
    if (state !== "recording") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state]);

  // Leaving the page while recording: the browser asks first.
  useEffect(() => {
    if (state !== "recording" && state !== "stopping") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  useEffect(
    () => () => {
      if (rollRef.current) clearTimeout(rollRef.current);
      takeRef.current?.rec.state !== "inactive" && takeRef.current?.rec.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void lockRef.current?.release().catch(() => undefined);
    },
    [],
  );

  /** Uploads the waiting pieces in order, retrying a few times; a piece that keeps failing waits for the next round. */
  const pump = async (take: Take) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const supabase = createClient();
    try {
      while (take.queue.length) {
        const p = take.queue[0];
        const path = `${take.prefix}${String(p.seq).padStart(4, "0")}.${extFor(take.mime)}`;
        const up = await supabase.storage.from(RECORDING_BUCKET).upload(path, p.blob, { contentType: take.mime.split(";")[0], upsert: false });
        const exists = !!up.error && /exists|duplicate|409/i.test(`${up.error.message} ${(up.error as { statusCode?: string }).statusCode ?? ""}`);
        if (up.error && !exists) {
          p.tries += 1;
          if (p.tries >= 4) {
            setError(tr("The recording could not be uploaded. Check the internet connection; it keeps trying."));
            break;
          }
          await sleep(2000 * p.tries);
          continue;
        }
        const add = await supabase.rpc("meeting_recording_add_part", { p_recording: take.id, p_seq: p.seq, p_path: path, p_bytes: p.blob.size, p_ms: p.ms });
        if (add.error) {
          p.tries += 1;
          if (p.tries >= 4) {
            setError(add.error.message);
            break;
          }
          await sleep(2000 * p.tries);
          continue;
        }
        take.queue.shift();
        setError(null);
      }
    } finally {
      busyRef.current = false;
      setWaiting(take.queue.length);
    }
  };

  /** One recording file: a new row in the database and a MediaRecorder on the open microphone. */
  const begin = async (stream: MediaStream, mime: string): Promise<Take> => {
    const supabase = createClient();
    const { data, error: e } = await supabase.rpc("meeting_recording_start", { p_meeting: meetingId, p_mime: mime, p_language: langRef.current });
    if (e || typeof data !== "string") throw new Error(e?.message ?? tr("The recording could not start."));
    const rec = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 });
    let resolveStop: () => void = () => undefined;
    const stopped = new Promise<void>((r) => (resolveStop = r));
    const take: Take = { id: data, prefix: `${companyId}/${meetingId}/${data}/`, mime, seq: 0, last: Date.now(), queue: [], rec, stopped };
    rec.ondataavailable = (ev) => {
      if (!ev.data || ev.data.size === 0) return;
      const t = Date.now();
      take.queue.push({ seq: take.seq++, blob: ev.data, ms: Math.min(t - take.last, 3_600_000), tries: 0 });
      take.last = t;
      setWaiting(take.queue.length);
      void pump(take);
    };
    rec.onstop = () => resolveStop();
    rec.start(RECORDING_SLICE_MS);
    return take;
  };

  /** Ends the current file: the last piece is uploaded, then the recording is closed. */
  const finish = async (take: Take) => {
    if (take.rec.state !== "inactive") take.rec.stop();
    await take.stopped;
    for (let i = 0; i < 20 && (take.queue.length || busyRef.current); i++) {
      await pump(take);
      if (take.queue.length || busyRef.current) await sleep(1000);
    }
    const { error: e } = await createClient().rpc("meeting_recording_stop", { p_recording: take.id });
    if (e) setError(e.message);
  };

  const scheduleRollover = (stream: MediaStream, mime: string) => {
    rollRef.current = setTimeout(async () => {
      const old = takeRef.current;
      if (!old) return;
      try {
        // The old file stops and the new one starts at once; the old one's last pieces upload behind it.
        if (old.rec.state !== "inactive") old.rec.stop();
        takeRef.current = await begin(stream, mime);
        scheduleRollover(stream, mime);
        void finish(old);
      } catch (e) {
        setError((e as Error).message);
      }
    }, RECORDING_ROLLOVER_MS);
  };

  const start = async () => {
    const mime = pickMime();
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      setSupported(false);
      return;
    }
    setState("starting");
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = stream;
      takeRef.current = await begin(stream, mime);
      scheduleRollover(stream, mime);
      try {
        lockRef.current = await (navigator as unknown as { wakeLock?: { request: (k: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request("screen") ?? null;
      } catch {
        /* the screen may dim; recording continues while the page is open */
      }
      setStarted(Date.now());
      setNow(Date.now());
      setState("recording");
      bindStop?.(stop);
      onChange();
    } catch (e) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      const name = (e as { name?: string }).name;
      setError(name === "NotAllowedError" ? tr("The microphone is blocked. Allow it for this site in the browser settings.") : (e as Error).message);
      setState("idle");
    }
  };

  async function stop() {
    bindStop?.(null);
    setState("stopping");
    if (rollRef.current) clearTimeout(rollRef.current);
    const take = takeRef.current;
    try {
      if (take) await finish(take);
    } catch (e) {
      setError((e as Error).message);
    }
    takeRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void lockRef.current?.release().catch(() => undefined);
    lockRef.current = null;
    setState("idle");
    onChange();
  }

  if (!supported) {
    return <p className="small muted">{tr("This browser cannot record audio. Use Chrome, Edge or Safari (iPhone 14.3 or newer).")}</p>;
  }

  return (
    <div className={styles.recorder}>
      {state === "recording" || state === "stopping" ? (
        <>
          <span className={styles.recTime} aria-live="polite">
            <span className={styles.recDot} aria-hidden="true" />
            {tr("Recording")} {clock(now - started)}
          </span>
          <button type="button" className="btn" onClick={stop} disabled={state === "stopping"}>
            {state === "stopping" ? tr("Saving…") : tr("Stop recording")}
          </button>
          {waiting > 1 && <span className="small muted">{tr("Uploading")} ({waiting})</span>}
        </>
      ) : state === "confirm" ? (
        <div className={styles.recConfirm}>
          <p className="small">{tr("Tell everyone the meeting is being recorded. They will see a red Recording banner, and guests are told on their join page.")}</p>
          <div className="inline-form" style={{ gap: 6 }}>
            <button type="button" className="btn btn-danger" onClick={start}>
              {tr("Start recording")}
            </button>
            <button type="button" className="btn" onClick={() => setState("idle")}>
              {tr("Not now")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn" onClick={() => setState("confirm")} disabled={state === "starting" || active}>
          <span className={styles.recDotIdle} aria-hidden="true" />
          {state === "starting" ? tr("Starting…") : active ? tr("Recording on another device") : tr("Record")}
        </button>
      )}
      {error && <p className="small text-warn">{error}</p>}
    </div>
  );
}
