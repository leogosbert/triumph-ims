import { displayName, type Profile } from "@/lib/context";
import { PAY_METHODS } from "@/lib/finance";
import { buildReceiptPdf } from "@/lib/pdf/finance";
import { loadLogo, pdfResponse } from "@/lib/pdf/load";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Receipt for a payment received. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Please sign in.", { status: 401 });

  const { data: p } = await supabase
    .from("payments")
    .select("*, client:clients(name, address, tin, vrn), invoice:invoices(id, number, total)")
    .eq("id", id)
    .maybeSingle();
  if (!p || p.voided_at) return new Response("Receipt not found.", { status: 404 });

  const [{ data: company }, { data: earlier }, { data: recorder }] = await Promise.all([
    supabase.from("companies").select("*").eq("id", p.company_id).single(),
    supabase
      .from("payments")
      .select("id, amount, received_on, created_at")
      .eq("invoice_id", p.invoice_id)
      .is("voided_at", null),
    p.created_by
      ? supabase.from("profiles").select("id, full_name, email, phone").eq("id", p.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!company) return new Response("Company not found.", { status: 404 });

  // Balance right after this payment: everything paid up to and including it.
  const paidUpTo = ((earlier ?? []) as { amount: number; received_on: string; created_at: string }[])
    .filter((e) => e.received_on < p.received_on || (e.received_on === p.received_on && e.created_at <= p.created_at))
    .reduce((s, e) => s + Number(e.amount), 0);

  const bytes = await buildReceiptPdf({
    company,
    logo: await loadLogo(supabase, company.logo_path),
    receipt: {
      number: p.number,
      received_on: p.received_on,
      amount: Number(p.amount),
      currency: p.currency,
      method: PAY_METHODS[p.method] ?? p.method,
      reference: p.reference,
      invoice_number: p.invoice?.number ?? "",
      invoice_total: Number(p.invoice?.total ?? 0),
      balance_after: Math.max(0, Number(p.invoice?.total ?? 0) - paidUpTo),
      recorded_by: recorder ? displayName(recorder as Profile) : null,
    },
    client: {
      name: p.client?.name ?? "",
      address: p.client?.address ?? null,
      tin: p.client?.tin ?? null,
      vrn: p.client?.vrn ?? null,
    },
  });
  return pdfResponse(bytes, `${p.number} ${p.client?.name ?? ""}.pdf`);
}
