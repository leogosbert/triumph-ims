import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTenderReading } from "../tenderAi";
import { hasPhrase, sameBuyer, scoreTender, type MatchContext } from "../tenderMatch";
import { EMPTY_FIELDS, mergeFields, type TenderFields } from "../tenderText";

const now = new Date("2026-11-01T07:00:00Z");
const ctx: MatchContext = {
  settings: { keywords: ["hydraulic oil", "grease", "filters"], exclude_keywords: ["construction works"], categories: ["Lubricants"], buyers: [], min_score: 40 },
  product_categories: ["Lubricants", "Chemicals"],
  products: [{ name: "Shell Tellus S2 M 46", category: "Lubricants", brand: "Shell" }],
  compliance: { TRA_TAX_CLEARANCE: "done", BUSINESS_LICENCE: "done", BRELA_INCORPORATION: "done", TRA_TIN: "done" },
  licences: [],
  buyers: [{ name: "Geita Gold Mining Limited", won: 2, lost: 1, bids: 3 }],
  clients: ["GEITA GOLD MINING LTD"],
};
const notice: TenderFields = {
  ...EMPTY_FIELDS,
  title: "Supply of Hydraulic Oils and Greases",
  buyer: "Geita Gold Mining Ltd",
  closing_at: "2026-11-20T10:00:00+03:00",
  documents_required: ["Tax clearance certificate", "Business licence"],
};

test("phrases and buyers", () => {
  assert.ok(hasPhrase("Supply of hydraulic oils", "hydraulic oil"));
  assert.ok(!hasPhrase("Supply of oils", "hydraulic oil"));
  assert.ok(sameBuyer("Geita Gold Mining Ltd", "GEITA GOLD MINING LIMITED"));
  assert.ok(!sameBuyer("Geita Gold Mining", "North Mara Gold Mine"));
});

test("a good fit with papers ready is a bid", () => {
  const r = scoreTender(notice, ctx, { now });
  assert.equal(r.decision, "bid");
  assert.ok(r.score >= 65, String(r.score));
  assert.ok(r.matched.includes("hydraulic oil"));
  assert.ok(r.reasons.some((x) => x.kind === "history" && /won 2 tenders/.test(x.text)));
});

test("a missing tax clearance keeps it at consider", () => {
  const r = scoreTender(notice, { ...ctx, compliance: { ...ctx.compliance, TRA_TAX_CLEARANCE: "in_progress" } }, { now });
  assert.equal(r.decision, "consider");
  assert.ok(r.reasons.some((x) => x.code === "TRA_TAX_CLEARANCE" && !x.ok));
});

test("closed, excluded or unrelated is no bid", () => {
  assert.equal(scoreTender({ ...notice, closing_at: "2026-10-01T10:00:00+03:00" }, ctx, { now }).decision, "no_bid");
  const ex = scoreTender({ ...notice, title: "Construction works and supply of grease" }, ctx, { now });
  assert.equal(ex.decision, "no_bid");
  assert.ok(ex.score <= 15);
  const off = scoreTender({ ...EMPTY_FIELDS, title: "Provision of cleaning services", closing_at: notice.closing_at }, ctx, { now });
  assert.equal(off.decision, "no_bid");
});

test("the AI reply is checked and cleaned", () => {
  const r = checkTenderReading(
    JSON.stringify({
      is_tender: true,
      title: "  Supply of  filters ",
      buyer: "TANESCO",
      reference: "",
      category: "Goods",
      location: "",
      summary: "x",
      published_on: "2026-02-31",
      closing_at: "2026-11-20T14:00",
      documents_required: ["Tax clearance", "Tax clearance", 5],
      bid_security: "",
      items: [],
      fit: 14,
      fit_reason: "Sells filters",
    }),
  );
  assert.ok(r);
  assert.equal(r.fields.title, "Supply of filters");
  assert.equal(r.fields.reference, null);
  assert.equal(r.fields.published_on, null);
  assert.equal(r.fields.closing_at, "2026-11-20T14:00:00+03:00");
  assert.deepEqual(r.fields.documents_required, ["Tax clearance"]);
  assert.equal(r.fit, 10);
  assert.equal(checkTenderReading("not json"), null);
  const m = mergeFields(r.fields, { ...EMPTY_FIELDS, reference: "TR/1/2026", title: "other" });
  assert.equal(m.reference, "TR/1/2026");
  assert.equal(m.title, "Supply of filters");
});
