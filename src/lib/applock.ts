/**
 * App lock and automatic sign-out: the rules (pure functions, tested in scripts/test-applock.ts)
 * and the small bits of browser storage they use. Everything here is kept on this device only.
 *
 *  - App lock (Your account): after you have been away from the app for a while, coming back asks
 *    for your password. "Away" means no tab or window of the app was on screen: every visible
 *    tab notes the time every few seconds (LOCK_SEEN_KEY), so switching between tabs, a quick
 *    look at WhatsApp or the phone closing the app and reopening it all follow the same rule.
 *  - Automatic sign-out (Settings → Security, set by management for everyone): after N minutes
 *    without taps or typing in any tab, the person is signed out.
 */
export const LOCK_PREF_KEY = "lemosp-lock-after";
/** Last time a tab of the app was on screen (ms). */
export const LOCK_SEEN_KEY = "lemosp-last-seen";
/** Set once the old "every time" default has been moved to the new default on this device. */
export const LOCK_MIGRATED_KEY = "lemosp-lock-v2";
/** Older versions: when the app was left (no longer written; removed on sign-in). */
const OLD_AWAY_KEY = "lemosp-away-since";
/** Last tap or key press in any tab (ms), for the automatic sign-out. */
export const IDLE_KEY = "lemosp-last-activity";

/** How often a visible tab notes that the app is on screen. */
export const SEEN_EVERY_MS = 5000;
/** Short trips (a file picker, a notification, a reload) never lock. */
export const LOCK_TOLERANCE_SECONDS = 8;
/** Ask again after 15 minutes away, unless the person chose otherwise on this device. */
export const DEFAULT_LOCK_SECONDS = 900;

/** Seconds away before the password is asked again. 0 = every time, -1 = never. */
export const LOCK_OPTIONS = [
  { v: 300, label: "After 5 minutes away" },
  { v: 900, label: "After 15 minutes away" },
  { v: 1800, label: "After 30 minutes away" },
  { v: 3600, label: "After 1 hour away" },
  { v: 14400, label: "After 4 hours away" },
  { v: 28800, label: "After 8 hours away" },
  { v: 0, label: "Every time I come back" },
  { v: -1, label: "Never (not recommended)" },
];

/** Short label of a lock setting, also for older values no longer in the list (e.g. 1 minute). */
export function lockLabel(seconds: number): string {
  const o = LOCK_OPTIONS.find((x) => x.v === seconds);
  if (o) return o.label;
  if (seconds < 3600) {
    const m = Math.max(1, Math.round(seconds / 60));
    return m === 1 ? "After 1 minute away" : `After ${m} minutes away`;
  }
  const h = Math.round(seconds / 3600);
  return h === 1 ? "After 1 hour away" : `After ${h} hours away`;
}

/**
 * The lock setting from what this device stored.
 *  - nothing stored: the default (15 minutes);
 *  - "0" ("every time", the old default) stored before this version: moved to 15 minutes, once;
 *  - any other choice: kept.
 * `store`: a value to write back; `markMigrated`: note that the one-time move has been done.
 */
export function resolveLockPref(stored: string | null, migrated: boolean): { seconds: number; store?: string; markMigrated: boolean } {
  if (stored === null || stored.trim() === "") return { seconds: DEFAULT_LOCK_SECONDS, markMigrated: !migrated };
  const n = Number(stored);
  if (!Number.isFinite(n) || (n < 0 && n !== -1)) return { seconds: DEFAULT_LOCK_SECONDS, markMigrated: !migrated };
  if (n === 0 && !migrated) return { seconds: DEFAULT_LOCK_SECONDS, store: String(DEFAULT_LOCK_SECONDS), markMigrated: true };
  return { seconds: n, markMigrated: !migrated };
}

/**
 * Should the app ask for the password now?
 *  pref:       seconds away allowed (0 every time, -1 never)
 *  lastSeen:   when a tab of the app was last on screen (ms; 0 or null: unknown)
 *  signedInAt: when this person last signed in or unlocked (ms; 0: unknown)
 */
export function shouldLock({ pref, lastSeen, signedInAt, now }: { pref: number; lastSeen: number | null; signedInAt: number; now: number }): boolean {
  if (pref < 0) return false;
  if (!lastSeen || lastSeen <= 0) return false; // nothing noted yet: first open after signing in
  if (signedInAt && lastSeen < signedInAt) return false; // signed in since
  const gone = (now - lastSeen) / 1000;
  return gone >= Math.max(pref, LOCK_TOLERANCE_SECONDS);
}

/**
 * Seconds left before the automatic sign-out. The newest activity wins: this tab's or any other
 * tab's (shared). Activity from before the latest sign-in does not count against the person.
 */
export function idleSecondsLeft({ minutes, lastHere, lastShared, signedInAt, now }: { minutes: number; lastHere: number; lastShared: number | null; signedInAt: number; now: number }): number {
  const shared = lastShared && (!signedInAt || lastShared >= signedInAt) ? lastShared : 0;
  const last = Math.max(lastHere, shared);
  return minutes * 60 - (now - last) / 1000;
}

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: nothing kept */
  }
}

/** This device's lock setting (and the one-time move from the old default). */
export function readLockPref(): number {
  const r = resolveLockPref(get(LOCK_PREF_KEY), get(LOCK_MIGRATED_KEY) === "1");
  if (r.store !== undefined) set(LOCK_PREF_KEY, r.store);
  if (r.markMigrated) set(LOCK_MIGRATED_KEY, "1");
  return r.seconds;
}

export function saveLockPref(seconds: number): boolean {
  try {
    localStorage.setItem(LOCK_PREF_KEY, String(seconds));
    localStorage.setItem(LOCK_MIGRATED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function readNumber(key: string): number | null {
  const n = Number(get(key));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function noteSeen(at = Date.now()) {
  set(LOCK_SEEN_KEY, String(at));
}

/** Called after a fresh sign-in so the app neither locks nor signs out straight away. */
export function clearAway() {
  try {
    localStorage.removeItem(LOCK_SEEN_KEY);
    localStorage.removeItem(OLD_AWAY_KEY);
    localStorage.removeItem(IDLE_KEY);
  } catch {
    /* ignore */
  }
}
