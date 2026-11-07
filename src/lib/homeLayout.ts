/**
 * Each person's home layout (which figures and sections show, and in what order), kept per device in
 * localStorage, keyed by company and user. Role rules decide what is offered at all; this only orders
 * and hides what the person may already see. Nothing here is required: without storage the home screen
 * shows today's default layout.
 */
export type HomeLayout = {
  tiles: string[];
  hiddenTiles: string[];
  sections: string[];
  hiddenSections: string[];
};

export const EMPTY_LAYOUT: HomeLayout = { tiles: [], hiddenTiles: [], sections: [], hiddenSections: [] };

export function layoutKey(companyId: string, userId: string) {
  return `lemosp.home.v1:${companyId}:${userId}`;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : []);

export function parseLayout(raw: string | null): HomeLayout {
  if (!raw) return EMPTY_LAYOUT;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    return { tiles: strings(v.tiles), hiddenTiles: strings(v.hiddenTiles), sections: strings(v.sections), hiddenSections: strings(v.hiddenSections) };
  } catch {
    return EMPTY_LAYOUT;
  }
}

/**
 * The saved order applied to what is available now: ids no longer offered are dropped, and ids the
 * person has never placed (a new tile, a role just added) go in at their default position.
 */
export function mergeOrder(saved: string[], available: string[]): string[] {
  const out = saved.filter((id, i) => available.includes(id) && saved.indexOf(id) === i);
  available.forEach((id, i) => {
    if (out.includes(id)) return;
    // After the nearest earlier default that is already placed; otherwise at the front.
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.indexOf(available[j]);
      if (k !== -1) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, id);
  });
  return out;
}

/** Moves one id up (-1) or down (+1) in a list. */
export function move(list: string[], id: string, dir: -1 | 1): string[] {
  const i = list.indexOf(id);
  const j = i + dir;
  if (i === -1 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
