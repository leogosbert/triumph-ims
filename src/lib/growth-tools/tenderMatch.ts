/**
 * Bid / no-bid score for a tender notice, with the reasons. Pure (tested in __tests__):
 *
 *   Fit       0-50  keywords, product categories, products and brands the company sells
 *                   (and the AI's own fit rating, when it read the notice)
 *   Time      0-20  days to the closing date
 *   Papers    0-20  the papers the notice asks for that are done on the compliance checklist
 *                   (tax clearance, business licence, NeST, GCLA, EWURA, local content ...)
 *   History   0-10  the buyer is a client, or tenders were won with them before
 *
 * Decision: bid (65+), consider (40-64), no bid (under 40, closed, or an excluded word). A missing
 * tax clearance or business licence keeps the decision at "consider" at most: get the paper first.
 */

import { daysLeft } from "./dates";
import { detectPapers, paperCode, PAPER_RULES, type TenderFields } from "./tenderText";

export type MatchContext = {
  today?: string;
  settings: { keywords: string[]; exclude_keywords: string[]; categories: string[]; buyers: string[]; min_score: number };
  product_categories: string[];
  products: { name: string; category: string | null; brand: string | null }[];
  /** Compliance checklist status by catalogue code: done, in_progress, not_started, not_applicable. */
  compliance: Record<string, string>;
  /** Catalogue codes of active licences. */
  licences: string[];
  buyers: { name: string; won: number; lost: number; bids: number }[];
  clients: string[];
};

export type Reason = { kind: "fit" | "time" | "papers" | "history" | "excluded"; ok: boolean; text: string; code?: string };

export type MatchResult = {
  score: number;
  decision: "bid" | "consider" | "no_bid";
  reasons: Reason[];
  matched: string[];
  parts: { fit: number; time: number; papers: number; history: number };
};

/** Words of 3+ letters, lower case, without accents. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

const STOP = new Set(["and", "the", "for", "with", "from", "supply", "delivery", "of", "ltd", "limited", "company", "co", "pcs", "set", "type", "size", "litre", "litres", "grade"]);

/** Does `phrase` appear in `text` (whole words; a plural "s" allowed)? */
export function hasPhrase(text: string, phrase: string): boolean {
  const p = words(phrase).filter((w) => !STOP.has(w));
  if (!p.length) return false;
  const t = ` ${words(text).join(" ")} `;
  return p.every((w) => t.includes(` ${w} `) || t.includes(` ${w}s `) || (w.endsWith("s") && t.includes(` ${w.slice(0, -1)} `)));
}

function norm(s: string) {
  return words(s).filter((w) => !STOP.has(w)).join(" ");
}

/** Same buyer? "Geita Gold Mining Ltd" ~ "GEITA GOLD MINING LIMITED" ~ "Geita Gold Mine". */
export function sameBuyer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const xs = x.split(" ");
  const ys = new Set(y.split(" "));
  const common = xs.filter((w) => ys.has(w)).length;
  return common >= 2 && common / Math.min(xs.length, ys.size) >= 0.66;
}

const CORE_PAPERS = new Set(["TRA_TAX_CLEARANCE", "BUSINESS_LICENCE"]);
const GOVERNMENT = /(ministry|wizara|authority|agency|council|halmashauri|municipal|tanesco|tanroads|tpdc|tra\b|ruwasa|dawasa|university|hospital|government|public|parastatal|wakala|mamlaka)/i;

export function scoreTender(f: TenderFields, ctx: MatchContext, opts: { aiFit?: number | null; now?: Date } = {}): MatchResult {
  const reasons: Reason[] = [];
  const matched: string[] = [];
  const text = [f.title, f.category, f.summary, f.buyer, f.location].filter(Boolean).join(" \n ");

  // ---- Excluded words ----
  const excluded = ctx.settings.exclude_keywords.find((k) => hasPhrase(text, k));

  // ---- Fit ----
  let fit = 0;
  const kw = ctx.settings.keywords.filter((k) => hasPhrase(text, k));
  kw.slice(0, 3).forEach((k) => matched.push(k));
  fit += Math.min(kw.length * 12, 30);
  const cats = Array.from(new Set([...ctx.settings.categories, ...ctx.product_categories])).filter((c) => hasPhrase(text, c));
  cats.slice(0, 3).forEach((c) => matched.includes(c) || matched.push(c));
  fit += Math.min(cats.length * 10, 20);
  const prods = ctx.products.filter((p) => hasPhrase(text, p.name) || (p.brand && hasPhrase(text, p.brand))).slice(0, 5);
  prods.slice(0, 3).forEach((p) => matched.push(p.name));
  fit += Math.min(prods.length * 8, 20);
  fit = Math.min(fit, 50);
  if (opts.aiFit != null && Number.isFinite(opts.aiFit)) {
    const ai = Math.max(0, Math.min(10, opts.aiFit)) * 5;
    fit = Math.round(fit > 0 ? (fit + ai) / 2 : ai * 0.8);
  }
  if (matched.length) reasons.push({ kind: "fit", ok: true, text: `Matches what you sell: ${matched.slice(0, 4).join(", ")}` });
  else reasons.push({ kind: "fit", ok: fit >= 20, text: fit >= 20 ? "Looks related to what you sell" : "No match with your keywords or products" });

  // ---- Time ----
  let time = 10;
  const left = daysLeft(f.closing_at, opts.now);
  let closed = false;
  if (left === null) reasons.push({ kind: "time", ok: false, text: "Closing date not found: check the advert" });
  else if (left < 0) {
    closed = true;
    time = 0;
    reasons.push({ kind: "time", ok: false, text: "Already closed" });
  } else if (left < 3) {
    time = 4;
    reasons.push({ kind: "time", ok: false, text: left === 0 ? "Closes today" : `Closes in ${left} day${left === 1 ? "" : "s"}: very little time` });
  } else if (left < 7) {
    time = 12;
    reasons.push({ kind: "time", ok: true, text: `Closes in ${left} days` });
  } else {
    time = 20;
    reasons.push({ kind: "time", ok: true, text: `Closes in ${left} days: enough time to prepare` });
  }

  // ---- Papers ----
  const asked = new Set<string>();
  const all = `${text}\n${f.documents_required.join("\n")}`;
  for (const r of detectPapers(all)) asked.add(r.code);
  for (const d of f.documents_required) {
    const c = paperCode(d);
    if (c) asked.add(c);
  }
  // Every Tanzanian tender asks for these; government buyers also for NeST.
  asked.add("TRA_TAX_CLEARANCE");
  asked.add("BUSINESS_LICENCE");
  if (f.buyer && GOVERNMENT.test(f.buyer)) asked.add("PPRA_NEST");
  let have = 0;
  let missingCore = false;
  for (const code of asked) {
    const rule = PAPER_RULES.find((r) => r.code === code);
    const label = rule?.label ?? code;
    const st = ctx.compliance[code];
    const ok = st === "done" || ctx.licences.includes(code);
    if (ok) have++;
    else {
      if (CORE_PAPERS.has(code)) missingCore = true;
      reasons.push({
        kind: "papers",
        ok: false,
        code,
        text: st === "in_progress" ? `${label}: in progress on your checklist` : st === "not_applicable" ? `${label}: marked not applicable, but this tender asks for it` : `Missing: ${label}`,
      });
    }
  }
  const papers = asked.size ? Math.round((20 * have) / asked.size) : 15;
  if (have === asked.size) reasons.push({ kind: "papers", ok: true, text: "The usual papers are ready on your checklist" });

  // ---- History ----
  let history = 0;
  const isClient = f.buyer ? ctx.clients.some((c) => sameBuyer(c, f.buyer)) : false;
  const fav = f.buyer ? ctx.settings.buyers.some((b) => sameBuyer(b, f.buyer)) : false;
  const past = f.buyer ? ctx.buyers.filter((b) => sameBuyer(b.name, f.buyer)) : [];
  const won = past.reduce((s, b) => s + b.won, 0);
  const lost = past.reduce((s, b) => s + b.lost, 0);
  if (isClient || fav) {
    history += 5;
    reasons.push({ kind: "history", ok: true, text: isClient ? "The buyer is already your client" : "A buyer you want to work with" });
  }
  if (won > 0) {
    history += 5;
    reasons.push({ kind: "history", ok: true, text: `You won ${won} tender${won === 1 ? "" : "s"} with this buyer before` });
  } else if (lost > 0) {
    history += 1;
    reasons.push({ kind: "history", ok: false, text: `You bid ${lost} time${lost === 1 ? "" : "s"} with this buyer and did not win yet` });
  }
  history = Math.min(history, 10);

  let score = Math.max(0, Math.min(100, fit + time + papers + history));
  if (excluded) {
    reasons.unshift({ kind: "excluded", ok: false, text: `Contains "${excluded}", which you do not bid for` });
    score = Math.min(score, 15);
  }
  if (fit === 0) score = Math.min(score, 35);
  let decision: MatchResult["decision"] = score >= 65 ? "bid" : score >= 40 ? "consider" : "no_bid";
  if (closed || excluded) decision = "no_bid";
  else if (decision === "bid" && missingCore) decision = "consider";
  return { score, decision, reasons: reasons.slice(0, 12), matched: matched.slice(0, 8), parts: { fit, time, papers, history } };
}

export const DECISION_LABEL: Record<MatchResult["decision"], { label: string; tone: string }> = {
  bid: { label: "Bid", tone: "ok" },
  consider: { label: "Consider", tone: "warn" },
  no_bid: { label: "No bid", tone: "off" },
};
