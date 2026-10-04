"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLang, LANG_COOKIE } from "@/lib/i18n";

/** Switches English ↔ Kiswahili and returns to the same page. */
export async function setLanguage(form: FormData) {
  const lang = form.get("lang");
  if (isLang(lang)) {
    (await cookies()).set(LANG_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
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
