import { AGING, methodLabel } from "@/lib/finance";
import { buildStatementPdf } from "@/lib/pdf/finance";
import { loadLogo, pdfResponse } from "@/lib/pdf/load";
import { cleanDate, defaultPeriod, loadStatement } from "@/lib/statements";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** The supplier statement of account as a PDF. Access is checked by the database rules. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const { data: sup } = await supabase.from("suppliers").select("id, company_id, name, code, city, country, tax_no").eq("id", id).maybeSingle();
  if (!sup) return new Response("Supplier not found.", { status: 404 });
  const party = {
    id: sup.id as string,
    company_id: sup.company_id as string,
    name: sup.name as string,
    code: sup.code as string | null,
    address: [sup.city, sup.country].filter(Boolean).join(", ") || null,
    tin: sup.tax_no as string | null,
    vrn: null,
  };
  const { data: company } = await supabase.from("companies").select("*").eq("id", party.company_id).single();
  if (!company) return new Response("Company not found.", { status: 404 });
  const def = defaultPeriod();
  const s = await loadStatement(
    supabase,
    company.id,
    "supplier",
    id,
    cleanDate(url.searchParams.get("from"), def.from),
    cleanDate(url.searchParams.get("to"), def.to),
    url.searchParams.get("ccy") || company.base_currency,
    (m) => methodLabel(m),
  );
  const bytes = await buildStatementPdf({
    company,
    logo: await loadLogo(supabase, company.logo_path),
    kind: "supplier",
    party,
    statement: s,
    agingLabels: AGING,
  });
  return pdfResponse(bytes, `Statement ${party.name} ${s.to}.pdf`);
}
