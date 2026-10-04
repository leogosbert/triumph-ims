import { cookies } from "next/headers";
import { dictionary, isLang, LANG_COOKIE, type Lang } from "@/lib/i18n";

/** The signed-in person's language (cookie), English by default. */
export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : "en";
}

export async function getDict() {
  const lang = await getLang();
  return { lang, t: dictionary(lang) };
}
