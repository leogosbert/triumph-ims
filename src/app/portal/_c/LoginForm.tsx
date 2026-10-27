"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTr } from "@/lib/tr-client";
import { requestCode, verifyCode } from "../actions";

/** Portal sign-in: email, then the 6-digit code from the email (or the link in it). No password. */
export function LoginForm({
  initialEmail,
  notice,
  disabled = false,
}: {
  initialEmail: string;
  notice: { error?: string; info?: string };
  /** The portal is not set up on the server: the form shows, but cannot be used. */
  disabled?: boolean;
}) {
  const tr = useTr();
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(notice.error ?? null);
  const [info, setInfo] = useState<string | null>(notice.info ?? null);
  const [pending, start] = useTransition();

  const ask = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    start(async () => {
      const r = await requestCode(email.trim().toLowerCase());
      if (r.error) setError(r.error);
      else {
        setInfo(r.ok ?? null);
        setStep("code");
      }
    });
  };

  const check = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code") ?? "").replace(/\D/g, "");
    setError(null);
    start(async () => {
      const r = await verifyCode(email.trim().toLowerCase(), code);
      if (r.error) setError(r.error);
      else if (r.ok) router.replace(r.ok);
    });
  };

  return (
    <>
      {error && <p className="notice notice-error" role="alert">{tr(error)}</p>}
      {info && <p className="notice notice-ok" role="status">{tr(info)}</p>}
      {step === "email" ? (
        <form onSubmit={ask}>
          <fieldset disabled={disabled} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
          <div className="field">
            <label htmlFor="p-email">{tr("Your work email")}</label>
            <input
              id="p-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button
            className="btn btn-primary btn-block"
            type="submit"
            disabled={pending || disabled}
            title={disabled ? tr("The portal is not set up on the server yet.") : undefined}
          >
            {pending ? tr("Please wait…") : tr("Send me a sign-in code")}
          </button>
          <p className="small muted" style={{ marginTop: 12 }}>
            {tr("Use the email the company invited. We send a link and a 6-digit code; no password is needed.")}
          </p>
          </fieldset>
        </form>
      ) : (
        <form onSubmit={check}>
          <p className="small">
            {tr("Code sent to")} <strong>{email}</strong>
          </p>
          <div className="field">
            <label htmlFor="p-code">{tr("6-digit code")}</label>
            <input
              id="p-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              required
              className="portal-code"
              autoFocus
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={pending}>
            {pending ? tr("Checking…") : tr("Sign in")}
          </button>
          <p className="small" style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" className="linkish" onClick={() => setStep("email")}>
              {tr("Use another email")}
            </button>
            <button type="button" className="linkish" disabled={pending} onClick={(e) => ask(e)}>
              {tr("Send a new code")}
            </button>
          </p>
        </form>
      )}
    </>
  );
}
