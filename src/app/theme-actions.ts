"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isThemePref, THEME_COOKIE } from "@/lib/theme";
import { BG_COOKIE, isBackgroundPref } from "@/lib/background";

/** Saves Auto / Light / Dark and returns to the same page. */
export async function setTheme(form: FormData) {
  const theme = form.get("theme");
  if (isThemePref(theme)) {
    (await cookies()).set(THEME_COOKIE, theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  await back();
}

/** Saves the app background (Aurora, Grid, Waves, Mountains or Plain) and returns to the same page. */
export async function setBackground(form: FormData) {
  const bg = form.get("bg");
  if (isBackgroundPref(bg)) {
    (await cookies()).set(BG_COOKIE, bg, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  await back();
}

async function back() {
  const ref = (await headers()).get("referer");
  let to = "/";
  try {
    if (ref) {
      const u = new URL(ref);
      to = u.pathname + u.search;
    }
  } catch {
    to = "/";
  }
  redirect(/^\/(?![\/\\])/.test(to) ? to : "/");
}
