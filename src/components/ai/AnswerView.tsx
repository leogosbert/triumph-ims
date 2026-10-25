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

function Cite({ ns, sources, onNavigate }: { ns: number[]; sources: AskSource[]; onNavigate?: () => void }) {
  return (
    <>
      {ns.map((n) => {
        const src = sources.find((x) => x.n === n);
        if (!src) return null;
        return src.href ? (
          <Link key={n} href={src.href} className={s.cite} title={src.title} onClick={onNavigate}>
            {n}
          </Link>
        ) : (
          <span key={n} className={s.cite} title={src.title}>
            {n}
          </span>
        );
      })}
    </>
  );
}

/** One answer: the text with numbered sources, then the figures, rules, checklist, guide steps and matches behind it. */
export function AnswerView({ a, onNavigate, compact = false }: { a: AskAnswer; onNavigate?: () => void; compact?: boolean }) {
  const tr = useTr();
  const lines = a.text.split("\n");
  const list: React.ReactNode[] = [];
  let bullets: React.ReactNode[] = [];
  const flush = () => {
    if (bullets.length) list.push(<ul key={`u${list.length}`}>{bullets}</ul>);
    bullets = [];
  };
  lines.forEach((line, i) => {
    const t = line.trim();
    if (!t) return flush();
    const body = citationParts(t.replace(/^[-•*]\s+/, "")).map((p, j) =>
      typeof p === "string" ? <span key={j}>{p}</span> : <Cite key={j} ns={p} sources={a.sources} onNavigate={onNavigate} />,
    );
    if (/^[-•*]\s+/.test(t)) bullets.push(<li key={i}>{body}</li>);
    else {
      flush();
      list.push(<p key={i}>{body}</p>);
    }
  });
  flush();

  const limit = compact ? 3 : 50;
  return (
    <article className={s.answer}>
      <header className={s.answerHead}>
        <strong>{a.title}</strong>
        {a.ai ? <span className="badge tone-ok">{tr("AI")}</span> : <span className="badge tone-off">{tr("Built-in")}</span>}
      </header>
      <div className={s.text}>{list}</div>
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

      {!a.ai && a.rules.length > 0 && (
        <div className={s.block}>
          {a.rules.slice(0, limit).map((r) => (
            <section key={r.title} className={s.rule}>
              <p>
                <Link href={r.href} onClick={onNavigate}>
                  <strong>{tr(r.title)}</strong>
                </Link>
                {r.authority && <span className="muted"> · {tr(r.authority)}</span>}
              </p>
              {r.summary && <p className="small">{tr(r.summary)}</p>}
              {r.when && (
                <p className="small">
                  <strong>{tr("When")}:</strong> {tr(r.when)}
                </p>
              )}
              {r.verify && (
                <p className="small muted">
                  {tr("To confirm with the authority")}: {tr(r.verify)}
                </p>
              )}
              {r.documents.length > 0 && (
                <ul className="small">
                  {r.documents.slice(0, compact ? 5 : 20).map((d) => (
                    <li key={d}>{tr(d)}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
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

      {!a.ai && !a.figures && a.guide.length > 0 && (
        <div className={s.block}>
          {a.guide.slice(0, compact ? 1 : 3).map((g) => (
            <section key={g.href}>
              <p className="small">
                <Link href={g.href} onClick={onNavigate}>
                  <strong>{g.title}</strong>
                </Link>
                {g.where && <span className="muted"> · {g.where}</span>}
              </p>
              <ol className="small">
                {g.steps.slice(0, compact ? 4 : 12).map((st, i) => (
                  <li key={i}>{st}</li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {a.legal && a.legalNote && <p className={`small ${s.legal}`}>{a.legalNote}</p>}

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
