"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { Answer } from "@/lib/assistant";
import { useTr } from "@/lib/tr-client";

type Turn = { id: number; q: string; a?: Answer; failed?: boolean };
const KEY = "lemosp-assistant";

/** The conversation: tap a suggestion or type; each answer shows its figures, records and any draft. */
export function AssistantChat({ ask, examples, initial }: { ask: (q: string) => Promise<Answer>; examples: string[]; initial?: string }) {
  const tr = useTr();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  // The conversation stays while the tab is open (not on the server, not on other devices).
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as Turn[];
      if (Array.isArray(saved)) setTurns(saved.filter((t) => t.a).slice(-20));
    } catch {
      /* nothing saved */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(turns.filter((t) => t.a).slice(-20)));
    } catch {
      /* private mode */
    }
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const send = (q: string) => {
    const question = q.trim();
    if (!question || pending) return;
    const id = Date.now();
    setTurns((t) => [...t, { id, q: question }]);
    setText("");
    start(async () => {
      try {
        const a = await ask(question);
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, a } : x)));
      } catch {
        setTurns((t) => t.map((x) => (x.id === id ? { ...x, failed: true } : x)));
      }
    });
  };

  // A question typed on the home screen (/assistant?q=…) is asked once on arrival.
  useEffect(() => {
    if (!initial || asked.current) return;
    asked.current = true;
    send(initial);
    window.history.replaceState(null, "", "/assistant");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const copy = async (id: number, draft: string) => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard blocked: the text can still be selected */
    }
  };

  return (
    <div className="as-chat">
      {turns.length === 0 && (
        <div className="as-hello card">
          <span className="as-orb" aria-hidden="true" />
          <p>
            <strong>{tr("Hello! What would you like to know?")}</strong>
          </p>
          <p className="muted small">{tr("Tap a question to start, or type your own below.")}</p>
        </div>
      )}

      <ol className="as-turns">
        {turns.map((t) => (
          <li key={t.id}>
            <p className="as-q">{t.q}</p>
            {t.a ? (
              <article className="as-a card">
                <header>
                  <strong>{t.a.title}</strong>
                  {t.a.ai && <span className="badge tone-ok">{tr("AI")}</span>}
                </header>
                <p className="as-text">{t.a.text}</p>
                {t.a.rows && t.a.rows.length > 0 && (
                  <ul className="as-rows">
                    {t.a.rows.map((r, i) => {
                      const inner = (
                        <>
                          <span className="as-label">{r.label}</span>
                          {r.value && <span className="as-value">{r.value}</span>}
                        </>
                      );
                      const cls = `as-row${r.tone ? ` tone-${r.tone}` : ""}`;
                      return (
                        <li key={i} style={{ "--i": i } as React.CSSProperties}>
                          {r.href ? (
                            <Link href={r.href} className={cls}>
                              {inner}
                            </Link>
                          ) : t.a!.topic === "help" ? (
                            <button type="button" className={cls} onClick={() => send(r.label)}>
                              {inner}
                            </button>
                          ) : (
                            <div className={cls}>{inner}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {t.a.draft && (
                  <div className="as-draft">
                    <pre>{t.a.draft}</pre>
                    <button type="button" className="btn btn-small" onClick={() => copy(t.id, t.a!.draft!)}>
                      {copied === t.id ? tr("Copied") : tr("Copy text")}
                    </button>
                  </div>
                )}
                {t.a.links && t.a.links.length > 0 && (
                  <p className="as-links">
                    {t.a.links.map((l) => (
                      <Link key={l.href} href={l.href} className="btn btn-small">
                        {l.label} ›
                      </Link>
                    ))}
                  </p>
                )}
              </article>
            ) : t.failed ? (
              <p className="as-a card muted">{tr("Something went wrong. Please try again.")}</p>
            ) : (
              <p className="as-a card as-typing" aria-label={tr("Thinking…")}>
                <span />
                <span />
                <span />
              </p>
            )}
          </li>
        ))}
      </ol>
      <div ref={end} />

      <div className="as-chips" role="list">
        {examples.map((q) => (
          <button key={q} type="button" role="listitem" className="as-chip" onClick={() => send(tr(q))} disabled={pending}>
            {tr(q)}
          </button>
        ))}
      </div>

      <form
        className="as-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input
          type="text"
          value={text}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
          placeholder={tr("Ask a question, for example: who owes us money?")}
          aria-label={tr("Your question")}
        />
        <button type="submit" className="btn btn-primary" disabled={pending || !text.trim()}>
          {tr("Ask")}
        </button>
        {turns.length > 0 && (
          <button type="button" className="btn" onClick={() => setTurns([])} disabled={pending}>
            {tr("Clear")}
          </button>
        )}
      </form>
    </div>
  );
}
