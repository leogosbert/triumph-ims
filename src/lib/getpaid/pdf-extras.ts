import type { SupabaseClient } from "@supabase/supabase-js";
import { payLinkUrl } from "./common";

/**
 * What the invoice PDF prints from "Getting paid": the TRA fiscal receipt with its verification link,
 * and the pay link (made the first time it is needed, when the company prints pay links on documents).
 * Never fails the PDF: anything missing (tables not created yet, feature off) is simply left out.
 */
export async function invoicePdfExtras(
  supabase: SupabaseClient,
  inv: { id: string; company_id: string; status: string },
): Promise<{
  fiscal: { receipt_no: string | null; z_number: string | null; verification_code: string | null; receipt_at: string | null; verify_url: string } | null;
  payUrl: string | null;
}> {
  let fiscal = null;
  let payUrl: string | null = null;
  try {
    const { data } = await supabase
      .from("fiscal_receipts")
      .select("receipt_no, z_number, verification_code, receipt_at, verify_url")
      .eq("invoice_id", inv.id)
      .eq("kind", "receipt")
      .in("status", ["posted", "recorded"])
      .not("verify_url", "is", null)
      .maybeSingle();
    if (data?.verify_url) fiscal = data as typeof fiscal & { verify_url: string };
  } catch {
    fiscal = null;
  }
  if (inv.status === "issued" || inv.status === "partly_paid") {
    try {
      const { data: s, error } = await supabase.from("pay_settings").select("on_documents").eq("company_id", inv.company_id).maybeSingle();
      if (!error && (s?.on_documents ?? true)) {
        const { data: code } = await supabase.rpc("pay_link_get", { p_invoice: inv.id });
        if (typeof code === "string" && /^[a-f0-9]{32}$/.test(code)) payUrl = payLinkUrl(code);
      }
    } catch {
      payUrl = null;
    }
  }
  return { fiscal, payUrl };
}
