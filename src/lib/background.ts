import { cookies } from "next/headers";
import { getLookPref } from "@/lib/look-server";

export const BG_COOKIE = "bg";
export const BACKGROUNDS = ["photos", "architecture", "aurora", "grid", "waves", "mountains", "plain"] as const;
export type BackgroundPref = (typeof BACKGROUNDS)[number];

export function isBackgroundPref(v: unknown): v is BackgroundPref {
  return typeof v === "string" && (BACKGROUNDS as readonly string[]).includes(v);
}

/**
 * The person's chosen app background (Account → Appearance). Until they pick one: Photos with the
 * Glass style, Architecture with Classic.
 */
export async function getBackgroundPref(): Promise<BackgroundPref> {
  const v = (await cookies()).get(BG_COOKIE)?.value;
  if (isBackgroundPref(v)) return v;
  return (await getLookPref()) === "glass" ? "photos" : "architecture";
}
