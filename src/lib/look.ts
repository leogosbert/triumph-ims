/**
 * The person's app style (Account → Appearance → Style), saved per browser like the background.
 * "glass": frosted panels over a living photo background, a floating sidebar that folds to icons,
 *          section colours that blend as you move around (src/app/glass.css).
 * "classic": the earlier look, unchanged.
 * Everyone without a saved choice gets Glass. (Reading the cookie: src/lib/look-server.ts; this file is
 * also used by client components.)
 */
export const LOOK_COOKIE = "look";
export const LOOKS = ["glass", "classic"] as const;
export type LookPref = (typeof LOOKS)[number];

export function isLookPref(v: unknown): v is LookPref {
  return typeof v === "string" && (LOOKS as readonly string[]).includes(v);
}

/** Where the folded-sidebar choice is kept (per device). */
export const RAIL_KEY = "lemosp-side-rail";

/**
 * Runs before the first paint (root layout) so nothing jumps:
 * folded sidebar: data-side="rail" on <html> when this device chose it, and always up to 1100px wide.
 * (The start animation is timed by SPLASH_SCRIPT in src/components/Splash.tsx, for either style.)
 * Every storage call is wrapped: private windows simply skip the memory.
 */
export const LOOK_SCRIPT = `(function(){var d=document.documentElement;if(d.getAttribute("data-look")!=="glass")return;var r=false;try{r=window.matchMedia("(max-width: 1100px)").matches;r=r||localStorage.getItem("${RAIL_KEY}")==="1"}catch(e){}if(r)d.setAttribute("data-side","rail")})();`;
