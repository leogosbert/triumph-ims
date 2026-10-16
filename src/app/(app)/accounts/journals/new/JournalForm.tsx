"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTr } from "@/lib/tr-client";
import { createJournal } from "../../actions";

type Opt = { id: string; label: string; type: string };
type Line = { key: number; a: string; t: string; d: string; c: string };

function num(s: string): number {
  const n = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function fmt(n: number, currency: string): string {
  const dec = currency === "TZS" ? 0 : 2;
  return `${currency} ${n.toLocaleString("en-GB", { minimumFractionDigits: dec, maximumFractionDigits: 2 })}`;
}

/** Journal by hand: lines with an account, a debit or a credit, and live totals. */
export function JournalForm({
  accounts,
  groups,
  today,
  currency,
  words,
}: {
  accounts: Opt[];
  groups: { key: string; label: string }[];
  today: string;
  currency: string;
  words: { dr: string; cr: string };
}) {
  const tr = useTr();
  const router = useRouter();
  const [next, setNext] = useState(3);
  const [lines, setLines] = useState<Line[]>([
    { key: 1, a: "", t: "", d: "", c: "" },
    { key: 2, a: "", t: "", d: "", c: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dr = lines.reduce((s, l) => s + num(l.d), 0);
  const cr = lines.reduce((s, l) => s + num(l.c), 0);
  const diff = Math.round((dr - cr) * 100) / 100;

  const set = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = () => {
    setLines((ls) => [...ls, { key: next, a: "", t: "", d: diff < 0 ? String(-diff) : "", c: diff > 0 ? String(diff) : "" }]);
    setNext((n) => n + 1);
  };
  const remove = (key: number) => setLines((ls) => (ls.length > 2 ? ls.filter((l) => l.key !== key) : ls));

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    form.set("lines", JSON.stringify(lines.map((l) => ({ a: l.a, t: l.t, d: num(l.d), c: num(l.c) }))));
    setBusy(true);
    try {
      const res = await createJournal(form);
      if (res.error || !res.id) {
        setError(res.error ?? "Something went wrong. Please try again.");
        setBusy(false);
        return;
      }
      router.push(`/accounts/journals/${res.id}?msg=${encodeURIComponent("Journal posted.")}`);
    } catch {
      setError("Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card">
      {error && (
        <p className="notice notice-error" role="alert">
          <span className="notice-icon" aria-hidden>
            !
          </span>
          <span>{tr(error)}</span>
        </p>
      )}
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="entry_date">{tr("Date")}</label>
          <input id="entry_date" name="entry_date" type="date" required defaultValue={today} />
        </div>
        <div className="field">
          <label htmlFor="memo">{tr("What is it for?")}</label>
          <input id="memo" name="memo" type="text" required minLength={2} maxLength={500} placeholder={tr("e.g. Bank loan received from CRDB")} />
        </div>
      </div>
      <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 12 }}>
        <input type="checkbox" name="opening" value="yes" /> {tr("Opening balances (what the business had on the day it started using LeMoSp)")}
      </label>

      <ul className="lines">
        {lines.map((l, i) => (
          <li key={l.key}>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor={`a${l.key}`}>
                  {tr("Account")} {i + 1}
                </label>
                <select id={`a${l.key}`} value={l.a} onChange={(e) => set(l.key, { a: e.target.value })} required>
                  <option value="">{tr("— Choose —")}</option>
                  {groups.map((g) => (
                    <optgroup key={g.key} label={g.label}>
                      {accounts
                        .filter((o) => o.type === g.key)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`t${l.key}`}>{tr("Description")}</label>
                <input id={`t${l.key}`} type="text" maxLength={300} value={l.t} onChange={(e) => set(l.key, { t: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor={`d${l.key}`}>{words.dr}</label>
                <input
                  id={`d${l.key}`}
                  type="text"
                  inputMode="decimal"
                  value={l.d}
                  onChange={(e) => set(l.key, { d: e.target.value, c: e.target.value ? "" : l.c })}
                />
              </div>
              <div className="field">
                <label htmlFor={`c${l.key}`}>{words.cr}</label>
                <input
                  id={`c${l.key}`}
                  type="text"
                  inputMode="decimal"
                  value={l.c}
                  onChange={(e) => set(l.key, { c: e.target.value, d: e.target.value ? "" : l.d })}
                />
              </div>
            </div>
            {lines.length > 2 && (
              <button type="button" className="btn btn-small" onClick={() => remove(l.key)}>
                {tr("Remove line")}
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="actions-bar" style={{ marginTop: 10 }}>
        <button type="button" className="btn btn-small" onClick={add} disabled={lines.length >= 200}>
          {tr("+ Line")}
        </button>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="n">{fmt(dr, currency)}</div>
          <div className="l">{words.dr}</div>
        </div>
        <div className="stat">
          <div className="n">{fmt(cr, currency)}</div>
          <div className="l">{words.cr}</div>
        </div>
      </div>
      {diff !== 0 ? (
        <p className="banner warn">
          {tr("Difference")}: {fmt(Math.abs(diff), currency)} · {tr("Debits and credits must be equal before you can post.")}
        </p>
      ) : dr > 0 ? (
        <p className="banner ok">{tr("The journal balances.")}</p>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={busy || diff !== 0 || dr === 0} aria-busy={busy}>
        {busy ? tr("Posting…") : tr("Post journal")}
      </button>
    </form>
  );
}
