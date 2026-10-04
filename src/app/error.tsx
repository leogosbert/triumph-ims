"use client";

import { useTr } from "@/lib/tr-client";
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const tr = useTr();
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>{tr("Something went wrong")}</h1>
        <p className="muted">{tr("The page could not load. Check your internet connection and try again. If it keeps happening, send this reference to support:")}{" "}<code>{error.digest ?? tr("no reference")}</code>
        </p>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => reset()}>{tr("Try again")}</button>
          <a className="btn" href="/login">{tr("Back to sign in")}</a>
        </div>
      </div>
    </div>
  );
}
