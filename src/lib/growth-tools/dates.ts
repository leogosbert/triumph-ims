/**
 * Dates written in tender adverts and emails, English or Kiswahili, day first (Tanzanian style):
 * "20th November 2026", "20 Nov, 2026 at 10:00 hrs", "20/11/2026", "2026-11-20", "November 20, 2026",
 * "Tarehe 20 Novemba 2026 saa 4:00 asubuhi". Pure functions (no network), used by the tender readers.
 */

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januari: 1,
  feb: 2, february: 2, februari: 2,
  mar: 3, march: 3, machi: 3,
  apr: 4, april: 4, aprili: 4,
  may: 5, mei: 5,
  jun: 6, june: 6, juni: 6,
  jul: 7, july: 7, julai: 7,
  aug: 8, august: 8, agosti: 8,
  sep: 9, sept: 9, september: 9, septemba: 9,
  oct: 10, october: 10, oktoba: 10,
  nov: 11, november: 11, novemba: 11,
  dec: 12, december: 12, desemba: 12,
};

const MONTH_RE = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

export type FoundDate = { date: string; time: string | null; index: number; text: string };

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function valid(y: number, m: number, d: number) {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function fullYear(y: number) {
  return y < 100 ? 2000 + y : y;
}

/** "10:00", "10.00 hrs", "2:30 pm", "1400hrs", "saa 4:00 asubuhi" (Swahili time: +6 hours) -> "HH:MM". */
export function parseTime(text: string): string | null {
  const sw = /saa\s*(\d{1,2})(?:[:.](\d{2}))?\s*(asubuhi|mchana|jioni|usiku)?/i.exec(text);
  if (sw) {
    let h = Number(sw[1]);
    const m = Number(sw[2] ?? 0);
    const part = (sw[3] ?? "").toLowerCase();
    // Swahili hours count from 6 o'clock: saa 4 asubuhi = 10:00, saa 8 mchana = 14:00.
    h = (h + 6) % 12;
    if (part === "mchana" || part === "jioni" || part === "usiku") {
      if (!(part === "mchana" && h >= 10 && h < 12)) h += 12;
    }
    if (h >= 0 && h < 24 && m < 60) return `${pad(h)}:${pad(m)}`;
  }
  const t = /(?:^|[^\d])(\d{1,2})\s*[:.]\s*(\d{2})\s*(a\.?m\.?|p\.?m\.?|hrs|hours|h)?(?![\d])/i.exec(text) ?? /(?:^|[^\d])([01]\d|2[0-3])([0-5]\d)\s*(hrs|hours|h)(?![a-z])/i.exec(text);
  if (!t) {
    const ampm = /(?:^|[^\d])(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i.exec(text);
    if (!ampm) return null;
    let h = Number(ampm[1]);
    const pm = /^p/i.test(ampm[2]);
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
    return h < 24 ? `${pad(h)}:00` : null;
  }
  let h = Number(t[1]);
  const m = Number(t[2]);
  const suffix = (t[3] ?? "").toLowerCase().replace(/\./g, "");
  if (suffix === "pm" && h < 12) h += 12;
  if (suffix === "am" && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
}

/** Every date found in the text, in order. */
export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = [];
  const push = (y: number, m: number, d: number, index: number, raw: string) => {
    if (!valid(y, m, d)) return;
    const after = text.slice(index + raw.length, index + raw.length + 40);
    const timeText = /^[\s,]*(?:at|by|before|saa|kabla ya|-|\s)*\s*(?:saa\s*)?\d{1,2}\s*(?:[:.]\s*\d{2}|a\.?m|p\.?m|\d{2}\s*h)/i.test(after)
      ? after
      : "";
    out.push({ date: `${y}-${pad(m)}-${pad(d)}`, time: timeText ? parseTime(timeText) : null, index, text: raw });
  };
  let m: RegExpExecArray | null;
  // 2026-11-20
  const iso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g;
  while ((m = iso.exec(text))) push(Number(m[1]), Number(m[2]), Number(m[3]), m.index, m[0]);
  // 20/11/2026, 20.11.2026, 20-11-26 (day first)
  const num = /\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2}|\d{2})\b/g;
  while ((m = num.exec(text))) push(fullYear(Number(m[3])), Number(m[2]), Number(m[1]), m.index, m[0]);
  // 20th November 2026, 20 Nov, 2026, tarehe 20 Novemba 2026
  const dmy = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+|day of\\s+)?(${MONTH_RE})\\.?,?\\s*(20\\d{2})\\b`, "gi");
  while ((m = dmy.exec(text))) push(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]), m.index, m[0]);
  // November 20, 2026
  const mdy = new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s*(20\\d{2})\\b`, "gi");
  while ((m = mdy.exec(text))) push(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]), m.index, m[0]);
  out.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  // The same place matched by two patterns: keep the first (longest) one.
  const kept: FoundDate[] = [];
  for (const d of out) {
    const last = kept[kept.length - 1];
    if (last && d.index < last.index + last.text.length) continue;
    kept.push(d);
  }
  return kept;
}

/** "2026-11-20" + "10:00" in Dar es Salaam time -> ISO with +03:00 (default 10:00 when no time). */
export function darIso(date: string, time: string | null): string {
  return `${date}T${time ?? "10:00"}:00+03:00`;
}

const CLOSING_WORDS =
  /(closing|close[sd]?|deadline|submission|submitted|due|opening|latest|not later than|on or before|before|mwisho|kufunga|kuwasilisha|tarehe ya mwisho)/i;

/**
 * The closing date of a tender in free text: the date nearest after a word like "closing", "deadline",
 * "submission", "not later than" or "mwisho"; otherwise the latest date in the text. ISO with +03:00.
 */
export function findClosing(text: string): string | null {
  const dates = findDates(text);
  if (!dates.length) return null;
  let best: FoundDate | null = null;
  let bestGap = Infinity;
  const re = new RegExp(CLOSING_WORDS.source, "gi");
  let w: RegExpExecArray | null;
  while ((w = re.exec(text))) {
    for (const d of dates) {
      const gap = d.index - (w.index + w[0].length);
      if (gap >= 0 && gap < 120 && gap < bestGap) {
        best = d;
        bestGap = gap;
      }
    }
  }
  if (!best) best = dates.reduce((a, b) => (b.date > a.date ? b : a));
  return darIso(best.date, best.time);
}

/** Whole days from today (Dar es Salaam) to an ISO timestamp; negative when it has passed. */
export function daysLeft(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now.getTime()) / 86_400_000);
}
