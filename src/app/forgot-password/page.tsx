"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const email = String(new FormData(e.currentTarget).get("email") ?? "").trim().toLowerCase();
    setBusy(true);
    const { error } = await createClient().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent("/account?reset=1")}`,
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
      <img className="auth-logo" src="/brand/lemo-ims-white.svg" alt="LeMo IMS" />
      <div className="auth-card">
        <h1>Reset your password</h1>
        {sent ? (
          <p className="notice notice-ok">
            If an account exists for that email, we&apos;ve sent a link. Open it on this device to choose a new
            password.
          </p>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="muted">Enter your email and we&apos;ll send you a link to set a new password.</p>
            {error && <p className="notice notice-error">{error}</p>}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <button className="btn btn-primary btn-block" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}
        <p className="small" style={{ marginTop: 16, textAlign: "center" }}>
          <Link href="/login">Back to sign in</Link>
        </p>
      </div>
      <p className="auth-foot">LeMo IMS · by LeMo Tech Solutions</p>
    </div>
  );
}
