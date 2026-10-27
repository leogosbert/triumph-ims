/**
 * Screen text. The app is English only: tr() returns the English text it is given. It stays as the
 * wrapper around every piece of screen text so wording can be changed in one place later.
 */
type Lang = "en" | "sw";

/** Kept for the pages that call it first; the language is always English. */
export async function primeLang(): Promise<Lang> {
  return "en";
}

/** A piece of screen text (English is the key and the text). */
export function tr(s: string): string {
  return s;
}
