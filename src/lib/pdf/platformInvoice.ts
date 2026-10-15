import type { createClient } from "@/lib/supabase/server";
import { buildDocumentPdf, pdfDate } from "./document";
import { loadBillingSettings, type CompanyBilling, type InvoiceLine, type PlatformInvoice } from "@/lib/billing";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * A LeMo Tech invoice to a company, as a PDF. Row-level security decides who may read it
 * (the company's management and finance once issued; the LeMo Tech team always).
 * Returns null when the invoice is not there or not visible.
 */
export async function platformInvoicePdf(supabase: Supabase, id: string, t: (s: string) => string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data: inv } = await supabase.from("platform_invoices").select("*").eq("id", id).maybeSingle();
  if (!inv) return null;
  const i = inv as PlatformInvoice;
  const [{ data: lineRows }, { data: co }, { data: bill }, s] = await Promise.all([
    supabase.from("platform_invoice_lines").select("id, item_key, description, quantity, unit_price, amount, sort").eq("invoice_id", id).order("sort"),
    supabase.from("companies").select("name, legal_name, address, tin, vrn, email, phone").eq("id", i.company_id).maybeSingle(),
    supabase.from("company_billing").select("billing_name, billing_email, billing_tin").eq("company_id", i.company_id).maybeSingle(),
    loadBillingSettings(supabase),
  ]);
  const lines = (lineRows ?? []) as InvoiceLine[];
  let found = co as { name?: string } | null;
  if (!found) {
    // The LeMo Tech team is not a member of the company: its name comes from the platform list.
    const { data: list } = await supabase.rpc("platform_companies");
    found = ((list ?? []) as { id: string; name: string }[]).find((x) => x.id === i.company_id) ?? null;
  }
  const c = (found ?? {}) as { name?: string; legal_name?: string | null; address?: string | null; tin?: string | null; vrn?: string | null; email?: string | null; phone?: string | null };
  const b = (bill ?? {}) as Partial<CompanyBilling>;
  const due = Number(i.total) - Number(i.paid_amount);

  const totals: [string, number, boolean?][] = [[t("Subtotal"), Number(i.subtotal)]];
  if (Number(i.discount) > 0) totals.push([`${t("Discount")} ${Number(i.discount_pct)}%`, -Number(i.discount)]);
  totals.push([Number(i.vat_rate) > 0 ? `${t("VAT")} ${Number(i.vat_rate)}%` : t("VAT (not registered)"), Number(i.vat)]);
  if (Number(i.paid_amount) > 0) totals.push([t("Paid"), -Number(i.paid_amount)]);

  const bytes = await buildDocumentPdf({
    title: t("INVOICE"),
    company: {
      name: s?.legal_name ?? "LeMo Tech Solutions",
      legal_name: null,
      address: s?.address ?? null,
      phone: s?.phone || null,
      email: s?.email || null,
      website: null,
      tin: s?.tin || null,
      vrn: s?.vrn || null,
      primary_color: "#1C4C9B",
      accent_color: "#123A7A",
      bank_details: s?.bank_details || null,
      mobile_money_details: s?.mobile_money || null,
      document_footer: t("LeMoSp · a LeMo Tech Solutions product"),
    },
    logo: null,
    meta: [
      [t("Invoice no."), i.number ?? t("Draft")],
      [t("Date"), pdfDate(i.issued_on ?? i.created_at)],
      [t("Due"), pdfDate(i.due_on)],
      [t("Period"), i.period_start ? `${pdfDate(i.period_start)} - ${pdfDate(i.period_end)}` : null],
      [t("Currency"), i.currency],
    ],
    partyLabel: t("Bill to"),
    party: {
      name: b.billing_name || c.legal_name || c.name || "",
      lines: [c.address, b.billing_tin || c.tin ? `TIN ${b.billing_tin || c.tin}` : null, c.vrn ? `VRN ${c.vrn}` : null, b.billing_email || c.email, c.phone],
    },
    currency: i.currency,
    mode: "priced",
    lines: lines.map((l, n) => ({
      line_no: n + 1,
      description: l.description,
      sku: null,
      quantity: Number(l.quantity),
      unit: "",
      unit_price: Number(l.unit_price),
      line_total: Number(l.amount),
    })),
    totals: { rows: totals, grandLabel: due > 0 && i.status !== "void" ? t("Amount due") : t("Total"), grand: i.status === "paid" ? Number(i.total) : due },
    blocks: [
      { title: t("Notes"), body: i.notes },
      { title: t("How to pay"), body: s?.invoice_note ?? null },
    ],
    watermark: i.status === "paid" ? t("PAID") : i.status === "void" ? t("CANCELLED") : i.status === "draft" ? t("DRAFT") : null,
    showBank: true,
  });
  return { bytes, name: `LeMoSp invoice ${i.number ?? "draft"}.pdf` };
}
