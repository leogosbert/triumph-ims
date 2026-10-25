/**
 * Glass style start animation: the company logo spins in with a glow, the name rises under it, and
 * the screen fades away. Shown on the first page of a session only; LOOK_SCRIPT (src/lib/look.ts)
 * switches it on and off before the first paint, so it never flashes on later screens.
 * Without a company logo it uses the LeMoSp mark. "Reduce motion": no spin, a quick fade.
 */
export function GlassSplash({ logo, name }: { logo?: string | null; name: string }) {
  return (
    <div className="gsplash-screen" aria-hidden="true">
      <div className="gsplash-glow" />
      <div className="gsplash-inner">
        <div className="gsplash-orbit">
          <span className="gsplash-ring" />
          <img className={`gsplash-logo${logo ? "" : " is-mark"}`} src={logo || "/brand/lemosp-mark.svg"} alt="" />
        </div>
        <strong className="gsplash-name">{name}</strong>
        <span className="gsplash-bar" />
      </div>
    </div>
  );
}
