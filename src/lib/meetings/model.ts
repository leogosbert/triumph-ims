import { hasRole, type Role, type RoleSet } from "@/lib/roles";
export { MEETING_TOPICS, PROPOSAL_TARGETS, type ProposalTarget } from "./minutes-core";

/** Everyone except drivers organises meetings (public.meeting_organiser_roles). */
export const ORGANISER_ROLES: Role[] = ["management", "sales", "procurement", "finance", "warehouse"];
/** Any of the person's roles (main or extra) may organise. */
export const canOrganise = (roles: RoleSet) => hasRole(roles, ...ORGANISER_ROLES);

export const MEETING_KINDS: Record<string, string> = {
  internal: "Team meeting",
  client: "With a client",
  supplier: "With a supplier",
  external: "Other outside meeting",
};

export const MEETING_STATUS: Record<string, { label: string; tone: string }> = {
  planned: { label: "Planned", tone: "info" },
  live: { label: "Live now", tone: "ok" },
  held: { label: "Held", tone: "off" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

export const MINUTES_STATUS: Record<string, { label: string; tone: string }> = {
  none: { label: "No minutes yet", tone: "off" },
  writing: { label: "Minutes being written", tone: "info" },
  ready: { label: "Minutes to approve", tone: "warn" },
  failed: { label: "Minutes failed", tone: "bad" },
  approved: { label: "Minutes approved", tone: "ok" },
};

export const POINT_KIND: Record<string, string> = { issue: "Issue", decision: "Decision", action: "Action", note: "Note" };
export const POINT_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Open", tone: "warn" },
  in_progress: { label: "In progress", tone: "info" },
  done: { label: "Done", tone: "ok" },
  cancelled: { label: "Dropped", tone: "off" },
};

export const FREQUENCY: Record<string, string> = {
  daily: "Every working day (Mon–Sat)",
  weekly: "Weekly",
  fortnightly: "Every two weeks",
  monthly: "Monthly",
  once: "Once",
};
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const PRESENTER_MODES: Record<string, string> = {
  chosen: "Chosen for each meeting",
  fixed: "Always the same person",
  rotate: "Takes turns",
};
export const AUDIENCES: Record<string, string> = { everyone: "Everyone", roles: "Some roles", people: "Chosen people" };
export const LANGUAGES: Record<string, string> = { both: "Kiswahili and English", sw: "Kiswahili", en: "English" };

export const PROPOSAL_LABEL: Record<string, string> = {
  crm_note: "CRM note",
  followup: "Quotation or invoice follow-up",
  opportunity_stage: "Opportunity stage",
  requisition: "Purchase request",
  compliance_date: "Compliance due date",
  corrective_action: "Corrective action",
  calendar_entry: "Calendar date",
  next_meeting: "Next meeting",
  task: "Task for someone",
};
export const PROPOSAL_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Waiting for approval", tone: "warn" },
  applied: { label: "Approved and made", tone: "ok" },
  rejected: { label: "Rejected", tone: "off" },
};

export const INVITATION_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "To answer", tone: "warn" },
  accepted: { label: "Accepted", tone: "ok" },
  declined: { label: "Declined", tone: "off" },
  cancelled: { label: "Cancelled", tone: "off" },
};

/** What the chair reads before the recording starts (from Cocozania's meetings). */
export const ANNOUNCE = {
  sw: "Mkutano huu unarekodiwa ili tukumbuke tulichojadili na tuweze kufuatilia kila jambo. Tafadhali zungumza mmoja mmoja na kwa uwazi, na taja jina lako unapoanza kuzungumza.",
  en: "This meeting is recorded so we remember what we discussed and can follow up on everything. Please speak one at a time and clearly, and say your name when you start.",
};

export type Meeting = {
  id: string;
  company_id: string;
  series_id: string | null;
  title: string;
  purpose: string | null;
  kind: string;
  starts_at: string;
  meeting_date: string;
  minutes: number;
  place: string | null;
  topics: string[];
  chair_id: string | null;
  presenter_id: string | null;
  client_id: string | null;
  supplier_id: string | null;
  open_to_team: boolean;
  status: string;
  cancel_reason: string | null;
  record: boolean;
  language: string;
  video_provider: string;
  video_room: string;
  video_url: string | null;
  external_link: string | null;
  announced_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  minutes_status: string;
  minutes_summary: MinutesSummary | null;
  minutes_by: string | null;
  minutes_error: string | null;
  minutes_requested_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  invitation_id: string | null;
  created_by: string | null;
};

export type MinutesSummary = {
  /** 2 = paragraph minutes (v1.25). */
  format?: number;
  summary?: string;
  sections?: { title: string; topic: string; discussion: string; decisions: string }[];
  risks?: string[];
  next_meeting?: string;
  summary_sw?: string;
  topics?: { topic: string; points: string[] }[];
  suggestions?: string[];
  unclear?: string[];
  language_note?: string;
  follow_up?: { point_id: string; status: string; note: string }[];
  proposals?: number;
};

/** A recording of a meeting (v1.25 SQL). */
export type Recording = {
  id: string;
  meeting_id: string;
  started_by: string | null;
  started_at: string;
  ended_at: string | null;
  last_part_at: string | null;
  status: string;
  duration_seconds: number;
  size_bytes: number;
  parts: number;
  mime: string;
  storage_path: string;
  language: string;
  expires_at: string | null;
  deleted_at: string | null;
  delete_reason: string | null;
  transcript: string;
  transcript_status: string;
  transcript_error: string | null;
  transcript_requested_at: string | null;
  summary: string;
  summary_sw: string;
  summary_status: string;
  summary_error: string | null;
};

export const RECORDING_COLUMNS =
  "id, meeting_id, started_by, started_at, ended_at, last_part_at, status, duration_seconds, size_bytes, parts, mime, storage_path, language, expires_at, deleted_at, delete_reason, transcript, transcript_status, transcript_error, transcript_requested_at, summary, summary_sw, summary_status, summary_error";

/** "Delete meeting recordings after" (0 = keep). */
export const RECORDING_DAYS: [number, string][] = [
  [7, "7 days"],
  [30, "30 days"],
  [90, "90 days"],
  [365, "1 year"],
  [0, "Keep them"],
];

/** A recording is "on" (the red banner) while it records and a piece came in the last two minutes. */
export function recordingActive(r: Pick<Recording, "status" | "deleted_at" | "last_part_at" | "started_at">, now = Date.now()): boolean {
  return r.status === "recording" && !r.deleted_at && now - Date.parse(r.last_part_at ?? r.started_at) < 2 * 60_000;
}

/** "1 h 05 min", "12 min", "40 s". */
export function durationLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}

/** Where a meeting is in its life, for the stage bar: plan, meet, minutes, follow up. */
export function meetingStage(m: Pick<Meeting, "status" | "minutes_status">): 0 | 1 | 2 | 3 {
  if (m.status === "planned" || m.status === "cancelled") return 0;
  if (m.status === "live") return 1;
  return m.minutes_status === "approved" ? 3 : 2;
}

export type Attendee = {
  id: string;
  meeting_id: string;
  user_id: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  guest_org: string | null;
  client_id: string | null;
  supplier_id: string | null;
  role: string;
  response: string;
  joined_at: string | null;
  present: boolean;
};

export type AgendaItem = {
  id: string;
  sort: number;
  topic: string | null;
  title: string;
  detail: string | null;
  source: string;
  source_ref: string | null;
  owner_id: string | null;
  minutes: number | null;
  done: boolean;
};

export type Point = {
  id: string;
  meeting_id: string;
  kind: string;
  body: string;
  raised_by: string | null;
  owner_id: string | null;
  owner_name: string | null;
  due_on: string | null;
  status: string;
  severity: string | null;
  topic: string | null;
  client_id: string | null;
  supplier_id: string | null;
  quotation_id: string | null;
  purchase_order_id: string | null;
  carried_from: string | null;
  approved: boolean;
  source: string;
  sort: number;
  done_note: string | null;
  done_at: string | null;
};

export type Proposal = {
  id: string;
  meeting_id: string;
  point_id: string | null;
  target: string;
  title: string;
  payload: Record<string, unknown>;
  status: string;
  source: string;
  decision_note: string | null;
  applied_ref: string | null;
  decided_by: string | null;
  decided_at: string | null;
};

export type Invitation = {
  id: string;
  source: string;
  requester_name: string;
  requester_company: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  topic: string;
  message: string | null;
  proposed_at: string;
  minutes: number;
  external_link: string | null;
  client_id: string | null;
  supplier_id: string | null;
  status: string;
  reply: string | null;
  meeting_id: string | null;
  decided_at: string | null;
  created_at: string;
};

export type MeetingSummary = {
  next: { id: string; title: string; starts_at: string; status: string } | null;
  live: number;
  to_approve: number;
  my_actions: number;
  my_overdue: number;
  open_actions: number;
  requests: number;
  proposals: number;
  can_organise: boolean;
  is_manager: boolean;
};

export type AgendaCandidate = {
  key: string;
  topic: string;
  title: string;
  detail: string | null;
  weight: number;
  ref: string;
  source?: string;
  /** Added by the AI: why it matters now. */
  why?: string;
};

export const MEETING_COLUMNS =
  "id, company_id, series_id, title, purpose, kind, starts_at, meeting_date, minutes, place, topics, chair_id, presenter_id, client_id, supplier_id, open_to_team, status, cancel_reason, record, language, video_provider, video_room, video_url, external_link, announced_at, started_at, ended_at, minutes_status, minutes_summary, minutes_by, minutes_error, minutes_requested_at, approved_at, approved_by, invitation_id, created_by";

/** The person can manage this meeting (organiser, chair or management): mirrors public.meeting_can_manage. */
export function canManage(m: Pick<Meeting, "created_by" | "chair_id">, userId: string, roles: RoleSet): boolean {
  return hasRole(roles, "management") || (canOrganise(roles) && (m.created_by === userId || m.chair_id === userId));
}

/** Management or the chair approves the minutes (public.meeting_can_approve). */
export function canApprove(m: Pick<Meeting, "chair_id">, userId: string, roles: RoleSet): boolean {
  return hasRole(roles, "management") || (canOrganise(roles) && m.chair_id === userId);
}

/** Can a guest or member join now (15 minutes before the start, while live)? */
export function joinOpen(m: Pick<Meeting, "status" | "starts_at">, now = Date.now()): boolean {
  return m.status === "live" || (m.status === "planned" && now >= Date.parse(m.starts_at) - 15 * 60_000);
}

export function endsAt(m: Pick<Meeting, "starts_at" | "minutes">): string {
  return new Date(Date.parse(m.starts_at) + m.minutes * 60_000).toISOString();
}

/** Short text describing a proposal's change, for the review list. */
export function proposalLines(p: Pick<Proposal, "target" | "payload">, names: Map<string, string>, labels: Map<string, string>): string[] {
  const v = p.payload ?? {};
  const g = (k: string) => (v[k] === undefined || v[k] === null || v[k] === "" ? null : String(v[k]));
  const who = (k: string) => (g(k) ? (names.get(g(k)!) ?? "someone") : null);
  const rec = (k: string) => (g(k) ? (labels.get(g(k)!) ?? "a record") : null);
  const out: [string, string | null][] = [];
  switch (p.target) {
    case "crm_note":
      out.push(["Client", rec("client_id")], ["Opportunity", rec("opportunity_id")], ["Note", g("summary")], ["Next", g("next_action")], ["Next date", g("next_on")]);
      break;
    case "followup":
      out.push(["Quotation", rec("quotation_id")], ["Invoice", rec("invoice_id")], ["Note", g("note")], ["Next date", g("next_on")]);
      break;
    case "opportunity_stage":
      out.push(["Opportunity", rec("opportunity_id")], ["New stage", g("stage")], ["Reason", g("reason")]);
      break;
    case "requisition": {
      out.push(["Reason", g("reason")], ["Needed by", g("needed_by")]);
      const lines = Array.isArray(v.lines) ? (v.lines as Record<string, unknown>[]) : [];
      for (const l of lines) out.push(["Item", `${l.quantity ?? ""} ${l.unit ?? ""} ${l.description ?? ""}`.replace(/\s+/g, " ").trim()]);
      break;
    }
    case "compliance_date":
      out.push(["Requirement", rec("item_id")], ["New due date", g("due_on")]);
      break;
    case "corrective_action":
      out.push(["For", rec("source_id")], ["Action", g("action")], ["Owner", who("owner_id")], ["Due", g("due_on")]);
      break;
    case "calendar_entry":
      out.push(["Title", g("title")], ["Date", [g("starts_on"), g("ends_on")].filter(Boolean).join(" to ")], ["Time", g("at_time")], ["Owner", who("owner_id")], ["Said", g("phrase")]);
      break;
    case "next_meeting":
      out.push(["When", g("starts_at")], ["Title", g("title")]);
      break;
    case "task":
      out.push(["Task", g("text")], ["Owner", who("owner_id")], ["Due", g("due_on")]);
      break;
  }
  return out.filter(([, x]) => x).map(([k, x]) => `${k}: ${x}`);
}
