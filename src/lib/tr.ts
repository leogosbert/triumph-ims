import { cache } from "react";
import { cookies } from "next/headers";
import { SW } from "@/lib/sw";

type Lang = "en" | "sw";

// One box per request (React cache), filled by primeLang() at the top of each page.
const box = cache(() => ({ lang: "en" as Lang }));

/** Read the language cookie once for this request so tr() can be synchronous. */
export async function primeLang(): Promise<Lang> {
  try {
    const v = (await cookies()).get("lang")?.value;
    box().lang = v === "sw" ? "sw" : "en";
  } catch {
    /* outside a request: stay English */
  }
  return box().lang;
}

/** Translate a piece of screen text (English is the key). Unknown text is shown as is. */
export function tr(s: string): string {
  return box().lang === "sw" ? (SW[s] ?? s) : s;
}
