import { primeLang, tr } from "@/lib/tr";
import { signOut } from "@/app/actions";
import type { SearchParams } from "@/lib/messages";

export const metadata = { title: "Setup needed" };

export default async function SetupNeededPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const code = typeof sp.code === "string" ? sp.code : "";
  const detail = typeof sp.detail === "string" ? sp.detail : "";
  const permission = code === "42501" || /permission denied/i.test(detail);

  return (
    <div className="auth-wrap">
      <img className="auth-logo" src="/brand/lemo-sm-on-dark.svg" alt={tr("LeMo Suppliers Manager")} />
      <div className="auth-card">
        {detail ? (
          <>
            <h1>{tr("The database refused the request")}</h1>
            <p className="muted">
              {permission
                ? tr("Signed-in users don't have access to the app's tables yet.")
                : tr("The app couldn't read your company from the database.")}{" "}{tr("An administrator can fix this by running the latest setup file in Supabase → SQL Editor.")}</p>
            <p className="notice notice-error small">
              <strong>{tr("Details for support:")}</strong> {code && <code>{code}</code>} {detail}
            </p>
          </>
        ) : (
          <>
            <h1>{tr("The database isn't set up yet")}</h1>
            <p className="muted">{tr("You signed in successfully, but the app's tables aren't in the database yet. An administrator needs to run the setup file once in Supabase:")}</p>
            <ol className="small">
              <li>{tr("Supabase → SQL Editor → New query")}</li>
              <li>{tr("Paste the")}{" "}<strong>{tr("contents")}</strong>{" "}{tr("of")}{" "}<code>supabase/scripts/stage1_reset_and_setup.sql</code>
              </li>
              <li>{tr("Press Run, and wait for “Success. No rows returned”")}</li>
            </ol>
          </>
        )}
        <p className="muted small">{tr("Then reload this app.")}</p>
        <div className="actions">
          <a className="btn btn-primary" href="/">{tr("Reload")}</a>
          <form action={signOut}>
            <button className="btn" type="submit">{tr("Sign out")}</button>
          </form>
        </div>
      </div>
      <p className="auth-foot">{tr("LeMo Suppliers Manager · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
