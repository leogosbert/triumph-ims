import assert from "node:assert/strict";
import { test } from "node:test";
import { daysLeft, findClosing, findDates, parseTime } from "../dates";
import { cleanTitle, detectPapers, extractTenderRules, findBuyer, findReference, paperCode } from "../tenderText";

const GGML = `INVITATION FOR TENDER
Geita Gold Mining Ltd invites sealed bids from eligible suppliers for the Supply of Hydraulic Oils and Greases to the Geita mine site.
Tender No. GGML/LUB/014/2026
Bidders must submit: certificate of incorporation, TIN certificate, valid tax clearance certificate, business licence,
Mining Commission local content registration and safety data sheets for all products.
Bid security of TZS 5,000,000 is required.
Delivery to: Geita Mine Site
Closing date: 20th November 2026 at 10:00 hrs. Published on 25/10/2026.`;

test("times, English and Kiswahili", () => {
  assert.equal(parseTime("10:00 hrs"), "10:00");
  assert.equal(parseTime("2:30 pm"), "14:30");
  assert.equal(parseTime("1400hrs"), "14:00");
  assert.equal(parseTime("saa 4:00 asubuhi"), "10:00");
  assert.equal(parseTime("saa 8 mchana"), "14:00");
  assert.equal(parseTime("no time here"), null);
});

test("dates in the usual forms, day first", () => {
  const d = findDates("Open 05/03/2026, closes 20th November 2026, or 2026-12-01, also November 30, 2026 and tarehe 3 Desemba 2026");
  assert.deepEqual(
    d.map((x) => x.date),
    ["2026-03-05", "2026-11-20", "2026-12-01", "2026-11-30", "2026-12-03"],
  );
  assert.deepEqual(findDates("31/02/2026"), []);
});

test("closing date: the date after the closing words, with its time", () => {
  assert.equal(findClosing(GGML), "2026-11-20T10:00:00+03:00");
  assert.equal(findClosing("Issued 01/11/2026. Deadline for submission: 15/11/2026 at 2:00 pm"), "2026-11-15T14:00:00+03:00");
  assert.equal(findClosing("Tarehe ya mwisho ni 12 Novemba 2026 saa 4:00 asubuhi"), "2026-11-12T10:00:00+03:00");
  assert.equal(findClosing("no dates"), null);
});

test("days left", () => {
  const now = new Date("2026-11-10T07:00:00Z");
  assert.equal(daysLeft("2026-11-20T10:00:00+03:00", now), 10);
  assert.equal(daysLeft("2026-11-01T10:00:00+03:00", now), -9);
  assert.equal(daysLeft(null, now), null);
});

test("reference, buyer, title", () => {
  assert.equal(findReference(GGML), "GGML/LUB/014/2026");
  assert.equal(findReference("Tender No: PA/112/2026-27/G/45 for supply"), "PA/112/2026-27/G/45");
  assert.equal(findReference("tender closing 2026"), null);
  assert.equal(findBuyer(GGML), "Geita Gold Mining Ltd");
  assert.equal(findBuyer("Procuring Entity: TANESCO\nTender..."), "TANESCO");
  assert.equal(cleanTitle("Fwd: Tender notice: Supply of filters"), "Supply of filters");
});

test("papers asked for map to the compliance checklist", () => {
  const codes = detectPapers(GGML).map((p) => p.code);
  for (const c of ["BRELA_INCORPORATION", "TRA_TIN", "TRA_TAX_CLEARANCE", "BUSINESS_LICENCE", "MINING_LOCAL_CONTENT"]) assert.ok(codes.includes(c), c);
  assert.ok(!codes.includes("PURA_LOCAL_CONTENT"), "oil and gas local content needs an oil and gas tender");
  assert.equal(paperCode("Valid tax clearance"), "TRA_TAX_CLEARANCE");
  assert.equal(paperCode("Company profile"), null);
});

test("the rules read a whole advert", () => {
  const f = extractTenderRules(GGML, null);
  assert.match(f.title ?? "", /Supply of Hydraulic Oils and Greases/);
  assert.equal(f.buyer, "Geita Gold Mining Ltd");
  assert.equal(f.reference, "GGML/LUB/014/2026");
  assert.equal(f.closing_at, "2026-11-20T10:00:00+03:00");
  assert.equal(f.published_on, "2026-10-25");
  assert.equal(f.bid_security, "TZS 5,000,000");
  assert.equal(f.location, "Geita Mine Site");
  assert.ok(f.documents_required.includes("Tax clearance certificate"));
  assert.ok(f.documents_required.includes("Safety data sheets"));
});
