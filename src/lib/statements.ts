import type { createClient } from "@/lib/supabase/server";
import { AGING, n } from "@/lib/finance";
import type { LedgerRow } from "@/lib/pdf/document";
import { todayTz } from "@/lib/sales";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Account statement for one client (invoices and payments received) or one supplier (bills and
 * payments made), in one currency, for a period: the balance brought forward, every document in
 * the period with a running balance, and what is still open at the end, by age.
 */
export type Statement = {
  currencies: string[];
  currency: string;
  from: string;
  to: string;
  opening: number;
  rows: LedgerRow[];
  charged: number;
  paid: number;
  closing: number;
  aging: number[];
};

type Doc = { id: string; number: string; date: string; due: string | null; total: number; currency: string; ref: string | null };
type Pay = { number: string; date: string; amount: number; currency: string; method: string; reference: string | null; doc: string | null };

/** Default period: the last three full months plus this one. */
export function defaultPeriod() {
  const today = todayTz();
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 3, 1);
  return { from: d.toISOString().slice(0, 10), to: today };
}

export function cleanDate(v: unknown, fallback: string) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
}

export async function loadStatement(
  supabase: Supabase,
  companyId: string,
  kind: "client" | "supplier",
  partyId: string,
  from: string,
  to: string,
  wanted: string | null,
  methodLabel: (method: string) => string,
): Promise<Statement> {
  let docs: Doc[];
  let pays: Pay[];
  if (kind === "client") {
    const [{ data: inv }, { data: pay }] = await Promise.all([
      supabase
        .from("invoices")
        .select("id, number, issue_date, due_date, total, currency, client_ref")
        .eq("company_id", companyId)
        .eq("client_id", partyId)
        .not("status", "in", "(draft,cancelled)")
        .lte("issue_date", to)
        .order("issue_date")
        .limit(5000),
      supabase
        .from("payments")
        .select("number, received_on, amount, currency, method, reference, voided_at, invoice:invoices(number)")
        .eq("company_id", companyId)
        .eq("client_id", partyId)
        .is("voided_at", null)
        .lte("received_on", to)
        .order("received_on")
        .limit(5000),
    ]);
    docs = ((inv ?? []) as { id: string; number: string; issue_date: string; due_date: string | null; total: number; currency: string; client_ref: string | null }[]).map(
      (i) => ({ id: i.id, number: i.number, date: i.issue_date, due: i.due_date, total: n(i.total), currency: i.currency, ref: i.client_ref }),
    );
    pays = ((pay ?? []) as unknown as { number: string; received_on: string; amount: number; currency: string; method: string; reference: string | null; invoice: { number: string } | null }[]).map(
      (p) => ({ number: p.number, date: p.received_on, amount: n(p.amount), currency: p.currency, method: p.method, reference: p.reference, doc: p.invoice?.number ?? null }),
    );
  } else {
    const [{ data: bills }, { data: pay }] = await Promise.all([
      supabase
        .from("supplier_bills")
        .select("id, number, bill_date, due_date, total, currency, supplier_invoice_no")
        .eq("company_id", companyId)
        .eq("supplier_id", partyId)
        .neq("status", "cancelled")
        .lte("bill_date", to)
        .order("bill_date")
        .limit(5000),
      supabase
        .from("supplier_payments")
        .select("number, paid_on, amount, currency, method, reference, voided_at, bill:supplier_bills(number, supplier_invoice_no)")
        .eq("company_id", companyId)
        .eq("supplier_id", partyId)
        .is("voided_at", null)
        .lte("paid_on", to)
        .order("paid_on")
        .limit(5000),
    ]);
    docs = ((bills ?? []) as { id: string; number: string; bill_date: string; due_date: string | null; total: number; currency: string; supplier_invoice_no: string | null }[]).map(
      (b) => ({ id: b.id, number: b.supplier_invoice_no || b.number, date: b.bill_date, due: b.due_date, total: n(b.total), currency: b.currency, ref: b.supplier_invoice_no ? b.number : null }),
    );
    pays = ((pay ?? []) as unknown as { number: string; paid_on: string; amount: number; currency: string; method: string; reference: string | null; bill: { number: string; supplier_invoice_no: string | null } | null }[]).map(
      (p) => ({ number: p.number, date: p.paid_on, amount: n(p.amount), currency: p.currency, method: p.method, reference: p.reference, doc: p.bill ? p.bill.supplier_invoice_no || p.bill.number : null }),
    );
  }

  const currencies = [...new Set([...docs.map((d) => d.currency), ...pays.map((p) => p.currency)])].sort();
  const currency = wanted && currencies.includes(wanted) ? wanted : (currencies[0] ?? wanted ?? "TZS");
  docs = docs.filter((d) => d.currency === currency);
  pays = pays.filter((p) => p.currency === currency);

  let opening = 0;
  type Ev = { date: string; order: number; row: Omit<LedgerRow, "balance"> };
  const events: Ev[] = [];
  for (const d of docs) {
    if (d.date < from) opening += d.total;
    else
      events.push({
        date: d.date,
        order: 0,
        row: {
          date: d.date,
          doc: d.number,
          detail: [kind === "client" ? "Invoice" : "Bill", d.ref ? `(${d.ref})` : null, d.due ? `due ${d.due}` : null].filter(Boolean).join(" "),
          debit: d.total,
          credit: 0,
        },
      });
  }
  for (const p of pays) {
    if (p.date < from) opening -= p.amount;
    else
      events.push({
        date: p.date,
        order: 1,
        row: {
          date: p.date,
          doc: p.number,
          detail: [`Payment · ${methodLabel(p.method)}`, p.reference, p.doc ? `for ${p.doc}` : null].filter(Boolean).join(" · "),
          debit: 0,
          credit: p.amount,
        },
      });
  }
  events.sort((a, b) => (a.date === b.date ? a.order - b.order : a.date < b.date ? -1 : 1));
  let bal = opening;
  const rows: LedgerRow[] = [{ date: from, doc: "", detail: "Balance brought forward", debit: 0, credit: 0, balance: opening }];
  let charged = 0;
  let paid = 0;
  for (const e of events) {
    bal += e.row.debit - e.row.credit;
    charged += e.row.debit;
    paid += e.row.credit;
    rows.push({ ...e.row, balance: bal });
  }

  // Aging at the end date: pay the oldest documents first with everything paid until then.
  const aging = AGING.map(() => 0);
  let pool = pays.reduce((s, p) => s + p.amount, 0);
  for (const d of [...docs].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const used = Math.min(pool, d.total);
    pool -= used;
    const left = d.total - used;
    if (left <= 0.005) continue;
    const late = d.due ? Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${d.due}T00:00:00Z`)) / 86400000) : 0;
    aging[late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4] += left;
  }
  return { currencies, currency, from, to, opening, rows, charged, paid, closing: bal, aging };
}
