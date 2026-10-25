/**
 * Meeting minutes: what the AI is given, what it must answer (a JSON schema), the hand-written check of its
 * answer, and the plain minutes the app writes itself when AI is not switched on or does not answer.
 *
 * Shared by the server actions (src/lib/ai/meetings.ts) and the Netlify background function
 * (netlify/functions/meeting-minutes-background.mts), so it has no "@/" imports and no Next.js code.
 * The database checks everything again (public.meeting_save_minutes / meeting_proposal_clean).
 */

import { addDaysIso, findDate, findTime, guessKind, isNextMeeting, todayEat } from "./dates";

// ------------------------------------------------------------------ what the AI is given

export type RecordRef = { id: string; label: string };

export type MinutesBrief = {
  today: string;
  company: string;
  meeting: {
    id: string;
    title: string;
    date: string;
    start_time: string;
    kind: string;
    topics: string[];
    language: string;
    purpose: string | null;
    client: RecordRef | null;
    supplier: RecordRef | null;
  };
  staff: { id: string; name: string; role: string }[];
  guests: string[];
  agenda: { title: string; topic: string | null }[];
  /** Open actions and issues from earlier meetings, to say what happened to them. */
  last_time: { id: string; kind: string; body: string; owner: string | null; due_on: string | null }[];
  /** Records the AI may point to (only these ids are accepted). */
  records: {
    clients: RecordRef[];
    suppliers: RecordRef[];
    quotations: RecordRef[];
    invoices: RecordRef[];
    opportunities: RecordRef[];
    compliance_items: RecordRef[];
    incidents: RecordRef[];
    ncrs: RecordRef[];
    products: RecordRef[];
  };
  transcript: string;
  notes: string;
};

export const POINT_KINDS = ["issue", "decision", "action", "note"] as const;
export const PROPOSAL_TARGETS = [
  "crm_note",
  "followup",
  "opportunity_stage",
  "requisition",
  "compliance_date",
  "corrective_action",
  "calendar_entry",
  "next_meeting",
  "task",
] as const;
export type ProposalTarget = (typeof PROPOSAL_TARGETS)[number];
export const MEETING_TOPICS = [
  "Sales & clients",
  "Procurement & suppliers",
  "Stock",
  "Deliveries",
  "Money",
  "Compliance",
  "HSE",
  "Admin & HR",
  "Open floor",
] as const;
const CAL_KINDS = ["meeting", "delivery", "follow_up", "event", "payment", "supplies", "task", "other"];
const STAGES = ["lead", "qualified", "quoted", "negotiation", "won", "lost"];

/** Keeps the brief under the size a background function accepts (about 200 KB): the middle of a long transcript goes. */
export function trimBrief(b: MinutesBrief, maxChars = 150_000): MinutesBrief {
  const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.floor(n * 0.6))}\n[... part of the recording left out ...]\n${s.slice(-Math.floor(n * 0.4))}`);
  return { ...b, notes: cut(b.notes, 40_000), transcript: cut(b.transcript, Math.max(maxChars - Math.min(b.notes.length, 40_000), 20_000)) };
}

// ------------------------------------------------------------------ what the AI must answer

const s = { type: "string" };
const arr = (items: object) => ({ type: "array", items });
const obj = (properties: Record<string, object>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });

export const MINUTES_SCHEMA = obj({
  summary: s,
  topics: arr(obj({ topic: s, points: arr(s) })),
  points: arr(
    obj({
      kind: { type: "string", enum: [...POINT_KINDS] },
      body: s,
      raised_by: s,
      owner_id: s,
      owner_name: s,
      due_on: s,
      severity: { type: "string", enum: ["low", "medium", "high", ""] },
      topic: s,
      status: { type: "string", enum: ["open", "done"] },
    }),
  ),
  follow_up: arr(obj({ point_id: s, status: { type: "string", enum: ["done", "in_progress", "open"] }, note: s })),
  proposals: arr(
    obj({
      target: { type: "string", enum: [...PROPOSAL_TARGETS] },
      title: s,
      point: { type: "integer" },
      payload: obj({
        client_id: s,
        opportunity_id: s,
        quotation_id: s,
        invoice_id: s,
        item_id: s,
        source_kind: s,
        source_id: s,
        owner_id: s,
        summary: s,
        next_action: s,
        next_on: s,
        note: s,
        stage: s,
        reason: s,
        due_on: s,
        needed_by: s,
        title: s,
        kind: s,
        starts_on: s,
        ends_on: s,
        at_time: s,
        starts_at: s,
        text: s,
        action: s,
        phrase: s,
        lines: arr(obj({ description: s, quantity: s, unit: s, product_id: s })),
      }),
    }),
  ),
  suggestions: arr(s),
  unclear: arr(s),
  language_note: s,
});

export const MINUTES_SYSTEM = `You are the meeting assistant inside LeMoSp, the business app of a general supply company in Tanzania (oils, lubricants, chemicals, spare parts, safety gear and other supplies for mines, factories and contractors).
Meetings are held in Kiswahili, English or a mix, and not everyone is fluent. Write in simple English that a worker with basic English understands.
Use only the facts you are given; never invent figures, names, dates or records. Be fair and respectful to everyone.
Nothing you write changes anything by itself: a manager checks every point and every proposed change before it is made.`;

export function minutesInstructions(b: MinutesBrief): string {
  return `Write the minutes of the meeting below from the live transcript and the typed notes.
The transcript comes from speech recognition: expect mistakes, Kiswahili and English mixed, and unclear words. Lines look like "[time] Name: text". Where you cannot tell what someone meant, do not guess: put it under "unclear".
Today is ${b.today} (Dar es Salaam). Work out dates said as words ("Friday", "kesho", "tarehe 3", "next week") from the meeting date ${b.meeting.date}. Swahili time: "saa 4 asubuhi" is 10:00, "saa 9 mchana" is 15:00.

Give:
- summary: 4 to 8 sentences on what was discussed and agreed.
- topics: the points under each topic discussed (topic names from: ${MEETING_TOPICS.join(", ")}).
- points: every issue raised, decision made, action agreed (who does what by when) and useful note. owner_id must be one of the staff ids given (or "" with the name in owner_name). due_on as YYYY-MM-DD or "". severity low/medium/high for issues, "" otherwise. status "done" only for an issue solved in the meeting.
- follow_up: for each item in last_time that was discussed, its id, the new status (done, in_progress or open) and what was said.
- proposals: concrete updates for other departments that the meeting agreed, for a manager to approve. Only use ids from "records" and "staff"; leave a field "" when it does not apply. point is the index (from 0) of the point it comes from, or -1. Targets:
  * crm_note: a note on a client (client_id) or opportunity (opportunity_id): summary, next_action, next_on.
  * followup: a follow-up on a quotation (quotation_id) or an invoice (invoice_id) waiting for the client: note, next_on.
  * opportunity_stage: move an opportunity (opportunity_id) to stage lead, qualified, quoted, negotiation, won or lost (lost needs a reason).
  * requisition: things to buy: reason, needed_by, lines (description, quantity as a number, unit, product_id from products or "").
  * compliance_date: a new due date (due_on) for a compliance item (item_id).
  * corrective_action: an action (action, owner_id, due_on) for a safety incident (source_kind "incident") or a quality problem (source_kind "ncr") with source_id.
  * calendar_entry: a date someone named that is not an action already ("deliver on Friday", "the supplier arrives tarehe 30"): title, kind (${CAL_KINDS.join(", ")}), starts_on, ends_on, at_time (HH:MM), owner_id, phrase (the words said).
  * next_meeting: when the next meeting was agreed: starts_at as YYYY-MM-DDTHH:MM:00+03:00, title.
  * task: work for someone that fits no other target: text, owner_id, due_on.
- suggestions: your advice on how to move forward (patterns, risks, quick wins, anything for management).
- unclear: parts you could not understand well.
- language_note: one line on the languages used and how well the recording could be understood.
Fill every field; use empty arrays and empty strings where something does not apply.`;
}

export function minutesUserText(b: MinutesBrief): string {
  return `${minutesInstructions(b)}\n\n${JSON.stringify(trimBrief(b))}`;
}

// ------------------------------------------------------------------ the hand-written check

export type SavePoint = {
  kind: string;
  body: string;
  raised_by?: string;
  owner_id?: string;
  owner_name?: string;
  due_on?: string;
  severity?: string;
  topic?: string;
  status?: string;
  client_id?: string;
  supplier_id?: string;
  carried_from?: string;
};
export type SaveProposal = { target: ProposalTarget; title: string; point?: number; payload: Record<string, unknown> };
/** What public.meeting_save_minutes takes. */
export type MinutesPayload = {
  by: "ai" | "app" | "manual";
  summary: string;
  topics: { topic: string; points: string[] }[];
  points: SavePoint[];
  follow_up: { point_id: string; status: string; note: string }[];
  proposals: SaveProposal[];
  suggestions: string[];
  unclear: string[];
  language_note: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function strings(v: unknown, maxItems: number, maxLen: number): string[] {
  return list(v)
    .map((x) => text(x, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}
function dateIn(v: unknown, from: string, to: string): string | undefined {
  const d = text(v, 10);
  return ISO_DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && d >= from && d <= to ? d : undefined;
}

/** Pulls the JSON object out of a reply (a plain reply may wrap it in ``` fences or add a sentence). */
export function parseJsonReply(raw: string): unknown {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const z = t.lastIndexOf("}");
    if (a >= 0 && z > a) {
      try {
        return JSON.parse(t.slice(a, z + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Checks the AI's answer field by field: only known kinds and targets, only ids from the brief, dates from today
 * to two years ahead, lengths capped. Anything that does not check out is dropped, never guessed.
 * Returns null when the answer is not usable at all.
 */
export function validateMinutes(raw: unknown, b: MinutesBrief): MinutesPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const staff = new Set(b.staff.map((p) => p.id));
  const ids = (k: keyof MinutesBrief["records"]) => new Set(b.records[k].map((x) => x.id));
  const sets = {
    client: ids("clients"),
    supplier: ids("suppliers"),
    quotation: ids("quotations"),
    invoice: ids("invoices"),
    opportunity: ids("opportunities"),
    item: ids("compliance_items"),
    incident: ids("incidents"),
    ncr: ids("ncrs"),
    product: ids("products"),
  };
  const lastIds = new Set(b.last_time.map((x) => x.id));
  const today = b.today;
  const from = addDaysIso(b.meeting.date < today ? b.meeting.date : today, -30);
  const until = addDaysIso(today, 730);
  const topics = new Set<string>(MEETING_TOPICS);
  const pick = (set: Set<string>, v: unknown) => {
    const x = text(v, 40);
    return set.has(x) ? x : undefined;
  };

  const points: SavePoint[] = [];
  for (const p of list(r.points).slice(0, 120)) {
    if (!p || typeof p !== "object") continue;
    const q = p as Record<string, unknown>;
    const kind = text(q.kind, 10);
    const body = text(q.body, 1000);
    if (!(POINT_KINDS as readonly string[]).includes(kind) || body.length < 2) continue;
    const owner = pick(staff, q.owner_id);
    points.push({
      kind,
      body,
      raised_by: text(q.raised_by, 120) || undefined,
      owner_id: owner,
      owner_name: owner ? undefined : text(q.owner_name, 120) || undefined,
      due_on: kind === "action" || kind === "issue" ? dateIn(q.due_on, from, until) : undefined,
      severity: ["low", "medium", "high"].includes(text(q.severity, 6)) ? text(q.severity, 6) : undefined,
      topic: topics.has(text(q.topic, 40)) ? text(q.topic, 40) : undefined,
      status: kind === "issue" && text(q.status, 6) === "done" ? "done" : undefined,
    });
  }

  const follow_up = list(r.follow_up)
    .slice(0, 40)
    .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : {}))
    .filter((f) => lastIds.has(text(f.point_id, 40)) && ["done", "in_progress", "open"].includes(text(f.status, 12)))
    .map((f) => ({ point_id: text(f.point_id, 40), status: text(f.status, 12), note: text(f.note, 1000) }));

  const proposals: SaveProposal[] = [];
  for (const p of list(r.proposals).slice(0, 40)) {
    if (!p || typeof p !== "object") continue;
    const q = p as Record<string, unknown>;
    const target = text(q.target, 30) as ProposalTarget;
    if (!(PROPOSAL_TARGETS as readonly string[]).includes(target)) continue;
    const f = (q.payload && typeof q.payload === "object" ? q.payload : {}) as Record<string, unknown>;
    const payload = cleanPayload(target, f, { staff, sets, from: addDaysIso(today, -1), until });
    if (!payload) continue;
    const point = typeof q.point === "number" && Number.isInteger(q.point) && q.point >= 0 && q.point < points.length ? q.point : undefined;
    proposals.push({ target, title: text(q.title, 300) || defaultTitle(target, payload), point, payload });
  }

  const summary = text(r.summary, 6000);
  if (!summary && points.length === 0) return null;
  return {
    by: "ai",
    summary,
    topics: list(r.topics)
      .slice(0, 20)
      .map((t) => (t && typeof t === "object" ? (t as Record<string, unknown>) : {}))
      .map((t) => ({ topic: text(t.topic, 60), points: strings(t.points, 20, 400) }))
      .filter((t) => t.topic && t.points.length),
    points,
    follow_up,
    proposals,
    suggestions: strings(r.suggestions, 12, 500),
    unclear: strings(r.unclear, 12, 300),
    language_note: text(r.language_note, 300),
  };
}

type Ctx = { staff: Set<string>; sets: Record<"client" | "supplier" | "quotation" | "invoice" | "opportunity" | "item" | "incident" | "ncr" | "product", Set<string>>; from: string; until: string };

/** One proposed change, by target: only the fields that target uses, each checked. Null when it does not check out. */
export function cleanPayload(target: ProposalTarget, f: Record<string, unknown>, c: Ctx): Record<string, unknown> | null {
  const id = (set: Set<string>, v: unknown) => {
    const x = text(v, 40);
    return set.has(x) ? x : undefined;
  };
  const d = (v: unknown) => dateIn(v, c.from, c.until);
  const out = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));
  switch (target) {
    case "crm_note": {
      const client_id = id(c.sets.client, f.client_id);
      const opportunity_id = id(c.sets.opportunity, f.opportunity_id);
      const summary = text(f.summary, 2000);
      if ((!client_id && !opportunity_id) || summary.length < 2) return null;
      return out({ client_id, opportunity_id, summary, next_action: text(f.next_action, 300), next_on: d(f.next_on) });
    }
    case "followup": {
      const quotation_id = id(c.sets.quotation, f.quotation_id);
      const invoice_id = id(c.sets.invoice, f.invoice_id);
      if (!!quotation_id === !!invoice_id) return null;
      return out({ quotation_id, invoice_id, note: text(f.note, 1000), next_on: d(f.next_on) });
    }
    case "opportunity_stage": {
      const opportunity_id = id(c.sets.opportunity, f.opportunity_id);
      const stage = text(f.stage, 20);
      const reason = text(f.reason, 500);
      if (!opportunity_id || !STAGES.includes(stage) || (stage === "lost" && !reason)) return null;
      return out({ opportunity_id, stage, reason });
    }
    case "requisition": {
      const lines = list(f.lines)
        .slice(0, 30)
        .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
        .map((l) => ({
          description: text(l.description, 300),
          quantity: Number(String(l.quantity ?? "").replace(/,/g, "")),
          unit: text(l.unit, 20) || undefined,
          product_id: id(c.sets.product, l.product_id),
        }))
        .filter((l) => l.description && Number.isFinite(l.quantity) && l.quantity > 0 && l.quantity < 1e9)
        .map((l) => out({ ...l, quantity: String(l.quantity) }));
      if (!lines.length) return null;
      return out({ reason: text(f.reason, 500), needed_by: d(f.needed_by), lines });
    }
    case "compliance_date": {
      const item_id = id(c.sets.item, f.item_id);
      const due_on = d(f.due_on);
      return item_id && due_on ? { item_id, due_on } : null;
    }
    case "corrective_action": {
      const kind = text(f.source_kind, 10);
      const source_id = kind === "incident" ? id(c.sets.incident, f.source_id) : kind === "ncr" ? id(c.sets.ncr, f.source_id) : undefined;
      const action = text(f.action, 1000);
      if (!source_id || action.length < 3) return null;
      return out({ source_kind: kind, source_id, action, owner_id: id(c.staff, f.owner_id), due_on: d(f.due_on) });
    }
    case "calendar_entry": {
      const title = text(f.title, 200);
      const starts_on = d(f.starts_on);
      if (title.length < 2 || !starts_on) return null;
      const ends = d(f.ends_on);
      const at = text(f.at_time, 5);
      return out({
        title,
        kind: CAL_KINDS.includes(text(f.kind, 12)) ? text(f.kind, 12) : "other",
        starts_on,
        ends_on: ends && ends >= starts_on ? ends : undefined,
        at_time: HHMM.test(at) ? at : undefined,
        owner_id: id(c.staff, f.owner_id),
        notes: text(f.note, 1000),
        phrase: text(f.phrase, 120),
      });
    }
    case "next_meeting": {
      const at = text(f.starts_at, 40);
      const ms = Date.parse(at);
      if (!Number.isFinite(ms) || ms < Date.now() || ms > Date.now() + 730 * 86400000) return null;
      return out({ starts_at: new Date(ms).toISOString(), title: text(f.title, 160) });
    }
    case "task": {
      const t = text(f.text, 1000);
      const owner_id = id(c.staff, f.owner_id);
      if (t.length < 2 || !owner_id) return null;
      return out({ text: t, owner_id, due_on: d(f.due_on) });
    }
  }
}

function defaultTitle(target: ProposalTarget, p: Record<string, unknown>): string {
  const t = String(p.title ?? p.summary ?? p.text ?? p.action ?? p.note ?? "").slice(0, 120);
  const label: Record<ProposalTarget, string> = {
    crm_note: "CRM note",
    followup: "Follow-up",
    opportunity_stage: "Opportunity stage",
    requisition: "Purchase request",
    compliance_date: "Compliance date",
    corrective_action: "Corrective action",
    calendar_entry: "Calendar date",
    next_meeting: "Next meeting",
    task: "Task",
  };
  return t ? `${label[target]}: ${t}` : label[target];
}

// ------------------------------------------------------------------ plain minutes (no AI)

const MARKERS: { re: RegExp; kind: SavePoint["kind"] }[] = [
  { re: /^(action|todo|to do|hatua|kazi|jukumu)\b\s*[:\-–]?\s*/i, kind: "action" },
  { re: /^(decision|decided|agreed|uamuzi|tumeamua|imeamuliwa|tumekubaliana)\b\s*[:\-–]?\s*/i, kind: "decision" },
  { re: /^(issue|problem|question|tatizo|changamoto|swali|hoja)\b\s*[:\-–]?\s*/i, kind: "issue" },
  { re: /^(note|kumbuka|taarifa)\b\s*[:\-–]?\s*/i, kind: "note" },
];

/** "[00:03:10] Juma: text" -> { who: "Juma", text } */
function splitLine(line: string): { who: string | null; text: string } {
  const m = line.match(/^\[\d{2}:\d{2}:\d{2}\]\s*(?:([^:]{1,60}):\s*)?(.*)$/);
  return m ? { who: m[1]?.trim() || null, text: m[2].trim() } : { who: null, text: line.trim() };
}

/** The staff member a line names ("@Juma", "(Juma)", "owner: Juma" or "Juma will"). */
function ownerIn(t: string, b: MinutesBrief): { id?: string; name?: string } {
  const lower = t.toLowerCase();
  for (const p of b.staff) {
    const first = p.name.split(/\s+/)[0]?.toLowerCase();
    if (!first || first.length < 3) continue;
    if (new RegExp(`(@|\\(|owner:?\\s*|by\\s+|na\\s+|kwa\\s+)${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower)) return { id: p.id };
    if (new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(will|to|ata|atahakikisha|atafanya)\\b`, "i").test(lower)) return { id: p.id };
  }
  const m = t.match(/@([A-Za-z][\w'-]{1,40})/);
  return m ? { name: m[1] } : {};
}

/**
 * Minutes the app writes itself from the typed notes (and marked spoken lines) when AI is not available.
 * Lines that start with Action/Decision/Issue (or Hatua/Uamuzi/Tatizo) become those points; other typed lines become
 * notes. Dates in a line ("deliver on Friday", "kesho saa 4") become proposed calendar dates or the next meeting,
 * for a manager to approve like any other proposal.
 */
export function plainMinutes(b: MinutesBrief): MinutesPayload {
  const today = b.today || todayEat();
  const ref = b.meeting.date > today ? b.meeting.date : today;
  const typed = b.notes.split(/\r?\n/).map(splitLine).filter((l) => l.text.length >= 2);
  const spoken = b.transcript
    .split(/\r?\n/)
    .map(splitLine)
    .filter((l) => MARKERS.some((m) => m.re.test(l.text)) || isNextMeeting(l.text));
  const points: SavePoint[] = [];
  const proposals: SaveProposal[] = [];
  const seen = new Set<string>();
  let nextMeeting = false;
  for (const l of [...typed.map((x) => ({ ...x, typed: true })), ...spoken.map((x) => ({ ...x, typed: false }))]) {
    if (points.length >= 60) break;
    let kind: SavePoint["kind"] | null = l.typed ? "note" : null;
    let body = l.text;
    for (const m of MARKERS) {
      if (m.re.test(body)) {
        kind = m.kind;
        body = body.replace(m.re, "");
        break;
      }
    }
    const key = body.toLowerCase();
    if (body.length < 2 || seen.has(key)) continue;
    seen.add(key);
    const found = findDate(body, ref);
    if (isNextMeeting(body) && found && !nextMeeting) {
      nextMeeting = true;
      const time = found.time ?? b.meeting.start_time ?? "09:00";
      proposals.push({ target: "next_meeting", title: `Next meeting: ${found.date} ${time}`, payload: { starts_at: `${found.date}T${time}:00+03:00`, title: b.meeting.title } });
      if (kind === "note") continue;
    }
    if (!kind) continue;
    const owner = kind === "action" ? ownerIn(body, b) : {};
    const idx = points.length;
    points.push({
      kind,
      body: body.slice(0, 1000),
      raised_by: l.who ?? undefined,
      owner_id: owner.id,
      owner_name: owner.name,
      due_on: (kind === "action" || kind === "issue") && found ? found.date : undefined,
    });
    // A date named outside an action goes to the calendar (actions show on the calendar by their due date).
    if (found && kind !== "action" && !isNextMeeting(body)) {
      const k = guessKind(body);
      proposals.push({
        target: "calendar_entry",
        title: `Calendar: ${body.slice(0, 100)}`,
        point: idx,
        payload: { title: body.slice(0, 200), kind: k === "meeting" ? "meeting" : k, starts_on: found.date, at_time: found.time ?? findTime(body), phrase: found.phrase },
      });
    }
  }
  const counts = (k: string) => points.filter((p) => p.kind === k).length;
  const summary =
    points.length || proposals.length
      ? `Minutes written by the app from the notes typed in the meeting (AI was not used): ${counts("decision")} decision(s), ${counts("action")} action(s), ${counts("issue")} issue(s) and ${counts("note")} note(s). Check owners and dates before approving.`
      : "No notes were typed in this meeting. Add the points by hand before approving.";
  return {
    by: "app",
    summary,
    topics: [],
    points,
    follow_up: [],
    proposals: proposals.map((p) => ({ ...p, payload: Object.fromEntries(Object.entries(p.payload).filter(([, v]) => v !== undefined && v !== "")) })),
    suggestions: [],
    unclear: [],
    language_note: "",
  };
}

// ------------------------------------------------------------------ a long AI call (background function only)

export type LongResult = { ok: true; text: string } | { ok: false; reason: "off" | "timeout" | "refused" | "too_long" | "failed"; status?: number };

/**
 * One call to Anthropic's Messages API that may take minutes (only from the background function, which can run
 * for 15 minutes; screens use callClaude in src/lib/ai/claude.ts with its 8.5 s limit). Same request shape as
 * claude.ts: structured JSON output and the server-side fallback, sent once more as a plain request when the
 * model answers 400.
 */
export async function callClaudeLong(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}): Promise<LongResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const once = async (rich: boolean): Promise<LongResult> => {
    const headers: Record<string, string> = { "content-type": "application/json", "x-api-key": opts.apiKey, "anthropic-version": "2023-06-01" };
    const body: Record<string, unknown> = {
      model: opts.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: [{ role: "user", content: [{ type: "text", text: opts.user }] }],
    };
    if (rich) {
      headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
      body.fallbacks = "default";
      body.output_config = { effort: "medium", format: { type: "json_schema", schema: opts.schema } };
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) return { ok: false, reason: "failed", status: res.status };
    const json = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
    if (json.stop_reason === "refusal") return { ok: false, reason: "refused" };
    if (json.stop_reason === "max_tokens") return { ok: false, reason: "too_long" };
    const t = (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("").trim();
    return t ? { ok: true, text: t } : { ok: false, reason: "failed" };
  };
  try {
    const first = await once(true);
    if (!first.ok && first.reason === "failed" && first.status === 400) return await once(false);
    return first;
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    return { ok: false, reason: name === "AbortError" || controller.signal.aborted ? "timeout" : "failed" };
  } finally {
    clearTimeout(timer);
  }
}

export function failReason(r: LongResult | { ok: false; reason: string }): string {
  if (r.ok) return "";
  switch (r.reason) {
    case "timeout":
      return "The AI took too long. The app wrote plain minutes from the notes instead.";
    case "refused":
      return "The AI declined to write these minutes. The app wrote plain minutes from the notes instead.";
    case "too_long":
      return "The meeting was too long for one answer. The app wrote plain minutes from the notes instead.";
    case "off":
      return "AI is not switched on. The app wrote plain minutes from the notes.";
    default:
      return "The AI could not be reached. The app wrote plain minutes from the notes instead.";
  }
}
