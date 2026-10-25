/**
 * Email text helpers (pure functions).
 *
 * sanitizeEmailHtml keeps simple formatting (paragraphs, bold, lists, tables, links) and drops
 * everything that can run code, load something from the internet or submit a form. It is the first
 * guard only: the app also shows the HTML inside a sandboxed frame with no scripts and a
 * Content-Security-Policy that blocks every network request (see HtmlFrame.tsx), so remote
 * images and tracking pixels never load.
 */

const DROP_WITH_CONTENT = [
  "script", "style", "head", "title", "iframe", "frame", "frameset", "object", "embed", "applet", "noscript",
  "template", "svg", "math", "textarea", "select", "button", "form", "audio", "video", "canvas", "xml",
];

const KEEP_TAGS = new Set([
  "a", "b", "strong", "i", "em", "u", "s", "strike", "del", "ins", "small", "big", "sub", "sup", "mark", "span", "font",
  "p", "div", "br", "hr", "blockquote", "pre", "code", "center",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption", "colgroup", "col",
  "img",
]);

const KEEP_ATTRS = new Set([
  "href", "src", "alt", "title", "width", "height", "align", "valign", "colspan", "rowspan", "style",
  "border", "cellpadding", "cellspacing", "bgcolor", "color", "face", "size", "dir", "lang",
]);

const VOID_TAGS = new Set(["br", "hr", "img", "col"]);

function escAttr(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&amp;/gi, "&");
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/** A link target is kept only for http(s), mailto and tel. */
function safeHref(v: string): string | null {
  const plain = decodeEntities(v).replace(/[\u0000- \u007f-\u009f]/g, "").toLowerCase();
  if (/^(https?:|mailto:|tel:)/.test(plain)) return v.trim();
  return null;
}

/** Images only from inside the email (cid:) or embedded data images. */
function safeSrc(v: string): string | null {
  const plain = decodeEntities(v).replace(/\s/g, "").toLowerCase();
  if (plain.startsWith("cid:")) return v.trim();
  if (/^data:image\/(png|jpe?g|gif|webp);base64,/.test(plain)) return v.trim();
  return null;
}

function safeStyle(v: string): string | null {
  const plain = decodeEntities(v).toLowerCase().replace(/\s|\\/g, "");
  if (/expression\(|url\(|javascript:|behavior:|-moz-binding|@import|position:(fixed|absolute)/.test(plain)) return null;
  return v.replace(/[<>]/g, "");
}

function cleanAttributes(tag: string, raw: string): string {
  const out: string[] = [];
  const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    if (!KEEP_ATTRS.has(name)) continue; // drops on*, srcset, formaction, xmlns, ...
    let v: string | null = value;
    if (name === "href") v = tag === "a" ? safeHref(value) : null;
    else if (name === "src") v = tag === "img" ? safeSrc(value) : null;
    else if (name === "style") v = safeStyle(value);
    if (v === null) continue;
    out.push(`${name}="${escAttr(decodeEntities(v))}"`);
  }
  if (tag === "a") out.push('target="_blank"', 'rel="noopener noreferrer nofollow"');
  return out.length ? ` ${out.join(" ")}` : "";
}

/** Cleans email HTML (see the note at the top). Returns "" when nothing useful is left. */
export function sanitizeEmailHtml(html: string | null | undefined, maxLength = 500_000): string {
  if (!html) return "";
  let s = html.slice(0, maxLength * 2);
  s = s.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<![^>]*>/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  for (const t of DROP_WITH_CONTENT) {
    s = s.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}\\s*>`, "gi"), "");
    s = s.replace(new RegExp(`<\\/?${t}\\b[^>]*>`, "gi"), ""); // unclosed or stray
  }
  // Rebuild: kept tags with clean attributes; everything between tags is text with < and > escaped.
  const out: string[] = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const text = (t: string) => t.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  while ((m = tagRe.exec(s))) {
    out.push(text(s.slice(last, m.index)));
    last = tagRe.lastIndex;
    const tag = m[2].toLowerCase();
    if (!KEEP_TAGS.has(tag)) continue;
    if (m[1]) {
      if (!VOID_TAGS.has(tag)) out.push(`</${tag}>`);
    } else out.push(`<${tag}${cleanAttributes(tag, m[3])}>`);
  }
  out.push(text(s.slice(last)));
  s = out.join("");
  s = s.trim();
  return s.length > maxLength ? "" : s;
}

/** Plain text from HTML, for emails that come without a text part. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  let s = html;
  for (const t of ["script", "style", "head", "title"]) s = s.replace(new RegExp(`<${t}\\b[\\s\\S]*?<\\/${t}\\s*>`, "gi"), "");
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li|blockquote|table)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(s)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "Asha <asha@x.co.tz>" -> { address: "asha@x.co.tz", name: "Asha" } */
export function parseAddress(v: string | null | undefined): { address: string; name: string | null } | null {
  if (!v) return null;
  const m = /^\s*"?([^"<]*?)"?\s*<([^<>]+)>\s*$/.exec(v);
  const address = (m ? m[2] : v).trim().toLowerCase();
  if (!/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(address)) return null;
  const name = m && m[1].trim() ? m[1].trim() : null;
  return { address, name };
}

/** A header or array of addresses -> clean list (max 50). Splits "a@x, B <b@y>" on commas outside quotes. */
export function addressList(v: unknown): string[] {
  const parts: string[] = [];
  const push = (s: string) => {
    for (const piece of s.match(/(?:"[^"]*"|[^,])+/g) ?? []) {
      const a = parseAddress(piece);
      if (a) parts.push(a.address);
    }
  };
  if (Array.isArray(v)) {
    for (const x of v) {
      if (typeof x === "string") push(x);
      else if (x && typeof x === "object" && typeof (x as { email?: unknown }).email === "string") push((x as { email: string }).email);
      else if (x && typeof x === "object" && typeof (x as { address?: unknown }).address === "string") push((x as { address: string }).address);
    }
  } else if (typeof v === "string") push(v);
  return [...new Set(parts)].slice(0, 50);
}

/** Message-ID lists in References: "<a@x> <b@y>" -> ["<a@x>", "<b@y>"]. */
export function messageIds(v: unknown): string[] {
  const text = Array.isArray(v) ? v.filter((x) => typeof x === "string").join(" ") : typeof v === "string" ? v : "";
  return [...new Set(text.match(/<[^<>\s]+>/g) ?? [])].slice(0, 50);
}

/** Subject for a reply: "Re: " once. */
export function replySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (!s) return "Re: your message";
  return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}

/** A file name that is safe in a storage path. */
export function safeFileName(name: string | null | undefined): string {
  const base = (name ?? "").replace(/[\\/]/g, "_").replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").replace(/^\.+/, "").trim();
  return (base || "attachment").slice(0, 120);
}

/** Text quoted under a reply (">" lines), short enough for an email. */
export function quoteForReply(text: string | null | undefined, when: string, who: string, max = 4000): string {
  const body = (text ?? "").slice(0, max);
  if (!body.trim()) return "";
  return `\n\nOn ${when}, ${who} wrote:\n${body.split("\n").map((l) => `> ${l}`).join("\n")}`;
}
