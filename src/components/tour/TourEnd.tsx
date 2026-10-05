"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { leaveDemoToChoose, switchDemoLevel } from "@/app/demo-actions";
import { LEVEL_ORDER, type Level } from "@/lib/levels";
import { isTourId, SCALE_NAME } from "@/lib/tours";
import { useTr } from "@/lib/tr-client";

/** Button text per scale on the end card. */
const SHOW_ME: Record<Level, string> = {
  small: "Show me Small",
  medium: "Show me Medium",
  enterprise: "Show me Large",
};

/**
 * Shown when someone FINISHES a scale's guide (never after "Skip").
 * - Demo: "Would you like to see the guide for another scale?" with one button per scale not yet
 *   seen. Choosing one rebuilds the demo at that scale (switchDemoLevel) and its guide starts by
 *   itself. After all three: "Choose the one that fits my business" or "Close".
 * - Real company: only "Replay the guide" or "Close" (a real company's level is never switched here).
 */
export function TourEndCard({
  finished,
  seen,
  demo,
  onClose,
  onReplay,
}: {
  /** The scale whose guide was just finished. */
  finished: string;
  /** Every scale guide finished in this session (including `finished`). */
  seen: string[];
  demo: boolean;
  onClose: () => void;
  onReplay: () => void;
}) {
  const tr = useTr();
  const [pending, start] = useTransition();
  const [preparing, setPreparing] = useState<Level | "choose" | null>(null);
  const wasPending = useRef(false);
  const first = useRef<HTMLButtonElement>(null);

  // A switch that failed (error notice on the page) ends the transition without a new guide: close.
  useEffect(() => {
    if (pending) wasPending.current = true;
    else if (wasPending.current) {
      wasPending.current = false;
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending]);

  useEffect(() => {
    try {
      first.current?.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }, []);

  // Esc closes (unless a new demo is being prepared).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !preparing) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preparing, onClose]);

  const name = isTourId(finished) ? tr(SCALE_NAME[finished]) : "";
  const unseen = LEVEL_ORDER.filter((l) => !seen.includes(l));
  const allSeen = demo && unseen.length === 0;

  function show(level: Level) {
    setPreparing(level);
    const form = new FormData();
    form.set("level", level);
    start(async () => {
      await switchDemoLevel(form);
    });
  }

  function choose() {
    setPreparing("choose");
    start(async () => {
      await leaveDemoToChoose();
    });
  }

  let body: React.ReactNode;
  if (preparing) {
    body = (
      <div className="tour-end-wait" role="status">
        <span className="tour-wait-dot" aria-hidden="true" />
        <span>
          {preparing === "choose"
            ? tr("Closing the demo…")
            : tr("Preparing the {scale} demo…").replace("{scale}", tr(SCALE_NAME[preparing]))}
        </span>
        {preparing !== "choose" && <small>{tr("This takes a few seconds. Its quick guide starts by itself.")}</small>}
      </div>
    );
  } else if (!demo) {
    body = (
      <>
        <h2 id="tour-end-title" className="tour-title">
          {name ? tr("You've finished the {scale} guide.").replace("{scale}", name) : tr("You've finished the guide.")}
        </h2>
        <p className="tour-body">{tr("You can open it again any time from Help.")}</p>
        <div className="tour-end-btns">
          <button ref={first} type="button" className="btn btn-primary" onClick={onClose}>
            {tr("Close")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onReplay}>
            {tr("Replay the guide")}
          </button>
        </div>
      </>
    );
  } else if (allSeen) {
    body = (
      <>
        <h2 id="tour-end-title" className="tour-title">
          {tr("You've seen all three scales")}
        </h2>
        <p className="tour-body">
          {tr("Small, Medium and Large (Enterprise) are one app. Start at the scale that fits you today and switch on more tools when you grow. Nothing you enter is ever lost.")}
        </p>
        <div className="tour-end-btns">
          <button ref={first} type="button" className="btn btn-primary" onClick={choose}>
            {tr("Choose the one that fits my business")}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {tr("Close")}
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h2 id="tour-end-title" className="tour-title">
          {tr("You've seen how LeMoSp works for a {scale} business.").replace("{scale}", name)}
        </h2>
        <p className="tour-body">{tr("Would you like to see the guide for another scale?")}</p>
        <div className="tour-end-btns">
          {unseen.map((l, i) => (
            <button key={l} ref={i === 0 ? first : undefined} type="button" className="btn btn-primary" onClick={() => show(l)}>
              {tr(SHOW_ME[l])}
            </button>
          ))}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {tr("No thanks")}
          </button>
        </div>
        <p className="tour-end-note">{tr("The demo switches to that scale with fresh sample data.")}</p>
      </>
    );
  }

  return (
    <div className="tour tour-end-wrap">
      <div className="tour-block" aria-hidden="true" onClick={preparing ? undefined : onClose} />
      <div className="tour-end" role="dialog" aria-modal="true" aria-labelledby="tour-end-title" aria-busy={Boolean(preparing)}>
        <span className="tour-end-ico" aria-hidden="true">
          ✓
        </span>
        {body}
      </div>
    </div>
  );
}

/** One quiet line after "Skip": where to find the guide again. Disappears by itself. */
export function TourToast({ text, onDone }: { text: string; onDone: () => void }) {
  const tr = useTr();
  useEffect(() => {
    const t = window.setTimeout(onDone, 6000);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <div className="tour-toast" role="status">
      <span>{text}</span>
      <button type="button" className="tour-toast-x" onClick={onDone} aria-label={tr("Close")}>
        ×
      </button>
    </div>
  );
}
