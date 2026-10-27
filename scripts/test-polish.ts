/**
 * Unit tests for the polish fixes (no network, no database):
 *   npx tsx --test scripts/test-polish.ts
 * Feature switches for keys the database does not know yet, plain error messages, absurd amounts,
 * network failures at sign-in, and source checks (role guards, feature keys, language rules).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ERP_FEATURES, fallbackFeatures, isGatedFeature, makeOn, ROUTE_FEATURES, SERVICE_FEATURES } from "../src/lib/features";
import { MAX_AMOUNT, toNumber, tooLarge } from "../src/lib/fields";
import { friendlyError, isNetworkError, NETWORK_MESSAGE } from "../src/lib/messages";
import { ANSWER_LANGUAGE, READS_KISWAHILI } from "../src/lib/ai/language";
import { askSystem } from "../src/lib/ai/ask-prompt";
import { DOCUMENT_SYSTEM } from "../src/lib/ai/document";
import { RECEIPT_SYSTEM } from "../src/lib/ai/receipt";

const ROOT = join(__dirname, "..");
function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, ext, out);
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

describe("features.on", () => {
  const known = new Set(["quotations", "invoices", "supplier_portal"]);
  const on = makeOn(true, known, new Set(["quotations", "supplier_portal"]));

  it("a gated feature the database does not know yet is off", () => {
    assert.equal(on("tender_alerts"), false);
    assert.equal(on("lpo_financing"), false);
    assert.equal(on("hr_people"), false);
    assert.equal(on("service_jobs"), false);
  });
  it("a known gated feature follows its switch", () => {
    assert.equal(on("supplier_portal"), true);
    assert.equal(makeOn(true, known, new Set())("supplier_portal"), false);
  });
  it("long-standing features without a row stay on", () => {
    assert.equal(on("deliveries"), true);
    assert.equal(on("products"), true);
    assert.equal(on(null), true);
  });
  it("a known long-standing feature switched off is off", () => {
    assert.equal(on("invoices"), false);
  });
  it("before the Stage 11 SQL: long-standing screens show, gated ones do not", () => {
    const f = fallbackFeatures();
    assert.equal(f.ready, false);
    assert.equal(f.on("quotations"), true);
    assert.equal(f.on("client_portal"), false);
  });
  it("every gated feature is in the gated sets", () => {
    for (const k of [...ERP_FEATURES, ...SERVICE_FEATURES]) assert.equal(isGatedFeature(k), true);
  });
});

describe("feature keys used by the screens exist in the database seed", () => {
  const sql = files(join(ROOT, "supabase/migrations"), /\.sql$/).map((f) => readFileSync(f, "utf8")).join("\n");
  const seeded = new Set([...sql.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'[^']*'/g)].map((m) => m[1]));
  const src = files(join(ROOT, "src"), /\.tsx?$/).map((f) => readFileSync(f, "utf8")).join("\n");
  const used = new Set([...src.matchAll(/features\.on\("([a-z_]+)"\)/g)].map((m) => m[1]));
  for (const key of Object.values(ROUTE_FEATURES)) used.add(key);
  for (const key of [...ERP_FEATURES, ...SERVICE_FEATURES]) used.add(key);
  it("found the keys", () => assert.ok(used.size > 40 && seeded.size > 40));
  for (const key of [...used].sort()) {
    it(key, () => assert.ok(seeded.has(key), `${key} is used in src but no migration inserts it into public.features`));
  }
});

describe("friendlyError", () => {
  const cases: [string, RegExp][] = [
    ["Could not find the function public.portal_rfq_send_list(p_srfq) in the schema cache", /latest database update/],
    ['function public.tender_notice_add(uuid) does not exist', /latest database update/],
    ['relation "public.pay_links" does not exist', /latest database update/],
    ["numeric field overflow", /too large/],
    ['invalid input syntax for type date: "2026-13-45"', /not a real date/],
    ['date/time field value out of range: "31/02/2026"', /not a real date/],
    ['new row for relation "bills" violates check constraint "bills_amount_check"', /not allowed/],
    ['duplicate key value violates unique constraint "warehouses_company_id_code_key"', /already recorded/],
    ['insert or update on table "po_lines" violates foreign key constraint "po_lines_product_id_fkey"', /no longer exists/],
    ['update or delete on table "clients" violates foreign key constraint "invoices_client_id_fkey" on table "invoices"', /still used elsewhere/],
    ['null value in column "name" of relation "clients" violates not-null constraint', /required field/],
    ["value too long for type character varying(40)", /too long/],
    ["TypeError: Failed to fetch", /reach the server/],
    ['operator does not exist: uuid = text', /didn't work/],
  ];
  for (const [raw, want] of cases) {
    it(raw.slice(0, 60), () => {
      const out = friendlyError(raw);
      assert.match(out, want);
      assert.ok(!/schema cache|violates|syntax|overflow|PGRST|relation "|function public\./.test(out), `raw text leaked: ${out}`);
    });
  }
  it("our own plain messages pass through", () => {
    assert.equal(friendlyError("The meeting is too long for the AI."), "The meeting is too long for the AI.");
    assert.equal(friendlyError("The value is out of range for: Fire certificate"), "The value is out of range for: Fire certificate");
    assert.equal(friendlyError("That is more than was ordered on this line (po_lines_received_le_ordered)"), "That is more than was ordered on this line.");
  });
});

describe("amounts", () => {
  it("normal amounts", () => {
    assert.equal(toNumber("1,890,000"), 1890000);
    assert.equal(toNumber("TZS 1 890 000.50"), 1890000.5);
    assert.equal(toNumber(""), null);
  });
  it("absurd amounts are refused", () => {
    assert.ok(Number.isNaN(toNumber("1e21")));
    assert.ok(Number.isNaN(toNumber("9999999999999999")));
    assert.ok(Number.isNaN(toNumber("-1e16")));
    assert.equal(toNumber(String(MAX_AMOUNT)), MAX_AMOUNT);
    assert.equal(tooLarge("1e21"), true);
    assert.equal(tooLarge("1000"), false);
    assert.equal(tooLarge("abc"), false);
  });
});

describe("sign-in network failures", () => {
  it("recognises an unreachable server", () => {
    assert.equal(isNetworkError({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 }), true);
    assert.equal(isNetworkError({ message: "fetch failed" }), true);
    assert.equal(isNetworkError({ message: "Load failed" }), true);
    assert.match(NETWORK_MESSAGE, /Can't reach the server/);
  });
  it("a wrong password is not a network failure", () => {
    assert.equal(isNetworkError({ name: "AuthApiError", message: "Invalid login credentials", status: 400 }), false);
    assert.equal(isNetworkError(null), false);
  });
  it("the sign-in form does not count a network failure as a wrong password", () => {
    const form = readFileSync(join(ROOT, "src/app/login/LoginForm.tsx"), "utf8");
    const net = form.indexOf("isNetworkError(error)");
    const fail = form.indexOf("addFail()", form.indexOf("signInWithPassword"));
    assert.ok(net > 0 && fail > net, "the network check must come before addFail()");
  });
});

describe("source checks", () => {
  const app = files(join(ROOT, "src/app/(app)"), /\.tsx?$/);
  it('role guards say why instead of redirect("/")', () => {
    const bad = app.filter((f) => /\)\s*redirect\("\/"\);/.test(readFileSync(f, "utf8")) && !f.endsWith(join("branches", "actions.ts")));
    assert.deepEqual(bad, []);
  });
  it("not-found pages exist", () => {
    for (const f of ["src/app/not-found.tsx", "src/app/(app)/not-found.tsx", "src/app/portal/(in)/not-found.tsx"]) {
      assert.ok(statSync(join(ROOT, f)).isFile(), f);
    }
  });
  it("the AI prompts carry the language rules", () => {
    const ask = askSystem({ company: "TRIUMPH", lang: "en", today: "2026-10-28", legal: false, routes: ["/"] });
    assert.ok(ask.includes(READS_KISWAHILI) && ask.includes(ANSWER_LANGUAGE));
    assert.ok(DOCUMENT_SYSTEM.includes(READS_KISWAHILI));
    assert.ok(RECEIPT_SYSTEM.includes(READS_KISWAHILI));
    assert.match(READS_KISWAHILI, /Sheng/);
  });
});
