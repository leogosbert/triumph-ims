import { tr } from "@/lib/tr";

/**
 * Grey loading shapes in the shape of what is coming, for <Suspense fallback>. They shimmer
 * gently (still when the person asks for reduced motion) and are hidden from screen readers,
 * which hear one "Loading…" instead. No loading.tsx: see CLAUDE.md / the UI notes.
 */
export function Skeleton({ width, height = 14, radius, className }: { width?: number | string; height?: number | string; radius?: number; className?: string }) {
  return <span className={`skel${className ? ` ${className}` : ""}`} style={{ width, height, borderRadius: radius }} aria-hidden="true" />;
}

/** A card with a heading bar and a few lines, or a row of tiles with `tiles`. */
export function SkeletonCard({ lines = 3, tiles = 0, chart = false, label = "Loading…" }: { lines?: number; tiles?: number; chart?: boolean; label?: string }) {
  return (
    <section className="card skel-card" aria-busy="true">
      <span className="sr-only">{tr(label)}</span>
      <Skeleton width="42%" height={16} className="skel-head" />
      {tiles > 0 && (
        <div className="skel-tiles" aria-hidden="true">
          {Array.from({ length: tiles }, (_, i) => (
            <span key={i} className="skel-tile">
              <Skeleton width="55%" height={22} />
              <Skeleton width="80%" height={11} />
            </span>
          ))}
        </div>
      )}
      {chart && (
        <div className="skel-chart" aria-hidden="true">
          {[58, 72, 44, 86, 64, 78, 52].map((h, i) => (
            <Skeleton key={i} height={`${h}%`} radius={6} />
          ))}
        </div>
      )}
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "64%" : "100%"} className="skel-line" />
      ))}
    </section>
  );
}
