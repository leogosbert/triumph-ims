/**
 * What's new in each version of LeMoSp. The newest goes FIRST.
 * When you publish an upgrade, add an entry here: people using the app
 * see it in the "new version" pop-up.
 */
export type Release = { version: string; date: string; en: string[]; sw: string[] };

export const RELEASES: Release[] = [
  {
    version: "1.10",
    date: "2026-10-04",
    en: [
      "Try the demo: sample company with clients, quotations, stock and invoices — no sign-up.",
      "Two-step verification with an authenticator app; management can require it for everyone.",
      "Stronger passwords: strength meter and a check against leaked passwords.",
      "Automatic sign-out when the app is left idle (set by management).",
      "This pop-up tells you when a new version is ready.",
    ],
    sw: [
      "Jaribu demo: kampuni ya mfano yenye wateja, nukuu za bei, stoku na ankara — bila kujisajili.",
      "Uthibitishaji wa hatua mbili kwa programu ya uthibitishaji; uongozi unaweza kuulazimisha kwa wote.",
      "Manenosiri imara zaidi: kipimo cha uimara na ukaguzi wa manenosiri yaliyovuja.",
      "Kutoka kiotomatiki programu ikiachwa bila kutumika (huwekwa na uongozi).",
      "Dirisha hili linakujulisha toleo jipya likiwa tayari.",
    ],
  },
  {
    version: "1.9",
    date: "2026-10-04",
    en: ["New LeMoSp logo, slide-up menu, company panel, install card, dark mode and animations."],
    sw: ["Nembo mpya ya LeMoSp, menyu inayoteleza, paneli ya kampuni, kadi ya kusakinisha, hali ya giza na michoro hai."],
  },
];

export const APP_VERSION = RELEASES[0].version;

/** Identifies this exact build (Netlify sets COMMIT_REF while building). */
export const BUILD_ID = (process.env.NEXT_PUBLIC_BUILD_ID ?? "").slice(0, 12);
