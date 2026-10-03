import { signOut } from "@/app/actions";

export const metadata = { title: "Setup needed" };

export default function SetupNeededPage() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>The database isn&apos;t set up yet</h1>
        <p className="muted">
          You signed in successfully, but the app&apos;s tables aren&apos;t in the database yet. An administrator needs to
          run the setup file once in Supabase:
        </p>
        <ol className="small">
          <li>Supabase → SQL Editor → New query</li>
          <li>
            Paste the <strong>contents</strong> of <code>supabase/migrations/20261003000100_stage1_foundation.sql</code>
          </li>
          <li>Press Run, and wait for &ldquo;Success. No rows returned&rdquo;</li>
        </ol>
        <p className="muted small">Then reload this app.</p>
        <div className="actions">
          <a className="btn btn-primary" href="/">
            Reload
          </a>
          <form action={signOut}>
            <button className="btn" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
