import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StepUpForm } from "@/components/ConfirmIdentity";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { openCompanyPage, requestAccountDeletion } from "@/app/deletion-actions";
import { readNotice, type SearchParams } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Delete my account" };

type Blocker = { company_id: string; company_name: string; kind: "sole_manager" | "only_member"; is_manager: boolean; can_close?: boolean };
type Check = { guest: boolean; platform_admin: boolean; two_step_needed?: boolean; scheduled: unknown; blockers: Blocker[] };

function CompanyButton({ id, to, label, primary }: { id: string; to: string; label: string; primary?: boolean }) {
  return (
    <form action={openCompanyPage}>
      <input type="hidden" name="company_id" value={id} />
      <input type="hidden" name="to" value={to} />
      <SubmitButton className={primary ? "btn btn-primary btn-small" : "btn btn-small"} pendingText={tr("Opening…")}>
        {label}
      </SubmitButton>
    </form>
  );
}

/**
 * "Delete my account" (Your account → Danger zone). Outside the app shell on purpose, so it also
 * works for someone who is not in any company. The database checks everything again.
 */
export default async function DeleteMyAccountPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await supabase.rpc("account_deletion_check");
  const check = error ? null : (data as Check);
  if (check?.scheduled) redirect("/account-deleting");

  const blockers = check?.blockers ?? [];
  const soleManager = blockers.filter((b) => b.kind === "sole_manager");
  const onlyMember = blockers.filter((b) => b.kind === "only_member" && b.is_manager);
  const twoStep = Boolean(check?.two_step_needed);
  const cannotClose = onlyMember.filter((b) => b.can_close === false);
  const canAsk =
    Boolean(check) && !check?.guest && !check?.platform_admin && !twoStep && soleManager.length === 0 && cannotClose.length === 0;

  return (
    <div className="auth-wrap">
      <img className="auth-logo" src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
      <div className="auth-card del-card">
        <p className="small" style={{ marginTop: 0 }}>
          <Link href="/account">{tr("← Your account")}</Link>
        </p>
        <h1 className="del-title">{tr("Delete my account")}</h1>
        <p className="muted small" style={{ marginTop: 0 }}>{user.email}</p>
        <Notice {...notice} />

        {!check ? (
          <p className="notice notice-error">{tr("This is not available yet. Ask LeMo Tech to run the latest database update.")}</p>
        ) : check.guest || user.is_anonymous ? (
          <p className="muted">{tr("You are trying LeMoSp as a guest. There is no account to delete: the demo deletes itself after 48 hours.")}</p>
        ) : check.platform_admin ? (
          <p className="muted">{tr("You are on the LeMoSp platform team. Ask another platform admin to remove you from the team list first.")}</p>
        ) : twoStep || cannotClose.length > 0 ? (
          <p className="notice notice-error" role="alert">
            <span>
              {tr("For your security, enter the code from your authenticator app first.")}{" "}
              <Link href="/two-step">{tr("Two-step verification")}</Link>
            </span>
          </p>
        ) : null}

        {check && !check.guest && !check.platform_admin && (
          <>
            <section className="del-section">
              <h2>{tr("What happens")}</h2>
              <ul className="del-list">
                <li>{tr("Straight away: you lose access to all your companies and are signed out on every phone and computer. We send you an email.")}</li>
                <li>{tr("For 7 days you can change your mind: sign in and choose Keep my account. Everything comes back as it was.")}</li>
                <li>{tr("After 7 days your account is deleted for good: your name, email, phone, password, two-step verification, devices, sign-in history and notifications.")}</li>
                <li>{tr("Kept: the business records you created stay with your company (for example quotations and invoices), shown as made by \"Deleted user\". Your company needs them for its accounts.")}</li>
              </ul>
              <p className="small muted" style={{ marginBottom: 0 }}>
                {tr("Only want LeMoSp off this phone? You don't need to delete your account.")}{" "}
                <Link href="/account#remove-app">{tr("Remove LeMoSp from this phone")}</Link>
              </p>
            </section>

            {soleManager.map((b) => (
              <section key={b.company_id} className="del-section del-block" role="alert">
                <h2>
                  {tr("You are the only manager of")} {b.company_name}
                </h2>
                <p className="small">{tr("Other people work there and would be left without a manager. Make someone else a manager first, then come back.")}</p>
                <CompanyButton id={b.company_id} to="/settings/team" label={tr("Open Team & roles")} primary />
              </section>
            ))}

            {onlyMember.map((b) => (
              <section key={b.company_id} className="del-section del-warn">
                <h2>
                  {tr("You are the only person in")} {b.company_name}
                </h2>
                <p className="small">
                  {tr("Close the company too: all its data is deleted after 30 days. Download a final backup first and keep it safe. Business records such as tax records must be kept for several years — check with your accountant.")}
                </p>
                <div className="del-actions">
                  <CompanyButton id={b.company_id} to="/settings/backups" label={tr("Download a final backup")} primary />
                  <CompanyButton id={b.company_id} to="/settings/company/close" label={tr("Close the company instead")} />
                </div>
              </section>
            ))}

            {canAsk && (
              <StepUpForm action={requestAccountDeletion} className="del-section">
                <h2>{tr("Delete my account")}</h2>
                {onlyMember.length > 0 && (
                  <label className="del-check">
                    <input type="checkbox" name="close_companies" required />
                    <span>
                      {tr("Also close")} {onlyMember.map((b) => b.company_name).join(", ")}{" "}
                      {tr("and delete all its data after 30 days")}
                    </span>
                  </label>
                )}
                <div className="field">
                  <label htmlFor="reason">
                    {tr("Why are you leaving?")} <span className="hint">· {tr("optional")}</span>
                  </label>
                  <textarea id="reason" name="reason" maxLength={500} rows={2} />
                </div>
                <div className="field">
                  <label htmlFor="confirm">{tr("Type DELETE to confirm")}</label>
                  <input id="confirm" name="confirm" type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} required />
                </div>
                <SubmitButton className="btn btn-danger-solid btn-block" pendingText={tr("Please wait…")}>
                  {tr("Delete my account")}
                </SubmitButton>
                <p className="small muted" style={{ marginBottom: 0 }}>{tr("You will be asked for your password first.")}</p>
              </StepUpForm>
            )}
          </>
        )}

        <p className="small" style={{ marginTop: 16, marginBottom: 0 }}>
          <Link href="/delete-account">{tr("More about deleting accounts and companies")}</Link>
        </p>
      </div>
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
