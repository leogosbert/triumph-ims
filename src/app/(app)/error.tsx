"use client";

import { useTr } from "@/lib/tr-client";
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const tr = useTr();
  return (
    <div className="card">
      <h1>{tr("Something went wrong")}</h1>
      <p className="muted">{tr("The page could not load. Check your internet connection and try again. If it keeps happening, send this reference to support:")}{" "}<code>{error.digest ?? tr("no reference")}</code>
      </p>
      <button className="btn btn-primary" onClick={() => reset()}>{tr("Try again")}</button>
    </div>
  );
}
