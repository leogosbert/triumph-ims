"use client";

import { useState } from "react";
import { useConfirmIdentity } from "@/components/ConfirmIdentity";
import { createClient } from "@/lib/supabase/client";
import { useTr } from "@/lib/tr-client";

/**
 * Turns on two-step verification with an authenticator app
 * (Google Authenticator, Microsoft Authenticator, Authy …):
 * scan the QR code (or type the key), then enter the 6-digit code.
 */
export function TotpSetup({ onDone }: { onDone: () => void }) {
  const tr = useTr();
  const [step, setStep] = useState<"start" | "scan">("start");
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ensure, dialog } = useConfirmIdentity();

  async function begin() {
    setBusy(true);
    setError(null);
    // First set-up: the password is asked again, so someone holding an unlocked phone cannot
    // add their own authenticator and lock the owner out.
    if (!(await ensure().catch(() => false))) {
      setBusy(false);
      return;
    }
    const supabase = createClient();
    try {
      // Clear any half-finished set-up from before.
      const { data: list } = await supabase.auth.mfa.listFactors();
      for (const f of list?.all ?? []) {
        if (f.factor_type === "totp" && f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `LeMoSp ${new Date().toISOString().slice(0, 10)}` });
      if (error || !data) throw new Error(error?.message ?? "enroll failed");
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
      setStep("scan");
    } catch {
      setError(tr("Two-step verification could not be started. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (error) {
      setError(tr("That code didn't work. Check the time on your phone is correct and use the newest code."));
      return;
    }
    onDone();
  }

  if (step === "start") {
    return (
      <div className="totp">
        <ol className="totp-steps">
          <li>{tr("Install an authenticator app on your phone, e.g. Google Authenticator or Microsoft Authenticator.")}</li>
          <li>{tr("Scan the code we show you, then type the 6-digit number it gives.")}</li>
          <li>{tr("From then on, signing in asks for your password and a fresh code from the app.")}</li>
        </ol>
        {error && <p className="notice notice-error">{error}</p>}
        <button type="button" className="btn btn-primary btn-block" onClick={begin} disabled={busy}>
          {busy ? tr("Please wait…") : tr("Set up two-step verification")}
        </button>
        {dialog}
      </div>
    );
  }

  return (
    <form className="totp" onSubmit={verify}>
      <p className="small muted" style={{ marginTop: 0 }}>{tr("Scan this with your authenticator app:")}</p>
      <img className="totp-qr" src={qr} alt={tr("QR code for your authenticator app")} />
      <details className="small">
        <summary>{tr("Can't scan? Type this key instead")}</summary>
        <code className="totp-secret">{secret}</code>
      </details>
      <label htmlFor="totp-code">{tr("6-digit code from the app")}</label>
      <input
        id="totp-code"
        className="code-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        required
        autoFocus
      />
      {error && <p className="notice notice-error">{error}</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
        {busy ? tr("Checking…") : tr("Turn on")}
      </button>
    </form>
  );
}
