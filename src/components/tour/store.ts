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
};

export function readTour(): TourState | null {
  try {
    const raw = window.sessionStorage.getItem(TOUR_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<TourState> | null;
    if (!v || typeof v.id !== "string") return null;
    return { id: v.id, index: Number(v.index) || 0, steps: Array.isArray(v.steps) ? v.steps : undefined };
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
