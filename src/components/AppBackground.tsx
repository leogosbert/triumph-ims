import type { BackgroundPref } from "@/lib/background";

/**
 * The decorative layer behind every screen, drawn in the company's own colours (--brand, --brand-dark).
 * Fixed behind the page, never clickable, hidden when printing; movement stops for "reduce motion".
 */
export function AppBackground({ kind }: { kind: BackgroundPref }) {
  if (kind === "plain") return null;
  return (
    <div className="app-bg" data-bg={kind} aria-hidden="true">
      {kind === "aurora" && (
        <>
          <span className="blob b1" />
          <span className="blob b2" />
          <span className="blob b3" />
        </>
      )}
      {kind === "grid" && <span className="grid-lines" />}
      {kind === "waves" && (
        <svg viewBox="0 0 1440 320" preserveAspectRatio="none">
          <path className="w1" d="M0 192 C 240 120 480 260 720 210 S 1200 110 1440 170 V320 H0Z" />
          <path className="w2" d="M0 236 C 260 180 520 290 780 250 S 1220 180 1440 228 V320 H0Z" />
          <path className="w3" d="M0 276 C 300 240 560 310 820 286 S 1240 250 1440 280 V320 H0Z" />
        </svg>
      )}
      {kind === "mountains" && (
        <svg viewBox="0 0 1440 320" preserveAspectRatio="xMidYMax slice">
          <path className="m1" d="M0 250 L180 170 L320 215 L520 120 L660 190 L820 140 L1000 210 L1180 150 L1440 230 V320 H0Z" />
          <path className="m2" d="M0 290 L220 220 L400 260 L610 150 L700 132 L790 150 L980 250 L1200 205 L1440 270 V320 H0Z" />
          <path className="snow" d="M610 150 L700 132 L790 150 L760 158 L735 150 L712 162 L690 150 L664 160 L640 152Z" />
        </svg>
      )}
    </div>
  );
}
