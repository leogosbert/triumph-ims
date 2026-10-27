"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/actions";
import { PasswordInput } from "@/components/PasswordInput";
import { LOCK_SEEN_KEY, noteSeen, readLockPref, readNumber, SEEN_EVERY_MS, shouldLock } from "@/lib/applock";
import { createClient } from "@/lib/supabase/client";
import { useTr } from "@/lib/tr-client";

const MAX_TRIES = 5;

/**
 * App lock: when you come back to LeMoSp after being away longer than your setting (Your account →
 * "Ask for my password again", 15 minutes unless changed), the screen is covered until you enter
 * your password (and two-step code if it is on). Coming back sooner never asks. What you were
 * doing stays underneath. Not on the driver screen (camera and offline use). Rules: src/lib/applock.ts.
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

  // While the lock screen is up, this tab does not count as "the app is on screen".
  const lockedRef = useRef(false);
  lockedRef.current = locked;
  // The driver screen never locks, but time spent there still counts as being in the app.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!enabled) return;
    const signedInAt = lastSignIn ? Date.parse(lastSignIn) || 0 : 0;

    function lockIfAway() {
      const lock = activeRef.current && shouldLock({ pref: readLockPref(), lastSeen: readNumber(LOCK_SEEN_KEY), signedInAt, now: Date.now() });
      if (lock) setLocked(true);
      else noteSeen();
    }
    // Every few seconds while this tab is on screen (and unlocked), note that the app is in use,
    // so other tabs and the next launch know you were here.
    const beat = setInterval(() => {
      if (document.visibilityState === "visible" && !lockedRef.current) noteSeen();
    }, SEEN_EVERY_MS);
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        if (!lockedRef.current) noteSeen();
      } else if (!lockedRef.current) {
        lockIfAway();
      }
    }
    function onHide() {
      if (!lockedRef.current) noteSeen();
    }
    // Back from the browser's page cache (e.g. the installed app brought back): same rule.
    function onShow(e: PageTransitionEvent) {
      if (e.persisted && !lockedRef.current) lockIfAway();
    }

    // Opening the app (also after the phone closed it) follows the same rule as switching back.
    if (document.visibilityState === "visible") lockIfAway();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onShow);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onShow);
    };
  }, [enabled, lastSignIn]);

  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);

  function unlocked() {
    noteSeen();
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
