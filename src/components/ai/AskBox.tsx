"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { AskAnswer } from "@/lib/ai/ask";
import { askQuestion, quickSearch, sendWish, type QuickResults } from "@/lib/ai/ask-actions";
import { useTr } from "@/lib/tr-client";
import { AnswerView } from "./AnswerView";
import s from "./AskBox.module.css";

type Item = { href: string; title: string; sub: string; side?: string; group: string };

const RECENT = "lemosp.search.recent";
const recent = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
};
const remember = (q: string) => {
  try {
    localStorage.setItem(RECENT, JSON.stringify([q, ...recent().filter((x) => x !== q)].slice(0, 6)));
  } catch {
    /* private mode */
  }
};

export const ASK_EXAMPLES = [
  "Who owes us money?",
  "What documents do I need to supply lubricants to a mine?",
  "What do I need ready for a TRA audit?",
  "When is VAT due?",
  "How do I record an expense?",
  "What should we reorder?",
];

/**
 * Search and Ask AI in one box, for the top bar (works like Cocozania's Tafuta). As you type it shows
 * matching screens, App guide topics and records; questions about the figures (money owed, sales,
 * stock…) are answered at once from the records. Enter or "Ask AI" answers anything about the business
 * with sources. When nothing in the app matches, the AI answers by itself after a moment, and the words
 * can be sent to the Suggestion Box as a wish for the app. Arrow keys move through the matches; Escape closes.
 */
export function AskBox({ placeholder, autoFocus = false, className }: { placeholder?: string; autoFocus?: boolean; className?: string }) {
  const tr = useTr();
  const router = useRouter();
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [quick, setQuick] = useState<QuickResults | null>(null);
  const [active, setActive] = useState(-1);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [wished, setWished] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const seq = useRef(0);
  const asked = useRef<string | null>(null);
  const text = q.trim();

  // Instant matches, a moment after typing stops.
  useEffect(() => {
    if (text.length < 2) {
      setQuick(null);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await quickSearch(text);
        if (mine === seq.current) setQuick(r);
      } catch {
        /* offline: keep what is shown */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [text]);

  const ask = async (question: string, ai: boolean) => {
    const qq = question.trim();
    if (qq.length < 2) return;
    asked.current = `${ai ? "ai" : "fig"}:${qq}`;
    setOpen(true);
    setFailed(false);
    setAsking(qq);
    if (ai) remember(qq);
    try {
      const a = await askQuestion(qq, ai);
      if (asked.current === `${ai ? "ai" : "fig"}:${qq}`) setAnswer(a);
    } catch {
      setFailed(true);
    } finally {
      setAsking((cur) => (cur === qq ? null : cur));
    }
  };

  // Questions about the figures are answered at once from the records (no AI allowance used).
  useEffect(() => {
    if (!quick || quick.q !== text || !quick.figures || answer?.question === text) return;
    const t = setTimeout(() => ask(text, false), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quick]);

  // Nothing in the app matches a real question: the AI takes over by itself after a moment.
  const stuck = !!quick && quick.q === text && quick.aiOn && !quick.figures && quick.pages.length + quick.guide.length + quick.records.length === 0 && text.split(" ").length >= 3;
  useEffect(() => {
    if (!stuck || asked.current === `ai:${text}`) return;
    const t = setTimeout(() => ask(text, true), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stuck, text]);

  // Close when tapping elsewhere.
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, []);

  const items: Item[] = quick
    ? [
        ...quick.pages.map((h) => ({ ...h, group: tr("Screens") })),
        ...quick.guide.map((h) => ({ ...h, group: tr("App guide") })),
        ...quick.records.flatMap((g) => g.hits.map((h) => ({ ...h, group: g.title }))),
      ].slice(0, 14)
    : [];

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const go = (href: string) => {
    if (text) remember(text);
    close();
    router.push(href);
  };
  const setQuestion = (v: string) => {
    setQ(v);
    setOpen(true);
    setActive(-1);
    setAnswer(null);
    setFailed(false);
    input.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, -1));
    } else if (e.key === "Escape") {
      close();
      input.current?.blur();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && items[active]) go(items[active].href);
      else ask(text, true);
    }
  };

  const wish = async () => {
    const r = await sendWish(text);
    if (r.ok) setWished(text);
  };

  const nothing = !!quick && quick.q === text && items.length === 0 && !quick.figures;
  const showAnswer = !!asking || !!answer || failed;
  let lastGroup = "";

  return (
    <div ref={wrap} className={`${s.box}${className ? ` ${className}` : ""}`}>
      <div className={s.inputRow} role="search">
        <Icon name="search" size={18} />
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          value={q}
          autoFocus={autoFocus}
          maxLength={500}
          onChange={(e) => setQuestion(e.target.value)}
          onFocus={() => {
            setOpen(true);
            setRecents(recent());
          }}
          onKeyDown={onKey}
          placeholder={placeholder ?? tr("Search or ask anything about the business")}
          aria-label={tr("Search or ask")}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          aria-autocomplete="list"
          role="combobox"
          aria-activedescendant={active >= 0 ? `${id}-i${active}` : undefined}
        />
        <button type="button" className={`btn btn-small btn-primary ${s.askBtn}`} onClick={() => ask(text, true)} disabled={text.length < 2 || !!asking}>
          {asking ? "…" : tr("Ask AI")}
        </button>
      </div>

      {open && (
        <div id={`${id}-panel`} className={`${s.panel} card`}>
          {text.length < 2 && !showAnswer && (
            <div className={s.start}>
              <p className="small">
                <strong>{tr("Search and Ask AI in one place")}</strong>
                <br />
                <span className="muted">{tr("Ask how to do something, ask about your business or the documents you need, in English, Kiswahili or both.")}</span>
              </p>
              {recents.length > 0 && (
                <>
                  <p className={s.group}>{tr("Recent")}</p>
                  <div className={s.chips}>
                    {recents.map((x) => (
                      <button key={x} type="button" className="as-chip" onClick={() => setQuestion(x)}>
                        {x}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className={s.group}>{tr("Try")}</p>
              <div className={s.chips}>
                {ASK_EXAMPLES.map((x) => (
                  <button key={x} type="button" className="as-chip" onClick={() => setQuestion(tr(x))}>
                    {tr(x)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {showAnswer && (
            <div className={s.answerWrap} aria-live="polite">
              {asking && !answer ? (
                <p className="as-typing" aria-label={tr("Thinking…")}>
                  <span />
                  <span />
                  <span />
                </p>
              ) : failed ? (
                <p className="muted small">{tr("Something went wrong. Please try again.")}</p>
              ) : answer ? (
                <>
                  <AnswerView a={answer} compact onNavigate={close} onAsk={(f) => setQuestion(f)} />
                  <div className="row small" style={{ gap: 12, flexWrap: "wrap", marginTop: 6 }}>
                    {!answer.ai && quick?.aiOn && (
                      <button type="button" className="btn btn-small" onClick={() => ask(answer.question, true)} disabled={!!asking}>
                        {asking ? "…" : tr("Ask AI")}
                      </button>
                    )}
                    <Link href={`/search?q=${encodeURIComponent(answer.question)}&ask=1`} onClick={close}>
                      {tr("Open the full answer")} ›
                    </Link>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {text.length >= 2 && (
            <>
              {!answer && !asking && (
                <button type="button" className={s.askRow} onClick={() => ask(text, true)}>
                  <Icon name="help" size={18} />
                  <span>
                    {tr("Ask AI")}: <strong>“{text}”</strong>
                  </span>
                  <span className="muted small">Enter</span>
                </button>
              )}
              {items.length > 0 && (
                <ul className={s.list} role="listbox">
                  {items.map((it, i) => {
                    const head = it.group !== lastGroup ? it.group : null;
                    lastGroup = it.group;
                    return (
                      <li key={`${it.href}-${i}`} role="presentation">
                        {head && <p className={s.group}>{head}</p>}
                        <Link
                          id={`${id}-i${i}`}
                          role="option"
                          aria-selected={i === active}
                          href={it.href}
                          className={`${s.item}${i === active ? ` ${s.active}` : ""}`}
                          onClick={() => {
                            remember(text);
                            close();
                          }}
                        >
                          <span className={s.itemMain}>
                            <span className={s.itemTitle}>{it.title}</span>
                            {it.sub && <span className={s.itemSub}>{it.sub}</span>}
                          </span>
                          {it.side && <span className="muted small">{it.side}</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {nothing && (
                <div className={s.wish}>
                  <span className="muted small">{quick?.aiOn ? tr("Nothing in the app matches. The AI answers in a moment, or press Enter.") : tr("No screens or records match.")}</span>
                  {quick?.canWish && text.length >= 3 && (
                    <button type="button" className="btn btn-small" onClick={wish} disabled={wished === text}>
                      {wished === text ? tr("Sent to the Suggestion Box") : tr("Ask for this in the app")}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
