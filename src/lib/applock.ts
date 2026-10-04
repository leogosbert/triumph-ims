/** App lock settings, kept on this device only. */
export const LOCK_PREF_KEY = "lemosp-lock-after";
export const LOCK_AWAY_KEY = "lemosp-away-since";
/** Seconds away before the password is asked again. -1 = never. Default: every time you come back. */
export const LOCK_OPTIONS = [
  { v: 0, label: "Every time I come back" },
  { v: 60, label: "After 1 minute away" },
  { v: 300, label: "After 5 minutes away" },
  { v: 900, label: "After 15 minutes away" },
  { v: -1, label: "Never (not recommended)" },
];
/** Short trips (a file picker, a notification) never lock. */
export const LOCK_TOLERANCE_SECONDS = 8;

export function readLockPref(): number {
  try {
    const v = localStorage.getItem(LOCK_PREF_KEY);
    return v === null ? 0 : Number(v);
  } catch {
    return 0;
  }
}

/** Called after a fresh sign-in so the app does not immediately lock. */
export function clearAway() {
  try {
    localStorage.removeItem(LOCK_AWAY_KEY);
  } catch {
    /* ignore */
  }
}
