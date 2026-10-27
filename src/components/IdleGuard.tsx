"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { signOutIdle } from "@/app/actions";
import { IDLE_KEY, idleSecondsLeft, readNumber } from "@/lib/applock";
import { useTr } from "@/lib/tr-client";

const WARN_SECONDS = 60;

function share(at: number) {
  try {
    localStorage.setItem(IDLE_KEY, String(at));
  } catch {
    /* private mode: this tab only */
  }
}

/**
 * Company policy "sign out when idle" (Settings → Security): after N minutes without taps or typing
 * in any tab, shows a one-minute warning, then signs out. Activity in one tab keeps every tab signed
 * in (shared through this device's storage). Opening the app again after the phone closed it counts
 * the time it was closed, the same as a tab left open. Off when minutes = 0 and on the driver screen.
 */
export function IdleGuard({ minutes, lastSignIn }: { minutes: number; lastSignIn?: string | null }) {
  const tr = useTr();
  const pathname = usePathname();
  const [left, setLeft] = useState<number | null>(null);
  const last = useRef(Date.now());
  const form = useRef<HTMLFormElement>(null);
  const opened = useRef(false);
  const off = !minutes || pathname.startsWith("/driver");

  useEffect(() => {
    if (off) {
      opened.current = true;
      return;
    }
    const signedInAt = lastSignIn ? Date.parse(lastSignIn) || 0 : 0;
    let done = false;
    const remaining = () => idleSecondsLeft({ minutes, lastHere: last.current, lastShared: readNumber(IDLE_KEY), signedInAt, now: Date.now() });
    const signOut = () => {
      if (done) return;
      done = true;
      form.current?.requestSubmit();
    };

    // Opening the app after the idle time (the phone had closed it): signed out, the same as a tab
    // left open. Only when the app opens: later (e.g. leaving the driver screen) it is activity.
    if (!opened.current) {
      opened.current = true;
      last.current = 0;
      if (readNumber(IDLE_KEY) !== null && remaining() <= 0) {
        signOut();
        return;
      }
    }
    last.current = Date.now();
    share(last.current);

    const events = ["pointerdown", "keydown", "scroll", "touchstart", "wheel"] as const;
    let throttle = 0;
    const onAny = () => {
      const now = Date.now();
      last.current = now;
      // Other tabs learn about it at most every 5 seconds.
      if (now - throttle > 5000) {
        throttle = now;
        share(now);
      }
      setLeft(null);
    };
    events.forEach((e) => window.addEventListener(e, onAny, { passive: true }));
    const tick = setInterval(() => {
      const remain = remaining();
      if (remain <= 0) {
        clearInterval(tick);
        signOut();
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
  }, [minutes, off, lastSignIn]);

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
                last.current = Date.now();
                share(last.current);
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
