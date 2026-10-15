"use client";

import { useState, useTransition } from "react";
import { useConfirmIdentity } from "@/components/ConfirmIdentity";
import { useTr } from "@/lib/tr-client";

/** Name a key, confirm it is you, and see the key once (with a copy button). */
export function ApiKeyCreator({ create }: { create: (name: string) => Promise<{ key?: string; error?: string; stepUp?: boolean }> }) {
  const tr = useTr();
  const [name, setName] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const { ensure, dialog } = useConfirmIdentity();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!(await ensure())) return;
    start(async () => {
      const r = await create(name);
      if (r.key) {
        setKey(r.key);
        setName("");
      } else setError(r.error ?? tr("Something went wrong. Please try again."));
    });
  };

  if (key) {
    return (
      <div className="card int-new" role="status">
        <p>
          <strong>{tr("Your new key. Copy it now: it is shown only once.")}</strong>
        </p>
        <p className="int-key">{key}</p>
        <div className="row" style={{ gap: 8 }}>
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(key);
                setCopied(true);
              } catch {
                /* select the text instead */
              }
            }}
          >
            {copied ? tr("Copied") : tr("Copy key")}
          </button>
          <button type="button" className="btn btn-small" onClick={() => setKey(null)}>
            {tr("Done")}
          </button>
        </div>
        <p className="small muted">{tr("Keep it like a password: whoever has it can read your clients, products, stock, invoices and payments.")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <label htmlFor="key_name">{tr("Name of the system that will use it")}</label>
        <input id="key_name" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("For example: Accounting software")} minLength={2} maxLength={80} required />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending || name.trim().length < 2}>
        {pending ? "…" : tr("Create key")}
      </button>
      {error && <p className="notice notice-error" style={{ width: "100%" }}>{error}</p>}
      {dialog}
    </form>
  );
}
