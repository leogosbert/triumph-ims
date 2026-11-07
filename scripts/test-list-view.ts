/**
 * Unit tests for the list helpers (sorting through ?sort=&dir=, links that keep params):
 *   npx tsx --test scripts/test-list-view.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listHref, readSort, sortKeep, sortLinks, sortRows, weekAhead, type SortOption } from "../src/lib/list-view";

const SORTS: SortOption[] = [
  { key: "due", label: "Due date", col: "due_date", dir: "asc" },
  { key: "amount", label: "Amount", col: "total", dir: "desc" },
  { key: "client", label: "Client", dir: "asc" },
];

describe("readSort", () => {
  it("falls back to the default, in its own direction", () => {
    const s = readSort({}, SORTS, "amount");
    assert.equal(s.key, "amount");
    assert.equal(s.dir, "desc");
    assert.equal(s.explicit, false);
    assert.equal(sortKeep(s), undefined);
  });
  it("takes a known sort and direction from the address", () => {
    const s = readSort({ sort: "due", dir: "desc" }, SORTS, "amount");
    assert.deepEqual([s.key, s.dir, s.ascending, s.explicit], ["due", "desc", false, true]);
    assert.deepEqual(sortKeep(s), { sort: "due", dir: "desc" });
  });
  it("ignores unknown keys and directions", () => {
    assert.equal(readSort({ sort: "drop table" }, SORTS, "due").key, "due");
    assert.equal(readSort({ sort: "amount", dir: "sideways" }, SORTS).dir, "desc");
    assert.equal(readSort({ dir: "asc" }, SORTS, "amount").dir, "desc");
  });
});

describe("sortLinks and listHref", () => {
  it("flips the active sort and keeps other params, never notices", () => {
    const sp = { tab: "unpaid", q: "geita", msg: "Saved", sort: "amount", dir: "desc" };
    const links = sortLinks("/invoices", sp, SORTS, readSort(sp, SORTS));
    const amount = links.find((l) => l.key === "amount")!;
    assert.equal(amount.active, true);
    assert.equal(amount.href, "/invoices?tab=unpaid&q=geita&sort=amount&dir=asc");
    assert.equal(links.find((l) => l.key === "due")!.href, "/invoices?tab=unpaid&q=geita&sort=due&dir=asc");
  });
  it("removes a param set to null", () => {
    assert.equal(listHref("/expenses", { m: "2026-11", show: "mine" }, { show: null }), "/expenses?m=2026-11");
    assert.equal(listHref("/expenses", {}, {}), "/expenses");
  });
});

describe("sortRows", () => {
  it("sorts text without case, numbers by value, empties last", () => {
    const rows = [{ n: "twiga" }, { n: null }, { n: "Barrick" }, { n: "geita" }];
    assert.deepEqual(sortRows(rows, (r) => r.n, "asc").map((r) => r.n), ["Barrick", "geita", "twiga", null]);
    assert.deepEqual(sortRows(rows, (r) => r.n, "desc").map((r) => r.n), ["twiga", "geita", "Barrick", null]);
    assert.deepEqual(sortRows([{ v: 10 }, { v: 9 }, { v: 100 }], (r) => r.v, "asc").map((r) => r.v), [9, 10, 100]);
  });
});

describe("weekAhead", () => {
  it("spans seven days, across a month end", () => {
    assert.deepEqual(weekAhead("2026-11-27"), { from: "2026-11-27", to: "2026-12-04" });
  });
});
