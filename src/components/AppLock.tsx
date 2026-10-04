"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions";
import { PasswordInput } from "@/components/PasswordInput";
import { clearAway, LOCK_AWAY_KEY, LOCK_TOLERANCE_SECONDS, readLockPref } from "@/lib/applock";
import { createClient } from "@/lib/supabase/client";
import { useTr } from "@/lib/tr-client";

const MAX_TRIES = 5;

/**
 * App lock: when you come back to LeMoSp (reopen it or switch back from another app),
 * the screen is covered until you enter your password (and two-step code if it is on).
 * What you were doing stays underneath. Not on the driver screen (camera and offline use).
 */
export function AppLock({
  email,
  name,
  logo,
  initials,
  lastSignIn,
  enabled,
}: {
  email: string;
  name: string;
  logo: string | null;
  initials: string;
  lastSignIn: string | null;
  enabled: boolean;
}) {
  const tr = useTr();
  const router = useRouter();
  const pathname = usePathname();
  const [locked, setLocked] = useState(false);
  const [step, setStep] = useState<"password" | "code">("password");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tries = useRef(0);
  const out = useRef<HTMLFormElement>(null);
  const active = enabled && !pathname.startsWith("/driver");

  useEffect(() => {
    if (!active) return;
    const signedInAt = lastSignIn ? Date.parse(lastSignIn) : 0;

    function shouldLock() {
      const pref = readLockPref();
      if (pref < 0) return false;
      let away = 0;
      try {
        away = Number(localStorage.getItem(LOCK_AWAY_KEY)) || 0;
      } catch {
        return false;
      }
      if (!away || away < signedInAt) return false; // just signed in
      const gone = (Date.now() - away) / 1000;
      return gone >= Math.max(pref, LOCK_TOLERANCE_SECONDS);
    }
    function markAway() {
      try {
        if (!localStorage.getItem(LOCK_AWAY_KEY)) localStorage.setItem(LOCK_AWAY_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    }
    function onVisibility() {
      if (document.visibilityState === "hidden") markAway();
      else if (shouldLock()) setLocked(true);
      else clearAway();
    }

    // Opening the app (or reloading it) counts as coming back.
    if (shouldLock()) setLocked(true);
    else clearAway();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", markAway);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", markAway);
    };
  }, [active, lastSignIn]);

  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);

  function unlocked() {
    clearAway();
    tries.current = 0;
    setLocked(false);
    setStep("password");
    setCode("");
    setError(null);
    router.refresh();
  }

  async function onPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("lock_password") ?? "");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      tries.current += 1;
      if (tries.current >= MAX_TRIES) {
        out.current?.requestSubmit();
        return;
      }
      setError(
        /rate|too many/i.test(error.message)
          ? tr("Too many attempts. Please wait a few minutes.")
          : `${tr("That password is not correct.")} ${MAX_TRIES - tries.current} ${tr("tries left.")}`,
      );
      return;
    }
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const { data } = await supabase.auth.mfa.listFactors();
      const f = data?.totp?.[0];
      if (f) {
        setFactorId(f.id);
        setStep("code");
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    unlocked();
  }

  async function onCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (error) {
      setError(tr("That code didn't work. Use the newest code from your authenticator app."));
      setCode("");
      return;
    }
    unlocked();
  }

  return (
    <>
      <form ref={out} action={signOut} hidden />
      {locked && active && (
        <div className="applock" role="dialog" aria-modal="true" aria-labelledby="applock-title">
          <div className="applock-card">
            {logo ? <img src={logo} alt="" className="applock-logo" /> : <span className="applock-logo mark">{initials}</span>}
            <h1 id="applock-title">
              {tr("Welcome back")}
              {name ? `, ${name.split(" ")[0]}` : ""}
            </h1>
            <p className="applock-who">{email}</p>

            {step === "password" ? (
              <form onSubmit={onPassword}>
                <label htmlFor="lock_password">{tr("Enter your password to continue")}</label>
                <PasswordInput id="lock_password" name="lock_password" autoComplete="current-password" />
                {error && (
                  <p className="notice notice-error" role="alert">
                    {error}
                  </p>
                )}
                <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
                  {busy ? tr("Checking…") : tr("Unlock")}
                </button>
              </form>
            ) : (
              <form onSubmit={onCode}>
                <label htmlFor="lock_code">{tr("6-digit code from the app")}</label>
                <input
                  id="lock_code"
                  className="code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  autoFocus
                />
                {error && (
                  <p className="notice notice-error" role="alert">
                    {error}
                  </p>
                )}
                <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
                  {busy ? tr("Checking…") : tr("Unlock")}
                </button>
              </form>
            )}

            <div className="applock-links">
              <button type="button" className="demo-link" onClick={() => out.current?.requestSubmit()}>
                {tr("Not you? Sign out")}
              </button>
              <a href="/forgot-password">{tr("Forgot your password?")}</a>
            </div>
          </div>
          <img className="applock-brand" src="/brand/lemosp-on-dark.svg" alt="LeMoSp" />
        </div>
      )}
    </>
  );
}
