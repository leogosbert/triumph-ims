/**
 * "Recently opened": the last records a person opened on this device (quotations, invoices, POs,
 * clients, products, meetings…), kept in this browser only (localStorage). Each entry holds only the
 * record's title, its kind and its address. The list belongs to one person in one company (`scope`,
 * a short fingerprint, not the ids themselves): someone else signing in on the same device sees an
 * empty list, and their first visit replaces the old one.
 *
 * Written by RecentTracker (src/components/nav/RecentTracker.tsx, in the app layout); read by the
 * Ask box (empty query) and the "Recently opened" card on My page. Every storage call is wrapped:
 * without storage the list is simply empty.
 */

export type RecentItem = { href: string; title: string; kind: string; at: number };

const KEY = "lemosp.recent.items.v1";
const MAX = 8;
/** Fired on window when the list changes (same tab; other tabs get the "storage" event). */
export const RECENT_EVENT = "lemosp:recent-items";

/** The record screens worth remembering: first part of the address → the kind shown beside the title. */
const KINDS: Record<string, string> = {
  quotations: "Quotation",
  invoices: "Invoice",
  "purchase-orders": "Purchase order",
  clients: "Client",
  suppliers: "Supplier",
  products: "Product",
  stock: "Stock",
  deliveries: "Delivery",
  meetings: "Meeting",
  rfqs: "Client RFQ",
  "supplier-rfqs": "Supplier RFQ",
  requisitions: "Purchase request",
  grns: "Goods received",
  transfers: "Stock transfer",
  bills: "Supplier bill",
  crm: "Opportunity",
  tenders: "Tender",
  contracts: "Contract",
  jobs: "Service job",
  projects: "Project",
  equipment: "Equipment",
  maintenance: "Maintenance contract",
  hire: "Hire",
  fleet: "Vehicle",
  documents: "Document",
  quality: "Quality report",
  financing: "LPO financing",
};

/** A record id in the address (the app uses UUIDs). "new", "edit", "alerts"… are not records. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The kind of record this screen shows, or null when it is not a record screen we remember. */
export function recordKind(pathname: string): string | null {
  const parts = pathname.split("?")[0].split("/").filter(Boolean);
  if (parts.length !== 2 || !ID.test(parts[1])) return null;
  return KINDS[parts[0]] ?? null;
}

function fingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

let scope = "";
/** Whose list this is (person and company); called by RecentTracker with "user:company". */
export function setRecentScope(raw: string): void {
  scope = raw ? fingerprint(raw) : "";
}

const clean = (v: unknown): RecentItem | null => {
  const x = v as Partial<RecentItem> | null;
  if (!x || typeof x.href !== "string" || typeof x.title !== "string" || typeof x.kind !== "string") return null;
  if (!x.href.startsWith("/") || x.href.startsWith("//")) return null;
  return { href: x.href.slice(0, 200), title: x.title.slice(0, 120), kind: x.kind.slice(0, 40), at: Number(x.at) || 0 };
};

/** Parses what is stored, for this scope only (pure, for tests). */
export function parseRecent(raw: string | null, forScope: string): RecentItem[] {
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (!v || typeof v !== "object" || v.s !== forScope || !Array.isArray(v.items)) return [];
    return (v.items as unknown[]).map(clean).filter((x): x is RecentItem => !!x).slice(0, MAX);
  } catch {
    return [];
  }
}

/** The list with this item first (once), at most eight (pure, for tests). */
export function addRecent(list: RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list.filter((x) => x.href !== item.href)].slice(0, MAX);
}

/** The remembered records, newest first ([] when storage is off or the list is someone else's). */
export function readRecent(): RecentItem[] {
  if (!scope) return [];
  try {
    return parseRecent(localStorage.getItem(KEY), scope);
  } catch {
    return [];
  }
}

function write(items: RecentItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ s: scope, items }));
  } catch {
    /* full or private mode: nothing is remembered */
  }
  try {
    window.dispatchEvent(new Event(RECENT_EVENT));
  } catch {
    /* no window */
  }
}

export function rememberRecent(item: Omit<RecentItem, "at">): void {
  if (!scope) return;
  const it = clean({ ...item, at: Date.now() });
  if (it && it.title.trim()) write(addRecent(readRecent(), it));
}

export function clearRecent(): void {
  if (scope) write([]);
}

/** A document number at the start of a line: QT-2026-0012, PO-2026-1042, INV-2026-0005-R1, DN-778. */
const DOC_NO = /^([A-Z]{1,5}(?:-[A-Z0-9]{1,8}){1,3})(?=$|[\s·,])/;

/** The document number in a line of text, if it starts with one that holds a digit. */
export function docNumberIn(text: string): string | null {
  const m = DOC_NO.exec(text.trim());
  return m && /\d/.test(m[1]) ? m[1] : null;
}

/**
 * A short title for the screen on show, read from the page itself: its <h1> (the client, supplier,
 * product or meeting name) with the document number from the line under the heading when there is
 * one ("QT-2026-0012 · Barrick North Mara"). "" while the heading has not arrived yet.
 */
export function pageTitle(root: ParentNode | null = typeof document === "undefined" ? null : document): string {
  const main = root?.querySelector("main") ?? root;
  const h1 = main?.querySelector("h1");
  const name = (h1?.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!name) return "";
  const head = h1?.closest(".page-head");
  const line = head?.nextElementSibling;
  const no = line && line.tagName === "P" ? docNumberIn(line.textContent ?? "") : docNumberIn(name);
  const title = no && no !== name ? `${no} · ${name}` : name;
  return title.length > 90 ? `${title.slice(0, 89)}…` : title;
}

/** Calls back with the page title once the heading is on the screen (it may stream in a little later). */
export function whenTitled(cb: (title: string, main: Element | null) => void): () => void {
  let tries = 0;
  let t: ReturnType<typeof setTimeout> | undefined;
  const look = () => {
    const main = document.querySelector("main");
    const title = pageTitle(document);
    if (title) return cb(title, main);
    if (++tries < 24) t = setTimeout(look, 250);
  };
  t = setTimeout(look, 30);
  return () => clearTimeout(t);
}
