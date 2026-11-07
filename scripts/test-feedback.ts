// Checks the form patterns used by the live field checks (src/lib/patterns.ts).
// Browsers match `pattern` as ^(?:…)$ with the "v" flag, so the test does the same.
// Run: npx tsx --test scripts/test-feedback.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { PATTERNS, type PatternKey } from "../src/lib/patterns";

const matches = (k: PatternKey, v: string) => new RegExp(`^(?:${PATTERNS[k].pattern})$`, "v").test(v);

const cases: [PatternKey, string, boolean][] = [
  ["tin", "123456789", true],
  ["tin", "123-456-789", true],
  ["tin", "123 456 789", true],
  ["tin", "12345678", false],
  ["tin", "1234567890", false],
  ["tin", "TIN123456789", false],
  ["phone", "0754 123 456", true],
  ["phone", "+255 754 123 456", true],
  ["phone", "(022) 211-0000", false], // must start with + or a digit
  ["phone", "022 211-0000", true],
  ["phone", "0754 123 456 / 0713 222 333", true],
  ["phone", "123", false],
  ["phone", "call me", false],
  ["phone", "07a4 123 456", false],
  ["qty", "1", true],
  ["qty", "2.5", true],
  ["qty", "1,000", true],
  ["qty", "0.5", true],
  ["qty", ".5", true],
  ["qty", "0", false],
  ["qty", "0.00", false],
  ["qty", "-1", false],
  ["qty", "abc", false],
  ["amount", "0", true],
  ["amount", "15000", true],
  ["amount", "1,890,000.50", true],
  ["amount", "1 890 000", true],
  ["amount", "-5", false],
  ["amount", "1e5", false],
  ["whole", "12", true],
  ["whole", "1.5", false],
];

for (const [k, v, expected] of cases) {
  test(`${k}: "${v}" ${expected ? "passes" : "is refused"}`, () => {
    assert.equal(matches(k, v), expected);
  });
}

test("every pattern compiles with the v flag, like browsers use", () => {
  for (const p of Object.values(PATTERNS)) assert.doesNotThrow(() => new RegExp(p.pattern, "v"));
});
