/**
 * The command bar inside the Ask box (Ctrl+K or "/"): typing a screen or an action ("stock",
 * "settings", "new invoice", "new PO") lists the screens to jump to, and a document number
 * ("PO-1042", "Q-12", "INV-5") opens that record. Pure functions, no server or browser imports:
 * the screens come from the person's own search index (src/lib/ai/search.ts → searchEntries, built
 * from the menus with their roles and features), so nothing is offered that they cannot open.
 */

// ---------------------------------------------------------------------------------------------
// Document numbers
// ---------------------------------------------------------------------------------------------

/** What people type → the prefix the app gives that document (public.assign_doc_number). */
const DOC_PREFIX: Record<string, string> = {
  q: "QT",
  qt: "QT",
  quote: "QT",
  quotation: "QT",
  po: "PO",
  lpo: "PO",
  inv: "INV",
  invoice: "INV",
  dn: "DN",
  rfq: "RFQ",
};

export type DocQuery = { prefix: string; year?: string; n: string; patterns: string[]; exact: RegExp };

/**
 * "PO-1042", "po 1042", "Q-12", "INV-2026-5" → the number patterns to search for (SQL ilike):
 * the app numbers documents PREFIX-YEAR-0001, so "PO-1042" means "PO-<any year>-1042"; older or
 * imported numbers ("PO-77") are matched as typed. null when the words are not a document number.
 */
export function docQuery(raw: string): DocQuery | null {
  const m = /^([a-z]{1,9})\s*[-#/ ]?\s*(?:(\d{4})\s*[-/ ]\s*)?(\d{1,6})$/i.exec(raw.trim());
  if (!m) return null;
  const prefix = DOC_PREFIX[m[1].toLowerCase()];
  if (!prefix) return null;
  const year = m[2];
  const digits = String(Number(m[3]));
  const n = digits.padStart(4, "0");
  const patterns = year ? [`${prefix}-${year}-${n}`] : [`${prefix}-%-${n}`, `${prefix}-${digits}`];
  const exact = new RegExp(`^${prefix}-(?:${year ?? "\\d{4}"}-0*${digits}|${year ? "(?!)" : `0*${digits}`})(?:-R\\d+)?$`, "i");
  return { prefix, year, n, patterns, exact };
}

/** Does a record's number (as the search shows it: "QT-2026-0012-R1", "RFQ-2026-0003 · Pumps") match? */
export function docMatches(q: DocQuery, shown: string): boolean {
  return q.exact.test(shown.split(" · ")[0].trim());
}

// ---------------------------------------------------------------------------------------------
// Screens and actions
// ---------------------------------------------------------------------------------------------

/** One screen the person can open (from the search index: id "page:/href"). */
export type CommandSource = { id: string; title: string; path: string[]; to: string };
export type Command = { href: string; title: string; sub: string; score: number };

/** Short words people type for longer ones. */
const ALIAS: Record<string, string[]> = {
  po: ["purchase", "order"],
  lpo: ["purchase", "order"],
  pos: ["purchase", "order"],
  add: ["new"],
  create: ["new"],
  q: ["quotation"],
  quote: ["quotation"],
  quotes: ["quotation"],
  pl: ["profit", "loss"],
  hr: ["employee"],
  grn: ["receive", "goods"],
};

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/** The query's words, short forms spelled out ("new po" → new purchase order). */
export function commandWords(q: string): string[] {
  return words(q).flatMap((w) => ALIAS[w] ?? [w]);
}

/**
 * The screens whose name answers what was typed, best first: every word typed starts a word of the
 * screen's name or its menu group (at least one in the name). An exact name scores 100, a name that
 * starts with the words 80, any other match less. At most `limit`.
 */
export function matchCommands(entries: readonly CommandSource[], q: string, limit = 5): Command[] {
  const typed = commandWords(q);
  if (typed.length === 0 || typed.length > 5 || typed.join("").length < 2) return [];
  const phrase = typed.join(" ");
  const out: Command[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.id.startsWith("page:") || !e.to || seen.has(e.to)) continue;
    const title = e.title.replace(/^\+\s*/, "");
    const tw = words(title);
    const gw = words(e.path.slice(0, -1).join(" "));
    let inTitle = 0;
    let ok = true;
    for (const w of typed) {
      if (tw.some((x) => x.startsWith(w))) inTitle++;
      else if (!gw.some((x) => x.startsWith(w))) {
        ok = false;
        break;
      }
    }
    if (!ok || inTitle === 0) continue;
    const name = tw.join(" ");
    const score = name === phrase ? 100 : name.startsWith(phrase) ? 80 : 40 + 10 * inTitle - tw.length;
    seen.add(e.to);
    out.push({ href: e.to, title, sub: e.path.slice(0, -1).join(" › "), score });
  }
  return out.sort((a, b) => b.score - a.score || a.title.length - b.title.length).slice(0, limit);
}
