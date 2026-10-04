"use client";

import { useEffect, useRef, useState } from "react";
import { BUILD_ID } from "@/lib/releases";
import { useTr } from "@/lib/tr-client";

type Live = { build: string; version: string; date: string; en: string[]; sw: string[] };

const CHECK_EVERY = 10 * 60 * 1000; // 10 minutes
const SNOOZE = 30 * 60 * 1000; // "Later" hides it for 30 minutes

/** Pops up when a newer version of LeMoSp has been published, with what's new and an Update button. */
export function UpdatePrompt({ lang }: { lang: "en" | "sw" }) {
  const tr = useTr();
  const [live, setLive] = useState<Live | null>(null);
  const [leaving, setLeaving] = useState(false);
  const snoozedUntil = useRef(0);

  useEffect(() => {
    if (!BUILD_ID || BUILD_ID.startsWith("local-")) return;
    let stop = false;
    async function check() {
      if (stop || Date.now() < snoozedUntil.current || document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as Live;
        if (data.build && data.build !== BUILD_ID) setLive(data);
      } catch {
        /* offline: try later */
      }
    }
    const first = setTimeout(check, 8000);
    const every = setInterval(check, CHECK_EVERY);
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(every);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
    };
  }, []);

  async function update() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
    } catch {
      /* not installed: a reload is enough */
    }
    window.location.reload();
  }

  function later() {
    snoozedUntil.current = Date.now() + SNOOZE;
    setLeaving(true);
    setTimeout(() => {
      setLive(null);
      setLeaving(false);
    }, 260);
  }

  if (!live) return null;
  const notes = lang === "sw" ? live.sw : live.en;

  return (
    <div className={`upd${leaving ? " leaving" : ""}`} role="dialog" aria-labelledby="upd-title">
      <div className="upd-card">
        <div className="upd-head">
          <span className="upd-badge">v{live.version}</span>
          <strong id="upd-title">{tr("A new version of LeMoSp is ready")}</strong>
        </div>
        {notes.length > 0 && (
          <>
            <span className="upd-label">{tr("What's new")}</span>
            <ul className="upd-notes">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </>
        )}
        <p className="upd-hint">{tr("Save anything you are typing first. Updating takes a few seconds.")}</p>
        <div className="upd-actions">
          <button type="button" className="btn btn-primary" onClick={update}>
            {tr("Update now")}
          </button>
          <button type="button" className="btn" onClick={later}>
            {tr("Later")}
          </button>
        </div>
      </div>
    </div>
  );
}
