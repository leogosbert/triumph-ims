export function formatMoney(amount: number | string | null | undefined, currency = "TZS") {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  const decimals = currency === "TZS" ? 0 : 2;
  return `${currency} ${n.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function marginPercent(price: number | null | undefined, cost: number | null | undefined) {
  if (!price || cost === null || cost === undefined) return null;
  return ((price - cost) / price) * 100;
}
