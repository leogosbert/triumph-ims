import { cookies } from "next/headers";

export const THEME_COOKIE = "theme";
export type ThemePref = "auto" | "light" | "dark";

export function isThemePref(v: unknown): v is ThemePref {
  return v === "auto" || v === "light" || v === "dark";
}

/** The person's chosen look: follow the phone (auto), always light or always dark. */
export async function getThemePref(): Promise<ThemePref> {
  const v = (await cookies()).get(THEME_COOKIE)?.value;
  return isThemePref(v) ? v : "auto";
}

/**
 * Runs before the first paint so "auto" never flashes the wrong colours.
 * Sets data-theme="dark" | "light" on <html> and follows the phone if it changes.
 */
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement,p=d.getAttribute("data-theme-pref")||"auto",m=window.matchMedia("(prefers-color-scheme: dark)");function a(){d.setAttribute("data-theme",p==="auto"?(m.matches?"dark":"light"):p)}a();if(p==="auto"&&m.addEventListener)m.addEventListener("change",a)}catch(e){}})();`;
