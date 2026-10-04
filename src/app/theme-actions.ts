"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isThemePref, THEME_COOKIE } from "@/lib/theme";

/** Saves Auto / Light / Dark and returns to the same page. */
export async function setTheme(form: FormData) {
  const theme = form.get("theme");
  if (isThemePref(theme)) {
    (await cookies()).set(THEME_COOKIE, theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  }
  const ref = (await headers()).get("referer");
  let back = "/";
  try {
    if (ref) {
      const u = new URL(ref);
      back = u.pathname + u.search;
    }
  } catch {
    back = "/";
  }
  redirect(/^\/(?![\/\\])/.test(back) ? back : "/");
}
