import { pdfResponse } from "@/lib/pdf/load";
import { platformInvoicePdf } from "@/lib/pdf/platformInvoice";
import { createClient } from "@/lib/supabase/server";
import { primeLang, tr } from "@/lib/tr";

/** A LeMo Tech invoice as a PDF, for the LeMo Tech team (the database checks it is a platform admin). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await primeLang();
  const out = await platformInvoicePdf(await createClient(), (await params).id, tr);
  if (!out) return new Response("Not found", { status: 404 });
  return pdfResponse(out.bytes, out.name);
}
