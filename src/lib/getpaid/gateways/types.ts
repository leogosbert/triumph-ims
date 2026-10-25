/**
 * What every payment gateway adapter provides (Selcom first; AzamPay or ClickPesa are added by writing
 * one more file like selcom.ts and listing it in index.ts, plus its name in public.pay_providers()).
 */

export type CheckoutRequest = {
  orderId: string;
  amount: number;
  currency: string;
  buyer: { name: string; email: string | null; phone: string | null };
  description: string;
  /** Where the client comes back to after paying (or cancelling). */
  returnUrl: string;
  cancelUrl: string;
  /** Where the gateway reports the payment: https://<site>/api/payments/<provider>. */
  webhookUrl: string;
};

export type CheckoutResult = { ok: true; url: string; reference: string | null } | { ok: false; error: string };

/** A payment the gateway reported, in the app's words. */
export type GatewayEvent = {
  orderId: string;
  status: "success" | "pending" | "failed";
  amount: number | null;
  transactionId: string | null;
  reference: string | null;
  channel: string | null;
  /** As in the payments table: mobile money (with the service), card / bank (bank_transfer) or other. */
  method: "mobile_money" | "bank_transfer" | "other";
  mmProvider: string | null;
  phone: string | null;
  message: string | null;
};

export type WebhookCheck = { ok: true; event: GatewayEvent } | { ok: false; reason: string; orderId: string | null };

export interface PaymentGateway {
  id: string;
  label: string;
  /** Which client payment methods it offers (shown on the pay page). */
  methods: string[];
  /** The server has the gateway's keys (never says which). */
  configured(): boolean;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  /** Checks the webhook's signature and reads it. Pure apart from the clock: no network. */
  verifyWebhook(headers: Headers, rawBody: string, nowMs?: number): WebhookCheck;
  /** Asks the gateway itself for the order's state (the second check before money is recorded). */
  confirm(orderId: string): Promise<{ status: GatewayEvent["status"]; amount: number | null } | null>;
}

/** Wallet / card names the gateways report → the app's payment method and mobile-money service. */
export function channelToMethod(channel: string | null | undefined): { method: GatewayEvent["method"]; mmProvider: string | null } {
  const c = (channel ?? "").toUpperCase();
  if (/M-?PESA|VODACOM/.test(c)) return { method: "mobile_money", mmProvider: "mpesa" };
  if (/AIRTEL/.test(c)) return { method: "mobile_money", mmProvider: "airtel_money" };
  if (/TIGO|MIXX|YAS/.test(c)) return { method: "mobile_money", mmProvider: "tigopesa" };
  if (/HALO/.test(c)) return { method: "mobile_money", mmProvider: "halopesa" };
  if (/AZAM/.test(c)) return { method: "mobile_money", mmProvider: "azampesa" };
  if (/VISA|MASTER|CARD|AMEX|UNIONPAY|BANK|CRDB|NMB/.test(c)) return { method: "bank_transfer", mmProvider: null };
  if (/PESA|WALLET|TTCL|SELCOM/.test(c)) return { method: "mobile_money", mmProvider: "other" };
  return { method: "other", mmProvider: null };
}
