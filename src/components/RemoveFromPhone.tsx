"use client";

import Link from "next/link";
import { useState } from "react";
import { signOutThisDevice } from "@/app/deletion-actions";
import { useTr } from "@/lib/tr-client";

/**
 * Delivery confirmations saved by the driver screen while offline (DriverApp.tsx: "ims-pod" / "queue"),
 * including ones the server refused (they still hold the signature and photo).
 * null = could not check (then we warn rather than clear silently).
 */
async function unsentDeliveries(): Promise<number | null> {
  if (typeof indexedDB === "undefined") return 0;
  try {
    if (typeof indexedDB.databases === "function") {
      const dbs = await indexedDB.databases();
      if (!dbs.some((d) => d.name === "ims-pod")) return 0;
    }
    return await new Promise<number | null>((resolve) => {
      const req = indexedDB.open("ims-pod");
      req.onerror = () => resolve(null);
      req.onupgradeneeded = () => {
        // It did not exist: nothing waiting (and do not leave an empty one behind).
        req.transaction?.abort();
        resolve(0);
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("queue")) {
          db.close();
          resolve(0);
          return;
        }
        const tx = db.transaction("queue", "readonly");
        const all = tx.objectStore("queue").getAll();
        all.onsuccess = () => {
          db.close();
          resolve((all.result ?? []).length);
        };
        all.onerror = () => {
          db.close();
          resolve(null);
        };
      };
    });
  } catch {
    return null;
  }
}

async function clearEverything() {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
  } catch {
    /* no service worker */
  }
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* no caches */
  }
  try {
    localStorage.clear();
  } catch {
    /* blocked */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* blocked */
  }
  try {
    const names =
      typeof indexedDB.databases === "function"
        ? ((await indexedDB.databases()).map((d) => d.name).filter(Boolean) as string[])
        : ["ims-pod"];
    await Promise.all(
      names.map(
        (name) =>
          new Promise<void>((resolve) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = req.onerror = req.onblocked = () => resolve();
          }),
      ),
    );
  } catch {
    /* no IndexedDB */
  }
}

/**
 * "Remove LeMoSp from this phone": how to uninstall on Android and iPhone, and a button that
 * clears everything this app keeps on the device (offline pages, saved settings, the driver's
 * offline deliveries) and signs out. Uninstalling never deletes the account.
 */
export function RemoveFromPhone({ admin = false }: { admin?: boolean }) {
  const tr = useTr();
  const [state, setState] = useState<"idle" | "checking" | "warn" | "clearing">("idle");
  const [waiting, setWaiting] = useState<number | null>(0);
  const appName = admin ? "LeMoSp ADMIN" : "LeMoSp";

  async function start() {
    setState("checking");
    const n = await unsentDeliveries();
    if (n === null || n > 0) {
      setWaiting(n);
      setState("warn");
      return;
    }
    await clear();
  }

  async function clear() {
    setState("clearing");
    await clearEverything();
    try {
      await signOutThisDevice();
    } catch {
      /* signed out below anyway */
    }
    window.location.replace("/login");
  }

  return (
    <div className="rm-app">
      <p className="small muted" style={{ marginTop: 0 }}>
        {tr("Removing the app from this phone does not delete your account.")}{" "}
        {admin ? (
          <Link href="/delete-account">{tr("How to delete an account")}</Link>
        ) : (
          <Link href="/delete-my-account">{tr("Delete my account")}</Link>
        )}
      </p>
      <div className="rm-steps">
        <div>
          <h3>{tr("Android")}</h3>
          <ol>
            <li>
              {tr("Press and hold the")} {appName} {tr("icon.")}
            </li>
            <li>{tr("Choose Uninstall or Remove (or App info → Uninstall).")}</li>
          </ol>
        </div>
        <div>
          <h3>{tr("iPhone")}</h3>
          <ol>
            <li>
              {tr("Press and hold the")} {appName} {tr("icon.")}
            </li>
            <li>{tr("Choose Remove App, then Delete from Home Screen.")}</li>
          </ol>
        </div>
      </div>
      <p className="small muted">{tr("Before you remove it, clear what the app keeps on this phone and sign out:")}</p>
      {state === "warn" ? (
        <div className="notice notice-error rm-warn" role="alert">
          <span>
            <strong>
              {waiting === null
                ? tr("We could not check whether delivery confirmations on this phone have been sent.")
                : `${waiting} ${tr("delivery confirmations on this phone have not been sent yet.")}`}
            </strong>{" "}
            {tr("Open the driver screen with internet first so they are sent. If you clear now, they are lost.")}
          </span>
          <div className="rm-warn-actions">
            <Link href="/driver" className="btn btn-primary btn-small">
              {tr("Open the driver screen")}
            </Link>
            <button type="button" className="btn btn-small btn-danger" onClick={() => void clear()}>
              {tr("Clear anyway")}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-block" disabled={state !== "idle"} onClick={() => void start()}>
          {state === "clearing" || state === "checking" ? tr("Clearing…") : tr("Clear this device and sign out")}
        </button>
      )}
    </div>
  );
}
