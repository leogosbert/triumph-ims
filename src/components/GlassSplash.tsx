/**
 * Company launch ("supply routes"): delivery routes draw in from the edges of the screen with a
 * light running along each one, they meet in the middle where the company tile lands, the mark
 * builds itself piece by piece (TRIUMPH: the pillar grows, the two chevrons climb into place), a
 * light sweeps across it, the name opens out and a thin bar fills; then the whole screen rolls up
 * like a shutter. About 2.3 s plus 0.5 s for the lift; a tap skips it.
 *
 * Timing and "once per app open" live in SPLASH_SCRIPT (src/components/Splash.tsx); this markup is
 * display: none unless <html> has "splash-on", so it never flashes on later screens. Only transform,
 * opacity, clip-path and stroke offsets move, so modest phones run it smoothly while the app loads
 * underneath. Reduce motion: no movement, a short fade.
 *
 * brand: a key from src/lib/brands.ts whose mark is drawn here in pieces; otherwise the company logo
 * (or the LeMoSp mark) lands as one tile.
 */
const ROUTES = [
  "M-900,-170 H-190 Q-150,-170 -150,-130 V-40 Q-150,0 -110,0 H-92",
  "M900,160 H190 Q150,160 150,120 V40 Q150,0 110,0 H92",
  "M-60,-900 V-200 Q-60,-160 -20,-160 Q0,-160 0,-140 V-92",
  "M70,900 V230 Q70,190 30,190 Q0,190 0,170 V92",
  "M-900,260 H-280 Q-240,260 -240,220 V140 Q-240,100 -200,100 H-120 Q-80,100 -80,60",
  "M900,-300 H300 Q260,-300 260,-260 V-140 Q260,-100 220,-100 H120 Q80,-100 80,-60",
];
const NODES: [number, number][] = [
  [-92, 0],
  [92, 0],
  [0, -92],
  [0, 92],
  [-80, 60],
  [80, -60],
];

function TriumphMark() {
  return (
    <svg className="lx-mark" viewBox="0 0 40 40">
      <rect className="lx-p lx-base" width="40" height="40" rx="9" fill="#1C4C9B" />
      <rect className="lx-p lx-pillar" x="17.6" y="22.6" width="4.8" height="11.4" rx="1" fill="#FFFFFF" />
      <path className="lx-p lx-chev2" d="M20 16.5 30 26h-5.6L20 21.9 15.6 26H10z" fill="#A9B4C2" />
      <path className="lx-p lx-chev1" d="M20 6 34 19h-6.2L20 11.8 12.2 19H6z" fill="#FFFFFF" />
    </svg>
  );
}

export function GlassSplash({
  logo,
  name,
  tagline,
  brand,
}: {
  logo?: string | null;
  name: string;
  tagline: string;
  brand?: string | null;
}) {
  const pieces = brand === "triumph";
  const src = logo || "/brand/lemosp-mark.svg";
  return (
    <div className="gsplash-screen" aria-hidden="true">
      <div className="lx-hub">
        <svg className="lx-routes" viewBox="-800 -800 1600 1600">
          {ROUTES.map((d, i) => (
            <g key={i} style={{ "--i": i } as React.CSSProperties}>
              <path className="lx-route" d={d} pathLength={1} />
              <path className="lx-comet" d={d} pathLength={1} />
            </g>
          ))}
          {NODES.map(([x, y], i) => (
            <circle key={i} className="lx-node" cx={x} cy={y} r="5" style={{ "--i": i } as React.CSSProperties} />
          ))}
        </svg>
        <span className="lx-frame" />
        <div className={`lx-tile${pieces ? " is-pieces" : logo ? " is-logo" : " is-mark"}`}>
          {pieces ? <TriumphMark /> : <span className="lx-face" style={{ backgroundImage: `url("${src}")` }} />}
          <span className="lx-sheen" />
        </div>
      </div>
      <div className="lx-word">
        <b>{name}</b>
        <i>{tagline}</i>
        <span className="lx-bar">
          <span />
        </span>
      </div>
    </div>
  );
}
