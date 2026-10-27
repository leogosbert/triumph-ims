import { redirect } from "next/navigation";
import { getAppContext, stage13Ready } from "@/lib/context";
import { toCsv } from "@/lib/exportData";
import { monthRange, n } from "@/lib/finance";
import { can } from "@/lib/roles";
import { recordEvent } from "@/lib/security";

export const dynamic = "force-dynamic";

const KINDS = ["invoices", "payments", "bills", "expenses"] as const;
type Kind = (typeof KINDS)[number];

/**
 * Accounting export: one month of invoices, payments, supplier bills or expenses as a CSV in the
 * columns accounting software and accountants expect (date, number, party, TIN, amounts, VAT,
 * the amount in the base currency). /integrations/export?kind=invoices&m=2026-10
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") ?? "") as Kind;
  const { supabase, company, roles, features } = await getAppContext();
  if (!can(roles, "seeFinance") || !features.on("integrations")) redirect("/integrations");
  if (!KINDS.includes(kind)) return new Response("Unknown export", { status: 404 });
  const m = monthRange(url.searchParams.get("m"));
  const base = company.base_currency;
  let rows: Record<string, unknown>[] = [];

  if (kind === "invoices") {
    const { data, error } = await supabase
      .from("invoices")
      .select("number, status, issue_date, due_date, currency, exchange_rate, subtotal, discount_total, vat_rate, vat_amount, total, amount_paid, client_ref, client:clients(code, name, tin, vrn)")
      .eq("company_id", company.id)
      .in("status", ["issued", "partly_paid", "paid", "cancelled"])
      .gte("issue_date", m.start)
      .lt("issue_date", m.next)
      .order("issue_date")
      .limit(10000);
    if (error) throw new Error(error.message);
    type I = { number: string; status: string; issue_date: string; due_date: string | null; currency: string; exchange_rate: number; subtotal: number; discount_total: number; vat_rate: number; vat_amount: number; total: number; amount_paid: number; client_ref: string | null; client: { code: string | null; name: string; tin: string | null; vrn: string | null } | null };
    rows = ((data ?? []) as unknown as I[]).map((i) => ({
      date: i.issue_date,
      number: i.number,
      status: i.status,
      client_code: i.client?.code ?? "",
      client: i.client?.name ?? "",
      client_tin: i.client?.tin ?? "",
      client_vrn: i.client?.vrn ?? "",
      client_ref: i.client_ref ?? "",
      due_date: i.due_date ?? "",
      currency: i.currency,
      net: (n(i.subtotal) - n(i.discount_total)).toFixed(2),
      vat_rate: n(i.vat_rate),
      vat: n(i.vat_amount).toFixed(2),
      total: n(i.total).toFixed(2),
      paid: n(i.amount_paid).toFixed(2),
      rate: n(i.exchange_rate),
      [`total_${base}`]: (n(i.total) * n(i.exchange_rate || 1)).toFixed(2),
    }));
  } else if (kind === "payments") {
    const { data, error } = await supabase
      .from("payments")
      .select("number, received_on, amount, currency, exchange_rate, method, provider, reference, voided_at, invoice:invoices(number), client:clients(code, name, tin)")
      .eq("company_id", company.id)
      .gte("received_on", m.start)
      .lt("received_on", m.next)
      .order("received_on")
      .limit(10000);
    // Before Stage 13 there is no provider column: ask again without it.
    const res = error
      ? await supabase
          .from("payments")
          .select("number, received_on, amount, currency, exchange_rate, method, reference, voided_at, invoice:invoices(number), client:clients(code, name, tin)")
          .eq("company_id", company.id)
          .gte("received_on", m.start)
          .lt("received_on", m.next)
          .order("received_on")
          .limit(10000)
      : { data, error: null };
    if (res.error) throw new Error(res.error.message);
    type P = { number: string; received_on: string; amount: number; currency: string; exchange_rate: number; method: string; provider?: string | null; reference: string | null; voided_at: string | null; invoice: { number: string } | null; client: { code: string | null; name: string; tin: string | null } | null };
    rows = ((res.data ?? []) as unknown as P[]).map((p) => ({
      date: p.received_on,
      receipt: p.number,
      invoice: p.invoice?.number ?? "",
      client_code: p.client?.code ?? "",
      client: p.client?.name ?? "",
      client_tin: p.client?.tin ?? "",
      method: p.method,
      provider: p.provider ?? "",
      reference: p.reference ?? "",
      currency: p.currency,
      amount: n(p.amount).toFixed(2),
      rate: n(p.exchange_rate),
      [`amount_${base}`]: (n(p.amount) * n(p.exchange_rate || 1)).toFixed(2),
      voided: p.voided_at ? "yes" : "",
    }));
  } else if (kind === "bills") {
    const { data, error } = await supabase
      .from("supplier_bills")
      .select("number, supplier_invoice_no, bill_date, due_date, currency, exchange_rate, subtotal, vat_amount, total, amount_paid, status, supplier:suppliers(code, name, tax_no)")
      .eq("company_id", company.id)
      .gte("bill_date", m.start)
      .lt("bill_date", m.next)
      .order("bill_date")
      .limit(10000);
    if (error) throw new Error(error.message);
    type B = { number: string; supplier_invoice_no: string | null; bill_date: string; due_date: string | null; currency: string; exchange_rate: number; subtotal: number; vat_amount: number; total: number; amount_paid: number; status: string; supplier: { code: string | null; name: string; tax_no: string | null } | null };
    rows = ((data ?? []) as unknown as B[]).map((b) => ({
      date: b.bill_date,
      number: b.number,
      supplier_invoice: b.supplier_invoice_no ?? "",
      supplier_code: b.supplier?.code ?? "",
      supplier: b.supplier?.name ?? "",
      supplier_tax_no: b.supplier?.tax_no ?? "",
      status: b.status,
      due_date: b.due_date ?? "",
      currency: b.currency,
      net: n(b.subtotal).toFixed(2),
      vat: n(b.vat_amount).toFixed(2),
      total: n(b.total).toFixed(2),
      paid: n(b.amount_paid).toFixed(2),
      rate: n(b.exchange_rate),
      [`total_${base}`]: (n(b.total) * n(b.exchange_rate || 1)).toFixed(2),
    }));
  } else {
    if (!stage13Ready(company)) redirect("/integrations");
    const { data, error } = await supabase
      .from("expenses")
      .select("number, spent_on, payee, description, amount, vat_amount, currency, exchange_rate, method, provider, reference, voided_at, category:expense_categories(name)")
      .eq("company_id", company.id)
      .gte("spent_on", m.start)
      .lt("spent_on", m.next)
      .order("spent_on")
      .limit(10000);
    if (error) throw new Error(error.message);
    type E = { number: string; spent_on: string; payee: string | null; description: string; amount: number; vat_amount: number; currency: string; exchange_rate: number; method: string; provider: string | null; reference: string | null; voided_at: string | null; category: { name: string } | null };
    rows = ((data ?? []) as unknown as E[]).map((e) => ({
      date: e.spent_on,
      number: e.number,
      category: e.category?.name ?? "",
      payee: e.payee ?? "",
      description: e.description,
      method: e.method,
      provider: e.provider ?? "",
      reference: e.reference ?? "",
      currency: e.currency,
      net: (n(e.amount) - n(e.vat_amount)).toFixed(2),
      vat: n(e.vat_amount).toFixed(2),
      total: n(e.amount).toFixed(2),
      rate: n(e.exchange_rate),
      [`total_${base}`]: (n(e.amount) * n(e.exchange_rate || 1)).toFixed(2),
      voided: e.voided_at ? "yes" : "",
    }));
  }

  await recordEvent(supabase, "export", company.id);
  const slug = company.name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
  return new Response(toCsv(rows.length ? rows : [{ note: "No records in this month" }]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-${kind}-${m.month}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
