import { Notice } from "@/components/Notice";
import { PasswordInput } from "@/components/PasswordInput";
import { SubmitButton } from "@/components/SubmitButton";
import { signOut, switchCompany } from "@/app/actions";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { ROLE_LABELS } from "@/lib/roles";
import { changePassword, updateProfile } from "./actions";

export const metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const notice = await readNotice(searchParams);
  const reset = (await searchParams)?.reset === "1";
  const { profile, user, memberships, membership } = await getAppContext();

  return (
    <>
      <h1>Your account</h1>
      <Notice {...notice} />
      {reset && !notice.msg && !notice.error && (
        <p className="notice notice-ok">You&apos;re signed in. Choose a new password below.</p>
      )}

      <section className="card">
        <h2>Your details</h2>
        <form action={updateProfile}>
          <div className="field">
            <label htmlFor="full_name">Full name</label>
            <input id="full_name" name="full_name" type="text" defaultValue={profile.full_name ?? ""} required />
          </div>
          <div className="field">
            <label htmlFor="phone">Phone</label>
            <input id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} />
          </div>
          <div className="field">
            <label>Email</label>
            <span className="muted">{user.email}</span>
          </div>
          <SubmitButton>Save</SubmitButton>
        </form>
      </section>

      <section className="card" id="password">
        <h2>Change password</h2>
        <form action={changePassword}>
          <div className="field">
            <label htmlFor="password">New password</label>
            <PasswordInput id="password" name="password" minLength={8} autoComplete="new-password" />
          </div>
          <div className="field">
            <label htmlFor="confirm">Type it again</label>
            <PasswordInput id="confirm" name="confirm" minLength={8} autoComplete="new-password" />
          </div>
          <SubmitButton>Change password</SubmitButton>
        </form>
      </section>

      {memberships.length > 1 && (
        <section className="card">
          <h2>Your companies</h2>
          <ul className="list">
            {memberships.map((m) => (
              <li key={m.id} className="row">
                <div>
                  <strong>{m.company.name}</strong>
                  <div className="muted small">{ROLE_LABELS[m.role]}</div>
                </div>
                {m.id === membership.id ? (
                  <span className="badge">Current</span>
                ) : (
                  <form action={switchCompany}>
                    <input type="hidden" name="company_id" value={m.company_id} />
                    <SubmitButton className="btn btn-small" pendingText="Switching…">
                      Switch
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form action={signOut}>
        <SubmitButton className="btn btn-block btn-danger" pendingText="Signing out…">
          Sign out
        </SubmitButton>
      </form>
    </>
  );
}
