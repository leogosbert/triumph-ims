"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card">
      <h1>Something went wrong</h1>
      <p className="muted">
        The page could not load. Check your internet connection and try again. If it keeps happening, send this
        reference to support: <code>{error.digest ?? "no reference"}</code>
      </p>
      <button className="btn btn-primary" onClick={() => reset()}>
        Try again
      </button>
    </div>
  );
}
