/**
 * Reading a tender notice without AI: title, buyer, reference, closing date and the papers asked for,
 * from the text of an email, a web advert or a pasted notice. Pure functions, tested in
 * src/lib/growth-tools/__tests__. The AI reading (tenderAi.ts) gives better titles and summaries; these
 * rules are the fallback when AI is off, timed out or the daily allowance is used, and they fill gaps.
 */

import { findClosing, findDates } from "./dates";

export type TenderFields = {
  title: string | null;
  buyer: string | null;
  reference: string | null;
  category: string | null;
  location: string | null;
  summary: string | null;
  published_on: string | null;
  /** ISO timestamp with +03:00. */
  closing_at: string | null;
  documents_required: string[];
  bid_security: string | null;
};

export const EMPTY_FIELDS: TenderFields = {
  title: null,
  buyer: null,
  reference: null,
  category: null,
  location: null,
  summary: null,
  published_on: null,
  closing_at: null,
  documents_required: [],
  bid_security: null,
};

/**
 * Papers a bid may need, with the compliance checklist item that holds each one
 * (codes from src/lib/compliance/catalogue.ts / public.compliance_catalogue).
 */
export type PaperRule = { code: string; label: string; match: RegExp; when?: RegExp };
export const PAPER_RULES: PaperRule[] = [
  { code: "BRELA_INCORPORATION", label: "Certificate of incorporation", match: /(certificate of incorporation|incorporation certificate|brela|business registration|cheti cha usajili)/i },
  { code: "TRA_TIN", label: "TIN certificate", match: /(\btin\b|tax payer identification|taxpayer identification)/i },
  { code: "TRA_VAT_REGISTRATION", label: "VAT registration certificate", match: /(\bvat\b registration|\bvrn\b|vat certificate)/i },
  { code: "TRA_TAX_CLEARANCE", label: "Tax clearance certificate", match: /(tax clearance|hati ya ukaguzi wa kodi)/i },
  { code: "BUSINESS_LICENCE", label: "Business licence", match: /(business licen[cs]e|trading licen[cs]e|leseni ya biashara)/i },
  { code: "PPRA_NEST", label: "NeST supplier registration", match: /(\bnest\b|nest\.go\.tz|ppra|public procurement regulatory|e-procurement system)/i },
  { code: "POWER_OF_ATTORNEY", label: "Power of attorney for the signatory", match: /(power of attorney)/i },
  { code: "GCLA_CHEMICALS", label: "GCLA chemical dealer registration", match: /(gcla|government chemist|chemical (dealer|registration)|industrial and consumer chemicals)/i },
  { code: "EWURA_PETROLEUM", label: "EWURA licence (petroleum and lubricants)", match: /(ewura)/i },
  { code: "MINING_LOCAL_CONTENT", label: "Mining Commission local-content registration", match: /(local content|tume ya madini|mining commission)/i, when: /(mine|mining|madini|gold|barrick|geita|north mara|bulyanhulu|williamson|tanzanite|nickel|graphite)/i },
  { code: "PURA_LOCAL_CONTENT", label: "Oil & gas local-content registration (PURA)", match: /(\bpura\b|petroleum upstream|local content)/i, when: /(oil and gas|oil & gas|petroleum|lng|tpdc|upstream|pipeline|eacop)/i },
  { code: "TBS_CERTIFICATION", label: "TBS product certification", match: /(\btbs\b|tanzania bureau of standards)/i },
];

/** Which checklist papers the text asks for (codes, in PAPER_RULES order). */
export function detectPapers(text: string): PaperRule[] {
  return PAPER_RULES.filter((r) => r.match.test(text) && (!r.when || r.when.test(text)));
}

/** Text the AI or a person wrote ("Valid tax clearance") -> the checklist code, when one fits. */
export function paperCode(label: string): string | null {
  return detectPapers(label)[0]?.code ?? null;
}

const REF_RE =
  /(?:tender|bid|rfq|rfp|itb|eoi|zabuni|procurement|contract|ref(?:erence)?)\s*(?:no\.?|number|num\.?|#|ref\.?)?\s*[:.\-–]?\s*((?=[A-Z0-9/.\-]*\d)[A-Z0-9][A-Z0-9/.\-]{3,60}[A-Z0-9])/i;

/** Tender number such as "AE/001/2026-27/HQ/G/12", "GGML-LUB-014" or "PA/112/2026/G/45". */
export function findReference(text: string): string | null {
  const m = REF_RE.exec(text);
  if (!m) return null;
  const ref = m[1].replace(/[.\-/]+$/, "");
  // A plain year or date is not a reference.
  if (/^\d{4}$/.test(ref) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(ref)) return null;
  return ref.slice(0, 120);
}

function clean(s: string | null | undefined, max: number): string | null {
  if (!s) return null;
  const t = s.replace(/\s+/g, " ").replace(/^[\s:;,.\-–]+|[\s:;,\-–]+$/g, "").trim();
  return t.length >= 2 ? t.slice(0, max) : null;
}

const SUBJECT_NOISE = /^\s*((re|fw|fwd|aw|tr)\s*:\s*)+|(tender (notice|alert)|nest alert|new tender|invitation (for|to) (bids?|tender))\s*[:\-–]\s*/gi;

/** The subject or first line, without "Fwd:", "Tender notice:" and similar. */
export function cleanTitle(s: string | null | undefined): string | null {
  if (!s) return null;
  return clean(s.replace(SUBJECT_NOISE, " "), 300);
}

/** "Geita Gold Mining Ltd invites…", "Procuring Entity: TANESCO", "Buyer: …", "on behalf of …". */
export function findBuyer(text: string): string | null {
  const patterns = [
    /(?:procuring entity|purchaser|buyer|client|employer|organi[sz]ation|taasisi)\s*[:\-–]\s*([^\n]{3,120})/i,
    /(?:^|\n|\.\s+)(?:the\s+)?([A-Z][A-Za-z0-9&().,' -]{2,100}?)\s+(?:now\s+)?(?:hereby\s+)?invites?\b/,
    /on behalf of\s+(?:the\s+)?([A-Z][A-Za-z0-9&().,' -]{2,100}?)(?:[,.\n]|\s+invites?)/,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    const v = clean(m?.[1], 200);
    if (v && !/^(you|we|bidders?|eligible|interested)$/i.test(v)) return v.replace(/\s+(hereby|now)$/i, "");
  }
  return null;
}

/** "for the supply of …", "supply and delivery of …" -> a title when the subject is not helpful. */
export function findSubject(text: string): string | null {
  const m = /\b((?:the\s+)?(?:supply|provision|delivery|purchase|procurement|hire)(?:,?\s+(?:and|&)\s+(?:delivery|installation|commissioning))?\s+of\s+[^\n.;]{4,160})/i.exec(text);
  if (!m) return null;
  const t = clean(m[1].replace(/^the\s+/i, ""), 300);
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : null;
}

const SECURITY_RE = /(?:bid|tender)\s+security[^.\n]{0,40}?((?:TZS|TSH|USD|Tsh\.?|\$)\s*[\d,.]+(?:\s*(?:million|m))?|[\d,.]+\s*(?:TZS|TSH|USD|%))/i;

/** Papers listed in the notice (as written), at most 20. */
export function listPapers(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of detectPapers(text)) {
    if (seen.has(r.label)) continue;
    seen.add(r.label);
    out.push(r.label);
  }
  if (/(bid|tender) security|bank guarantee|bid bond/i.test(text)) out.push("Bid security (bank guarantee or insurance bond)");
  if (/(manufacturer'?s? authori[sz]ation|dealership certificate)/i.test(text)) out.push("Manufacturer's authorisation");
  if (/(safety data sheet|\bsds\b|\bmsds\b)/i.test(text)) out.push("Safety data sheets");
  if (/(certificate of analysis|\bcoa\b)/i.test(text)) out.push("Certificates of analysis");
  if (/(audited (financial|accounts))/i.test(text)) out.push("Audited financial statements");
  return out.slice(0, 20);
}

/** Everything the rules can read from a notice. `subject`: the email subject or advert title, if any. */
export function extractTenderRules(text: string, subject?: string | null): TenderFields {
  const body = (text ?? "").slice(0, 20000);
  const all = `${subject ?? ""}\n${body}`;
  const title = cleanTitle(subject) ?? findSubject(body) ?? cleanTitle(body.split("\n").find((l) => l.trim().length > 8) ?? null);
  const dates = findDates(all);
  const published = /(published|issued|date of (advert|invitation)|tarehe ya tangazo)/i.exec(all);
  let published_on: string | null = null;
  if (published) {
    const after = dates.find((d) => d.index > published.index && d.index - published.index < 80);
    published_on = after?.date ?? null;
  }
  const loc = /(?:delivery (?:to|at)|location|site|place of delivery|mahali)\s*[:\-–]?\s*([A-Z][^\n.;]{2,80})/i.exec(body);
  const sec = SECURITY_RE.exec(all);
  const summary = clean(body.replace(/\s+/g, " ").slice(0, 400), 400);
  return {
    title: title ? title.slice(0, 300) : null,
    buyer: findBuyer(body),
    reference: findReference(all),
    category: null,
    location: clean(loc?.[1], 160),
    summary,
    published_on,
    closing_at: findClosing(all),
    documents_required: listPapers(all),
    bid_security: clean(sec?.[1], 200),
  };
}

/** Fills the empty fields of `a` from `b` (AI first, rules second). */
export function mergeFields(a: TenderFields, b: TenderFields): TenderFields {
  return {
    title: a.title ?? b.title,
    buyer: a.buyer ?? b.buyer,
    reference: a.reference ?? b.reference,
    category: a.category ?? b.category,
    location: a.location ?? b.location,
    summary: a.summary ?? b.summary,
    published_on: a.published_on ?? b.published_on,
    closing_at: a.closing_at ?? b.closing_at,
    documents_required: a.documents_required.length ? a.documents_required : b.documents_required,
    bid_security: a.bid_security ?? b.bid_security,
  };
}
