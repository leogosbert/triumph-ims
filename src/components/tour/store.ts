import type { TourStep } from "@/lib/tours";

/**
 * Where the running tour lives between screens: sessionStorage (this tab only), plus a window
 * event so a tour can be started from any button. Storage may be blocked (private mode,
 * strict browsers): every access is wrapped so the app never breaks because of a tour.
 */

export const TOUR_KEY = "lemosp.tour";
export const TOUR_EVENT = "lemosp:tour";

export type TourState = {
  /** "small" | "medium" | "enterprise", or any id for a custom tour that carries its own steps. */
  id: string;
  index: number;
  /** Custom tours only (e.g. "Show me where" from a feature tutorial). */
  steps?: TourStep[];
  /** Built-in tours: true = every step, false/missing = the quick guide. */
  full?: boolean;
};

export function readTour(): TourState | null {
  try {
    const raw = window.sessionStorage.getItem(TOUR_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<TourState> | null;
    if (!v || typeof v.id !== "string") return null;
    return { id: v.id, index: Number(v.index) || 0, steps: Array.isArray(v.steps) ? v.steps : undefined, full: v.full === true };
  } catch {
    return null;
  }
}

export function writeTour(state: TourState | null) {
  try {
    if (state) window.sessionStorage.setItem(TOUR_KEY, JSON.stringify(state));
    else window.sessionStorage.removeItem(TOUR_KEY);
  } catch {
    /* storage blocked: the tour still runs on this screen */
  }
}

/** Start a tour now. Built-in tours: pass the level; custom tours: pass their steps. */
export function startTour(id: string, steps?: TourStep[]) {
  const state: TourState = { id, index: 0, steps };
  writeTour(state);
  try {
    window.dispatchEvent(new CustomEvent<TourState>(TOUR_EVENT, { detail: state }));
  } catch {
    /* very old browser: the host picks the tour up from storage on the next screen */
  }
}

/* ---------- Which scale guides this person has finished (this tab / app session) ---------- */

const SEEN_KEY = "lemosp.tour.seen";
let seenFallback: string[] = []; // when storage is blocked

/** Built-in guides finished in this session ("small" | "medium" | "enterprise"). */
export function readSeen(): string[] {
  try {
    const raw = window.sessionStorage.getItem(SEEN_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return seenFallback;
  }
}

function writeSeen(list: string[]) {
  seenFallback = list;
  try {
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(list));
  } catch {
    /* kept in memory for this page only */
  }
}

/** Remember that the guide for this scale was finished (not skipped). Returns the new list. */
export function markSeen(id: string): string[] {
  const list = readSeen();
  const next = list.includes(id) ? list : [...list, id];
  writeSeen(next);
  return next;
}

/** A new demo was started: forget the guides seen in an earlier demo. */
export function resetSeen() {
  writeSeen([]);
}
