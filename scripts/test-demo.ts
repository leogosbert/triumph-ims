/**
 * Unit tests for demo mode, the LeMo Demonstrator's way in (no browser needed):
 *   npx tsx --test scripts/test-demo.ts
 * Off unless asked for, never on the live site, exact Command Center addresses only, the seat read from the web
 * address, and the cookie and framing rules that follow.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { demoConfigFrom, demoCookieOptions, frameAncestors, parseOrigins, seatFromHost } from "../src/demoBridge/demoConfig";

const CC = "https://lemo-command-center.netlify.app";

describe("demo mode switch", () => {
  it("is off unless the build asks for it", () => {
    assert.deepEqual(demoConfigFrom({}), { enabled: false, reason: "off" });
    assert.deepEqual(demoConfigFrom({ flag: "true", parentOrigins: CC }), { enabled: false, reason: "off" });
  });
  it("is refused on the live site", () => {
    assert.deepEqual(demoConfigFrom({ flag: "1", appEnv: "production", parentOrigins: CC }), { enabled: false, reason: "production" });
    assert.deepEqual(demoConfigFrom({ flag: "1", appEnv: "PRODUCTION", parentOrigins: CC }), { enabled: false, reason: "production" });
  });
  it("needs at least one exact parent address", () => {
    assert.deepEqual(demoConfigFrom({ flag: "1", parentOrigins: "*" }), { enabled: false, reason: "no-origins" });
    assert.deepEqual(demoConfigFrom({ flag: "1", appEnv: "demo", parentOrigins: CC }), { enabled: true, origins: [CC] });
  });
  it("keeps only exact origins", () => {
    assert.deepEqual(parseOrigins(`${CC}/, https://*.netlify.app ${CC}/demonstrator, HTTPS://CC.example.com, ${CC}`), [CC, "https://cc.example.com"]);
  });
});

describe("seats", () => {
  it("reads the seat from the demo site's setting, or from a local address", () => {
    assert.equal(seatFromHost("lemosp-demo-sales.netlify.app", "sales"), "sales");
    assert.equal(seatFromHost("anything", "store-keeper"), "store-keeper");
    assert.equal(seatFromHost("finance.localhost:3000", undefined), "finance");
  });
  it("has no seat otherwise", () => {
    for (const h of ["lemosp-demo.netlify.app", "lemosp.netlify.app", "localhost:3000", "a.b.localhost", "", null])
      assert.equal(seatFromHost(h, undefined), null, String(h));
    assert.equal(seatFromHost("x.localhost", "Bad Seat!"), "x");
  });
});

describe("cookies and framing", () => {
  const on = demoConfigFrom({ flag: "1", parentOrigins: CC });
  const off = demoConfigFrom({});
  it("normal builds keep the usual cookies and forbid framing", () => {
    assert.equal(demoCookieOptions(off), undefined);
    assert.equal(frameAncestors(off), "'none'");
  });
  it("demo builds send the sign-in to the framed app and let only the Command Center frame it", () => {
    assert.deepEqual(demoCookieOptions(on), { sameSite: "none", secure: true, partitioned: true });
    assert.equal(frameAncestors(on), CC);
  });
});
