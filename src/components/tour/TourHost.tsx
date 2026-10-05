"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Level } from "@/lib/levels";
import type { Role } from "@/lib/roles";
import { isTourId, tourSteps, type TourStep } from "@/lib/tours";
import { useTr } from "@/lib/tr-client";
import { markSeen, readTour, resetSeen, TOUR_EVENT, writeTour, type TourState } from "./store";
import { TourEndCard, TourToast } from "./TourEnd";

type Rect = { top: number; left: number; width: number; height: number };
type Pos = { top?: number; left?: number; dock?: "top" | "bottom" };
type Active = { id: string; steps: TourStep[]; index: number; custom: boolean; full: boolean };
type End = { id: string; seen: string[] };

const PHONE = 640;

function reducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** First element on screen (non-zero size, not hidden) for the selector alternatives, in order. */
function findTarget(selector: TourStep["selector"]): Element | null {
  const list = selector ? (Array.isArray(selector) ? selector : [selector]) : [];
  for (const sel of list) {
    let found: Element[] = [];
    try {
      found = Array.from(document.querySelectorAll(sel));
    } catch {
      continue; // a selector this browser does not understand (e.g. :has on old phones)
    }
    for (const el of found) {
      if (el.closest(".tour")) continue;
      const b = el.getBoundingClientRect();
      if (b.width <= 0 || b.height <= 0) continue;
      try {
        if (window.getComputedStyle(el).visibility === "hidden") continue;
      } catch {
        /* ignore */
      }
      return el;
    }
  }
  return null;
}

/** Bring the element into view: near the top on phones (the card docks at the bottom), centred elsewhere. */
function scrollToTarget(el: Element) {
  try {
    if (el.closest(".bottomnav, .sidenav, .topbar")) return; // fixed or sticky: always visible
    const behavior: ScrollBehavior = reducedMotion() ? "auto" : "smooth";
    const vh = window.innerHeight;
    const b = el.getBoundingClientRect();
    const head = 76; // sticky top bar
    let y: number;
    if (window.innerWidth < PHONE) {
      if (b.top >= head && b.top <= vh * 0.4) return;
      y = b.top + window.scrollY - head;
    } else {
      if (b.top >= head && b.bottom <= vh - 24) return;
      y = b.height < vh * 0.55 ? b.top + window.scrollY - (vh - b.height) / 2 : b.top + window.scrollY - head;
    }
    window.scrollTo({ top: Math.max(0, y), behavior });
  } catch {
    /* ignore */
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The guided-tour engine, mounted once in the app layout. Reads the running tour from
 * sessionStorage, `?tour=<level>` or the "lemosp:tour" event; on each screen it waits for the
 * step's element, scrolls to it, dims the rest of the screen around a spotlight and shows a card
 * (title, text, who uses it, why it helps, Back / Next / Skip). Next opens the next screen when
 * needed. A missing element gives a centred card. Esc ends, arrow keys move.
 * Everything is wrapped so a tour can never block the app.
 *
 * Built-in (per-level) tours are a quick guide: an intro card, the key screens and a summary.
 * The intro offers the full tour (steps marked optional). Finishing one shows the end card
 * (in a demo: "see the guide for another scale?"); skipping shows one quiet line instead.
 */
export function TourHost({
  off,
  role,
  level,
  company,
  demo = false,
}: {
  off: string[];
  role: Role;
  level: Level;
  company: string;
  /** A demo company: the end card offers the other scales. */
  demo?: boolean;
}) {
  const tr = useTr();
  const router = useRouter();
  const pathname = usePathname();
  const [tour, setTour] = useState<Active | null>(null);
  const [phase, setPhase] = useState<"seek" | "show">("seek");
  const [rect, setRect] = useState<Rect | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [end, setEnd] = useState<End | null>(null);
  const [toast, setToast] = useState(false);
  const target = useRef<Element>(null);
  const pushed = useRef<number>(null);
  const arrived = useRef<number>(null);
  const card = useRef<HTMLDivElement>(null);
  const nextBtn = useRef<HTMLButtonElement>(null);
  const frame = useRef<number>(null);
  const offKey = off.join(",");

  function stop() {
    writeTour(null);
    target.current = null;
    setTour(null);
    setRect(null);
    setPos(null);
  }

  /** The person ended the tour early (×, "Skip tour", Esc). */
  function skip() {
    const wasBuiltIn = tour ? !tour.custom : false;
    stop();
    if (demo && wasBuiltIn) setToast(true);
  }

  /** "Finish" on the last step. */
  function finish() {
    const t = tour;
    stop();
    if (!t || t.custom || !isTourId(t.id)) return;
    setEnd({ id: t.id, seen: markSeen(t.id) });
  }

  const closeEnd = useCallback(() => setEnd(null), []);
  const closeToast = useCallback(() => setToast(false), []);

  function begin(state: TourState) {
    try {
      setEnd(null);
      setToast(false);
      const custom = Boolean(state.steps && state.steps.length > 0);
      const full = !custom && state.full === true;
      const steps = custom ? (state.steps as TourStep[]) : isTourId(state.id) ? tourSteps(state.id, { off, role }, full) : [];
      if (steps.length === 0) {
        stop();
        return;
      }
      const index = clamp(Math.floor(state.index) || 0, 0, steps.length - 1);
      writeTour({ id: state.id, index, steps: custom ? steps : undefined, full });
      pushed.current = null;
      arrived.current = null;
      target.current = null;
      setRect(null);
      setPos(null);
      setPhase("seek");
      setTour({ id: state.id, steps, index, custom, full });
    } catch {
      stop();
    }
  }

  function go(index: number) {
    if (!tour) return;
    if (index < 0) return;
    if (index >= tour.steps.length) {
      finish();
      return;
    }
    writeTour({ id: tour.id, index, steps: tour.custom ? tour.steps : undefined, full: tour.full });
    target.current = null;
    setPos(null);
    setPhase("seek");
    setTour({ ...tour, index });
  }

  // Start from "?tour=<level>" (after a demo starts) or carry on a tour from an earlier screen.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("tour");
      if (q) {
        // A brand-new demo: forget the scale guides seen in an earlier one.
        if (params.get("tourfresh")) resetSeen();
        params.delete("tour");
        params.delete("tourfresh");
        const rest = params.toString();
        window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
        const id = q === "auto" ? level : q;
        if (isTourId(id)) {
          // Give the first screen a moment to settle (and the splash to lift) before dimming it.
          const t = window.setTimeout(() => begin({ id, index: 0 }), 450);
          return () => window.clearTimeout(t);
        }
      }
      if (!tour) {
        const saved = readTour();
        if (saved) begin(saved);
      }
    } catch {
      /* no tour */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, company, level]);

  // Start from any button ("Take the tour", "Show me where" …).
  useEffect(() => {
    const onStart = (e: Event) => {
      const detail = (e as CustomEvent<TourState>).detail;
      if (detail && typeof detail.id === "string") begin(detail);
    };
    window.addEventListener(TOUR_EVENT, onStart);
    return () => window.removeEventListener(TOUR_EVENT, onStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offKey, role]);

  // Drive the current step: open its screen, then wait for its element.
  useEffect(() => {
    if (!tour) return;
    const step = tour.steps[tour.index];
    if (!step) return;
    // Intro and summary cards appear on whatever screen is open.
    const want = step.kind ? pathname : step.route.split(/[?#]/)[0] || "/";
    if (want !== pathname) {
      // We were on this step's screen and the person went elsewhere (browser back …): end the tour.
      if (arrived.current === tour.index) {
        stop();
        return;
      }
      setRect(null);
      setPhase("seek");
      target.current = null;
      if (pushed.current !== tour.index) {
        pushed.current = tour.index;
        try {
          router.push(step.route);
        } catch {
          /* fall through to the timer */
        }
      }
      // The screen did not open (no access, offline …): show the card here instead of waiting forever.
      const t = window.setTimeout(() => setPhase("show"), 6000);
      return () => window.clearTimeout(t);
    }
    pushed.current = tour.index;
    arrived.current = tour.index;
    let cancelled = false;
    let tries = 0;
    let waited = 0;
    let timer = 0;
    const reveal = () => {
      if (!cancelled) setPhase("show");
    };
    const find = () => {
      if (cancelled) return;
      if (!step.selector) {
        target.current = null;
        reveal();
        return;
      }
      const el = findTarget(step.selector);
      if (el) {
        target.current = el;
        scrollToTarget(el);
        timer = window.setTimeout(reveal, reducedMotion() ? 40 : 420);
        return;
      }
      // Still loading (skeleton on screen): keep waiting a little longer.
      const loading = Boolean(document.querySelector("main.page .skeleton"));
      waited += 1;
      if (!loading) tries += 1;
      if (tries > 16 || waited > 70) {
        target.current = null;
        reveal();
        return;
      }
      timer = window.setTimeout(find, 140);
    };
    setPhase("seek");
    timer = window.setTimeout(find, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour?.id, tour?.index, tour?.steps, pathname]);

  // Measure the spotlight and place the card; again on scroll, resize and layout changes.
  function layout() {
    try {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let r: Rect | null = null;
      let el = target.current;
      if (el && !el.isConnected && tour) {
        el = findTarget(tour.steps[tour.index]?.selector);
        target.current = el;
      }
      if (el) {
        const b = el.getBoundingClientRect();
        if (b.width > 0 && b.height > 0) {
          const pad = 6;
          const top = Math.max(4, b.top - pad);
          const left = Math.max(4, b.left - pad);
          const bottom = Math.min(vh - 4, b.bottom + pad);
          const right = Math.min(vw - 4, b.right + pad);
          if (bottom > top && right > left) r = { top, left, width: right - left, height: bottom - top };
        }
      }
      setRect(r);
      if (vw < PHONE) {
        const inBar = Boolean(el && el.closest(".bottomnav"));
        setPos({ dock: r && !inBar && r.top + r.height / 2 > vh * 0.55 ? "top" : "bottom" });
        return;
      }
      const c = card.current;
      const w = c?.offsetWidth || 380;
      const h = c?.offsetHeight || 280;
      const gap = 14;
      let top: number;
      let left: number;
      if (!r) {
        top = (vh - h) / 2;
        left = (vw - w) / 2;
      } else {
        left = r.left + r.width / 2 - w / 2;
        if (r.top + r.height + gap + h <= vh - 8) top = r.top + r.height + gap;
        else if (r.top - gap - h >= 8) top = r.top - gap - h;
        else if (r.left + r.width + gap + w <= vw - 8) {
          left = r.left + r.width + gap;
          top = r.top + r.height / 2 - h / 2;
        } else if (r.left - gap - w >= 8) {
          left = r.left - gap - w;
          top = r.top + r.height / 2 - h / 2;
        } else top = vh - h - 12;
      }
      setPos({ top: clamp(top, 8, Math.max(8, vh - h - 8)), left: clamp(left, 8, Math.max(8, vw - w - 8)) });
    } catch {
      setRect(null);
      setPos({ dock: "bottom" });
    }
  }

  useEffect(() => {
    if (!tour || phase !== "show") return;
    layout();
    const schedule = () => {
      if (frame.current) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        layout();
      });
    };
    window.addEventListener("scroll", schedule, { passive: true, capture: true });
    window.addEventListener("resize", schedule);
    // Pages settle after loading (charts, counters): follow the element for a while.
    const poll = window.setInterval(schedule, 700);
    return () => {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      window.clearInterval(poll);
      if (frame.current) window.cancelAnimationFrame(frame.current);
      frame.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, tour?.index, tour?.id]);

  // Keyboard: Esc ends, arrows move. Focus goes to Next so Enter/Space continue.
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        skip();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(tour.index + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(tour.index - 1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour]);

  const ready = phase === "show" && pos !== null;
  useEffect(() => {
    if (!ready) return;
    try {
      nextBtn.current?.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }, [ready, tour?.index]);

  if (!tour) {
    if (end)
      return (
        <TourEndCard
          finished={end.id}
          seen={end.seen}
          demo={demo}
          onClose={closeEnd}
          onReplay={() => {
            const id = end.id;
            setEnd(null);
            begin({ id, index: 0 });
          }}
        />
      );
    if (toast) return <TourToast text={tr("You can restart the guide any time from the demo bar.")} onDone={closeToast} />;
    return null;
  }
  const step = tour.steps[tour.index];
  if (!step) return null;
  const total = tour.steps.length;
  const last = tour.index === total - 1;
  const spot = ready && rect;
  const cardStyle = ready && pos?.top !== undefined ? ({ top: `${pos.top}px`, left: `${pos.left}px` } as React.CSSProperties) : undefined;
  const cardClass = `tour-card${ready ? " ready" : ""}${pos?.dock === "top" ? " dock-top" : ""}${pos?.top !== undefined ? " placed" : ""}`;
  const countText = tr("Step {n} of {total}").replace("{n}", String(tour.index + 1)).replace("{total}", String(total));
  // On the intro card of a quick guide: offer the full tour when it has more steps.
  let fullCount = 0;
  if (step.kind === "intro" && !tour.custom && !tour.full && isTourId(tour.id)) {
    try {
      fullCount = tourSteps(tour.id, { off, role }, true).length;
    } catch {
      fullCount = 0;
    }
  }

  return (
    <div className={`tour${spot ? " has-spot" : ""}`}>
      <div className="tour-block" aria-hidden="true" />
      <div
        className={`tour-spot${spot ? "" : " off"}`}
        aria-hidden="true"
        style={
          rect
            ? ({ top: `${rect.top}px`, left: `${rect.left}px`, width: `${rect.width}px`, height: `${rect.height}px` } as React.CSSProperties)
            : undefined
        }
      />
      {!ready && (
        <div className="tour-wait" role="status">
          <span className="tour-wait-dot" aria-hidden="true" />
          {tr("Opening…")}
        </div>
      )}
      <div
        key={`${tour.id}-${tour.index}`}
        ref={card}
        className={cardClass}
        style={cardStyle}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        aria-hidden={ready ? undefined : true}
      >
        <div className="tour-head">
          <span className="tour-kicker">{tour.custom ? tr("Show me where") : tour.full ? tr("Guided tour") : tr("Quick guide")}</span>
          {total > 1 && <span className="tour-count">{countText}</span>}
          <button type="button" className="tour-x" onClick={skip} aria-label={tr("Skip tour")}>
            ×
          </button>
        </div>
        {total > 1 && (
          <div className="tour-progress" aria-hidden="true">
            <span style={{ width: `${((tour.index + 1) / total) * 100}%` } as React.CSSProperties} />
          </div>
        )}
        <h2 id="tour-title" className="tour-title">
          {tr(step.title)}
        </h2>
        <p id="tour-body" className="tour-body">
          {tr(step.body)}
        </p>
        {(step.who || step.why) && (
          <div className="tour-meta">
            {step.who && (
              <p>
                <strong>{tr("Who uses it")}</strong>
                <span>{tr(step.who)}</span>
              </p>
            )}
            {step.why && (
              <p>
                <strong>{tr("Why it helps")}</strong>
                <span>{tr(step.why)}</span>
              </p>
            )}
          </div>
        )}
        {fullCount > total && (
          <p className="tour-full">
            {tr("This quick guide has {n} steps.").replace("{n}", String(total))}{" "}
            <button type="button" className="tour-full-btn" onClick={() => begin({ id: tour.id, index: 1, full: true })}>
              {tr("Show all {n} steps instead").replace("{n}", String(fullCount))}
            </button>
          </p>
        )}
        <div className="tour-actions">
          {total > 1 ? (
            <button type="button" className="btn btn-small btn-ghost tour-skip" onClick={skip}>
              {tr("Skip tour")}
            </button>
          ) : (
            <span />
          )}
          {total > 1 && (
            <button type="button" className="btn btn-small" onClick={() => go(tour.index - 1)} disabled={tour.index === 0}>
              {tr("Back")}
            </button>
          )}
          <button ref={nextBtn} type="button" className="btn btn-small btn-primary" onClick={() => go(tour.index + 1)}>
            {last ? (total > 1 ? tr("Finish") : tr("Got it")) : tr("Next")}
          </button>
        </div>
      </div>
    </div>
  );
}
