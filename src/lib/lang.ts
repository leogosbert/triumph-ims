import { dictionary, type Lang } from "@/lib/i18n";

/** The app is English only (an old "lang" cookie is ignored). */
export async function getLang(): Promise<Lang> {
  return "en";
}

export async function getDict() {
  const lang = await getLang();
  return { lang, t: dictionary(lang) };
}
