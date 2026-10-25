"use client";

import Link from "next/link";
import type { AskAnswer, AskSource } from "@/lib/ai/ask";
import { citationParts } from "@/lib/ai/ask-prompt";
import { useTr } from "@/lib/tr-client";
import s from "./AskBox.module.css";

const KIND_LABEL: Record<AskSource["kind"], string> = {
  figures: "Your figures",
  guide: "App guide",
  rule: "Compliance list",
  status: "Your checklist",
  screen: "Screen",
  record: "Record",
};

/** Text with [n] source numbers turned into small links to the source. */
function Cited({ text, sources, onNavigate }: { text: string; sources: AskSource[]; onNavigate?: () => void }) {
  return (
    <>
      {citationParts(text).map((p, j) =>
        typeof p === "string" ? (
          <span key={j}>{p}</span>
        ) : (
          p.map((n) => {
            const src = sources.find((x) => x.n === n);
            if (!src) return null;
            return src.href ? (
              <Link key={`${j}-${n}`} href={src.href} className={s.cite} title={src.title} onClick={onNavigate}>
                {n}
              </Link>
            ) : (
              <span key={`${j}-${n}`} className={s.cite} title={src.title}>
                {n}
              </span>
            );
          })
        ),
      )}
    </>
  );
}

/**
 * One answer, laid out like Cocozania's search cards: title, a short intro, numbered steps (each can open
 * its screen), a button to the screen where it lives, follow-up questions, then the figures, the company's
 * checklist and the numbered sources behind it.
 */
export function AnswerView({ a, onNavigate, onAsk, compact = false }: { a: AskAnswer; onNavigate?: () => void; onAsk?: (q: string) => void; compact?: boolean }) {
  const tr = useTr();
  const paras = a.text.split(/\n+/).filter((l) => l.trim());
  const moreRules = a.rules.slice(a.ai ? 0 : 1);
  return (
    <article className={s.answer}>
      <header className={s.answerHead}>
        <strong>{a.title}</strong>
        {a.ai ? <span className="badge tone-ok">{tr("AI")}</span> : <span className="badge tone-off">{tr("Built-in")}</span>}
      </header>
      <div className={s.text}>
        {paras.map((p, i) => (
          <p key={i}>
            <Cited text={p.replace(/^[-•*]\s+/, "")} sources={a.sources} onNavigate={onNavigate} />
          </p>
        ))}
      </div>

      {a.steps.length > 0 && (
        <ol className={s.steps}>
          {a.steps.slice(0, compact ? 6 : 12).map((st, i) => (
            <li key={i}>
              {st.to ? (
                <Link href={st.to} onClick={onNavigate}>
                  <Cited text={st.text} sources={a.sources} />
                </Link>
              ) : (
                <Cited text={st.text} sources={a.sources} onNavigate={onNavigate} />
              )}
            </li>
          ))}
        </ol>
      )}

      {a.where && (
        <p>
          <Link href={a.where.to} className="btn btn-primary btn-small" onClick={onNavigate}>
            {a.where.path.map(tr).join(" → ")} ›
          </Link>
        </p>
      )}

      {a.notice && <p className="small muted">{a.notice}</p>}

      {a.figures?.rows && a.figures.rows.length > 0 && (
        <ul className={s.rows}>
          {a.figures.rows.slice(0, compact ? 5 : 12).map((r, i) => (
            <li key={i} className={r.tone ? `tone-${r.tone}` : undefined}>
              {r.href ? (
                <Link href={r.href} onClick={onNavigate}>
                  <span>{r.label}</span>
                  <span className="muted">{r.value}</span>
                </Link>
              ) : (
                <div>
                  <span>{r.label}</span>
                  <span className="muted">{r.value}</span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {a.status.length > 0 && (
        <div className={s.block}>
          <p className="small">
            <strong>{tr("Your company's checklist")}</strong>
          </p>
          <ul className={s.rows}>
            {a.status.slice(0, compact ? 5 : 30).map((r, i) => (
              <li key={i} className={r.tone ? `tone-${r.tone}` : undefined}>
                <Link href={r.href ?? "/compliance"} onClick={onNavigate}>
                  <span>{r.label}</span>
                  <span className="muted">{r.value}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!compact && !a.ai && a.rules[0]?.verify && (
        <p className="small muted">
          {tr("To confirm with the authority")}: {tr(a.rules[0].verify)}
        </p>
      )}

      {!compact && moreRules.length > 0 && (
        <div className={s.block}>
          <p className="small">
            <strong>{tr("Also applies")}</strong>
          </p>
          <ul className="small">
            {moreRules.map((r) => (
              <li key={r.title}>
                <Link href={r.href} onClick={onNavigate}>
                  {tr(r.title)}
                </Link>
                {r.authority && <span className="muted"> · {tr(r.authority)}</span>}
                {r.when && <span className="muted"> · {tr(r.when)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {a.legal && a.legalNote && <p className={`small ${s.legal}`}>{a.legalNote}</p>}

      {a.followups.length > 0 && onAsk && (
        <div className={s.chips}>
          {a.followups.map((f) => (
            <button key={f} type="button" className="as-chip" onClick={() => onAsk(f)}>
              {f}
            </button>
          ))}
        </div>
      )}

      {a.sources.length > 0 && (
        <details className={s.sources} open={!compact}>
          <summary className="small">
            {tr("Sources")} ({a.sources.length})
          </summary>
          <ol className="small">
            {a.sources.map((src) => (
              <li key={src.n}>
                <span className="muted">{tr(KIND_LABEL[src.kind])}: </span>
                {src.href ? (
                  <Link href={src.href} onClick={onNavigate}>
                    {tr(src.title)}
                  </Link>
                ) : (
                  tr(src.title)
                )}
                {src.external && (
                  <>
                    {" · "}
                    <a href={src.external} target="_blank" rel="noopener noreferrer">
                      {tr("Authority's page")}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </article>
  );
}
