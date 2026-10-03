import type { NextRequest } from "next/server";
import { displayName, type Profile } from "@/lib/context";
import { loadLogo, pdfResponse } from "@/lib/pdf/load";
import { buildSupplierRfqPdf } from "@/lib/pdf/purchasing";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Request-for-quotation PDF to send to suppliers (no prices). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Please sign in.", { status: 401 });

  const { data: r } = await supabase.from("supplier_rfqs").select("*").eq("id", id).maybeSingle();
  if (!r) return new Response("Not found.", { status: 404 });
  const inviteId = req.nextUrl.searchParams.get("s");

  const [{ data: company }, { data: lineData }, inviteRes, { data: me }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", r.company_id).single(),
    supabase.from("supplier_rfq_lines").select("line_no, description, quantity, unit, product:products(sku)").eq("srfq_id", id).order("line_no"),
    inviteId
      ? supabase
          .from("supplier_rfq_suppliers")
          .select("supplier:suppliers(name, city, country, contact_person, email, phone, tax_no)")
          .eq("id", inviteId)
          .eq("srfq_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("profiles").select("id, full_name, email, phone").eq("id", user.id).maybeSingle(),
  ]);
  if (!company) return new Response("Not found.", { status: 404 });

  type L = { line_no: number; description: string; quantity: number; unit: string; product: { sku: string } | null };
  const lines = ((lineData ?? []) as unknown as L[]).map((l) => ({
    line_no: l.line_no,
    description: l.description,
    sku: l.product?.sku ?? null,
    quantity: Number(l.quantity),
    unit: l.unit,
  }));
  const supplier = (inviteRes.data as { supplier: Parameters<typeof buildSupplierRfqPdf>[0]["supplier"] } | null)?.supplier ?? null;
  const profile = me as Profile | null;
  const contact = profile ? [displayName(profile), profile.phone].filter(Boolean).join(", ") : null;

  const bytes = await buildSupplierRfqPdf({
    company,
    logo: await loadLogo(supabase, company.logo_path),
    supplier,
    rfq: {
      number: r.number,
      date: (r.created_at as string).slice(0, 10),
      due_on: r.due_on,
      delivery_location: r.delivery_location,
      notes: r.notes,
      contact,
    },
    lines,
  });
  return pdfResponse(bytes, `${r.number} request for quotation${supplier ? ` ${supplier.name}` : ""}.pdf`);
}
