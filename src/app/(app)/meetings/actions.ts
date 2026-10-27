"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { siteUrl } from "@/lib/supabase/env";
import { fromLocalInput } from "@/lib/services";
import { sendEmailReply } from "@/lib/inbox/server";
import { waLink } from "@/lib/inbox/whatsapp";
import { aiReady } from "@/lib/ai/claude";
import { minutesInline } from "@/lib/ai/meetings";
import { buildMinutesBrief } from "@/lib/meetings/brief";
import { MEETING_COLUMNS, MEETING_TOPICS, PROPOSAL_TARGETS, recordingActive, type Meeting, type Recording } from "@/lib/meetings/model";
import { plainMinutes, trimBrief, type MinutesBrief } from "@/lib/meetings/minutes-core";
import { transcriptionReady } from "@/lib/meetings/recording-core";
import { dispatchBackground, transcribePromptFor } from "./background";

const isId = (v: string | null | undefined): v is string => !!v && /^[0-9a-f-]{36}$/.test(v);
const isDate = (v: string | null | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Only paths inside Meetings or the Calendar are used to come back to. */
function backTo(form: FormData, fallback: string): string {
  const b = str(form, "back");
  return (b.startsWith("/meetings") || b.startsWith("/calendar")) && !b.startsWith("//") ? b : fallback;
}

function fail(path: string, message: string): never {
  redirect(withNotice(path, { error: friendlyError(meetingError(message)) }));
}

function done(path: string, msg: string): never {
  revalidatePath("/meetings", "layout");
  revalidatePath("/calendar");
  redirect(withNotice(path, { msg }));
}

function meetingError(message: string): string {
  if (/meetings_series_day_key/.test(message)) return "This regular meeting already has a meeting that day.";
  if (/guest_email/.test(message)) return "Enter a valid email address.";
  if (/guest_phone|requester_phone/.test(message)) return "Enter a valid phone number.";
  if (/foreign key/.test(message)) return "That record was not found in your company.";
  if (/check constraint.*title/.test(message)) return "Give it a title (2 to 160 letters).";
  return message;
}

/** The meeting fields of the new / edit form. */
function meetingValues(form: FormData) {
  const startsAt = fromLocalInput(str(form, "starts_at"));
  // Choosing a client or a supplier on a team meeting makes it a meeting with them.
  const picked = str(form, "kind") || "internal";
  const kind = picked === "internal" && isId(str(form, "client_id")) ? "client" : picked === "internal" && isId(str(form, "supplier_id")) ? "supplier" : picked;
  return {
    title: str(form, "title"),
    purpose: optional(form, "purpose"),
    kind,
    starts_at: startsAt,
    minutes: Number(str(form, "minutes") || 30),
    place: optional(form, "place"),
    topics: form.getAll("topics").filter((t): t is string => typeof t === "string" && (MEETING_TOPICS as readonly string[]).includes(t)),
    chair_id: isId(str(form, "chair_id")) ? str(form, "chair_id") : null,
    presenter_id: isId(str(form, "presenter_id")) ? str(form, "presenter_id") : null,
    client_id: kind === "client" && isId(str(form, "client_id")) ? str(form, "client_id") : null,
    supplier_id: kind === "supplier" && isId(str(form, "supplier_id")) ? str(form, "supplier_id") : null,
    open_to_team: str(form, "open_to_team") === "1",
    record: str(form, "record") === "1",
    language: ["both", "sw", "en"].includes(str(form, "language")) ? str(form, "language") : "both",
    external_link: optional(form, "external_link"),
    attendees: form.getAll("attendees").filter((x): x is string => typeof x === "string" && isId(x)),
  };
}

// ------------------------------------------------------------------ meetings

export async function createMeeting(form: FormData) {
  const path = "/meetings/new";
  const v = meetingValues(form);
  if (!v.starts_at) fail(path, "Choose the date and time of the meeting.");
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.rpc("meeting_create", { p_company: company.id, p: v });
  if (error) fail(path, error.message);
  done(`/meetings/${data}`, "Meeting planned. Everyone invited was told.");
}

export async function updateMeeting(form: FormData) {
  const id = str(form, "id");
  const path = `/meetings/${id}/edit`;
  const v = meetingValues(form);
  if (!v.starts_at) fail(path, "Choose the date and time of the meeting.");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_update", { p_meeting: id, p: v });
  if (error) fail(path, error.message);
  done(`/meetings/${id}`, "Saved.");
}

export async function cancelMeeting(form: FormData) {
  const id = str(form, "id");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_cancel", { p_meeting: id, p_reason: optional(form, "reason") });
  if (error) fail(`/meetings/${id}`, error.message);
  done(`/meetings/${id}`, "Meeting cancelled. Everyone invited was told.");
}

export async function respondMeeting(form: FormData) {
  const id = str(form, "id");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_respond", { p_meeting: id, p_accept: str(form, "accept") === "1" });
  if (error) fail(`/meetings/${id}`, error.message);
  done(`/meetings/${id}`, str(form, "accept") === "1" ? "You will attend." : "You declined.");
}

// ------------------------------------------------------------------ regular meetings

export async function saveSeries(form: FormData) {
  const id = str(form, "id");
  const path = id ? `/meetings/series/${id}` : "/meetings/series/new";
  const { supabase, company } = await getAppContext();
  const p = {
    title: str(form, "title"),
    purpose: optional(form, "purpose"),
    frequency: str(form, "frequency"),
    weekday: str(form, "weekday"),
    month_day: str(form, "month_day"),
    start_date: str(form, "start_date"),
    end_date: str(form, "end_date"),
    start_time: str(form, "start_time"),
    minutes: str(form, "minutes"),
    place: optional(form, "place"),
    topics: form.getAll("topics").filter((t): t is string => typeof t === "string"),
    audience: str(form, "audience"),
    audience_roles: form.getAll("audience_roles").filter((t): t is string => typeof t === "string"),
    audience_people: form.getAll("audience_people").filter((t): t is string => typeof t === "string" && isId(t)),
    chair_id: isId(str(form, "chair_id")) ? str(form, "chair_id") : null,
    presenter_mode: str(form, "presenter_mode"),
    presenter_id: isId(str(form, "presenter_id")) ? str(form, "presenter_id") : null,
    rotation: form.getAll("rotation").filter((t): t is string => typeof t === "string" && isId(t)),
    record: str(form, "record") === "1",
    language: str(form, "language"),
    active: str(form, "active") !== "0",
  };
  const { data, error } = await supabase.rpc("meeting_save_series", { p_company: company.id, p_series: id || null, p });
  if (error) fail(path, error.message);
  await supabase.rpc("meeting_schedule_series", { p_company: company.id, p_days: 14 });
  done(`/meetings/series/${data}`, "Saved. The meetings of the next two weeks are on the calendar.");
}

// ------------------------------------------------------------------ guests

export async function addGuest(form: FormData) {
  const id = str(form, "meeting_id");
  const path = `/meetings/${id}#guests`;
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_add_guest", {
    p_meeting: id,
    p: {
      name: str(form, "name"),
      email: optional(form, "email"),
      phone: optional(form, "phone"),
      org: optional(form, "org"),
      client_id: isId(str(form, "client_id")) ? str(form, "client_id") : null,
      supplier_id: isId(str(form, "supplier_id")) ? str(form, "supplier_id") : null,
    },
  });
  if (error) fail(path, error.message);
  done(path, "Guest added. Send them their link below.");
}

export async function removeAttendee(form: FormData) {
  const id = str(form, "meeting_id");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_remove_attendee", { p_attendee: str(form, "attendee_id") });
  if (error) fail(`/meetings/${id}`, error.message);
  done(`/meetings/${id}#guests`, "Removed.");
}

export type GuestLinkState = { url?: string; wa?: string | null; msg?: string; error?: string };

/** A new guest link (the old one stops working): shown once, emailed, or opened in WhatsApp. */
export async function guestLink(_prev: GuestLinkState, form: FormData): Promise<GuestLinkState> {
  const attendee = str(form, "attendee_id");
  const how = str(form, "how");
  const { supabase, company } = await getAppContext();
  const { data: a } = await supabase
    .from("meeting_attendees")
    .select("id, meeting_id, guest_name, guest_email, guest_phone")
    .eq("id", attendee)
    .maybeSingle();
  if (!a) return { error: "Guest not found." };
  const { data: m } = await supabase.from("meetings").select("id, title, starts_at").eq("id", a.meeting_id).maybeSingle();
  if (!m) return { error: "Meeting not found." };
  const { data: token, error } = await supabase.rpc("meeting_guest_link", { p_attendee: attendee, p_days: 14 });
  if (error || typeof token !== "string") return { error: friendlyError(error?.message) };
  const url = `${siteUrl()}/meet/${token}`;
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(m.starts_at));
  const text = `Hello ${a.guest_name ?? ""}, ${company.name} invites you to "${m.title}" on ${when} (Tanzania time). Join here: ${url}`;
  if (how === "email") {
    if (!a.guest_email) return { url, error: "This guest has no email address. Copy the link instead." };
    const sent = await sendEmailReply(
      {
        to: [a.guest_email],
        cc: [],
        subject: `Meeting invitation: ${m.title}`,
        text: `${text}\n\nThe link opens the meeting page; no account is needed. It stops working after the meeting.\n\n${company.name}`,
        html: `<p>Hello ${esc(a.guest_name ?? "")},</p><p>${esc(company.name)} invites you to <strong>${esc(m.title)}</strong> on ${esc(when)} (Tanzania time).</p><p><a href="${esc(url)}">Join the meeting</a></p><p style="color:#667">The link opens the meeting page; no account is needed. It stops working after the meeting.</p><p>${esc(company.name)}</p>`,
        replyTo: company.email ?? null,
        fromName: company.name,
        inReplyTo: null,
        references: [],
      },
      null,
    );
    return sent.ok ? { url, msg: `Invitation emailed to ${a.guest_email}.` } : { url, error: `The email could not be sent: ${sent.error}` };
  }
  if (how === "whatsapp") {
    const wa = a.guest_phone ? waLink(a.guest_phone, text) : null;
    return wa ? { url, wa } : { url, error: "This guest has no phone number. Copy the link instead." };
  }
  return { url, msg: "New link made. Copy it and send it to the guest; older links stop working." };
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ------------------------------------------------------------------ agenda

export async function addAgendaItem(form: FormData) {
  const id = str(form, "meeting_id");
  const path = backTo(form, `/meetings/${id}#agenda`);
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_add_agenda", {
    p_meeting: id,
    p_items: [{ title: str(form, "title"), detail: optional(form, "detail"), topic: optional(form, "topic"), owner_id: optional(form, "owner_id"), minutes: optional(form, "minutes") }],
  });
  if (error) fail(path, error.message);
  done(path, "Added to the agenda.");
}

/** The ticked suggestions (each checkbox carries the item as JSON). */
export async function addSuggested(form: FormData) {
  const id = str(form, "meeting_id");
  const items = form
    .getAll("pick")
    .map((x) => {
      try {
        const j = JSON.parse(String(x)) as Record<string, unknown>;
        return { title: String(j.title ?? "").slice(0, 300), detail: j.detail ? String(j.detail).slice(0, 1000) : null, topic: j.topic ?? null, source: j.source === "follow_up" ? "follow_up" : "suggested", source_ref: String(j.ref ?? "").slice(0, 120) || null };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, 40);
  if (!items.length) fail(`/meetings/${id}/suggest`, "Tick at least one topic.");
  const { supabase } = await getAppContext();
  const { data, error } = await supabase.rpc("meeting_add_agenda", { p_meeting: id, p_items: items });
  if (error) fail(`/meetings/${id}/suggest`, error.message);
  done(`/meetings/${id}#agenda`, `${Number(data ?? 0)} topic(s) added to the agenda.`);
}

export async function agendaItem(form: FormData) {
  const id = str(form, "meeting_id");
  const path = backTo(form, `/meetings/${id}#agenda`);
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_agenda_item", { p_item: str(form, "item_id"), p_action: str(form, "action") });
  if (error) fail(path, error.message);
  revalidatePath(`/meetings/${id}`);
  redirect(path);
}

// ------------------------------------------------------------------ holding the meeting

export async function startMeeting(form: FormData) {
  const id = str(form, "id");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_start", { p_meeting: id, p_announced: str(form, "announced") === "1" });
  if (error) fail(`/meetings/${id}/room`, error.message);
  done(`/meetings/${id}/room`, "The meeting is live. Everyone invited was called to join.");
}

/** From the room: a line of the live transcript or of the typed notes. */
export async function addLine(meetingId: string, kind: "speech" | "typed", text: string, speaker: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!isId(meetingId) || (kind !== "speech" && kind !== "typed")) return { ok: false, error: "Not valid." };
  const t = String(text ?? "").slice(0, 2000);
  if (!t.trim()) return { ok: true };
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_add_line", { p_meeting: meetingId, p_kind: kind, p_text: t, p_speaker: speaker ? String(speaker).slice(0, 60) : null });
  return error ? { ok: false, error: friendlyError(error.message) } : { ok: true };
}

/** The latest transcript and notes, for the room to show what others said and typed. */
export type RoomState = { transcript: string; notes: string; status: string; recording: { id: string; by: string | null; since: string } | null };

export async function roomTexts(meetingId: string): Promise<RoomState | null> {
  if (!isId(meetingId)) return null;
  const { supabase } = await getAppContext();
  const [{ data: t }, { data: m }, rec] = await Promise.all([
    supabase.from("meeting_texts").select("transcript, notes").eq("meeting_id", meetingId).maybeSingle(),
    supabase.from("meetings").select("status").eq("id", meetingId).maybeSingle(),
    supabase.from("meeting_recordings").select("id, started_by, started_at, last_part_at, status, deleted_at").eq("meeting_id", meetingId).eq("status", "recording").maybeSingle(),
  ]);
  if (!m) return null;
  const r = rec.error ? null : (rec.data as Pick<Recording, "id" | "started_by" | "started_at" | "last_part_at" | "status" | "deleted_at"> | null);
  return {
    transcript: String(t?.transcript ?? "").slice(-20000),
    notes: String(t?.notes ?? "").slice(-20000),
    status: String(m.status),
    recording: r && recordingActive(r) ? { id: r.id, by: r.started_by, since: r.started_at } : null,
  };
}

/** The person pressed Join (recorded once; who joined shows on the meeting page). */
export async function joinedMeeting(meetingId: string): Promise<void> {
  if (!isId(meetingId)) return;
  const { supabase } = await getAppContext();
  await supabase.rpc("meeting_joined", { p_meeting: meetingId });
}

export async function setPresent(form: FormData) {
  const id = str(form, "meeting_id");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_set_present", { p_attendee: str(form, "attendee_id"), p_present: str(form, "present") === "1" });
  if (error) fail(backTo(form, `/meetings/${id}`), error.message);
  revalidatePath(`/meetings/${id}`);
  redirect(backTo(form, `/meetings/${id}`));
}

export async function saveTexts(form: FormData) {
  const id = str(form, "id");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_save_text", { p_meeting: id, p_transcript: String(form.get("transcript") ?? ""), p_notes: String(form.get("notes") ?? "") });
  if (error) fail(`/meetings/${id}/minutes`, error.message);
  done(`/meetings/${id}/minutes`, "Notes saved. Write the minutes again to use them.");
}

export async function endMeeting(form: FormData) {
  const id = str(form, "id");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_end", { p_meeting: id });
  if (error) fail(`/meetings/${id}/room`, error.message);
  let msg = "The meeting has ended.";
  if (str(form, "write") === "1") {
    try {
      msg = `The meeting has ended. ${await writeMinutesFor(id, minutesOptions(form), true)}`;
    } catch (e) {
      fail(`/meetings/${id}/minutes`, `The meeting has ended, but the minutes could not be written: ${(e as Error).message}`);
    }
  }
  done(`/meetings/${id}/minutes`, msg);
}

/** The minutes options of the End / Write forms. */
function minutesOptions(form: FormData): NonNullable<MinutesBrief["options"]> {
  const cap = str(form, "capture_language");
  return { swahili_summary: str(form, "swahili_summary") === "1", ...(["sw", "en", "mixed"].includes(cap) ? { capture_language: cap } : {}) };
}

// ------------------------------------------------------------------ minutes

/**
 * Writes the minutes: with the AI in the background on Netlify (paragraph minutes take longer than one 10-second
 * request), within this request elsewhere, and the app's plain minutes from the typed notes when AI is off or does
 * not answer. When the meeting was recorded and the live speech capture caught little of it, the recording is first
 * written down (server-side transcription, when set up) and the minutes use it. Returns a message.
 */
async function writeMinutesFor(id: string, options: NonNullable<MinutesBrief["options"]>, autoTranscribe = false): Promise<string> {
  const { supabase, company } = await getAppContext();
  const { data: m } = await supabase.from("meetings").select(MEETING_COLUMNS).eq("id", id).maybeSingle();
  if (!m) throw new Error("Meeting not found.");
  const meeting = m as unknown as Meeting;
  const brief = await buildMinutesBrief(supabase, meeting, company.name, options);

  // Recordings to write down first: those with audio and no transcript, when the live capture caught little.
  let toTranscribe: string[] = [];
  if (autoTranscribe && transcriptionReady()) {
    const { data: recs, error: recErr } = await supabase
      .from("meeting_recordings")
      .select("id, parts, duration_seconds, transcript_status")
      .eq("meeting_id", id)
      .is("deleted_at", null)
      .gt("parts", 0)
      .in("transcript_status", ["none", "failed"]);
    const rows = recErr ? [] : ((recs ?? []) as Pick<Recording, "id" | "parts" | "duration_seconds" | "transcript_status">[]);
    const minutesRecorded = rows.reduce((t, r) => t + r.duration_seconds, 0) / 60;
    // About 700 characters are spoken a minute; less than a fifth of that caught live means the capture was weak.
    if (rows.length && brief.transcript.length < minutesRecorded * 150) toTranscribe = rows.map((r) => r.id);
  }

  if (!aiReady() && !toTranscribe.length) {
    const { error } = await supabase.rpc("meeting_save_minutes", { p_meeting: id, p: plainMinutes(brief) });
    if (error) throw new Error(error.message);
    return "Minutes written from the typed notes (AI is not switched on). Check them and approve.";
  }

  // On Netlify: a background function (it may take a minute or two).
  const st = await supabase.rpc("meeting_minutes_state", { p_meeting: id, p_state: "writing", p_error: null });
  if (st.error) throw new Error(st.error.message);
  if (toTranscribe.length) {
    for (const r of toTranscribe) await supabase.rpc("meeting_recording_state", { p_recording: r, p_what: "transcript", p_state: "writing", p_error: null });
    const sent = await dispatchBackground(supabase, "meeting-recording-background", {
      action: "transcribe",
      recording_ids: toTranscribe,
      prompt: transcribePromptFor(brief),
      brief: trimBrief({ ...brief, recording_transcript: undefined }),
    });
    if (sent) return "The recording is being written down, then the AI writes the minutes from it. This page updates when they are ready (usually within a few minutes).";
    for (const r of toTranscribe) await supabase.rpc("meeting_recording_state", { p_recording: r, p_what: "transcript", p_state: "failed", p_error: "Writing down the recording runs on the live site only." });
  } else if (aiReady() && (await dispatchBackground(supabase, "meeting-minutes-background", { meeting_id: id, brief: trimBrief(brief) }))) {
    return "The AI is writing the minutes. This page updates when they are ready (usually within two minutes).";
  }

  const ai = aiReady() ? await minutesInline(trimBrief(brief, 40_000)) : ({ ok: false, reason: "off" } as const);
  if (ai.ok) {
    const { error } = await supabase.rpc("meeting_save_minutes", { p_meeting: id, p: ai.minutes });
    if (!error) return "The AI wrote the minutes. Check every point and approve.";
  }
  const { error } = await supabase.rpc("meeting_save_minutes", { p_meeting: id, p: plainMinutes(brief) });
  if (error) throw new Error(error.message);
  await supabase.rpc("meeting_minutes_state", {
    p_meeting: id,
    p_state: "failed",
    p_error:
      !ai.ok && ai.reason === "off"
        ? "AI is not switched on. The app wrote plain minutes from the notes."
        : !ai.ok && ai.reason === "timeout"
          ? "The AI took too long. The app wrote plain minutes from the notes instead."
          : "The AI could not write the minutes. The app wrote plain minutes from the notes instead.",
  });
  return "Minutes written from the typed notes. Check them and approve.";
}

export async function writeMinutes(form: FormData) {
  const id = str(form, "id");
  const path = `/meetings/${id}/minutes`;
  let msg: string;
  try {
    msg = await writeMinutesFor(id, minutesOptions(form), str(form, "transcribe") === "1");
  } catch (e) {
    fail(path, (e as Error).message);
  }
  done(path, msg);
}

function pointValues(form: FormData) {
  return {
    kind: str(form, "kind"),
    body: str(form, "body"),
    owner_id: isId(str(form, "owner_id")) ? str(form, "owner_id") : null,
    owner_name: optional(form, "owner_name"),
    due_on: isDate(str(form, "due_on")) ? str(form, "due_on") : null,
    severity: optional(form, "severity"),
    topic: optional(form, "topic"),
    raised_by: optional(form, "raised_by"),
    client_id: isId(str(form, "client_id")) ? str(form, "client_id") : null,
    supplier_id: isId(str(form, "supplier_id")) ? str(form, "supplier_id") : null,
    quotation_id: isId(str(form, "quotation_id")) ? str(form, "quotation_id") : null,
    purchase_order_id: isId(str(form, "purchase_order_id")) ? str(form, "purchase_order_id") : null,
  };
}

export async function savePoint(form: FormData) {
  const meeting = str(form, "meeting_id");
  const point = str(form, "point_id");
  const path = `/meetings/${meeting}/minutes`;
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_save_point", { p_meeting: meeting, p_point: point || null, p: pointValues(form) });
  if (error) fail(path, error.message);
  done(`${path}#points`, "Saved.");
}

export async function deletePoint(form: FormData) {
  const meeting = str(form, "meeting_id");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_delete_point", { p_point: str(form, "point_id") });
  if (error) fail(`/meetings/${meeting}/minutes`, error.message);
  done(`/meetings/${meeting}/minutes#points`, "Removed.");
}

export async function setPointStatus(form: FormData) {
  const path = backTo(form, "/meetings/actions");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_set_point_status", { p_point: str(form, "point_id"), p_status: str(form, "status"), p_note: optional(form, "note") });
  if (error) fail(path, error.message);
  done(path, "Updated.");
}

export async function approveMinutes(form: FormData) {
  const id = str(form, "id");
  const path = `/meetings/${id}/minutes`;
  const { supabase } = await getAppContext();
  const { data, error } = await supabase.rpc("meeting_approve_minutes", { p_meeting: id });
  if (error) fail(path, error.message);
  const n = Number(data ?? 0);
  done(path, n ? `Minutes approved. ${n} action owner(s) were told.` : "Minutes approved.");
}

// ------------------------------------------------------------------ proposed updates

const PAYLOAD_KEYS = [
  "client_id", "opportunity_id", "quotation_id", "invoice_id", "item_id", "source_kind", "source_id", "owner_id", "summary",
  "next_action", "next_on", "note", "notes", "stage", "reason", "due_on", "needed_by", "title", "kind", "starts_on", "ends_on",
  "at_time", "text", "action", "phrase",
];

/** Payload fields from the form (f_<key>); purchase lines as "20 pail Grease 18kg", one per line. */
function payloadFrom(form: FormData, target: string): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  for (const k of PAYLOAD_KEYS) {
    const v = str(form, `f_${k}`);
    if (v) p[k] = v;
  }
  const at = str(form, "f_starts_at");
  if (at) p.starts_at = fromLocalInput(at) ?? at;
  if (target === "requisition") {
    p.lines = String(form.get("f_lines") ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 30)
      .map((l) => {
        const m = l.match(/^(\d+(?:[.,]\d+)?)\s+(?:(\S{1,20})\s+)?(.+)$/);
        return m ? { quantity: m[1].replace(",", "."), unit: m[2] ?? null, description: m[3] } : { quantity: "1", description: l };
      });
    // Lines left as they were keep their product links.
    if (form.get("f_lines_json")) {
      try {
        const j = JSON.parse(String(form.get("f_lines_json"))) as Record<string, unknown>[];
        const shown = Array.isArray(j) ? j.map((l) => [l.quantity, l.unit, l.description].filter(Boolean).join(" ")).join("\n") : null;
        if (Array.isArray(j) && shown !== null && shown.trim() === String(form.get("f_lines") ?? "").replace(/\r/g, "").trim()) p.lines = j;
      } catch {
        /* the typed lines are used */
      }
    }
  }
  return p;
}

export async function addProposal(form: FormData) {
  const meeting = str(form, "meeting_id");
  const target = str(form, "target");
  const path = `/meetings/${meeting}/minutes#updates`;
  if (!(PROPOSAL_TARGETS as readonly string[]).includes(target)) fail(path, "Choose what to update.");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_proposal_add", {
    p_meeting: meeting,
    p_target: target,
    p_title: optional(form, "title"),
    p_payload: payloadFrom(form, target),
    p_point: isId(str(form, "point_id")) ? str(form, "point_id") : null,
  });
  if (error) fail(path, error.message);
  done(path, "Proposed. Management approves it before anything changes.");
}

export async function editProposal(form: FormData) {
  const meeting = str(form, "meeting_id");
  const path = `/meetings/${meeting}/minutes#updates`;
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_proposal_edit", {
    p_proposal: str(form, "proposal_id"),
    p_title: optional(form, "title"),
    p_payload: payloadFrom(form, str(form, "target")),
  });
  if (error) fail(path, error.message);
  done(path, "Change saved. Approve it to make it.");
}

export async function decideProposal(form: FormData) {
  const meeting = str(form, "meeting_id");
  const path = `/meetings/${meeting}/minutes#updates`;
  const approve = str(form, "approve") === "1";
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("meeting_proposal_decide", { p_proposal: str(form, "proposal_id"), p_approve: approve, p_note: optional(form, "note") });
  if (error) fail(path, `Nothing was changed: ${error.message}`);
  done(path, approve ? "Approved: the update was made." : "Rejected: nothing was changed.");
}

// ------------------------------------------------------------------ invitations and the request page

export async function setPortal(form: FormData) {
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.rpc("meeting_portal_set", {
    p_company: company.id,
    p_enabled: str(form, "enabled") !== "0",
    p_new: str(form, "new") === "1",
    p_welcome: optional(form, "welcome"),
  });
  if (error) fail("/meetings/portal", error.message);
  done("/meetings/portal", str(form, "new") === "1" ? "New link made. The old link no longer works." : "Saved.");
}

export async function addInvitation(form: FormData) {
  const path = "/meetings/invitations/new";
  const startsAt = fromLocalInput(str(form, "starts_at"));
  if (!startsAt) fail(path, "Choose the date and time of the meeting.");
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.rpc("meeting_add_invitation", {
    p_company: company.id,
    p: {
      title: str(form, "title"),
      starts_at: startsAt,
      minutes: str(form, "minutes") || "60",
      link: str(form, "link"),
      organiser: optional(form, "organiser"),
      organiser_company: optional(form, "organiser_company"),
      organiser_email: optional(form, "organiser_email"),
      notes: optional(form, "notes"),
      client_id: isId(str(form, "client_id")) ? str(form, "client_id") : null,
      supplier_id: isId(str(form, "supplier_id")) ? str(form, "supplier_id") : null,
      attendees: form.getAll("attendees").filter((x): x is string => typeof x === "string" && isId(x)),
    },
  });
  if (error) fail(path, error.message);
  done(`/meetings/${data}`, "Invitation added to the calendar with its link.");
}

export async function decideInvitation(form: FormData) {
  const id = str(form, "id");
  const path = `/meetings/invitations/${id}`;
  const accept = str(form, "accept") === "1";
  const reply = optional(form, "reply");
  const { supabase, company } = await getAppContext();
  const { data: inv } = await supabase.from("meeting_invitations").select("requester_name, requester_email, topic, proposed_at").eq("id", id).maybeSingle();
  const startsAt = fromLocalInput(str(form, "starts_at"));
  const { data, error } = await supabase.rpc("meeting_decide_invitation", {
    p_invitation: id,
    p_accept: accept,
    p_reply: reply,
    p_starts_at: accept ? startsAt : null,
    p_attendees: form.getAll("attendees").filter((x): x is string => typeof x === "string" && isId(x)),
  });
  if (error) fail(path, error.message);
  // Tell the person who asked (by email) when wanted.
  let note = "";
  if (str(form, "email") === "1" && inv?.requester_email) {
    const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(startsAt ?? inv.proposed_at));
    let link = "";
    if (accept && data) {
      // Their own link, or a guest link to our room.
      const { data: g } = await supabase.from("meeting_attendees").select("id").eq("meeting_id", data).is("user_id", null).limit(1).maybeSingle();
      const { data: m } = await supabase.from("meetings").select("external_link").eq("id", data).maybeSingle();
      if (m?.external_link) link = m.external_link;
      else if (g) {
        const { data: token } = await supabase.rpc("meeting_guest_link", { p_attendee: g.id, p_days: 30 });
        if (typeof token === "string") link = `${siteUrl()}/meet/${token}`;
      }
    }
    const body = accept
      ? `Hello ${inv.requester_name},\n\nThank you. ${company.name} accepts the meeting "${inv.topic}" on ${when} (Tanzania time).${link ? `\nJoin here: ${link}` : ""}${reply ? `\n\n${reply}` : ""}\n\n${company.name}`
      : `Hello ${inv.requester_name},\n\nThank you for your request about "${inv.topic}". ${reply ?? "We cannot meet at that time."}\n\n${company.name}`;
    const sent = await sendEmailReply(
      {
        to: [inv.requester_email],
        cc: [],
        subject: accept ? `Meeting confirmed: ${inv.topic}` : `About your meeting request: ${inv.topic}`,
        text: body,
        html: body.split("\n").map((l) => `<p>${esc(l)}</p>`).join("").replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>'),
        replyTo: company.email ?? null,
        fromName: company.name,
        inReplyTo: null,
        references: [],
      },
      null,
    );
    note = sent.ok ? ` ${inv.requester_name} was told by email.` : ` The email could not be sent (${sent.error}).`;
  }
  if (accept && data) done(`/meetings/${data}`, `Accepted: the meeting is on the calendar.${note}`);
  done("/meetings/invitations", `Declined.${note}`);
}
