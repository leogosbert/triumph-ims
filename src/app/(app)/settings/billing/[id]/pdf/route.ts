import { pdfResponse } from "@/lib/pdf/load";
import { platformInvoicePdf } from "@/lib/pdf/platformInvoice";
import { createClient } from "@/lib/supabase/server";
import { primeLang, tr } from "@/lib/tr";

/** A LeMo Tech invoice as a PDF (management and finance of the company; the database checks). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await primeLang();
  const out = await platformInvoicePdf(await createClient(), (await params).id, tr);
  if (!out) return new Response("Not found", { status: 404 });
  return pdfResponse(out.bytes, out.name);
}
