/**
 * A money figure with the currency set smaller beside the number ("TZS 4.2M", "TZS 1,250,000").
 * No hooks, so server and client screens can both use it. The number sits in its own `.money-amt`
 * span, which is what CountUp targets (CountUp rewrites the text of the element it is given).
 */

/** Short money: 1.2B, 4.2M, 850K. */
export function shortAmount(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
}

/** The number part of formatMoney (same rounding: TZS has no decimals, other currencies two). */
export function moneyAmount(amount: number, currency: string): string {
  const decimals = currency === "TZS" ? 0 : 2;
  return amount.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function MoneyFig({
  value,
  currency,
  short = false,
  className,
}: {
  value: number | string | null | undefined;
  currency: string;
  /** 4.2M instead of 4,200,000 (tiles). */
  short?: boolean;
  className?: string;
}) {
  const v = typeof value === "string" ? Number(value) : value;
  if (v === null || v === undefined || !Number.isFinite(v)) return <span className={className}>—</span>;
  const amt = short ? shortAmount(v) : moneyAmount(v, currency);
  return (
    <span className={`money-fig${className ? ` ${className}` : ""}`}>
      <span className="money-cur">{currency}</span> <span className="money-amt">{amt}</span>
    </span>
  );
}
