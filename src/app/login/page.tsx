"use client";

import { useTr } from "@/lib/tr-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NewPasswordField } from "@/components/NewPasswordField";
import { PasswordInput } from "@/components/PasswordInput";
import { checkPassword } from "@/lib/password";
import { clearAway } from "@/lib/applock";
import { createClient } from "@/lib/supabase/client";
import { startDemo } from "@/app/demo-actions";
import { useAdminHost } from "@/lib/host-client";
import { DemoScalePicker } from "@/components/DemoScalePicker";
import { recordSignIn } from "@/app/security-actions";
import { LEAKED_MESSAGE, timesLeaked } from "@/lib/pwned";

/** Adds the sign-in to the person's history (and alerts them about a new device); never holds up signing in. */
function logSignIn() {
  return Promise.race([recordSignIn().catch(() => undefined), new Promise((r) => setTimeout(r, 2500))]);
}

type Mode = "signin" | "signup";

export default function LoginPage() {
  const tr = useTr();
  const router = useRouter();
  // LeMoSp ADMIN address: sign in only (no new accounts, no demos), then the admin overview.
  const adminApp = useAdminHost();
  const home = adminApp ? "/admin" : "/";
  const [mode, setMode] = useState<Mode>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Show messages passed back from the email-confirmation link.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("error")) setError(p.get("error"));
    if (p.get("msg")) setInfo(p.get("msg"));
    if (p.get("mode") === "signup") setMode("signup");
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    const fullName = String(form.get("full_name") ?? "").trim();
    const supabase = createClient();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          setError(
            /confirm/i.test(error.message)
              ? "Please confirm your email first. Check your inbox for the link."
              : /rate|too many/i.test(error.message) || error.status === 429
                ? "Too many sign-in attempts. For your security, please wait a few minutes and try again."
                : "Email or password is not correct.",
          );
          return;
        }
        clearAway();
        // Two-step verification turned on: ask for the code next.
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
          router.replace("/two-step");
          return;
        }
        await logSignIn();
        router.replace(home);
        router.refresh();
        return;
      }

      if (fullName.length < 2) {
        setError("Please enter your full name.");
        return;
      }
      const rule = checkPassword(password, [fullName, email]);
      if (!rule.ok) {
        setError(rule.problems[0]);
        return;
      }
      // Passwords found in data breaches are refused (checked privately: only part of a hash is sent).
      if ((await timesLeaked(password)) > 0) {
        setError(tr(LEAKED_MESSAGE));
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=/`,
        },
      });
      if (error) {
        setError(
          /rate limit/i.test(error.message)
            ? "Too many emails have been sent in the last hour. Please wait a while and try again, or ask your administrator."
            : error.message,
        );
        return;
      }
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        setError("An account with this email already exists. Please sign in.");
        setMode("signin");
        return;
      }
      if (data.session) {
        await logSignIn();
        router.replace("/");
        router.refresh();
        return;
      }
      setInfo("Account created. We've sent you an email: open the link in it to confirm, then sign in.");
      setMode("signin");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      {adminApp ? (
        <img className="auth-logo auth-logo-admin" src="/brand/lemosp-admin-on-dark.svg" alt="LeMoSp ADMIN" />
      ) : (
        <img className="auth-logo" src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
      )}
      <div className="auth-card">
        <div className="brand">
          <div>
            <h1 style={{ margin: 0 }}>{tr("Welcome back")}</h1>
            <span className="muted small">
              {adminApp ? tr("For the LeMoSp platform team. Sign in with two-step verification.") : tr("Sales · Procurement · Stock · Delivery · Finance")}
            </span>
          </div>
        </div>

        {!adminApp && (
          <div className="tabs" role="group" aria-label={tr("Sign in or create an account")}>
            <button type="button" aria-pressed={mode === "signin"} onClick={() => setMode("signin")}>{tr("Sign in")}</button>
            <button type="button" aria-pressed={mode === "signup"} onClick={() => setMode("signup")}>{tr("Create account")}</button>
          </div>
        )}

        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {info && <p className="notice notice-ok" role="status">{info}</p>}

        <form onSubmit={onSubmit}>
          {mode === "signup" && (
            <div className="field">
              <label htmlFor="full_name">{tr("Full name")}</label>
              <input id="full_name" name="full_name" type="text" autoComplete="name" required />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">{tr("Email")}</label>
            <input id="email" name="email" type="email" autoComplete="email" inputMode="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">{tr("Password")}</label>
            {mode === "signin" ? (
              <PasswordInput id="password" name="password" autoComplete="current-password" />
            ) : (
              <NewPasswordField id="password" name="password" />
            )}
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? tr("Please wait…") : mode === "signin" ? tr("Sign in") : tr("Create account")}
          </button>
        </form>

        {mode === "signin" && (
          <p className="small" style={{ marginTop: 16, textAlign: "center" }}>
            <Link href="/forgot-password">{tr("Forgot your password?")}</Link>
          </p>
        )}
        {mode === "signup" && (
          <p className="small muted" style={{ marginTop: 16 }}>{tr("Joining a company? Create your account with the same email address your manager invited.")}</p>
        )}
      </div>
      {!adminApp && (
      <section className="demo-card" aria-labelledby="demo-card-title">
        <div>
          <strong id="demo-card-title">{tr("Just looking?")}</strong>
          <span>{tr("Try a demo company full of sample data. Pick the scale closest to your business. No sign-up needed; it deletes itself after 48 hours.")}</span>
        </div>
        <DemoScalePicker action={startDemo} tone="dark" />
      </section>
      )}
      <p className="auth-foot">
        {tr("LeMoSp · a LeMo Tech Solutions product")} · <Link href="/delete-account">{tr("Delete your account")}</Link>
      </p>
    </div>
  );
}
