import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { signOut } from "@/app/actions";
import { keepMyAccount } from "@/app/deletion-actions";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Account scheduled for deletion" };

/**
 * Shown instead of the app while the person's account is waiting to be deleted (7 days).
 * They can keep it (everything comes back) or sign out.
 */
export default async function AccountDeletingPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await supabase.rpc("my_account_deletion");
  const scheduled = !error ? (data as { delete_after: string; requested_at: string } | null) : null;
  if (!scheduled) redirect("/");

  return (
    <div className="auth-wrap">
      <img className="auth-logo" src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
      <div className="auth-card del-card" role="alertdialog" aria-labelledby="del-title" aria-describedby="del-text">
        <h1 id="del-title" className="del-title">
          {tr("Your account is scheduled for deletion on")} {formatDate(scheduled.delete_after)}
        </h1>
        <Notice {...notice} />
        <p id="del-text" className="muted">
          {tr("You asked to delete your LeMoSp account. Until that date you can still change your mind: everything comes back as it was.")}
        </p>
        <p className="muted small">{user.email}</p>
        <form action={keepMyAccount}>
          <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Please wait…")}>
            {tr("Keep my account")}
          </SubmitButton>
        </form>
        <form action={signOut} style={{ marginTop: 10 }}>
          <SubmitButton className="btn btn-block" pendingText={tr("Signing out…")}>
            {tr("Sign out")}
          </SubmitButton>
        </form>
        <p className="small muted" style={{ marginTop: 16, marginBottom: 0 }}>
          <Link href="/delete-account">{tr("What is deleted and what is kept")}</Link>
        </p>
      </div>
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
