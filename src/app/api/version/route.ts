import { NextResponse } from "next/server";
import { APP_VERSION, BUILD_ID, RELEASES } from "@/lib/releases";

// Never built once and stored: every call must answer with the version that is live right now.
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const NO_STORE = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
  // Netlify's own edge cache and any other cache in between.
  "CDN-Cache-Control": "no-store",
  "Netlify-CDN-Cache-Control": "no-store",
  Pragma: "no-cache",
  Expires: "0",
};

/** The version that is live right now, with what's new. Open apps compare it with their own build. */
export function GET() {
  const latest = RELEASES[0];
  return NextResponse.json(
    { build: BUILD_ID, version: APP_VERSION, date: latest?.date ?? "", en: latest?.en ?? [], sw: latest?.sw ?? [] },
    { headers: NO_STORE },
  );
}
