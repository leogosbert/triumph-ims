"use client";

import { useEffect, useRef, useState } from "react";
import { useTr } from "@/lib/tr-client";
import { recordingFiles } from "./recording-actions";

/**
 * Plays a recording: its pieces (one continuous stream) are fetched with short-lived signed links and joined in the
 * browser, so the player can seek through the whole meeting. Nothing is fetched until Play is pressed.
 */
export function RecordingPlayer({ recordingId, label }: { recordingId: string; label: string }) {
  const tr = useTr();
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);

  const load = async () => {
    setState("loading");
    setError(null);
    setProgress(0);
    const res = await recordingFiles(recordingId).catch(() => ({ error: tr("The recording could not be opened. Try again.") }));
    if ("error" in res) {
      setError(tr(res.error));
      setState("error");
      return;
    }
    const parts: Blob[] = [];
    for (const [i, u] of res.urls.entries()) {
      const r = await fetch(u).catch(() => null);
      if (!r?.ok) {
        setError(tr("Part of the recording could not be loaded. Check the connection and try again."));
        setState("error");
        return;
      }
      parts.push(await r.blob());
      setProgress(Math.round(((i + 1) / res.urls.length) * 100));
    }
    setSrc(URL.createObjectURL(new Blob(parts, { type: res.mime.split(";")[0] })));
    setState("ready");
  };

  // Recordings made in the browser carry no length; jumping to the end once makes the player work it out,
  // so the time bar and seeking work.
  const fixDuration = () => {
    const a = audio.current;
    if (!a || Number.isFinite(a.duration)) return;
    const back = () => {
      a.removeEventListener("timeupdate", back);
      a.currentTime = 0;
    };
    a.addEventListener("timeupdate", back);
    a.currentTime = 1e9;
  };

  if (state === "ready" && src) {
    return <audio ref={audio} controls autoPlay src={src} onLoadedMetadata={fixDuration} aria-label={label} preload="auto" />;
  }
  return (
    <div className="inline-form" style={{ gap: 8, marginTop: 8 }}>
      <button type="button" className="btn btn-primary" onClick={load} disabled={state === "loading"}>
        {state === "loading" ? `${tr("Loading")} ${progress}%` : `▶ ${tr("Play")}`}
      </button>
      {error && <span className="small text-warn">{error}</span>}
    </div>
  );
}
