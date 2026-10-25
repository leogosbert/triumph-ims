import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName, type Profile } from "@/lib/context";
import { AGING, methodLabel } from "@/lib/finance";
import { buildDeliveryNotePdf } from "@/lib/pdf/delivery";
import { buildInvoicePdf, buildStatementPdf } from "@/lib/pdf/finance";
import { loadLogo } from "@/lib/pdf/load";
import { buildPurchaseOrderPdf } from "@/lib/pdf/purchasing";
import { buildQuotationPdf } from "@/lib/pdf/quotation";
import { quoteNo } from "@/lib/sales";
import { cleanDate, defaultPeriod, loadStatement } from "@/lib/statements";

/**
 * The portal's PDFs: the same builders as the app's own PDF routes (quotations/[id]/pdf,
 * invoices/[id]/pdf, deliveries/[id]/pdf, purchase-orders/[id]/pdf, clients/[id]/statement/pdf),
 * fed by the portal server's database client.
 *
 * Portal-safe: these run only after portal_open() confirmed that the signed-in portal account may
 * open exactly this record (it also writes the download to the Activity log), and every read below
 * is pinned to that record id AND the company id that portal_open returned.
 */

type Db = SupabaseClient;
type Out = { bytes: Uint8Array; fileName: string } | null;

type Line = { line_no: number; description: string; quantity: number; unit: string; unit_price: number; discount_pct: number; line_total: number; product: { sku: string } | null };
const priced = (rows: unknown) =>
  ((rows ?? []) as Line[]).map((l) => ({
    line_no: l.line_no,
    description: l.description,
    sku: l.product?.sku ?? null,
    quantity: Number(l.quantity),
    unit: l.unit,
    unit_price: Number(l.unit_price),
    discount_pct: Number(l.discount_pct),
    line_total: Number(l.line_total),
  }));

async function companyOf(db: Db, companyId: string) {
  const { data } = await db.from("companies").select("*").eq("id", companyId).single();
  return data;
}

async function person(db: Db, id: string | null) {
  if (!id) return null;
  const { data } = await db.from("profiles").select("id, full_name, email, phone").eq("id", id).maybeSingle();
  return data ? displayName(data as Profile) : null;
}

export async function quotationPdf(db: Db, companyId: string, id: string): Promise<Out> {
  const { data: q } = await db
    .from("quotations")
    .select("*, client:clients(name, address, tin, vrn), rfq:rfqs(number)")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!q) return null;
  const [company, { data: lineData }, preparer] = await Promise.all([
    companyOf(db, companyId),
    db.from("quotation_lines").select("line_no, description, quantity, unit, unit_price, discount_pct, line_total, product:products(sku)").eq("quotation_id", id).eq("company_id", companyId).order("line_no"),
    person(db, q.submitted_by ?? q.created_by),
  ]);
  if (!company) return null;
  const number = quoteNo(q);
  const bytes = await buildQuotationPdf({
    company,
    logo: await loadLogo(db, company.logo_path),
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
      prepared_by: preparer,
    },
    client: { name: q.client?.name ?? "", address: q.client?.address ?? null, tin: q.client?.tin ?? null, vrn: q.client?.vrn ?? null },
    lines: priced(lineData),
  });
  return { bytes, fileName: `${number} ${q.client?.name ?? ""}.pdf` };
}

export async function invoicePdf(db: Db, companyId: string, id: string): Promise<Out> {
  const { data: inv } = await db
    .from("invoices")
    .select("*, client:clients(name, address, tin, vrn), quotation:quotations(number, revision), delivery:deliveries(number)")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!inv) return null;
  const [company, { data: lineData }, issuer] = await Promise.all([
    companyOf(db, companyId),
    db.from("invoice_lines").select("line_no, description, quantity, unit, unit_price, discount_pct, line_total, product:products(sku)").eq("invoice_id", id).eq("company_id", companyId).order("line_no"),
    person(db, inv.issued_by),
  ]);
  if (!company) return null;
  const bytes = await buildInvoicePdf({
    company,
    logo: await loadLogo(db, company.logo_path),
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
      issued_by: issuer,
    },
    client: { name: inv.client?.name ?? "", address: inv.client?.address ?? null, tin: inv.client?.tin ?? null, vrn: inv.client?.vrn ?? null },
    lines: priced(lineData),
  });
  return { bytes, fileName: `${inv.number || "Invoice"} ${inv.client?.name ?? ""}.pdf` };
}

export async function deliveryPdf(db: Db, companyId: string, id: string): Promise<Out> {
  const { data: d } = await db
    .from("deliveries")
    .select("*, client:clients(name, address, tin), store:warehouses(name), quotation:quotations(number, revision, client_ref)")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!d) return null;
  const [company, { data: lineData }, { data: moves }, driver] = await Promise.all([
    companyOf(db, companyId),
    db.from("delivery_lines").select("line_no, description, quantity, unit, product_id, product:products(sku)").eq("delivery_id", id).eq("company_id", companyId).order("line_no"),
    db.from("stock_movements").select("product_id, batch_no, expiry_date, quantity").eq("delivery_id", id).eq("company_id", companyId).eq("kind", "dispatch"),
    person(db, d.driver_id),
  ]);
  if (!company) return null;
  const batches = new Map<string, string[]>();
  for (const m of (moves ?? []) as { product_id: string; batch_no: string; expiry_date: string | null }[]) {
    if (!m.batch_no) continue;
    const label = m.expiry_date ? `${m.batch_no} (exp ${m.expiry_date})` : m.batch_no;
    batches.set(m.product_id, [...new Set([...(batches.get(m.product_id) ?? []), label])]);
  }
  let signature: { bytes: Uint8Array; type: "png" | "jpg" } | null = null;
  if (d.status === "delivered" && d.signature_path) {
    const { data: blob } = await db.storage.from("pod").download(d.signature_path);
    if (blob) signature = { bytes: new Uint8Array(await blob.arrayBuffer()), type: d.signature_path.endsWith(".jpg") ? "jpg" : "png" };
  }
  type L = { line_no: number; description: string; quantity: number; unit: string; product_id: string | null; product: { sku: string } | null };
  const bytes = await buildDeliveryNotePdf({
    company,
    logo: await loadLogo(db, company.logo_path),
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
      driver,
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
  return { bytes, fileName: `${d.number} ${d.client?.name ?? ""}.pdf` };
}

export async function purchaseOrderPdf(db: Db, companyId: string, id: string): Promise<Out> {
  const { data: po } = await db
    .from("purchase_orders")
    .select("*, supplier:suppliers(name, city, country, contact_person, email, phone, tax_no)")
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!po) return null;
  const [company, { data: lineData }, orderedBy, approvedBy] = await Promise.all([
    companyOf(db, companyId),
    db.from("po_lines").select("line_no, description, quantity, unit, unit_price, line_total, product:products(sku)").eq("po_id", id).eq("company_id", companyId).order("line_no"),
    person(db, po.submitted_by ?? po.created_by),
    person(db, po.approved_by),
  ]);
  if (!company) return null;
  type L = { line_no: number; description: string; quantity: number; unit: string; unit_price: number; line_total: number; product: { sku: string } | null };
  const bytes = await buildPurchaseOrderPdf({
    company,
    logo: await loadLogo(db, company.logo_path),
    supplier: po.supplier,
    po: {
      number: po.number,
      status: po.status,
      order_date: po.order_date,
      expected_date: po.expected_date,
      supplier_ref: po.supplier_ref,
      // Our own sales reference stays internal on the supplier's copy.
      client_ref: null,
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
      ordered_by: orderedBy,
      approved_by: approvedBy,
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
  return { bytes, fileName: `${po.number} ${po.supplier?.name ?? ""}.pdf` };
}

export async function statementPdf(
  db: Db,
  companyId: string,
  kind: "client" | "supplier",
  partyId: string,
  q: { from?: string | null; to?: string | null; ccy?: string | null },
): Promise<Out> {
  const table = kind === "client" ? "clients" : "suppliers";
  const cols = kind === "client" ? "id, company_id, name, code, address, tin, vrn" : "id, company_id, name, code, city, country, tax_no";
  const { data: row } = await db.from(table).select(cols).eq("id", partyId).eq("company_id", companyId).maybeSingle();
  if (!row) return null;
  const r = row as unknown as Record<string, string | null>;
  const party =
    kind === "client"
      ? { name: r.name ?? "", code: r.code ?? null, address: r.address ?? null, tin: r.tin ?? null, vrn: r.vrn ?? null }
      : { name: r.name ?? "", code: r.code ?? null, address: [r.city, r.country].filter(Boolean).join(", ") || null, tin: r.tax_no ?? null, vrn: null };
  const company = await companyOf(db, companyId);
  if (!company) return null;
  const def = defaultPeriod();
  const s = await loadStatement(db, companyId, kind, partyId, cleanDate(q.from, def.from), cleanDate(q.to, def.to), q.ccy || company.base_currency, (m) => methodLabel(m));
  const bytes = await buildStatementPdf({ company, logo: await loadLogo(db, company.logo_path), kind, party, statement: s, agingLabels: AGING });
  return { bytes, fileName: `Statement ${party.name} ${s.to}.pdf` };
}
