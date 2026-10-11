"use client";

import { setLanguage } from "@/app/lang-actions";
import { useLang } from "@/lib/tr-client";

/**
 * English / Kiswahili switch for the pages outside the app (sign-in, welcome, How it works).
 * Inside the app the EN·SW button in the top bar does the same.
 */
export function LangSwitch({ className }: { className?: string }) {
  const lang = useLang();
  return (
    <form action={setLanguage} className={`lang-switch ${className ?? ""}`} aria-label="Language / Lugha">
      <button type="submit" name="lang" value="en" aria-pressed={lang === "en"} lang="en">
        English
      </button>
      <button type="submit" name="lang" value="sw" aria-pressed={lang === "sw"} lang="sw">
        Kiswahili
      </button>
    </form>
  );
}
