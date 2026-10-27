"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTr } from "@/lib/tr-client";

/**
 * A screen that failed to load. Offline (the phone says so) and a server-side problem read
 * differently: only the first is about the connection. Either way: try again, or go home.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
    <div className="card" role="alert">
      {offline ? (
        <>
          <h1>{tr("You're offline")}</h1>
          <p className="muted">{tr("This screen needs the internet. Check your connection, then try again.")}</p>
        </>
      ) : (
        <>
          <h1>{tr("Something went wrong")}</h1>
          <p className="muted">
            {tr("This screen hit a problem on our side. Try again; if it keeps happening, send this reference to support:")}{" "}
            <code>{error.digest ?? tr("no reference")}</code>
          </p>
        </>
      )}
      <div className="actions">
        <button className="btn btn-primary" type="button" onClick={() => reset()}>
          {tr("Try again")}
        </button>
        <Link className="btn" href="/">
          {tr("Home")}
        </Link>
      </div>
    </div>
  );
}
