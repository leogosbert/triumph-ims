import type { createClient } from "@/lib/supabase/server";
import { displayName, type Profile } from "@/lib/context";
import type { Meeting } from "./model";
import { todayEat } from "./dates";
import type { MinutesBrief, RecordRef } from "./minutes-core";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Words from a list of names that appear in the text (so the AI only sees the records the meeting talked about). */
function mentioned<T extends { name: string }>(rows: T[], textLower: string, max: number): T[] {
  return rows
    .filter((r) => {
      const n = r.name.toLowerCase().trim();
      if (n.length < 3) return false;
      if (textLower.includes(n)) return true;
      const first = n.split(/\s+/)[0];
      return first.length >= 5 && textLower.includes(first);
    })
    .slice(0, max);
}

const label = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" · ").slice(0, 160);

/**
 * Everything the minutes writer needs, read with the signed-in person's own access (the database rules apply):
 * the meeting, who was there, the agenda, last time's open items, the transcript and notes, and the records the
 * meeting named (clients, suppliers, quotations, invoices, opportunities, compliance items, incidents, products).
 */
export async function buildMinutesBrief(supabase: Supabase, m: Meeting, companyName: string): Promise<MinutesBrief> {
  const [texts, att, agenda, last, members] = await Promise.all([
    supabase.from("meeting_texts").select("transcript, notes").eq("meeting_id", m.id).maybeSingle(),
    supabase.from("meeting_attendees").select("user_id, guest_name, guest_org").eq("meeting_id", m.id),
    supabase.from("meeting_agenda_items").select("title, topic").eq("meeting_id", m.id).order("sort"),
    supabase
      .from("meeting_points")
      .select("id, kind, body, owner_id, owner_name, due_on")
      .eq("company_id", m.company_id)
      .eq("approved", true)
      .in("kind", ["action", "issue"])
      .in("status", ["open", "in_progress"])
      .neq("meeting_id", m.id)
      .order("due_on", { ascending: true, nullsFirst: false })
      .limit(30),
    supabase.from("memberships").select("user_id, role").eq("company_id", m.company_id).eq("active", true),
  ]);
  const transcript = String(texts.data?.transcript ?? "");
  const notes = String(texts.data?.notes ?? "");
  const lower = `${m.title} ${m.purpose ?? ""} ${transcript} ${notes}`.toLowerCase();

  const roleOf = new Map(((members.data ?? []) as { user_id: string; role: string }[]).map((x) => [x.user_id, x.role]));
  const { data: profiles } = roleOf.size
    ? await supabase.from("profiles").select("id, full_name, email, phone").in("id", [...roleOf.keys()])
    : { data: [] as Profile[] };
  const staff = ((profiles ?? []) as Profile[]).map((p) => ({ id: p.id, name: displayName(p), role: roleOf.get(p.id) ?? "" }));
  const nameOf = new Map(staff.map((p) => [p.id, p.name]));

  const [clients, suppliers, products] = await Promise.all([
    supabase.from("clients").select("id, name").eq("company_id", m.company_id).limit(2000),
    supabase.from("suppliers").select("id, name").eq("company_id", m.company_id).limit(2000),
    supabase.from("products").select("id, name, sku").eq("company_id", m.company_id).eq("active", true).limit(3000),
  ]);
  const cl = mentioned((clients.data ?? []) as { id: string; name: string }[], lower, 15);
  if (m.client_id && !cl.some((c) => c.id === m.client_id)) {
    const c = ((clients.data ?? []) as { id: string; name: string }[]).find((x) => x.id === m.client_id);
    if (c) cl.unshift(c);
  }
  const su = mentioned((suppliers.data ?? []) as { id: string; name: string }[], lower, 15);
  if (m.supplier_id && !su.some((c) => c.id === m.supplier_id)) {
    const s = ((suppliers.data ?? []) as { id: string; name: string }[]).find((x) => x.id === m.supplier_id);
    if (s) su.unshift(s);
  }
  const pr = mentioned((products.data ?? []) as { id: string; name: string; sku: string | null }[], lower, 25);
  const clientIds = cl.map((c) => c.id);

  const none = Promise.resolve({ data: [] as unknown[] });
  const [quotes, invoices, opps, items, incidents, ncrs] = await Promise.all([
    clientIds.length
      ? supabase.from("quotations").select("id, number, client_id, valid_until").eq("company_id", m.company_id).in("client_id", clientIds).in("status", ["approved", "sent"]).limit(20)
      : none,
    clientIds.length
      ? supabase.from("invoices").select("id, number, client_id, due_date").eq("company_id", m.company_id).in("client_id", clientIds).in("status", ["issued", "partly_paid"]).limit(20)
      : none,
    supabase.from("opportunities").select("id, title, client_id, prospect_name, stage").eq("company_id", m.company_id).not("stage", "in", "(won,lost)").limit(200),
    supabase.from("compliance_items").select("id, name, due_on, status").eq("company_id", m.company_id).neq("status", "not_applicable").limit(200),
    supabase.from("hse_incidents").select("id, number, title").eq("company_id", m.company_id).in("status", ["open", "investigating"]).limit(15),
    supabase.from("quality_ncrs").select("id, number, title").eq("company_id", m.company_id).in("status", ["open", "action"]).limit(15),
  ]);
  const clientName = new Map(cl.map((c) => [c.id, c.name]));
  const oppRows = (opps.data ?? []) as { id: string; title: string; client_id: string | null; prospect_name: string | null; stage: string }[];
  const oppPick = oppRows
    .filter((o) => (o.client_id && clientName.has(o.client_id)) || mentioned([{ name: o.title }], lower, 1).length || (o.prospect_name && lower.includes(o.prospect_name.toLowerCase())))
    .slice(0, 20);
  const itemRows = (items.data ?? []) as { id: string; name: string; due_on: string | null; status: string }[];
  const itemPick = mentioned(itemRows, lower, 20);
  const ref = (id: string, l: string): RecordRef => ({ id, label: l });

  return {
    today: todayEat(),
    company: companyName,
    meeting: {
      id: m.id,
      title: m.title,
      date: m.meeting_date,
      start_time: new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(m.starts_at)),
      kind: m.kind,
      topics: m.topics ?? [],
      language: m.language,
      purpose: m.purpose,
      client: m.client_id && clientName.has(m.client_id) ? ref(m.client_id, clientName.get(m.client_id)!) : null,
      supplier: m.supplier_id ? (su.find((s) => s.id === m.supplier_id) ? ref(m.supplier_id, su.find((s) => s.id === m.supplier_id)!.name) : null) : null,
    },
    staff,
    guests: ((att.data ?? []) as { user_id: string | null; guest_name: string | null; guest_org: string | null }[])
      .filter((a) => !a.user_id && a.guest_name)
      .map((a) => label([a.guest_name, a.guest_org])),
    agenda: ((agenda.data ?? []) as { title: string; topic: string | null }[]).map((a) => ({ title: a.title, topic: a.topic })),
    last_time: ((last.data ?? []) as { id: string; kind: string; body: string; owner_id: string | null; owner_name: string | null; due_on: string | null }[]).map((p) => ({
      id: p.id,
      kind: p.kind,
      body: p.body,
      owner: (p.owner_id ? nameOf.get(p.owner_id) : null) ?? p.owner_name,
      due_on: p.due_on,
    })),
    records: {
      clients: cl.map((c) => ref(c.id, c.name)),
      suppliers: su.map((s) => ref(s.id, s.name)),
      quotations: ((quotes.data ?? []) as { id: string; number: string | null; client_id: string; valid_until: string | null }[]).map((q) =>
        ref(q.id, label([q.number, clientName.get(q.client_id), q.valid_until ? `valid until ${q.valid_until}` : null])),
      ),
      invoices: ((invoices.data ?? []) as { id: string; number: string | null; client_id: string; due_date: string | null }[]).map((i) =>
        ref(i.id, label([i.number, clientName.get(i.client_id), i.due_date ? `due ${i.due_date}` : null])),
      ),
      opportunities: oppPick.map((o) => ref(o.id, label([o.title, o.client_id ? clientName.get(o.client_id) : o.prospect_name, o.stage]))),
      compliance_items: itemPick.map((i) => ref(i.id, label([i.name, i.due_on ? `due ${i.due_on}` : null]))),
      incidents: ((incidents.data ?? []) as { id: string; number: string | null; title: string }[]).map((i) => ref(i.id, label([i.number, i.title]))),
      ncrs: ((ncrs.data ?? []) as { id: string; number: string | null; title: string }[]).map((i) => ref(i.id, label([i.number, i.title]))),
      products: pr.map((p) => ref(p.id, label([p.name, p.sku]))),
    },
    transcript,
    notes,
  };
}

/** All record labels in a brief by id (for showing proposals). */
export function recordLabels(b: MinutesBrief): Map<string, string> {
  const map = new Map<string, string>();
  for (const list of Object.values(b.records)) for (const r of list) map.set(r.id, r.label);
  return map;
}
