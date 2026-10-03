import { displayName, type Profile } from "@/lib/context";
import { buildInvoicePdf } from "@/lib/pdf/finance";
import { loadLogo, pdfResponse } from "@/lib/pdf/load";
import { quoteNo } from "@/lib/sales";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The invoice as a PDF. Access is checked by the database rules. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Please sign in.", { status: 401 });

  const { data: inv } = await supabase
    .from("invoices")
    .select("*, client:clients(name, address, tin, vrn), quotation:quotations(number, revision), delivery:deliveries(number)")
    .eq("id", id)
    .maybeSingle();
  if (!inv) return new Response("Invoice not found.", { status: 404 });

  const [{ data: company }, { data: lineData }, { data: issuer }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", inv.company_id).single(),
    supabase
      .from("invoice_lines")
      .select("line_no, description, quantity, unit, unit_price, discount_pct, line_total, product:products(sku)")
      .eq("invoice_id", id)
      .order("line_no"),
    inv.issued_by
      ? supabase.from("profiles").select("id, full_name, email, phone").eq("id", inv.issued_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!company) return new Response("Company not found.", { status: 404 });

  type LineRow = {
    line_no: number;
    description: string;
    quantity: number;
    unit: string;
    unit_price: number;
    discount_pct: number;
    line_total: number;
    product: { sku: string } | null;
  };
  const lines = ((lineData ?? []) as unknown as LineRow[]).map((l) => ({
    line_no: l.line_no,
    description: l.description,
    sku: l.product?.sku ?? null,
    quantity: Number(l.quantity),
    unit: l.unit,
    unit_price: Number(l.unit_price),
    discount_pct: Number(l.discount_pct),
    line_total: Number(l.line_total),
  }));

  const bytes = await buildInvoicePdf({
    company,
    logo: await loadLogo(supabase, company.logo_path),
    invoice: {
      number: inv.number,
      status: inv.status,
      issue_date: inv.issue_date,
      due_date: inv.due_date,
      currency: inv.currency,
      client_ref: inv.client_ref,
      contact_name: inv.contact_name,
      quotation_number: inv.quotation ? quoteNo(inv.quotation) : null,
      delivery_number: inv.delivery?.number ?? null,
      payment_terms: inv.payment_terms,
      vat_rate: Number(inv.vat_rate),
      subtotal: Number(inv.subtotal),
      discount_total: Number(inv.discount_total),
      vat_amount: Number(inv.vat_amount),
      total: Number(inv.total),
      amount_paid: Number(inv.amount_paid),
      notes: inv.notes,
      terms: inv.terms,
      issued_by: issuer ? displayName(issuer as Profile) : null,
    },
    client: {
      name: inv.client?.name ?? "",
      address: inv.client?.address ?? null,
      tin: inv.client?.tin ?? null,
      vrn: inv.client?.vrn ?? null,
    },
    lines,
  });
  return pdfResponse(bytes, `${inv.number || "Draft invoice"} ${inv.client?.name ?? ""}.pdf`);
}
