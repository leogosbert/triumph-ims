import { tr } from "@/lib/tr";
import { FollowUps, type FollowUp } from "@/components/FollowUps";
import { ReminderComposer } from "@/components/ReminderComposer";
import type { Company, Profile } from "@/lib/context";
import { daysOverdue, n } from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { namesFor } from "@/lib/people";
import { invoiceReminderText, quoteFollowUpText, recipientsFrom } from "@/lib/reminders";
import { todayTz } from "@/lib/sales";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function load(supabase: Supabase, column: "invoice_id" | "quotation_id", id: string, clientId: string) {
  const [{ data: fu }, { data: contacts }] = await Promise.all([
    supabase.from("followups").select("id, channel, note, next_on, created_at, created_by").eq(column, id).order("created_at", { ascending: false }).limit(50),
    supabase.from("client_contacts").select("kind, name, phone, email").eq("client_id", clientId).order("created_at").limit(50),
  ]);
  const rows = (fu ?? []) as { id: string; channel: string; note: string | null; next_on: string | null; created_at: string; created_by: string | null }[];
  const names = await namesFor(supabase, rows.map((r) => r.created_by));
  const items: FollowUp[] = rows.map((r) => ({ ...r, by: r.created_by ? (names.get(r.created_by) ?? null) : null }));
  return { items, contacts: (contacts ?? []) as { kind: string; name: string | null; phone: string | null; email: string | null }[] };
}

const sender = (company: Company, profile: Profile) => ({ person: profile.full_name, company: company.name, phone: profile.phone ?? company.phone });

/** "Remind the client" on an open invoice: ready-made message plus the reminder log. */
export async function InvoiceReminderCard({
  supabase,
  company,
  profile,
  inv,
  canLog,
  lang,
}: {
  supabase: Supabase;
  company: Company;
  profile: Profile;
  inv: { id: string; number: string; client_id: string; client_name: string; currency: string; total: number; amount_paid: number; due_date: string | null; contact_name: string | null };
  canLog: boolean;
  lang: "en" | "sw";
}) {
  const { items, contacts } = await load(supabase, "invoice_id", inv.id, inv.client_id);
  const today = todayTz();
  const data = {
    greetingName: inv.contact_name || inv.client_name,
    number: inv.number,
    currency: inv.currency,
    total: n(inv.total),
    paid: n(inv.amount_paid),
    dueDate: inv.due_date,
    daysLate: daysOverdue(inv.due_date),
    bankDetails: company.bank_details,
    mobileMoney: company.mobile_money_details ?? null,
  };
  const promise = items.find((f) => f.next_on);
  return (
    <section className="card" id="remind">
      <h2>{tr("Remind the client")}</h2>
      {promise?.next_on && promise.next_on >= today && (
        <p className="small">
          <span className="badge tone-ok">{tr("Promised to pay by")} {formatDate(promise.next_on)}</span>
        </p>
      )}
      <ReminderComposer
        en={invoiceReminderText(data, sender(company, profile), "en")}
        sw={invoiceReminderText(data, sender(company, profile), "sw")}
        subject={`Invoice ${inv.number} - ${company.name}`}
        recipients={recipientsFrom(contacts, "finance")}
        startLang={lang}
      />
      <FollowUps kind="invoice" id={inv.id} items={items} canLog={canLog} today={today} defaultNext="" />
    </section>
  );
}

/** "Follow up" on a sent quotation. */
export async function QuoteFollowUpCard({
  supabase,
  company,
  profile,
  q,
  canLog,
  lang,
}: {
  supabase: Supabase;
  company: Company;
  profile: Profile;
  q: { id: string; number: string; client_id: string; client_name: string; contact_name: string | null; currency: string; total: number; issue_date: string; valid_until: string | null; client_ref: string | null };
  canLog: boolean;
  lang: "en" | "sw";
}) {
  const { items, contacts } = await load(supabase, "quotation_id", q.id, q.client_id);
  const today = todayTz();
  const every = Math.max(1, n(company.quote_followup_days ?? 3));
  const next = new Date(Date.parse(`${today}T12:00:00Z`) + every * 86400000).toISOString().slice(0, 10);
  const data = { greetingName: q.contact_name || q.client_name, number: q.number, issueDate: q.issue_date, validUntil: q.valid_until, currency: q.currency, total: n(q.total), clientRef: q.client_ref };
  const upcoming = items.find((f) => f.next_on);
  return (
    <section className="card" id="follow-up">
      <h2>{tr("Follow up")}</h2>
      {upcoming?.next_on && (
        <p className="small muted">
          {tr("Next follow-up")} {formatDate(upcoming.next_on)}
        </p>
      )}
      <ReminderComposer
        en={quoteFollowUpText(data, sender(company, profile), "en")}
        sw={quoteFollowUpText(data, sender(company, profile), "sw")}
        subject={`Quotation ${q.number} - ${company.name}`}
        recipients={recipientsFrom(contacts, "purchasing")}
        startLang={lang}
      />
      <FollowUps kind="quotation" id={q.id} items={items} canLog={canLog} today={today} defaultNext={next} />
    </section>
  );
}
