import { NextResponse, type NextRequest } from "next/server";
import { displayName, type Profile } from "@/lib/context";
import { buildQuotationPdf } from "@/lib/pdf/quotation";
import { quoteNo } from "@/lib/sales";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The quotation as a PDF. Access is checked by the database rules (signed-in user only). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Please sign in.", { status: 401 });

  const { data: q } = await supabase
    .from("quotations")
    .select("*, client:clients(name, address, tin, vrn), rfq:rfqs(number)")
    .eq("id", id)
    .maybeSingle();
  if (!q) return new NextResponse("Quotation not found.", { status: 404 });

  const [{ data: company }, { data: lineData }, { data: preparer }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", q.company_id).single(),
    supabase
      .from("quotation_lines")
      .select("line_no, description, quantity, unit, unit_price, discount_pct, line_total, product:products(sku)")
      .eq("quotation_id", id)
      .order("line_no"),
    supabase
      .from("profiles")
      .select("id, full_name, email, phone")
      .eq("id", q.submitted_by ?? q.created_by ?? user.id)
      .maybeSingle(),
  ]);
  if (!company) return new NextResponse("Company not found.", { status: 404 });

  // Logo (PNG or JPG only; other formats are skipped).
  let logo: { bytes: Uint8Array; type: "png" | "jpg" } | null = null;
  const path: string | null = company.logo_path;
  const type = path?.toLowerCase().endsWith(".png") ? "png" : /\.jpe?g$/i.test(path ?? "") ? "jpg" : null;
  if (path && type) {
    try {
      const url = supabase.storage.from("branding").getPublicUrl(path).data.publicUrl;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) logo = { bytes: new Uint8Array(await res.arrayBuffer()), type };
    } catch {
      logo = null;
    }
  }

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

  const number = quoteNo(q);
  const bytes = await buildQuotationPdf({
    company,
    logo,
    quote: {
      number,
      status: q.status,
      issue_date: q.issue_date,
      valid_until: q.valid_until,
      currency: q.currency,
      contact_name: q.contact_name,
      client_ref: q.client_ref,
      rfq_number: q.rfq?.number ?? null,
      delivery_time: q.delivery_time,
      payment_terms: q.payment_terms,
      incoterms: q.incoterms,
      vat_rate: Number(q.vat_rate),
      subtotal: Number(q.subtotal),
      discount_total: Number(q.discount_total),
      vat_amount: Number(q.vat_amount),
      total: Number(q.total),
      notes: q.notes,
      terms: q.terms,
      prepared_by: preparer ? displayName(preparer as Profile) : null,
    },
    client: {
      name: q.client?.name ?? "",
      address: q.client?.address ?? null,
      tin: q.client?.tin ?? null,
      vrn: q.client?.vrn ?? null,
    },
    lines,
  });

  const fileName = `${number} ${q.client?.name ?? ""}`.replace(/[^\w.\- ]+/g, "").trim() + ".pdf";
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
