"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { signOut } from "@/app/actions";
import { identityFresh, recordBrowserEvent } from "@/app/security-actions";
import { PasswordInput } from "@/components/PasswordInput";
import { createClient } from "@/lib/supabase/client";
import { useTr } from "@/lib/tr-client";

const MAX_TRIES = 5;

/**
 * "Confirm it's you": before a sensitive change (team roles, sign-in security, bank details,
 * exporting all data…) the person types their password again, then their 6-digit code if they
 * use two-step verification. This signs them in afresh, which the database checks (last 10 minutes).
 * Too many wrong passwords sign them out, in case someone else is holding the phone.
 */
export function ConfirmIdentity({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const tr = useTr();
  const [step, setStep] = useState<"loading" | "password" | "code">("loading");
  const [email, setEmail] = useState("");
  const [factorId, setFactorId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tries = useRef(0);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHost(document.body);
    (async () => {
      const {
        data: { user },
      } = await createClient().auth.getUser();
      // Guests (demo) have no password: the server decides on its own.
      if (!user || !user.email || user.is_anonymous) {
        onDone();
        return;
      }
      setEmail(user.email);
      setStep("password");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  function finish() {
    recordBrowserEvent("reauth").catch(() => undefined);
    onDone();
  }

  async function onPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    const password = String(new FormData(e.currentTarget).get("confirm_password") ?? "");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: err } = await supabase.auth.signInWithPassword({ email, password });
    if (err) {
      setBusy(false);
      tries.current += 1;
      if (tries.current >= MAX_TRIES) {
        await signOut();
        return;
      }
      setError(
        /rate|too many/i.test(err.message) || err.status === 429
          ? tr("Too many attempts. Please wait a few minutes.")
          : `${tr("That password is not correct.")} ${MAX_TRIES - tries.current} ${tr("tries left.")}`,
      );
      return;
    }
    const { data } = await supabase.auth.mfa.listFactors();
    const totp = data?.totp?.[0];
    setBusy(false);
    if (totp) {
      setFactorId(totp.id);
      setStep("code");
      return;
    }
    finish();
  }

  async function onCode(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    e.stopPropagation();
    setBusy(true);
    setError(null);
    const { error: err } = await createClient().auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
    setBusy(false);
    if (err) {
      setError(tr("That code didn't work. Use the newest code from your authenticator app."));
      setCode("");
      return;
    }
    finish();
  }

  if (!host || step === "loading") return null;
  return createPortal(
    <div className="confirm-id" role="dialog" aria-modal="true" aria-labelledby="confirm-id-title">
      <div className="confirm-id-card">
        <h2 id="confirm-id-title">{tr("Confirm it's you")}</h2>
        {step === "password" ? (
          <form onSubmit={onPassword}>
            <p className="muted small">{tr("This is a sensitive change. For your security, enter your password again.")}</p>
            <p className="confirm-id-who small">{email}</p>
            <label htmlFor="confirm_password">{tr("Password")}</label>
            <PasswordInput id="confirm_password" name="confirm_password" autoComplete="current-password" />
            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
            <div className="confirm-id-actions">
              <button type="button" className="btn" onClick={onCancel} disabled={busy}>
                {tr("Cancel")}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? tr("Checking…") : tr("Confirm")}
              </button>
            </div>
            <p className="small muted" style={{ margin: "12px 0 0" }}>{tr("Forgot your password? Sign out and choose “Forgot your password?” on the sign-in page.")}</p>
          </form>
        ) : (
          <form onSubmit={onCode}>
            <label htmlFor="confirm_code">{tr("6-digit code from the app")}</label>
            <input
              id="confirm_code"
              className="code-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
              required
            />
            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
            <div className="confirm-id-actions">
              <button type="button" className="btn" onClick={onCancel} disabled={busy}>
                {tr("Cancel")}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || code.length !== 6}>
                {busy ? tr("Checking…") : tr("Confirm")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    host,
  );
}

/**
 * `ensure()` resolves true when the session confirmed who it is in the last 10 minutes (asking for the
 * password, and code, when needed) and false when the person cancels. Render `dialog` somewhere.
 */
export function useConfirmIdentity() {
  const [resolver, setResolver] = useState<((ok: boolean) => void) | null>(null);
  const ensure = useCallback(async () => {
    const fresh = await identityFresh().catch(() => false);
    if (fresh) return true;
    return new Promise<boolean>((resolve) => setResolver(() => resolve));
  }, []);
  const close = useCallback(
    (ok: boolean) => {
      resolver?.(ok);
      setResolver(null);
    },
    [resolver],
  );
  const dialog = resolver ? <ConfirmIdentity onDone={() => close(true)} onCancel={() => close(false)} /> : null;
  return { ensure, dialog };
}

/**
 * A form for a sensitive change: before it is sent, the person confirms it is them (unless they did in
 * the last 10 minutes). `onlyIfChanged`: only ask when one of these fields (comma-separated) was changed,
 * e.g. bank details and other text printed on documents.
 */
export function StepUpForm({
  action,
  children,
  className,
  style,
  id,
  onlyIfChanged,
}: {
  action: (form: FormData) => void | Promise<void>;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
  onlyIfChanged?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const pass = useRef(false);
  const submitter = useRef<HTMLElement | null>(null);
  const [checking, setChecking] = useState(false);
  const { ensure, dialog } = useConfirmIdentity();

  function send() {
    const f = ref.current;
    if (!f) return;
    pass.current = true;
    const s = submitter.current;
    if (s instanceof HTMLButtonElement && f.contains(s)) f.requestSubmit(s);
    else f.requestSubmit();
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (e.target !== e.currentTarget) return; // the confirm box's own forms
    if (pass.current) {
      pass.current = false;
      return;
    }
    if (onlyIfChanged) {
      const form = e.currentTarget;
      // Same rule as the database: spaces and line breaks alone are not a change.
      const norm = (v: string) => v.replace(/\s+/g, " ").trim();
      const changed = onlyIfChanged.split(",").some((name) => {
        const el = form.elements.namedItem(name.trim());
        return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && norm(el.value) !== norm(el.defaultValue);
      });
      if (!changed) return;
    }
    e.preventDefault();
    submitter.current = ((e.nativeEvent as SubmitEvent).submitter as HTMLElement | null) ?? null;
    setChecking(true);
    ensure()
      .then((ok) => {
        if (ok) send();
      })
      .finally(() => setChecking(false));
  }

  return (
    <form ref={ref} action={action} onSubmit={onSubmit} className={className} style={style} id={id} aria-busy={checking || undefined}>
      {children}
      {dialog}
    </form>
  );
}

/** A download link for a sensitive file (data export): asks the person to confirm it is them first. */
export function StepUpLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const { ensure, dialog } = useConfirmIdentity();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <a
        href={href}
        className={className}
        aria-busy={busy || undefined}
        onClick={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          ensure()
            .then((ok) => {
              if (ok) window.location.href = href;
            })
            .finally(() => setBusy(false));
        }}
      >
        {children}
      </a>
      {dialog}
    </>
  );
}
