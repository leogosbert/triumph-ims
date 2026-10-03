import { displayName, type Profile } from "@/lib/context";
import { buildDeliveryNotePdf } from "@/lib/pdf/delivery";
import { loadLogo, pdfResponse } from "@/lib/pdf/load";
import { quoteNo } from "@/lib/sales";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Delivery note PDF; after delivery it includes the client's signature. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Please sign in.", { status: 401 });

  const { data: d } = await supabase
    .from("deliveries")
    .select("*, client:clients(name, address, tin), store:warehouses(name), quotation:quotations(number, revision, client_ref)")
    .eq("id", id)
    .maybeSingle();
  if (!d) return new Response("Not found.", { status: 404 });

  const [{ data: company }, { data: lineData }, { data: moves }, { data: driver }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", d.company_id).single(),
    supabase.from("delivery_lines").select("line_no, description, quantity, unit, product_id, product:products(sku)").eq("delivery_id", id).order("line_no"),
    supabase.from("stock_movements").select("product_id, batch_no, expiry_date, quantity").eq("delivery_id", id).eq("kind", "dispatch"),
    d.driver_id ? supabase.from("profiles").select("id, full_name, email, phone").eq("id", d.driver_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!company) return new Response("Not found.", { status: 404 });

  const batches = new Map<string, string[]>();
  for (const m of (moves ?? []) as { product_id: string; batch_no: string; expiry_date: string | null }[]) {
    if (!m.batch_no) continue;
    const label = m.expiry_date ? `${m.batch_no} (exp ${m.expiry_date})` : m.batch_no;
    batches.set(m.product_id, [...new Set([...(batches.get(m.product_id) ?? []), label])]);
  }

  let signature: { bytes: Uint8Array; type: "png" | "jpg" } | null = null;
  if (d.status === "delivered" && d.signature_path) {
    const { data: blob } = await supabase.storage.from("pod").download(d.signature_path);
    if (blob) signature = { bytes: new Uint8Array(await blob.arrayBuffer()), type: d.signature_path.endsWith(".jpg") ? "jpg" : "png" };
  }

  type L = { line_no: number; description: string; quantity: number; unit: string; product_id: string | null; product: { sku: string } | null };
  const bytes = await buildDeliveryNotePdf({
    company,
    logo: await loadLogo(supabase, company.logo_path),
    delivery: {
      number: d.number,
      status: d.status,
      planned_date: d.planned_date,
      dispatched_at: d.dispatched_at,
      client_ref: d.quotation?.client_ref ?? null,
      quotation_no: d.quotation ? quoteNo(d.quotation) : null,
      delivery_site: d.delivery_site,
      contact_name: d.contact_name,
      contact_phone: d.contact_phone,
      vehicle: d.vehicle,
      driver: driver ? displayName(driver as Profile) : null,
      notes: d.notes,
      received_by_name: d.received_by_name,
      delivered_at: d.delivered_at,
      gps: d.gps_lat != null ? `GPS ${Number(d.gps_lat).toFixed(5)}, ${Number(d.gps_lng).toFixed(5)}` : null,
      pod_notes: d.pod_notes,
    },
    client: { name: d.client?.name ?? "", address: d.client?.address ?? null, tin: d.client?.tin ?? null },
    store: d.store?.name ?? "",
    lines: ((lineData ?? []) as unknown as L[]).map((l) => ({
      line_no: l.line_no,
      description: l.description,
      sku: l.product?.sku ?? null,
      quantity: Number(l.quantity),
      unit: l.unit,
      batches: l.product_id ? (batches.get(l.product_id) ?? []).join(", ") || null : null,
    })),
    signature,
  });
  return pdfResponse(bytes, `${d.number} ${d.client?.name ?? ""}.pdf`);
}
