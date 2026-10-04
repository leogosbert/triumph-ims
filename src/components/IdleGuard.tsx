"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOutIdle } from "@/app/actions";
import { useTr } from "@/lib/tr-client";

const KEY = "lemosp-last-activity";
const WARN_SECONDS = 60;

function now() {
  return Date.now();
}
function readLast(): number {
  try {
    return Number(localStorage.getItem(KEY)) || now();
  } catch {
    return now();
  }
}

/**
 * Company policy "sign out when idle": after N minutes without taps or typing (in any tab),
 * shows a one-minute warning, then signs out. Off when minutes = 0 and on the driver screen.
 */
export function IdleGuard({ minutes }: { minutes: number }) {
  const tr = useTr();
  const pathname = usePathname();
  const [left, setLeft] = useState<number | null>(null);
  const last = useRef(now());
  const form = useRef<HTMLFormElement>(null);
  const off = !minutes || pathname.startsWith("/driver");

  useEffect(() => {
    if (off) return;
    const mark = () => {
      last.current = now();
      try {
        localStorage.setItem(KEY, String(last.current));
      } catch {
        /* private mode: this tab only */
      }
      setLeft(null);
    };
    mark();
    const events = ["pointerdown", "keydown", "scroll", "touchstart", "wheel"] as const;
    let throttle = 0;
    const onAny = () => {
      if (now() - throttle > 5000) {
        throttle = now();
        mark();
      }
    };
    events.forEach((e) => window.addEventListener(e, onAny, { passive: true }));
    const tick = setInterval(() => {
      const idle = (now() - Math.max(last.current, readLast())) / 1000;
      const remain = minutes * 60 - idle;
      if (remain <= 0) {
        clearInterval(tick);
        form.current?.requestSubmit();
      } else if (remain <= WARN_SECONDS) {
        setLeft(Math.ceil(remain));
      } else {
        setLeft(null);
      }
    }, 1000);
    return () => {
      clearInterval(tick);
      events.forEach((e) => window.removeEventListener(e, onAny));
    };
  }, [minutes, off]);

  return (
    <>
      <form ref={form} action={signOutIdle} hidden>
        <input type="hidden" name="minutes" value={minutes} />
      </form>
      {left !== null && !off && (
        <div className="idle-warn" role="alertdialog" aria-live="assertive">
          <div className="idle-card">
            <strong>{tr("Are you still there?")}</strong>
            <p>
              {tr("For security you will be signed out in")} <b>{left}</b> {tr("seconds.")}
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => {
                last.current = now();
                try {
                  localStorage.setItem(KEY, String(last.current));
                } catch {
                  /* ignore */
                }
                setLeft(null);
              }}
            >
              {tr("Stay signed in")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
