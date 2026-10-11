"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { JOURNEY, SCALE_NOTE, type Party } from "@/lib/journey";
import { useTr } from "@/lib/tr-client";

const PARTY_POS: Record<Party, number> = { customer: 0, you: 1, supplier: 2 };

/** The three parties at the top of each step, with the paperwork travelling between them. */
function Parties({ flow }: { flow?: { from: Party; to: Party } }) {
  const tr = useTr();
  const active = (p: Party) => (flow ? flow.from === p || flow.to === p : p === "you");
  const style = flow
    ? ({ "--from": PARTY_POS[flow.from], "--to": PARTY_POS[flow.to] } as React.CSSProperties)
    : undefined;
  return (
    <div className="j-parties" aria-hidden="true">
      <div className="j-track">
        <span className="j-line" />
        {flow && (
          <span className="j-packet" style={style}>
            <Icon name="doc" size={16} />
          </span>
        )}
      </div>
      <div className={`j-party${active("customer") ? " on" : ""}`}>
        <span className="j-avatar">
          <Icon name="building" size={22} />
        </span>
        <span>{tr("Customer")}</span>
      </div>
      <div className={`j-party you${active("you") ? " on" : ""}`}>
        <span className="j-avatar">
          <img src="/favicon.svg" alt="" width={26} height={26} />
        </span>
        <span>{tr("You, in LeMoSp")}</span>
      </div>
      <div className={`j-party${active("supplier") ? " on" : ""}`}>
        <span className="j-avatar">
          <Icon name="truck" size={22} />
        </span>
        <span>{tr("Supplier")}</span>
      </div>
    </div>
  );
}

/**
 * "How it works": one order followed from the first call to the profit, one step per screen.
 * Back / Next (or the arrow keys, or a swipe) move between steps with a slide; the sample document
 * of each step builds itself line by line and gets its stamp. The last screen (`end`) offers the demos.
 * `inApp`: signed in, so each step can open its real screen.
 */
export function JourneyStory({ end, inApp }: { end: React.ReactNode; inApp: boolean }) {
  const tr = useTr();
  const total = JOURNEY.length;
  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<"next" | "back">("next");
  const touch = useRef<{ x: number; y: number } | null>(null);
  const top = useRef<HTMLDivElement>(null);

  const go = useCallback(
    (to: number) => {
      const t = Math.max(0, Math.min(total, to));
      if (t === idx) return;
      setDir(t > idx ? "next" : "back");
      setIdx(t);
    },
    [idx, total],
  );

  // Open at the step in the address (#step-4), and keep the address in step with the screen.
  useEffect(() => {
    const m = /^#step-(\d+)$/.exec(window.location.hash);
    if (m) setIdx(Math.max(0, Math.min(total, Number(m[1]) - 1)));
  }, [total]);
  useEffect(() => {
    const hash = idx < total ? `#step-${idx + 1}` : "#try-it";
    if (window.location.hash !== hash) window.history.replaceState(null, "", hash);
    // Bring the top of the story into view on a phone after a step change.
    const el = top.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [idx, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") go(idx + 1);
      else if (e.key === "ArrowLeft") go(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, idx]);

  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? idx + 1 : idx - 1);
  };

  const step = idx < total ? JOURNEY[idx] : null;
  const next = idx + 1 < total ? JOURNEY[idx + 1] : null;

  return (
    <div className="journey" ref={top}>
      <div className="j-progress" role="group" aria-label={tr("Steps")}>
        <div className="j-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.min(1, (idx + 1) / (total + 1))})` }} />
        </div>
        <ol className="j-dots">
          {JOURNEY.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                className={i < idx ? "done" : i === idx ? "now" : undefined}
                aria-current={i === idx ? "step" : undefined}
                aria-label={`${tr("Step")} ${i + 1}: ${tr(s.title)}`}
                title={tr(s.title)}
                onClick={() => go(i)}
              />
            </li>
          ))}
          <li>
            <button
              type="button"
              className={`last${idx === total ? " now" : ""}`}
              aria-current={idx === total ? "step" : undefined}
              aria-label={tr("Try it yourself")}
              title={tr("Try it yourself")}
              onClick={() => go(total)}
            />
          </li>
        </ol>
      </div>

      <div className="j-viewport" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-live="polite">
        {step ? (
          <section key={step.id} className={`j-slide ${dir}`} aria-labelledby={`j-title-${step.id}`}>
            <div className="j-scene">
              <Parties flow={step.flow} />
              <article className={`j-doc tone-${step.doc.tone}`}>
                <header>
                  <span className="j-kind">{tr(step.doc.kind)}</span>
                  <strong>{tr(step.doc.number)}</strong>
                </header>
                <dl>
                  {step.doc.lines.map(([k, v], i) => (
                    <div key={k} className={i === step.doc.mark ? "mark" : undefined} style={{ "--i": i } as React.CSSProperties}>
                      <dt>{tr(k)}</dt>
                      <dd>{tr(v)}</dd>
                    </div>
                  ))}
                </dl>
                <span className="j-stamp" style={{ "--i": step.doc.lines.length } as React.CSSProperties}>
                  {tr(step.doc.stamp)}
                </span>
              </article>
            </div>

            <div className="j-text">
              <p className="j-count">
                {tr("Step")} {idx + 1} {tr("of")} {total}
              </p>
              <h2 id={`j-title-${step.id}`}>{tr(step.title)}</h2>
              <p className="j-story">{tr(step.story)}</p>
              <h3>{tr("What you do in LeMoSp")}</h3>
              <ol className="j-todo">
                {step.todo.map((t, i) => (
                  <li key={i} style={{ "--i": i } as React.CSSProperties}>
                    {tr(t)}
                  </li>
                ))}
              </ol>
              <p className="j-where">
                <span className="muted">{tr("Where:")}</span>{" "}
                {step.where.map((w, i) => (
                  <span key={i} className="j-crumb">
                    {tr(w)}
                  </span>
                ))}
              </p>
              {step.scales && <p className="j-scale">{tr(SCALE_NOTE[step.scales])}</p>}
              {inApp && (
                <Link href={step.href} className="j-open">
                  {tr("Open this screen")} ›
                </Link>
              )}
            </div>
          </section>
        ) : (
          <section key="end" className={`j-slide j-end ${dir}`} aria-label={tr("Try it yourself")}>
            {end}
          </section>
        )}
      </div>

      <nav className="j-nav" aria-label={tr("Steps")}>
        <button type="button" className="btn j-back" onClick={() => go(idx - 1)} disabled={idx === 0}>
          ‹ {tr("Back")}
        </button>
        {idx < total && (
          <button type="button" className="btn btn-primary j-next" onClick={() => go(idx + 1)}>
            <span>{next ? tr("Next") : tr("Finish")}</span>
            {next && <small>{tr(next.title)}</small>}
            <span aria-hidden="true" className="j-arrow">
              ›
            </span>
          </button>
        )}
        {idx === total && (
          <button type="button" className="btn j-next" onClick={() => go(0)}>
            {tr("Start again")}
          </button>
        )}
      </nav>
      <p className="j-keys muted small">{tr("Tip: use the arrow keys, or swipe on a phone.")}</p>
    </div>
  );
}
