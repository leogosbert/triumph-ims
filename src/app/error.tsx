"use client";

import { useEffect, useState } from "react";
import { useTr } from "@/lib/tr-client";

/** A public page that failed to load: offline reads differently from a server-side problem. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const tr = useTr();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(typeof navigator !== "undefined" && navigator.onLine === false);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <div className="auth-wrap">
      <div className="auth-card" role="alert">
        <h1>{offline ? tr("You're offline") : tr("Something went wrong")}</h1>
        {offline ? (
          <p className="muted">{tr("This page needs the internet. Check your connection, then try again.")}</p>
        ) : (
          <p className="muted">
            {tr("This page hit a problem on our side. Try again; if it keeps happening, send this reference to support:")}{" "}
            <code>{error.digest ?? tr("no reference")}</code>
          </p>
        )}
        <div className="actions">
          <button className="btn btn-primary" type="button" onClick={() => reset()}>
            {tr("Try again")}
          </button>
          <a className="btn" href="/">
            {tr("Go to the start")}
          </a>
        </div>
      </div>
    </div>
  );
}
