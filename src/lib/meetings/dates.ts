/**
 * Finding days and times in what people say or type, in English or Kiswahili ("deliver on Friday",
 * "tukutane kesho saa 4", "next meeting 3 Nov"). Ported from Cocozania's diary (Kalenda).
 * No "@/" imports: the Netlify background function bundles this file on its own.
 */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAYS_SW = ["jumapili", "jumatatu", "jumanne", "jumatano", "alhamisi", "ijumaa", "jumamosi"];
const pad = (x: number) => String(x).padStart(2, "0");

/** Today in Dar es Salaam, as YYYY-MM-DD. */
export function todayEat(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(now);
}

export function addDaysIso(d: string, k: number): string {
  const x = new Date(`${d.slice(0, 10)}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + k);
  return x.toISOString().slice(0, 10);
}

export type Found = { date: string; time?: string; phrase: string };

/** The first day a text names, worked out from `ref` (today). Null when none. */
export function findDate(text: string, ref = todayEat()): Found | null {
  const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  const refD = new Date(`${ref}T00:00:00Z`);
  const hits: { at: number; date: string; phrase: string }[] = [];
  const add = (at: number, date: string | null, phrase: string) => {
    if (date && date >= addDaysIso(ref, -1) && date <= addDaysIso(ref, 400)) hits.push({ at, date, phrase });
  };
  const ymd = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const x = new Date(Date.UTC(y, m - 1, d));
    return x.getUTCMonth() === m - 1 ? x.toISOString().slice(0, 10) : null;
  };
  // A day and month without a year: the next time that day comes round.
  const coming = (m: number, d: number) => {
    const y = refD.getUTCFullYear();
    const a = ymd(y, m, d);
    return a && a < addDaysIso(ref, -1) ? ymd(y + 1, m, d) : a;
  };
  const each = (re: RegExp, f: (m: RegExpExecArray) => void) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) f(m);
  };

  each(/\b(day after tomorrow|keshokutwa)\b/g, (x) => add(x.index, addDaysIso(ref, 2), x[1]));
  each(/\b(tomorrow|kesho)\b(?!kutwa)/g, (x) => add(x.index, addDaysIso(ref, 1), x[1]));
  each(/\b(today|this (?:morning|afternoon|evening)|leo)\b/g, (x) => add(x.index, ref, x[1]));
  each(/\b(next week|wiki ijayo)\b/g, (x) => add(x.index, addDaysIso(ref, 7), x[1]));
  each(
    /\b(next |this |coming |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|jumapili|jumatatu|jumanne|jumatano|alhamisi|ijumaa|jumamosi)\b( ijayo)?/g,
    (x) => {
      const w = Math.max(DAYS_EN.indexOf(x[2]), DAYS_SW.indexOf(x[2]));
      const k = (w - refD.getUTCDay() + 7) % 7 || 7; // "next Monday" is the coming one
      add(x.index, addDaysIso(ref, k), x[0].trim());
    },
  );
  each(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (x) => add(x.index, ymd(+x[1], +x[2], +x[3]), x[0]));
  each(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/g, (x) => {
    if (/\d[.:]\d{2}\s*(am|pm|hrs|h)\b/.test(t.slice(x.index, x.index + 10))) return; // a time
    const y = x[3] ? (+x[3] < 100 ? 2000 + +x[3] : +x[3]) : 0;
    add(x.index, y ? ymd(y, +x[2], +x[1]) : coming(+x[2], +x[1]), x[0]); // Tanzania writes day/month
  });
  each(/\b(?:tarehe |on the |on )?(\d{1,2})(?:st|nd|rd|th)?(?: of)? (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:,? (\d{4}))?/g, (x) => {
    const mo = MONTHS.indexOf(x[2]) + 1;
    add(x.index, x[3] ? ymd(+x[3], mo, +x[1]) : coming(mo, +x[1]), x[0].trim());
  });
  each(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?\b(?:,? (\d{4}))?/g, (x) => {
    const mo = MONTHS.indexOf(x[1]) + 1;
    add(x.index, x[3] ? ymd(+x[3], mo, +x[2]) : coming(mo, +x[2]), x[0].trim());
  });
  each(/\btarehe (\d{1,2})\b(?![/.]\d| (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/g, (x) => {
    const d = +x[1];
    const mo = refD.getUTCMonth() + 1;
    add(x.index, d >= refD.getUTCDate() ? ymd(refD.getUTCFullYear(), mo, d) : coming(mo === 12 ? 1 : mo + 1, d), x[0]);
  });
  if (!hits.length) return null;
  const first = hits.sort((a, b) => a.at - b.at)[0];
  return { date: first.date, time: findTime(t), phrase: first.phrase };
}

/** A time of day: "10am", "14:30", "at 3 pm", or Swahili time ("saa 4 asubuhi" is 10:00, "saa 9 mchana" 15:00). */
export function findTime(text: string): string | undefined {
  const t = text.toLowerCase();
  let m = t.match(/\bsaa (\d{1,2})(?:[:.](\d{2})| na nusu)?/);
  if (m && +m[1] >= 1 && +m[1] <= 12) {
    const h = (+m[1] + 6) % 24; // Swahili hours count from 7 in the morning
    const night = /\busiku\b/.test(t.slice(m.index!, m.index! + 30)) && h < 12;
    return `${pad(night ? h + 12 : h)}:${m[2] ?? (m[0].includes("nusu") ? "30" : "00")}`;
  }
  m = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/);
  if (m && +m[1] <= 12) return `${pad((+m[1] % 12) + (m[3] === "pm" ? 12 : 0))}:${m[2] ?? "00"}`;
  m = t.match(/\b(?:at |by |from )?([01]?\d|2[0-3])[:h](\d{2})\b/);
  if (m) return `${pad(+m[1])}:${m[2]}`;
  return undefined;
}

export type DateKind = "delivery" | "meeting" | "follow_up" | "event" | "payment" | "supplies" | "task";

/** What kind of date a sentence is about. */
export function guessKind(text: string): DateKind {
  const t = text.toLowerCase();
  if (/\b(next meeting|kikao kijacho|mkutano ujao|tukutane tena)\b/.test(t)) return "meeting";
  if (/\b(deliver|delivery|drop off|send (?:it|them|the order)|peleka|letea|niletee|mzigo|wasilisha|tutawasilisha)/.test(t)) return "delivery";
  if (/\b(meet|meeting|visit|come by|appointment|kikao|tukutane|tembelea|nitakuja)/.test(t)) return "meeting";
  if (/\b(expo|fair|exhibition|maonesho|bazaar|festival|event)\b/.test(t)) return "event";
  if (/\b(pay|payment|transfer|lipa|malipo|nitalipa)\b/.test(t)) return "payment";
  if (/\b(shipment|arrive|arriving|dispatch|consignment|supply|supplies|itafika)\b/.test(t)) return "supplies";
  if (/\b(call|follow up|follow-up|remind|piga simu|fuatilia)\b/.test(t)) return "follow_up";
  return "task";
}

/** Is this sentence about the next meeting? */
export function isNextMeeting(text: string): boolean {
  return /\b(next meeting|kikao kijacho|mkutano ujao|tukutane tena|we meet again|meet again)\b/i.test(text);
}
