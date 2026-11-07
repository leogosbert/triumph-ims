/**
 * A tiny trend line (inline SVG, no library) and an up or down arrow against last month.
 * No hooks: the caller passes its own `tr` (server tr() or the client useTr()).
 */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const W = 72;
  const H = 22;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (W - 4) + 2, H - 3 - ((v - min) / span) * (H - 6)] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `2,${H} ${line} ${W - 2},${H}`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg className={`spark${className ? ` ${className}` : ""}`} viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} focusable="false">
      <polygon points={area} className="spark-area" />
      <polyline points={line} className="spark-line" fill="none" />
      <circle cx={lx} cy={ly} r="2.2" className="spark-dot" />
    </svg>
  );
}

/** "▲ 12%" / "▼ 8%" against last month's pace; nothing when there is no fair comparison. */
export function TrendArrow({ change, tr }: { change: number | null | undefined; tr: (s: string) => string }) {
  if (change === null || change === undefined || !Number.isFinite(change)) return null;
  const capped = Math.max(-999, Math.min(999, change));
  const dir = capped > 0 ? "up" : capped < 0 ? "down" : "flat";
  const text =
    dir === "up"
      ? `${capped}% ${tr("ahead of last month's pace")}`
      : dir === "down"
        ? `${-capped}% ${tr("behind last month's pace")}`
        : tr("Level with last month's pace");
  return (
    <span className={`trend trend-${dir}`} title={text}>
      <span aria-hidden="true">
        {dir === "up" ? "▲" : dir === "down" ? "▼" : "▬"} {Math.abs(capped)}%
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
