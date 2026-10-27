"use client";

import { useEffect, useState } from "react";
import { useTr } from "@/lib/tr-client";
import { guestJoin, guestStatus } from "./actions";
import styles from "../../(app)/meetings/meetings.module.css";

/**
 * Join for a guest. A call in the app (Daily) opens inside this page, under the red Recording banner when the
 * meeting is recorded; Jitsi or the other side's own link opens in a new tab while this page keeps showing the banner.
 */
export function GuestJoin({ token, initialRecording, external }: { token: string; initialRecording: boolean; external: boolean }) {
  const tr = useTr();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [call, setCall] = useState<{ url: string; embed: boolean } | null>(null);
  const [recording, setRecording] = useState(initialRecording);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const s = await guestStatus(token).catch(() => null);
      if (stop || !s) return;
      setRecording(s.recording);
      if (s.status === "held") setEnded(true);
    };
    const t = setInterval(tick, call ? 10_000 : 20_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [token, call]);

  const join = async () => {
    setBusy(true);
    setError(null);
    const r = await guestJoin(token).catch(() => ({ error: "Something went wrong. Try again." }));
    setBusy(false);
    if ("error" in r) return setError(tr(r.error));
    setCall(r);
  };

  const banner = recording && (
    <p className={styles.recBanner} role="status" style={{ margin: "0 0 10px" }}>
      <span className={styles.recDot} aria-hidden="true" />
      {tr("Recording")} · {tr("this meeting is being recorded")}
    </p>
  );

  if (ended) return <p className="muted">{tr("This meeting has ended. Thank you.")}</p>;

  if (call?.embed) {
    return (
      <div className={styles.guestRoomInline}>
        {banner}
        <iframe
          className={styles.videoFrame}
          src={call.url}
          title={tr("Video call")}
          allow="camera; microphone; fullscreen; display-capture; autoplay; clipboard-write"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    );
  }

  if (call) {
    return (
      <>
        {banner}
        <a href={call.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-block">
          {tr("Open the call")}
        </a>
        <p className="small muted" style={{ marginTop: 8 }}>
          {external ? tr("It opens in Zoom, Teams or Google Meet.") : tr("It opens in a new tab or the Jitsi Meet app. Keep this page open.")}
        </p>
      </>
    );
  }

  return (
    <>
      {banner}
      <button type="button" className="btn btn-primary btn-block" onClick={join} disabled={busy}>
        {busy ? tr("Opening…") : tr("Join the meeting")}
      </button>
      <p className="small muted" style={{ marginTop: 8 }}>
        {external ? tr("It opens in Zoom, Teams or Google Meet.") : tr("Allow the camera and microphone when your browser asks.")}
      </p>
      {error && <p className="notice notice-error">{error}</p>}
    </>
  );
}
