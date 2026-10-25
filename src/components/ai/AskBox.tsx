"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Icon } from "@/components/Icon";
import type { AskAnswer } from "@/lib/ai/ask";
import { askQuestion, quickSearch, type QuickResults } from "@/lib/ai/ask-actions";
import { useTr } from "@/lib/tr-client";
import { AnswerView } from "./AnswerView";
import s from "./AskBox.module.css";

type Item = { href: string; title: string; sub: string; side?: string; group: string };

/**
 * The search-and-ask box for the top bar. As you type it shows matching screens, App guide topics and
 * records; Enter (or "Ask") answers the question about the business in a panel below, with sources.
 * Arrow keys move through the matches; Enter on a match opens it; Escape closes.
 * `placeholder` overrides the default hint; `autoFocus` for a dedicated search screen.
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
  const [failed, setFailed] = useState(false);
  const [asking, startAsk] = useTransition();
  const seq = useRef(0);

  // Instant matches, a moment after typing stops.
  useEffect(() => {
    const text = q.trim();
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
  }, [q]);

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

  const ask = () => {
    const text = q.trim();
    if (text.length < 2 || asking) return;
    setOpen(true);
    setFailed(false);
    setAnswer(null);
    startAsk(async () => {
      try {
        setAnswer(await askQuestion(text));
      } catch {
        setFailed(true);
      }
    });
  };

  const close = () => {
    setOpen(false);
    setActive(-1);
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
      if (active >= 0 && items[active]) {
        close();
        router.push(items[active].href);
      } else ask();
    }
  };

  const showPanel = open && (q.trim().length >= 2 || answer || asking);
  let lastGroup = "";

  return (
    <div ref={wrap} className={`${s.box}${className ? ` ${className}` : ""}`}>
      <div className={s.inputRow} role="search">
        <Icon name="search" size={18} />
        <input
          ref={input}
          type="search"
          value={q}
          autoFocus={autoFocus}
          maxLength={500}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(-1);
            if (answer) setAnswer(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder ?? tr("Search or ask anything about the business")}
          aria-label={tr("Search or ask")}
          aria-expanded={!!showPanel}
          aria-controls={`${id}-panel`}
          aria-autocomplete="list"
          role="combobox"
          aria-activedescendant={active >= 0 ? `${id}-i${active}` : undefined}
        />
        <button type="button" className={`btn btn-small btn-primary ${s.askBtn}`} onClick={ask} disabled={q.trim().length < 2 || asking}>
          {asking ? "…" : tr("Ask AI")}
        </button>
      </div>

      {showPanel && (
        <div id={`${id}-panel`} className={`${s.panel} card`}>
          {(asking || answer || failed) && (
            <div className={s.answerWrap} aria-live="polite">
              {asking ? (
                <p className="as-typing" aria-label={tr("Thinking…")}>
                  <span />
                  <span />
                  <span />
                </p>
              ) : failed ? (
                <p className="muted small">{tr("Something went wrong. Please try again.")}</p>
              ) : answer ? (
                <>
                  <AnswerView a={answer} compact onNavigate={close} />
                  <p className="small">
                    <Link href={`/search?q=${encodeURIComponent(answer.question)}&ask=1`} onClick={close}>
                      {tr("Open the full answer")} ›
                    </Link>
                  </p>
                </>
              ) : null}
            </div>
          )}

          {!answer && !asking && (
            <>
              <button type="button" className={s.askRow} onClick={ask}>
                <Icon name="help" size={18} />
                <span>
                  {tr("Ask AI")}: <strong>“{q.trim()}”</strong>
                </span>
                <span className="muted small">Enter</span>
              </button>
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
                          onClick={close}
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
              {quick && items.length === 0 && q.trim().length >= 2 && <p className="muted small">{tr("No screens or records match. Press Enter to ask.")}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
