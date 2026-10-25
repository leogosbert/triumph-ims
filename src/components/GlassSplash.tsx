/**
 * Glass style start animation (after the Cocozania ERP intro): a glow breathes in, a ring of the
 * company's blues spins, the two halves of the company logo slide together and turn into place, the
 * name writes itself in letter by letter, then the whole stage lifts away. Shown on the first page
 * of a session only; LOOK_SCRIPT (src/lib/look.ts) switches it on and off before the first paint, so
 * it never flashes on later screens. Without a company logo it uses the LeMoSp mark.
 * "Reduce motion": no movement, a quick fade.
 */
export function GlassSplash({ logo, name, tagline }: { logo?: string | null; name: string; tagline: string }) {
  const src = logo || "/brand/lemosp-mark.svg";
  const face = { backgroundImage: `url("${src}")` };
  return (
    <div className="gsplash-screen" aria-hidden="true">
      <div className="gsplash-stage">
        <span className="gsplash-glow" />
        <span className="gsplash-ring" />
        <div className={`gsplash-logo${logo ? "" : " is-mark"}`}>
          <span className="gsplash-shadow" />
          <span className="gsplash-half l" style={face} />
          <span className="gsplash-half r" style={face} />
        </div>
        <span className="gsplash-ripple" />
        <div className="gsplash-word">
          <b>
            {Array.from(name).map((ch, i) => (
              <span key={i} style={{ animationDelay: `${(0.45 + Math.min(i, 24) * 0.028).toFixed(3)}s` }}>
                {ch === " " ? " " : ch}
              </span>
            ))}
          </b>
          <i>{tagline}</i>
        </div>
      </div>
    </div>
  );
}
