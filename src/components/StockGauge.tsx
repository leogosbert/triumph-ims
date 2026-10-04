import { tr } from "@/lib/tr";

/**
 * Small half-circle gauge for a stock level.
 * Full scale = 3 × the reorder level (a healthy amount); the white tick marks the reorder level.
 * Red: at or below reorder level · amber: getting low · green: healthy · teal: no reorder level set.
 */
export function StockGauge({ qty, reorder, scaleMax, unit }: { qty: number; reorder: number | null; scaleMax: number; unit: string }) {
  const hasLevel = reorder != null && reorder > 0;
  const full = hasLevel ? reorder! * 3 : Math.max(scaleMax, 1);
  const pct = Math.max(0, Math.min(1, qty / full));
  const tone = !hasLevel ? "none" : qty <= reorder! ? "low" : qty <= reorder! * 2 ? "mid" : "ok";
  const label = !hasLevel ? tr("No reorder level") : tone === "low" ? tr("Reorder now") : tone === "mid" ? tr("Getting low") : tr("Healthy");
  // Arc from left (180°) to right (0°), radius 20, centre (26, 26).
  const tickA = Math.PI * (1 - (hasLevel ? reorder! / full : 0));
  const tx1 = 26 + 15 * Math.cos(tickA);
  const ty1 = 26 - 15 * Math.sin(tickA);
  const tx2 = 26 + 25 * Math.cos(tickA);
  const ty2 = 26 - 25 * Math.sin(tickA);
  const q = Number.isInteger(qty) ? qty.toLocaleString("en-GB") : qty.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  return (
    <span className={`gauge g-${tone}`} title={`${q} ${unit} · ${label}`}>
      <svg viewBox="0 0 52 30" aria-hidden="true">
        <path className="gauge-bg" d="M6 26 A20 20 0 0 1 46 26" pathLength={100} />
        <path className="gauge-val" d="M6 26 A20 20 0 0 1 46 26" pathLength={100} style={{ strokeDasharray: `${pct * 100} 100` }} />
        {hasLevel && <line className="gauge-tick" x1={tx1} y1={ty1} x2={tx2} y2={ty2} />}
      </svg>
      <span className="gauge-n num">{q}</span>
      <span className="gauge-u">{unit}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
