import { cookies } from "next/headers";
import { isLookPref, LOOK_COOKIE, type LookPref } from "@/lib/look";

/** The person's app style (Account → Appearance → Style): Glass until they choose Classic. */
export async function getLookPref(): Promise<LookPref> {
  const v = (await cookies()).get(LOOK_COOKIE)?.value;
  return isLookPref(v) ? v : "glass";
}
