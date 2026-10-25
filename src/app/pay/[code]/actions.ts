"use server";

import { gatewayFor } from "@/lib/getpaid/gateways";
import { inboxAdmin } from "@/lib/inbox/server";
import { waDigits } from "@/lib/inbox/whatsapp";
import { siteUrl } from "@/lib/supabase/env";

export type StartResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * The client pressed Pay on the public pay page: a new order is made for the invoice (service role,
 * public.pay_order_start checks the link, the amount and the number of tries) and the gateway's
 * checkout page address is returned. The browser goes there itself (the page's form-action stays 'self').
 */
export async function startPayment(code: string, phone: string, amount: string): Promise<StartResult> {
  if (!/^[a-f0-9]{32}$/.test(code)) return { ok: false, error: "This pay link is no longer valid." };
  const digits = waDigits(phone);
  if (!digits || !/^255[67]\d{8}$/.test(digits)) return { ok: false, error: "Enter the phone number that will pay (e.g. 0754 123 456)." };
  const db = inboxAdmin();
  if (!db) return { ok: false, error: "Online payment is not available right now. Please pay by bank transfer." };
  const n = Number(String(amount ?? "").replace(/[,\s]/g, ""));
  const { data, error } = await db.rpc("pay_order_start", { p_code: code, p_amount: Number.isFinite(n) && n > 0 ? n : null });
  if (error || !data) return { ok: false, error: (error?.message ?? "This pay link is no longer valid.").slice(0, 200) };
  const o = data as {
    order_id: string;
    provider: string;
    amount: number;
    currency: string;
    invoice_number: string;
    company: string;
    buyer: { name: string; email: string | null; phone: string | null };
  };
  const gw = gatewayFor(o.provider);
  if (!gw || !gw.configured()) {
    await db.rpc("pay_order_checkout", { p_order: o.order_id, p_url: null, p_ref: null, p_error: "Gateway not set up on the server" });
    return { ok: false, error: "Online payment is not available right now. Please pay by bank transfer." };
  }
  // The site's own address (NEXT_PUBLIC_SITE_URL), never one taken from the request.
  const base = siteUrl();
  const res = await gw.createCheckout({
    orderId: o.order_id,
    amount: Number(o.amount),
    currency: o.currency,
    buyer: { name: o.buyer.name || "Client", email: o.buyer.email, phone: digits },
    description: `${o.company}: invoice ${o.invoice_number}`,
    returnUrl: `${base}/pay/${code}?done=1`,
    cancelUrl: `${base}/pay/${code}`,
    webhookUrl: `${base}/api/payments/${gw.id}`,
  });
  await db.rpc("pay_order_checkout", {
    p_order: o.order_id,
    p_url: res.ok ? res.url : null,
    p_ref: res.ok ? res.reference : null,
    p_error: res.ok ? null : res.error,
  });
  return res.ok ? { ok: true, url: res.url } : { ok: false, error: res.error };
}
