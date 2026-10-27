// Unit tests for the meeting AI prompts, the check of the AI's minutes, the minutes formatter and the recording
// helpers (no network):  npx tsx --test src/lib/meetings/__tests__/minutes.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { MINUTES_SYSTEM, minutesInstructions, minutesUserText, plainMinutes, SWAHILI_GUIDE, trimBrief, validateMinutes, type MinutesBrief } from "../minutes-core";
import { buildMinutesDoc, formatDue, minutesText, splitParagraphs } from "../minutes-format";
import { RECORDING_SUMMARY_SYSTEM, recordingSummaryUser, segmentLines, transcribeLanguage, transcribePrompt, validateRecordingSummary } from "../recording-core";
import { extFor, fileNameFor } from "../recording-shared";

const JUMA = "11111111-1111-4111-8111-111111111111";
const ASHA = "22222222-2222-4222-8222-222222222222";

function brief(over: Partial<MinutesBrief> = {}): MinutesBrief {
  return {
    today: "2026-10-27",
    company: "TRIUMPH General Supplies",
    meeting: {
      id: "33333333-3333-4333-8333-333333333333",
      title: "Mkutano wa mauzo",
      date: "2026-10-27",
      start_time: "09:00",
      kind: "internal",
      topics: ["Sales & clients"],
      language: "both",
      purpose: null,
      client: null,
      supplier: null,
    },
    staff: [
      { id: JUMA, name: "Juma Hassan", role: "sales" },
      { id: ASHA, name: "Asha Mrema", role: "finance" },
    ],
    attendees: ["Juma Hassan", "Asha Mrema"],
    guests: [],
    agenda: [{ title: "Geita order", topic: "Sales & clients" }],
    last_time: [],
    records: { clients: [], suppliers: [], quotations: [], invoices: [], opportunities: [], compliance_items: [], incidents: [], ncrs: [], products: [] },
    transcript: "[00:01:10] Juma: Tumekubaliana tutapeleka mafuta Geita Ijumaa.\n",
    notes: "Hatua: Juma atapeleka grease kesho\n",
    ...over,
  };
}

// ------------------------------------------------------------------ prompts

test("every minutes prompt reads Kiswahili, Sheng and mixed speech and keeps numbers exact", () => {
  assert.ok(MINUTES_SYSTEM.includes(SWAHILI_GUIDE));
  assert.ok(RECORDING_SUMMARY_SYSTEM.includes(SWAHILI_GUIDE));
  for (const w of ["Sheng", "code-switching", "tumekubaliana", "saa nne asubuhi", "TZS 1,500,000", "Never add attendees", "laki tano"]) {
    assert.ok(SWAHILI_GUIDE.includes(w), `guide mentions ${w}`);
  }
});

test("the minutes instructions ask for English paragraphs, one section per agenda item, and an action table's facts", () => {
  const t = minutesInstructions(brief());
  assert.match(t, /PARAGRAPHS|paragraphs/);
  assert.match(t, /one section per agenda item/);
  assert.match(t, /decisions \(a paragraph on what was decided and why/);
  assert.match(t, /owner_id must be one of the staff ids/);
  assert.match(t, /next_meeting/);
  assert.match(t, /meeting date 2026-10-27/);
  assert.match(t, /captured the speech as Kiswahili/);
  assert.match(t, /summary_sw: "" \(not asked for\)/);
});

test("the Kiswahili summary is asked for only when ticked, and the capture language is passed on", () => {
  const t = minutesInstructions(brief({ options: { swahili_summary: true, capture_language: "mixed" } }));
  assert.match(t, /summary_sw: one paragraph \(5 to 8 sentences\) in natural, correct Kiswahili/);
  assert.match(t, /mixes Kiswahili and English/);
  assert.match(minutesInstructions(brief({ options: { capture_language: "en" } })), /captured the speech as English/);
});

test("the user text carries the brief as JSON, with the recording's transcript", () => {
  const u = minutesUserText(brief({ recording_transcript: "--- Recording 1 ---\n[00:00:05] Tuanze kikao." }));
  const json = JSON.parse(u.slice(u.indexOf("\n\n{") + 2)) as MinutesBrief;
  assert.equal(json.meeting.title, "Mkutano wa mauzo");
  assert.match(json.recording_transcript ?? "", /Tuanze kikao/);
  assert.deepEqual(json.attendees, ["Juma Hassan", "Asha Mrema"]);
});

test("trimBrief shares the room between the live transcript and the recording's", () => {
  const long = "a".repeat(200_000);
  const t = trimBrief(brief({ transcript: long, recording_transcript: long, notes: "" }), 100_000);
  assert.ok(t.transcript.length <= 50_100 && t.transcript.length > 40_000);
  assert.ok((t.recording_transcript ?? "").length <= 50_100 && (t.recording_transcript ?? "").length > 40_000);
  const short = trimBrief(brief({ transcript: "short", recording_transcript: long, notes: "" }), 100_000);
  assert.equal(short.transcript, "short");
  assert.ok((short.recording_transcript ?? "").length > 90_000);
  assert.equal(trimBrief(brief()).recording_transcript, undefined);
});

// ------------------------------------------------------------------ the check of the AI's answer

const aiAnswer = {
  summary: "The sales team met to review the Geita order.\n\nThey agreed to deliver on Friday.",
  sections: [
    { title: "Geita order", topic: "Sales & clients", discussion: "Juma said the truck is ready.\n\nAsha said TZS 1,500,000 is still owed.", decisions: "Deliver on Friday because the client asked." },
    { title: "", topic: "", discussion: "dropped", decisions: "" },
    { title: "Empty", topic: "Gossip", discussion: "", decisions: "" },
  ],
  points: [
    { kind: "action", body: "Deliver the oil to Geita", raised_by: "Juma", owner_id: JUMA, owner_name: "", due_on: "2026-10-30", severity: "", topic: "Deliveries", status: "open", uncertain: false },
    { kind: "action", body: "Call the client about payment", raised_by: "", owner_id: "not-a-staff-id", owner_name: "Baraka", due_on: "2030-01-01", severity: "", topic: "", status: "open", uncertain: true },
    { kind: "issue", body: "TZS 1,500,000 is still owed", raised_by: "Asha", owner_id: "", owner_name: "", due_on: "", severity: "high", topic: "Money", status: "open", uncertain: false },
  ],
  risks: ["The client may pay late."],
  next_meeting: "Follow up the payment first.",
  summary_sw: "Timekubaliana kupeleka mafuta Ijumaa.",
  follow_up: [],
  proposals: [],
  suggestions: [],
  unclear: ["\"mzigo wa ... \" was not clear"],
  language_note: "Mostly Kiswahili with some English.",
};

test("validateMinutes keeps paragraphs and sections, and checks owners, dates and uncertain points", () => {
  const v = validateMinutes(aiAnswer, brief())!;
  assert.ok(v);
  assert.equal(v.summary, "The sales team met to review the Geita order.\n\nThey agreed to deliver on Friday.");
  assert.equal(v.sections.length, 1);
  assert.equal(v.sections[0].discussion, "Juma said the truck is ready.\n\nAsha said TZS 1,500,000 is still owed.");
  assert.equal(v.sections[0].topic, "Sales & clients");
  assert.equal(v.points[0].owner_id, JUMA);
  assert.equal(v.points[0].due_on, "2026-10-30");
  assert.equal(v.points[1].owner_id, undefined, "an unknown id is not kept");
  assert.equal(v.points[1].owner_name, "Baraka");
  assert.equal(v.points[1].due_on, undefined, "a date more than two years ahead is dropped");
  assert.match(v.points[1].body, /\(to confirm\)$/);
  assert.deepEqual(v.risks, ["The client may pay late."]);
  assert.equal(v.next_meeting, "Follow up the payment first.");
  assert.equal(v.summary_sw, "", "no Kiswahili summary unless asked for");
  assert.equal(validateMinutes(aiAnswer, brief({ options: { swahili_summary: true } }))!.summary_sw, "Timekubaliana kupeleka mafuta Ijumaa.");
  assert.equal(validateMinutes({ summary: "", points: [], sections: [] }, brief()), null);
  assert.equal(validateMinutes("nonsense", brief()), null);
});

test("plain minutes (no AI) understand Kiswahili markers", () => {
  const p = plainMinutes(brief());
  const action = p.points.find((x) => x.kind === "action");
  assert.ok(action, "Hatua: becomes an action");
  assert.equal(action!.owner_id, JUMA);
  assert.equal(action!.due_on, "2026-10-28", "kesho is tomorrow");
  assert.deepEqual(p.sections, []);
  assert.equal(p.summary_sw, "");
});

// ------------------------------------------------------------------ the minutes formatter

const names = new Map([[JUMA, "Juma Hassan"]]);
const pts = [
  { kind: "action", body: "Call the client (to confirm)", owner_id: null, owner_name: "Baraka", due_on: null, status: "open", severity: null, sort: 10 },
  { kind: "action", body: "Deliver the oil to Geita", owner_id: JUMA, owner_name: null, due_on: "2026-10-30", status: "open", severity: null, sort: 20 },
  { kind: "action", body: "Send the statement", owner_id: JUMA, owner_name: null, due_on: "2026-10-28", status: "done", severity: null, sort: 30 },
  { kind: "decision", body: "Deliver on Friday", owner_id: null, owner_name: null, due_on: null, status: "open", severity: null, sort: 40 },
  { kind: "issue", body: "TZS 1,500,000 owed", owner_id: null, owner_name: null, due_on: null, status: "open", severity: "high", sort: 50 },
];

test("splitParagraphs and formatDue", () => {
  assert.deepEqual(splitParagraphs("One  two.\n\n\nThree\nfour.\n \n"), ["One two.", "Three four."]);
  assert.deepEqual(splitParagraphs(null), []);
  assert.equal(formatDue("2026-10-30"), "Fri 30 Oct 2026");
  assert.equal(formatDue("30/10/2026"), "");
});

test("buildMinutesDoc: sections, actions soonest first with owners, decisions, issues, Kiswahili", () => {
  const doc = buildMinutesDoc(
    { format: 2, summary: aiAnswer.summary, sections: [aiAnswer.sections[0]], risks: ["Late payment."], next_meeting: "Meet on Monday.", summary_sw: "Muhtasari." },
    pts,
    (id) => names.get(id),
  );
  assert.equal(doc.opening.length, 2);
  assert.equal(doc.sections[0].title, "Geita order");
  assert.deepEqual(doc.sections[0].decisions, ["Deliver on Friday because the client asked."]);
  assert.deepEqual(
    doc.actions.map((a) => [a.n, a.what, a.owner, a.matched, a.due, a.uncertain]),
    [
      [1, "Send the statement", "Juma Hassan", true, "2026-10-28", false],
      [2, "Deliver the oil to Geita", "Juma Hassan", true, "2026-10-30", false],
      [3, "Call the client", "Baraka", false, null, true],
    ],
  );
  assert.deepEqual(doc.decisions, ["Deliver on Friday"]);
  assert.deepEqual(doc.issues, [{ text: "TZS 1,500,000 owed", severity: "high" }]);
  assert.deepEqual(doc.swahili, ["Muhtasari."]);
  assert.equal(doc.legacy, false);
  assert.equal(doc.empty, false);
});

test("buildMinutesDoc turns older minutes (points under topics) into paragraphs", () => {
  const doc = buildMinutesDoc({ summary: "Old.", topics: [{ topic: "Stock", points: ["grease is low", "order more."] }] }, [], () => undefined);
  assert.equal(doc.legacy, true);
  assert.deepEqual(doc.sections, [{ title: "Stock", topic: "Stock", discussion: ["Grease is low. Order more."], decisions: [] }]);
  assert.equal(buildMinutesDoc(null, [], () => undefined).empty, true);
});

test("minutesText: headings, paragraphs and a numbered action list with owner and date", () => {
  const doc = buildMinutesDoc({ summary: "Opening.", sections: [{ title: "Geita order", discussion: "Talked.", decisions: "Deliver Friday." }], next_meeting: "Monday." }, pts, (id) => names.get(id));
  const t = minutesText(doc, { company: "TRIUMPH", title: "Sales", when: "Tue 27 Oct 2026, 09:00 – 09:30", attendees: ["Juma Hassan"], approved: null });
  assert.match(t, /^TRIUMPH: minutes of "Sales"/);
  assert.match(t, /Present: Juma Hassan/);
  assert.match(t, /Draft: not approved yet/);
  assert.match(t, /SUMMARY\nOpening\./);
  assert.match(t, /1\. GEITA ORDER\nTalked\.\n\nDecided: Deliver Friday\./);
  assert.match(t, /ACTION ITEMS\n1\. Send the statement \(Juma Hassan, due Wed 28 Oct 2026\)/);
  assert.match(t, /3\. Call the client \(to confirm\) \(Baraka, no due date\)/);
  assert.match(t, /NEXT MEETING\nMonday\./);
  assert.ok(!/\n{3,}/.test(t));
});

// ------------------------------------------------------------------ recordings

test("transcription hints: Kiswahili for Kiswahili and mixed meetings, names and words in the prompt", () => {
  assert.equal(transcribeLanguage("sw"), "sw");
  assert.equal(transcribeLanguage("mixed"), "sw");
  assert.equal(transcribeLanguage("en"), "en");
  const p = transcribePrompt({ company: "TRIUMPH", title: "Mkutano wa mauzo", names: ["Juma Hassan", "Juma Hassan", "A"], lang: "mixed", words: ["Geita Gold Mine"] });
  assert.match(p, /Mkutano wa TRIUMPH/);
  assert.match(p, /Names: Juma Hassan\./);
  assert.match(p, /Geita Gold Mine/);
  assert.ok(p.length <= 900);
  assert.match(transcribePrompt({ company: "T", title: "x", names: [], lang: "en" }), /in English with some Kiswahili/);
});

test("segmentLines writes timestamps; file names follow the audio type", () => {
  assert.equal(segmentLines([{ start: 65.4, text: " Tuanze  kikao " }, { start: 3700, text: "" }, { start: 3725, text: "Asante" }]), "[00:01:05] Tuanze kikao\n[01:02:05] Asante");
  assert.equal(fileNameFor("audio/webm;codecs=opus"), "recording.webm");
  assert.equal(fileNameFor("audio/mp4"), "recording.mp4");
  assert.equal(extFor("audio/ogg;codecs=opus"), "ogg");
});

test("the recording summary prompt and its check", () => {
  const b = { company: "TRIUMPH", title: "Sales", date: "2026-10-27", staff: ["Juma"], guests: [], agenda: ["Geita"], transcript: "[00:00:01] Tumekubaliana.", swahili: false };
  assert.match(recordingSummaryUser(b), /2 to 5 paragraphs in English/);
  assert.match(recordingSummaryUser(b), /summary_sw: "" \(not asked for\)/);
  assert.match(recordingSummaryUser({ ...b, swahili: true }), /natural, correct Kiswahili/);
  const ok = validateRecordingSummary({ summary: "The team agreed to deliver on Friday.\n\nJuma will call.", summary_sw: "Sawa." }, false);
  assert.deepEqual(ok, { summary: "The team agreed to deliver on Friday.\n\nJuma will call.", summary_sw: "" });
  assert.equal(validateRecordingSummary({ summary: "short" }, false), null);
});
