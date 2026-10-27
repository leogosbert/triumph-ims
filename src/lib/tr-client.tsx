"use client";

/**
 * Client-side twin of tr(). The app is English only, so these return English; they stay as the
 * wrapper around screen text in client components.
 */

export function LangProvider({ children }: { lang?: "en" | "sw"; children: React.ReactNode }) {
  return <>{children}</>;
}

/** The current language: always English. */
export function useLang(): "en" | "sw" {
  return "en";
}

const same = (s: string) => s;

/** Returns the translate function (English: the text as given). */
export function useTr(): (s: string) => string {
  return same;
}
