import { signOut } from "@/app/actions";
import type { SearchParams } from "@/lib/messages";

export const metadata = { title: "Setup needed" };

export default async function SetupNeededPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = (await searchParams) ?? {};
  const code = typeof sp.code === "string" ? sp.code : "";
  const detail = typeof sp.detail === "string" ? sp.detail : "";
  const permission = code === "42501" || /permission denied/i.test(detail);

  return (
    <div className="auth-wrap">
      <img className="auth-logo" src="/brand/lemo-ims-on-dark.svg" alt="LeMo IMS" />
      <div className="auth-card">
        {detail ? (
          <>
            <h1>The database refused the request</h1>
            <p className="muted">
              {permission
                ? "Signed-in users don't have access to the app's tables yet."
                : "The app couldn't read your company from the database."}{" "}
              An administrator can fix this by running the latest setup file in Supabase → SQL Editor.
            </p>
            <p className="notice notice-error small">
              <strong>Details for support:</strong> {code && <code>{code}</code>} {detail}
            </p>
          </>
        ) : (
          <>
            <h1>The database isn&apos;t set up yet</h1>
            <p className="muted">
              You signed in successfully, but the app&apos;s tables aren&apos;t in the database yet. An administrator needs
              to run the setup file once in Supabase:
            </p>
            <ol className="small">
              <li>Supabase → SQL Editor → New query</li>
              <li>
                Paste the <strong>contents</strong> of <code>supabase/scripts/stage1_reset_and_setup.sql</code>
              </li>
              <li>Press Run, and wait for &ldquo;Success. No rows returned&rdquo;</li>
            </ol>
          </>
        )}
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
      <p className="auth-foot">LeMo IMS · by LeMo Tech Solutions</p>
    </div>
  );
}
