/**
 * Unit tests for the fixes from the signed-in browser test (no network, no database):
 *   npx tsx --test scripts/test-signed-in.ts
 * Notes after a "#section", no loading.tsx in the app, the pressed button's value kept on forms
 * with an "id" field, and menu links only for screens the role can open.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { friendlyError, withNotice } from "../src/lib/messages";
import { moreMenu } from "../src/lib/menu";
import { can, type Role } from "../src/lib/roles";
import { choice } from "../src/lib/format";

const ROOT = join(__dirname, "..");

describe("withNotice", () => {
  it("puts the note before the #section", () => {
    assert.equal(withNotice("/rfqs/1#lines", { msg: "Item added." }), "/rfqs/1?msg=Item+added.#lines");
    assert.equal(withNotice("/x?tab=a#b", { error: "No" }), "/x?tab=a&error=No#b");
    assert.equal(withNotice("/x", { msg: "Saved." }), "/x?msg=Saved.");
    assert.equal(withNotice("/x#b", {}), "/x#b");
  });
});

describe("friendlyError", () => {
  it("names the shelf life / warranty limit", () => {
    assert.match(friendlyError('new row violates check constraint "products_shelf_life_months_check"'), /0 to 600/);
  });
});

describe("screens", () => {
  it("has no loading.tsx in the app (it left the screen empty after a save)", () => {
    assert.equal(existsSync(join(ROOT, "src/app/(app)/loading.tsx")), false);
    assert.equal(existsSync(join(ROOT, "src/app/(app)/admin/loading.tsx")), false);
  });
  it("keeps the pressed button's value (SubmitterValue mounted in the root layout)", () => {
    assert.match(readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8"), /<SubmitterValue \/>/);
  });
});

describe("menu", () => {
  it("offers Supplier RFQs only to roles that can open it", () => {
    for (const role of ["management", "sales", "procurement", "warehouse", "driver", "finance"] as Role[]) {
      const hrefs = moreMenu(role, role === "management", { on: () => true, isPlatformAdmin: false, features: [] })
        .flatMap((g) => g.items.map((i) => i.href));
      assert.equal(hrefs.includes("/supplier-rfqs"), can([role], "editPurchasing"), role);
    }
  });
});

describe("two-button choices refuse a lost button value", () => {
  const fd = (v?: string) => {
    const f = new FormData();
    f.set("id", "q1");
    if (v !== undefined) f.set("outcome", v);
    return f;
  };
  it("reads yes and no", () => {
    assert.equal(choice(fd("accepted"), "outcome", "accepted", "rejected"), true);
    assert.equal(choice(fd("rejected"), "outcome", "accepted", "rejected"), false);
  });
  it("gives null (not 'no') when the button value is missing or unknown", () => {
    assert.equal(choice(fd(), "outcome", "accepted", "rejected"), null);
    assert.equal(choice(fd(""), "outcome", "accepted", "rejected"), null);
    assert.equal(choice(fd("maybe"), "outcome", "accepted", "rejected"), null);
  });
  it("every two-button decision action checks for a lost choice", () => {
    for (const f of ["quotations", "purchase-orders", "hr", "timesheets/approve", "requisitions", "meetings", "portal-admin"]) {
      const src = readFileSync(join(ROOT, "src/app/(app)", f, "actions.ts"), "utf8");
      assert.match(src, /=== null\)[^\n]*LOST_CHOICE/, f);
    }
  });
});
