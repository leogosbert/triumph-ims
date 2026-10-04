"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTr } from "@/lib/tr-client";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type Mode = "android-button" | "android-steps" | "ios" | null;
type Variant = "main" | "admin";

const KEYS: Record<Variant, string> = { main: "lemosp-install-dismissed", admin: "lemosp-admin-install-dismissed" };
const SNOOZE_DAYS = 7;

const isAdminPath = (p: string) => p === "/admin" || p.startsWith("/admin/");

function snoozed(key: string) {
  try {
    const v = Number(localStorage.getItem(key) || 0);
    return v > 0 && Date.now() - v < SNOOZE_DAYS * 864e5;
  } catch {
    return false;
  }
}

/*
 * The browser's install offer belongs to the manifest of the page it fired on: on /admin pages
 * that is "LeMoSp ADMIN", everywhere else the company app. Keep the latest offer here (with the
 * app it is for) so a card that mounts after the event, e.g. after moving into /admin, still gets it,
 * and the admin card never offers to install the company app (or the other way round).
 */
let offer: { evt: BIPEvent; variant: Variant } | null = null;
const listeners = new Set<(installed: boolean) => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    // Phones only: we show our own card instead of the browser's banner.
    if (!/Android/i.test(navigator.userAgent)) return;
    e.preventDefault();
    offer = { evt: e as BIPEvent, variant: isAdminPath(location.pathname) ? "admin" : "main" };
    listeners.forEach((f) => f(false));
  });
  window.addEventListener("appinstalled", () => {
    offer = null;
    listeners.forEach((f) => f(true));
  });
}

const TEXT: Record<Variant, { title: string; lead: string }> = {
  main: {
    title: "Install LeMoSp on this phone",
    lead: "Opens from your home screen like any app, full screen and faster.",
  },
  admin: {
    title: "Install LeMoSp ADMIN on this phone",
    lead: "Manage companies, features and growth rules from your home screen.",
  },
};

/**
 * "Install this app on your phone" card, shown when LeMoSp is opened in a phone browser.
 * Android (Chrome, Edge, Samsung): a one-tap Install button.
 * iPhone/iPad: Apple has no install button for websites, so the card shows the two taps.
 * Hidden once installed, and for a week after "Not now".
 *
 * variant "main" (root layout): the company app; never shown on /admin pages.
 * variant "admin" (admin layout, verified platform admins only): the separate "LeMoSp ADMIN" app.
 */
export function InstallPrompt({ variant = "main" }: { variant?: Variant }) {
  const tr = useTr();
  const pathname = usePathname() ?? "";
  const [mode, setMode] = useState<Mode>(null);
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [leaving, setLeaving] = useState(false);
  const key = KEYS[variant];

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
      if (snoozed(key)) return;
      clearTimeout(timer);
      // Wait for the launch animation to finish first.
      timer = setTimeout(() => setMode(m), 3200);
    };

    const onOffer = (installed: boolean) => {
      if (installed) {
        clearTimeout(timer);
        setEvt(null);
        setMode(null);
      } else if (offer && offer.variant === variant) {
        setEvt(offer.evt);
        show("android-button");
      }
    };
    listeners.add(onOffer);

    if (ios) show("ios");
    else if (offer?.variant === variant) onOffer(false);
    // Android browsers without the install event: show the menu steps instead.
    else timer = setTimeout(() => setMode((m) => m ?? (snoozed(key) ? null : "android-steps")), 6000);

    return () => {
      clearTimeout(timer);
      listeners.delete(onOffer);
    };
  }, [variant, key]);

  function close(remember: boolean) {
    if (remember) {
      try {
        localStorage.setItem(key, String(Date.now()));
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
    if (offer?.evt === evt) offer = null;
    setEvt(null);
    close(choice.outcome !== "accepted");
  }

  // The company-app card stays out of the admin app (the admin layout shows its own card).
  if (!mode || (variant === "main" && isAdminPath(pathname))) return null;

  const text = TEXT[variant];
  return (
    <div
      className={`install-card${variant === "admin" ? " install-admin" : ""}${leaving ? " leaving" : ""}`}
      role="dialog"
      aria-label={tr(text.title)}
    >
      <span className="install-icon-wrap">
        <img src="/icons/icon-192.png" alt="" className="install-icon" />
        {variant === "admin" && (
          <span className="install-tag" aria-hidden>
            ADMIN
          </span>
        )}
      </span>
      <div className="install-body">
        <strong>{tr(text.title)}</strong>
        {mode === "android-button" && <span>{tr(text.lead)}</span>}
        {mode !== "android-button" && variant === "admin" && <span>{tr(text.lead)}</span>}
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
