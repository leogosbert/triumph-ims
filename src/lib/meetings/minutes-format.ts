/**
 * The minutes as a document: an opening summary, one section per agenda item (what was discussed, what was decided
 * and why), the action items with owner and due date, decisions, issues and risks, suggestions for the next meeting
 * and, when asked for, a Kiswahili summary. Built from what public.meeting_save_minutes keeps (minutes_summary) and
 * the meeting's points, for the minutes page, the meeting page and "Copy the minutes".
 *
 * Plain functions with no "@/" imports, so they are unit-tested on their own (src/lib/meetings/__tests__).
 */

export type SummaryLike = {
  format?: number;
  summary?: string;
  sections?: { title?: string; topic?: string; discussion?: string; decisions?: string }[];
  topics?: { topic: string; points: string[] }[];
  risks?: string[];
  next_meeting?: string;
  summary_sw?: string;
  suggestions?: string[];
  unclear?: string[];
  language_note?: string;
};

export type PointLike = {
  kind: string;
  body: string;
  owner_id: string | null;
  owner_name: string | null;
  due_on: string | null;
  status: string;
  severity: string | null;
  sort?: number;
};

export type MinutesAction = { n: number; what: string; owner: string; matched: boolean; due: string | null; status: string; uncertain: boolean };

export type MinutesDoc = {
  opening: string[];
  sections: { title: string; topic: string; discussion: string[]; decisions: string[] }[];
  actions: MinutesAction[];
  decisions: string[];
  issues: { text: string; severity: string | null }[];
  notes: string[];
  risks: string[];
  nextMeeting: string[];
  suggestions: string[];
  swahili: string[];
  unclear: string[];
  languageNote: string;
  /** Written before v1.25 (points under topics, no paragraphs). */
  legacy: boolean;
  empty: boolean;
};

/** Paragraphs of a text: split on blank lines, spaces tidied, empty ones dropped. */
export function splitParagraphs(s: string | null | undefined): string[] {
  return String(s ?? "")
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** "2026-10-30" -> "Fri 30 Oct 2026" (a calendar date, no time zone shift). */
export function formatDue(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(d).replace(/,/g, "");
}

/** One sentence from a list of short points (older minutes): "A. B. C." */
function asSentences(points: string[]): string {
  return points
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/[.!?]$/.test(p) ? p : `${p}.`))
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function buildMinutesDoc(summary: SummaryLike | null | undefined, points: PointLike[], nameOf: (id: string) => string | undefined): MinutesDoc {
  const s = summary ?? {};
  const ordered = [...points].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const sections = (s.sections ?? [])
    .map((x) => ({
      title: String(x.title ?? "").trim(),
      topic: String(x.topic ?? "").trim(),
      discussion: splitParagraphs(x.discussion),
      decisions: splitParagraphs(x.decisions),
    }))
    .filter((x) => x.title && (x.discussion.length || x.decisions.length));
  const legacy = !sections.length && (s.topics ?? []).some((t) => t.points?.length);
  if (legacy) {
    for (const t of s.topics ?? []) {
      const text = asSentences(t.points ?? []);
      if (text) sections.push({ title: t.topic, topic: t.topic, discussion: [text], decisions: [] });
    }
  }
  const actions: MinutesAction[] = ordered
    .filter((p) => p.kind === "action")
    .map((p) => {
      const named = p.owner_id ? nameOf(p.owner_id) : undefined;
      return {
        n: 0,
        what: p.body.replace(/\s*\(to confirm\)\s*$/i, ""),
        owner: named ?? p.owner_name ?? "",
        matched: !!named,
        due: p.due_on,
        status: p.status,
        uncertain: /\(to confirm\)\s*$/i.test(p.body),
      };
    })
    // Dated actions first, soonest first; undated keep their order.
    .sort((a, b) => (a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : 0))
    .map((a, i) => ({ ...a, n: i + 1 }));
  const doc: MinutesDoc = {
    opening: splitParagraphs(s.summary),
    sections,
    actions,
    decisions: ordered.filter((p) => p.kind === "decision").map((p) => p.body),
    issues: ordered.filter((p) => p.kind === "issue").map((p) => ({ text: p.body, severity: p.severity })),
    notes: ordered.filter((p) => p.kind === "note").map((p) => p.body),
    risks: (s.risks ?? []).map((r) => String(r).trim()).filter(Boolean),
    nextMeeting: splitParagraphs(s.next_meeting),
    suggestions: (s.suggestions ?? []).map((r) => String(r).trim()).filter(Boolean),
    swahili: splitParagraphs(s.summary_sw),
    unclear: (s.unclear ?? []).map((r) => String(r).trim()).filter(Boolean),
    languageNote: String(s.language_note ?? "").trim(),
    legacy,
    empty: false,
  };
  doc.empty = !doc.opening.length && !doc.sections.length && !doc.actions.length && !doc.decisions.length && !doc.issues.length && !doc.notes.length;
  return doc;
}

/**
 * The minutes as plain text (for "Copy the minutes", email or WhatsApp): headings in capitals, paragraphs separated
 * by blank lines, action items as a numbered list with owner and due date.
 */
export function minutesText(doc: MinutesDoc, head: { company: string; title: string; when: string; attendees?: string[]; approved?: string | null }): string {
  const out: string[] = [];
  const h = (t: string) => out.push("", t.toUpperCase());
  out.push(`${head.company}: minutes of "${head.title}"`, head.when);
  if (head.attendees?.length) out.push(`Present: ${head.attendees.join(", ")}`);
  out.push(head.approved ? `Approved: ${head.approved}` : "Draft: not approved yet");
  if (doc.opening.length) {
    h("Summary");
    for (const p of doc.opening) out.push(p, "");
    out.pop();
  }
  doc.sections.forEach((sec, i) => {
    h(`${i + 1}. ${sec.title}`);
    for (const p of sec.discussion) out.push(p, "");
    if (sec.decisions.length) out.push(`Decided: ${sec.decisions.join(" ")}`);
    else out.pop();
  });
  if (doc.actions.length) {
    h("Action items");
    for (const a of doc.actions) {
      const parts = [a.owner || "Owner not set", a.due ? `due ${formatDue(a.due)}` : "no due date"];
      out.push(`${a.n}. ${a.what}${a.uncertain ? " (to confirm)" : ""} (${parts.join(", ")})`);
    }
  }
  if (doc.decisions.length) {
    h("Decisions");
    for (const d of doc.decisions) out.push(`- ${d}`);
  }
  if (doc.issues.length || doc.risks.length) {
    h("Issues and risks");
    for (const i of doc.issues) out.push(`- ${i.text}${i.severity ? ` (${i.severity})` : ""}`);
    for (const r of doc.risks) out.push(`- ${r}`);
  }
  if (doc.nextMeeting.length) {
    h("Next meeting");
    for (const p of doc.nextMeeting) out.push(p, "");
    out.pop();
  }
  if (doc.swahili.length) {
    h("Muhtasari kwa Kiswahili");
    for (const p of doc.swahili) out.push(p, "");
    out.pop();
  }
  if (doc.unclear.length) {
    h("Not clear in the recording");
    for (const u of doc.unclear) out.push(`- ${u}`);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
