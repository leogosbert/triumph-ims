/**
 * robots.txt rules (RFC 9309): the group for our user agent (or "*"), longest matching Allow/Disallow
 * wins, "*" and "$" in paths. Pure; tested in __tests__.
 */

export const BOT_NAME = "LeMoSpTenderBot";

export type RobotsRules = { allow: string[]; disallow: string[]; crawlDelay: number | null };

export function parseRobots(txt: string, agent = BOT_NAME): RobotsRules {
  type Group = { agents: string[]; allow: string[]; disallow: string[]; delay: number | null };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const value = line.slice(i + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [], delay: null };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" && value) cur.allow.push(value);
    else if (key === "disallow" && value) cur.disallow.push(value);
    else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) cur.delay = n;
    }
  }
  const me = agent.toLowerCase();
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && me.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
    crawlDelay: chosen.reduce<number | null>((d, g) => (g.delay !== null ? Math.max(d ?? 0, g.delay) : d), null),
  };
}

function matches(path: string, pattern: string): boolean {
  const anchored = pattern.endsWith("$");
  const p = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp(`^${p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
  return re.test(path);
}

/** Is this path (with its query) allowed? No rules: allowed. */
export function robotsAllows(rules: RobotsRules, pathWithQuery: string): boolean {
  const path = pathWithQuery || "/";
  if (path === "/robots.txt") return true;
  let best: { len: number; allow: boolean } | null = null;
  for (const a of rules.allow) if (matches(path, a) && (!best || a.length >= best.len)) best = { len: a.length, allow: true };
  for (const d of rules.disallow) if (matches(path, d) && (!best || d.length > best.len)) best = { len: d.length, allow: false };
  return best ? best.allow : true;
}
