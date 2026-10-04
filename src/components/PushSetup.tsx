"use client";

import { useTr } from "@/lib/tr-client";
import { useEffect, useState } from "react";
import { removePushSubscription, savePushSubscription } from "@/app/(app)/notifications/actions";

function keyToBytes(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = "checking" | "unsupported" | "ios-install" | "blocked" | "off" | "on" | "busy";

/** Turns phone notifications on or off for this device. */
export function PushSetup({ vapidKey }: { vapidKey: string | null }) {
  const tr = useTr();
  const [state, setState] = useState<State>("checking");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(ios && !standalone ? "ios-install" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("blocked");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  async function turnOn() {
    if (!vapidKey) return;
    setState("busy");
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(vapidKey) });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const res = await savePushSubscription(json, navigator.userAgent);
      if ("error" in res && res.error) throw new Error(res.error);
      setState("on");
      setMessage("Notifications are on for this device.");
    } catch (e) {
      setState("off");
      setMessage(`Could not turn on notifications: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function turnOff() {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setMessage("Notifications are off for this device.");
    } catch {
      setState("on");
    }
  }

  if (!vapidKey) return <p className="small muted">{tr("Phone notifications are not set up on the server yet (ask management).")}</p>;
  return (
    <div>
      {state === "checking" && <p className="small muted">{tr("Checking this device…")}</p>}
      {state === "unsupported" && <p className="small muted">{tr("This browser cannot receive notifications. Try Chrome on Android, or Safari on iPhone.")}</p>}
      {state === "ios-install" && (
        <p className="small">{tr("On iPhone, first add the app to your Home Screen: tap")}{" "}<strong>{tr("Share")}</strong> → <strong>{tr("Add to Home Screen")}</strong>{tr(", open it from there, then come back to this page.")}</p>
      )}
      {state === "blocked" && (
        <p className="small text-warn">{tr("Notifications are blocked for this site. Allow them in your browser or phone settings, then reload.")}</p>
      )}
      {(state === "off" || state === "busy") && (
        <button type="button" className="btn btn-primary" onClick={turnOn} disabled={state === "busy"}>
          {state === "busy" ? tr("Turning on…") : tr("Turn on notifications on this device")}
        </button>
      )}
      {state === "on" && (
        <div className="row">
          <span className="badge tone-ok">{tr("On for this device")}</span>
          <button type="button" className="btn btn-small" onClick={turnOff}>{tr("Turn off")}</button>
        </div>
      )}
      {message && <p className="small">{message}</p>}
    </div>
  );
}
