import { primeLang, tr } from "@/lib/tr";
import { Suspense } from "react";
import { StepUpLink } from "@/components/ConfirmIdentity";
import { SubmitButton } from "@/components/SubmitButton";
import { UrlNotice } from "@/components/UrlNotice";
import { signOut, switchCompany } from "@/app/actions";
import { cancelCompanyClosure } from "@/app/deletion-actions";
import { backupNow } from "@/app/(app)/settings/backups/actions";
import type { Company, Membership } from "@/lib/context";
import type { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Shown by the app layout instead of the app while the company is closing (only managers still
 * have access then). They can cancel, take and download a final backup, switch to another
 * company or sign out. The download link is a route outside the layout, so it keeps working.
 */
export async function CompanyClosing({
  supabase,
  company,
  isManager,
  others,
  logo,
  initials,
}: {
  supabase: Supabase;
  company: Company;
  isManager: boolean;
  others: Membership[];
  logo: string | null;
  initials: string;
}) {
  await primeLang();
  const { data } = await supabase
    .from("company_backups")
    .select("id, kind, taken_at")
    .eq("company_id", company.id)
    .order("taken_at", { ascending: false })
    .limit(3);
  const backups = (data ?? []) as { id: string; kind: string; taken_at: string }[];

  return (
    <div className="auth-wrap closing-wrap">
      <img className="auth-logo" src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
      <div className="auth-card del-card" role="alertdialog" aria-labelledby="closing-title" aria-describedby="closing-text">
        <div className="closing-company">
          {logo ? <img src={logo} alt="" /> : <span className="mark">{initials}</span>}
          <strong>{company.name}</strong>
        </div>
        <h1 id="closing-title" className="del-title">
          {tr("This company will be deleted on")} {formatDate(company.closing_after ?? "")}
        </h1>
        <Suspense fallback={null}>
          <UrlNotice />
        </Suspense>
        <p id="closing-text" className="muted">
          {tr("A manager asked to close this company account. Only management can still sign in. On that date all its data is deleted for good.")}
        </p>

        {isManager && (
          <section className="del-section">
            <h2>{tr("Download final backup")}</h2>
            <p className="small muted" style={{ marginTop: 0 }}>
              {tr("Keep your own copy: business records such as tax records must be kept for several years — check with your accountant.")}
            </p>
            {backups.length > 0 && (
              <ul className="list">
                {backups.map((b) => (
                  <li key={b.id} className="row">
                    <span style={{ flex: 1 }}>{formatDateTime(b.taken_at)}</span>
                    <StepUpLink className="btn btn-small" href={`/settings/backups/download/${b.id}`}>
                      {tr("Download")}
                    </StepUpLink>
                  </li>
                ))}
              </ul>
            )}
            <form action={backupNow}>
              <SubmitButton className="btn btn-block" pendingText={tr("Backing up…")}>
                {backups.length > 0 ? tr("Make a new backup now") : tr("Back up now")}
              </SubmitButton>
            </form>
          </section>
        )}

        {isManager && (
          <form action={cancelCompanyClosure} style={{ marginTop: 14 }}>
            <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Please wait…")}>
              {tr("Cancel closure")}
            </SubmitButton>
          </form>
        )}

        {others.length > 0 && (
          <section className="del-section">
            <h2>{tr("Your other companies")}</h2>
            <ul className="list">
              {others.map((m) => (
                <li key={m.id} className="row">
                  <span style={{ flex: 1 }}>{m.company.name}</span>
                  <form action={switchCompany}>
                    <input type="hidden" name="company_id" value={m.company_id} />
                    <SubmitButton className="btn btn-small" pendingText={tr("Switching…")}>
                      {tr("Switch")}
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}

        <form action={signOut} style={{ marginTop: 10 }}>
          <SubmitButton className="btn btn-block" pendingText={tr("Signing out…")}>
            {tr("Sign out")}
          </SubmitButton>
        </form>
      </div>
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
