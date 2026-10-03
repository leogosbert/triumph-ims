"use client";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Something went wrong</h1>
        <p className="muted">
          The page could not load. Check your internet connection and try again. If it keeps happening, send this
          reference to support: <code>{error.digest ?? "no reference"}</code>
        </p>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => reset()}>
            Try again
          </button>
          <a className="btn" href="/login">
            Back to sign in
          </a>
        </div>
      </div>
    </div>
  );
}
