import { encodeQr } from "@/lib/getpaid/qr";

/** A QR code as inline SVG (no script, no network). */
export function QrSvg({ text, size = 132, label }: { text: string; size?: number; label?: string }) {
  let grid: boolean[][];
  try {
    grid = encodeQr(text, "M");
  } catch {
    return null;
  }
  const n = grid.length;
  const quiet = 4;
  const dim = n + quiet * 2;
  let d = "";
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (grid[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} role="img" aria-label={label ?? text} shapeRendering="crispEdges" style={{ background: "#fff", borderRadius: 6 }}>
      <rect width={dim} height={dim} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
