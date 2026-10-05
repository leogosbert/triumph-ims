"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { BUILD_ID } from "@/lib/releases";
import { useTr } from "@/lib/tr-client";

type Live = { build: string; version: string; date: string; en: string[]; sw: string[] };

const CHECK_EVERY = 10 * 60 * 1000; // 10 minutes
const MIN_GAP = 20 * 1000; // focus + visibility + pageshow often fire together: one check is enough
const BUST = "_v"; // cache-busting parameter added by "Update now", removed again after loading
const LATER_KEY = "lemosp.update.later"; // build the person said "Later" to (this app session)
const TRIED_KEY = "lemosp.update.tried"; // build we already reloaded for (stops a reload loop)

function sessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function sessionSet(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked: the note simply shows again */
  }
}

/** Wait (at most `ms`) for a new service worker to take control of this page. */
function controllerChange(ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        navigator.serviceWorker.removeEventListener("controllerchange", finish);
      } catch {
        /* ignore */
      }
      resolve();
    };
    try {
      navigator.serviceWorker.addEventListener("controllerchange", finish);
    } catch {
      /* ignore */
    }
    window.setTimeout(finish, ms);
  });
}

/**
 * Tells people when a newer version of LeMoSp has been published, with what's new and an
 * Update button. Works the same in a browser tab, in the installed phone app (Android / iPhone)
 * and in the admin app, because it only uses addresses relative to the current site.
 *
 * Checks: right after start, every 10 minutes, and whenever the app comes back to the front
 * (visibility, focus, pageshow — installed apps are often resumed, not reloaded — and online).
 * "Later" hides the card but leaves a small "Update available" pill in the top bar.
 */
export function UpdatePrompt({ lang }: { lang: "en" | "sw" }) {
  const tr = useTr();
  const pathname = usePathname();
  const [live, setLive] = useState<Live | null>(null);
  const [later, setLater] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState<Element | null>(null);
  const lastCheck = useRef(0);

  // After "Update now": take the cache-busting parameter off the address again.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has(BUST)) {
        url.searchParams.delete(BUST);
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!BUILD_ID || BUILD_ID.startsWith("local-")) return;
    let stop = false;
    async function check(force = false) {
      if (stop || document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!force && now - (lastCheck.current ?? 0) < MIN_GAP) return;
      lastCheck.current = now;
      try {
        const res = await fetch(`/api/version?t=${now}`, { cache: "no-store", headers: { "Cache-Control": "no-cache" } });
        if (!res.ok) return;
        const data = (await res.json()) as Live;
        if (stop || !data || typeof data.build !== "string" || !data.build || data.build === BUILD_ID) return;
        setLive(data);
        // Already said "Later" to this version, or we already reloaded for it and the old
        // version came back (the new one is still spreading): show only the small pill.
        if (sessionGet(LATER_KEY) === data.build || sessionGet(TRIED_KEY) === data.build) setLater(true);
      } catch {
        /* offline: try later */
      }
    }
    const first = window.setTimeout(() => check(true), 1500);
    const every = window.setInterval(() => check(true), CHECK_EVERY);
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const onShow = () => check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    window.addEventListener("online", onShow);
    return () => {
      stop = true;
      window.clearTimeout(first);
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
      window.removeEventListener("online", onShow);
    };
  }, []);

  // Where the pill goes: the app's top bar when there is one (company app, admin app),
  // otherwise it floats at the top of the screen (sign-in pages).
  useEffect(() => {
    if (!live || !later) return;
    try {
      setSlot(document.querySelector(".topbar-actions"));
    } catch {
      setSlot(null);
    }
  }, [live, later, pathname]);

  const update = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    if (live) sessionSet(TRIED_KEY, live.build);
    try {
      const sw = navigator.serviceWorker;
      const reg = sw ? await sw.getRegistration() : undefined;
      if (reg) {
        try {
          await reg.update();
        } catch {
          /* offline or not allowed: the reload below still gets the new pages */
        }
        // A new service worker that is waiting: let it take over before reloading.
        const next = reg.waiting ?? reg.installing;
        if (next) {
          next.postMessage({ type: "skipWaiting" });
          await controllerChange(3000);
        }
      }
    } catch {
      /* no service worker: a reload is enough */
    }
    // The app's own files have new names in every version, so no cache needs clearing (and the
    // drivers' offline deliveries are kept). A fresh address makes sure the page itself is new.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set(BUST, String(Date.now()));
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  }, [busy, live]);

  function snooze() {
    if (live) sessionSet(LATER_KEY, live.build);
    setLeaving(true);
    window.setTimeout(() => {
      setLater(true);
      setLeaving(false);
    }, 260);
  }

  if (!live) return null;

  if (later) {
    const pill = (
      <button
        type="button"
        className={`upd-pill${slot ? "" : " floating"}`}
        onClick={update}
        disabled={busy}
        aria-label={`${tr("Update available")} v${live.version}`}
      >
        <span className="upd-pill-dot" aria-hidden="true" />
        {busy ? tr("Updating…") : tr("Update available")}
      </button>
    );
    return slot && slot.isConnected ? createPortal(pill, slot) : pill;
  }

  const notes = (lang === "sw" ? live.sw : live.en) ?? [];

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
          <button type="button" className="btn btn-primary" onClick={update} disabled={busy}>
            {busy ? tr("Updating…") : tr("Update now")}
          </button>
          <button type="button" className="btn" onClick={snooze} disabled={busy}>
            {tr("Later")}
          </button>
        </div>
      </div>
    </div>
  );
}
