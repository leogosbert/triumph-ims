/**
 * Tender adverts on a public web page or RSS/Atom feed -> a short list of items (title, link, text).
 * Pure (no network; the fetch is in fetchSource.ts), tested in __tests__. Conservative on purpose:
 * only rows and links that look like tenders are kept, at most 40 per page.
 */

export type ListingItem = { title: string; url: string | null; text: string; published: string | null };

const MAX_ITEMS = 40;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** HTML -> plain text (scripts, styles and tags removed; block tags become new lines). */
export function htmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/td|\/th)\b[^>]*>/gi, (t) => (/^<\/t[dh]/i.test(t) ? " | " : "\n"))
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n[ \n]*/g, "\n")
    .trim();
}

const TENDERISH =
  /(tender|zabuni|rfq|rfp|request for (quotation|proposal)|invitation (for|to) (bid|tender)|expression of interest|\beoi\b|procurement|supply (and delivery )?of|bid\b|ununuzi|manunuzi)/i;

export function looksLikeTender(s: string): boolean {
  return TENDERISH.test(s);
}

/** A link on the page made absolute (http/https only). */
export function absoluteUrl(href: string | null | undefined, base: string): string | null {
  if (!href) return null;
  const h = decodeEntities(href.trim());
  if (!h || /^(javascript|mailto|tel|data):/i.test(h) || h.startsWith("#")) return null;
  try {
    const u = new URL(h, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString().slice(0, 600);
  } catch {
    return null;
  }
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block);
  return m ? htmlText(m[1]) : null;
}

function isoDay(s: string | null): string | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

function push(out: ListingItem[], seen: Set<string>, item: ListingItem) {
  const title = item.title.replace(/\s+/g, " ").trim().slice(0, 300);
  if (title.length < 8) return;
  const key = (item.url ?? title).toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ ...item, title, text: item.text.slice(0, 4000) });
}

/** RSS 2.0 <item> or Atom <entry>. */
export function parseFeed(xml: string, base: string): ListingItem[] {
  const out: ListingItem[] = [];
  const seen = new Set<string>();
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  for (const b of blocks) {
    if (out.length >= MAX_ITEMS) break;
    const title = tag(b, "title") ?? "";
    let link = tag(b, "link");
    if (!link) {
      const atom = /<link\b[^>]*href=["']([^"']+)["']/i.exec(b);
      link = atom ? atom[1] : null;
    }
    const text = tag(b, "description") ?? tag(b, "summary") ?? tag(b, "content") ?? tag(b, "content:encoded") ?? "";
    const published = isoDay(tag(b, "pubDate") ?? tag(b, "published") ?? tag(b, "updated") ?? tag(b, "dc:date"));
    if (!looksLikeTender(`${title}\n${text}`)) continue;
    push(out, seen, { title, url: absoluteUrl(link, base), text: `${title}\n${text}`.trim(), published });
  }
  return out;
}

/** An HTML page: table rows that look like tenders first (they usually hold the closing date), then links. */
export function parseHtmlListing(html: string, base: string): ListingItem[] {
  const out: ListingItem[] = [];
  const seen = new Set<string>();
  const body = html.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ");
  const rows = body.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  for (const r of rows) {
    if (out.length >= MAX_ITEMS) break;
    if (/<th\b/i.test(r) && !/<td\b/i.test(r)) continue;
    const text = htmlText(r).replace(/\s*\|\s*$/, "");
    if (!looksLikeTender(text) && !/\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(text)) continue;
    const a = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(r);
    const cells = text.split("|").map((c) => c.trim()).filter(Boolean);
    const longest = cells.reduce((x, c) => (c.length > x.length ? c : x), "");
    const title = (a && htmlText(a[2]).length >= 12 ? htmlText(a[2]) : longest) || text;
    if (!looksLikeTender(text) && !looksLikeTender(title)) continue;
    push(out, seen, { title, url: absoluteUrl(a?.[1], base), text, published: null });
  }
  const links = body.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi) ?? [];
  for (const l of links) {
    if (out.length >= MAX_ITEMS) break;
    const m = /href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i.exec(l);
    if (!m) continue;
    const title = htmlText(m[2]);
    if (title.length < 15 || !looksLikeTender(title)) continue;
    // Menu items such as "Tenders" or "Procurement notices" are not adverts.
    if (/^(tenders?|zabuni|procurement( notices?)?|all tenders|tender notices|bids?|rfqs?)$/i.test(title.trim())) continue;
    push(out, seen, { title, url: absoluteUrl(m[1], base), text: title, published: null });
  }
  return out;
}

/** Feed or page, decided by the content. */
export function parseTenderListing(content: string, base: string, kind: "page" | "rss" = "page"): ListingItem[] {
  const head = content.slice(0, 600).toLowerCase();
  const isFeed = kind === "rss" || /<rss\b|<feed\b|<rdf:rdf\b/.test(head);
  return isFeed ? parseFeed(content, base) : parseHtmlListing(content, base);
}
