"use client";

import { createContext, useContext } from "react";
import { SW } from "@/lib/sw";

const LangContext = createContext<"en" | "sw">("en");

export function LangProvider({ lang, children }: { lang: "en" | "sw"; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

/** The current language ("en" or "sw"). */
export function useLang(): "en" | "sw" {
  return useContext(LangContext);
}

/** Client-side twin of tr(): returns a translate function for the current language. */
export function useTr(): (s: string) => string {
  const lang = useContext(LangContext);
  return (s: string) => (lang === "sw" ? (SW[s] ?? s) : s);
}
