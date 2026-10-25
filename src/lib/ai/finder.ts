/**
 * The super search's brain, as in Cocozania's Tafuta (src/lib/finder.ts there): it understands English,
 * Kiswahili and a mix of both ("nataka ku-add mteja mpya"), forgives one spelling slip per word, ranks
 * screens, App guide topics, compliance requirements and playbooks by how much of the question they
 * answer (rare words count most), and says plainly when the app does not do something yet, with what
 * to do instead.
 *
 * Pure functions over a list of entries: no server or browser imports. The server builds the entries
 * a person may see (src/lib/ai/search.ts → searchEntries) and the Ask box ranks them in the browser,
 * so matches appear as you type and still work offline once loaded.
 */

export type Lang = "en" | "sw" | "mix";

export type FinderEntry = {
  id: string;
  kind: "howto" | "page" | "rule" | "guide" | "missing";
  /** In the person's screen language. */
  title: string;
  /** The same title in the other language, when there is one. */
  alt?: string;
  /** Breadcrumb, e.g. ["Money", "Expenses"]. */
  path: string[];
  /** The screen to open ("" for missing features). */
  to: string;
  /** A guide page to read, when it is not the screen itself. */
  page?: string;
  steps: string[];
  /** Extra words people use for it (both languages). */
  words: string;
  /** Missing features: why, and what to do instead. */
  why?: string;
  instead?: { text: string; to?: string }[];
  /** Compliance requirement code (the card shows whether the company has it in place). */
  code?: string;
};

export type FinderHit = { e: FinderEntry; score: number; cover: number };
export type FinderResult = { lang: Lang; understood: string[]; best?: FinderHit; missing?: FinderHit; others: FinderHit[]; confident: boolean };

// ---------------------------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------------------------

/** Kiswahili words and roots → the English words the index uses. Roots match with ku-/na-/ni-/ta-/me- in front and -a/-e/-isha/-wa after. */
const SW: Record<string, string> = {
  // doing words
  uza: "sell sale", mauzo: "sales sale", nunu: "buy purchase", manunuzi: "purchase buy", agiz: "order purchase", oda: "order",
  ongez: "add", weka: "add set record", wek: "add set record", sajili: "add register", ingiz: "add enter import", anzish: "add create start", tengenez: "make create",
  futa: "delete", fut: "delete", ondo: "remove delete", badil: "change edit", rekebish: "change edit fix", hariri: "edit change",
  tuma: "send", tum: "send", chapish: "print publish", printi: "print", angali: "view", tazam: "view", ona: "view", onyesh: "show view",
  tafut: "search find", hesabu: "count accounts", lipa: "pay", lipe: "pay", lipw: "pay paid", malipo: "payment pay", pokea: "receive", poke: "receive",
  rudish: "return refund", rejesh: "return refund", funga: "close", fung: "close", fungua: "open", anza: "start",
  kagu: "inspection audit check", ukaguzi: "inspection audit", pima: "test measure", fuatili: "track follow", kumbush: "remind reminder", idhinish: "approve", kubali: "approve accept",
  kataa: "reject", pang: "plan schedule", hamish: "transfer move", pelek: "deliver delivery", safirish: "deliver delivery", hifadhi: "save backup", pakua: "download export", paku: "download",
  pakia: "upload import", ingia: "sign login", jifunz: "learn training", ajiri: "hire employee", simamish: "stop pause",
  jibu: "reply answer", omba: "request", toa: "issue give", pandish: "raise increase", pungu: "reduce discount", thibitish: "confirm approve", rekodi: "record add", andik: "write record", jaz: "fill", chagu: "choose",
  hitaj: "need required", mahitaji: "required need",
  // things
  bidhaa: "product", mzigo: "stock goods", stoki: "stock", stoku: "stock", akiba: "stock", ghala: "store warehouse stock", stoo: "store stock", bei: "price", punguzo: "discount",
  mteja: "client", wateja: "client clients", msambazaji: "supplier", wasambazaji: "supplier suppliers", mgavi: "supplier", mfanyakazi: "employee staff", wafanyakazi: "employee staff",
  wafanyikazi: "employee staff", mtumishi: "employee staff", watumishi: "employee staff", kibarua: "casual worker",
  dereva: "driver delivery", madereva: "driver drivers", usafirishaji: "delivery transport", gari: "vehicle", magari: "vehicle vehicles",
  mshahara: "salary payroll", mishahara: "salary payroll", likizo: "leave", mahudhurio: "attendance", posho: "allowance", mkopo: "loan advance",
  ankara: "invoice", bili: "bill", risiti: "receipt", stakabadhi: "receipt", nukuu: "quotation quote", kotesheni: "quotation quote", deni: "owe owed debt", madeni: "owe owed debt", mdaiwa: "debtor owe",
  gharama: "expense cost", matumizi: "expense spending", kodi: "tax rent", ushuru: "tax duty", faida: "profit", hasara: "loss", mapato: "income revenue", benki: "bank",
  pesa: "money cash", fedha: "money finance", hela: "money cash", taslimu: "cash", bajeti: "budget", mali: "assets", ripoti: "report", taarifa: "report notification", takwimu: "analytics statistics",
  mafuta: "oil lubricants fuel", vilainishi: "lubricants", kemikali: "chemicals", madini: "mining mine", mgodi: "mine mining", migodi: "mine mining", zabuni: "tender", serikali: "government",
  ubora: "quality", usalama: "safety", afya: "health", mazingira: "environment", ajali: "accident incident", hatari: "hazard risk", moto: "fire", zimamoto: "fire",
  mafunzo: "training", mkataba: "contract", mikataba: "contract contracts", sheria: "law legal", kisheria: "legal", halali: "legal", nyaraka: "documents document", hati: "document",
  cheti: "certificate", vyeti: "certificate certificates", leseni: "licence", kibali: "permit licence", vibali: "permit licence", usajili: "registration register",
  mkurugenzi: "director", wakurugenzi: "directors director", hisa: "shares", wanahisa: "shareholders", bima: "insurance", mkaguzi: "inspector inspection", wakaguzi: "inspector inspection",
  mtumiaji: "user", watumiaji: "users user", nenosiri: "password", siri: "password", akaunti: "account", ruhusa: "access permission role", lugha: "language",
  simu: "phone", ujumbe: "message", barua: "letter email", pepe: "email", maoni: "suggestion feedback", malalamiko: "complaint", wazo: "idea suggestion", mawazo: "idea suggestion",
  tawi: "branch", matawi: "branch branches", nchi: "country", nje: "import abroad", dola: "dollar usd", kazi: "job work task", mradi: "project", miradi: "project projects",
  mashine: "equipment machine", mitambo: "equipment machine", vifaa: "equipment", matengenezo: "maintenance service", huduma: "service",
  leo: "today", jana: "yesterday", kesho: "tomorrow", wiki: "week", mwezi: "month", mwaka: "year", siku: "day", mpya: "new", zote: "all", yote: "all", jina: "name", kampuni: "company",
  orodha: "list", kila: "every", hali: "status", muhtasari: "summary overview",
};
/** Words that carry no meaning for the search, in both languages. */
const SW_STOP = new Set(
  "nataka ninataka natafuta naomba nifanyeje tufanyeje nawezaje ninawezaje naweza tunaweza unaweza wanataka unataka tunataka anataka ninaomba tunaomba jinsi namna gani zipi ipi vipi wapi nini kwa ya wa la za cha vya kwenye katika hii huyu hiyo hizi hapa sasa tafadhali mimi sisi wangu yangu langu zangu changu je au pia tu kama kuhusu ili kisha halafu na nina tuna kuna iko ipo yetu wetu letu huu hiki hili hawa".split(
    " ",
  ),
);
const EN_STOP = new Set(
  "how do does did i we you to the a an my our me us can could where what which who is are was were be in on of for with and or please want wanna need needs should would it its this that these those there here way ways im let get some any from into by at as about then also just so like".split(
    " ",
  ),
);
/** English words that mean the same thing for the search. */
const EN: Record<string, string> = {
  remove: "delete", erase: "delete", cancel: "delete cancel", edit: "change", modify: "change", update: "change", amend: "change", correct: "change",
  create: "add", new: "add", register: "add", enter: "add", insert: "add", put: "add", record: "add record", log: "add record",
  staff: "employee", worker: "employee", workers: "employee", employees: "employee", personnel: "employee", customer: "client", customers: "client", buyer: "client", buyers: "client",
  vendor: "supplier", vendors: "supplier", item: "product", items: "product", goods: "product", inventory: "stock", stocks: "stock", wages: "salary", payslip: "payroll", salaries: "salary",
  sold: "sell sale", selling: "sell sale", sales: "sale sell", purchases: "purchase", buying: "buy purchase", bought: "buy purchase", invoices: "invoice", receipts: "receipt", bills: "bill",
  pay: "pay payroll payment", print: "print pdf", printing: "print pdf", pdf: "pdf print", payroll: "payroll pay salary", paye: "paye tax payroll",
  excel: "export excel", spreadsheet: "export excel import", share: "share send", email: "email send", whatsapp: "whatsapp send",
  see: "view", show: "view", look: "view", find: "search", monitor: "track", login: "sign", license: "licence", licenses: "licence", licences: "licence", permit: "permit licence",
  quote: "quotation", quotes: "quotation", quotations: "quotation", po: "purchase order", rfq: "rfq request quotation", lpo: "purchase order",
  approval: "approve", approvals: "approve", owe: "owe owed", owes: "owe owed", owing: "owe owed", debt: "owe owed", debtors: "owe owed", receivables: "owe owed",
  boss: "manager", manager: "manager", truck: "vehicle", trucks: "vehicle", car: "vehicle", cars: "vehicle", lorry: "vehicle", warehouse: "store", warehouses: "store", godown: "store",
};
const FILL = new Set(["ku", "ni", "na", "u", "a", "tu", "m", "wa", "ki", "vi", "li", "ya", "i", "zi"]);
const PRE = /^(ku|ni|u|a|tu|m|wa|ki|vi|li|ya|i|zi)?(na|li|ta|me|ki|ka|si|ja|nge)?(ni|ku|m|wa|ki|vi|i|zi|li|ya|tu)?$/;
const SUF = /^(a|e|i|o|u|ia|ie|iwe|eni|ieni|ea|wa|sha|isha|esha|ika|eka|iwa|ewa|ana|ishwa|eshwa|iana|ni|je)?$/;
/** Short words that are only themselves, never part of a longer word. */
const EXACT = new Set(["mali", "hati", "moto", "bei", "oda", "leo", "siku", "wiki", "nje", "toa", "ona", "hali"]);
const ROOTS = Object.keys(SW)
  .filter((r) => !EXACT.has(r))
  .sort((a, b) => b.length - a.length);
const KU_EN = /^(print|add|edit|delete|export|share|post|scan|upload|download|update|check|send|save|order|login|sign|pay|book|approve|import|record|search)/;

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9&\s-]/g, " ")
    .replace(/-/g, " ");
const stem = (w: string) =>
  w.length > 5 && w.endsWith("ing")
    ? w.slice(0, -3)
    : w.length > 4 && w.endsWith("ies")
      ? w.slice(0, -3) + "y"
      : w.length > 4 && w.endsWith("ed")
        ? w.slice(0, -2)
        : w.length > 3 && w.endsWith("s") && !w.endsWith("ss")
          ? w.slice(0, -1)
          : w;

/** A Kiswahili word to English, with its prefixes and endings taken off. */
function swahili(w: string): string | null {
  if (SW[w]) return SW[w];
  for (const r of ROOTS) {
    if (r.length < 3) continue;
    const i = w.indexOf(r);
    if (i < 0) continue;
    if (PRE.test(w.slice(0, i)) && SUF.test(w.slice(i + r.length))) return SW[r];
  }
  return null;
}

/**
 * The query as English words for the index, and which language it was written in. `groups` keeps the
 * alternatives of each typed word together ("rekodi" → add or record): a group counts once, matched
 * by any of its words.
 */
export function understand(q: string): { words: string[]; groups: string[][]; lang: Lang } {
  const raw = fold(q).split(/\s+/).filter(Boolean);
  const groups: string[][] = [];
  let sw = 0,
    en = 0;
  const push = (g: string[]) => {
    const clean = [...new Set(g.filter((w) => w.length > 1))];
    if (clean.length) groups.push(clean);
  };
  for (let w of raw) {
    if (FILL.has(w)) continue;
    // "ku-print", "kuadd": a Kiswahili ku- in front of an English word
    if (/^ku[a-z]{3,}$/.test(w) && !swahili(w) && (EN[w.slice(2)] || KU_EN.test(w.slice(2)))) w = w.slice(2);
    if (SW_STOP.has(w)) {
      sw++;
      continue;
    }
    if (EN_STOP.has(w)) {
      en++;
      continue;
    }
    const s = /^(sale|stock|oil|post)$/.test(w) ? null : swahili(w);
    if (s) {
      sw++;
      push(s.split(" ").flatMap((x) => (EN[x] ?? x).split(" ")));
      continue;
    }
    en++;
    const e = EN[w] ?? EN[stem(w)];
    push(e ? e.split(" ") : [stem(w)]);
  }
  const lang: Lang = sw && en ? (sw >= en * 2 ? "sw" : en >= sw * 3 ? "en" : "mix") : sw ? "sw" : "en";
  return { words: [...new Set(groups.flat())], groups, lang };
}

/** One spelling slip apart (a letter missing, extra, changed, or two swapped). */
export function near(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1 || a[0] !== b[0]) return false;
  let i = 0,
    j = 0,
    d = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++d > 1) return false;
    if (a[i + 1] === b[j] && a[i] === b[j + 1]) {
      i += 2;
      j += 2;
      continue;
    }
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return d + (a.length - i) + (b.length - j) <= 1;
}

// ---------------------------------------------------------------------------------------------
// Index and ranking
// ---------------------------------------------------------------------------------------------

type Doc = { e: FinderEntry; f: Map<string, number>; name: Set<string> };
export type FinderIndex = { docs: Doc[]; df: Map<string, number>; vocab: string[] };

const toks = (s: string) => understand(s).words;

export function buildIndex(entries: FinderEntry[]): FinderIndex {
  const df = new Map<string, number>();
  const docs = entries.map((e) => {
    const f = new Map<string, number>();
    const put = (s: string, w: number) => {
      for (const t of toks(s)) f.set(t, Math.max(f.get(t) ?? 0, w));
    };
    // Guide steps are long sentences: they count least; the name counts most.
    put(e.steps.join(" "), 0.6);
    put(e.path.join(" "), 2);
    put(e.words, 2.5);
    if (e.alt) put(e.alt, 3);
    put(e.title, 4);
    for (const t of f.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    return { e, f, name: new Set(toks(`${e.title} ${e.alt ?? ""}`)) };
  });
  return { docs, df, vocab: [...df.keys()] };
}

const KIND_BOOST: Record<FinderEntry["kind"], number> = { howto: 1.15, rule: 1.1, missing: 1.1, guide: 1.05, page: 1 };

/** Finds what the person is looking for. */
export function rank(index: FinderIndex, q: string): FinderResult {
  const { groups, lang } = understand(q);
  if (!groups.length) return { lang, understood: [], others: [], confident: false };
  const N = index.docs.length || 1;
  const idf = (w: string) => Math.log(1 + N / (index.df.get(w) ?? 1));
  // spelling slips: a word the index does not know becomes the closest one it does
  const terms = groups.map((g) =>
    g.map((w) => {
      if (index.df.has(w) || w.length < 4) return { w, k: 1 };
      const fix = index.vocab.find((v) => near(w, v));
      return fix ? { w: fix, k: 0.8 } : { w, k: 1 };
    }),
  );
  // each typed word weighs as its most telling alternative
  const weight = terms.map((g) => Math.max(...g.map((t) => idf(t.w))));
  const all = weight.reduce((a, b) => a + b, 0);
  const hits: FinderHit[] = [];
  for (const { e, f, name } of index.docs) {
    let score = 0,
      got = 0,
      inName = 0,
      nameHits = 0;
    terms.forEach((g, gi) => {
      let best = 0,
        bestIdf = 0,
        named = false;
      for (const { w, k } of g) {
        const x = f.get(w);
        if (x && x * k * idf(w) > best) {
          best = x * k * idf(w);
          bestIdf = idf(w);
        }
        if (name.has(w)) named = true;
      }
      if (!best) return;
      score += best;
      got += Math.min(bestIdf, weight[gi]);
      if (named) {
        inName += weight[gi];
        nameHits++;
      }
    });
    if (score <= 0) continue;
    // how much of the question this answers, the rare words counting most
    const cover = all ? got / all : 0;
    // an answer whose own name says what was asked beats one that only mentions it; a short exact name beats a longer one
    const named = 1 + (all ? (0.8 * inName) / all : 0) + (name.size ? (0.15 * nameHits) / name.size : 0);
    hits.push({ e, score: score * (0.4 + cover) * KIND_BOOST[e.kind] * named, cover });
  }
  hits.sort((a, b) => b.score - a.score);
  const avail = hits.filter((h) => h.e.kind !== "missing");
  const miss = hits.find((h) => h.e.kind === "missing");
  const top = avail[0];
  const missing = miss && miss.cover >= 0.6 && (!top || miss.score >= top.score) ? miss : undefined;
  const confident = !!top && top.cover >= 0.5 && !missing;
  return {
    lang,
    understood: [...new Set(terms.map((g) => g[0].w))],
    best: missing && (!top || miss!.score > top.score) ? undefined : top,
    missing,
    others: avail.slice(missing || !confident ? 0 : 1, 7),
    confident,
  };
}

/** Looks like a question to answer (not a screen to open): Enter asks instead of jumping. */
export function isQuestion(q: string): boolean {
  const s = q.trim().toLowerCase();
  return (
    /\?$/.test(s) ||
    /^(how|what|which|who|when|where|why|is|are|do|does|can|should|nini|je|vipi|wapi|lini|nani|kwa nini|nifanyeje|nawezaje|ni)\b/.test(s) ||
    s.split(/\s+/).length >= 6
  );
}

// ---------------------------------------------------------------------------------------------
// What LeMoSp does not do (yet), and what to do instead. English keys (translated on the server).
// ---------------------------------------------------------------------------------------------

export type MissingFeature = { title: string; words: string; why: string; instead: { text: string; to?: string }[] };

export const MISSING: MissingFeature[] = [
  {
    title: "Issuing TRA fiscal receipts (VFD or EFD) from the app",
    words: "issue fiscal receipt vfd efd tra receipt machine print receipt for client z report risiti ya tra mashine ya efd",
    why: "LeMoSp makes invoices but is not connected to a TRA fiscal device or VFD provider, so it cannot issue the fiscal receipt itself.",
    instead: [
      { text: "Make the invoice in LeMoSp", to: "/invoices" },
      { text: "Issue the fiscal receipt on your EFD machine or VFD app, then attach it to the invoice's documents", to: "/documents" },
      { text: "Ask LeMo Tech to connect a VFD provider" },
    ],
  },
  {
    title: "Filing tax returns straight into the TRA system",
    words: "file return directly tra portal online efiling e filing submit vat return automatically send to tra wasilisha ritani",
    why: "TRA has no open connection for outside apps; returns are filed on the TRA portal.",
    instead: [
      { text: "See every filing and its due date", to: "/compliance/calendar" },
      { text: "Get the figures from Reports and Profit & loss", to: "/reports" },
      { text: "Mark the filing done with the acknowledgement number", to: "/compliance/calendar" },
    ],
  },
  {
    title: "Collecting payments online with a payment link or card",
    words: "payment link pay online card payment checkout collect money online mpesa push stk lipa kwa kadi kiungo cha malipo",
    why: "LeMoSp records payments by bank, cheque and mobile money but does not collect money itself.",
    instead: [
      { text: "Send the invoice with your bank and Lipa number on it", to: "/invoices" },
      { text: "Record the payment when it arrives", to: "/payments" },
      { text: "Ask LeMo Tech to connect a payment provider" },
    ],
  },
  {
    title: "Bulk SMS to all clients",
    words: "bulk sms broadcast message all clients mass message send everyone sms campaign ujumbe mfupi kwa wateja wote",
    why: "Messages go one by one by email or WhatsApp so each is checked by a person.",
    instead: [
      { text: "Send statements and reminders from Money owed to us", to: "/receivables" },
      { text: "Use the Inbox for client emails", to: "/inbox" },
      { text: "Ask LeMo Tech to connect an SMS provider" },
    ],
  },
  {
    title: "A portal where clients or suppliers sign in",
    words: "client portal supplier portal customers log in see their invoices suppliers sign in see orders",
    why: "Only your team signs in. Clients and suppliers get documents as PDF by email or WhatsApp.",
    instead: [
      { text: "Share quotations and invoices as PDF", to: "/quotations" },
      { text: "Send purchase orders to suppliers by email or WhatsApp", to: "/purchase-orders" },
    ],
  },
  {
    title: "The app in the Play Store or App Store",
    words: "play store app store download app android iphone install from store",
    why: "LeMoSp installs straight from the browser instead, without a store.",
    instead: [{ text: "Open LeMoSp in Chrome or Safari on the phone and choose Add to Home screen or Install", to: "/help" }],
  },
  {
    title: "A shop till (point of sale) for walk-in customers",
    words: "pos point of sale till cash register walk in customer shop counter scan and sell duka",
    why: "LeMoSp is built for supplying companies: quotations, orders, deliveries and invoices.",
    instead: [
      { text: "Make an invoice for the sale", to: "/invoices/new" },
      { text: "Record the payment straight away", to: "/payments" },
    ],
  },
];

/** The examples shown before anything is typed (English keys; a mix of English and Kiswahili, as people ask). */
export const FINDER_EXAMPLES = [
  "Who owes us money?",
  "What documents do I need to supply lubricants to a mine?",
  "Nataka kuongeza mteja mpya",
  "When is VAT due?",
  "Nifanyeje ku-print invoice",
  "What should we reorder?",
  "mauzo ya mwezi huu",
];
