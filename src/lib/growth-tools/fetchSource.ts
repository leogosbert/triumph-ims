import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { BOT_NAME, parseRobots, robotsAllows, type RobotsRules } from "./robots";

/**
 * Reading a public tender page, politely and safely (server only):
 *  - only http/https on the normal ports, never a private, local or cloud-metadata address
 *    (checked after DNS, and again on every redirect, at most 3);
 *  - robots.txt is read first and obeyed for our bot name (LeMoSpTenderBot) or "*";
 *  - one page per source per run, at most 1.5 MB, about 5 seconds, a clear User-Agent;
 *  - each source is read at most every 6 hours (the interval is set per source, default 24 h).
 */

export const USER_AGENT = `${BOT_NAME}/1.0 (+tender alerts for a supplier; reads public tender listings once a day)`;
const MAX_BYTES = 1_500_000;

export type FetchResult =
  | { ok: true; url: string; contentType: string; body: string }
  | { ok: false; status: "blocked" | "failed"; error: string };

/** Private, loopback, link-local, carrier NAT, multicast or reserved addresses: not on the public internet. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(x) || x.startsWith("64:ff9b:") || x.startsWith("2001:db8");
  }
  return true;
}

/** The URL may be fetched: public host, http(s), port 80/443. Throws a short reason otherwise. */
export async function checkPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Not a valid link");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http and https links");
  if (u.username || u.password) throw new Error("Links with a password are not read");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("Only the normal web ports");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Not a public address");
  }
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("Not a public address");
  return u;
}

async function readLimited(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

async function getOnce(url: string, signal: AbortSignal, accept: string): Promise<{ res: Response; url: string }> {
  let current = url;
  for (let hop = 0; hop <= 3; hop++) {
    await checkPublicUrl(current);
    const res = await fetch(current, {
      redirect: "manual",
      signal,
      cache: "no-store",
      headers: { "user-agent": USER_AGENT, accept, "accept-language": "en, sw;q=0.8" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!loc) throw new Error(`Redirect without a link (${res.status})`);
      current = new URL(loc, current).toString();
      continue;
    }
    return { res, url: current };
  }
  throw new Error("Too many redirects");
}

const robotsCache = new Map<string, RobotsRules | "blocked">();

/** robots.txt of the site: missing (4xx) = everything allowed; 5xx or an error = do not read this time. */
async function robotsFor(u: URL, signal: AbortSignal): Promise<RobotsRules | "blocked"> {
  const key = u.origin;
  const hit = robotsCache.get(key);
  if (hit) return hit;
  let rules: RobotsRules | "blocked";
  try {
    const { res } = await getOnce(`${u.origin}/robots.txt`, signal, "text/plain");
    if (res.status >= 500) rules = "blocked";
    else if (!res.ok) rules = { allow: [], disallow: [], crawlDelay: null };
    else rules = parseRobots(await readLimited(res, 200_000));
  } catch {
    rules = "blocked";
  }
  if (robotsCache.size > 200) robotsCache.clear();
  robotsCache.set(key, rules);
  return rules;
}

/** One public page or feed, or why not. `timeoutMs` covers robots.txt and the page together. */
export async function fetchTenderSource(rawUrl: string, timeoutMs = 5000): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let u: URL;
    try {
      u = await checkPublicUrl(rawUrl);
    } catch (e) {
      return { ok: false, status: "blocked", error: (e as Error).message };
    }
    const rules = await robotsFor(u, controller.signal);
    if (rules === "blocked") return { ok: false, status: "failed", error: "The site's robots.txt could not be read; trying again later" };
    if (!robotsAllows(rules, `${u.pathname}${u.search}`)) return { ok: false, status: "blocked", error: "The site's robots.txt does not allow reading this page" };
    const { res, url } = await getOnce(u.toString(), controller.signal, "text/html, application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5");
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, status: "blocked", error: `The site refused (${res.status})` };
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, status: "failed", error: `The site answered ${res.status}` };
    }
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (contentType && !/(text\/|xml|rss|atom|json)/.test(contentType)) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, status: "failed", error: "Not a web page or feed (a PDF or file link?)" };
    }
    return { ok: true, url, contentType, body: await readLimited(res, MAX_BYTES) };
  } catch (e) {
    const name = (e as { name?: string }).name;
    return { ok: false, status: "failed", error: name === "AbortError" ? "The site took too long" : ((e as Error).message || "Could not read").slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}
