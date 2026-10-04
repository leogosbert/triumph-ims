"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { signOut } from "@/app/actions";
import { TotpSetup } from "@/components/TotpSetup";
import { clearAway } from "@/lib/applock";
import { createClient } from "@/lib/supabase/client";
import { useTr } from "@/lib/tr-client";

/** Second sign-in step: enter the code from the authenticator app, or set one up when the company requires it. */
export default function TwoStepPage() {
  const tr = useTr();
  const router = useRouter();
  const [mode, setMode] = useState<"loading" | "verify" | "setup">("loading");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data } = await supabase.auth.mfa.listFactors();
      const totp = data?.totp?.[0];
      if (totp) {
        setFactorId(totp.id);
        setMode("verify");
      } else {
        setMode("setup");
      }
    })();
  }, [router]);

  function done() {
    clearAway();
    router.replace("/");
    router.refresh();
  }

  async function verify(e: React.FormEvent) {
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
    done();
  }

  return (
    <div className="auth-wrap">
      <img className="auth-logo" src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
      <div className="auth-card">
        <h1 style={{ marginTop: 0 }}>{tr("Two-step verification")}</h1>
        {mode === "loading" && <p className="muted">{tr("Please wait…")}</p>}
        {mode === "verify" && (
          <form onSubmit={verify}>
            <p className="muted small">{tr("Open your authenticator app and type the 6-digit code for LeMoSp.")}</p>
            <input
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              aria-label={tr("6-digit code from the app")}
              required
              autoFocus
            />
            {error && <p className="notice notice-error" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
              {busy ? tr("Checking…") : tr("Continue")}
            </button>
            <p className="small muted" style={{ margin: "14px 0 0" }}>{tr("Lost your phone? Ask your manager to reset your two-step verification.")}</p>
          </form>
        )}
        {mode === "setup" && (
          <>
            <p className="notice notice-ok" style={{ marginTop: 0 }}>{tr("Your company asks everyone to use two-step verification. It takes about a minute.")}</p>
            <TotpSetup onDone={done} />
          </>
        )}
        <form action={signOut} style={{ marginTop: 16, textAlign: "center" }}>
          <button type="submit" className="demo-link" style={{ color: "var(--muted)" }}>
            {tr("Sign out")}
          </button>
        </form>
      </div>
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
