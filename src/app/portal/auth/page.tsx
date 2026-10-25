import { tr } from "@/lib/tr";
import { SubmitButton } from "@/components/SubmitButton";
import { AuthCard } from "../_c/AuthCard";
import { verifyLink } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

/**
 * The link from the sign-in email. Opening it does nothing by itself: the person presses Continue
 * (a POST), so email scanners that open every link cannot use the one-time link up.
 */
export default async function PortalAuth({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const t = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const token = t && /^[0-9a-f]{64}$/.test(t) ? t : null;
  return (
    <AuthCard title="Sign in to the portal">
      {token ? (
        <form action={verifyLink}>
          <input type="hidden" name="t" value={token} />
          <p className="small">{tr("Press Continue to sign in on this phone or computer.")}</p>
          <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Signing in…")}>
            {tr("Continue")}
          </SubmitButton>
        </form>
      ) : (
        <p className="notice notice-error">{tr("This sign-in link is not complete. Open it again from the email, or type the code instead.")}</p>
      )}
      <p className="small" style={{ marginTop: 12 }}>
        <a href="/portal/login">{tr("Sign in with the code instead")}</a>
      </p>
    </AuthCard>
  );
}
