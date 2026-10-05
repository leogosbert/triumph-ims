"use client";

import { useFormStatus } from "react-dom";
import { LEVEL_ORDER, type Level } from "@/lib/levels";
import { SCALE_FOR, SCALE_NAME } from "@/lib/tours";
import { useTr } from "@/lib/tr-client";

type Action = (form: FormData) => void | Promise<void>;

/** The tiny size picture on each card: one, two or three bars. */
const BARS: Record<Level, number> = { small: 1, medium: 2, enterprise: 3 };

function ScaleButton({ level }: { level: Level }) {
  const tr = useTr();
  const { pending } = useFormStatus();
  const name = tr(SCALE_NAME[level]);
  return (
    <button type="submit" className="demo-level scale-card" disabled={pending} aria-busy={pending}>
      <span className="scale-bars" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <i key={n} className={n <= BARS[level] ? "on" : undefined} />
        ))}
      </span>
      <span className="scale-txt">
        <strong>{pending ? tr("Preparing the {scale} demo…").replace("{scale}", name) : name}</strong>
        <span>{tr(SCALE_FOR[level])}</span>
      </span>
      <span className="scale-go" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

/**
 * The three demo scales as cards: Small, Medium, Large (Enterprise), one line each on who it is
 * for. Starting one opens that demo and its quick guide starts by itself (see startDemo).
 * `tone="dark"` on the sign-in page, `"light"` inside the app (onboarding).
 */
export function DemoScalePicker({ action, tone = "dark" }: { action: Action; tone?: "dark" | "light" }) {
  const tr = useTr();
  return (
    <div className={`demo-levels scale-pick ${tone}`}>
      {LEVEL_ORDER.map((level) => (
        <form key={level} action={action}>
          <input type="hidden" name="level" value={level} />
          <ScaleButton level={level} />
        </form>
      ))}
      <p className="scale-hint">{tr("Each demo opens with a quick guide to how the app works at that scale.")}</p>
    </div>
  );
}
