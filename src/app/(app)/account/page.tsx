import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { NewPasswordField } from "@/components/NewPasswordField";
import { SecurityPanel } from "@/components/SecurityPanel";
import { StepUpForm } from "@/components/ConfirmIdentity";
import { SignInActivity } from "@/components/SignInActivity";
import { PasswordInput } from "@/components/PasswordInput";
import { RemoveFromPhone } from "@/components/RemoveFromPhone";
import { SubmitButton } from "@/components/SubmitButton";
import { ThemePicker } from "@/components/ThemePicker";
import { BackgroundPicker } from "@/components/BackgroundPicker";
import Link from "next/link";
import { signOut, switchCompany } from "@/app/actions";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { ROLE_LABELS } from "@/lib/roles";
import { changePassword, updateProfile } from "./actions";

export const metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const reset = (await searchParams)?.reset === "1";
  const { supabase, profile, user, memberships, membership } = await getAppContext();

  return (
    <>
      <h1>{tr("Your account")}</h1>
      <Notice {...notice} />
      {reset && !notice.msg && !notice.error && (
        <p className="notice notice-ok">{tr("You're signed in. Choose a new password below.")}</p>
      )}

      <section className="card">
        <h2>{tr("Your details")}</h2>
        <form action={updateProfile}>
          <div className="field">
            <label htmlFor="full_name">{tr("Full name")}</label>
            <input id="full_name" name="full_name" type="text" defaultValue={profile.full_name ?? ""} required />
          </div>
          <div className="field">
            <label htmlFor="phone">{tr("Phone")}</label>
            <input id="phone" name="phone" type="tel" defaultValue={profile.phone ?? ""} />
          </div>
          <div className="field">
            <label>{tr("Email")}</label>
            <span className="muted">{user.email}</span>
          </div>
          <SubmitButton>{tr("Save")}</SubmitButton>
        </form>
      </section>

      <section className="card">
        <h2>{tr("Appearance")}</h2>
        <p className="muted small">{tr("Auto follows your phone's light or dark setting.")}</p>
        <ThemePicker />
        <h3 className="bg-title">{tr("Background")}</h3>
        <BackgroundPicker />
      </section>

      {user.is_anonymous ? (
        <section className="card">
          <h2>{tr("Demo guest")}</h2>
          <p className="muted small" style={{ margin: 0 }}>{tr("You are trying LeMoSp as a guest. Nothing here is real and it is deleted after 48 hours. To use LeMoSp for your company, exit the demo and create an account.")}</p>
        </section>
      ) : (
      <section className="card" id="password">
          <h2>{tr("Change password")}</h2>
          <StepUpForm action={changePassword}>
            <div className="field">
              <label htmlFor="password">{tr("New password")}</label>
              <NewPasswordField id="password" name="password" context={[profile.full_name ?? "", profile.email ?? "", membership.company.name]} />
            </div>
            <div className="field">
              <label htmlFor="confirm">{tr("Type it again")}</label>
              <PasswordInput id="confirm" name="confirm" minLength={10} autoComplete="new-password" />
            </div>
            <SubmitButton>{tr("Change password")}</SubmitButton>
          </StepUpForm>
        </section>
      )}
      {!user.is_anonymous && (
        <SecurityPanel lastSignIn={user.last_sign_in_at ?? null} required={Boolean(membership.company.require_mfa)} />
      )}
      {!user.is_anonymous && <SignInActivity supabase={supabase} userId={user.id} />}

      {memberships.length > 1 && (
        <section className="card">
          <h2>{tr("Your companies")}</h2>
          <ul className="list">
            {memberships.map((m) => (
              <li key={m.id} className="row">
                <div>
                  <strong>{m.company.name}</strong>
                  <div className="muted small">{ROLE_LABELS[m.role]}</div>
                </div>
                {m.id === membership.id ? (
                  <span className="badge">{tr("Current")}</span>
                ) : (
                  <form action={switchCompany}>
                    <input type="hidden" name="company_id" value={m.company_id} />
                    <SubmitButton className="btn btn-small" pendingText={tr("Switching…")}>{tr("Switch")}</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" id="remove-app">
        <h2>{tr("Remove LeMoSp from this phone")}</h2>
        <RemoveFromPhone />
      </section>

      {!user.is_anonymous && (
        <section className="card danger-zone" id="delete-account">
          <h2>{tr("Delete my account")}</h2>
          <p className="small muted">
            {tr("Your account is deleted 7 days after you ask; until then you can keep it. Business records you created stay with your company, shown as \"Deleted user\".")}
          </p>
          <Link href="/delete-my-account" className="btn btn-danger">
            {tr("Delete my account")}
          </Link>
          <p className="small" style={{ marginBottom: 0 }}>
            <Link href="/delete-account">{tr("What is deleted and what is kept")}</Link>
          </p>
        </section>
      )}

      <form action={signOut}>
        <SubmitButton className="btn btn-block btn-danger" pendingText={tr("Signing out…")}>{tr("Sign out")}</SubmitButton>
      </form>
    </>
  );
}
