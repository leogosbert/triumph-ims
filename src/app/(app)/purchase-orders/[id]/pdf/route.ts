import { displayName, type Profile } from "@/lib/context";
import { loadLogo, pdfResponse } from "@/lib/pdf/load";
import { buildPurchaseOrderPdf } from "@/lib/pdf/purchasing";
import { quoteNo } from "@/lib/sales";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Purchase order PDF. Access is checked by the database rules. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Please sign in.", { status: 401 });

  const { data: po } = await supabase
    .from("purchase_orders")
    .select("*, supplier:suppliers(name, city, country, contact_person, email, phone, tax_no)")
    .eq("id", id)
    .maybeSingle();
  if (!po) return new Response("Not found.", { status: 404 });

  const [{ data: company }, { data: lineData }, { data: people }, { data: quote }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", po.company_id).single(),
    supabase.from("po_lines").select("line_no, description, quantity, unit, unit_price, line_total, product:products(sku)").eq("po_id", id).order("line_no"),
    supabase
      .from("profiles")
      .select("id, full_name, email, phone")
      .in("id", [po.submitted_by ?? po.created_by, po.approved_by].filter(Boolean)),
    po.quotation_id ? supabase.from("quotations").select("number, revision").eq("id", po.quotation_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!company) return new Response("Not found.", { status: 404 });
  const names = new Map(((people ?? []) as Profile[]).map((p) => [p.id, displayName(p)]));

  type L = { line_no: number; description: string; quantity: number; unit: string; unit_price: number; line_total: number; product: { sku: string } | null };
  const bytes = await buildPurchaseOrderPdf({
    company,
    logo: await loadLogo(supabase, company.logo_path),
    supplier: po.supplier,
    po: {
      number: po.number,
      status: po.status,
      order_date: po.order_date,
      expected_date: po.expected_date,
      supplier_ref: po.supplier_ref,
      client_ref: quote ? quoteNo(quote as { number: string; revision: number }) : null,
      currency: po.currency,
      delivery_location: po.delivery_location,
      payment_terms: po.payment_terms,
      incoterms: po.incoterms,
      shipping_instructions: po.shipping_instructions,
      notes: po.notes,
      terms: po.terms,
      freight: Number(po.freight),
      vat_rate: Number(po.vat_rate),
      subtotal: Number(po.subtotal),
      vat_amount: Number(po.vat_amount),
      total: Number(po.total),
      ordered_by: names.get(po.submitted_by ?? po.created_by) ?? null,
      approved_by: po.approved_by ? (names.get(po.approved_by) ?? null) : null,
    },
    lines: ((lineData ?? []) as unknown as L[]).map((l) => ({
      line_no: l.line_no,
      description: l.description,
      sku: l.product?.sku ?? null,
      quantity: Number(l.quantity),
      unit: l.unit,
      unit_price: Number(l.unit_price),
      line_total: Number(l.line_total),
    })),
  });
  return pdfResponse(bytes, `${po.number} ${po.supplier?.name ?? ""}.pdf`);
}
