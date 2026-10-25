import { ACTIVITY_GUIDES, COMPLIANCE_CATALOGUE, requirement, type ActivityGuide, type Requirement } from "@/lib/compliance/catalogue";

/**
 * Compliance knowledge for the search box and the AI answers: Tanzanian legal, tax and licence
 * requirements and the "What do I need?" activity guides, read from the compliance module's
 * catalogue (src/lib/compliance/catalogue.ts, the single source of truth). This file only turns
 * them into searchable entries; it adds no legal content of its own.
 *
 * Everything here is guidance, not legal advice: answers always say to check with the authority.
 * No server or browser imports, so it can be tested on its own.
 */

export type KnowledgeItem = {
  id: string;
  kind: "requirement" | "activity";
  title: string;
  authority: string | null;
  summary: string;
  /** Papers to have or keep. */
  documents: string[];
  /** When it is due or how often. */
  when: string | null;
  penalty: string | null;
  /** What to confirm with the authority (the catalogue's verify note). */
  verify: string | null;
  /** Where it lives in the app (the compliance screens). */
  href: string;
  /** The authority's own website. */
  external: string | null;
  /** Words to match on (tags, keywords, the guide's question). */
  keywords: string[];
  /** Text matched with a lower weight. */
  body: string;
};

export const LEGAL_NOTE = "Guidance, not legal advice: check with the authority (TRA, BRELA, OSHA, NEMC, the council and others) before you act.";

const TAG_WORDS: Record<string, string> = {
  start: "start trading new company",
  tender: "tender bid nest ppra",
  bank: "bank account",
  shares: "shares shareholding shareholders",
  tax: "tax kodi",
  tra_audit: "tra audit ukaguzi",
  hire_staff: "employees staff hire wafanyakazi",
  osha_inspection: "osha inspection safety",
  import: "import customs",
  chemicals: "chemicals kemikali",
  lubricants: "lubricants oil oils grease vilainishi",
  mining: "mine mines mining mgodi migodi",
  oil_gas: "oil gas petroleum",
  industrial_clients: "industrial clients factories plants",
  premises: "premises office shop warehouse",
  vehicles: "vehicles trucks cars magari",
};

function fromRequirement(r: Requirement): KnowledgeItem {
  return {
    id: r.code,
    kind: "requirement",
    title: r.name,
    authority: r.authority,
    summary: [r.purpose, r.appliesTo === "conditional" && r.condition ? `Applies when: ${r.condition}` : ""].filter(Boolean).join(" "),
    documents: r.documentsNeeded,
    when: [r.dueRule, r.renewal].filter(Boolean).join(" ") || null,
    penalty: r.penalty || null,
    verify: r.verify ? (r.verifyNote ?? "Confirm the current rules with the authority.") : null,
    href: `/compliance#${r.code}`,
    external: r.website && /^https:\/\//.test(r.website) ? r.website : null,
    keywords: [...r.tags.flatMap((t) => (TAG_WORDS[t] ?? t).split(" ")), ...(r.keywords ?? []).flatMap((k) => k.toLowerCase().split(/\s+/)), r.authority.toLowerCase(), r.category.replace(/_/g, " ")],
    body: `${r.purpose} ${r.condition ?? ""} ${r.documentsNeeded.join(" ")} ${r.dueRule} ${r.renewal}`,
  };
}

function fromGuide(g: ActivityGuide): KnowledgeItem {
  const reqs = g.codes.map((c) => requirement(c)).filter((r): r is Requirement => !!r);
  return {
    id: g.key,
    kind: "activity",
    title: g.title,
    authority: null,
    summary: [g.summary, ...g.tips].join(" "),
    documents: reqs.map((r) => `${r.name} (${r.authority})`),
    when: null,
    penalty: null,
    verify: null,
    href: g.links[0]?.href.startsWith("/compliance") ? g.links[0].href : "/compliance",
    external: null,
    keywords: g.question
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s&]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
    body: `${g.question} ${g.summary} ${g.tips.join(" ")} ${reqs.map((r) => r.name).join(" ")}`,
  };
}

let cache: KnowledgeItem[] | null = null;

export function knowledgeItems(): KnowledgeItem[] {
  if (!cache) cache = [...ACTIVITY_GUIDES.map(fromGuide), ...COMPLIANCE_CATALOGUE.map(fromRequirement)];
  return cache;
}

// ---------------------------------------------------------------------------------------------
// Matching a question
// ---------------------------------------------------------------------------------------------

const LEGAL_WORDS =
  /\b(legal|legally|law|licen[cs]e|permit|registration|register|tax|vat|tra|brela|osha|nemc|tbs|tmda|ewura|gcla|tira|ppra|nest|nssf|wcf|paye|sdl|efd|vfd|audit|inspection|inspector|compliance|comply|certificate|clearance|documents?|papers?|returns?|due|deadline|penalt\w*|fine|directors?|shareholders?|shares|beneficial|tender|mines?|mining|local content|safety|sds|insurance|import|customs|leseni|kodi|ukaguzi|kibali|vibali|nyaraka|cheti|usajili|sheria|bima)\b/i;

/** Does the question look like a documentation, legal or tax question? */
export function isLegalQuestion(q: string): boolean {
  return LEGAL_WORDS.test(q);
}

const STOP = new Set(
  "a an and are as at be by can do does for from have how i if in is it me my need needs of on or our should the to we what when where which who why will with you your ready get kept keep about any all us this that there nini gani je ya wa na kwa ni la za cha vya katika".split(
    " ",
  ),
);

/**
 * Kiswahili words and roots → the English words the screens, guide and catalogue use, so a question in
 * Kiswahili or a mix ("nataka ku-add mteja mpya", "nyaraka za mgodi") still finds them (as in Cocozania's search).
 */
const SW_WORDS: Record<string, string> = {
  nyaraka: "documents", hati: "document", cheti: "certificate", vyeti: "certificates", leseni: "licence", kibali: "permit licence", vibali: "permit licence",
  kodi: "tax", ushuru: "tax", ukaguzi: "audit inspection", mkaguzi: "inspection", kagu: "inspection audit", sheria: "law legal", kisheria: "legal", usajili: "registration register", sajili: "register",
  mgodi: "mine mining", migodi: "mine mining", madini: "mining", vilainishi: "lubricants", mafuta: "oil lubricants fuel", kemikali: "chemicals", zabuni: "tender", serikali: "government",
  wakurugenzi: "directors", mkurugenzi: "director", hisa: "shares", wanahisa: "shareholders", bima: "insurance", moto: "fire", usalama: "safety", afya: "health", mazingira: "environment",
  risiti: "receipt", stakabadhi: "receipt", ankara: "invoice bill", nukuu: "quotation", matumizi: "expense", gharama: "expense cost", mshahara: "payroll salary", mishahara: "payroll salary",
  mteja: "client", wateja: "clients", msambazaji: "supplier", wasambazaji: "suppliers", bidhaa: "product", stoku: "stock", stoki: "stock", ghala: "store warehouse", deni: "owed", madeni: "owed",
  mauzo: "sales", uza: "sell sales", nunu: "purchase", agiz: "order", oda: "order", malipo: "payment", lipa: "pay", faida: "profit", ripoti: "report", mfanyakazi: "employee", wafanyakazi: "employees",
  likizo: "leave", gari: "vehicle", magari: "vehicles", dereva: "driver delivery", usafirishaji: "delivery", mkataba: "contract", mikataba: "contracts", ongez: "add new", weka: "add record", rekodi: "record",
  andik: "write record", tuma: "send", badil: "change edit", futa: "delete", tafut: "search find", mpya: "new", mwezi: "month", leo: "today",
};
const SW_ROOTS = Object.keys(SW_WORDS).sort((a, b) => b.length - a.length);

export function words(q: string): string[] {
  const base = q
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  const out = [...base];
  for (const w of base) {
    const hit = SW_WORDS[w] ?? SW_WORDS[SW_ROOTS.find((r) => r.length >= 4 && w.includes(r)) ?? ""];
    if (hit) out.push(...hit.split(" "));
  }
  return [...new Set(out)];
}

/** The best entries for a question, best first. Activity guides win ties (they answer "what do I need to…"). */
export function searchKnowledge(q: string, limit = 4): { item: KnowledgeItem; score: number }[] {
  const ws = words(q);
  if (!ws.length) return [];
  const scored = knowledgeItems().map((item) => {
    const title = item.title.toLowerCase();
    const body = item.body.toLowerCase();
    let score = 0;
    for (const w of ws) {
      const stem = w.length > 4 ? w.replace(/(ies|es|s)$/, "") : w;
      if (title.includes(stem)) score += 3;
      if (item.keywords.some((k) => k === w || (stem.length >= 3 && k.startsWith(stem)))) score += 3;
      else if (body.includes(stem)) score += 1;
    }
    if (item.kind === "activity" && score >= 6) score += 3;
    return { item, score };
  });
  return scored
    .filter((s) => s.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
