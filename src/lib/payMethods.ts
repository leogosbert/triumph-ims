/** Payment methods and mobile-money services (no server imports: also used by client components). */

export const PAY_METHODS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  mobile_money: "Mobile money",
  cheque: "Cheque",
  other: "Other",
};

/** A client's withholding tax certificate, recorded as part payment of an invoice (v1.21, client payments only). */
export const WITHHOLDING_LABEL = "Withholding tax certificate";

/** Mobile-money services (Stage 13). Kept in step with public.mobile_money_providers(). */
export const MOBILE_MONEY: Record<string, string> = {
  mpesa: "M-Pesa",
  tigopesa: "Mixx by Yas (Tigo Pesa)",
  airtel_money: "Airtel Money",
  halopesa: "HaloPesa",
  azampesa: "AzamPesa",
  other: "Other mobile money",
};

/** "M-Pesa" for a mobile-money payment whose service is known, otherwise the method ("Bank transfer"). */
export function methodLabel(method: string, provider?: string | null) {
  if (method === "mobile_money" && provider && MOBILE_MONEY[provider]) return MOBILE_MONEY[provider];
  if (method === "withholding_tax") return WITHHOLDING_LABEL;
  if (method === "credit_note") return "Credit note";
  return PAY_METHODS[method] ?? method;
}
