/**
 * Builds an iCalendar (.ics) feed that Google Calendar, iPhone and Outlook can subscribe to (from Cocozania's
 * netlify/lib/ics.ts). Dates without a time are all-day entries; "09:30" or "09:30-11:00" is an hour-long (or ranged)
 * entry in Tanzanian time (EAT is UTC+3 all year).
 */

export type CalItem = { uid: string; date: string; end?: string | null; time?: string | null; kind?: string; title: string; notes?: string | null; href?: string | null };

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const ymd = (d: string) => d.slice(0, 10).replace(/-/g, "");
const nextDay = (d: string) => {
  const x = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};
const utc = (d: string, hh: number, mm: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10), hh - 3, mm));
const stamp = (x: Date) => x.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Lines longer than 75 bytes are folded, as the format asks. */
function fold(line: string) {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const b = new TextEncoder().encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function timesOf(t?: string | null): [number, number, number, number] | null {
  const m = String(t ?? "").match(/(\d{1,2})[:.](\d{2})(?:\s*(?:-|–|to)\s*(\d{1,2})[:.](\d{2}))?/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const end = m[3] && +m[3] <= 23 ? [+m[3], +m[4]] : [+m[1] + 1, +m[2]];
  return [+m[1], +m[2], Math.min(end[0], 23), end[0] > 23 ? 59 : end[1]];
}

export function buildIcs(name: string, items: CalItem[], opts: { host?: string; base?: string } = {}) {
  const host = opts.host ?? "lemosp";
  const now = stamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LeMo Tech Solutions//LeMoSp//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(name)}`,
    "X-WR-TIMEZONE:Africa/Dar_es_Salaam",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const it of items) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(it.date ?? ""))) continue;
    const t = timesOf(it.time);
    lines.push("BEGIN:VEVENT", `UID:${esc(it.uid)}@${host}`, `DTSTAMP:${now}`);
    if (t) {
      lines.push(`DTSTART:${stamp(utc(it.date, t[0], t[1]))}`, `DTEND:${stamp(utc(it.date, t[2], t[3]))}`);
    } else {
      const last = it.end && it.end >= it.date ? it.end : it.date;
      lines.push(`DTSTART;VALUE=DATE:${ymd(it.date)}`, `DTEND;VALUE=DATE:${ymd(nextDay(last))}`, "TRANSP:TRANSPARENT");
    }
    lines.push(`SUMMARY:${esc(String(it.title).slice(0, 200))}`);
    const notes = [it.kind, it.notes].filter(Boolean).join(" · ");
    if (notes) lines.push(`DESCRIPTION:${esc(notes.slice(0, 1000))}`);
    if (it.kind) lines.push(`CATEGORIES:${esc(it.kind)}`);
    if (opts.base && it.href && it.href.startsWith("/")) lines.push(`URL:${esc(opts.base + it.href)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
