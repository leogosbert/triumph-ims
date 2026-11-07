/**
 * Shared helpers for list screens: sorting through `?sort=key&dir=asc|desc`, and links that keep
 * the rest of the page's search params. Pure functions, safe on the server and in the browser.
 */

export type Dir = "asc" | "desc";
type Params = Record<string, string | string[] | undefined>;

/**
 * One way to sort a list. `col` is the database column the page orders by; leave it out when the
 * page sorts the loaded rows itself (for example by a joined client name). `dir` is the direction
 * a first tap gives (amounts and dates usually start with the biggest or newest).
 */
export type SortOption = { key: string; label: string; col?: string; dir: Dir };

export type SortState = {
  key: string;
  dir: Dir;
  /** The chosen option. */
  opt: SortOption;
  /** True when the person picked it (the URL names it), false when it is the page's default. */
  explicit: boolean;
  ascending: boolean;
};

/** Reads `?sort=` and `?dir=` against the options a page offers; unknown values fall back to the default. */
export function readSort(sp: Params, options: readonly SortOption[], defaultKey?: string): SortState {
  const want = typeof sp.sort === "string" ? sp.sort : "";
  const found = options.find((o) => o.key === want);
  const opt = found ?? options.find((o) => o.key === defaultKey) ?? options[0];
  const dir: Dir = found && (sp.dir === "asc" || sp.dir === "desc") ? sp.dir : opt.dir;
  return { key: opt.key, dir, opt, explicit: Boolean(found), ascending: dir === "asc" };
}

/** Builds `path?…` from the current params, with some changed (a null value removes that param). */
export function listHref(path: string, sp: Params, set: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    // Notices are one-off messages from a save; they never travel with a sort or a filter.
    if (k === "msg" || k === "error") continue;
    if (typeof v === "string" && v !== "") p.set(k, v);
  }
  for (const [k, v] of Object.entries(set)) {
    if (v === null || v === undefined || v === "") p.delete(k);
    else p.set(k, v);
  }
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}

export type SortLink = { key: string; label: string; href: string; active: boolean; dir: Dir | null };

/** One link per option: tapping the active one flips its direction, any other starts at its own default. */
export function sortLinks(path: string, sp: Params, options: readonly SortOption[], state: SortState): SortLink[] {
  return options.map((o) => {
    const active = o.key === state.key;
    const next: Dir = active ? (state.dir === "asc" ? "desc" : "asc") : o.dir;
    return {
      key: o.key,
      label: o.label,
      href: listHref(path, sp, { sort: o.key, dir: next }),
      active,
      dir: active ? state.dir : null,
    };
  });
}

/** Sorts loaded rows by a value (text compares without case; empty values always go last). */
export function sortRows<T>(rows: readonly T[], get: (r: T) => string | number | null | undefined, dir: Dir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    const xe = x === null || x === undefined || x === "";
    const ye = y === null || y === undefined || y === "";
    if (xe || ye) return xe === ye ? 0 : xe ? 1 : -1;
    if (typeof x === "number" && typeof y === "number") return (x - y) * sign;
    return String(x).localeCompare(String(y), "en", { sensitivity: "base", numeric: true }) * sign;
  });
}

/** The chosen sort as params a search form keeps (nothing when it is the page's default). */
export function sortKeep(s: SortState): Record<string, string> | undefined {
  return s.explicit ? { sort: s.key, dir: s.dir } : undefined;
}

/** Today and the date 7 days on (YYYY-MM-DD), for "This week" filters. */
export function weekAhead(today: string): { from: string; to: string } {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7);
  return { from: today, to: d.toISOString().slice(0, 10) };
}
