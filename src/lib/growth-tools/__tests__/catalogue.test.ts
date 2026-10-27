import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEnquiryForm, senderHash } from "../catalogue";
import { estimatedInterest, nextSteps } from "../financing";
import { qrEncode, qrSvg } from "../qr";

const P = "11111111-2222-4333-8444-555555555555";
function form(v: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) for (const y of Array.isArray(x) ? x : [x]) f.append(k, y);
  return f;
}
const now = 1_800_000_000_000;

test("enquiry form: honeypot, timing and fields", () => {
  const base = { started: String(now - 10_000), name: "Asha", email: "asha@mine.co.tz", kind: "quote", product_id: [P], [`qty_${P}`]: "12,5" };
  const ok = checkEnquiryForm(form(base), now);
  assert.ok(ok.ok);
  if (ok.ok) assert.deepEqual(ok.value.lines, [{ product_id: P, quantity: "12.5" }]);
  const bot = checkEnquiryForm(form({ ...base, website: "http://spam" }), now);
  assert.ok(!bot.ok && bot.spam);
  const fast = checkEnquiryForm(form({ ...base, started: String(now - 500) }), now);
  assert.ok(!fast.ok && fast.spam);
  assert.ok(!checkEnquiryForm(form({ ...base, email: "", phone: "" }), now).ok);
  assert.ok(!checkEnquiryForm(form({ ...base, email: "bad@" }), now).ok);
  assert.ok(!checkEnquiryForm(form({ ...base, [`qty_${P}`]: "-1" }), now).ok);
  assert.ok(!checkEnquiryForm(form({ ...base, product_id: ["x"] }), now).ok, "a quote needs a product");
  assert.ok(checkEnquiryForm(form({ started: String(now - 10_000), name: "Juma", phone: "+255 712 345 678", message: "Do you sell grease?" }), now).ok);
});

test("sender hash is stable and hides the address", () => {
  const saved = process.env.CATALOGUE_HASH_SECRET;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.CATALOGUE_HASH_SECRET;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert.equal(senderHash("41.59.1.1", "Mozilla"), null, "no secret: off, never a built-in key");
  process.env.CATALOGUE_HASH_SECRET = "test-secret-for-the-hash";
  const a = senderHash("41.59.1.1", "Mozilla")!;
  assert.equal(a, senderHash("41.59.1.1", "Mozilla"));
  assert.notEqual(a, senderHash("41.59.1.2", "Mozilla"));
  assert.ok(!a.includes("41.59"));
  assert.equal(a.length, 48);
  if (saved === undefined) delete process.env.CATALOGUE_HASH_SECRET;
  else process.env.CATALOGUE_HASH_SECRET = saved;
  if (savedKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
});

test("financing steps and interest", () => {
  assert.deepEqual(
    nextSteps("draft").map((s) => s.to),
    ["submitted", "cancelled"],
  );
  assert.deepEqual(
    nextSteps("disbursed").map((s) => s.to),
    ["repaid"],
  );
  assert.deepEqual(nextSteps("repaid"), []);
  assert.equal(estimatedInterest(100_000_000, 18, 90), 4438356);
  assert.equal(estimatedInterest(1, null, 90), null);
});

test("QR code: size, finder patterns, timing, format", () => {
  const q = qrEncode("https://app.lemosp.co.tz/c/triumph-general-suppliers");
  assert.ok(q);
  assert.equal(q.size, 33); // 52 bytes at level M: version 4
  const m = q.modules;
  for (const [x, y] of [
    [0, 0],
    [6, 0],
    [0, 6],
    [6, 6],
    [q.size - 1, 0],
    [0, q.size - 1],
  ]) assert.ok(m[y][x], `${x},${y}`);
  assert.ok(!m[1][1] && m[2][2]);
  assert.ok(m[q.size - 8][8], "dark module");
  for (let i = 8; i < q.size - 8; i++) assert.equal(m[6][i], i % 2 === 0);
  assert.equal(qrEncode("x".repeat(700)), null);
  assert.match(qrSvg("hi") ?? "", /^<svg[^>]+viewBox="0 0 29 29"/);
});
