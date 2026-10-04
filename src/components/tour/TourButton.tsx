"use client";

import { useEffect, useState } from "react";
import type { Level } from "@/lib/levels";
import { useTr } from "@/lib/tr-client";
import { startTour } from "./store";

/** A button that starts the guided tour for a business level (DemoBar, Help page …). */
export function TourButton({
  tour,
  label = "Take the tour",
  className = "btn btn-small",
}: {
  tour: Level;
  label?: string;
  className?: string;
}) {
  const tr = useTr();
  return (
    <button type="button" className={className} onClick={() => startTour(tour)}>
      {tr(label)}
    </button>
  );
}

const DISMISS_KEY = "lemosp.tourInvite.dismissed";

/**
 * Home page card for managers of a company that finished onboarding recently:
 * "Take a 2-minute tour". Dismissing (or starting) it is remembered on this device.
 */
export function TourInvite({ tour, company }: { tour: Level; company: string }) {
  const tr = useTr();
  const [show, setShow] = useState(false);
  const key = `${DISMISS_KEY}.${company}`;

  useEffect(() => {
    try {
      setShow(window.localStorage.getItem(key) !== "1");
    } catch {
      setShow(true);
    }
  }, [key]);

  function dismiss() {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* not remembered: it simply shows again next time */
    }
    setShow(false);
  }

  if (!show) return null;
  return (
    <section className="tour-invite" aria-labelledby="tour-invite-title">
      <span className="tour-invite-ico" aria-hidden="true">
        ▶
      </span>
      <div className="tour-invite-txt">
        <strong id="tour-invite-title">{tr("Take a 2-minute tour")}</strong>
        <span>{tr("See where everything is and how each screen helps your business.")}</span>
        <div className="tour-invite-actions">
          <button
            type="button"
            className="btn btn-small btn-primary"
            onClick={() => {
              dismiss();
              startTour(tour);
            }}
          >
            {tr("Start the tour")}
          </button>
          <button type="button" className="btn btn-small btn-ghost" onClick={dismiss}>
            {tr("Not now")}
          </button>
        </div>
      </div>
    </section>
  );
}
