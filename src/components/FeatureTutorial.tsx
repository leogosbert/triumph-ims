"use client";

import { useEffect, useRef, useState } from "react";
import { useTr } from "@/lib/tr-client";
import { startTour } from "@/components/tour/store";

export type TutorialData = {
  /** Feature (or level) name. */
  title: string;
  description?: string | null;
  /** Who uses it, e.g. "Owner, sales staff". */
  audience?: string | null;
  benefits?: string | null;
  steps: { title: string; body: string }[];
  /** Screen of the feature: adds "Show me where", a one-step guided tour pointing at it. */
  route?: string | null;
};

/**
 * "Watch tutorial": a button that opens a short step-by-step guide in a sheet
 * (slides up on phones, a centred card on larger screens). Esc, the × button or a tap
 * outside closes it; focus moves into the guide and returns to the button afterwards.
 */
export function FeatureTutorial({
  data,
  label = "Watch tutorial",
  className = "btn btn-small",
}: {
  data: TutorialData;
  label?: string;
  className?: string;
}) {
  const tr = useTr();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useRef<string>(`tut-${Math.random().toString(36).slice(2, 9)}`);

  // Page 0 introduces the feature; the rest are its tutorial steps.
  const pages = [{ title: "", body: "" }, ...data.steps];
  const last = pages.length - 1;

  function show() {
    setStep(0);
    setMounted(true);
  }
  function hide() {
    setOpen(false);
  }

  const where = data.route && data.route.startsWith("/") ? data.route : null;
  /** Close the guide, then let the tour open the feature's screen and point at its heading. */
  function showWhere() {
    if (!where) return;
    hide();
    window.setTimeout(
      () =>
        startTour(`where:${where}`, [
          {
            route: where,
            selector: [".page-head", "main.page h1"],
            title: data.title,
            body: data.description || "Here is where you will find it.",
            who: data.audience ?? undefined,
            why: data.benefits ?? undefined,
          },
        ]),
      400,
    );
  }

  // Mount first, then add the "open" class on the next frame so the sheet slides in.
  useEffect(() => {
    if (!mounted) return;
    const id = window.setTimeout(() => setOpen(true), 20);
    return () => window.clearTimeout(id);
  }, [mounted]);

  // After the closing animation, remove the sheet and give focus back to the button.
  useEffect(() => {
    if (open || !mounted) return;
    const id = window.setTimeout(() => {
      setMounted(false);
      trigger.current?.focus();
    }, 380);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // While open: Esc closes, Tab stays inside, the page behind does not scroll.
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
        return;
      }
      if (e.key === "ArrowRight") setStep((s) => Math.min(last, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
      if (e.key !== "Tab" || !panel.current) return;
      const items = Array.from(
        panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
      );
      if (items.length === 0) return;
      const first = items[0];
      const end = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault();
        end.focus();
      } else if (!e.shiftKey && document.activeElement === end) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const page = pages[step] ?? pages[0];

  return (
    <>
      <button ref={trigger} type="button" className={className} onClick={show} aria-haspopup="dialog">
        <span aria-hidden="true">▶</span> {tr(label)}
      </button>
      {mounted && (
        <div className={`tsheet${open ? " open" : ""}`}>
          <div className="tsheet-backdrop" onClick={hide} />
          <div
            ref={panel}
            className="tsheet-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId.current}
            tabIndex={-1}
          >
            <div className="tsheet-head">
              <span className="tsheet-kicker">{tr("Tutorial")}</span>
              <button type="button" className="msheet-x" onClick={hide} aria-label={tr("Close")}>
                ×
              </button>
            </div>
            <h2 id={titleId.current} className="tsheet-title">
              {tr(data.title)}
            </h2>

            <div className="tsheet-body" key={step} aria-live="polite">
              {step === 0 ? (
                <>
                  {data.description && <p>{tr(data.description)}</p>}
                  {data.audience && (
                    <p className="tsheet-meta">
                      <strong>{tr("Who uses it")}</strong>
                      <span>{tr(data.audience)}</span>
                    </p>
                  )}
                  {data.benefits && (
                    <p className="tsheet-meta">
                      <strong>{tr("How it helps")}</strong>
                      <span>{tr(data.benefits)}</span>
                    </p>
                  )}
                  {last > 0 ? (
                    <p className="muted small">
                      {tr("{n} short steps follow.").replace("{n}", String(last))}
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="tsheet-step">
                    {tr("Step {n} of {total}").replace("{n}", String(step)).replace("{total}", String(last))}
                  </span>
                  <h3>{tr(page.title)}</h3>
                  <p>{tr(page.body)}</p>
                </>
              )}
            </div>

            {pages.length > 1 && (
              <div className="tsheet-dots" role="group" aria-label={tr("Steps")}>
                {pages.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={i === 0 ? tr("Introduction") : tr("Step {n}").replace("{n}", String(i))}
                    aria-current={i === step ? "step" : undefined}
                    onClick={() => setStep(i)}
                  />
                ))}
              </div>
            )}

            {where && (
              <button type="button" className="btn btn-small btn-ghost tsheet-where" onClick={showWhere}>
                <span aria-hidden="true">◎</span> {tr("Show me where")}
              </button>
            )}
            <div className="tsheet-actions">
              <button type="button" className="btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
                {tr("Back")}
              </button>
              {step < last ? (
                <button type="button" className="btn btn-primary" onClick={() => setStep((s) => Math.min(last, s + 1))}>
                  {tr("Next")}
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={hide}>
                  {tr("Done")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
