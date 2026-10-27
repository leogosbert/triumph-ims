/**
 * Unit tests for staying signed in (no browser needed):
 *   npx tsx --test scripts/test-applock.ts
 * The app lock decision, the setting's default and one-time move, the automatic sign-out count
 * across tabs, and the role-set checks used for people with several roles.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_LOCK_SECONDS, idleSecondsLeft, LOCK_OPTIONS, lockLabel, resolveLockPref, shouldLock } from "../src/lib/applock";
import { can, hasRole, onlyRoles, rolesOf } from "../src/lib/roles";

const MIN = 60_000;
const now = Date.parse("2026-10-27T09:00:00Z");
const signedIn = now - 8 * 60 * MIN;

describe("app lock setting", () => {
  it("defaults to 15 minutes when nothing is stored", () => {
    assert.equal(DEFAULT_LOCK_SECONDS, 900);
    assert.deepEqual(resolveLockPref(null, false), { seconds: 900, markMigrated: true });
    assert.deepEqual(resolveLockPref(null, true), { seconds: 900, markMigrated: false });
    assert.equal(resolveLockPref("", false).seconds, 900);
    assert.equal(resolveLockPref("garbage", false).seconds, 900);
  });
  it("moves the old 'every time' (0) to 15 minutes once", () => {
    assert.deepEqual(resolveLockPref("0", false), { seconds: 900, store: "900", markMigrated: true });
    // Chosen again after the move: kept.
    assert.deepEqual(resolveLockPref("0", true), { seconds: 0, markMigrated: false });
  });
  it("keeps any other stored choice", () => {
    for (const v of ["300", "1800", "3600", "14400", "28800", "-1", "60"]) {
      const r = resolveLockPref(v, false);
      assert.equal(r.seconds, Number(v));
      assert.equal(r.store, undefined);
      assert.equal(r.markMigrated, true);
    }
  });
  it("offers 5, 15, 30 minutes, 1, 4, 8 hours, every time and never", () => {
    assert.deepEqual(
      LOCK_OPTIONS.map((o) => o.v),
      [300, 900, 1800, 3600, 14400, 28800, 0, -1],
    );
    assert.equal(lockLabel(900), "After 15 minutes away");
    assert.equal(lockLabel(60), "After 1 minute away");
    assert.equal(lockLabel(7200), "After 2 hours away");
  });
});

describe("app lock decision", () => {
  const base = { signedInAt: signedIn, now };
  it("never asks when coming back within the time", () => {
    for (const away of [0, 1, 5, 10, 14.9]) {
      assert.equal(shouldLock({ ...base, pref: 900, lastSeen: now - away * MIN }), false, `${away} min away`);
    }
  });
  it("asks after the time", () => {
    assert.equal(shouldLock({ ...base, pref: 900, lastSeen: now - 15 * MIN }), true);
    assert.equal(shouldLock({ ...base, pref: 900, lastSeen: now - 3 * 60 * MIN }), true);
    assert.equal(shouldLock({ ...base, pref: 3600, lastSeen: now - 59 * MIN }), false);
    assert.equal(shouldLock({ ...base, pref: 3600, lastSeen: now - 61 * MIN }), true);
  });
  it("'every time' still lets short trips (file picker, reload) through", () => {
    assert.equal(shouldLock({ ...base, pref: 0, lastSeen: now - 5_000 }), false);
    assert.equal(shouldLock({ ...base, pref: 0, lastSeen: now - 9_000 }), true);
  });
  it("'never' never asks", () => {
    assert.equal(shouldLock({ ...base, pref: -1, lastSeen: now - 24 * 60 * MIN }), false);
  });
  it("does not ask right after signing in or when nothing was noted", () => {
    assert.equal(shouldLock({ ...base, pref: 900, lastSeen: null }), false);
    assert.equal(shouldLock({ ...base, pref: 900, lastSeen: 0 }), false);
    // Noted before the latest sign-in (or unlock): not counted.
    assert.equal(shouldLock({ pref: 900, lastSeen: now - 60 * MIN, signedInAt: now - 30 * MIN, now }), false);
  });
  it("another tab on screen keeps the app unlocked (shared last-seen time)", () => {
    // Tab A was hidden for an hour, but tab B noted 4 seconds ago that the app is on screen.
    assert.equal(shouldLock({ ...base, pref: 900, lastSeen: now - 4_000 }), false);
  });
  it("reopening the installed app after the phone closed it follows the same rule", () => {
    // pagehide noted the time it closed; reopened 10 minutes later, then 20 minutes later.
    const closedAt = now - 10 * MIN;
    assert.equal(shouldLock({ ...base, pref: 900, lastSeen: closedAt }), false);
    assert.equal(shouldLock({ ...base, pref: 900, lastSeen: now - 20 * MIN }), true);
  });
});

describe("automatic sign-out across tabs", () => {
  it("counts from the newest activity in any tab", () => {
    const left = idleSecondsLeft({ minutes: 30, lastHere: now - 29 * MIN, lastShared: now - 2 * MIN, signedInAt: signedIn, now });
    assert.equal(Math.round(left), 28 * 60);
    const left2 = idleSecondsLeft({ minutes: 30, lastHere: now - 2 * MIN, lastShared: now - 29 * MIN, signedInAt: signedIn, now });
    assert.equal(Math.round(left2), 28 * 60);
  });
  it("is over after the time without activity", () => {
    assert.ok(idleSecondsLeft({ minutes: 30, lastHere: now - 31 * MIN, lastShared: now - 31 * MIN, signedInAt: signedIn, now }) <= 0);
  });
  it("activity from before the latest sign-in does not count against the person", () => {
    const left = idleSecondsLeft({ minutes: 30, lastHere: now, lastShared: now - 5 * 60 * MIN, signedInAt: now - MIN, now });
    assert.equal(Math.round(left), 30 * 60);
  });
  it("works without shared storage (private mode): this tab only", () => {
    assert.equal(Math.round(idleSecondsLeft({ minutes: 15, lastHere: now - 5 * MIN, lastShared: null, signedInAt: 0, now })), 10 * 60);
  });
});

describe("several roles per person", () => {
  it("rolesOf puts the main role first and drops duplicates and unknown values", () => {
    assert.deepEqual(rolesOf("sales", ["finance", "sales", "nope", "finance"]), ["sales", "finance"]);
    assert.deepEqual(rolesOf("warehouse", null), ["warehouse"]);
  });
  it("a permission is allowed when any role allows it", () => {
    assert.equal(can("sales", "seeFinance"), false);
    assert.equal(can(["sales", "finance"], "seeFinance"), true);
    assert.equal(can(["sales", "finance"], "approveQuotes"), false);
    assert.equal(can(["warehouse", "management"], "approveQuotes"), true);
  });
  it("hasRole and onlyRoles", () => {
    assert.equal(hasRole(["driver", "warehouse"], "warehouse"), true);
    assert.equal(hasRole("driver", "warehouse", "management"), false);
    assert.equal(onlyRoles(["driver"], "driver"), true);
    assert.equal(onlyRoles(["driver", "warehouse"], "driver"), false);
  });
});
