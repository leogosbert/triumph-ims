import { selcom } from "./selcom";
import type { PaymentGateway } from "./types";

/**
 * The payment gateways the app can use. To add one (AzamPay, ClickPesa, ...):
 *   1. write gateways/<name>.ts implementing PaymentGateway (see selcom.ts and types.ts),
 *   2. list it here,
 *   3. add its name to public.pay_providers() in a migration (it is already there for azampay and clickpesa),
 *   4. give the gateway the webhook address https://<site>/api/payments/<name>.
 */
export const GATEWAYS: Record<string, PaymentGateway> = { selcom };

export function gatewayFor(id: string | null | undefined): PaymentGateway | null {
  return id && Object.prototype.hasOwnProperty.call(GATEWAYS, id) ? GATEWAYS[id] : null;
}

/** For the settings screen: every gateway with whether the server has its keys. */
export function gatewayList(): { id: string; label: string; methods: string[]; configured: boolean }[] {
  return Object.values(GATEWAYS).map((g) => ({ id: g.id, label: g.label, methods: g.methods, configured: g.configured() }));
}
