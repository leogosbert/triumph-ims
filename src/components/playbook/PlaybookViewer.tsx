"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Playbook, PlaybookExample, PlaybookScenario, PlaybookStep } from "@/lib/playbooks/types";
import { useTr } from "@/lib/tr-client";

type Flat = { chapter: number; index: number; step: PlaybookStep };

/** A sample record that builds itself line by line and gets its stamp (same look as How it works). */
function Example({ ex }: { ex: PlaybookExample }) {
  return (
    <article className={`j-doc tone-${ex.tone}`}>
      <header>
        <span className="j-kind">{ex.kind}</span>
        <strong>{ex.title}</strong>
      </header>
      <dl>
        {ex.lines.map(([k, v], i) => (
          <div key={`${k}-${i}`} className={i === ex.mark ? "mark" : undefined} style={{ "--i": i } as React.CSSProperties}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {ex.stamp && (
        <span className="j-stamp" style={{ "--i": ex.lines.length } as React.CSSProperties}>
          {ex.stamp}
        </span>
      )}
    </article>
  );
}

/** "If this happens": tap to open the fix. The first one starts open. */
function Scenario({ sc, i }: { sc: PlaybookScenario; i: number }) {
  const tr = useTr();
  return (
    <details className={`pb-scn tone-${sc.tone ?? "warn"}`} open={i === 0} style={{ "--i": i } as React.CSSProperties}>
      <summary>
        <span className="pb-scn-tag">{tr("If this happens")}</span>
        <strong>{sc.title}</strong>
      </summary>
      <p>{sc.problem}</p>
      <ol>
        {sc.fix.map((f, k) => (
          <li key={k}>{f}</li>
        ))}
      </ol>
    </details>
  );
}

/**
 * One playbook, a step at a time: chapters on the side (a list on phones), the step with its
 * numbered actions, an animated sample and "If this happens" scenarios. Back / Next, arrow keys
 * or a swipe move on; the place is remembered on this device and in the address (#step-id).
 */
export function PlaybookViewer({ pb, inApp, pdfHref }: { pb: Playbook; inApp: boolean; pdfHref: string }) {
  const tr = useTr();
  const flat = useMemo<Flat[]>(
    () => pb.chapters.flatMap((c, ci) => c.steps.map((step, index) => ({ chapter: ci, index, step }))),
    [pb],
  );
  const total = flat.length;
  const [pos, setPos] = useState(0);
  const [dir, setDir] = useState<"next" | "back">("next");
  const [menu, setMenu] = useState(false);
  const top = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const key = `lemosp-playbook-${pb.id}`;

  // Start where the address says, else where this device stopped last time.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    let start = hash ? flat.findIndex((f) => f.step.id === hash) : -1;
    if (start < 0) {
      try {
        start = flat.findIndex((f) => f.step.id === localStorage.getItem(key));
      } catch {
        start = -1;
      }
    }
    if (start > 0) setPos(start);
  }, [flat, key]);

  useEffect(() => {
    const id = flat[pos]?.step.id;
    if (!id) return;
    if (window.location.hash !== `#${id}`) window.history.replaceState(null, "", `#${id}`);
    try {
      localStorage.setItem(key, id);
    } catch {
      /* private mode */
    }
  }, [pos, flat, key]);

  const go = useCallback(
    (to: number) => {
      const t = Math.max(0, Math.min(total - 1, to));
      if (t === pos) return;
      setDir(t > pos ? "next" : "back");
      setPos(t);
      setMenu(false);
      const el = top.current;
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [pos, total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.key === "ArrowRight") go(pos + 1);
      else if (e.key === "ArrowLeft") go(pos - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, pos]);

  const cur = flat[pos];
  if (!cur) return null;
  const chapter = pb.chapters[cur.chapter];
  const step = cur.step;
  const next = flat[pos + 1];
  const pct = Math.round(((pos + 1) / total) * 100);

  return (
    <div className="pb" ref={top}>
      <div className="pb-top">
        <div className="j-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${(pos + 1) / total})` }} />
        </div>
        <div className="pb-top-row">
          <button type="button" className="pb-menu-btn" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            ☰ {tr("Chapters")}
          </button>
          <span className="pb-count">
            {tr("Step")} {pos + 1} {tr("of")} {total} · {pct}%
          </span>
          <a className="pb-pdf" href={pdfHref} download>
            ⬇ {tr("Download PDF")}
          </a>
        </div>
      </div>

      <div className="pb-grid">
        <nav className={`pb-toc${menu ? " open" : ""}`} aria-label={tr("Chapters")}>
          <ol>
            {pb.chapters.map((c, ci) => {
              const first = flat.findIndex((f) => f.chapter === ci);
              const here = ci === cur.chapter;
              const doneCh = first >= 0 && first + c.steps.length - 1 < pos;
              return (
                <li key={c.id} className={here ? "here" : doneCh ? "done" : undefined}>
                  <button type="button" onClick={() => go(first)}>
                    <span className="pb-ch-n">{doneCh ? "✓" : ci + 1}</span>
                    <span>{c.title}</span>
                  </button>
                  {here && (
                    <ol className="pb-toc-steps">
                      {c.steps.map((s, si) => (
                        <li key={s.id}>
                          <button type="button" aria-current={si === cur.index ? "step" : undefined} onClick={() => go(first + si)}>
                            {s.title}
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <div
          className="j-viewport pb-view"
          aria-live="polite"
          onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
          onTouchEnd={(e) => {
            const s = touch.current;
            touch.current = null;
            if (!s) return;
            const dx = e.changedTouches[0].clientX - s.x;
            const dy = e.changedTouches[0].clientY - s.y;
            if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) go(dx < 0 ? pos + 1 : pos - 1);
          }}
        >
          <section key={step.id} className={`j-slide pb-slide ${dir}`} aria-labelledby={`pb-${step.id}`}>
            <div className="j-text">
              <p className="j-count">
                {tr("Chapter")} {cur.chapter + 1}: {chapter.title}
              </p>
              {cur.index === 0 && <p className="pb-intro">{chapter.intro}</p>}
              <h2 id={`pb-${step.id}`}>{step.title}</h2>
              <p className="j-story">{step.body}</p>
              {step.who && (
                <p className="pb-who">
                  <span>{tr("Who:")}</span> {step.who}
                </p>
              )}
              {step.do && step.do.length > 0 && (
                <>
                  <h3>{tr("Step by step")}</h3>
                  <ol className="j-todo">
                    {step.do.map((t, i) => (
                      <li key={i} style={{ "--i": i } as React.CSSProperties}>
                        {t}
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {step.where && step.where.length > 0 && (
                <p className="j-where">
                  <span className="muted">{tr("Where:")}</span>{" "}
                  {step.where.map((w, i) => (
                    <span key={i} className="j-crumb">
                      {w}
                    </span>
                  ))}
                </p>
              )}
              {inApp && step.href && (
                <Link href={step.href} className="j-open">
                  {tr("Open this screen")} ›
                </Link>
              )}
              {step.tip && (
                <p className="pb-tip">
                  <strong>{tr("Tip")}</strong> {step.tip}
                </p>
              )}
            </div>
            {(step.example || (step.scenarios && step.scenarios.length > 0)) && (
              <div className="pb-side">
                {step.example && <Example ex={step.example} />}
                {step.scenarios?.map((sc, i) => <Scenario key={`${step.id}-${i}`} sc={sc} i={i} />)}
              </div>
            )}
          </section>
        </div>
      </div>

      <nav className="j-nav" aria-label={tr("Steps")}>
        <button type="button" className="btn j-back" onClick={() => go(pos - 1)} disabled={pos === 0}>
          ‹ {tr("Back")}
        </button>
        {next ? (
          <button type="button" className="btn btn-primary j-next" onClick={() => go(pos + 1)}>
            <span>{tr("Next")}</span>
            <small>{next.step.title}</small>
            <span aria-hidden="true" className="j-arrow">
              ›
            </span>
          </button>
        ) : (
          <Link href="/playbooks" className="btn btn-primary j-next">
            <span>{tr("Finish")}</span>
            <small>{tr("All playbooks")}</small>
            <span aria-hidden="true" className="j-arrow">
              ›
            </span>
          </Link>
        )}
      </nav>
    </div>
  );
}
