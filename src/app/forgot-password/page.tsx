"use client";

import { useTr } from "@/lib/tr-client";
import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAdminHost } from "@/lib/host-client";
import { mainUrl } from "@/lib/hosts";

export default function ForgotPasswordPage() {
  const tr = useTr();
  // LeMoSp ADMIN address: reset links open the company app's account page, which is not served
  // here, so point to the company app's reset page instead (when its address is known).
  const adminApp = useAdminHost();
  const companyApp = adminApp ? mainUrl() : null;
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim().toLowerCase();
    setBusy(true);
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent("/account?reset=1#password")}`,
    });
    setBusy(false);
    if (error)
      setError(
        /rate limit/i.test(error.message)
          ? "Too many emails have been sent in the last hour. Please wait a while and try again."
          : error.message,
      );
    else setSent(true);
  }

  return (
    <div className="auth-wrap">
      {adminApp ? (
        <img className="auth-logo auth-logo-admin" src="/brand/lemosp-admin-on-dark.svg" alt="LeMoSp ADMIN" />
      ) : (
        <img className="auth-logo" src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
      )}
      <div className="auth-card">
        <h1>{tr("Reset your password")}</h1>
        {companyApp ? (
          // The same account works in both apps; a new password is chosen in the company app.
          <>
            <p className="muted">{tr("Your password is the same in both apps. Reset it in the LeMoSp company app, then sign in here again.")}</p>
            <a className="btn btn-primary btn-block" href={`${companyApp}/forgot-password`}>
              {tr("Reset it in the company app")}
            </a>
          </>
        ) : sent ? (
          <p className="notice notice-ok">{tr("If an account exists for that email, we've sent a link. Open it on this device to choose a new password.")}</p>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="muted">{tr("Enter your email and we'll send you a link to set a new password.")}</p>
            {error && <p className="notice notice-error">{error}</p>}
            <div className="field">
              <label htmlFor="email">{tr("Email")}</label>
              <input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? tr("Sending…") : tr("Send reset link")}
            </button>
          </form>
        )}
        <p className="small" style={{ marginTop: 16, textAlign: "center" }}>
          <Link href="/login">{tr("Back to sign in")}</Link>
        </p>
      </div>
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
