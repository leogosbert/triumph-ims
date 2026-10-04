"use client";

import { useEffect, useState } from "react";
import { useTr } from "@/lib/tr-client";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type Mode = "android-button" | "android-steps" | "ios" | null;

const KEY = "lemosp-install-dismissed";
const SNOOZE_DAYS = 7;

function snoozed() {
  try {
    const v = Number(localStorage.getItem(KEY) || 0);
    return v > 0 && Date.now() - v < SNOOZE_DAYS * 864e5;
  } catch {
    return false;
  }
}

/**
 * "Install this app on your phone" card, shown when LeMoSp is opened in a phone browser.
 * Android (Chrome, Edge, Samsung): a one-tap Install button.
 * iPhone/iPad: Apple has no install button for websites, so the card shows the two taps.
 * Hidden once installed, and for a week after "Not now".
 */
export function InstallPrompt() {
  const tr = useTr();
  const [mode, setMode] = useState<Mode>(null);
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;

    // Lets the app work offline-first and makes Android offer installation.
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);

    const ua = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const android = /Android/i.test(ua);
    if (!ios && !android) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const show = (m: Mode) => {
      if (snoozed()) return;
      clearTimeout(timer);
      // Wait for the launch animation to finish first.
      timer = setTimeout(() => setMode(m), 3200);
    };

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BIPEvent);
      show("android-button");
    };
    const onInstalled = () => setMode(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if (ios) show("ios");
    // Android browsers without the install event: show the menu steps instead.
    else timer = setTimeout(() => setMode((m) => m ?? (snoozed() ? null : "android-steps")), 6000);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function close(remember: boolean) {
    if (remember) {
      try {
        localStorage.setItem(KEY, String(Date.now()));
      } catch {
        /* private mode: just hide for now */
      }
    }
    setLeaving(true);
    setTimeout(() => {
      setMode(null);
      setLeaving(false);
    }, 260);
  }

  async function install() {
    if (!evt) return;
    await evt.prompt();
    const choice = await evt.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    setEvt(null);
    close(choice.outcome !== "accepted");
  }

  if (!mode) return null;

  return (
    <div className={`install-card${leaving ? " leaving" : ""}`} role="dialog" aria-label={tr("Install LeMoSp on this phone")}>
      <img src="/icons/icon-192.png" alt="" className="install-icon" />
      <div className="install-body">
        <strong>{tr("Install LeMoSp on this phone")}</strong>
        {mode === "android-button" && <span>{tr("Opens from your home screen like any app, full screen and faster.")}</span>}
        {mode === "android-steps" && (
          <span>
            {tr("Tap the browser menu")} <b aria-hidden>⋮</b> {tr("then")} <b>{tr("Install app")}</b> {tr("or")}{" "}
            <b>{tr("Add to Home screen")}</b>.
          </span>
        )}
        {mode === "ios" && (
          <span>
            {tr("Tap")}{" "}
            <svg className="ios-share" viewBox="0 0 24 24" aria-label={tr("Share")} role="img">
              <path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>{" "}
            <b>{tr("Share")}</b> {tr("in Safari (on newer iPhones it is under")} <b aria-hidden>⋯</b>{tr("), then")}{" "}
            <b>{tr("Add to Home Screen")}</b>.
          </span>
        )}
        <div className="install-actions">
          {mode === "android-button" && (
            <button type="button" className="btn btn-primary btn-small" onClick={install}>
              {tr("Install app")}
            </button>
          )}
          <button type="button" className="btn btn-small install-later" onClick={() => close(true)}>
            {mode === "android-button" ? tr("Not now") : tr("Got it")}
          </button>
        </div>
      </div>
      <button type="button" className="install-x" onClick={() => close(true)} aria-label={tr("Close")}>
        ×
      </button>
      {mode === "ios" && <span className="install-arrow" aria-hidden />}
    </div>
  );
}
