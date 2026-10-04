"use client";

import { useTr } from "@/lib/tr-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { NewPasswordField } from "@/components/NewPasswordField";
import { PasswordInput } from "@/components/PasswordInput";
import { checkPassword } from "@/lib/password";
import { clearAway } from "@/lib/applock";
import { createClient } from "@/lib/supabase/client";
import { startDemo } from "@/app/demo-actions";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const tr = useTr();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Show messages passed back from the email-confirmation link.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("error")) setError(p.get("error"));
    if (p.get("msg")) setInfo(p.get("msg"));
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
        router.replace("/");
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
      <img className="auth-logo" src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
      <div className="auth-card">
        <div className="brand">
          <div>
            <h1 style={{ margin: 0 }}>{tr("Welcome back")}</h1>
            <span className="muted small">{tr("Sales · Procurement · Stock · Delivery · Finance")}</span>
          </div>
        </div>

        <div className="tabs" role="group" aria-label={tr("Sign in or create an account")}>
          <button type="button" aria-pressed={mode === "signin"} onClick={() => setMode("signin")}>{tr("Sign in")}</button>
          <button type="button" aria-pressed={mode === "signup"} onClick={() => setMode("signup")}>{tr("Create account")}</button>
        </div>

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
      <section className="demo-card" aria-labelledby="demo-card-title">
        <div>
          <strong id="demo-card-title">{tr("Just looking?")}</strong>
          <span>{tr("Open a demo company with sample clients, quotations, stock and invoices, and a short guided tour. Pick the size closest to your business. No sign-up needed; it deletes itself after 48 hours.")}</span>
        </div>
        <div className="demo-levels">
          {DEMO_LEVELS.map((l) => (
            <form key={l.level} action={startDemo}>
              <input type="hidden" name="level" value={l.level} />
              <DemoButton name={l.name} line={l.line} />
            </form>
          ))}
        </div>
      </section>
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}

const DEMO_LEVELS: { level: "small" | "medium" | "enterprise"; name: string; line: string }[] = [
  { level: "small", name: "Small business demo", line: "A shop or small office: a few people, simple sales, stock and payments." },
  { level: "medium", name: "Medium business demo", line: "A growing team with corporate clients, several suppliers and approvals." },
  { level: "enterprise", name: "Enterprise demo", line: "Many stores across regions, imports, departments and a large team." },
];

function DemoButton({ name, line }: { name: string; line: string }) {
  const tr = useTr();
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="demo-level" disabled={pending} aria-busy={pending}>
      <strong>{pending ? tr("Preparing your demo…") : tr(name)}</strong>
      <span>{tr(line)}</span>
    </button>
  );
}
