/**
 * Unit tests for getting around (no network, no database):
 *   npx tsx --test scripts/test-nav.ts
 * Recently opened records, the command bar (screens and document numbers) and the breadcrumb trail.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commandWords, docMatches, docQuery, matchCommands, type CommandSource } from "../src/lib/command-bar";
import { crumbMenu, crumbTrail } from "../src/lib/crumbs";
import { addRecent, docNumberIn, parseRecent, recordKind, type RecentItem } from "../src/lib/recent-items";

const ID = "3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b";

describe("recent items", () => {
  it("remembers record screens only", () => {
    assert.equal(recordKind(`/quotations/${ID}`), "Quotation");
    assert.equal(recordKind(`/purchase-orders/${ID}`), "Purchase order");
    assert.equal(recordKind(`/meetings/${ID}`), "Meeting");
    assert.equal(recordKind("/quotations/new"), null);
    assert.equal(recordKind(`/meetings/${ID}/room`), null);
    assert.equal(recordKind(`/payroll/${ID}`), null, "payslips are not remembered");
    assert.equal(recordKind(`/hr/${ID}`), null, "employee files are not remembered");
    assert.equal(recordKind("/quotations"), null);
  });
  it("keeps eight, newest first, each once", () => {
    let list: RecentItem[] = [];
    for (let i = 0; i < 10; i++) list = addRecent(list, { href: `/clients/${i}`, title: `Client ${i}`, kind: "Client", at: i });
    assert.equal(list.length, 8);
    assert.equal(list[0].href, "/clients/9");
    list = addRecent(list, { href: "/clients/5", title: "Client 5", kind: "Client", at: 99 });
    assert.equal(list[0].href, "/clients/5");
    assert.equal(list.filter((x) => x.href === "/clients/5").length, 1);
  });
  it("reads only this person's list and survives bad data", () => {
    const raw = JSON.stringify({ s: "abc", items: [{ href: "/clients/1", title: "Barrick", kind: "Client", at: 1 }, { href: "//evil.example", title: "x", kind: "Client" }, 5] });
    assert.deepEqual(parseRecent(raw, "abc").map((x) => x.href), ["/clients/1"]);
    assert.deepEqual(parseRecent(raw, "other"), []);
    assert.deepEqual(parseRecent("{not json", "abc"), []);
    assert.deepEqual(parseRecent(null, "abc"), []);
  });
  it("finds the document number under the heading", () => {
    assert.equal(docNumberIn("QT-2026-0012 · issued 3 Nov 2026"), "QT-2026-0012");
    assert.equal(docNumberIn("INV-2026-0005-R1 · due"), "INV-2026-0005-R1");
    assert.equal(docNumberIn("DN-778"), "DN-778");
    assert.equal(docNumberIn("Draft invoice · issued"), null);
    assert.equal(docNumberIn("Barrick North Mara"), null);
  });
});

describe("command bar", () => {
  const screens: CommandSource[] = [
    { id: "page:/", title: "Home", path: ["Home"], to: "/" },
    { id: "page:/stock", title: "Stock", path: ["Stock", "Stock"], to: "/stock" },
    { id: "page:/transfers", title: "Stock transfers", path: ["Stock", "Stock transfers"], to: "/transfers" },
    { id: "page:/stock/reorder", title: "What to reorder", path: ["Stock", "What to reorder"], to: "/stock/reorder" },
    { id: "page:/settings", title: "Settings", path: ["Company", "Settings"], to: "/settings" },
    { id: "page:/invoices", title: "Invoices", path: ["Money", "Invoices"], to: "/invoices" },
    { id: "page:/invoices/new", title: "New invoice", path: ["Add new", "New invoice"], to: "/invoices/new" },
    { id: "page:/purchase-orders", title: "Purchase orders", path: ["Buy", "Purchase orders"], to: "/purchase-orders" },
    { id: "page:/purchase-orders/new", title: "New purchase order", path: ["Add new", "New purchase order"], to: "/purchase-orders/new" },
    { id: "page:/requisitions/new", title: "New purchase request", path: ["Add new", "New purchase request"], to: "/requisitions/new" },
    { id: "guide:stock", title: "Count stock", path: ["Stock"], to: "/stock" },
  ];
  it("jumps to screens and actions", () => {
    assert.equal(matchCommands(screens, "stock")[0].href, "/stock");
    assert.equal(matchCommands(screens, "stock")[0].score, 100);
    assert.ok(matchCommands(screens, "stock").some((c) => c.href === "/transfers"));
    assert.ok(!matchCommands(screens, "stock").some((c) => c.href === "/stock/reorder"), "the group name alone is not enough");
    assert.equal(matchCommands(screens, "settings")[0].href, "/settings");
    assert.equal(matchCommands(screens, "new invoice")[0].href, "/invoices/new");
    assert.equal(matchCommands(screens, "new PO")[0].href, "/purchase-orders/new");
    assert.equal(matchCommands(screens, "new PO").length, 1);
    assert.equal(matchCommands(screens, "add invoice")[0].href, "/invoices/new");
    assert.equal(matchCommands(screens, "inv")[0].href, "/invoices");
    assert.deepEqual(matchCommands(screens, "lubricants for barrick"), []);
    assert.deepEqual(commandWords("new PO"), ["new", "purchase", "order"]);
  });
  it("reads document numbers", () => {
    const po = docQuery("PO-1042")!;
    assert.deepEqual(po.patterns, ["PO-%-1042", "PO-1042"]);
    assert.ok(docMatches(po, "PO-2026-1042"));
    assert.ok(docMatches(po, "PO-1042"));
    assert.ok(!docMatches(po, "PO-2026-11042"));
    assert.ok(!docMatches(po, "PO-2026-0104"));
    const q = docQuery("Q-12")!;
    assert.equal(q.prefix, "QT");
    assert.ok(docMatches(q, "QT-2026-0012"));
    assert.ok(docMatches(q, "QT-2026-0012-R2"));
    const inv = docQuery("inv 5")!;
    assert.deepEqual(inv.patterns, ["INV-%-0005", "INV-5"]);
    assert.ok(docMatches(inv, "INV-2025-0005"));
    const year = docQuery("INV-2026-5")!;
    assert.deepEqual(year.patterns, ["INV-2026-0005"]);
    assert.ok(!docMatches(year, "INV-2025-0005"));
    const rfq = docQuery("rfq-3")!;
    assert.ok(docMatches(rfq, "RFQ-2026-0003 · Hydraulic oil for Geita"));
    assert.equal(docQuery("stock"), null);
    assert.equal(docQuery("new invoice"), null);
    assert.equal(docQuery("ABC-12"), null);
  });
});

describe("breadcrumbs", () => {
  const menu = crumbMenu();
  const labels = (c: ReturnType<typeof crumbTrail>) => c.map((x) => x.label);
  it("follows the menu groups", () => {
    assert.deepEqual(labels(crumbTrail(menu, `/quotations/${ID}`, { href: "/quotations", label: "Quotations" }, "QT-2026-0012 · Barrick")), ["Sell", "Quotations", "QT-2026-0012 · Barrick"]);
    const t = crumbTrail(menu, `/quotations/${ID}`, { href: "/quotations", label: "Quotations" }, "QT-2026-0012");
    assert.equal(t[1].href, "/quotations");
    assert.equal(t[2].current, true);
  });
  it("puts the back link's screen in the right place", () => {
    assert.deepEqual(labels(crumbTrail(menu, "/stock/reorder", { href: "/stock", label: "Stock" }, "What to reorder")), ["Stock", "Stock", "What to reorder"]);
    assert.deepEqual(labels(crumbTrail(menu, `/purchase-orders/${ID}/receive`, { href: `/purchase-orders/${ID}`, label: "PO-2026-1042" }, "Receive goods")), [
      "Buy",
      "Purchase orders",
      "PO-2026-1042",
      "Receive goods",
    ]);
  });
  it("keeps the service screens and leaves out the + New forms", () => {
    assert.deepEqual(labels(crumbTrail(menu, `/jobs/${ID}`, { href: "/jobs", label: "Service jobs" }, "JOB-2026-0001")), ["Services", "Service jobs", "JOB-2026-0001"]);
    assert.deepEqual(labels(crumbTrail(menu, "/invoices/new", { href: "/invoices", label: "Invoices" }, "New invoice")), ["Money", "Invoices", "New invoice"]);
  });
  it("falls back to the back link off the menu", () => {
    assert.deepEqual(labels(crumbTrail(menu, `/grns/${ID}`, { href: "/receiving", label: "Receive goods" }, "GRN-2026-0004")), ["Receive goods", "GRN-2026-0004"]);
    assert.deepEqual(crumbTrail(menu, "/nowhere", null, "Thing"), []);
  });
});
