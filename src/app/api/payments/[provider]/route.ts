import { gatewayFor } from "@/lib/getpaid/gateways";
import { inboxAdmin } from "@/lib/inbox/server";
import { readCappedBody } from "@/lib/inbox/signatures";

export const dynamic = "force-dynamic";

/**
 * Payment gateway webhook: https://<site>/api/payments/<provider> (e.g. /api/payments/selcom).
 *  1. the signature is checked (a bad one is logged and ignored),
 *  2. a reported success is confirmed by asking the gateway itself (order-status),
 *  3. the payment is recorded once by public.pay_gateway_result (service role), which posts it to
 *     the invoice and the books like any other payment.
 * Always answers 200 for a checked message so the gateway does not keep resending it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const gw = gatewayFor(provider);
  if (!gw) return Response.json({ error: "Unknown provider" }, { status: 404 });
  const db = inboxAdmin();
  if (!db || !gw.configured()) return Response.json({ error: "Not configured" }, { status: 503 });

  const raw = await readCappedBody(req, 64 * 1024);
  if (raw === null) return Response.json({ error: "Too large" }, { status: 413 });

  const check = gw.verifyWebhook(req.headers, raw);
  if (!check.ok) {
    await db.rpc("pay_event_rejected", { p_provider: gw.id, p_order: check.orderId, p_reason: check.reason, p_detail: { bytes: raw.length } });
    return Response.json({ error: "Not accepted" }, { status: 401 });
  }
  const ev = check.event;
  let status = ev.status;
  let amount = ev.amount;
  if (status === "success") {
    const confirmed = await gw.confirm(ev.orderId);
    if (!confirmed) {
      // The gateway could not be asked: answer with an error so it sends the webhook again later.
      await db.rpc("pay_event_rejected", { p_provider: gw.id, p_order: ev.orderId, p_reason: "not_confirmed", p_detail: { status } });
      return Response.json({ error: "Could not confirm" }, { status: 503 });
    }
    if (confirmed.status !== "success") status = confirmed.status;
    if (confirmed.amount !== null) amount = confirmed.amount;
  }
  const { data, error } = await db.rpc("pay_gateway_result", {
    p_provider: gw.id,
    p_order: ev.orderId,
    p_status: status,
    p_amount: amount,
    p_transaction: ev.transactionId,
    p_reference: ev.reference,
    p_channel: ev.channel,
    p_method: ev.method,
    p_mm_provider: ev.mmProvider,
    p_phone: ev.phone,
    p_detail: { status: ev.status, confirmed: status, message: ev.message, channel: ev.channel },
  });
  if (error) {
    console.warn(`payments/${gw.id}: ${error.message}`);
    return Response.json({ error: "Not recorded" }, { status: 500 });
  }
  return Response.json({ ok: true, outcome: (data as { outcome?: string } | null)?.outcome ?? null });
}

export function GET() {
  return Response.json({ ok: true });
}
