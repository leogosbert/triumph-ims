import { displayName, type Profile } from "@/lib/context";
import { AGING, methodLabel } from "@/lib/finance";
import { buildStatementPdf } from "@/lib/pdf/finance";
import { buildFinancingPack, type FinancingPack, type PackFile } from "@/lib/pdf/financingPack";
import { loadLogo, pdfResponse } from "@/lib/pdf/load";
import { buildQuotationPdf } from "@/lib/pdf/quotation";
import { quoteNo, todayTz } from "@/lib/sales";
import { loadStatement } from "@/lib/statements";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

const MAX_FILE = 6 * 1024 * 1024;

function typeOf(path: string, blobType: string): string {
  if (/\.pdf$/i.test(path) || blobType === "application/pdf") return "application/pdf";
  if (/\.png$/i.test(path) || blobType === "image/png") return "image/png";
  if (/\.jpe?g$/i.test(path) || blobType === "image/jpeg") return "image/jpeg";
  return blobType || "application/octet-stream";
}

/**
 * The bank-ready financing pack as one PDF (management and finance; the database checks access in
 * financing_pack). Stored papers are read with the person's own rights from the documents library.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found.", { status: 404 });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const { data: pack, error } = await supabase.rpc("financing_pack", { p_id: id });
  if (error || !pack) return new Response("Financing request not found.", { status: 404 });
  const p = pack as FinancingPack;
  const companyId = String(p.request.company_id);
  const quotationId = String(p.request.quotation_id);
  const clientId = String(p.request.client_id);

  const [{ data: company }, { data: q }, { data: lineData }, { data: me }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", companyId).single(),
    supabase.from("quotations").select("*, client:clients(name, address, tin, vrn), rfq:rfqs(number)").eq("id", quotationId).maybeSingle(),
    supabase.from("quotation_lines").select("line_no, description, quantity, unit, unit_price, discount_pct, line_total, product:products(sku)").eq("quotation_id", quotationId).order("line_no"),
    supabase.from("profiles").select("id, full_name, email, phone").eq("id", user.id).maybeSingle(),
  ]);
  if (!company) return new Response("Company not found.", { status: 404 });
  const logo = await loadLogo(supabase, company.logo_path);

  let quotationPdf: Uint8Array | null = null;
  if (q) {
    type L = { line_no: number; description: string; quantity: number; unit: string; unit_price: number; discount_pct: number; line_total: number; product: { sku: string } | null };
    quotationPdf = await buildQuotationPdf({
      company,
      logo,
      quote: {
        number: quoteNo(q),
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
        prepared_by: null,
      },
      client: { name: q.client?.name ?? "", address: q.client?.address ?? null, tin: q.client?.tin ?? null, vrn: q.client?.vrn ?? null },
      lines: ((lineData ?? []) as unknown as L[]).map((l) => ({
        line_no: l.line_no,
        description: l.description,
        sku: l.product?.sku ?? null,
        quantity: Number(l.quantity),
        unit: l.unit,
        unit_price: Number(l.unit_price),
        discount_pct: Number(l.discount_pct),
        line_total: Number(l.line_total),
      })),
    });
  }

  // The client's statement for the last 12 months, in the order's currency.
  let statementPdf: Uint8Array | null = null;
  try {
    const { data: party } = await supabase.from("clients").select("id, name, code, address, tin, vrn").eq("id", clientId).maybeSingle();
    if (party) {
      const to = todayTz();
      const d = new Date(`${to}T12:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - 12, 1);
      const s = await loadStatement(supabase, companyId, "client", clientId, d.toISOString().slice(0, 10), to, p.request.currency, (m) => methodLabel(m));
      if (s.rows.length || s.opening || s.closing) {
        statementPdf = await buildStatementPdf({ company, logo, kind: "client", party, statement: s, agingLabels: AGING });
      }
    }
  } catch {
    statementPdf = null;
  }

  const download = async (path: string): Promise<PackFile> => {
    try {
      const { data: blob, error: e } = await supabase.storage.from("documents").download(path);
      if (e || !blob || blob.size > MAX_FILE) return null;
      return { bytes: new Uint8Array(await blob.arrayBuffer()), type: typeOf(path, blob.type) };
    } catch {
      return null;
    }
  };

  const bytes = await buildFinancingPack({
    pack: p,
    company,
    logo,
    signedBy: me ? displayName(me as Profile) : null,
    quotationPdf,
    statementPdf,
    download,
    budgetMs: 4500,
  });
  return pdfResponse(bytes, `${p.request.number} financing pack ${p.client?.name ?? ""}.pdf`);
}
