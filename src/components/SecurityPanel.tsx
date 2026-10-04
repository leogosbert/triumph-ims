"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TotpSetup } from "@/components/TotpSetup";
import { createClient } from "@/lib/supabase/client";
import { useTr } from "@/lib/tr-client";

type Factor = { id: string; friendly_name?: string; created_at: string };

/** Your account → Security: two-step verification, sign out other devices, last sign-in. */
export function SecurityPanel({ lastSignIn, required }: { lastSignIn: string | null; required: boolean }) {
  const tr = useTr();
  const router = useRouter();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [setting, setSetting] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await createClient().auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  }
  useEffect(() => {
    load();
  }, []);

  async function turnOff(id: string) {
    if (required) {
      setMsg({ err: tr("Your company requires two-step verification, so it cannot be turned off.") });
      return;
    }
    if (!window.confirm(tr("Turn off two-step verification? Signing in will need only your password."))) return;
    setBusy(true);
    const { error } = await createClient().auth.mfa.unenroll({ factorId: id });
    setBusy(false);
    if (error) {
      setMsg({ err: tr("Sign out and sign in again with your code, then try once more.") });
      return;
    }
    setMsg({ ok: tr("Two-step verification is off.") });
    await load();
    router.refresh();
  }

  async function signOutOthers() {
    setBusy(true);
    const { error } = await createClient().auth.signOut({ scope: "others" });
    setBusy(false);
    setMsg(error ? { err: tr("Could not sign out the other devices. Please try again.") } : { ok: tr("Signed out on all your other phones and computers.") });
  }

  const on = (factors?.length ?? 0) > 0;

  return (
    <section className="card" id="security">
      <h2>{tr("Security")}</h2>
      {msg.ok && <p className="notice notice-ok">{msg.ok}</p>}
      {msg.err && <p className="notice notice-error">{msg.err}</p>}

      <div className="sec-row">
        <div>
          <strong>{tr("Two-step verification")}</strong>
          <span className="small muted">
            {factors === null
              ? tr("Checking…")
              : on
                ? tr("On — sign-in asks for a code from your authenticator app.")
                : tr("Off — anyone with your password can sign in.")}
          </span>
        </div>
        <span className={`badge ${on ? "tone-ok" : "tone-warn"}`}>{on ? tr("On") : tr("Off")}</span>
      </div>
      {factors !== null && !on && !setting && (
        <button type="button" className="btn btn-primary btn-block" onClick={() => setSetting(true)}>
          {tr("Turn on two-step verification")}
        </button>
      )}
      {setting && !on && (
        <TotpSetup
          onDone={async () => {
            setSetting(false);
            setMsg({ ok: tr("Two-step verification is on. Keep your authenticator app safe.") });
            await load();
            router.refresh();
          }}
        />
      )}
      {on &&
        factors!.map((f) => (
          <div key={f.id} className="sec-factor small">
            <span>
              {tr("Authenticator app")} · {tr("added")} {new Date(f.created_at).toLocaleDateString("en-GB")}
            </span>
            <button type="button" className="demo-link" onClick={() => turnOff(f.id)} disabled={busy}>
              {tr("Turn off")}
            </button>
          </div>
        ))}

      <div className="sec-row" style={{ marginTop: 14 }}>
        <div>
          <strong>{tr("Other devices")}</strong>
          <span className="small muted">{tr("Lost a phone or used a shared computer? Sign out everywhere except here.")}</span>
        </div>
      </div>
      <button type="button" className="btn btn-block" onClick={signOutOthers} disabled={busy}>
        {tr("Sign out on all other devices")}
      </button>
      {lastSignIn && (
        <p className="small muted" style={{ marginBottom: 0 }}>
          {tr("Last sign-in")}: {new Date(lastSignIn).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
        </p>
      )}
    </section>
  );
}
