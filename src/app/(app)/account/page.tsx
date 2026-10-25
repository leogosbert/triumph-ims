import "@/app/settings-ui.css";
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
import { LookPicker } from "@/components/LookPicker";
import Link from "next/link";
import { signOut, switchCompany } from "@/app/actions";
import { setLanguage } from "@/app/lang-actions";
import { displayName, getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { ROLE_LABELS } from "@/lib/roles";
import { Hint, SettingsHead } from "../settings/SettingsHead";
import { changePassword, updateProfile } from "./actions";

export const metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const lang = await primeLang();
  const notice = await readNotice(searchParams);
  const reset = (await searchParams)?.reset === "1";
  const { supabase, profile, user, memberships, membership } = await getAppContext();
  const name = displayName(profile);
  const initials = (name || "?")
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("");

  return (
    <>
      <SettingsHead
        title={tr("Your account")}
        icon="user"
        back={{ href: "/settings", label: tr("← Settings") }}
        lead={tr("Your details, password, how the app looks and the language it speaks.")}
      />
      <Notice {...notice} />
      {reset && !notice.msg && !notice.error && (
        <p className="notice notice-ok">{tr("You're signed in. Choose a new password below.")}</p>
      )}

      <section className="card">
        <div className="st-profile">
          <span className="st-avatar lg" aria-hidden>
            {initials}
          </span>
          <div className="st-profile-text">
            <strong>{name}</strong>
            <span className="muted small">{user.email}</span>
            <div className="small" style={{ marginTop: 4 }}>
              {membership.company.name} · <span className="badge">{tr(ROLE_LABELS[membership.role])}</span>
            </div>
          </div>
        </div>
      </section>

      <ul className="st-jump" aria-label={tr("Jump to")}>
        <li>
          <a href="#details">{tr("Your details")}</a>
        </li>
        {!user.is_anonymous && (
          <li>
            <a href="#password">{tr("Password")}</a>
          </li>
        )}
        {!user.is_anonymous && (
          <li>
            <a href="#security">{tr("Two-step verification")}</a>
          </li>
        )}
        <li>
          <a href="#appearance">{tr("Appearance")}</a>
        </li>
        <li>
          <a href="#language">{tr("Language")}</a>
        </li>
        {!user.is_anonymous && (
          <li>
            <a href="#activity">{tr("Devices")}</a>
          </li>
        )}
      </ul>

      <section className="card" id="details">
        <h2>{tr("Your details")}</h2>
        <p className="st-card-lead">{tr("Your name is shown to your team and in the Activity log.")}</p>
        <form action={updateProfile} className="st-form">
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="full_name">{tr("Full name")}</label>
              <input id="full_name" name="full_name" type="text" autoComplete="name" defaultValue={profile.full_name ?? ""} required />
            </div>
            <div className="field">
              <label htmlFor="phone">{tr("Phone")}</label>
              <input id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={profile.phone ?? ""} />
            </div>
          </div>
          <div className="field">
            <span className="small" style={{ fontWeight: 600 }}>
              {tr("Email")}
            </span>
            <span className="st-readonly">{user.email}</span>
            <Hint>{tr("You sign in with this email. It cannot be changed here.")}</Hint>
          </div>
          <SubmitButton className="btn btn-primary btn-block">{tr("Save")}</SubmitButton>
        </form>
      </section>

      {user.is_anonymous ? (
        <section className="card">
          <h2>{tr("Demo guest")}</h2>
          <p className="muted small" style={{ margin: 0 }}>{tr("You are trying LeMoSp as a guest. Nothing here is real and it is deleted after 48 hours. To use LeMoSp for your company, exit the demo and create an account.")}</p>
        </section>
      ) : (
        <section className="card" id="password">
          <h2>{tr("Change password")}</h2>
          <p className="st-card-lead">{tr("At least 10 characters with letters, numbers and symbols. You may be asked for your current password first.")}</p>
          <StepUpForm action={changePassword} className="st-form">
            <div className="field">
              <label htmlFor="password">{tr("New password")}</label>
              <NewPasswordField id="password" name="password" context={[profile.full_name ?? "", profile.email ?? "", membership.company.name]} />
            </div>
            <div className="field">
              <label htmlFor="confirm">{tr("Type it again")}</label>
              <PasswordInput id="confirm" name="confirm" minLength={10} autoComplete="new-password" />
            </div>
            <SubmitButton className="btn btn-primary btn-block">{tr("Change password")}</SubmitButton>
          </StepUpForm>
        </section>
      )}
      {!user.is_anonymous && (
        <SecurityPanel lastSignIn={user.last_sign_in_at ?? null} required={Boolean(membership.company.require_mfa)} />
      )}

      <section className="card" id="appearance">
        <h2>{tr("Appearance")}</h2>
        <p className="st-card-lead">{tr("Auto follows your phone's light or dark setting.")}</p>
        <div className="st-seg-wrap">
          <ThemePicker />
        </div>
        <h3 className="st-sub-title">{tr("Style")}</h3>
        <p className="st-card-lead">{tr("Glass: frosted panels over photos, colours that follow each section and a menu that folds away. Classic: the earlier look.")}</p>
        <div className="st-seg-wrap">
          <LookPicker />
        </div>
        <h3 className="st-sub-title">{tr("Background")}</h3>
        <BackgroundPicker />
      </section>

      <section className="card" id="language">
        <h2>{tr("Language")}</h2>
        <p className="st-card-lead">{tr("The language of menus and screens. You can also switch with EN·SW in the top bar.")}</p>
        <div className="st-seg-wrap">
          <form action={setLanguage} className="seg" aria-label={tr("Language")}>
            <button type="submit" name="lang" value="en" aria-pressed={lang === "en"} lang="en">
              English
            </button>
            <button type="submit" name="lang" value="sw" aria-pressed={lang === "sw"} lang="sw">
              Kiswahili
            </button>
          </form>
        </div>
      </section>

      {memberships.length > 1 && (
        <section className="card" id="companies">
          <h2>{tr("Your companies")}</h2>
          <ul className="list st-rows">
            {memberships.map((m) => (
              <li key={m.id} className="row">
                <div>
                  <strong>{m.company.name}</strong>
                  <div className="muted small">{tr(ROLE_LABELS[m.role])}</div>
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

      {!user.is_anonymous && <SignInActivity supabase={supabase} userId={user.id} />}

      <section className="card" id="remove-app">
        <h2>{tr("Remove LeMoSp from this phone")}</h2>
        <RemoveFromPhone />
      </section>

      <section className="card" id="sign-out">
        <h2>{tr("Sign out")}</h2>
        <p className="st-card-lead">{tr("Sign out on shared phones and computers when you finish.")}</p>
        <form action={signOut}>
          <SubmitButton className="btn btn-block btn-danger" pendingText={tr("Signing out…")}>{tr("Sign out")}</SubmitButton>
        </form>
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
    </>
  );
}
