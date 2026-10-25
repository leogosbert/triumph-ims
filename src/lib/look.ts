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
/** Session flag: the Glass start animation has been shown. */
export const GLASS_SPLASH_KEY = "lemosp-glass-splash";

/**
 * Runs before the first paint (root layout) so nothing jumps:
 * - folded sidebar: data-side="rail" on <html> when this device chose it, and always up to 1100px wide;
 * - Glass start animation: "gsplash" on <html> on the first page of a session, then "gsplash-done"
 *   when the page has loaded (at least ~1.3 s so the logo can come together) or after 1.8 s at the latest.
 * Every storage call is wrapped: private windows simply skip the memory.
 */
export const LOOK_SCRIPT = `(function(){var d=document.documentElement;if(d.getAttribute("data-look")!=="glass")return;var r=false;try{r=window.matchMedia("(max-width: 1100px)").matches;r=r||localStorage.getItem("${RAIL_KEY}")==="1"}catch(e){}if(r)d.setAttribute("data-side","rail");var seen=true;try{seen=!!sessionStorage.getItem("${GLASS_SPLASH_KEY}");sessionStorage.setItem("${GLASS_SPLASH_KEY}","1")}catch(e){}if(seen)return;d.classList.add("gsplash");var t0=Date.now(),done=function(){d.classList.add("gsplash-done")};setTimeout(done,1800);window.addEventListener("load",function(){setTimeout(done,Math.max(0,1300-(Date.now()-t0)))})})();`;
