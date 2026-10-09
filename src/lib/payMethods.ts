/** Payment methods and mobile-money services (no server imports: also used by client components). */

export const PAY_METHODS: Record<string, string> = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  mobile_money: "Mobile money",
  cheque: "Cheque",
  other: "Other",
};

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
  return PAY_METHODS[method] ?? method;
}
