"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import type { AskAnswer } from "@/lib/ai/ask";
import { askQuestion, quickSearch, ruleStatus, searchIndex, sendWish, type QuickResults, type RuleStatus } from "@/lib/ai/ask-actions";
import { buildIndex, FINDER_EXAMPLES, isQuestion, rank, type FinderEntry, type FinderHit, type FinderIndex, type FinderResult } from "@/lib/ai/finder";
import { useTr } from "@/lib/tr-client";
import { AnswerView } from "./AnswerView";
import s from "./AskBox.module.css";

type Item = { href: string; title: string; sub: string; side?: string; group: string };

// ---------- recent searches (this browser only) ----------
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

// ---------- the search index (screens, guide, compliance, playbooks), kept for offline use ----------
const INDEX_KEY = "lemosp.search.index.v1";
let loaded: { v: string; index: FinderIndex } | null = null;
let loading: Promise<FinderIndex | null> | null = null;

function cachedEntries(): { v: string; entries: FinderEntry[] } | null {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.v === "string" && Array.isArray(v.entries) ? v : null;
  } catch {
    return null;
  }
}

/** Loads the index once per page load: the copy in this browser at once, then the server's if it changed. */
function loadIndex(onReady: (i: FinderIndex) => void): void {
  if (loaded) return onReady(loaded.index);
  const cached = cachedEntries();
  if (cached) {
    loaded = { v: cached.v, index: buildIndex(cached.entries) };
    onReady(loaded.index);
  }
  loading ??= searchIndex(cached?.v)
    .then((r) => {
      if (r.entries) {
        loaded = { v: r.v, index: buildIndex(r.entries) };
        try {
          localStorage.setItem(INDEX_KEY, JSON.stringify({ v: r.v, entries: r.entries }));
        } catch {
          /* full or private: keep it in memory */
        }
      }
      return loaded?.index ?? null;
    })
    .catch(() => loaded?.index ?? null);
  void loading.then((i) => i && onReady(i));
}

// ---------- opening the box from anywhere ----------
const OPEN_EVENT = "lemosp:ask";
/** Opens the Ask box (the one in the top bar), optionally with words already typed. For "Ask AI" buttons anywhere. */
export function openAsk(q = ""): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: q }));
}
/** Only one Ask box answers the keyboard shortcut and openAsk (the first one on the screen). */
let shortcutOwner: symbol | null = null;

// ---------- voice ----------
type Recognition = { lang: string; interimResults: boolean; start: () => void; onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null; onend: (() => void) | null; onerror: ((e: { error?: string }) => void) | null };
function speechCtor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
  if (!Ctor) return null;
  // The site's Permissions-Policy decides whether the microphone may be used at all.
  const d = document as unknown as { permissionsPolicy?: { allowsFeature: (f: string) => boolean }; featurePolicy?: { allowsFeature: (f: string) => boolean } };
  const policy = d.permissionsPolicy ?? d.featurePolicy;
  if (policy && !policy.allowsFeature("microphone")) return null;
  return Ctor;
}

export const ASK_EXAMPLES = FINDER_EXAMPLES;

const LANG_LABEL = { en: "English", sw: "Kiswahili", mix: "Kiswahili + English" } as const;

/**
 * Search and Ask AI in one box, for the top bar (works like Cocozania's Tafuta):
 * - As you type it understands English, Kiswahili or a mix, forgives spelling slips, and shows the best
 *   match with its steps and a "Take me there" button, related screens and guides, and your records.
 *   The screens and guides are ranked in the browser, so they appear at once and still work offline.
 * - Questions about the figures (money owed, sales, stock…) are answered at once from the records.
 * - When the app does not do something it says so, with what to do instead and "Ask for this in the app".
 * - Enter opens the best match, or asks the AI for a question; when nothing matches, the AI answers by
 *   itself after a moment. Arrow keys move through the matches, Escape closes, "/" or Ctrl+K opens it.
 */
export function AskBox({ placeholder, autoFocus = false, className, shortcut = true }: { placeholder?: string; autoFocus?: boolean; className?: string; shortcut?: boolean }) {
  const tr = useTr();
  const router = useRouter();
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [deb, setDeb] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState<FinderIndex | null>(null);
  const [quick, setQuick] = useState<QuickResults | null>(null);
  const [offline, setOffline] = useState(false);
  const [active, setActive] = useState(-1);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [wished, setWished] = useState("");
  const [recents, setRecents] = useState<string[]>([]);
  const [live, setLive] = useState<{ code: string; s: RuleStatus | null } | null>(null);
  const [voiceLang, setVoiceLang] = useState<"sw-TZ" | "en-US">("sw-TZ");
  const [listening, setListening] = useState(false);
  const [voiceOk, setVoiceOk] = useState(false);
  const seq = useRef(0);
  const asked = useRef<string | null>(null);
  const text = q.trim();

  useEffect(() => setVoiceOk(!!speechCtor()), []);

  const wake = () => {
    setOpen(true);
    setRecents(recent());
    loadIndex(setIndex);
  };

  // "/" or Ctrl+K (Cmd+K) opens the box; openAsk("…") from anywhere opens it with words typed.
  useEffect(() => {
    if (!shortcut) return;
    const me = Symbol("ask");
    if (!shortcutOwner) shortcutOwner = me;
    const onKey = (e: KeyboardEvent) => {
      if (shortcutOwner !== me) return;
      const inField = (e.target as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable='true']");
      if ((e.key === "/" && !inField) || (e.key.toLowerCase() === "k" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        input.current?.focus();
        wake();
      }
    };
    const onOpen = (e: Event) => {
      if (shortcutOwner !== me) return;
      const v = String((e as CustomEvent).detail ?? "");
      if (v) {
        setQ(v);
        setDeb(v.trim());
        setAnswer(null);
      }
      input.current?.focus();
      wake();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
      if (shortcutOwner === me) shortcutOwner = null;
    };
  }, [shortcut]);

  // Rank the screens and guides a moment after typing stops (in the browser).
  useEffect(() => {
    const t = setTimeout(() => setDeb(text), 140);
    return () => clearTimeout(t);
  }, [text]);
  const found: FinderResult | null = useMemo(() => (index && deb.length >= 2 ? rank(index, deb) : null), [index, deb]);

  // Records and figures come from the server.
  useEffect(() => {
    if (text.length < 2) {
      setQuick(null);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) return setOffline(true);
      try {
        const r = await quickSearch(text);
        if (mine === seq.current) {
          setQuick(r);
          setOffline(false);
        }
      } catch {
        if (mine === seq.current) setOffline(true);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [text]);

  // Is the best match (a licence or registration) in place for this company?
  const bestCode = found?.confident ? found.best?.e.code : undefined;
  useEffect(() => {
    if (!bestCode || offline || live?.code === bestCode) return;
    let stop = false;
    ruleStatus(bestCode)
      .then((r) => !stop && setLive({ code: bestCode, s: r }))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [bestCode, offline, live?.code]);

  const ask = async (question: string, ai: boolean) => {
    const qq = question.trim();
    if (qq.length < 2) return;
    if (offline) {
      setOpen(true);
      setFailed(true);
      return;
    }
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

  // Nothing in the app or the records answers a real question: the AI takes over by itself after a moment.
  const records = quick && quick.q === text ? quick.records : [];
  const stuck =
    !!quick &&
    quick.q === text &&
    quick.aiOn &&
    !quick.figures &&
    !!found &&
    !found.confident &&
    !found.missing &&
    records.length === 0 &&
    text.split(" ").length >= 3;
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

  const best = found?.confident && !found.missing ? found.best : undefined;
  const missing = found?.missing;
  const related: FinderHit[] = found ? found.others.filter((h) => h.e.id !== best?.e.id && h.e.to).slice(0, 6) : [];
  const items: Item[] = [
    ...(best?.e.to ? [{ href: best.e.to, title: best.e.title, sub: best.e.path.join(" → "), group: "" }] : []),
    ...related.map((h) => ({ href: h.e.to, title: h.e.title, sub: h.e.path.join(" → "), group: tr("Related") })),
    ...records.flatMap((g) => g.hits.map((h) => ({ ...h, group: g.title }))),
  ].slice(0, 16);
  const firstListItem = best?.e.to ? 1 : 0;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };
  const go = (href: string) => {
    if (!href) return;
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
      else if (best?.e.to && !isQuestion(text) && !quick?.figures) go(best.e.to);
      else ask(text, true);
    }
  };

  const wish = async () => {
    const r = await sendWish(text).catch(() => ({ ok: false }));
    if (r.ok) setWished(text);
  };

  const listen = () => {
    const Ctor = speechCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = voiceLang;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript ?? "";
      if (said) setQuestion(said);
    };
    rec.onend = () => setListening(false);
    rec.onerror = (e) => {
      setListening(false);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") setVoiceOk(false);
    };
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
    }
  };

  const nothing = !!found && !best && !missing && records.length === 0 && !(quick?.figures && quick.q === text);
  const showAnswer = !!asking || !!answer || failed;
  const showAlt = (e: FinderEntry) => !!e.alt && e.alt !== e.title && found?.lang !== "en";
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
          onFocus={wake}
          onKeyDown={onKey}
          placeholder={placeholder ?? tr("Search or ask anything… / Uliza chochote")}
          aria-label={tr("Search or ask")}
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          aria-autocomplete="list"
          role="combobox"
          aria-activedescendant={active >= 0 ? `${id}-i${active}` : undefined}
        />
        {voiceOk && (
          <>
            <button type="button" className={`btn btn-small ${s.voice}${listening ? ` ${s.on}` : ""}`} onClick={listen} aria-label={tr("Search by voice")} title={tr("Search by voice")}>
              {listening ? (
                "…"
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              )}
            </button>
            <button type="button" className={`btn btn-small ${s.voice}`} onClick={() => setVoiceLang((v) => (v === "sw-TZ" ? "en-US" : "sw-TZ"))} title={tr("Voice language")}>
              {voiceLang === "sw-TZ" ? "SW" : "EN"}
            </button>
          </>
        )}
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
              <p className="muted small" style={{ margin: "8px 10px 0" }}>
                {tr("Tip: press / or Ctrl+K to search from any screen.")}
              </p>
            </div>
          )}

          {found && found.understood.length > 0 && text.length >= 2 && (
            <p className={`${s.under} small muted`}>
              <span className={`badge tone-${found.lang === "en" ? "info" : found.lang === "sw" ? "ok" : "warn"}`}>{tr(LANG_LABEL[found.lang])}</span> {tr("Understood")}:{" "}
              {found.understood.slice(0, 6).join(" · ")}
            </p>
          )}
          {offline && text.length >= 2 && <p className="small muted" style={{ margin: "4px 10px" }}>{tr("You are offline: showing screens and guides only. Records and the AI answer when you are back online.")}</p>}

          {showAnswer && (
            <div className={s.answerWrap} aria-live="polite">
              {asking && !answer ? (
                <p className="as-typing" aria-label={tr("Thinking…")}>
                  <span />
                  <span />
                  <span />
                </p>
              ) : failed ? (
                <p className="muted small">{offline ? tr("The AI answers when you are online.") : tr("Something went wrong. Please try again.")}</p>
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
              {missing && (
                <div className={`${s.card} ${s.miss}`}>
                  <p className={s.kind}>{tr("This isn't in the app yet")}</p>
                  <h3>{missing.e.title}</h3>
                  {missing.e.why && <p className="small">{missing.e.why}</p>}
                  <p className={s.group}>{tr("What you can do instead")}</p>
                  <ol className={s.steps}>
                    {(missing.e.instead ?? []).map((x, k) => (
                      <li key={k}>
                        {x.to ? (
                          <Link
                            href={x.to}
                            onClick={() => {
                              remember(text);
                              close();
                            }}
                          >
                            {x.text} ›
                          </Link>
                        ) : (
                          x.text
                        )}
                      </li>
                    ))}
                  </ol>
                  {quick?.canWish && (
                    <button type="button" className="btn btn-small" onClick={wish} disabled={wished === text}>
                      {wished === text ? tr("Sent to the Suggestion Box") : tr("Ask for this in the app")}
                    </button>
                  )}
                </div>
              )}

              {best && !showAnswer && (
                <div className={`${s.card}${active === 0 && best.e.to ? ` ${s.active}` : ""}`} id={best.e.to ? `${id}-i0` : undefined}>
                  <p className={s.kind}>{tr("Best answer")}</p>
                  <h3>{best.e.title}</h3>
                  {showAlt(best.e) && <p className="small muted">{best.e.alt}</p>}
                  {best.e.code && live?.code === best.e.code && live.s && (
                    <p className="small">
                      <span className={`badge tone-${live.s.tone}`}>{live.s.label}</span>
                    </p>
                  )}
                  {best.e.path.length > 0 && <p className={`${s.path} small muted`}>{best.e.path.join(" › ")}</p>}
                  {best.e.steps.length > 0 && (
                    <ol className={s.steps}>
                      {best.e.steps.slice(0, 6).map((x, k) => (
                        <li key={k}>{x}</li>
                      ))}
                    </ol>
                  )}
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    {best.e.to && (
                      <button type="button" className="btn btn-small btn-primary" onClick={() => go(best.e.to)}>
                        {tr("Take me there")} ›
                      </button>
                    )}
                    {best.e.page && (
                      <button type="button" className="btn btn-small" onClick={() => go(best.e.page!)}>
                        {tr("Open the guide")}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {!answer && !asking && (
                <button type="button" className={s.askRow} onClick={() => ask(text, true)}>
                  <Icon name="help" size={18} />
                  <span>
                    {tr("Ask AI")}: <strong>“{text}”</strong>
                  </span>
                  <span className="muted small">{best && !isQuestion(text) ? "" : "Enter"}</span>
                </button>
              )}

              {items.length > firstListItem && (
                <ul className={s.list} role="listbox">
                  {items.map((it, i) => {
                    if (i < firstListItem) return null;
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
              {nothing && !showAnswer && (
                <div className={s.wish}>
                  <span className="muted small">
                    {quick?.aiOn ? tr("I couldn't find that in the app. The AI answers in a moment, or press Enter.") : tr("I couldn't find that in the app. Try other words.")}
                  </span>
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
