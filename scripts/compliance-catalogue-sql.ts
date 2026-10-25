// Keeps the SQL copy of the compliance catalogue in step with src/lib/compliance/catalogue.ts.
//
//   npx tsx scripts/compliance-catalogue-sql.ts          rewrite the generated block in the migration
//   npx tsx scripts/compliance-catalogue-sql.ts --check  exit 1 when the migration is out of date
//
// The block sits between the BEGIN/END markers in supabase/migrations/20261026000100_compliance.sql.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_PACKS } from "../src/lib/compliance/audits";
import { ACTIVITY_GUIDES, CATALOGUE_REVIEWED_ON, COMPLIANCE_CATALOGUE, COMPLIANCE_CATEGORIES } from "../src/lib/compliance/catalogue";

const FILE = join(__dirname, "..", "supabase", "migrations", "20261026000100_compliance.sql");
const BEGIN = "-- BEGIN GENERATED COMPLIANCE CATALOGUE";
const END = "-- END GENERATED COMPLIANCE CATALOGUE";

const q = (v: string | null | undefined) => (v === null || v === undefined ? "null" : `'${v.replace(/'/g, "''")}'`);
const arr = (v: string[]) => (v.length ? `array[${v.map(q).join(", ")}]::text[]` : "'{}'::text[]");
const num = (v: number | undefined) => (v === undefined ? "null" : String(v));

function problems(): string[] {
  const out: string[] = [];
  const codes = new Set<string>();
  const cats = new Set(COMPLIANCE_CATEGORIES.map((c) => c.key));
  for (const r of COMPLIANCE_CATALOGUE) {
    if (!/^[A-Z][A-Z0-9_]{2,59}$/.test(r.code)) out.push(`bad code ${r.code}`);
    if (codes.has(r.code)) out.push(`duplicate code ${r.code}`);
    codes.add(r.code);
    if (!cats.has(r.category)) out.push(`${r.code}: unknown category ${r.category}`);
    if (r.appliesTo === "conditional" && !r.condition) out.push(`${r.code}: conditional without a condition`);
    if (r.verify && !r.verifyNote) out.push(`${r.code}: verify without a note`);
    if (r.dueDay !== undefined && (r.frequency === "none" || r.dueDay < 1 || r.dueDay > 31)) out.push(`${r.code}: bad due day`);
    if (r.dueDay !== undefined && r.dueOffsetMonths === undefined) out.push(`${r.code}: due day without an offset`);
    if (r.website && !/^https:\/\/[a-z0-9.-]+\.(go|or)\.tz$/.test(r.website)) out.push(`${r.code}: website must be an official https .go.tz / .or.tz site`);
  }
  for (const g of ACTIVITY_GUIDES) for (const c of g.codes) if (!codes.has(c)) out.push(`guide ${g.key}: unknown code ${c}`);
  for (const p of AUDIT_PACKS) for (const l of p.lines) if ("code" in l && !codes.has(l.code)) out.push(`audit pack ${p.key}: unknown code ${l.code}`);
  return out;
}

export function catalogueSql(): string {
  const cols =
    "code, category, kind, name, authority, applies_to, condition, purpose, documents_needed, renewal, due_rule, frequency, due_day, due_offset_months, penalty, website, verify, verify_note, starter, finance, tags, keywords, sort, reviewed_on";
  const rows = COMPLIANCE_CATALOGUE.map(
    (r) =>
      `(${[
        q(r.code),
        q(r.category),
        q(r.kind),
        q(r.name),
        q(r.authority),
        q(r.appliesTo),
        q(r.condition),
        q(r.purpose),
        arr(r.documentsNeeded),
        q(r.renewal),
        q(r.dueRule),
        q(r.frequency),
        num(r.dueDay),
        num(r.dueOffsetMonths),
        q(r.penalty),
        q(r.website),
        String(r.verify),
        q(r.verifyNote),
        String(r.starter),
        String(r.finance),
        arr(r.tags),
        arr(r.keywords ?? []),
        String(r.sort),
        q(CATALOGUE_REVIEWED_ON),
      ].join(", ")})`,
  );
  const update = cols
    .split(", ")
    .filter((c) => c !== "code")
    .map((c) => `${c} = excluded.${c}`)
    .join(",\n      ");
  return [
    `${BEGIN} (npx tsx scripts/compliance-catalogue-sql.ts; do not edit by hand)`,
    `insert into public.compliance_catalogue (${cols})`,
    "values",
    rows.join(",\n"),
    "on conflict (code) do update",
    `  set ${update},`,
    "      updated_at = now();",
    `-- ${COMPLIANCE_CATALOGUE.length} requirements, reviewed ${CATALOGUE_REVIEWED_ON}`,
    END,
  ].join("\n");
}

function main() {
  const issues = problems();
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exit(1);
  }
  const sql = readFileSync(FILE, "utf8");
  const a = sql.indexOf(BEGIN);
  const b = sql.indexOf(END);
  if (a < 0 || b < a) {
    console.error(`Markers not found in ${FILE}`);
    process.exit(1);
  }
  const next = sql.slice(0, a) + catalogueSql() + sql.slice(b + END.length);
  if (process.argv.includes("--check")) {
    if (next !== sql) {
      console.error("The compliance catalogue in the migration is out of date. Run: npx tsx scripts/compliance-catalogue-sql.ts");
      process.exit(1);
    }
    console.log(`Compliance catalogue in step (${COMPLIANCE_CATALOGUE.length} requirements).`);
    return;
  }
  writeFileSync(FILE, next);
  console.log(`Wrote ${COMPLIANCE_CATALOGUE.length} requirements into ${FILE}`);
}

main();
