import { cookies } from "next/headers";

export const BG_COOKIE = "bg";
export const BACKGROUNDS = ["aurora", "grid", "waves", "mountains", "plain"] as const;
export type BackgroundPref = (typeof BACKGROUNDS)[number];

export function isBackgroundPref(v: unknown): v is BackgroundPref {
  return typeof v === "string" && (BACKGROUNDS as readonly string[]).includes(v);
}

/** The person's chosen app background (Account → Appearance). Aurora until they pick another. */
export async function getBackgroundPref(): Promise<BackgroundPref> {
  const v = (await cookies()).get(BG_COOKIE)?.value;
  return isBackgroundPref(v) ? v : "aurora";
}
